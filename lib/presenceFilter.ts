/**
 * @file presenceFilter.ts
 * @description Filters of the researcher list on the three axes (lib/presence.ts): presence,
 * employer (a name, or one of the employer kinds) and LDAP account. Also translates the former
 * `status` URL parameter (INTERNE / EXTERNE / DEPART / PARTI) so that bookmarked links keep working.
 *
 * Pure module: testable, used by hooks/useResearcherFilters.ts.
 */
import type { Researcher } from '../types';
import { Presence, type LdapAccountState } from './presence';

/** Employer filter values that select an employer kind rather than a name. */
export const EMPLOYER_HOME = '__home__';
export const EMPLOYER_EXTERNAL = '__external__';
export const EMPLOYER_NONE = '__none__';

export const PRESENCE_VALUES: Presence[] = [Presence.PRESENT, Presence.DEPART, Presence.PARTI];
export const LDAP_ACCOUNT_VALUES: LdapAccountState[] = ['active', 'closing', 'none'];

type Axes = Pick<Researcher, 'presence' | 'ldapAccount' | 'employerKind' | 'employment'>;

export const matchesPresenceFilter = (r: Axes, selected: string[]): boolean =>
  selected.length === 0 || (!!r.presence && selected.includes(r.presence));

export const matchesLdapAccountFilter = (r: Axes, selected: string[]): boolean =>
  selected.length === 0 || selected.includes(r.ldapAccount ?? 'none');

export const matchesEmployerFilter = (r: Axes, selected: string[]): boolean => {
  if (selected.length === 0) return true;
  const kind = r.employerKind ?? 'unknown';
  return selected.some((v) => {
    if (v === EMPLOYER_HOME) return kind === 'home';
    if (v === EMPLOYER_EXTERNAL) return kind === 'external';
    if (v === EMPLOYER_NONE) return kind === 'unknown';
    return r.employment.employer === v;
  });
};

/** « Internal staff » shortcut (D6): present and employed by the home institution. */
export const INTERNAL_SHORTCUT = { presence: [Presence.PRESENT], employer: [EMPLOYER_HOME] } as const;

export const isInternalShortcut = (presence: string[], employer: string[]): boolean =>
  presence.length === 1 && presence[0] === Presence.PRESENT && employer.length === 1 && employer[0] === EMPLOYER_HOME;

/**
 * Former `status` URL values → presence + employer filters. INTERNE = present, home employer;
 * EXTERNE = present, other employer. DEPART / PARTI span every employer: with one of them, no
 * employer filter (the closest union the two axes can express).
 */
export const filtersFromLegacyStatus = (statuses: string[]): { presence: string[]; employer: string[] } => {
  const values = statuses.map((x) => x.trim().toUpperCase());
  const presence = new Set<string>();
  const employer = new Set<string>();
  for (const s of values) {
    if (s === 'INTERNE') { presence.add(Presence.PRESENT); employer.add(EMPLOYER_HOME); }
    else if (s === 'EXTERNE') { presence.add(Presence.PRESENT); employer.add(EMPLOYER_EXTERNAL); }
    else if (s === 'DEPART') presence.add(Presence.DEPART);
    else if (s === 'PARTI') presence.add(Presence.PARTI);
  }
  const spansEmployers = values.includes('DEPART') || values.includes('PARTI');
  return { presence: [...presence], employer: spansEmployers ? [] : [...employer] };
};

/** Sort rank of the presence (present first). */
export const presenceRank = (p?: Presence): number => (p ? PRESENCE_VALUES.indexOf(p) : PRESENCE_VALUES.length);
