import { describe, expect, it } from 'vitest';
import { SDG_TOP_SERIES, aggregateSdgs } from '../../components/dashboard/sdgAggregates';
import { sdgOfLabel, sdgsOf } from '../../components/dashboard/sdg';
import type { DashboardPublication } from '../../components/dashboard/types';

const pub = (
  year: number,
  sdgs: number[] | undefined,
  extra: Partial<DashboardPublication> = {},
) =>
  ({
    year,
    sdgs: sdgs?.map((id) => ({ id, score: 0.5 })),
    teams: ['T1'],
    sousStructures: [],
    oaStatus: 'closed',
    fwci: null,
    isTop10Percent: null,
    isInternational: false,
    ...extra,
  } as unknown as DashboardPublication);

describe('aggregateSdgs', () => {
  const pubs = [
    pub(2024, [3, 14], { oaStatus: 'gold', fwci: 2, isTop10Percent: true, isInternational: true }),
    pub(2024, [3], { teams: ['T2'] }),
    pub(2023, [14], { fwci: 1 }),
    pub(2023, undefined),
    pub(2023, []),
    pub(2019, [1]),   // out of range
  ];
  const agg = aggregateSdgs(pubs, { start: 2020, end: 2026 });

  it('counts a publication in each of its goals and the tagged ones once', () => {
    expect(agg.total).toBe(5);
    expect(agg.tagged).toBe(3);
    expect(agg.pctTagged).toBe(60);
    expect(agg.goals).toEqual([3, 14]);
    expect(agg.byGoal).toEqual([
      { id: 3, count: 2, pctTagged: 66.7, pctTotal: 40 },
      { id: 14, count: 2, pctTagged: 66.7, pctTotal: 40 },
    ]);
    expect(agg.covered).toBe(2);
    expect(agg.top?.id).toBe(3);
    expect(agg.meanPerTagged).toBe(1.3);
  });

  it('builds the yearly series, the coverage per year and the goals × teams', () => {
    expect(agg.byYear.years).toEqual([2023, 2024]);
    expect(agg.seriesGoals).toEqual([3, 14]);
    expect(agg.byYear.series.map((s) => s.data)).toEqual([[0, 2], [1, 1]]);
    expect(agg.taggedByYear).toEqual([
      { year: 2023, tagged: 1, total: 3, pct: 33.3 },
      { year: 2024, tagged: 2, total: 2, pct: 100 },
    ]);
    expect(agg.groupKind).toBe('team');
    expect(agg.byGroup.categories).toEqual(['T1', 'T2']);
    expect(agg.byGroup.series.map((s) => s.data)).toEqual([[1, 1], [2, 0]]);
    expect(sdgOfLabel(agg.byGroup.series[1].name)).toBe(14);
  });

  it('computes the impact per goal with the Impact tab rules', () => {
    const g3 = agg.impact.find((r) => r.id === 3)!;
    expect(g3).toEqual({ id: 3, count: 2, pctOpen: 50, fwciMean: 2, pctTop10: 100, pctInternational: 50 });
    const g14 = agg.impact.find((r) => r.id === 14)!;
    expect(g14.fwciMean).toBe(1.5);
    expect(g14.pctTop10).toBe(50);
  });

  it('leaves out the excluded goals (« excluding SDG 3 ») and prefers labs on a composite structure', () => {
    const noHealth = aggregateSdgs(pubs, { start: 2020, end: 2026 }, { exclude: [3] });
    expect(noHealth.goals).toEqual([14]);
    expect(noHealth.tagged).toBe(2);
    const composite = aggregateSdgs(
      [pub(2024, [3], { sousStructures: ['LAB-A'] }), pub(2024, [3, 7], { sousStructures: ['LAB-B', 'LAB-A'] })],
      { start: 2020, end: 2026 },
    );
    expect(composite.groupKind).toBe('sousStructure');
    expect(composite.byGroup.categories).toEqual(['LAB-A', 'LAB-B']);
    expect(composite.byGroup.series.map((s) => s.data)).toEqual([[2, 1], [1, 1]]);
  });

  it('folds the goals beyond the top series into « Other SDGs »', () => {
    const many = Array.from({ length: SDG_TOP_SERIES + 2 }, (_, i) => pub(2024, [i + 1]));
    const a = aggregateSdgs(many, { start: 2020, end: 2026 });
    expect(a.seriesGoals).toHaveLength(SDG_TOP_SERIES + 1);
    expect(a.seriesGoals[SDG_TOP_SERIES]).toBeNull();
    expect(a.byYear.series[SDG_TOP_SERIES].data).toEqual([2]);
  });

  it('reads the goals of a publication, empty for older exports', () => {
    expect(sdgsOf(pub(2024, [14, 3]))).toEqual([14, 3]);
    expect(sdgsOf(pub(2024, undefined))).toEqual([]);
  });
});
