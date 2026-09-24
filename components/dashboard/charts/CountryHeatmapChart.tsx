import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { useLingui } from '@lingui/react/macro';
import { CountryHeatmap } from '../internationalAggregates';

/** Partner countries × years — heatmap (single-hue sequential ramp). */
export const CountryHeatmapChart: React.FC<{ data: CountryHeatmap }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(() => {
    const max = data.cells.reduce((m, c) => Math.max(m, c.v), 0);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        position: 'top',
        formatter: (p: { value: [number, number, number] }) => {
          const [x, y, v] = p.value;
          return `${data.countries[y]} — ${data.years[x]} : ${v}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 40, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: data.years.map(String),
        splitArea: { show: true, areaStyle: { color: [t.surface] } },
        axisLabel: { color: t.inkSecondary, fontSize: 11 },
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category' as const,
        data: data.countries,
        splitArea: { show: true, areaStyle: { color: [t.surface] } },
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 120, overflow: 'truncate' as const },
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
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
          data: data.cells.map((c) => [c.x, c.y, c.v]),
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
          label: { show: false },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' } },
        },
      ],
    };
  }, [data, t, tr]);

  return (
    <EChartCard
      title={tr`Partner countries by year`}
      option={option}
      exportName="pays-annees"
      height={420}
    />
  );
};
