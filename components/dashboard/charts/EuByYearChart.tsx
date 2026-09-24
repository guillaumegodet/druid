import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  useVizTheme,
} from '../EChartCard';
import { useLingui } from '@lingui/react/macro';

/** EU / non-EU per year — stacked areas. */
export const EuByYearChart: React.FC<{
  data: { year: number; ue: number; outsideEu: number }[];
}> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', ...baseTooltip(t) },
      legend: { bottom: 0, textStyle: { color: t.inkSecondary, fontSize: 11 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 16, bottom: 36, containLabel: true },
      xAxis: {
        type: 'category' as const,
        boundaryGap: false,
        data: data.map((d) => String(d.year)),
        axisLabel: { color: t.inkSecondary, fontSize: 11 },
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
      yAxis: baseValueAxis(t),
      series: [
        {
          name: tr`European Union`,
          type: 'line',
          stack: 'total',
          areaStyle: { color: t.series[3], opacity: 0.45 },
          lineStyle: { color: t.series[3], width: 2 },
          itemStyle: { color: t.series[3] },
          data: data.map((d) => d.ue),
        },
        {
          name: tr`Outside EU`,
          type: 'line',
          stack: 'total',
          areaStyle: { color: t.series[4], opacity: 0.45 },
          lineStyle: { color: t.series[4], width: 2 },
          itemStyle: { color: t.series[4] },
          data: data.map((d) => d.outsideEu),
        },
      ],
    }),
    [data, t, tr],
  );

  return (
    <EChartCard
      title={tr`EU / outside EU by year`}
      option={option}
      exportName="ue-par-annee"
      height={300}
    />
  );
};
