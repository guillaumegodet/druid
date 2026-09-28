// Restriction of a dashboard dataset to a report context (docs/plan-mes-rapports.md
// § 4.1): headcount scope, publication filters, resolved period. Charts of the
// registry are never filtered themselves — they receive the restricted dataset
// and stay unchanged (lot 0 audit, § 9.1: all of them aggregate publication by
// publication). Used by /embed, the report preview and the PDF.

import type { YearRange } from '../overviewAggregates';
import {
  buildFilterContext,
  matchesFilters,
  type FilterContext,
  type PubFilters,
} from '../publicationFilters';
import type { DashboardDataset } from '../types';
import type { ReportPeriod } from './definition';

/**
 * Absolute year range of a report period. Relative periods count complete
 * years back from the current one (« 5 dernières années complètes » = the 5
 * years before the current year).
 */
export function resolvePeriod(period: ReportPeriod, now: Date = new Date()): YearRange {
  if (period.kind === 'fixed') return { start: period.start, end: period.end };
  const current = now.getFullYear();
  const end = period.includeCurrent ? current : current - 1;
  return { start: end - period.lastYears + 1, end };
}

/**
 * authorIds of the staff: `members` in the private corpus, the minimal
 * `effectifsAuthorIds` field in the public variant (/embed).
 */
export function headcountAuthorIds(dataset: DashboardDataset): Set<number> {
  const fromMembers = (dataset.members ?? [])
    .map((m) => m.authorId)
    .filter((id): id is number => id != null);
  return new Set(fromMembers.length > 0 ? fromMembers : dataset.effectifsAuthorIds ?? []);
}

/**
 * True when at least one criterion restricts the publications. Unlike
 * countActiveFilters (badge of the list), the free-text search `q` counts, and
 * `charteSeuil` alone does not (it only refines charterCompliant).
 */
export function hasActiveFilter(f: PubFilters): boolean {
  return Object.entries(f).some(([k, v]) =>
    k !== 'charteSeuil' && v != null && v !== '' && v !== false &&
    !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0));
}

export interface RestrictOptions {
  perimetre?: 'affiliation' | 'effectifs';
  filters?: PubFilters;
  /** Reused when several restrictions run on the same dataset (built otherwise). */
  filterContext?: FilterContext;
}

/**
 * Dataset limited to the publications of the scope and filters; every other
 * field is kept as is. The « effectifs » scope without any matched staff
 * member keeps the whole corpus, like the dashboard and /embed always did.
 * Returns the input unchanged when nothing restricts it.
 */
export function restrictDataset(dataset: DashboardDataset, opts: RestrictOptions): DashboardDataset {
  let pubs = dataset.publications;
  if (opts.perimetre === 'effectifs') {
    const ids = headcountAuthorIds(dataset);
    if (ids.size > 0) pubs = pubs.filter((p) => p.authorIds.some((id) => ids.has(id)));
  }
  const filters = opts.filters ?? {};
  if (hasActiveFilter(filters)) {
    const ctx = opts.filterContext ?? buildFilterContext(dataset);
    pubs = pubs.filter((p) => matchesFilters(p, filters, ctx));
  }
  return pubs === dataset.publications ? dataset : { ...dataset, publications: pubs };
}
