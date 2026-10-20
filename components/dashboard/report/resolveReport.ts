// Resolution of a report definition against loaded datasets (docs/plan-mes-rapports.md § 4.3):
// for each block, its effective scope (global context + block override), the restricted
// dataset, the chart parameters and whether it can be shown. Pure: the editor preview and the
// PDF both render from this, so they cannot disagree.
// Blocks fed by a remote source (ChartMeta.remote, remoteSources.ts) also carry their request; they
// stay « loading » until the payload is in `remote`, then render from it like the others.

import {
  CHART_META,
  REMOTE_KPI_SETS,
  REMOTE_PARAMS,
  REMOTE_TABLES,
  missingFeatures,
  sanitizeChartParams,
  sanitizeParams,
  trivialFiltersOf,
  datasetFeatures,
  scopeFeatures,
  type ChartParams,
  type DatasetFeature,
  type RemoteSource,
} from '../chartMeta';
import { isReportChartId } from '../embedIds';
import type { YearRange } from '../overviewAggregates';
import type { PubFilters } from '../publicationFilters';
import type { DashboardDataset } from '../types';
import type { ReportBlock, ReportContext, ReportDefinition, ReportPeriod } from './definition';
import { remoteRequest, type RemoteDataByKey, type RemoteRequest } from './remoteSources';
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
  /** Dataset of its structure, or its remote data, still loading. */
  | 'loading'
  /** No data for its structure (or no remote data), or not readable by the viewer. */
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
  /**
   * Whole corpus of the block structure in its scope, without the filters (key figures that
   * compare the restricted corpus with it: partner rank, comparable impact reference).
   */
  source: DashboardDataset | null;
  status: BlockStatus;
  missing: DatasetFeature[];
  /** Active filters under which the chart degenerates (warning only). */
  trivial: (keyof PubFilters)[];
  params: ChartParams;
  /** Remote data the block reads (null = none: computed from the dataset). */
  remoteRequest: RemoteRequest | null;
  /** Its payload once loaded (status 'ok'). */
  remote: unknown;
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
  b.kind === 'chart' || b.kind === 'kpis' || b.kind === 'table' || b.kind === 'ai';

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

/** Remote source of a block and the parameters it is fetched with (null = computed from the dataset). */
function remoteOf(block: ReportBlock): { source: RemoteSource; params: ChartParams } | null {
  let source: RemoteSource | undefined;
  if (block.kind === 'chart') source = CHART_META[block.chartId]?.remote;
  else if (block.kind === 'kpis') source = REMOTE_KPI_SETS[block.setId];
  else if (block.kind === 'table') source = REMOTE_TABLES[block.tableId];
  if (!source) return null;
  const raw = block.kind === 'chart' || block.kind === 'kpis' || block.kind === 'table' ? block.params : undefined;
  return {
    source,
    params: block.kind === 'chart' ? sanitizeChartParams(block.chartId, raw) : sanitizeParams(REMOTE_PARAMS[source], raw),
  };
}

/**
 * Remote requests of a report, one per distinct key — from the definition alone, so that they can be
 * loaded before the resolution (the same keys as the resolved blocks' remoteRequest).
 */
export function reportRemoteRequests(def: ReportDefinition, now: Date = new Date()): RemoteRequest[] {
  const out = new Map<string, RemoteRequest>();
  for (const block of def.blocks) {
    if (!hasScope(block) || (block.kind === 'chart' && !isReportChartId(block.chartId))) continue;
    const r = remoteOf(block);
    if (!r) continue;
    const scope = scopeOf(def.context, block.override, now, !!block.ownFilters);
    const request = remoteRequest(r.source, scope.slug, scope.range, r.params);
    out.set(request.key, request);
  }
  return [...out.values()];
}

export function resolveReport(
  def: ReportDefinition,
  datasets: DatasetsBySlug,
  now: Date = new Date(),
  remote: RemoteDataByKey = {},
): ResolvedReport {
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
    const base = {
      block, scope: null, dataset: null, source: null, missing: [], trivial: [], params: {}, remoteRequest: null, remote: null,
    };
    if (!hasScope(block)) return { ...base, status: 'ok' };
    const scope = scopeOf(def.context, block.override, now, !!block.ownFilters);
    const source = datasets[scope.slug];
    if (block.kind === 'chart' && !isReportChartId(block.chartId)) return { ...base, scope, status: 'unknown-chart' };
    const r = remoteOf(block);
    if (r) {
      // Read from its remote payload only: the publication filters and the dataset do not apply.
      const request = remoteRequest(r.source, scope.slug, scope.range, r.params);
      const payload = remote[request.key];
      const status: BlockStatus = payload === undefined ? 'loading' : payload === null ? 'no-data' : 'ok';
      return { ...base, scope, params: r.params, remoteRequest: request, remote: payload ?? null, status };
    }
    if (source === undefined) return { ...base, scope, status: 'loading' };
    if (source === null) return { ...base, scope, status: 'no-data' };
    const whole = restrict({ ...scope, filters: {} }, source);
    if (block.kind !== 'chart') return { ...base, scope, dataset: restrict(scope, source), source: whole, status: 'ok' };
    // Features are read on the whole structure (a filter emptying a chart is not a missing
    // feature), plus the partner group named by the block filters.
    const missing = missingFeatures(block.chartId, scopeFeatures(featuresOf(scope.slug, source), scope.filters));
    return {
      ...base,
      scope,
      source: whole,
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
