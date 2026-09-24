import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import { ImpactGroupRow } from '../impactAggregates';
import { numberLocale } from '../../../lib/i18n';
import { useLingui } from '@lingui/react/macro';

/** Mean FWCI per group — horizontal bars, « world average = 1.0 » marker. */
export const FwciMeanByGroupChart: React.FC<{
  rows: ImpactGroupRow[];
  exportName: string;
  /** Click on a bar (group name) — opens the filtered list. */
  onSelect?: (group: string) => void;
}> = ({ rows, exportName, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const sorted = useMemo(() => [...rows].sort((a, b) => a.fwciMean - b.fwciMean), [rows]);
  const option = useMemo(() => {
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number; value: number }[]) => {
          const r = sorted[p[0].dataIndex];
          return tr`${r.group}: mean FWCI ${r.fwciMean.toLocaleString(numberLocale())} (${r.n} publications)`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), name: tr`Mean FWCI`, nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((r) => r.group),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 160, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((r) => r.fwciMean),
          itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
          markLine: {
            symbol: 'none',
            lineStyle: { color: t.inkMuted, type: 'dashed' },
            label: { formatter: '1,0', position: 'end', color: t.inkSecondary, fontSize: 10 },
            data: [{ xAxis: 1 }],
          },
        },
      ],
    };
  }, [sorted, t, tr]);

  return (
    <EChartCard
      title={tr`Mean FWCI`}
      subtitle={tr`World average = 1.0 · publications with known FWCI`}
      option={option}
      exportName={exportName}
      height={Math.max(320, rows.length * 24 + 90)}
      shareable={false}
      onSeriesClick={
        onSelect ? (p) => sorted[p.dataIndex] && onSelect(sorted[p.dataIndex].group) : undefined
      }
    />
  );
};

/** Top 1% / Top 10% (excluding top 1%) per group — stacked horizontal bars. */
export const TopByGroupChart: React.FC<{
  rows: ImpactGroupRow[];
  exportName: string;
  /** Click on a bar (group name) — opens the filtered list. */
  onSelect?: (group: string, tranche: 'top1' | 'top10') => void;
}> = ({ rows, exportName, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const top1Name = tr`Top 1%`;
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.top1 + a.top10Only - (b.top1 + b.top10Only)),
    [rows],
  );
  const option = useMemo(() => {
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      legend: {
        bottom: 0,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: 8, right: 24, top: 8, bottom: 36, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((r) => r.group),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 160, overflow: 'truncate' as const },
      },
      series: [
        {
          name: tr`Top 10% (excluding top 1%)`,
          type: 'bar',
          stack: 'total',
          data: sorted.map((r) => r.top10Only),
          itemStyle: { color: t.series[3], borderColor: t.surface, borderWidth: 1 },
        },
        {
          name: top1Name,
          type: 'bar',
          stack: 'total',
          data: sorted.map((r) => r.top1),
          itemStyle: { color: t.series[4], borderColor: t.surface, borderWidth: 1, borderRadius: [0, 4, 4, 0] },
        },
      ],
    };
  }, [sorted, t, tr, top1Name]);

  return (
    <EChartCard
      title={tr`Top 1% and Top 10% publications`}
      option={option}
      exportName={exportName}
      height={Math.max(320, rows.length * 24 + 90)}
      shareable={false}
      onSeriesClick={
        onSelect
          ? (p) =>
              sorted[p.dataIndex] &&
              onSelect(sorted[p.dataIndex].group, p.seriesName === top1Name ? 'top1' : 'top10')
          : undefined
      }
    />
  );
};
