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
import { countryLabel } from '../labels';
import { CountryItem } from '../internationalAggregates';

/**
 * Top partner countries — horizontal bars, single hue (the length carries
 * the value; the mockup re-colored by value, which was redundant).
 */
export const TopCountriesChart: React.FC<{ data: CountryItem[]; top?: number }> = ({
  data,
  top = 20,
}) => {
  const t = useVizTheme();
  const { t: tr, i18n } = useLingui();

  const option = useMemo(() => {
    const sorted = data.slice(0, top).sort((a, b) => a.count - b.count);
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      grid: { left: 8, right: 36, top: 8, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => countryLabel(d.iso2, { [d.iso2]: d })),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 140, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => d.count),
          itemStyle: { color: t.series[3], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
        },
      ],
    };
  }, [data, top, t, tr, i18n.locale]);

  return (
    <EChartCard
      title={tr`Top partner countries`}
      option={option}
      exportName="top-pays"
      height={460}
    />
  );
};
