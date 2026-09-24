import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import { FWCI_REFERENCE, FWCI_BIN_WIDTH } from '../impactAggregates';
import { useLingui } from '@lingui/react/macro';

/** FWCI distribution — histogram with a « world average = 1 » marker. */
export const FwciHistogramChart: React.FC<{ data: { label: string; count: number }[] }> = ({
  data,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(() => {
    // index of the bin containing the FWCI = 1.0 reference (bin width 0.5)
    const refIndex = FWCI_REFERENCE / FWCI_BIN_WIDTH;
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        ...baseCategoryAxis(t),
        data: data.map((d) => d.label),
        name: 'FWCI',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: t.inkMuted, fontSize: 11 },
        axisLabel: { color: t.inkSecondary, fontSize: 11, interval: 1 },
      },
      yAxis: baseValueAxis(t),
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.count),
          itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
          barCategoryGap: '10%',
          markLine: {
            symbol: 'none',
            lineStyle: { color: t.inkMuted, type: 'dashed' },
            label: {
              formatter: tr`World average (1.0)`,
              position: 'end',
              color: t.inkSecondary,
              fontSize: 10,
            },
            data: [{ xAxis: refIndex }],
          },
        },
      ],
    };
  }, [data, t, tr]);

  return (
    <EChartCard
      title={tr`FWCI distribution`}
      subtitle={tr`Field-Weighted Citation Impact — field-normalised citation impact (long tail folded)`}
      option={option}
      exportName="distribution-fwci"
    />
  );
};
