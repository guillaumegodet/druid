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

/**
 * Scimago quartiles (SJR) — quality scale Q1 (best) → Q4, conventional
 * good→bad colors mapped onto the validated slots (blue, green, gold, red).
 */
export const QuartileChart: React.FC<{
  data: { key: string; count: number }[];
  /** Click on a bar (Q1…Q4) — opens the filtered list. */
  onSelect?: (key: string) => void;
}> = ({ data, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(() => {
    const colorByQuartile: Record<string, string> = {
      Q1: t.series[3],
      Q2: t.series[2],
      Q3: t.series[1],
      Q4: t.series[7],
    };
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => d.key) },
      yAxis: baseValueAxis(t),
      series: [
        {
          type: 'bar',
          data: data.map((d) => ({
            value: d.count,
            itemStyle: { color: colorByQuartile[d.key], borderRadius: [4, 4, 0, 0] },
          })),
          label: { show: true, position: 'top', fontSize: 11, color: t.inkSecondary },
          barWidth: '55%',
        },
      ],
    };
  }, [data, t]);

  return (
    <EChartCard
      title={tr`Scimago quartiles (SJR)`}
      subtitle={tr`Publications in ranked journals (known quartile)`}
      option={option}
      exportName="quartiles-scimago"
      height={300}
      onSeriesClick={
        onSelect ? (p) => data[p.dataIndex] && onSelect(data[p.dataIndex].key) : undefined
      }
    />
  );
};
