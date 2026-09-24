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

interface Props {
  years: number[];
  series: { name: string; slot: number; data: number[] }[];
}

/** Books per year — stacked bars by type (fixed palette slots). */
export const BooksByYearChart: React.FC<Props> = ({ years, series }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      legend: {
        bottom: 0,
        data: series.map((s) => s.name),
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: years.map(String) },
      yAxis: baseValueAxis(t),
      series: series.map((s, i) => ({
        name: s.name,
        type: 'bar',
        stack: 'total',
        data: s.data,
        itemStyle: {
          color: t.series[s.slot],
          borderColor: t.surface,
          borderWidth: 1,
          ...(i === series.length - 1 ? { borderRadius: [4, 4, 0, 0] } : {}),
        },
      })),
    }),
    [years, series, t],
  );

  return (
    <EChartCard
      title={tr`Books per year`}
      option={option}
      exportName="ouvrages-par-annee"
    />
  );
};
