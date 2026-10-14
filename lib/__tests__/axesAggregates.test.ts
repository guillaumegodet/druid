import { describe, expect, it } from 'vitest';
import { AXE_OTHER, aggregateAxes, shareByCategory } from '../../components/dashboard/phase4Aggregates';
import { axeOfPub } from '../../components/dashboard/publicationFilters';
import type { DashboardPublication } from '../../components/dashboard/types';

const pub = (year: number, chosenAxe: string | null, teams: string[], pubType = 'article') =>
  ({ year, chosenAxe, teams, pubType, title: 't', doi: null } as unknown as DashboardPublication);

describe('aggregateAxes byTeam', () => {
  it('crosses the effective axis with the teams, most publications first and « Non identifié » last', () => {
    const pubs = [
      pub(2024, 'A', ['T1']), pub(2024, 'A', ['T1', 'T2']), pub(2023, 'B', ['T2']), pub(2023, null, ['Non identifié']),
      pub(2023, null, ['T2']), pub(2019, 'A', ['T1']),
    ];
    const agg = aggregateAxes(pubs, { start: 2020, end: 2026 }, ['A', 'B'], axeOfPub);
    expect(agg.byTeam.categories).toEqual(['T2', 'T1', 'Non identifié']);
    const series = Object.fromEntries(agg.byTeam.series.map((s) => [s.name, s.data]));
    expect(series.A).toEqual([1, 2, 0]);
    expect(series.B).toEqual([1, 0, 0]);
    expect(series[AXE_OTHER]).toEqual([1, 0, 1]);
    const share = shareByCategory(agg.byTeam);
    expect(share.series.map((s) => s.data[0])).toEqual([33.3, 33.3, 33.3]);
    expect(share.series.find((s) => s.name === 'A')?.data[1]).toBe(100);
  });
});
