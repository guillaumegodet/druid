// Aggregations of the « Sustainable Development Goals » tab (SdgTab.tsx, druid-internal
// docs/plan-odd-sdg.md, lot 1), recomputed client-side on dashboard.json. A publication counts in
// each of its goals (decision D2: the sums exceed the number of tagged publications); the key
// figures speak of « publications with at least one goal ».
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { hasSubStructures } from './collabAggregates';
import { YearRange } from './overviewAggregates';
import { SDGS, sdgShortLabel, sdgsOf } from './sdg';
import { StackedByCategory, StackedByYear, TEAM_UNKNOWN } from './structureAggregates';
import { DashboardPublication } from './types';

/** Goals kept as their own series in the yearly evolution; the rest is folded into « Other SDGs ». */
export const SDG_TOP_SERIES = 6;

export interface SdgOptions {
  /** Goals left out of every count (decision D5: « excluding SDG 3 » toggle). */
  exclude?: number[];
}

export interface SdgGoalRow {
  id: number;
  count: number;
  /** Share of the tagged publications (percent, one decimal). */
  pctTagged: number;
  /** Share of the whole corpus in range (percent, one decimal). */
  pctTotal: number;
}

export interface SdgImpactRow {
  id: number;
  count: number;
  pctOpen: number | null;
  fwciMean: number | null;
  /** Among the publications with a FWCI (same rule as the Impact tab). */
  pctTop10: number | null;
  pctInternational: number | null;
}

export interface SdgAggregates {
  total: number;
  /** Publications with at least one (kept) goal. */
  tagged: number;
  pctTagged: number | null;
  /** Goals with at least one publication. */
  covered: number;
  top: SdgGoalRow | null;
  /** Mean number of goals per tagged publication. */
  meanPerTagged: number | null;
  /** Goals present, official order. */
  goals: number[];
  byGoal: SdgGoalRow[];
  /** Series = top goals (by volume) then « Other SDGs »; `seriesGoals` gives the goal of each series (null = other). */
  byYear: StackedByYear;
  seriesGoals: (number | null)[];
  /** Share of tagged publications per year (stability of the tagging over time). */
  taggedByYear: { year: number; tagged: number; total: number; pct: number }[];
  /** Goals × member labs (composite structure) or teams; series = goals present (official order). */
  byGroup: StackedByCategory;
  groupKind: 'sousStructure' | 'team';
  impact: SdgImpactRow[];
}

const OA_OPEN = new Set(['gold', 'diamond', 'hybrid', 'green', 'bronze']);
const pct1 = (n: number, d: number): number => (d ? Math.round((1000 * n) / d) / 10 : 0);
const pct0 = (n: number, d: number): number | null => (d ? Math.round((100 * n) / d) : null);

export const otherSdgsLabel = (): string => i18n._(msg`Other SDGs`);

export function aggregateSdgs(
  pubs: DashboardPublication[],
  range: YearRange,
  options: SdgOptions = {},
): SdgAggregates {
  const excluded = new Set(options.exclude ?? []);
  const inRange = pubs.filter((p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end);
  const goalsOf = (p: DashboardPublication) => sdgsOf(p).filter((g) => !excluded.has(g));
  const total = inRange.length;

  const counts = new Map<number, number>();
  let tagged = 0;
  let tags = 0;
  for (const p of inRange) {
    const goals = goalsOf(p);
    if (goals.length === 0) continue;
    tagged += 1;
    tags += goals.length;
    for (const g of goals) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const byGoal: SdgGoalRow[] = SDGS
    .filter((g) => (counts.get(g.id) ?? 0) > 0)
    .map((g) => ({
      id: g.id,
      count: counts.get(g.id)!,
      pctTagged: pct1(counts.get(g.id)!, tagged),
      pctTotal: pct1(counts.get(g.id)!, total),
    }));
  const goals = byGoal.map((r) => r.id);
  const top = byGoal.reduce<SdgGoalRow | null>((best, r) => (best == null || r.count > best.count ? r : best), null);

  // ── Yearly evolution: top goals as series, the rest folded.
  const years = Array.from(new Set(inRange.map((p) => p.year as number))).sort((a, b) => a - b);
  const ranked = [...byGoal].sort((a, b) => b.count - a.count || a.id - b.id).map((r) => r.id);
  const topGoals = ranked.slice(0, SDG_TOP_SERIES);
  const folded = new Set(ranked.slice(SDG_TOP_SERIES));
  const seriesGoals: (number | null)[] = [...topGoals, ...(folded.size ? [null] : [])];
  const perSeriesYear = seriesGoals.map(() => new Map<number, number>());
  for (const p of inRange) {
    for (const g of goalsOf(p)) {
      const idx = folded.has(g) ? seriesGoals.length - 1 : topGoals.indexOf(g);
      if (idx < 0) continue;
      const m = perSeriesYear[idx];
      m.set(p.year as number, (m.get(p.year as number) ?? 0) + 1);
    }
  }
  const byYear: StackedByYear = {
    keys: seriesGoals.map((g) => (g == null ? otherSdgsLabel() : sdgShortLabel(g))),
    years,
    series: seriesGoals.map((g, i) => ({
      name: g == null ? otherSdgsLabel() : sdgShortLabel(g),
      data: years.map((y) => perSeriesYear[i].get(y) ?? 0),
    })),
  };
  const taggedByYear = years.map((year) => {
    const ofYear = inRange.filter((p) => p.year === year);
    const t = ofYear.filter((p) => goalsOf(p).length > 0).length;
    return { year, tagged: t, total: ofYear.length, pct: pct1(t, ofYear.length) };
  });

  // ── Goals × labs (composite) or teams.
  const groupKind: SdgAggregates['groupKind'] = hasSubStructures(inRange) ? 'sousStructure' : 'team';
  const groupsOf = (p: DashboardPublication) =>
    new Set((groupKind === 'sousStructure' ? p.sousStructures : p.teams).filter(Boolean));
  const groupCounts = new Map<string, number>();
  for (const p of inRange) {
    if (goalsOf(p).length === 0) continue;
    for (const g of groupsOf(p)) groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
  }
  const categories = [...groupCounts.keys()].sort(
    (a, b) => (a === TEAM_UNKNOWN ? 1 : 0) - (b === TEAM_UNKNOWN ? 1 : 0) || groupCounts.get(b)! - groupCounts.get(a)! || a.localeCompare(b),
  );
  const cell = new Map<string, number>();
  for (const p of inRange) {
    const pg = goalsOf(p);
    if (pg.length === 0) continue;
    for (const grp of groupsOf(p)) for (const g of pg) cell.set(`${grp}\u0000${g}`, (cell.get(`${grp}\u0000${g}`) ?? 0) + 1);
  }
  const byGroup: StackedByCategory = {
    categories,
    series: goals.map((g) => ({ name: sdgShortLabel(g), data: categories.map((c) => cell.get(`${c}\u0000${g}`) ?? 0) })),
  };

  // ── Impact per goal (same rules as impactAggregates: FWCI mean on the known values, top 10 % among them).
  const impact: SdgImpactRow[] = goals.map((g) => {
    const of = inRange.filter((p) => goalsOf(p).includes(g));
    const fwci = of.map((p) => p.fwci).filter((v): v is number => typeof v === 'number');
    const intlKnown = of.filter((p) => p.isInternational != null);
    return {
      id: g,
      count: of.length,
      pctOpen: pct0(of.filter((p) => OA_OPEN.has(p.oaStatus ?? '')).length, of.length),
      fwciMean: fwci.length ? Math.round((100 * fwci.reduce((s, v) => s + v, 0)) / fwci.length) / 100 : null,
      pctTop10: pct0(of.filter((p) => p.isTop10Percent === true).length, fwci.length),
      pctInternational: pct0(intlKnown.filter((p) => p.isInternational === true).length, intlKnown.length),
    };
  });

  return {
    total,
    tagged,
    pctTagged: total ? pct1(tagged, total) : null,
    covered: goals.length,
    top,
    meanPerTagged: tagged ? Math.round((10 * tags) / tagged) / 10 : null,
    goals,
    byGoal,
    byYear,
    seriesGoals,
    taggedByYear,
    byGroup,
    groupKind,
    impact,
  };
}
