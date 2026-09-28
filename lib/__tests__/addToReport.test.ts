import { describe, expect, it } from 'vitest';
import {
  appendBlock,
  chartBlockFor,
  newReportFromChart,
  scopeDifferences,
  scopesDiffer,
  type ChartCapture,
} from '../../components/dashboard/report/addToReport';
import { parseReportDefinition, REPORT_LIMITS, type ReportDefinition } from '../../components/dashboard/report/definition';
import { scopeOf } from '../../components/dashboard/report/resolveReport';

// « Ajouter à un rapport » (docs/plan-mes-rapports.md, lot 4).
const at = new Date('2026-09-28T12:00:00Z');
const capture: ChartCapture = {
  chartId: 'charte-scores',
  slug: 'lab-a',
  range: { start: 2021, end: 2025 },
  perimetre: 'affiliation',
  filters: {},
  params: { thresholdPct: 60 },
};
const report: ReportDefinition = {
  schemaVersion: 1,
  name: 'Lab A × Ottawa',
  description: '',
  context: {
    slug: 'lab-a',
    perimetre: 'affiliation',
    period: { kind: 'relative', lastYears: 5, includeCurrent: false },
    filters: {},
  },
  blocks: [],
  lang: 'fr',
};

describe('addToReport', () => {
  it('creates a valid report from a chart, with the dashboard view as context', () => {
    const def = newReportFromChart(capture, '  Charter follow-up ', 'fr');
    expect(parseReportDefinition(def).ok).toBe(true);
    expect(def.name).toBe('Charter follow-up');
    expect(def.context).toEqual({ slug: 'lab-a', perimetre: 'affiliation', period: { kind: 'fixed', start: 2021, end: 2025 }, filters: {} });
    expect(def.blocks[0]).toMatchObject({ kind: 'chart', chartId: 'charte-scores', params: { thresholdPct: 60 } });
  });

  it('sees no difference when the report covers the same view', () => {
    // 5 last complete years at 2026-09-28 = 2021-2025.
    expect(scopesDiffer(report, capture, at)).toBe(false);
    expect(chartBlockFor(report, capture, 'dashboard', at)).not.toHaveProperty('override');
  });

  it('follows the report scope, or pins the block to the dashboard view', () => {
    const other: ChartCapture = { ...capture, slug: 'lab-b', range: { start: 2023, end: 2023 }, perimetre: 'effectifs' };
    const withPartner = { ...report, context: { ...report.context, filters: { partnerKeys: ['03c4mmv16'] } } };
    expect(scopeDifferences(withPartner, other, at)).toEqual({ slug: true, period: true, perimetre: true, filters: true });

    const follow = chartBlockFor(withPartner, other, 'report', at);
    expect(follow).not.toHaveProperty('override');
    expect(follow).not.toHaveProperty('ownFilters');

    const pinned = chartBlockFor(withPartner, other, 'dashboard', at);
    expect(pinned).toMatchObject({
      override: { slug: 'lab-b', perimetre: 'effectifs', period: { kind: 'fixed', start: 2023, end: 2023 } },
      ownFilters: true,
    });
    // The pinned block does not inherit the report's partner filter.
    const s = scopeOf(withPartner.context, (pinned as { override?: object }).override as never, at, true);
    expect(s.filters).toEqual({});
    expect(s.range).toEqual({ start: 2023, end: 2023 });

    const def = appendBlock(withPartner, pinned);
    expect(parseReportDefinition(def).ok).toBe(true);
  });

  it('keeps the filters captured with the chart', () => {
    const b = chartBlockFor(report, { ...capture, filters: { country: 'CA' } }, 'dashboard', at);
    expect(b).toMatchObject({ override: { filters: { country: 'CA' } }, ownFilters: true });
  });

  it('refuses to exceed the block limit', () => {
    const full = { ...report, blocks: Array.from({ length: REPORT_LIMITS.maxBlocks }, (_, i) => ({ id: `s${i}`, kind: 'section' as const, title: 'x' })) };
    expect(() => appendBlock(full, chartBlockFor(full, capture, 'report', at))).toThrow();
  });
});
