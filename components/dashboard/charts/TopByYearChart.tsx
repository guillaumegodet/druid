import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import { useLingui } from '@lingui/react/macro';

/** Top 1% / Top 10% (excluding top 1%) publications per year — stacked bars. */
export const TopByYearChart: React.FC<{
  data: { year: number; top1: number; top10Only: number }[];
  /** Click on a bar — opens the list filtered on the year and the bracket. */
  onSelect?: (year: number, tranche: 'top1' | 'top10') => void;
}> = ({ data, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const top1Name = tr`Top 1%`;

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      legend: { bottom: 0, textStyle: { color: t.inkSecondary, fontSize: 11 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 16, bottom: 36, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: baseValueAxis(t),
      series: [
        {
          name: tr`Top 10% (excluding top 1%)`,
          type: 'bar',
          stack: 'total',
          data: data.map((d) => d.top10Only),
          itemStyle: { color: t.series[3], borderColor: t.surface, borderWidth: 1 },
        },
        {
          name: top1Name,
          type: 'bar',
          stack: 'total',
          data: data.map((d) => d.top1),
          itemStyle: { color: t.series[4], borderColor: t.surface, borderWidth: 1, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }),
    [data, t, tr, top1Name],
  );

  return (
    <EChartCard
      title={tr`Top 1% / 10% publications`}
      subtitle={tr`Most cited publications in their field (OpenAlex)`}
      option={option}
      exportName="top-par-annee"
      height={300}
      onSeriesClick={
        onSelect
          ? (p) =>
              data[p.dataIndex] &&
              onSelect(data[p.dataIndex].year, p.seriesName === top1Name ? 'top1' : 'top10')
          : undefined
      }
    />
  );
};
