/**
 * @file staffAggregates.ts
 * @description Staff aggregates of the dashboard Researchers tab: population filter, age brackets,
 * research FTE-years pro rata of presence, publication rate per research FTE (lot 3 of the research
 * FTE plan — LPPL request of 2026-10-06). Pure module: tested in lib/__tests__/staffAggregates.test.ts.
 *
 * Decisions of the plan:
 * - D1 age = publication year − birth year (a person may change bracket over the period);
 * - D2 denominator = research FTE × fraction of each year spent in the lab (membership dates,
 *   whole period when unknown; the current year stops at `asOf`, like its publications);
 * - D3 whole counting: a publication counts once in each bracket where it has an author;
 * - D4 research FTE from the export (Annuaire value or grade default flagged `researchFteEstimated`);
 *   PhD students, emeriti and members without a positive research FTE stay out of the rate
 *   (numerator and denominator), whatever the population filter;
 * - D6 brackets with fewer than `minCell` people are merged with a neighbour (unknown age: masked);
 * - D7 former members (`formerMembers`) only count when presence = « period », pro rata.
 */
import { fuzzyDateLowerBound, fuzzyDateUpperBound } from '../../lib/dates';
import type { DashboardDataset, DashboardPublication, MemberMeta, StaffCategory } from './types';
import type { YearRange } from './overviewAggregates';
import { countsForResearchers } from './editorialEntries';

// ── Population filter ─────────────────────────────────────────────────────────

export const NONE = 'none';
export const MEMBERSHIP_KEYS = ['stat_mmb', 'assoc_mmb', 'second_mmb', 'visit_mmb', NONE] as const;
export type MembershipKey = (typeof MEMBERSHIP_KEYS)[number];
export const CATEGORY_KEYS = ['permanent', 'non_permanent', 'doctorant', 'emeritus', NONE] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];
/** « current »: current members only; « period »: also the former members present during the period. */
export type Presence = 'current' | 'period';

export interface StaffFilter {
  memberships: MembershipKey[];
  categories: CategoryKey[];
  presence: Presence;
}

export const DEFAULT_STAFF_FILTER: StaffFilter = {
  memberships: [...MEMBERSHIP_KEYS],
  categories: [...CATEGORY_KEYS],
  presence: 'current',
};

/** A member of the filtered population (current or former). */
export interface StaffMember extends MemberMeta {
  former: boolean;
  /** Stable identity within the dataset (labels are unique per list). */
  key: string;
}

export const membershipKeyOf = (m: MemberMeta): MembershipKey =>
  (MEMBERSHIP_KEYS as readonly string[]).includes(m.membershipType ?? '') ? (m.membershipType as MembershipKey) : NONE;

/** Category, with the PhD flag as fallback for exports predating the staff attributes. */
export const categoryKeyOf = (m: MemberMeta): CategoryKey =>
  (m.category as StaffCategory | null | undefined) ?? (m.isPhd ? 'doctorant' : NONE);

/** True when the export carries the staff attributes (druid-biblio, 2026-10-06 onwards). */
export const hasStaffAttributes = (dataset: Pick<DashboardDataset, 'members'>): boolean =>
  dataset.members.some((m) => m.category !== undefined);

export function filterStaff(
  dataset: Pick<DashboardDataset, 'members' | 'formerMembers'>,
  filter: StaffFilter,
  range: YearRange,
  asOf: string,
): StaffMember[] {
  const current = dataset.members.map((m) => ({ ...m, former: false, key: `m:${m.label}` }));
  const former = filter.presence === 'period'
    ? (dataset.formerMembers ?? [])
      .map((m) => ({ ...m, former: true, key: `f:${m.label}` }))
      .filter((m) => Array.from(presenceByYear(m, range, asOf).values()).some((f) => f > 0))
    : [];
  return [...current, ...former].filter((m) =>
    filter.memberships.includes(membershipKeyOf(m)) && filter.categories.includes(categoryKeyOf(m)));
}

// ── Presence pro rata (D2) ───────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Fraction (0-1) of each year of the range spent in the lab, from the membership dates. A current
 * member without dates counts the whole period; a former member without an end date cannot be
 * placed in time and gets nothing (reported as undated). Years after `asOf` count up to `asOf`.
 */
export function presenceByYear(
  m: Pick<StaffMember, 'startDate' | 'endDate'> & { former?: boolean },
  range: YearRange,
  asOf: string,
): Map<number, number> {
  const out = new Map<number, number>();
  const start = fuzzyDateLowerBound(m.startDate ?? '');
  const end = fuzzyDateUpperBound(m.endDate ?? '');
  if (m.former && !end) return out;
  for (let y = range.start; y <= range.end; y++) {
    const from = [`${y}-01-01`, start].filter(Boolean).sort().pop()!;
    const to = [`${y}-12-31`, end, asOf].filter(Boolean).sort()[0];
    const days = to >= from ? dayNumber(to) - dayNumber(from) + 1 : 0;
    out.set(y, days / (isLeap(y) ? 366 : 365));
  }
  return out;
}

export const isUndatedFormer = (m: StaffMember): boolean => m.former && !fuzzyDateUpperBound(m.endDate ?? '');

// ── Age brackets (D1, D6) ────────────────────────────────────────────────────

export interface AgeBracket { key: string; min: number | null; max: number | null }

export const AGE_BRACKETS: AgeBracket[] = [
  { key: '<35', min: null, max: 34 },
  { key: '35-44', min: 35, max: 44 },
  { key: '45-54', min: 45, max: 54 },
  { key: '55+', min: 55, max: null },
];
export const AGE_UNKNOWN = 'unknown';

export const ageBracketOf = (age: number | null): string => {
  if (age === null || !Number.isFinite(age)) return AGE_UNKNOWN;
  return AGE_BRACKETS.find((b) => (b.min === null || age >= b.min) && (b.max === null || age <= b.max))!.key;
};

/** Label of merged consecutive brackets: `<45`, `35-54`, `45+`… */
export const mergedBracketLabel = (keys: string[]): string => {
  if (keys.length === 1) return keys[0];
  const parts = keys.map((k) => AGE_BRACKETS.find((b) => b.key === k)!);
  const min = parts[0].min;
  const max = parts[parts.length - 1].max;
  if (min === null) return `<${max! + 1}`;
  if (max === null) return `${min}+`;
  return `${min}-${max}`;
};

/**
 * Groups consecutive age brackets so that each group has at least `minCell` distinct people (D6 statistical
 * secrecy): an under-populated bracket joins its smaller neighbour, repeatedly. Empty brackets are
 * dropped. Returns the groups in age order; the unknown age is handled by the caller (masked).
 */
export function mergeSmallBrackets(people: Map<string, Set<string>>, minCell: number): string[][] {
  let groups = AGE_BRACKETS.map((b) => [b.key]).filter((g) => (people.get(g[0])?.size ?? 0) > 0);
  // Distinct people: someone who changed bracket during the period counts once in a merged group.
  const size = (g: string[]) => new Set(g.flatMap((k) => Array.from(people.get(k) ?? []))).size;
  for (;;) {
    const i = groups.findIndex((g) => size(g) < minCell);
    if (i < 0 || groups.length < 2) return groups;
    const left = i > 0 ? i - 1 : -1;
    const right = i < groups.length - 1 ? i + 1 : -1;
    const j = left < 0 ? right : right < 0 ? left : size(groups[left]) <= size(groups[right]) ? left : right;
    const [a, b] = [Math.min(i, j), Math.max(i, j)];
    groups = [...groups.slice(0, a), [...groups[a], ...groups[b]], ...groups.slice(b + 1)];
  }
}

// ── Publication rate per research FTE by age bracket (D1-D4, D6) ─────────────

export interface BracketRate {
  /** Bracket label (merged brackets: `45+`…; `unknown` = birth year missing). */
  key: string;
  /** Distinct people with a research FTE present in the bracket during the period. */
  people: number;
  /** Research FTE × years of presence. */
  fteYears: number;
  /** Part of `fteYears` coming from grade defaults (D4). */
  estimatedFteYears: number;
  /** Publications with at least one author of the bracket (whole counting). */
  publications: number;
  /** publications / fteYears, null without FTE-years. */
  rate: number | null;
  /** Publications per year of the range (heatmap). */
  byYear: number[];
  /** Publication indexes. */
  pubIndexes: number[];
  /** « authorId:year » pairs of the bracket (drill-down: PubFilters.authorYears). */
  authorYears: string[];
}

export interface PublicationRateResult {
  years: number[];
  brackets: BracketRate[];
  overall: Omit<BracketRate, 'key'>;
  /** People of the population left out of the rate. */
  excluded: { phdOrEmeritus: number; noResearchFte: number; undatedFormer: number; maskedUnknownAge: number };
}

interface Cell {
  people: Set<string>; fteYears: number; estimated: number; pubs: Set<number>; byYear: Map<number, Set<number>>;
  authorYears: Set<string>;
}
const newCell = (): Cell => ({
  people: new Set(), fteYears: 0, estimated: 0, pubs: new Set(), byYear: new Map(), authorYears: new Set(),
});

export function publicationRateByAge(
  pubs: DashboardPublication[],
  staff: StaffMember[],
  range: YearRange,
  asOf: string,
  minCell = 3,
): PublicationRateResult {
  const years: number[] = [];
  for (let y = range.start; y <= range.end; y++) years.push(y);
  const cells = new Map<string, Cell>();
  const cell = (k: string) => cells.get(k) ?? cells.set(k, newCell()).get(k)!;
  const overall = newCell();
  // author id → year → bracket of that author in that year (only while present).
  const bracketOfAuthor = new Map<number, Map<number, string>>();
  let phdOrEmeritus = 0;
  let noResearchFte = 0;
  let undatedFormer = 0;

  for (const m of staff) {
    const category = categoryKeyOf(m);
    if (category === 'doctorant' || category === 'emeritus') { phdOrEmeritus++; continue; }
    const fte = m.researchFte;
    if (typeof fte !== 'number' || !(fte > 0)) { noResearchFte++; continue; }
    if (isUndatedFormer(m)) { undatedFormer++; continue; }
    for (const [y, frac] of presenceByYear(m, range, asOf)) {
      if (frac <= 0) continue;
      const k = ageBracketOf(m.birthYear ? y - m.birthYear : null);
      for (const c of [cell(k), overall]) {
        c.people.add(m.key);
        c.fteYears += fte * frac;
        if (m.researchFteEstimated) c.estimated += fte * frac;
      }
      if (m.authorId !== null && m.authorId !== undefined) {
        cell(k).authorYears.add(`${m.authorId}:${y}`);
        overall.authorYears.add(`${m.authorId}:${y}`);
        const byYear = bracketOfAuthor.get(m.authorId) ?? bracketOfAuthor.set(m.authorId, new Map()).get(m.authorId)!;
        byYear.set(y, k);
      }
    }
  }

  pubs.forEach((p, idx) => {
    if (p.year === null || p.year < range.start || p.year > range.end || !countsForResearchers(p)) return;
    const ks = new Set<string>();
    for (const id of p.authorIds) {
      const k = bracketOfAuthor.get(id)?.get(p.year);
      if (k) ks.add(k);
    }
    for (const k of ks) {
      const c = cell(k);
      c.pubs.add(idx);
      (c.byYear.get(p.year) ?? c.byYear.set(p.year, new Set()).get(p.year)!).add(idx);
    }
    if (ks.size > 0) {
      overall.pubs.add(idx);
      (overall.byYear.get(p.year) ?? overall.byYear.set(p.year, new Set()).get(p.year)!).add(idx);
    }
  });

  const toRate = (key: string, c: Cell): BracketRate => ({
    key,
    people: c.people.size,
    fteYears: c.fteYears,
    estimatedFteYears: c.estimated,
    publications: c.pubs.size,
    rate: c.fteYears > 0 ? c.pubs.size / c.fteYears : null,
    byYear: years.map((y) => c.byYear.get(y)?.size ?? 0),
    pubIndexes: Array.from(c.pubs).sort((a, b) => a - b),
    authorYears: Array.from(c.authorYears).sort(),
  });
  const union = (keys: string[]): Cell => {
    const out = newCell();
    for (const k of keys) {
      const c = cells.get(k);
      if (!c) continue;
      c.people.forEach((p) => out.people.add(p));
      out.fteYears += c.fteYears;
      out.estimated += c.estimated;
      c.pubs.forEach((i) => out.pubs.add(i));
      c.authorYears.forEach((a) => out.authorYears.add(a));
      for (const [y, s] of c.byYear) {
        const t = out.byYear.get(y) ?? out.byYear.set(y, new Set()).get(y)!;
        s.forEach((i) => t.add(i));
      }
    }
    return out;
  };

  const people = new Map(Array.from(cells.entries()).map(([k, c]) => [k, c.people]));
  const brackets = mergeSmallBrackets(people, minCell).map((g) => toRate(mergedBracketLabel(g), union(g)));
  const unknown = cells.get(AGE_UNKNOWN);
  let maskedUnknownAge = 0;
  if (unknown) {
    if (unknown.people.size >= minCell) brackets.push(toRate(AGE_UNKNOWN, unknown));
    else maskedUnknownAge = unknown.people.size;
  }
  const { key: _key, ...overallRate } = toRate('overall', overall);
  return { years, brackets, overall: overallRate, excluded: { phdOrEmeritus, noResearchFte, undatedFormer, maskedUnknownAge } };
}

// ── Age pyramid (current age) ────────────────────────────────────────────────

export interface AgePyramid {
  /** Bracket labels in age order (merged as in D6), `unknown` last when shown. */
  brackets: string[];
  categories: CategoryKey[];
  /** headcount[bracket][category] and research FTE[bracket][category]. */
  headcount: number[][];
  researchFte: number[][];
  maskedUnknownAge: number;
}

/** Population by age bracket (age in `year`) and category; brackets merged below `minCell` people. */
export function agePyramid(staff: StaffMember[], year: number, minCell = 3): AgePyramid {
  const byBracket = new Map<string, StaffMember[]>();
  for (const m of staff) {
    const k = ageBracketOf(m.birthYear ? year - m.birthYear : null);
    (byBracket.get(k) ?? byBracket.set(k, []).get(k)!).push(m);
  }
  const people = new Map(Array.from(byBracket.entries()).map(([k, ms]) => [k, new Set(ms.map((m) => m.key))]));
  const groups = mergeSmallBrackets(people, minCell);
  const unknown = byBracket.get(AGE_UNKNOWN) ?? [];
  const showUnknown = unknown.length >= minCell;
  const rows = groups.map((g) => g.flatMap((k) => byBracket.get(k) ?? []));
  if (showUnknown) rows.push(unknown);
  const categories = CATEGORY_KEYS.filter((c) => staff.some((m) => categoryKeyOf(m) === c));
  const tally = (ms: StaffMember[], f: (m: StaffMember) => number) =>
    categories.map((c) => ms.filter((m) => categoryKeyOf(m) === c).reduce((n, m) => n + f(m), 0));
  return {
    brackets: [...groups.map(mergedBracketLabel), ...(showUnknown ? [AGE_UNKNOWN] : [])],
    categories,
    headcount: rows.map((ms) => tally(ms, () => 1)),
    researchFte: rows.map((ms) => tally(ms, (m) => m.researchFte ?? 0)),
    maskedUnknownAge: showUnknown ? 0 : unknown.length,
  };
}

// ── Indicators and publications per member ───────────────────────────────────

export interface MemberPublications {
  key: string;
  label: string;
  category: CategoryKey;
  /** Publications of the range while present (0 for an unmatched member). */
  count: number;
  /** False when no author of the corpus was matched to the member (name spelling): count unknown. */
  matched: boolean;
  /** « authorId:year » pairs of the years of presence (drill-down: PubFilters.authorYears). */
  authorYears: string[];
}

/** Publications of each member over the range, counted only for the years of presence. */
export function publicationsPerMember(
  pubs: DashboardPublication[],
  staff: StaffMember[],
  range: YearRange,
  asOf: string,
): MemberPublications[] {
  const presentYears = new Map<number, Set<number>>();
  for (const m of staff) {
    if (m.authorId === null || m.authorId === undefined) continue;
    const ys = new Set(Array.from(presenceByYear(m, range, asOf)).filter(([, f]) => f > 0).map(([y]) => y));
    // A former member and a current one can share an author (same normalized name): union.
    const known = presentYears.get(m.authorId);
    presentYears.set(m.authorId, known ? new Set([...known, ...ys]) : ys);
  }
  const counts = new Map<number, number>();
  for (const p of pubs) {
    if (p.year === null || p.year < range.start || p.year > range.end || !countsForResearchers(p)) continue;
    for (const id of p.authorIds) {
      if (presentYears.get(id)?.has(p.year)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return staff.map((m) => {
    const matched = m.authorId !== null && m.authorId !== undefined;
    const years = matched ? Array.from(presentYears.get(m.authorId!) ?? []).sort() : [];
    return {
      key: m.key, label: m.label, category: categoryKeyOf(m), matched,
      count: matched ? counts.get(m.authorId!) ?? 0 : 0,
      authorYears: years.map((y) => `${m.authorId}:${y}`),
    };
  });
}

/** Publication-count steps of the distribution chart (lower bounds; the last one is open). */
export const PUBLICATION_STEPS = [0, 1, 3, 6, 11, 21] as const;

export const publicationStepLabel = (i: number): string => {
  const lo = PUBLICATION_STEPS[i];
  const next = PUBLICATION_STEPS[i + 1];
  if (next === undefined) return `${lo}+`;
  return next - 1 === lo ? String(lo) : `${lo}-${next - 1}`;
};

export interface PublicationsDistribution {
  steps: string[];
  categories: CategoryKey[];
  /** members[step][category] — matched members only. */
  members: number[][];
  /** Members not matched to any author (left out: their count is unknown). */
  unmatched: number;
}

/** Number of members per publication-count step and category (non-publishing members included). */
export function publicationsDistribution(perMember: MemberPublications[]): PublicationsDistribution {
  const matched = perMember.filter((m) => m.matched);
  const categories = CATEGORY_KEYS.filter((c) => matched.some((m) => m.category === c));
  const stepOf = (n: number) => PUBLICATION_STEPS.reduce((acc, lo, i) => (n >= lo ? i : acc), 0);
  const members = PUBLICATION_STEPS.map(() => categories.map(() => 0));
  for (const m of matched) members[stepOf(m.count)][categories.indexOf(m.category)]++;
  return {
    steps: PUBLICATION_STEPS.map((_, i) => publicationStepLabel(i)),
    categories,
    members,
    unmatched: perMember.length - matched.length,
  };
}

export interface StaffKpis {
  headcount: number;
  /** Sum of the research FTEs of the population (current value), PhD students and emeriti excluded as in the rate. */
  researchFte: number;
  /** Part of `researchFte` coming from grade defaults. */
  estimatedResearchFte: number;
  /** Members other than PhD students and emeriti with no research FTE (null): unknown grades. */
  withoutResearchFte: number;
  /** Publications per research FTE and per year (rate of the whole population, D2-D4). */
  publicationsPerFteYear: number | null;
  /** Share of the matched members with at least one publication over the range (null without any). */
  publishingShare: number | null;
  /** Members not matched to any author (excluded from `publishingShare`). */
  unmatched: number;
}

export function staffKpis(perMember: MemberPublications[], staff: StaffMember[], rate: PublicationRateResult): StaffKpis {
  const matched = perMember.filter((m) => m.matched);
  const inRate = staff.filter((m) => categoryKeyOf(m) !== 'doctorant' && categoryKeyOf(m) !== 'emeritus');
  const sum = (f: (m: StaffMember) => number) => inRate.reduce((n, m) => n + f(m), 0);
  return {
    headcount: staff.length,
    researchFte: sum((m) => m.researchFte ?? 0),
    estimatedResearchFte: sum((m) => (m.researchFteEstimated ? m.researchFte ?? 0 : 0)),
    withoutResearchFte: inRate.filter((m) => m.researchFte === null || m.researchFte === undefined).length,
    publicationsPerFteYear: rate.overall.rate,
    publishingShare: matched.length ? matched.filter((m) => m.count > 0).length / matched.length : null,
    unmatched: perMember.length - matched.length,
  };
}
