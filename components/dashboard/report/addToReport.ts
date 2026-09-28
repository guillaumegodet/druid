// « Ajouter à un rapport » (docs/plan-mes-rapports.md, lot 4): a chart of the dashboard, with
// the context it is shown in (structure, years, scope, and the filters / parameters its tab
// holds), becomes a block of a new or existing report.

import type { ChartParams } from '../chartMeta';
import type { YearRange } from '../overviewAggregates';
import type { PubFilters } from '../publicationFilters';
import { REPORT_LIMITS, newBlockId, type ReportBlock, type ReportDefinition } from './definition';
import { hasActiveFilter, resolvePeriod } from './restrictDataset';

/** What the dashboard shows when « Ajouter à un rapport » is clicked. */
export interface ChartCapture {
  chartId: string;
  slug: string;
  range: YearRange;
  perimetre: 'affiliation' | 'effectifs';
  filters: PubFilters;
  params?: ChartParams;
}

/**
 * - `report`: the chart follows the report scope (a « top journals » added to a report on the
 *   collaborations with Ottawa shows the journals of those collaborations);
 * - `dashboard`: the chart keeps exactly what the dashboard showed (its own structure, years,
 *   scope and filters).
 */
export type AdditionMode = 'report' | 'dashboard';

const sameRange = (a: YearRange, b: YearRange) => a.start === b.start && a.end === b.end;

/** Differences between the report scope and the captured one (empty = same view either way). */
export function scopeDifferences(def: ReportDefinition, c: ChartCapture, now: Date = new Date()) {
  return {
    slug: def.context.slug !== c.slug,
    period: !sameRange(resolvePeriod(def.context.period, now), c.range),
    perimetre: def.context.perimetre !== c.perimetre,
    filters: hasActiveFilter(def.context.filters) || hasActiveFilter(c.filters),
  };
}

export const scopesDiffer = (def: ReportDefinition, c: ChartCapture, now: Date = new Date()) =>
  Object.values(scopeDifferences(def, c, now)).some(Boolean);

/** Chart block for `def`, following its scope or pinned to the captured one. */
export function chartBlockFor(def: ReportDefinition, c: ChartCapture, mode: AdditionMode, now: Date = new Date()): ReportBlock {
  const params = c.params && Object.keys(c.params).length ? { ...c.params } : undefined;
  const block: ReportBlock = { id: newBlockId(), kind: 'chart', chartId: c.chartId, ...(params ? { params } : {}) };
  if (mode === 'report') return block;
  const diff = scopeDifferences(def, c, now);
  const override: Partial<ReportDefinition['context']> = {};
  if (diff.slug) override.slug = c.slug;
  if (diff.period) override.period = { kind: 'fixed', start: c.range.start, end: c.range.end };
  if (diff.perimetre) override.perimetre = c.perimetre;
  if (hasActiveFilter(c.filters)) override.filters = { ...c.filters };
  return {
    ...block,
    ...(Object.keys(override).length ? { override } : {}),
    // The report filters must not apply to a chart pinned to the dashboard view.
    ...(diff.filters ? { ownFilters: true } : {}),
  };
}

/** Definition with the block appended; throws when the report is full. */
export function appendBlock(def: ReportDefinition, block: ReportBlock): ReportDefinition {
  if (def.blocks.length >= REPORT_LIMITS.maxBlocks) throw new Error('report full');
  return { ...def, blocks: [...def.blocks, block] };
}

/** New report holding the chart, with the dashboard view as its context. */
export function newReportFromChart(c: ChartCapture, name: string, lang: 'fr' | 'en'): ReportDefinition {
  const params = c.params && Object.keys(c.params).length ? { params: { ...c.params } } : {};
  return {
    schemaVersion: 1,
    name: name.trim(),
    description: '',
    context: {
      slug: c.slug,
      perimetre: c.perimetre,
      period: { kind: 'fixed', start: c.range.start, end: c.range.end },
      filters: { ...c.filters },
    },
    blocks: [{ id: newBlockId(), kind: 'chart', chartId: c.chartId, ...params }],
    lang,
  };
}
