// Data behind a chart, read back from its ECharts option, for the CSV export of the chart cards
// (EChartCard). Every dashboard chart goes through that card, so a generic reading of the option
// covers them all without touching each chart: category axis × series for bars and lines, name /
// value for pies and maps, nodes + links for networks, one row per node for sunbursts…
// What is exported is what the chart draws (same top N, same « Others »), not the raw corpus.

import { t } from '@lingui/core/macro';

export type Cell = string | number | null;

export interface DataTable {
  /** File name suffix when a chart yields several tables (network: nodes + links). */
  name: string;
  columns: string[];
  rows: Cell[][];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v != null && typeof v === 'object' && !Array.isArray(v);
const asArray = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function cell(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

/** Raw value of a data item: 12, { value: 12 }, [x, y] or { value: [x, y] }. */
const rawValue = (item: unknown): unknown => (isObj(item) ? item.value : item);

/** Scalar value of a data item; for an array, dimension `dim` (default: the last one). */
function itemValue(item: unknown, dim?: number): unknown {
  const v = rawValue(item);
  if (Array.isArray(v)) return v[dim ?? v.length - 1];
  return v;
}

const itemName = (item: unknown): string | null =>
  isObj(item) && item.name != null ? String(item.name) : null;

/** Labels of a category axis (`data` items may be { value } objects), null otherwise. */
function axisLabels(axis: unknown): string[] | null {
  if (!isObj(axis) || axis.type === 'value' || axis.type === 'time' || axis.type === 'log') return null;
  if (!Array.isArray(axis.data)) return null;
  return axis.data.map((d) => String(isObj(d) ? d.value : d));
}

const axisTitle = (axis: unknown, fallback: string): string =>
  isObj(axis) && typeof axis.name === 'string' && axis.name.trim() ? axis.name.trim() : fallback;

/** Category label of an index or label coordinate. */
const labelAt = (labels: string[] | null, v: unknown): Cell =>
  labels && typeof v === 'number' && Number.isInteger(v) && labels[v] != null ? labels[v] : cell(v);

const seriesName = (s: Obj, i: number, count: number): string =>
  typeof s.name === 'string' && s.name ? s.name : count === 1 ? t`Value` : t`Series ${i + 1}`;

const isGeo = (s: Obj) => s.coordinateSystem === 'geo';

/** Bars and lines: one row per category (or x value), one column per series. */
function cartesianTables(option: Obj, allSeries: Obj[]): DataTable[] {
  // Series without data (a mark line holder…) would only add empty columns.
  const series = allSeries.filter((s) => asArray(s.data).length > 0);
  if (!series.length) return [];
  const xAxes = asArray(option.xAxis);
  const yAxes = asArray(option.yAxis);
  const first = series[0];
  const xAxis = xAxes[Number(first.xAxisIndex ?? 0)];
  const yAxis = yAxes[Number(first.yAxisIndex ?? 0)];
  const xLabels = axisLabels(xAxis);
  const yLabels = xLabels ? null : axisLabels(yAxis);
  const labels = xLabels ?? yLabels;
  const catAxis = xLabels ? xAxis : yLabels ? yAxis : xAxis;
  // Array data items are [x, y]: the category (or x) is on the category axis dimension.
  const catDim = yLabels ? 1 : 0;
  const valueDim = 1 - catDim;

  const keys: Cell[] = labels ? [...labels] : [];
  const seen = new Set<Cell>(keys);
  const columns = series.map((s) => {
    const values = new Map<Cell, Cell>();
    asArray(s.data).forEach((d, i) => {
      const v = rawValue(d);
      const key = Array.isArray(v) ? labelAt(labels, v[catDim]) : labels ? (labels[i] ?? null) : i;
      const value = cell(Array.isArray(v) ? v[valueDim] : v);
      if (key == null) return;
      values.set(key, value);
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    });
    return values;
  });
  if (!labels && keys.every((k) => typeof k === 'number')) (keys as number[]).sort((a, b) => a - b);

  return [{
    name: 'data',
    columns: [axisTitle(catAxis, labels ? t`Category` : 'X'), ...series.map((s, i) => seriesName(s, i, series.length))],
    rows: keys.map((k) => [k, ...columns.map((m) => m.get(k) ?? null)]),
  }];
}

/** Heatmap on two category axes: one row per cell. */
function heatmapTable(option: Obj, s: Obj): DataTable {
  const xAxis = asArray(option.xAxis)[Number(s.xAxisIndex ?? 0)];
  const yAxis = asArray(option.yAxis)[Number(s.yAxisIndex ?? 0)];
  const xLabels = axisLabels(xAxis);
  const yLabels = axisLabels(yAxis);
  return {
    name: 'data',
    columns: [axisTitle(yAxis, t`Row`), axisTitle(xAxis, t`Column`), t`Value`],
    rows: asArray(s.data).map((d) => {
      const v = asArray(rawValue(d) as unknown[]);
      return [labelAt(yLabels, v[1]), labelAt(xLabels, v[0]), cell(v[2])];
    }),
  };
}

/** Scatter on value axes: one row per point. */
function scatterTable(option: Obj, series: Obj[]): DataTable {
  const xAxis = asArray(option.xAxis)[0];
  const yAxis = asArray(option.yAxis)[0];
  const xLabels = axisLabels(xAxis);
  const yLabels = axisLabels(yAxis);
  const width = Math.max(2, ...series.flatMap((s) => asArray(s.data).map((d) => asArray(rawValue(d) as unknown[]).length)));
  const extra = Array.from({ length: width - 2 }, (_, i) => t`Value ${i + 3}`);
  return {
    name: 'data',
    columns: [t`Series`, t`Name`, axisTitle(xAxis, 'X'), axisTitle(yAxis, 'Y'), ...extra],
    rows: series.flatMap((s, si) =>
      asArray(s.data).map((d) => {
        const v = asArray(rawValue(d) as unknown[]);
        return [
          seriesName(s, si, series.length), itemName(d),
          labelAt(xLabels, v[0]), labelAt(yLabels, v[1]),
          ...extra.map((_, i) => cell(v[i + 2])),
        ];
      }),
    ),
  };
}

/** Pies, funnels and choropleth maps: name / value, with the series when there are several. */
function nameValueTable(series: Obj[]): DataTable {
  const multi = series.length > 1;
  return {
    name: 'data',
    columns: [...(multi ? [t`Series`] : []), t`Name`, t`Value`],
    rows: series.flatMap((s, si) =>
      asArray(s.data).map((d) => [
        ...(multi ? [seriesName(s, si, series.length)] : []),
        itemName(d) ?? cell(isObj(d) ? null : d),
        cell(itemValue(d)),
      ]),
    ),
  };
}

/** Points on a map ([lon, lat, value]). */
function geoPointsTable(series: Obj[]): DataTable {
  const multi = series.length > 1;
  return {
    name: 'data',
    columns: [...(multi ? [t`Series`] : []), t`Name`, t`Longitude`, t`Latitude`, t`Value`],
    rows: series.flatMap((s, si) =>
      asArray(s.data).map((d) => {
        const v = asArray(rawValue(d) as unknown[]);
        return [...(multi ? [seriesName(s, si, series.length)] : []), itemName(d), cell(v[0]), cell(v[1]), cell(v[2])];
      }),
    ),
  };
}

/** Flow lines on a map (only exported when the chart has no points). */
function geoLinesTable(series: Obj[]): DataTable {
  return {
    name: 'data',
    columns: [t`From longitude`, t`From latitude`, t`To longitude`, t`To latitude`, t`Value`],
    rows: series.flatMap((s) =>
      asArray(s.data).map((d) => {
        const coords = asArray(isObj(d) ? (d.coords as unknown[]) : (d as unknown[])) as unknown[][];
        const [from, to] = [asArray(coords[0]), asArray(coords[coords.length - 1])];
        return [cell(from[0]), cell(from[1]), cell(to[0]), cell(to[1]), cell(isObj(d) ? d.value : null)];
      }),
    ),
  };
}

/** Graph links name their ends by node id, name or index: resolves to the node name. */
function nodeNamer(nodes: unknown[]): (ref: unknown) => Cell {
  const byKey = new Map<string, string>();
  nodes.forEach((n) => {
    const name = itemName(n);
    if (name == null || !isObj(n)) return;
    byKey.set(name, name);
    if (n.id != null) byKey.set(String(n.id), name);
  });
  return (ref) => {
    if (typeof ref === 'number') return itemName(nodes[ref]) ?? ref;
    return ref == null ? null : (byKey.get(String(ref)) ?? String(ref));
  };
}

function linksTable(s: Obj, nodes: unknown[]): DataTable {
  const name = nodeNamer(nodes);
  const links = asArray((s.links ?? s.edges) as unknown[]);
  return {
    name: 'links',
    columns: [t`Source`, t`Target`, t`Value`],
    rows: links.filter(isObj).map((l) => [name(l.source), name(l.target), cell(itemValue(l))]),
  };
}

function graphTables(s: Obj): DataTable[] {
  const nodes = asArray((s.nodes ?? s.data) as unknown[]);
  const categories = asArray(s.categories as unknown[]);
  const categoryName = (c: unknown): Cell =>
    typeof c === 'number' ? (itemName(categories[c]) ?? c) : cell(c);
  return [
    {
      name: 'nodes',
      columns: [t`Name`, t`Category`, t`Value`],
      rows: nodes.map((n) => [itemName(n), isObj(n) ? categoryName(n.category) : null, cell(itemValue(n))]),
    },
    linksTable(s, nodes),
  ];
}

/** Sunburst / treemap / tree: one row per node, its path spread over level columns. */
function hierarchyTable(s: Obj): DataTable {
  const rows: { path: string[]; value: Cell }[] = [];
  const walk = (node: unknown, path: string[]): number => {
    if (!isObj(node)) return 0;
    const here = [...path, String(node.name ?? '')];
    const entry = { path: here, value: null as Cell };
    rows.push(entry);
    const childSum = asArray(node.children as unknown[]).reduce<number>((sum, c) => sum + walk(c, here), 0);
    const own = cell(itemValue(node));
    entry.value = typeof own === 'number' ? own : childSum || null;
    return typeof own === 'number' ? own : childSum;
  };
  asArray(s.data as unknown[]).forEach((n) => walk(n, []));
  const depth = Math.max(1, ...rows.map((r) => r.path.length));
  return {
    name: 'data',
    columns: [...Array.from({ length: depth }, (_, i) => t`Level ${i + 1}`), t`Value`],
    rows: rows.map((r) => [...Array.from({ length: depth }, (_, i) => r.path[i] ?? null), r.value]),
  };
}

/** Radar: one row per indicator, one column per profile. */
function radarTable(option: Obj, s: Obj): DataTable {
  const radar = asArray(option.radar)[Number(s.radarIndex ?? 0)];
  const indicators = isObj(radar) ? asArray(radar.indicator as unknown[]) : [];
  const items = asArray(s.data as unknown[]);
  return {
    name: 'data',
    columns: [t`Indicator`, ...items.map((d, i) => itemName(d) ?? t`Series ${i + 1}`)],
    rows: indicators.map((ind, k) => [
      itemName(ind),
      ...items.map((d) => cell(asArray(rawValue(d) as unknown[])[k])),
    ]),
  };
}

/** Tables of the data drawn by an ECharts option (empty when nothing can be read back). */
export function chartTables(option: unknown): DataTable[] {
  if (!isObj(option)) return [];
  const series = asArray(option.series as unknown[]).filter(isObj);
  const byType = (...types: string[]) => series.filter((s) => types.includes(String(s.type)));

  const tables: DataTable[] = [];
  tables.push(...cartesianTables(option, byType('bar', 'line', 'pictorialBar', 'boxplot', 'candlestick')));
  for (const s of byType('heatmap').filter((s) => !isGeo(s))) tables.push(heatmapTable(option, s));
  const scatter = byType('scatter', 'effectScatter');
  const geoPoints = scatter.filter(isGeo);
  if (scatter.length > geoPoints.length) tables.push(scatterTable(option, scatter.filter((s) => !isGeo(s))));
  if (geoPoints.length) tables.push(geoPointsTable(geoPoints));
  else if (byType('lines').length) tables.push(geoLinesTable(byType('lines')));
  const named = byType('pie', 'funnel', 'map');
  if (named.length) tables.push(nameValueTable(named));
  for (const s of byType('sankey')) tables.push(linksTable(s, asArray((s.nodes ?? s.data) as unknown[])));
  for (const s of byType('graph')) tables.push(...graphTables(s));
  for (const s of byType('sunburst', 'treemap', 'tree')) tables.push(hierarchyTable(s));
  for (const s of byType('radar')) tables.push(radarTable(option, s));

  const kept = tables.filter((tb) => tb.rows.length > 0);
  // Several tables of the same kind (two pies, two heatmaps…) get distinct file names.
  const counts = new Map<string, number>();
  return kept.map((tb) => {
    const n = (counts.get(tb.name) ?? 0) + 1;
    counts.set(tb.name, n);
    return n > 1 ? { ...tb, name: `${tb.name}-${n}` } : tb;
  });
}

/**
 * CSV for a French spreadsheet: `;` separator and decimal comma (Excel fr reads 12.5 as a date
 * otherwise). Text is always quoted; a leading = + @ is neutralised (formula injection).
 */
export function toCsv(table: DataTable): string {
  const fmt = (v: Cell): string => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const safe = /^[=+@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [table.columns.map(fmt), ...table.rows.map((r) => r.map(fmt))].map((r) => r.join(';')).join('\r\n');
}
