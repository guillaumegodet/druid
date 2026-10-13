/**
 * Directory statistics of the « Directory » view of the dashboard (Tableau de bord › People ›
 * Headcount) and of the « Key figures » strip of the People page — computed on the Druid
 * records themselves, as of today (docs/archive/plan-tableau-de-bord-familles.md, decisions D3 and D4).
 * Pure functions: labels are translated by the components.
 */
import { Affiliation, Presence, Researcher, Structure } from '../types';
import { normalizeAcronym } from './normalize';
import { isFuzzyDatePast, todayIso } from './dates';

export type PresenceSlice = 'home' | 'external' | 'unknown' | 'depart' | 'parti';
export const PRESENCE_SLICES: PresenceSlice[] = ['home', 'external', 'unknown', 'depart', 'parti'];

/** Present staff split by employer kind, then the announced and effective departures. */
export function presenceBreakdown(researchers: Researcher[]): Record<PresenceSlice, number> {
  const out: Record<PresenceSlice, number> = { home: 0, external: 0, unknown: 0, depart: 0, parti: 0 };
  for (const r of researchers) {
    if (r.presence === Presence.DEPART) out.depart++;
    else if (r.presence === Presence.PARTI) out.parti++;
    else if (r.employerKind === 'home') out.home++;
    else if (r.employerKind === 'external') out.external++;
    else out.unknown++;
  }
  return out;
}

export type Gender = 'f' | 'm' | 'other' | null;

/** Gender read from the civility (« Mme », « M. », « Madame »…); null when empty. */
export function genderOf(civility: string | undefined | null): Gender {
  const civ = (civility || '').toUpperCase().trim();
  if (civ === '') return null;
  if (civ === 'F' || civ.startsWith('MME') || civ.startsWith('MADAME') || civ.startsWith('MLLE')) return 'f';
  if (civ === 'M' || civ.startsWith('M.') || civ.startsWith('MONSIEUR') || civ.startsWith('MR')) return 'm';
  return 'other';
}

export function genderBreakdown(researchers: Researcher[]): { women: number; men: number; other: number; unknown: number } {
  const out = { women: 0, men: 0, other: 0, unknown: 0 };
  for (const r of researchers) {
    const g = genderOf(r.civility);
    if (g === 'f') out.women++;
    else if (g === 'm') out.men++;
    else if (g === 'other') out.other++;
    else out.unknown++;
  }
  return out;
}

export type AgeGroup = 'under30' | '31to45' | '46to60' | 'over60';
export const AGE_GROUPS: AgeGroup[] = ['under30', '31to45', '46to60', 'over60'];

/** Age groups from the birth year (records without a usable birth date are left out). */
export function ageGroups(researchers: Researcher[], currentYear: number): Record<AgeGroup, number> {
  const out: Record<AgeGroup, number> = { under30: 0, '31to45': 0, '46to60': 0, over60: 0 };
  for (const r of researchers) {
    const year = Number.parseInt(String(r.birthDate ?? '').slice(0, 4), 10);
    if (!Number.isFinite(year) || year < 1900) continue;
    const age = currentYear - year;
    if (age <= 30) out.under30++;
    else if (age <= 45) out['31to45']++;
    else if (age <= 60) out['46to60']++;
    else out.over60++;
  }
  return out;
}

export interface CountRow { name: string; count: number }

/**
 * Most frequent values of a field, decreasing. Records without value are counted under `''`
 * (the component labels it « Not provided »), ranked with the others.
 */
export function topCounts(researchers: Researcher[], pick: (r: Researcher) => string | undefined | null, limit: number): CountRow[] {
  const counts = new Map<string, number>();
  for (const r of researchers) {
    const key = (pick(r) ?? '').trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Primary lab of a record (primary affiliation, else the first one). */
export const primaryLabOf = (r: Researcher): string =>
  r.affiliations.find((a) => a.isPrimary)?.structureName || r.affiliations[0]?.structureName || '';

export type IdentifierKey = 'orcid' | 'idref' | 'hal' | 'scopus' | 'openalex';
export const IDENTIFIER_KEYS: IdentifierKey[] = ['orcid', 'idref', 'hal', 'scopus', 'openalex'];

/** Records carrying each identifier. */
export function identifierCoverage(researchers: Researcher[]): Record<IdentifierKey, number> {
  const out: Record<IdentifierKey, number> = { orcid: 0, idref: 0, hal: 0, scopus: 0, openalex: 0 };
  for (const r of researchers) {
    const ids = r.identifiers ?? {};
    if (ids.orcid) out.orcid++;
    if (ids.idref) out.idref++;
    if (ids.halId || ids.halIdNum) out.hal++;
    if (ids.scopusId) out.scopus++;
    if (ids.openalexId || ids.openalexIds) out.openalex++;
  }
  return out;
}

export interface DirectoryKpis {
  total: number;
  present: number;
  leaving: number;
  left: number;
  hdr: number;
  /** HDR share of the records, 0-100 (null when empty). */
  hdrRate: number | null;
  women: number;
  men: number;
  /** Women among the records whose gender is known, 0-100 (null when unknown). */
  womenShare: number | null;
  orcid: number;
  orcidRate: number | null;
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);

export function directoryKpis(researchers: Researcher[]): DirectoryKpis {
  const presence = presenceBreakdown(researchers);
  const gender = genderBreakdown(researchers);
  const ids = identifierCoverage(researchers);
  const total = researchers.length;
  const hdr = researchers.filter((r) => r.nuFields?.hdr).length;
  const genderKnown = gender.women + gender.men;
  return {
    total,
    present: presence.home + presence.external + presence.unknown,
    leaving: presence.depart,
    left: presence.parti,
    hdr,
    hdrRate: pct(hdr, total),
    women: gender.women,
    men: gender.men,
    womenShare: pct(gender.women, genderKnown),
    orcid: ids.orcid,
    orcidRate: pct(ids.orcid, total),
  };
}

/** Affiliation still running today (no end date, or an end date not yet past). */
export const isActiveAffiliation = (a: Affiliation, today: string = todayIso()): boolean =>
  !a.endDate || !isFuzzyDatePast(a.endDate, today);

/**
 * Records of the structure behind a dashboard slug: the structure whose acronym matches the
 * slug (normalizeAcronym, the rule of App.dashboardSlugFor) plus its child structures (teams,
 * `parentStructure` = acronym), matched on the active affiliations by structure id or displayed
 * name. Returns null when no structure matches (group, institution-wide slug) — the caller
 * decides what to show then.
 */
export function researchersOfSlug(
  slug: string,
  structures: Pick<Structure, 'id' | 'acronym' | 'officialName' | 'parentStructure'>[],
  researchers: Researcher[],
  today: string = todayIso(),
): Researcher[] | null {
  const target = normalizeAcronym(slug);
  if (!target) return null;
  const roots = structures.filter((s) => s.acronym && normalizeAcronym(s.acronym) === target);
  if (roots.length === 0) return null;
  const rootAcronyms = new Set(roots.map((s) => normalizeAcronym(s.acronym)));
  const members = structures.filter((s) =>
    rootAcronyms.has(normalizeAcronym(s.acronym ?? '')) || (s.parentStructure && rootAcronyms.has(normalizeAcronym(s.parentStructure))));
  const ids = new Set(members.map((s) => s.id).filter(Boolean));
  const names = new Set(members.flatMap((s) => [s.acronym, s.officialName])
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
    .map((n) => normalizeAcronym(n)));
  return researchers.filter((r) => r.affiliations.some((a) =>
    isActiveAffiliation(a, today)
    && ((a.structureId && ids.has(a.structureId)) || (a.structureName && names.has(normalizeAcronym(a.structureName))))));
}
