import React, { useMemo } from 'react';
import { useLingui } from '@lingui/react/macro';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import type { PairCell } from '../pairsApi';

/**
 * Symmetric heatmap of the researcher pairs per couple of labs or of poles (druid-internal
 * `docs/plan-binomes-chercheurs.md`, lot 2): a cell counts the pairs, not their publications. The
 * `maxAxis` most involved entities are kept; a click on a cell gives the couple.
 */
export const PairMatrixChart: React.FC<{
  cells: PairCell[];
  title: string;
  subtitle?: string;
  exportName: string;
  maxAxis?: number;
  /** Selected couple, outlined. */
  selected?: [string, string] | null;
  onCellClick?: (a: string, b: string) => void;
}> = ({ cells, title, subtitle, exportName, maxAxis = 20, selected, onCellClick }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const { axis, data, max } = useMemo(() => {
    const weight = new Map<string, number>();
    for (const c of cells) {
      weight.set(c.a, (weight.get(c.a) ?? 0) + c.pairs);
      if (c.b !== c.a) weight.set(c.b, (weight.get(c.b) ?? 0) + c.pairs);
    }
    const kept = [...weight.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, maxAxis)
      .map(([k]) => k)
      .sort((x, y) => x.localeCompare(y));
    const index = new Map(kept.map((k, i) => [k, i]));
    const out: { value: [number, number, number]; cell: PairCell }[] = [];
    for (const c of cells) {
      const i = index.get(c.a);
      const j = index.get(c.b);
      if (i == null || j == null) continue;
      out.push({ value: [i, j, c.pairs], cell: c });
      if (i !== j) out.push({ value: [j, i, c.pairs], cell: c });
    }
    return { axis: kept, data: out, max: out.reduce((m, d) => Math.max(m, d.value[2]), 0) };
  }, [cells, maxAxis]);

  const option = useMemo(() => {
    const isSelected = (c: PairCell) =>
      !!selected && ((c.a === selected[0] && c.b === selected[1]) || (c.a === selected[1] && c.b === selected[0]));
    const axisDef = (inverse: boolean) => ({
      type: 'category' as const,
      data: axis,
      inverse,
      splitArea: { show: true, areaStyle: { color: [t.surface] } },
      axisLabel: { color: t.inkSecondary, fontSize: 11, interval: 0, rotate: inverse ? 0 : 45 },
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
    });
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        position: 'top',
        formatter: (p: { data: { cell: PairCell } }) => {
          const c = p.data.cell;
          const head = c.a === c.b ? c.a : `${c.a} × ${c.b}`;
          return `${head}<br/>${tr`${c.pairs} pairs`} · ${tr`${c.new} new`} · ${tr`${c.dormant} dormant`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
      xAxis: axisDef(false),
      yAxis: axisDef(true),
      visualMap: {
        min: 0,
        max: max || 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: t.seqRamp },
        textStyle: { color: t.inkSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'heatmap',
          data: data.map((d) => ({
            ...d,
            itemStyle: isSelected(d.cell) ? { borderColor: t.ink, borderWidth: 2 } : undefined,
          })),
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
          label: { show: axis.length <= 12, color: t.ink, fontSize: 11 },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' } },
        },
      ],
    };
  }, [axis, data, max, selected, t, tr]);

  return (
    <EChartCard
      title={title}
      subtitle={subtitle}
      option={option}
      exportName={exportName}
      shareable={false}
      height={Math.max(320, axis.length * 26 + 120)}
      emptyMessage={axis.length === 0 ? tr`No pair of researchers matches these filters over the period.` : undefined}
      exportTables={() => [{
        name: exportName,
        columns: ['a', 'b', 'pairs', 'new', 'dormant'],
        rows: cells.map((c) => [c.a, c.b, c.pairs, c.new, c.dormant]),
      }]}
      onSeriesClick={onCellClick ? (p) => {
        const c = (p.data as { cell?: PairCell } | undefined)?.cell;
        if (c) onCellClick(c.a, c.b);
      } : undefined}
    />
  );
};
