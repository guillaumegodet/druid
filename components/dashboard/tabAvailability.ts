// Which dashboard tabs a structure shows — one rule for the dashboard itself
// and for the chart catalog of the report editor (docs/plan-mes-rapports.md
// § 9.2): a chart of a tab hidden for the structure is not offered.

export interface TabVisibilityInput {
  /** Tabs hidden by the admin for this structure (druid_tabs_hidden in config.yaml). */
  hidden: Iterable<string>;
  /** Strategic axes configured (strategic_axes in config.yaml, missing for groups in particular). */
  hasAxes: boolean;
  /** Benchmark data exported for the structure. */
  hasBenchmark: boolean;
}

/**
 * Filters `tabs` (in order) down to the visible ones. « Vue d'ensemble »
 * (overview) always stays visible.
 */
export function visibleTabKeys<T extends string>(tabs: readonly T[], input: TabVisibilityInput): T[] {
  const hidden = new Set(input.hidden);
  return tabs.filter((key) =>
    key === 'overview' ||
    (!hidden.has(key) && (key !== 'themes' || input.hasAxes) && (key !== 'benchmark' || input.hasBenchmark)));
}

