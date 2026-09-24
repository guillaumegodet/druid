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
  data: { year: number; count: number }[];
  title?: string;
  exportName?: string;
  colorSlot?: number;
  /** Click on a bar (year) — opens the list filtered on the year. */
  onSelect?: (year: number) => void;
}

/** Publications per year — single series, direct labels at the top. */
export const YearlyEvolutionChart: React.FC<Props> = ({
  data,
  title,
  exportName = 'publications-par-annee',
  colorSlot = 0,
  onSelect,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      grid: { left: 8, right: 16, bottom: 8, top: 28, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: baseValueAxis(t),
      series: [
        {
          name: tr`Publications`,
          type: 'bar',
          data: data.map((d) => d.count),
          itemStyle: { color: t.series[colorSlot], borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', fontSize: 10, color: t.inkSecondary },
        },
      ],
    }),
    [data, t, colorSlot, tr],
  );

  return (
    <EChartCard
      title={title ?? tr`Publications per year`}
      option={option}
      exportName={exportName}
      onSeriesClick={
        onSelect ? (p) => data[p.dataIndex] && onSelect(data[p.dataIndex].year) : undefined
      }
    />
  );
};
