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
import { PartnerItem } from '../internationalAggregates';

/** Top foreign partner organizations — horizontal bars. */
export const TopPartnersChart: React.FC<{ data: PartnerItem[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.count - b.count);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number; value: number }[]) => {
          const item = sorted[p[0].dataIndex];
          const cc = item.cc ? ` (${item.cc})` : '';
          return `${item.name}${cc} : ${p[0].value}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.name),
        axisLabel: { color: t.inkSecondary, width: 220, overflow: 'truncate' as const, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => d.count),
          itemStyle: { color: t.series[5], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
        },
      ],
    };
  }, [data, t, tr]);

  return (
    <EChartCard
      title={tr`Top partner organisations`}
      subtitle={tr`Co-signing foreign organisations (number of publications)`}
      option={option}
      exportName="top-partenaires"
      height={520}
    />
  );
};
