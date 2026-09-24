import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import { CountItem } from '../overviewAggregates';
import { useLingui } from '@lingui/react/macro';

/**
 * Publication types — horizontal bars, single series (same hue for every
 * bar: the length already carries the value), largest at the top.
 */
export const PublicationTypesChart: React.FC<{
  data: CountItem[];
  title?: string;
  exportName?: string;
  /** Click on a bar (document type) — opens the filtered list. */
  onSelect?: (key: string) => void;
}> = ({ data, title, exportName = 'types-publications', onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const sorted = useMemo(() => [...data].sort((a, b) => a.count - b.count), [data]);
  const option = useMemo(() => {
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      grid: { left: 8, right: 40, bottom: 8, top: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => (d.key === 'unknown' ? tr`Undetermined` : d.key)),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 170, overflow: 'truncate' as const },
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
  }, [sorted, t, tr]);

  return (
    <EChartCard
      title={title ?? tr`Publication types`}
      option={option}
      exportName={exportName}
      height={360}
      onSeriesClick={
        onSelect ? (p) => sorted[p.dataIndex] && onSelect(sorted[p.dataIndex].key) : undefined
      }
    />
  );
};
