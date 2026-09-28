// Aggregations of the « Collaborations » tab — full port of the
// _tab_collaborations of the old Streamlit dashboard of druid-biblio (removed on 2026-09-10, see git history): exclusive typology, then
// sub-tabs intra-structure (≥ 2 signing sub-structures), other `Nantes Université`
// labs (nantes_partners), national (geolocated national_partners)
// — the international side remaining covered by internationalAggregates.

import { AuthorMeta, DashboardPublication } from './types';
import { CountItem, YearRange } from './overviewAggregates';
import { StackedByYear } from './structureAggregates';
import { FlowNode, FlowLink } from './internationalAggregates';

function inRangePubs(pubs: DashboardPublication[], range: YearRange): DashboardPublication[] {
  return pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );
}

// ── Exclusive typology (same priority order as the Streamlit) ─────────────────

/** [raw collab_type value, displayed label] — from broadest to most local. */
export const COLLAB_EXCLUSIVE: [string, string][] = [
  ['Internationales', 'Internationales'],
  ['Nationales (hors Nantes Université)', 'Nationales (hors NU)'],
  ["Avec d'autres labos de Nantes Université", 'Autre labo Nantes Université'],
  ['Entre labos de la structure', 'Entre labos de la structure'],
  ['Pas de collaboration', 'Pas de collaboration'],
];

/** Exclusive (broadest) category of a multi-labeled publication. */
export function collabExclusiveCat(collabTypes: string[]): string {
  const joined = collabTypes.join('|');
  for (const [raw, label] of COLLAB_EXCLUSIVE) {
    if (joined.includes(raw)) return label;
  }
  return COLLAB_EXCLUSIVE[COLLAB_EXCLUSIVE.length - 1][1];
}

export interface CollabTypologyAggregates {
  byCategory: CountItem[]; // COLLAB_EXCLUSIVE order
  byYear: StackedByYear;
  total: number;
  typed: number; // publications with collab_type filled in
}

export function aggregateCollabTypology(
  pubs: DashboardPublication[],
  range: YearRange,
): CollabTypologyAggregates {
  const inRange = inRangePubs(pubs, range);
  const typedPubs = inRange.filter((p) => p.collabTypes.length > 0);
  const labels = COLLAB_EXCLUSIVE.map(([, label]) => label);

  const counts = new Map<string, number>();
  for (const p of typedPubs) {
    const cat = collabExclusiveCat(p.collabTypes);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const byCategory = labels
    .map((key) => ({ key, count: counts.get(key) ?? 0 }))
    .filter((c) => c.count > 0);

  const years = Array.from(
    new Set(typedPubs.map((p) => p.year).filter((y): y is number => y != null)),
  ).sort((a, b) => a - b);
  const series = byCategory.map(({ key }) => {
    const perYear = new Map<number, number>();
    for (const p of typedPubs) {
      if (typeof p.year === 'number' && collabExclusiveCat(p.collabTypes) === key) {
        perYear.set(p.year, (perYear.get(p.year) ?? 0) + 1);
      }
    }
    return { name: key, data: years.map((y) => perYear.get(y) ?? 0) };
  });

  return {
    byCategory,
    byYear: { keys: byCategory.map((c) => c.key), years, series },
    total: inRange.length,
    typed: typedPubs.length,
  };
}

// ── Internal collaborations (intra-structure / other NU labs) ─────────────────

export interface InternalCollabAggregates {
  total: number; // publications concerned
  topLabs: CountItem[];
  byYear: { year: number; count: number }[];
  domains: CountItem[];
  topSubfields: CountItem[];
  topTopics: CountItem[];
  sankey: { nodes: FlowNode[]; links: FlowLink[] };
}

/**
 * Aggregates shared by the internal sub-tabs. `labsOf` extracts the co-signing
 * labs of a publication (internal sub-structures, or NU labs).
 */
export function aggregateInternalCollab(
  pubs: DashboardPublication[],
  range: YearRange,
  labsOf: (p: DashboardPublication) => string[],
  topLabsN = 20,
  sankeyLabsN = 10,
  sankeyThemesN = 12,
): InternalCollabAggregates {
  const concerned = inRangePubs(pubs, range)
    .map((p) => ({ p, labs: Array.from(new Set(labsOf(p).filter(Boolean))) }))
    .filter(({ labs }) => labs.length > 0);

  const labCount = new Map<string, number>();
  const yearCount = new Map<number, number>();
  const domCount = new Map<string, number>();
  const sfCount = new Map<string, number>();
  const tpCount = new Map<string, number>();

  for (const { p, labs } of concerned) {
    for (const lab of labs) labCount.set(lab, (labCount.get(lab) ?? 0) + 1);
    if (typeof p.year === 'number') yearCount.set(p.year, (yearCount.get(p.year) ?? 0) + 1);
    for (const d of new Set(p.domains)) domCount.set(d, (domCount.get(d) ?? 0) + 1);
    for (const s of new Set(p.subfields)) sfCount.set(s, (sfCount.get(s) ?? 0) + 1);
    for (const t of new Set(p.topics)) tpCount.set(t, (tpCount.get(t) ?? 0) + 1);
  }

  const toSorted = (m: Map<string, number>, n?: number) =>
    Array.from(m.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n ?? Infinity);

  const topLabs = toSorted(labCount, topLabsN);
  const byYear = Array.from(yearCount.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  // Sankey lab → subfield (top labs × top themes)
  const sankeyLabs = new Set(toSorted(labCount, sankeyLabsN).map((l) => l.key));
  const sankeyThemes = new Set(toSorted(sfCount, sankeyThemesN).map((s) => s.key));
  const linkCount = new Map<string, number>();
  for (const { p, labs } of concerned) {
    const themes = Array.from(new Set(p.subfields)).filter((s) => sankeyThemes.has(s));
    for (const lab of labs) {
      if (!sankeyLabs.has(lab)) continue;
      for (const th of themes) {
        const key = `${lab}|||${th}`;
        linkCount.set(key, (linkCount.get(key) ?? 0) + 1);
      }
    }
  }
  const usedLabs = new Set<string>();
  const usedThemes = new Set<string>();
  const links: FlowLink[] = Array.from(linkCount.entries()).map(([k, value]) => {
    const [source, target] = k.split('|||');
    usedLabs.add(source);
    usedThemes.add(target);
    return { source, target, value };
  });
  const nodes: FlowNode[] = [
    ...Array.from(usedLabs).map((name) => ({ name, depth: 0 })),
    ...Array.from(usedThemes).map((name) => ({ name, depth: 1 })),
  ];

  return {
    total: concerned.length,
    topLabs,
    byYear,
    domains: toSorted(domCount),
    topSubfields: toSorted(sfCount, 12),
    topTopics: toSorted(tpCount, 15),
    sankey: { nodes, links },
  };
}

/** Co-signing internal sub-structures (≥ 2 to count as a collaboration). */
export function internalLabsOf(p: DashboardPublication): string[] {
  const labs = Array.from(new Set(p.sousStructures.filter(Boolean)));
  return labs.length > 1 ? labs : [];
}

/** Is a structure composite (sub-structures filled in)? */
export function hasSubStructures(pubs: DashboardPublication[]): boolean {
  return pubs.some((p) => p.sousStructures.length > 0);
}

/**
 * Internal units of a publication, whatever the kind of dashboard (plan-mes-rapports lot 7):
 * - composite structure: its member labs (sousStructures);
 * - lab: its teams;
 * - institution (univ-nantes): neither is filled on the publications — the labs come from the
 *   authors (AuthorMeta.teams = labs of the author in an institution export, lot 0 of
 *   docs/archive/plan-collab-consortium.md).
 * `kind` says how to call them ('labs' or 'teams'); null when nothing is known.
 */
export function unitsOfDataset(dataset: { publications: DashboardPublication[]; authors: AuthorMeta[] }): {
  kind: 'labs' | 'teams' | null;
  of: (p: DashboardPublication) => string[];
} {
  const known = (xs: string[]) => Array.from(new Set(xs.filter((x) => x && x !== TEAM_UNKNOWN)));
  if (hasSubStructures(dataset.publications)) return { kind: 'labs', of: (p) => known(p.sousStructures) };
  if (dataset.publications.some((p) => known(p.teams).length > 0)) return { kind: 'teams', of: (p) => known(p.teams) };
  const teamsById = new Map(dataset.authors.map((a) => [a.id, a.teams]));
  if (!dataset.authors.some((a) => known(a.teams).length > 0)) return { kind: null, of: () => [] };
  return { kind: 'labs', of: (p) => known(p.authorIds.flatMap((id) => teamsById.get(id) ?? [])) };
}

// ── National collaborations (French institutions outside NU) ──────────────────

export interface NationalCollabAggregates {
  total: number;
  topInstitutions: CountItem[];
  byYear: { year: number; count: number }[];
  mapPoints: { name: string; city: string | null; lat: number; lon: number; value: number }[];
}

export function aggregateNationalCollab(
  pubs: DashboardPublication[],
  range: YearRange,
  topN = 20,
): NationalCollabAggregates {
  const inRange = inRangePubs(pubs, range).filter((p) => p.nationalPartners.length > 0);

  const instCount = new Map<string, { count: number; city: string | null; lat: number | null; lon: number | null }>();
  const yearCount = new Map<number, number>();
  for (const p of inRange) {
    if (typeof p.year === 'number') yearCount.set(p.year, (yearCount.get(p.year) ?? 0) + 1);
    const seen = new Set<string>();
    for (const inst of p.nationalPartners) {
      if (!inst.name || seen.has(inst.name)) continue;
      seen.add(inst.name);
      const cur = instCount.get(inst.name) ?? {
        count: 0,
        city: inst.city,
        lat: inst.lat,
        lon: inst.lon,
      };
      cur.count += 1;
      instCount.set(inst.name, cur);
    }
  }

  const sorted = Array.from(instCount.entries()).sort((a, b) => b[1].count - a[1].count);
  const topInstitutions = sorted.slice(0, topN).map(([key, v]) => ({ key, count: v.count }));
  const byYear = Array.from(yearCount.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);
  const mapPoints = sorted
    .filter(([, v]) => v.lat != null && v.lon != null)
    .map(([name, v]) => ({ name, city: v.city, lat: v.lat as number, lon: v.lon as number, value: v.count }));

  return { total: inRange.length, topInstitutions, byYear, mapPoints };
}

// ── Catalog of partner institutions (for the picker, phase 2) ─────────────────
// Unlike the Leiden Ranking Open Edition reference dataset used by the
// PeerGroupPicker of the Benchmark tab (2831 large world universities),
// the catalog here is built from the institutions ACTUALLY
// encountered as partners (national or international) in the
// corpus — including organizations that are not universities (hospitals,
// companies…). Built on the full publication history, not on
// the dashboard's year range (like the Leiden reference dataset), so that
// an institution does not vanish from the search depending on the current
// year filter.

export interface PartnerCatalogEntry {
  /** ROR if known (see phase 0), else `<scope>:<name>` (partnerKey) — key expected by buildPartnerMatcher. */
  key: string;
  name: string;
  /** Number of publications where this institution appears as a partner. */
  count: number;
  countryCode?: string | null;
  city?: string | null;
  scope: 'international' | 'national';
}

/**
 * Merge key of an organization: the ROR (stable identifier, role-agnostic) if known;
 * else the name qualified by the scope. Without this qualifier, an organization without ROR cited both
 * as a national AND international partner under the same name (e.g. hospital, ministry) would merge
 * its two counts under a single `scope` depending on encounter order — review lot 8.
 */
export const partnerKey = (o: { name: string; ror?: string | null }, scope: 'international' | 'national'): string =>
  o.ror || `${scope}:${o.name}`;

export function buildPartnerCatalog(pubs: DashboardPublication[]): PartnerCatalogEntry[] {
  const byKey = new Map<string, PartnerCatalogEntry>();
  for (const p of pubs) {
    for (const o of p.partnerInstitutions || []) {
      if (!o.name) continue;
      const key = partnerKey(o, 'international');
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else byKey.set(key, { key, name: o.name, count: 1, countryCode: o.cc, city: o.city, scope: 'international' });
    }
    for (const o of p.nationalPartners || []) {
      if (!o.name) continue;
      const key = partnerKey(o, 'national');
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else byKey.set(key, { key, name: o.name, count: 1, countryCode: null, city: o.city, scope: 'national' });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count);
}

// ── Breakdown per selected partner institution(s) ─────────────────────────────
// Phase 1 of the « sélecteur d'institutions » plan (see work/druid/
// plan-action-collab-picker.md, 2026-09-03): generalization of the logic of
// aggregateInternalCollab (topics/subfields/domains/byYear) to a free
// selection of partner institutions (national and/or international), rather
// than to internal labs only. The picker (phase 2) will provide the predicate via
// buildPartnerMatcher; this function remains usable on its own (tests,
// future uses) with any predicate.

export interface PartnerBilanAggregates {
  total: number;
  byYear: { year: number; count: number }[];
  domains: CountItem[];
  topSubfields: CountItem[];
  topTopics: CountItem[];
  /** `Nantes Université` researchers co-authoring at least one concerned publication. */
  topResearchers: { id: number; label: string; count: number; teams: string[] }[];
  /**
   * Sorted by year desc — feeds the « voir les publications » link (phase 3) and,
   * with subfields/topics/authorNames, the payload of POST /api/collab-theme/synthesize
   * (phase 4 of the AI analysis scenario, 2026-09-03).
   */
  publications: {
    title: string | null;
    year: number | null;
    doi: string | null;
    journal: string | null;
    subfields: string[];
    topics: string[];
    /** Resolved `Nantes Université` researchers (see dataset.authors), deduplicated. */
    authorNames: string[];
  }[];
}

/**
 * Builds a predicate matching the publications having at least one
 * partner (national or international) among `selectedKeys` — ROR
 * preferably (stable, see phase 0), displayed name as fallback for
 * institutions without a known ROR.
 */
export function buildPartnerMatcher(
  selectedKeys: string[],
): (p: DashboardPublication) => boolean {
  const keys = new Set(selectedKeys);
  if (keys.size === 0) return () => false;
  const orgMatches = (o: { name: string; ror?: string | null }, scope: 'international' | 'national') =>
    keys.has(partnerKey(o, scope));
  return (p) =>
    (p.partnerInstitutions || []).some((o) => orgMatches(o, 'international')) ||
    (p.nationalPartners || []).some((o) => orgMatches(o, 'national'));
}

const TEAM_UNKNOWN = 'Non identifié';

/**
 * « Nom (LABO1, LABO2) » label of an internal researcher — the author's teams
 * are their labs for an institution export (see AuthorMeta.teams, lot 0 of
 * docs/archive/plan-collab-consortium.md), their teams for a lab. Without a known
 * affiliation: the name alone, never « (Non identifié) ».
 */
export function researcherLabel(author: Pick<AuthorMeta, 'label' | 'teams'>): string {
  const teams = author.teams.filter((t) => t && t !== TEAM_UNKNOWN);
  return teams.length > 0 ? `${author.label} (${teams.join(', ')})` : author.label;
}

export function aggregatePartnerBilan(
  pubs: DashboardPublication[],
  range: YearRange,
  matches: (p: DashboardPublication) => boolean,
  authors: AuthorMeta[],
  topResearchersN = 20,
): PartnerBilanAggregates {
  const concerned = inRangePubs(pubs, range).filter(matches);

  const yearCount = new Map<number, number>();
  const domCount = new Map<string, number>();
  const sfCount = new Map<string, number>();
  const tpCount = new Map<string, number>();
  const authorCount = new Map<number, number>();

  for (const p of concerned) {
    if (typeof p.year === 'number') yearCount.set(p.year, (yearCount.get(p.year) ?? 0) + 1);
    for (const d of new Set(p.domains)) domCount.set(d, (domCount.get(d) ?? 0) + 1);
    for (const s of new Set(p.subfields)) sfCount.set(s, (sfCount.get(s) ?? 0) + 1);
    for (const t of new Set(p.topics)) tpCount.set(t, (tpCount.get(t) ?? 0) + 1);
    for (const id of new Set(p.authorIds)) authorCount.set(id, (authorCount.get(id) ?? 0) + 1);
  }

  const toSorted = (m: Map<string, number>, n?: number) =>
    Array.from(m.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n ?? Infinity);

  const authorsById = new Map(authors.map((a) => [a.id, a]));
  const topResearchers = Array.from(authorCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topResearchersN)
    .map(([id, count]) => {
      const a = authorsById.get(id);
      return { id, label: a ? researcherLabel(a) : `#${id}`, count, teams: a?.teams ?? [] };
    });

  const byYear = Array.from(yearCount.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  const publications = concerned
    .slice()
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .map((p) => ({
      title: p.title,
      year: p.year,
      doi: p.doi,
      journal: p.journal,
      subfields: p.subfields,
      topics: p.topics,
      authorNames: Array.from(new Set(p.authorIds.map((id) => authorsById.get(id)?.label).filter((l): l is string => !!l))),
    }));

  return {
    total: concerned.length,
    byYear,
    domains: toSorted(domCount),
    topSubfields: toSorted(sfCount, 12),
    topTopics: toSorted(tpCount, 15),
    topResearchers,
    publications,
  };
}

// ── Detail per partner institution (lot 2, docs/archive/plan-collab-consortium.md) ────
// For a selection of several institutions (typically a consortium,
// see consortia.ts), the global breakdown above does not say "with whom": this
// block re-aggregates, institution by institution, the same dimensions as
// aggregatePartnerBilan — internal researchers (« Nom (labo) »), topics (finer
// than the subfields of the global breakdown), publications with DOI — and
// provides the stacked year × institution series for the overview chart.
// NON-exclusive counting: a publication co-signed by two members counts
// for each of them (to be stated in the UI so the sum of the bars is not read as
// a total). `maxAuthors` excludes large collaborations (ALICE/CMS…) via
// DashboardPublication.authorCount (missing from exports predating
// 2026-09-15: without a value, the publication is kept).

export interface PartnerBreakdownPublication {
  title: string | null;
  year: number | null;
  doi: string | null;
  journal: string | null;
  topics: string[];
  authorIds: number[];
  authorCount: number | null;
}

export interface PartnerBreakdownEntry {
  /** PartnerCatalogEntry.key key (ROR or name). */
  key: string;
  name: string;
  total: number;
  byYear: { year: number; count: number }[];
  topResearchers: { id: number; label: string; count: number; teams: string[] }[];
  topTopics: CountItem[];
  topSubfields: CountItem[];
  /** Sorted by year desc, then title. */
  publications: PartnerBreakdownPublication[];
}

export interface PartnerBreakdownAggregates {
  /** One entry per selected key present in the catalog, sorted by total desc. */
  entries: PartnerBreakdownEntry[];
  /** Publications concerned by at least one institution (exclusive counting, = global breakdown). */
  total: number;
  /** Publications excluded by `maxAuthors` (all institutions combined, exclusive). */
  excludedHyperAuthored: number;
  /** Year × institution series (displayed names) for the stacked chart. */
  byYearStacked: StackedByYear;
  /** Selected keys missing from the catalog (no co-publication in the corpus). */
  missingKeys: string[];
}

export interface PartnerBreakdownOptions {
  /** Exclude publications with more than `maxAuthors` authors (undefined = no exclusion). */
  maxAuthors?: number;
  topResearchersN?: number;
  topTopicsN?: number;
  topSubfieldsN?: number;
}

/** True if the publication is a "large collaboration" per the threshold (authorCount known and > threshold). */
export function isHyperAuthored(p: DashboardPublication, maxAuthors: number | undefined): boolean {
  return maxAuthors != null && typeof p.authorCount === 'number' && p.authorCount > maxAuthors;
}

export function aggregatePartnerBreakdown(
  pubs: DashboardPublication[],
  range: YearRange,
  selectedKeys: string[],
  authors: AuthorMeta[],
  catalog: PartnerCatalogEntry[],
  opts: PartnerBreakdownOptions = {},
): PartnerBreakdownAggregates {
  const { maxAuthors, topResearchersN = 15, topTopicsN = 15, topSubfieldsN = 12 } = opts;
  const nameByKey = new Map(catalog.map((c) => [c.key, c.name]));
  const keys = selectedKeys.filter((k) => nameByKey.has(k));
  const missingKeys = selectedKeys.filter((k) => !nameByKey.has(k));
  const keySet = new Set(keys);
  const authorsById = new Map(authors.map((a) => [a.id, a]));

  /** Selected keys present among the publication's partners (deduplicated). */
  const keysOf = (p: DashboardPublication): string[] => {
    const found = new Set<string>();
    // Catalog keys (partnerKey): ROR, else `<scope>:<name>` — the bare name never matched.
    for (const o of p.partnerInstitutions || []) {
      const k = partnerKey(o, 'international');
      if (keySet.has(k)) found.add(k);
    }
    for (const o of p.nationalPartners || []) {
      const k = partnerKey(o, 'national');
      if (keySet.has(k)) found.add(k);
    }
    return Array.from(found);
  };

  interface Acc {
    pubs: DashboardPublication[];
    yearCount: Map<number, number>;
    authorCount: Map<number, number>;
    tpCount: Map<string, number>;
    sfCount: Map<string, number>;
  }
  const acc = new Map<string, Acc>(
    keys.map((k) => [
      k,
      { pubs: [], yearCount: new Map(), authorCount: new Map(), tpCount: new Map(), sfCount: new Map() },
    ]),
  );

  let total = 0;
  let excludedHyperAuthored = 0;
  const years = new Set<number>();
  for (const p of inRangePubs(pubs, range)) {
    const ks = keysOf(p);
    if (ks.length === 0) continue;
    if (isHyperAuthored(p, maxAuthors)) {
      excludedHyperAuthored += 1;
      continue;
    }
    total += 1;
    if (typeof p.year === 'number') years.add(p.year);
    for (const k of ks) {
      const a = acc.get(k)!;
      a.pubs.push(p);
      if (typeof p.year === 'number') a.yearCount.set(p.year, (a.yearCount.get(p.year) ?? 0) + 1);
      for (const id of new Set(p.authorIds)) a.authorCount.set(id, (a.authorCount.get(id) ?? 0) + 1);
      for (const t of new Set(p.topics)) a.tpCount.set(t, (a.tpCount.get(t) ?? 0) + 1);
      for (const sf of new Set(p.subfields)) a.sfCount.set(sf, (a.sfCount.get(sf) ?? 0) + 1);
    }
  }

  const toSorted = (m: Map<string, number>, n: number): CountItem[] =>
    Array.from(m.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, n);

  const entries: PartnerBreakdownEntry[] = keys
    .map((k) => {
      const a = acc.get(k)!;
      return {
        key: k,
        name: nameByKey.get(k) ?? k,
        total: a.pubs.length,
        byYear: Array.from(a.yearCount.entries())
          .map(([year, count]) => ({ year, count }))
          .sort((x, y) => x.year - y.year),
        topResearchers: Array.from(a.authorCount.entries())
          .sort((x, y) => y[1] - x[1])
          .slice(0, topResearchersN)
          .map(([id, count]) => {
            const au = authorsById.get(id);
            return { id, label: au ? researcherLabel(au) : `#${id}`, count, teams: au?.teams ?? [] };
          }),
        topTopics: toSorted(a.tpCount, topTopicsN),
        topSubfields: toSorted(a.sfCount, topSubfieldsN),
        publications: a.pubs
          .slice()
          .sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || (x.title ?? '').localeCompare(y.title ?? ''))
          .map((p) => ({
            title: p.title,
            year: p.year,
            doi: p.doi,
            journal: p.journal,
            topics: p.topics,
            authorIds: p.authorIds,
            authorCount: typeof p.authorCount === 'number' ? p.authorCount : null,
          })),
      };
    })
    .filter((e) => e.total > 0)
    .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));

  const sortedYears = Array.from(years).sort((x, y) => x - y);
  const byYearStacked: StackedByYear = {
    keys: entries.map((e) => e.name),
    years: sortedYears,
    series: entries.map((e) => {
      const perYear = new Map(e.byYear.map((y) => [y.year, y.count]));
      return { name: e.name, data: sortedYears.map((y) => perYear.get(y) ?? 0) };
    }),
  };

  return { entries, total, excludedHyperAuthored, byYearStacked, missingKeys };
}

// ── Thematic predicate (AI analysis, phase 2) ───────────────────────────────
// « analyse IA des thématiques de collaboration » scenario (2026-09-03):
// step 1 on the server side (POST /api/collab-theme/select-topics) picks
// subfields/topics among those actually present in the corpus already
// filtered by institution(s); this predicate re-applies that selection on the
// client side to re-aggregate via aggregatePartnerBilan (ANDed with
// buildPartnerMatcher by the caller — no new aggregation code here,
// aggregatePartnerBilan already accepts an arbitrary predicate). Same mixed
// subfields+topics vocabulary as PubFilters.themeKeys (publicationFilters.ts).

export interface ThemeCandidates {
  domains: string[];
  subfields: string[];
  topics: string[];
}

/**
 * Candidate subfields/topics/domains for step 1 of the AI analysis
 * (POST /api/collab-theme/select-topics) — broader list than the
 * `topSubfields`/`topTopics` of `PartnerBilanAggregates` (limited to 12/15 for
 * chart readability), so as not to exclude upfront a subject that is rare
 * but relevant to the theme being searched. `maxPerDimension`
 * still caps each dimension (the server re-clips anyway to
 * MAX_THEME_TOPICS, see server.cjs).
 */
export function buildThemeCandidates(
  pubs: DashboardPublication[],
  range: YearRange,
  matches: (p: DashboardPublication) => boolean,
  maxPerDimension = 40,
): ThemeCandidates {
  const concerned = inRangePubs(pubs, range).filter(matches);
  const domSet = new Set<string>();
  const sfCount = new Map<string, number>();
  const tpCount = new Map<string, number>();
  for (const p of concerned) {
    for (const d of p.domains) domSet.add(d);
    for (const s of p.subfields) sfCount.set(s, (sfCount.get(s) ?? 0) + 1);
    for (const t of p.topics) tpCount.set(t, (tpCount.get(t) ?? 0) + 1);
  }
  const topKeys = (m: Map<string, number>, n: number) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k);
  return {
    domains: Array.from(domSet),
    subfields: topKeys(sfCount, maxPerDimension),
    topics: topKeys(tpCount, maxPerDimension),
  };
}

export function buildThemeMatcher(themeKeys: string[]): (p: DashboardPublication) => boolean {
  const keys = new Set(themeKeys);
  // Unlike buildPartnerMatcher, an empty selection excludes nothing:
  // the thematic step is optional (a breakdown by institution alone is valid).
  if (keys.size === 0) return () => true;
  return (p) => p.subfields.some((s) => keys.has(s)) || p.topics.some((t) => keys.has(t));
}
