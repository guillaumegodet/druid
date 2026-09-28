// Aggregations of the « Impact et citations » tab — ported from the SoVisu+
// mockups (impactAggregates.ts). Quartile colors are resolved at render
// time from the validated palette (see QuartileChart).

import { AuthorMeta, DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { TEAM_UNKNOWN } from './structureAggregates';

export const QUARTILES = ['Q1', 'Q2', 'Q3', 'Q4'];

export const FWCI_REFERENCE = 1.0;
/** Display bound of the FWCI histogram (the long tail is folded). */
export const FWCI_CAP = 8;
export const FWCI_BIN_WIDTH = 0.5;

export interface ImpactKpis {
  total: number;
  nbFwci: number;
  pctFwci: number | null;
  nbTop10: number;
  pctTop10: number | null;
  nbTop1: number;
  pctTop1: number | null;
  fwciMean: number | null;
}

export interface ImpactAggregates {
  kpis: ImpactKpis;
  quartiles: { key: string; count: number }[];
  quartileKnown: number;
  topByYear: { year: number; top1: number; top10Only: number }[];
  fwciHistogram: { label: string; count: number }[];
}

function inYear(p: DashboardPublication, r: YearRange): boolean {
  return typeof p.year === 'number' && p.year >= r.start && p.year <= r.end;
}

export function aggregateImpact(
  pubs: DashboardPublication[],
  range: YearRange,
): ImpactAggregates {
  const inRange = pubs.filter((p) => inYear(p, range));
  const total = inRange.length;

  const fwciVals = inRange
    .map((p) => p.fwci)
    .filter((v): v is number => typeof v === 'number');
  const nbFwci = fwciVals.length;
  const nbTop10 = inRange.filter((p) => p.isTop10Percent === true).length;
  const nbTop1 = inRange.filter((p) => p.isTop1Percent === true).length;
  const fwciMean = nbFwci > 0 ? fwciVals.reduce((s, v) => s + v, 0) / nbFwci : null;

  const kpis: ImpactKpis = {
    total,
    nbFwci,
    pctFwci: total > 0 ? Math.round((nbFwci / total) * 100) : null,
    nbTop10,
    pctTop10: nbFwci > 0 ? Math.round((nbTop10 / nbFwci) * 100) : null,
    nbTop1,
    pctTop1: nbFwci > 0 ? Math.round((nbTop1 / nbFwci) * 100) : null,
    fwciMean,
  };

  // ── Scimago quartiles (excluding unknown)
  const qMap = new Map<string, number>();
  for (const p of inRange) {
    if (p.sjrQuartile && QUARTILES.includes(p.sjrQuartile)) {
      qMap.set(p.sjrQuartile, (qMap.get(p.sjrQuartile) ?? 0) + 1);
    }
  }
  const quartiles = QUARTILES.map((q) => ({ key: q, count: qMap.get(q) ?? 0 }));
  const quartileKnown = quartiles.reduce((s, q) => s + q.count, 0);

  // ── Top 1 % / Top 10 % (excluding top 1 %) per year
  const tyMap = new Map<number, { top1: number; top10: number }>();
  for (const p of inRange) {
    if (typeof p.year !== 'number') continue;
    const cur = tyMap.get(p.year) ?? { top1: 0, top10: 0 };
    if (p.isTop10Percent === true) cur.top10 += 1;
    if (p.isTop1Percent === true) cur.top1 += 1;
    tyMap.set(p.year, cur);
  }
  const topByYear = Array.from(tyMap.entries())
    .map(([year, v]) => ({ year, top1: v.top1, top10Only: Math.max(0, v.top10 - v.top1) }))
    .sort((a, b) => a.year - b.year);

  // ── FWCI histogram (folded at FWCI_CAP)
  const nBins = Math.round(FWCI_CAP / FWCI_BIN_WIDTH);
  const bins = new Array(nBins + 1).fill(0); // last bin = ">= cap"
  for (const v of fwciVals) {
    if (v >= FWCI_CAP) {
      bins[nBins] += 1;
    } else {
      bins[Math.floor(v / FWCI_BIN_WIDTH)] += 1;
    }
  }
  const fwciHistogram = bins.map((count: number, i: number) => {
    if (i === nBins) return { label: `≥ ${FWCI_CAP}`, count };
    const lo = i * FWCI_BIN_WIDTH;
    return { label: lo.toFixed(1), count };
  });

  return { kpis, quartiles, quartileKnown, topByYear, fwciHistogram };
}

// ── Impact per grouping (sub-structure / team / researcher) ──────────────────

export interface ImpactGroupRow {
  group: string;
  fwciMean: number;
  top1: number;
  top10Only: number;
  n: number; // publications with a known FWCI in the group
}

/**
 * Mean FWCI and Top 1 %/10 % per group. `groupsOf` returns the groups of a
 * publication (sub-structures, teams or authors); only publications with a
 * known FWCI are considered, as in the Streamlit.
 */
export function aggregateImpactByGroup(
  pubs: DashboardPublication[],
  range: YearRange,
  groupsOf: (p: DashboardPublication) => string[],
  top: number | null = null,
): ImpactGroupRow[] {
  const inRange = pubs.filter(
    (p) =>
      typeof p.year === 'number' &&
      p.year >= range.start &&
      p.year <= range.end &&
      typeof p.fwci === 'number',
  );

  const acc = new Map<string, { sum: number; n: number; top1: number; top10: number }>();
  for (const p of inRange) {
    for (const g of new Set(groupsOf(p).filter(Boolean))) {
      const cur = acc.get(g) ?? { sum: 0, n: 0, top1: 0, top10: 0 };
      cur.sum += p.fwci as number;
      cur.n += 1;
      if (p.isTop1Percent === true) cur.top1 += 1;
      if (p.isTop10Percent === true) cur.top10 += 1;
      acc.set(g, cur);
    }
  }

  let rows = Array.from(acc.entries()).map(([group, v]) => ({
    group,
    fwciMean: Math.round((v.sum / v.n) * 100) / 100,
    top1: v.top1,
    top10Only: Math.max(0, v.top10 - v.top1),
    n: v.n,
  }));
  if (top != null && rows.length > top) {
    // top N by mean FWCI (the tops chart re-sorts on its own side)
    rows = rows.sort((a, b) => b.fwciMean - a.fwciMean).slice(0, top);
  }
  return rows;
}

/** Grouping of the « Impact par équipe ou chercheur » section. */
export type ImpactGrouping = 'sousStructure' | 'team' | 'researcher';

/** Number of researchers kept by the « par chercheur » grouping (best mean FWCI). */
export const IMPACT_RESEARCHER_TOP = 30;

/** Rows of the « Impact par équipe ou chercheur » charts for one grouping (tab and registry). */
export function impactRowsByGrouping(
  pubs: DashboardPublication[],
  authors: AuthorMeta[],
  range: YearRange,
  grouping: ImpactGrouping,
): ImpactGroupRow[] {
  if (grouping === 'sousStructure') return aggregateImpactByGroup(pubs, range, (p) => p.sousStructures);
  if (grouping === 'team') {
    return aggregateImpactByGroup(pubs, range, (p) => p.teams.filter((tm) => tm && tm !== TEAM_UNKNOWN));
  }
  return aggregateImpactByGroup(pubs, range, researcherGroupsOf(authors), IMPACT_RESEARCHER_TOP);
}

/** « chercheur » (researcher) groups: labels of the internal authors of a publication. */
export function researcherGroupsOf(authors: AuthorMeta[]): (p: DashboardPublication) => string[] {
  const byId = new Map(authors.map((a) => [a.id, a.label]));
  return (p) => p.authorIds.map((id) => byId.get(id)).filter((l): l is string => !!l);
}

// ── Table of the most cited publications ─────────────────────────────────────

export interface TopPublicationRow {
  year: number | null;
  title: string | null;
  doi: string | null;
  authors: string;
  journal: string | null;
  fwci: number | null;
  citedByCount: number;
  teams: string;
}

export type TopTableKind = 'top1' | 'top10' | 'fwci';

export function topPublicationRows(
  pubs: DashboardPublication[],
  authors: AuthorMeta[],
  range: YearRange,
  kind: TopTableKind,
): TopPublicationRow[] {
  const byId = new Map(authors.map((a) => [a.id, a.label]));
  const inRange = pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );

  let subset: DashboardPublication[];
  if (kind === 'top1') subset = inRange.filter((p) => p.isTop1Percent === true);
  else if (kind === 'top10') subset = inRange.filter((p) => p.isTop10Percent === true);
  else subset = inRange.filter((p) => typeof p.fwci === 'number');

  return subset
    .sort((a, b) => (b.fwci ?? -1) - (a.fwci ?? -1))
    .map((p) => ({
      year: p.year,
      title: p.title,
      doi: p.doi,
      authors: p.authorIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .join(', '),
      journal: p.journal,
      fwci: p.fwci,
      citedByCount: p.citedByCount,
      teams: p.teams.filter((tm) => tm !== 'Non identifié').join(', '),
    }));
}
