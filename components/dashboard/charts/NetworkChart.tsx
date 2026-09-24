import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { NetworkData } from '../networkAggregates';
import { useLingui } from '@lingui/react/macro';

/** Internal co-authorship network — force graph (color = team). */
export const NetworkChart: React.FC<{ data: NetworkData; headerExtra?: React.ReactNode }> = ({
  data,
  headerExtra,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(() => {
    const maxVal = data.nodes.reduce((m, n) => Math.max(m, n.value), 1);
    return {
      textStyle: baseTextStyle(t),
      tooltip: { ...baseTooltip(t) },
      legend: data.categories.length > 1
        ? [{
            data: data.categories.map((c) => c.name),
            bottom: 0,
            type: 'scroll' as const,
            textStyle: { color: t.inkSecondary, fontSize: 11 },
            icon: 'circle',
            itemWidth: 10,
            itemHeight: 10,
          }]
        : undefined,
      color: t.series,
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          categories: data.categories,
          force: { repulsion: 90, edgeLength: [30, 120], gravity: 0.1 },
          label: { show: true, position: 'right', fontSize: 9, color: t.inkSecondary, formatter: '{b}' },
          labelLayout: { hideOverlap: true },
          emphasis: { focus: 'adjacency', label: { show: true } },
          lineStyle: { color: 'source', curveness: 0.1, opacity: 0.5 },
          nodes: data.nodes.map((n) => ({
            id: n.id,
            name: n.name,
            value: n.value,
            category: n.category,
            symbolSize: 8 + (n.value / maxVal) * 32,
          })),
          links: data.links.map((l) => ({
            source: l.source,
            target: l.target,
            value: l.value,
            lineStyle: { width: Math.min(1 + l.value, 6) },
          })),
        },
      ],
    };
  }, [data, t]);

  return (
    <EChartCard
      title={tr`Co-authorship network`}
      subtitle={tr`Internal authors; size = number of publications, colour = team`}
      option={option}
      exportName="reseau-cosignatures"
      height={560}
      headerExtra={headerExtra}
    />
  );
};
