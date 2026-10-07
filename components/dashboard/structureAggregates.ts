// Aggregations of the Teams / PhD students / Researchers tabs — ported from the
// SoVisu+ mockups (structureAggregates.ts). Druid adaptations: the
// "real team" filter excludes « Non identifié » (instead of the « Équipe » prefix of
// the demo data), and teams beyond 7 are folded into « Autres »
// (the validated categorical palette has 8 slots and does not cycle).

import { AuthorMeta, DashboardPublication } from './types';
import { CountItem, YearRange } from './overviewAggregates';
import { countsForResearchers } from './editorialEntries';

export const TEAM_UNKNOWN = 'Non identifié';
export const TEAM_OTHER = 'Autres';
const MAX_TEAMS = 7;

export interface StackedByYear {
  keys: string[];
  years: number[];
  series: { name: string; data: number[] }[];
}

export interface StackedByCategory {
  categories: string[]; // e.g. teams
  series: { name: string; data: number[] }[]; // e.g. types
}

function inRangePubs(pubs: DashboardPublication[], range: YearRange): DashboardPublication[] {
  return pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );
}

function teamYears(pubs: DashboardPublication[]): number[] {
  return Array.from(
    new Set(pubs.map((p) => p.year).filter((y): y is number => y != null)),
  ).sort((a, b) => a - b);
}

/** Count per team: a publication counts in each of its teams. */
function tallyTeams(pubs: DashboardPublication[]): CountItem[] {
  const m = new Map<string, number>();
  for (const p of pubs) {
    for (const tm of p.teams) m.set(tm, (m.get(tm) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/** Returns a folding function: team → itself, or « Autres » beyond the top. */
function teamFolder(byTeam: CountItem[]): (tm: string) => string {
  if (byTeam.length <= MAX_TEAMS + 1) return (tm) => tm;
  const kept = new Set(byTeam.slice(0, MAX_TEAMS).map((t) => t.key));
  return (tm) => (kept.has(tm) ? tm : TEAM_OTHER);
}

/** Does a structure have identified teams (effectifs.csv matched)? */
export function hasTeams(pubs: DashboardPublication[]): boolean {
  return pubs.some((p) => p.teams.some((tm) => tm && tm !== TEAM_UNKNOWN));
}

export interface TeamsAggregates {
  byTeam: CountItem[];
  byYear: StackedByYear;
  byType: StackedByCategory;
}

export function aggregateTeams(
  pubs: DashboardPublication[],
  range: YearRange,
): TeamsAggregates {
  const inRange = inRangePubs(pubs, range);
  const rawByTeam = tallyTeams(inRange);
  const fold = teamFolder(rawByTeam);

  const foldedCount = new Map<string, number>();
  for (const t of rawByTeam) {
    const k = fold(t.key);
    foldedCount.set(k, (foldedCount.get(k) ?? 0) + t.count);
  }
  const byTeam = Array.from(foldedCount.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) =>
      a.key === TEAM_OTHER ? 1 : b.key === TEAM_OTHER ? -1 : b.count - a.count,
    );
  const teams = byTeam.map((t) => t.key);
  const years = teamYears(inRange);

  // evolution per team
  const byYearSeries = teams.map((tm) => {
    const counts = new Map<number, number>();
    for (const p of inRange) {
      if (typeof p.year !== 'number') continue;
      if (new Set(p.teams.map(fold)).has(tm)) {
        counts.set(p.year, (counts.get(p.year) ?? 0) + 1);
      }
    }
    return { name: tm, data: years.map((y) => counts.get(y) ?? 0) };
  });

  // types per team
  const typeSet = Array.from(
    new Set(inRange.map((p) => p.pubType).filter((t): t is string => !!t)),
  );
  const byTypeSeries = typeSet.map((type) => ({
    name: type,
    data: teams.map(
      (tm) =>
        inRange.filter((p) => p.pubType === type && new Set(p.teams.map(fold)).has(tm)).length,
    ),
  }));

  return {
    byTeam,
    byYear: { keys: teams, years, series: byYearSeries },
    byType: { categories: teams, series: byTypeSeries },
  };
}

export interface RadarAggregates {
  indicators: { name: string; max: number }[];
  series: { name: string; data: number[] }[];
}

export type TeamRadarLevel = 'subfield' | 'topic';

export interface TeamRadarOptions {
  topSubfields?: number;
  maxSeries?: number;
  /** OpenAlex level of the axes in automatic mode (default: subfield). */
  level?: TeamRadarLevel;
  /**
   * Subjects (OpenAlex subfields and/or topics) chosen explicitly —
   * via the AI thematic search (POST /api/collab-theme/select-topics,
   * same principle as the thematic analysis of the Collaborations tab) —
   * which become the radar axes instead of the most frequent
   * subfields. `undefined`/not provided = historical automatic behavior;
   * an empty array shows a radar with no axis (no subject retained).
   */
  selectedKeys?: string[];
}

/**
 * Disciplinary profile per team: share (%) of each team's publications
 * over a set of axes — by default the main OpenAlex subfields,
 * or the subjects (subfields/topics) retained by AI thematic search
 * (`selectedKeys`). Identified teams only, limited to the most
 * productive ones for the radar's readability.
 */
export function aggregateTeamRadar(
  pubs: DashboardPublication[],
  range: YearRange,
  opts: TeamRadarOptions = {},
): RadarAggregates {
  const { topSubfields = 8, maxSeries = 6, level = 'subfield', selectedKeys } = opts;
  const keysOf = (p: DashboardPublication) => (level === 'topic' ? p.topics : p.subfields);
  const matchesKey = (p: DashboardPublication, key: string) => keysOf(p).includes(key);

  const inRange = inRangePubs(pubs, range).filter(
    (p) => p.subfields.length || p.topics.length,
  );
  const teams = tallyTeams(inRange)
    .map((t) => t.key)
    .filter((tm) => tm !== TEAM_UNKNOWN)
    .slice(0, maxSeries);

  let axes: string[];
  if (selectedKeys) {
    // AI thematic selection: axes imposed by the user.
    axes = selectedKeys.slice(0, Math.max(topSubfields, 12));
  } else {
    // Automatic: most frequent subjects of the chosen level (all teams combined).
    const sfCount = new Map<string, number>();
    for (const p of inRange) {
      for (const sf of new Set(keysOf(p))) {
        sfCount.set(sf, (sfCount.get(sf) ?? 0) + 1);
      }
    }
    axes = Array.from(sfCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topSubfields)
      .map(([name]) => name);
  }

  const series = teams.map((tm) => {
    const teamPubs = inRange.filter((p) => p.teams.includes(tm));
    const data = axes.map((key) => {
      const n = teamPubs.filter((p) => matchesKey(p, key)).length;
      return teamPubs.length ? Math.round((n / teamPubs.length) * 1000) / 10 : 0;
    });
    return { name: tm, data };
  });

  // max per axis (rounded up to the next ten, floor at 10)
  const indicators = axes.map((name, i) => {
    const maxShare = Math.max(0, ...series.map((s) => s.data[i]));
    return { name, max: Math.max(10, Math.ceil(maxShare / 10) * 10) };
  });

  return { indicators, series };
}

export interface ResearcherItem {
  label: string;
  count: number;
  teams: string[];
  /** Internal author id — allows cross-referencing with members (type, employer). */
  id?: number;
}

export function aggregateResearchers(
  pubs: DashboardPublication[],
  authors: AuthorMeta[],
  range: YearRange,
  top = 20,
): ResearcherItem[] {
  const inRange = inRangePubs(pubs, range);
  const byId = new Map<number, number>();
  for (const p of inRange.filter(countsForResearchers)) {
    for (const id of p.authorIds) byId.set(id, (byId.get(id) ?? 0) + 1);
  }
  const meta = new Map(authors.map((a) => [a.id, a]));
  return Array.from(byId.entries())
    .map(([id, count]) => ({
      id,
      label: meta.get(id)?.label ?? `#${id}`,
      teams: meta.get(id)?.teams ?? [],
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

export interface PhdAggregates {
  byTeam: CountItem[];
  byYear: StackedByYear;
  byDoctorant: ResearcherItem[];
  totalPhdPubs: number;
}

export function aggregatePhd(
  pubs: DashboardPublication[],
  authors: AuthorMeta[],
  range: YearRange,
): PhdAggregates {
  const inRange = inRangePubs(pubs, range);
  const phdPubs = inRange.filter((p) => p.hasPhd);
  const rawByTeam = tallyTeams(phdPubs);
  const fold = teamFolder(rawByTeam);

  const foldedCount = new Map<string, number>();
  for (const t of rawByTeam) {
    const k = fold(t.key);
    foldedCount.set(k, (foldedCount.get(k) ?? 0) + t.count);
  }
  const byTeam = Array.from(foldedCount.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) =>
      a.key === TEAM_OTHER ? 1 : b.key === TEAM_OTHER ? -1 : b.count - a.count,
    );
  const teams = byTeam.map((t) => t.key);
  const years = teamYears(phdPubs);

  const series = teams.map((tm) => {
    const counts = new Map<number, number>();
    for (const p of phdPubs) {
      if (typeof p.year !== 'number') continue;
      if (new Set(p.teams.map(fold)).has(tm)) {
        counts.set(p.year, (counts.get(p.year) ?? 0) + 1);
      }
    }
    return { name: tm, data: years.map((y) => counts.get(y) ?? 0) };
  });

  const phdIds = new Set(authors.filter((a) => a.isPhd).map((a) => a.id));
  const meta = new Map(authors.map((a) => [a.id, a]));
  const byId = new Map<number, number>();
  for (const p of inRange.filter(countsForResearchers)) {
    for (const id of p.authorIds) {
      if (phdIds.has(id)) byId.set(id, (byId.get(id) ?? 0) + 1);
    }
  }
  const byDoctorant = Array.from(byId.entries())
    .map(([id, count]) => ({
      id,
      label: meta.get(id)?.label ?? `#${id}`,
      teams: meta.get(id)?.teams ?? [],
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    byTeam,
    byYear: { keys: teams, years, series },
    byDoctorant,
    totalPhdPubs: phdPubs.length,
  };
}
