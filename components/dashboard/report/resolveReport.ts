// Resolution of a report definition against loaded datasets (docs/plan-mes-rapports.md § 4.3):
// for each block, its effective scope (global context + block override), the restricted
// dataset, the chart parameters and whether it can be shown. Pure: the editor preview and the
// PDF both render from this, so they cannot disagree.

import {
  CHART_META,
  missingFeatures,
  sanitizeChartParams,
  trivialFiltersOf,
  datasetFeatures,
  type ChartParams,
  type DatasetFeature,
} from '../chartMeta';
import { EMBEDDABLE_IDS } from '../embedIds';
import type { YearRange } from '../overviewAggregates';
import type { PubFilters } from '../publicationFilters';
import type { DashboardDataset } from '../types';
import type { ReportBlock, ReportContext, ReportDefinition, ReportPeriod } from './definition';
import { resolvePeriod, restrictDataset } from './restrictDataset';

/** Effective scope of a block: global context overridden by the block, filters merged. */
export interface BlockScope {
  slug: string;
  perimetre: 'affiliation' | 'effectifs';
  period: ReportPeriod;
  range: YearRange;
  filters: PubFilters;
  /** True when the block departs from the global context (printed next to the chart). */
  overridden: boolean;
}

export type BlockStatus =
  /** Rendered. */
  | 'ok'
  /** Dataset of its structure still loading. */
  | 'loading'
  /** No data for its structure, or not readable by the viewer. */
  | 'no-data'
  /** The structure lacks the data the chart needs (teams, composite…). */
  | 'missing-feature'
  /** Chart id no longer in the registry. */
  | 'unknown-chart';

export interface ResolvedBlock {
  block: ReportBlock;
  scope: BlockScope | null;
  /** Restricted dataset (chart and kpis blocks with data). */
  dataset: DashboardDataset | null;
  status: BlockStatus;
  missing: DatasetFeature[];
  /** Active filters under which the chart degenerates (warning only). */
  trivial: (keyof PubFilters)[];
  params: ChartParams;
}

export interface ResolvedReport {
  blocks: ResolvedBlock[];
  /** Global scope (cover page). */
  scope: BlockScope;
  /** Publications of the global scope within its period (null while loading or without data). */
  publicationCount: number | null;
}

/**
 * Datasets per slug: undefined = still loading, null = no data (or not readable).
 */
export type DatasetsBySlug = Record<string, DashboardDataset | null | undefined>;

const hasScope = (b: ReportBlock): b is Extract<ReportBlock, { override?: unknown }> =>
  b.kind === 'chart' || b.kind === 'kpis' || b.kind === 'table';

export function scopeOf(
  context: ReportContext,
  override: Partial<ReportContext> | undefined,
  now: Date,
  ownFilters = false,
): BlockScope {
  const o = override ?? {};
  const period = o.period ?? context.period;
  // Block filters add to the report filters, or replace them (ownFilters).
  const filters = ownFilters ? { ...(o.filters ?? {}) } : { ...context.filters, ...(o.filters ?? {}) };
  return {
    slug: o.slug ?? context.slug,
    perimetre: o.perimetre ?? context.perimetre,
    period,
    range: resolvePeriod(period, now),
    filters,
    overridden: Object.keys(o).length > 0 || ownFilters,
  };
}

/** Every structure a report reads (global context first). */
export function reportSlugs(def: ReportDefinition): string[] {
  const out = new Set([def.context.slug]);
  for (const b of def.blocks) if (hasScope(b) && b.override?.slug) out.add(b.override.slug);
  return [...out];
}

const inRangeCount = (d: DashboardDataset, r: YearRange) =>
  d.publications.filter((p) => typeof p.year === 'number' && p.year >= r.start && p.year <= r.end).length;

export function resolveReport(def: ReportDefinition, datasets: DatasetsBySlug, now: Date = new Date()): ResolvedReport {
  // One restricted dataset per distinct scope: blocks sharing a scope share the object, so the
  // charts' memoized aggregates are computed once.
  const restricted = new Map<string, DashboardDataset>();
  const featuresBySlug = new Map<string, ReturnType<typeof datasetFeatures>>();
  const restrict = (scope: BlockScope, base: DashboardDataset) => {
    const key = JSON.stringify([scope.slug, scope.perimetre, scope.filters]);
    let d = restricted.get(key);
    if (!d) {
      d = restrictDataset(base, { perimetre: scope.perimetre, filters: scope.filters });
      restricted.set(key, d);
    }
    return d;
  };
  const featuresOf = (slug: string, base: DashboardDataset) => {
    let f = featuresBySlug.get(slug);
    if (!f) {
      f = datasetFeatures(base);
      featuresBySlug.set(slug, f);
    }
    return f;
  };

  const blocks = def.blocks.map((block): ResolvedBlock => {
    const base = { block, scope: null, dataset: null, missing: [], trivial: [], params: {} };
    if (!hasScope(block)) return { ...base, status: 'ok' };
    const scope = scopeOf(def.context, block.override, now, !!block.ownFilters);
    const source = datasets[scope.slug];
    if (block.kind === 'chart' && !EMBEDDABLE_IDS.has(block.chartId)) return { ...base, scope, status: 'unknown-chart' };
    if (source === undefined) return { ...base, scope, status: 'loading' };
    if (source === null) return { ...base, scope, status: 'no-data' };
    if (block.kind !== 'chart') return { ...base, scope, dataset: restrict(scope, source), status: 'ok' };
    // Features are read on the whole structure: a filter emptying a chart is not a missing feature.
    const missing = missingFeatures(block.chartId, featuresOf(scope.slug, source));
    return {
      block,
      scope,
      dataset: missing.length ? null : restrict(scope, source),
      status: missing.length ? 'missing-feature' : 'ok',
      missing,
      trivial: trivialFiltersOf(block.chartId, scope.filters),
      params: sanitizeChartParams(block.chartId, block.params),
    };
  });

  const scope = scopeOf(def.context, undefined, now);
  const source = datasets[scope.slug];
  return {
    blocks,
    scope,
    publicationCount: source ? inRangeCount(restrict(scope, source), scope.range) : null,
  };
}

/** Parameter definitions of a chart block (editor inputs). */
export const chartParamDefs = (chartId: string) => CHART_META[chartId]?.params ?? [];
