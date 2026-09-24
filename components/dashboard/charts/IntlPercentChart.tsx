import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import { useLingui } from '@lingui/react/macro';

/** Share of international publications per year — line + area. */
export const IntlPercentChart: React.FC<{ data: { year: number; pct: number }[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number) => `${v} %`,
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: {
        type: 'value' as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value} %', color: t.inkMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
      },
      series: [
        {
          name: tr`International share`,
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 8,
          data: data.map((d) => d.pct),
          lineStyle: { color: t.series[4], width: 2 },
          itemStyle: { color: t.series[4], borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: t.series[4], opacity: 0.12 },
        },
      ],
    }),
    [data, t, tr],
  );

  return (
    <EChartCard
      title={tr`Share of international publications`}
      option={option}
      exportName="pourcentage-international"
      height={300}
    />
  );
};
