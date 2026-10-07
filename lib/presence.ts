/**
 * @file presence.ts
 * @description The three axes that replace the INTERNE / EXTERNE / DEPART / PARTI status
 * (docs/plan-statut-employeur-ldap.md, decisions of 2026-10-07):
 *
 * - **employer** — who pays: the home institution, another one, or not filled in (Grist `Employeur`);
 * - **presence** — is the person still in the unit: PRESENT, DEPART (end announced), PARTI;
 * - **LDAP account** — raw fact: active, closing (dynaEtat D) or none.
 *
 * The uid no longer plays any part: an `ext_` uid or a real one only tells whether there is an
 * LDAP account to read. The legacy status stays computed (`legacyStatus`) until every screen has
 * moved to the three axes.
 *
 * Pure module (no network / DOM access): testable, used by gristService.
 */
import { ResearcherStatus } from '../types';
import { fuzzyDateUpperBound, isFuzzyDatePast, todayIso } from './dates';
import { isExternalEmployer, type ValidationInfo } from './validation';

export enum Presence {
  PRESENT = 'PRESENT',
  DEPART = 'DEPART',   // end announced: LDAP account closing, or employment end within DEPARTURE_NOTICE_MONTHS
  PARTI = 'PARTI',
}

export type LdapAccountState = 'active' | 'closing' | 'none';
export type EmployerKind = 'home' | 'external' | 'unknown';

/** An employment end this close is an announced departure (D1). Beyond it, the person is present:
 * a doctoral contract ending in three years says nothing about this year. */
export const DEPARTURE_NOTICE_MONTHS = 3;

/** Employer axis from the Grist employer (label, UAI): « non renseigné » or empty = unknown. */
export const employerKindOf = (name: unknown, uai?: unknown): EmployerKind => {
  if (isExternalEmployer(name, uai)) return 'external';
  const n = String(name ?? '').trim();
  return (n && !/^non renseign/i.test(n)) || String(uai ?? '').trim() ? 'home' : 'unknown';
};

/** LDAP account of a record: a real uid (not `ext_`) found in the LDAP cache; D = closing. */
export const ldapAccountOf = (uid: unknown, ldapEtat: unknown): LdapAccountState => {
  const u = String(uid ?? '').trim();
  if (!u || u.startsWith('ext_') || ldapEtat === undefined || ldapEtat === null) return 'none';
  return String(ldapEtat).trim().toUpperCase().startsWith('D') ? 'closing' : 'active';
};

/** Validated status → presence (D5): INTERNE / EXTERNE, written before 2026-10-07, mean « present ». */
export const presenceFromValidated = (raw: unknown): Presence | undefined => {
  const s = String(raw ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s === 'PRESENT' || s === 'INTERNE' || s === 'EXTERNE') return Presence.PRESENT;
  if (s === 'DEPART') return Presence.DEPART;
  if (s === 'PARTI') return Presence.PARTI;
  return undefined;
};

/** `today` + n months, as YYYY-MM-DD (day clamped by Date). */
const addMonths = (today: string, months: number): string => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

export interface PresenceInput {
  employer: EmployerKind;
  /** Real uid (not ext_)? Only then can an absence from LDAP mean a departure. */
  hasRealUid: boolean;
  /** dynaEtat of the LDAP cache entry; undefined when the uid is not in the cache. */
  ldapEtat?: string;
  /** Fuzzy dates (YYYY, YYYY-MM, YYYY-MM-DD) as read from Grist. */
  employmentEnd?: string;
  membershipEnd?: string;
  /** Presence set by a reliable list (validation layer covering the status), if any. */
  validated?: Presence;
  /** Retired without emeritus status (lib/emeritus.ts). */
  retireeWithoutEmeritus?: boolean;
  today?: string;
}

/**
 * Presence in the unit. Order (docs/plan-statut-employeur-ldap.md § 2):
 * 1. employment end AND membership end past ⇒ PARTI, above everything (rule of 2026-09-22);
 * 2. validation by a reliable list ⇒ its value;
 * 3. retired without emeritus status ⇒ PARTI;
 * 4. home (or unknown) employer with a real uid: LDAP D ⇒ DEPART, uid gone from LDAP ⇒ PARTI —
 *    for another employer the LDAP account is a hosting one and says nothing (a task flags it, D3);
 * 5. employment end past ⇒ PARTI, within DEPARTURE_NOTICE_MONTHS ⇒ DEPART;
 * 6. otherwise PRESENT.
 */
export const derivePresence = (p: PresenceInput): Presence => {
  const today = p.today ?? todayIso();
  if (isFuzzyDatePast(p.employmentEnd, today) && isFuzzyDatePast(p.membershipEnd, today)) return Presence.PARTI;
  if (p.validated) return p.validated;
  if (p.retireeWithoutEmeritus) return Presence.PARTI;
  if (p.employer !== 'external' && p.hasRealUid) {
    if (p.ldapEtat === undefined) return Presence.PARTI;
    if (String(p.ldapEtat).trim().toUpperCase().startsWith('D')) return Presence.DEPART;
  }
  if (isFuzzyDatePast(p.employmentEnd, today)) return Presence.PARTI;
  // Last day of a fuzzy end (« 2027 » → 2027-12-31): a year-only end is not announced in October 2026.
  const end = fuzzyDateUpperBound(p.employmentEnd);
  if (end && end <= addMonths(today, DEPARTURE_NOTICE_MONTHS)) return Presence.DEPART;
  return Presence.PRESENT;
};

/**
 * Home staff (the « Internal » shortcut, D6): employed by the home institution, or employer not
 * filled in but holding an LDAP account (what the directory sync relied on until the employer
 * fill of 2026-10-07). Says nothing about presence.
 */
export const isHomeStaff = (employer: EmployerKind, ldapAccount: LdapAccountState): boolean =>
  employer === 'home' || (employer === 'unknown' && ldapAccount !== 'none');

/**
 * Legacy status, for the screens not moved to the three axes yet: DEPART / PARTI as the presence;
 * a present person is INTERNE when home staff, EXTERNE otherwise.
 */
export const legacyStatus = (presence: Presence, employer: EmployerKind, ldapAccount: LdapAccountState): ResearcherStatus => {
  if (presence === Presence.PARTI) return ResearcherStatus.PARTI;
  if (presence === Presence.DEPART) return ResearcherStatus.DEPART;
  return isHomeStaff(employer, ldapAccount) ? ResearcherStatus.INTERNE : ResearcherStatus.EXTERNE;
};

/**
 * A validation covering the status contradicts what the sources (LDAP, dates) say about the presence:
 * the displayed presence is the validated one, the badge flags the divergence. INTERNE vs EXTERNE is
 * no longer a conflict (both mean present; the employer is a separate axis).
 */
export const hasPresenceConflict = (validation: ValidationInfo | undefined, derived: Presence | undefined): boolean => {
  if (!derived || !validation?.validated || !validation.validationScope.includes('statut')) return false;
  const validated = presenceFromValidated(validation.validatedStatus);
  return !!validated && validated !== derived;
};
