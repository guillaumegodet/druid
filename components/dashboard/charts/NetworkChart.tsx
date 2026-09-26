import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { NetworkData } from '../networkAggregates';
import { useLingui } from '@lingui/react/macro';

/**
 * Inter-lab rendering (docs/plan-reseau-inter-labos.md, lots 3 and 4): colour = lab, aggregated
 * lab nodes drawn as diamonds, authors of several labs outlined, cross-lab links emphasized.
 */
export interface InterLabRendering {
  /** Display name of a category (translates the aggregated « other labs » category). */
  categoryLabel: (name: string) => string;
  /** Click on a link: the ids of its two nodes. */
  onLinkClick?: (source: string, target: string) => void;
}

/** Internal co-authorship network — force graph (color = team, or lab in inter-lab mode). */
export const NetworkChart: React.FC<{
  data: NetworkData;
  headerExtra?: React.ReactNode;
  toolbar?: React.ReactNode;
  interLab?: InterLabRendering;
  emptyMessage?: string;
}> = ({ data, headerExtra, toolbar, interLab, emptyMessage }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(() => {
    const maxVal = data.nodes.reduce((m, n) => (n.kind === 'lab' ? m : Math.max(m, n.value)), 1);
    const catLabel = (name: string) => (interLab ? interLab.categoryLabel(name) : name);
    const nodeName = new Map(data.nodes.map((n) => [n.id, n.name]));
    const hasCross = data.links.some((l) => l.cross);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        ...baseTooltip(t),
        formatter: interLab
          ? (p: { dataType?: string; data: Record<string, unknown> }) => {
            const d = p.data;
            const count = String(d.value);
            if (p.dataType === 'edge') {
              const from = nodeName.get(String(d.source)) ?? '';
              const to = nodeName.get(String(d.target)) ?? '';
              return tr`${from} — ${to}: ${count} co-publications`;
            }
            const name = String(d.name);
            if (d.kind === 'lab') return tr`${name} (lab): ${count} co-publications`;
            const labs = (d.labs as string[] | undefined)?.join(', ') ?? '';
            return tr`${name} (${labs}): ${count} publications`;
          }
          : undefined,
      },
      legend: data.categories.length > 1
        ? [{
            data: data.categories.map((c) => catLabel(c.name)),
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
          categories: data.categories.map((c) => ({ name: catLabel(c.name) })),
          force: { repulsion: 90, edgeLength: [30, 120], gravity: 0.1 },
          // Halo in the surface colour keeps names readable over links and nodes.
          label: {
            show: true,
            position: 'right',
            fontSize: 12,
            color: t.ink,
            textBorderColor: t.surface,
            textBorderWidth: 3,
            formatter: '{b}',
          },
          // Overlapping labels are hidden, largest nodes first kept (ECharts priority = node area).
          labelLayout: { hideOverlap: true },
          emphasis: { focus: 'adjacency', label: { show: true, fontSize: 14, fontWeight: 'bold' } },
          lineStyle: { color: 'source', curveness: 0.1, opacity: 0.5 },
          nodes: data.nodes.map((n) => {
            const isLab = n.kind === 'lab';
            const multiLab = (n.labs?.length ?? 0) > 1;
            return {
              id: n.id,
              name: n.name,
              value: n.value,
              category: n.category,
              kind: n.kind,
              labs: n.labs,
              symbol: isLab ? 'diamond' : 'circle',
              symbolSize: isLab
                ? 18 + Math.min(n.value, 200) / 200 * 22
                : 8 + (n.value / maxVal) * 32,
              // Authors of several labs: outlined, they are the bridges between labs.
              itemStyle: multiLab ? { borderColor: t.ink, borderWidth: 2 } : undefined,
              // Most prolific authors get a slightly larger name (12 → 15 px); lab nodes in bold.
              label: isLab
                ? { fontSize: 13, fontWeight: 'bold' }
                : { fontSize: Math.round(12 + (n.value / maxVal) * 3) },
            };
          }),
          links: data.links.map((l) => ({
            source: l.source,
            target: l.target,
            value: l.value,
            // Inter-lab mode: cross-lab links stand out, links inside a lab fade.
            lineStyle: hasCross
              ? l.cross
                ? { width: Math.min(1.5 + l.value, 7), opacity: 0.85 }
                : { width: Math.min(1 + l.value, 4), opacity: 0.18 }
              : { width: Math.min(1 + l.value, 6) },
          })),
        },
      ],
    };
  }, [data, t, tr, interLab]);

  const onSeriesClick = useMemo(() => {
    const onLinkClick = interLab?.onLinkClick;
    if (!onLinkClick) return undefined;
    return (p: { dataType?: string; data?: unknown }) => {
      if (p.dataType !== 'edge') return;
      const d = p.data as { source?: unknown; target?: unknown };
      onLinkClick(String(d.source), String(d.target));
    };
  }, [interLab]);

  return (
    <EChartCard
      title={interLab ? tr`Co-authorship network between labs` : tr`Co-authorship network`}
      subtitle={interLab
        ? tr`University authors; size = number of publications, colour = lab. Click a link to list the co-publications.`
        : tr`Internal authors; size = number of publications, colour = team`}
      option={option}
      exportName={interLab ? 'reseau-inter-labos' : 'reseau-cosignatures'}
      height={interLab ? 640 : 560}
      headerExtra={headerExtra}
      toolbar={toolbar}
      emptyMessage={emptyMessage}
      shareable={!interLab}
      onSeriesClick={onSeriesClick}
    />
  );
};
