import React, { useMemo, useState } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import { JournalRow } from '../phase4Aggregates';
import { Trans, useLingui } from '@lingui/react/macro';

/** Linear interpolation over a hexadecimal color ramp (t ∈ [0,1]). */
function rampColor(ramp: string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  const c = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const [a, b] = [c(ramp[i]), c(ramp[i + 1])];
  const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Most frequent journals — horizontal bars colored by open-access % (0-100
 * sequential ramp), adjustable number of journals, ISSN and OA % on hover.
 * Port of the Streamlit « 🏆 Revues les plus fréquentes » chart.
 */
export const TopJournalsChart: React.FC<{ rows: JournalRow[]; defaultN?: number }> = ({
  rows,
  defaultN = 20,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const maxN = Math.min(50, rows.length);
  const [topN, setTopN] = useState(Math.min(defaultN, maxN));

  const option = useMemo(() => {
    const top = rows.slice(0, topN).sort((a, b) => a.publications - b.publications);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const r = top[p[0].dataIndex];
          const issn = r.issn ?? '—';
          return `${r.journal}<br/>${tr`ISSN: ${issn}`}<br/>${tr`${r.publications} pub. — ${r.pctOpen}% open access`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 36, top: 8, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: top.map((r) => (r.journal.length > 55 ? `${r.journal.slice(0, 55)}…` : r.journal)),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 260, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: top.map((r) => ({
            value: r.publications,
            itemStyle: { color: rampColor(t.seqRamp, r.pctOpen / 100), borderRadius: [0, 4, 4, 0] },
          })),
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
        },
      ],
    };
  }, [rows, topN, t, tr]);

  const selector =
    maxN > 5 ? (
      <label className="flex items-center gap-1.5 text-xs text-muted dark:text-[#c3beb0] mr-2">
        <Trans>Journals: {topN}</Trans>
        <input
          type="range"
          min={5}
          max={maxN}
          step={1}
          value={topN}
          onChange={(e) => setTopN(Number(e.target.value))}
          className="accent-[#7048e8] w-28"
        />
      </label>
    ) : undefined;

  const legend = (
    <div className="flex items-center gap-2 px-5 pb-3 text-[11px] text-muted-light dark:text-[#8f897c]">
      <span>0 %</span>
      <span
        className="h-2 w-32 rounded-full"
        style={{ background: `linear-gradient(to right, ${t.seqRamp.join(', ')})` }}
      />
      <span><Trans>100% open access</Trans></span>
    </div>
  );

  return (
    <div className="flex flex-col">
      <EChartCard
        title={tr`Most frequent journals`}
        subtitle={tr`Colour ∝ share of the journal's publications in open access`}
        option={option}
        exportName="top-revues"
        headerExtra={selector}
        height={Math.max(350, topN * 24 + 90)}
      />
      {legend}
    </div>
  );
};
