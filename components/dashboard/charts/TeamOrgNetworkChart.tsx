import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { useLingui } from '@lingui/react/macro';
import { TeamOrgNetwork } from '../internationalAggregates';

/** Bipartite network teams ↔ foreign organizations (color = team, square = organization). */
export const TeamOrgNetworkChart: React.FC<{ data: TeamOrgNetwork }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(() => {
    const maxVal = data.nodes.reduce((m, n) => Math.max(m, n.value), 1);
    return {
      textStyle: baseTextStyle(t),
      tooltip: { ...baseTooltip(t) },
      legend: [{
        data: data.categories.map((c) => c.name),
        bottom: 0,
        type: 'scroll' as const,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      }],
      color: [...t.series.slice(0, data.categories.length - 1), '#8c8677'],
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          categories: data.categories,
          force: { repulsion: 140, edgeLength: [40, 160], gravity: 0.12 },
          label: { show: true, position: 'right', fontSize: 9, color: t.inkSecondary, formatter: '{b}' },
          labelLayout: { hideOverlap: true },
          emphasis: { focus: 'adjacency', label: { show: true } },
          lineStyle: { color: 'source', curveness: 0.1, opacity: 0.5 },
          nodes: data.nodes.map((n) => ({
            id: n.id,
            name: n.name,
            value: n.value,
            category: n.category,
            symbol: n.isOrg ? 'rect' : 'circle',
            symbolSize: 10 + (n.value / maxVal) * 28,
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
  }, [data, t, tr]);

  return (
    <EChartCard
      title={tr`Network teams ↔ foreign organisations`}
      subtitle={tr`Main partner organisations; square = organisation, circle = team`}
      option={option}
      exportName="reseau-equipes-organismes"
      height={560}
    />
  );
};
