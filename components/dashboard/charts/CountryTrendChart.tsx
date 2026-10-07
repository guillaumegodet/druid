import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseCategoryAxis,
  baseValueAxis,
  useVizTheme,
} from '../EChartCard';
import { useLingui } from '@lingui/react/macro';
import { numberLocale } from '../../../lib/i18n';

/**
 * Co-publications with a country per year (bars) and their share of the international
 * co-publications (line, right axis) — block B of the « Pays » sub-tab.
 */
export const CountryTrendChart: React.FC<{
  data: { year: number; count: number; international: number; share: number | null }[];
  country: string;
  onYearClick?: (year: number) => void;
}> = ({ data, country, onYearClick }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      legend: {
        bottom: 0,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: 8, right: 8, top: 16, bottom: 36, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: [
        baseValueAxis(t),
        {
          type: 'value' as const,
          min: 0,
          axisLabel: { formatter: '{value} %', color: t.inkMuted, fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: tr`Co-publications`,
          type: 'bar',
          data: data.map((d) => d.count),
          itemStyle: { color: t.series[3], borderRadius: [4, 4, 0, 0] },
          tooltip: { valueFormatter: (v: number) => v.toLocaleString(numberLocale()) },
        },
        {
          name: tr`Share of the international co-publications`,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 7,
          data: data.map((d) => d.share),
          lineStyle: { color: t.series[4], width: 2 },
          itemStyle: { color: t.series[4], borderColor: t.surface, borderWidth: 2 },
          tooltip: { valueFormatter: (v: number | null) => (v == null ? '—' : `${v.toLocaleString(numberLocale())} %`) },
        },
      ],
    }),
    [data, t, tr],
  );

  return (
    <EChartCard
      title={tr`Co-publications with ${country} per year`}
      option={option}
      exportName="pays-evolution"
      height={320}
      onSeriesClick={onYearClick ? (p) => onYearClick(data[p.dataIndex].year) : undefined}
    />
  );
};
