/**
 * @file ldapMoves.ts
 * @description « Arrivals and departures » tab of the LDAP alignment page: staff accounts created
 * or left since a date (GET /api/ldap/moves, scripts/lib/ldap_moves.cjs), crossed with the Annuaire.
 * Arrivals = accounts created since the date (or pre-created) without a record; departures = records
 * whose account entered a grace period, a lock or inactivity since the date, not already « Parti ».
 */
import { Researcher, ResearcherStatus, Structure } from '../types';
import { translateApiError } from './apiErrors';
import { labIndex, labsFromAffectations } from './ldapPerson';

/** {COMPTE} value of supannRessourceEtatDate: state (A/I/S), sub-state, dates of the state (YYYY-MM-DD or ''). */
export interface LdapAccountState {
  state: string;
  subState: string;
  start: string;
  end: string;
}

/** One staff account as returned by /api/ldap/moves. */
export interface LdapMovePerson {
  uid: string;
  lastName: string;
  firstName: string;
  email: string;
  /** dynaEtat: N (normal), D (departure), A (anticipated = pre-created, arrival to come). */
  etat: string;
  categorie: string;
  empCorps: string;
  /** Contract end (latest supannEmpProfil datefin), '' when open-ended. */
  dateFin: string;
  affectationCodes: string[];
  affectationPrincipale: string;
  affectationPrincipaleLabel: string;
  /** Account creation (createTimestamp), YYYY-MM-DD. */
  createdAt: string;
  account: LdapAccountState | null;
}

export interface LdapMoves {
  since: string;
  arrivals: LdapMovePerson[];
  departures: LdapMovePerson[];
}

export interface LdapArrival extends LdapMovePerson {
  /** Labs found among the affectations (principal first), '' entries excluded. */
  labs: string[];
  /** Pre-created account (dynaEtat A): the arrival is still to come. */
  upcoming: boolean;
}

export interface LdapDeparture {
  person: LdapMovePerson;
  researcher: Researcher;
  /** Date the account entered its current state = departure date written by « Mark as left ». */
  since: string;
}

/** Categories unchecked by default in the arrivals filter (not research staff). */
export const DEFAULT_HIDDEN_CATEGORIES = ['VACATAIRE', 'STAGIAIRE', 'PRESTATAIRE', 'PRESTATAIRE INTEGRE', 'APPRENTI'];

/** First day of the previous month (on 2026-10-02 → 2026-09-01). */
export const defaultSince = (today: Date = new Date()): string => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
};

export const fetchLdapMoves = async (since: string): Promise<LdapMoves> => {
  const resp = await fetch(`/api/ldap/moves?since=${encodeURIComponent(since)}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`);
  return data as LdapMoves;
};

const uidKey = (uid: unknown) => String(uid || '').trim().toLowerCase();

/** New accounts without an Annuaire record, newest first (pre-created ones on top: to come). */
export const buildArrivals = (moves: LdapMovePerson[], researchers: Researcher[], structures: Structure[]): LdapArrival[] => {
  const known = new Set(researchers.map((r) => uidKey(r.uid)).filter(Boolean));
  const labs = labIndex(structures);
  return moves
    .filter((p) => p.uid && !known.has(uidKey(p.uid)))
    .map((p) => ({ ...p, labs: labsFromAffectations(p, labs), upcoming: p.etat.toUpperCase() === 'A' }))
    .sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || b.createdAt.localeCompare(a.createdAt) || a.lastName.localeCompare(b.lastName));
};

/** Annuaire records whose account left since the date, except those already « Parti », latest first. */
export const buildDepartures = (moves: LdapMovePerson[], researchers: Researcher[]): LdapDeparture[] => {
  const byUid = new Map<string, Researcher>();
  for (const r of researchers) if (r.uid) byUid.set(uidKey(r.uid), r);
  const out: LdapDeparture[] = [];
  for (const p of moves) {
    const researcher = byUid.get(uidKey(p.uid));
    if (!researcher || researcher.status === ResearcherStatus.PARTI || !p.account?.start) continue;
    out.push({ person: p, researcher, since: p.account.start });
  }
  return out.sort((a, b) => b.since.localeCompare(a.since) || a.researcher.displayName.localeCompare(b.researcher.displayName));
};
