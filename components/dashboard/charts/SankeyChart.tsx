import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { FlowNode, FlowLink } from '../internationalAggregates';
import { useLingui } from '@lingui/react/macro';

/** Team → country → organization flows — Sankey diagram. */
export const SankeyChart: React.FC<{
  nodes: FlowNode[];
  links: FlowLink[];
  height?: number;
  title?: string;
  subtitle?: string;
  exportName?: string;
  headerExtra?: React.ReactNode;
}> = ({
  nodes,
  links,
  height = 520,
  title,
  subtitle,
  exportName = 'flux-sankey',
  headerExtra,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'item', triggerOn: 'mousemove', ...baseTooltip(t) },
      color: t.series,
      series: [
        {
          type: 'sankey',
          data: nodes.map((n) => ({ name: n.name, depth: n.depth })),
          links,
          emphasis: { focus: 'adjacency' },
          nodeAlign: 'left',
          lineStyle: { color: 'gradient', opacity: 0.4, curveness: 0.5 },
          label: { fontSize: 10, color: t.inkSecondary },
        },
      ],
    }),
    [nodes, links, t],
  );

  return (
    <EChartCard
      title={title ?? tr`Flows team → country → organisation`}
      subtitle={subtitle ?? tr`Main foreign partner organisations`}
      option={option}
      exportName={exportName}
      height={height}
      headerExtra={headerExtra}
    />
  );
};
