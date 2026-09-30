import React, { useMemo } from 'react';
import * as echarts from 'echarts/core';
import { MarkAreaComponent } from 'echarts/components';
import { useLingui } from '@lingui/react/macro';
import { EChartCard, baseTextStyle, baseTooltip, baseValueAxis, baseCategoryAxis, useVizTheme } from '../dashboard/EChartCard';
import { type TimelineRow, yearOf } from '../../lib/affiliationHistory';

echarts.use([MarkAreaComponent]);

interface Props {
  rows: TimelineRow[];
  range: [number, number];
  /** Employment period entered in Druid (grey band), fuzzy dates. */
  employment: { start?: string; end?: string };
  now: number;
  onRowClick?: (row: TimelineRow) => void;
}

const truncate = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/**
 * « Parcours » timeline (docs/plan-parcours-affiliations.md, lot 3): one row per establishment, years on
 * the x axis. Publications = dots sized by the count of the year; ORCID periods = thin bars (dashed when
 * ongoing); the employment period entered in Druid = grey band behind. Emphasis form: local in the
 * green slot, elsewhere in the blue slot, neutral organisms in the muted ink (validated palette of
 * components/dashboard/palette.ts). The name of the row carries the identity, colour only the class.
 */
export const AffiliationTimelineChart: React.FC<Props> = ({ rows, range, employment, now, onRowClick }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const color = { local: t.series[2], other: t.series[3], neutral: t.inkMuted, unknown: t.inkMuted };
    const label = { local: tr`Local (the institution and its site)`, other: tr`Elsewhere`, neutral: tr`National organism`, unknown: tr`Unresolved` };
    const names = rows.map((r) => truncate(r.name));
    const [lo, hi] = range;
    const dots = (cls: 'local' | 'other' | 'neutral') => rows.flatMap((r, i) => (r.cls === cls
      ? Object.entries(r.byYear).map(([y, n]) => ({ value: [parseInt(y, 10), i, n], name: r.name }))
      : []));
    // ORCID periods: segments [start, end] on the row; `null` points break the line between segments.
    const segments = (ongoing: boolean) => rows.flatMap((r, i) => r.periods.filter((p) => !p.end === ongoing && yearOf(p.start)).flatMap((p) => {
      const s = Math.max(yearOf(p.start) as number, lo - 0.5);
      const e = p.end ? Math.min(yearOf(p.end) as number, hi) + 0.4 : hi + 0.4;
      return [{ value: [s - 0.4, i], period: p, row: r.name }, { value: [e, i], period: p, row: r.name }, { value: [null, null] }];
    }));
    const es = yearOf(employment.start);
    const ee = employment.end ? yearOf(employment.end) : now;
    const band = es ? [[{ xAxis: Math.max(es, lo) - 0.5, name: tr`Employment in Druid` }, { xAxis: Math.min(ee || now, hi) + 0.5 }]] : [];
    const dotSeries = (['local', 'other', 'neutral'] as const).map((cls, k) => ({
      name: label[cls],
      type: 'scatter',
      data: dots(cls),
      symbolSize: (v: number[]) => Math.min(26, 7 + 4 * Math.sqrt(v[2])),
      itemStyle: { color: color[cls], borderColor: t.surface, borderWidth: 2 },
      emphasis: { scale: 1.15 },
      z: 3,
      ...(k === 0 && band.length ? { markArea: { silent: true, itemStyle: { color: t.grid, opacity: 0.55 }, label: { color: t.inkMuted, fontSize: 10, position: 'insideTop' }, data: band } } : {}),
    }));
    const periodSeries = [false, true].map((ongoing) => ({
      name: ongoing ? tr`ORCID position (ongoing)` : tr`ORCID position`,
      type: 'line',
      data: segments(ongoing),
      connectNulls: false,
      symbol: 'none',
      lineStyle: { width: 4, color: t.inkSecondary, opacity: 0.55, type: ongoing ? 'dashed' : 'solid', cap: 'round' },
      itemStyle: { color: t.inkSecondary },
      z: 2,
    }));
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'item',
        ...baseTooltip(t),
        formatter: (p: { seriesType: string; data: { value: number[]; name?: string; period?: { name: string; role: string; start: string; end: string; kind: string }; row?: string } }) => {
          if (p.seriesType === 'scatter') {
            const [y, , n] = p.data.value;
            return `<b>${escapeHtml(p.data.name || '')}</b><br/>${y} · ${tr`${n} publication(s)`}`;
          }
          const per = p.data.period;
          if (!per) return '';
          return `<b>${escapeHtml(per.name)}</b><br/>${per.kind === 'invited' ? tr`ORCID invited position` : tr`ORCID position`}${per.role ? ` · ${escapeHtml(per.role)}` : ''}<br/>${escapeHtml(per.start || '?')} – ${escapeHtml(per.end || tr`ongoing`)}`;
        },
      },
      legend: {
        bottom: 0,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        itemWidth: 14,
        itemHeight: 10,
        data: [...dotSeries.filter((s) => s.data.length).map((s) => ({ name: s.name, icon: 'circle' })), ...periodSeries.filter((s) => s.data.length).map((s) => ({ name: s.name, icon: 'roundRect' }))],
      },
      grid: { left: 8, right: 20, top: 12, bottom: 36, containLabel: true },
      xAxis: { ...baseValueAxis(t), min: lo - 0.6, max: hi + 0.6, minInterval: 1, splitLine: { show: false }, axisLabel: { color: t.inkMuted, fontSize: 11, formatter: (v: number) => (Number.isInteger(v) ? String(v) : '') } },
      yAxis: { ...baseCategoryAxis(t), data: names, inverse: true, splitLine: { show: true, lineStyle: { color: t.grid } } },
      series: [...periodSeries, ...dotSeries],
    };
  }, [rows, range, employment.start, employment.end, now, t, tr]);

  return (
    <EChartCard
      title={tr`Affiliations over time`}
      subtitle={tr`Dots: publications of the year · bars: positions declared in ORCID · grey band: employment entered in Druid`}
      option={option}
      exportName="parcours-chercheur"
      height={Math.max(180, 70 + rows.length * 30)}
      shareable={false}
      onSeriesClick={onRowClick ? (p) => { const v = (p.data as { value?: number[] } | undefined)?.value; const r = v && typeof v[1] === 'number' ? rows[v[1]] : undefined; if (r) onRowClick(r); } : undefined}
    />
  );
};
