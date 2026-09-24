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
import { IntlYearItem } from '../internationalAggregates';

/** International vs national — stacked bars (1px surface-colored separator). */
export const IntlVsNationalChart: React.FC<{ data: IntlYearItem[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

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
          name: tr`National`,
          type: 'bar',
          stack: 'total',
          data: data.map((d) => d.national),
          itemStyle: { color: t.series[3], borderColor: t.surface, borderWidth: 1 },
        },
        {
          name: tr({ message: `International`, context: "feminine plural" }),
          type: 'bar',
          stack: 'total',
          data: data.map((d) => d.international),
          itemStyle: { color: t.series[4], borderColor: t.surface, borderWidth: 1, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }),
    [data, t, tr],
  );

  return (
    <EChartCard
      title={tr`International vs national`}
      subtitle={tr`Publications whose international status is known`}
      option={option}
      exportName="international-vs-national"
    />
  );
};
