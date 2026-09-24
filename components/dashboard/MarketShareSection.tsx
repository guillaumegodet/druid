import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { CountryName, DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import {
  MarketDimension,
  buildMarketIndex,
  computeMarketShare,
} from './internationalAggregates';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseCategoryAxis,
  useVizTheme,
} from './EChartCard';
import { numberLocale } from '../../lib/i18n';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

const DIMENSIONS: { key: MarketDimension; label: MessageDescriptor }[] = [
  { key: 'country', label: msg`Country` },
  { key: 'team', label: msg`Team` },
  { key: 'org', label: msg`Organisation` },
];

/** Selection / rest of the corpus donut. */
const ShareDonut: React.FC<{ selected: number; total: number; pct: number | null }> = ({
  selected,
  total,
  pct,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'item', formatter: '{b} : {c} ({d} %)', ...baseTooltip(t) },
      series: [
        {
          type: 'pie',
          radius: ['55%', '78%'],
          center: ['50%', '50%'],
          itemStyle: { borderColor: t.surface, borderWidth: 2 },
          label: { show: false },
          data: [
            { name: tr`Selection`, value: selected, itemStyle: { color: t.series[4] } },
            { name: tr`Rest of the corpus`, value: Math.max(0, total - selected), itemStyle: { color: t.grid } },
          ],
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'center',
          style: {
            text: pct != null ? `${pct} %` : '—',
            fontSize: 22,
            fontWeight: 'bold',
            fill: t.ink,
            fontFamily: "'Schibsted Grotesk', system-ui, sans-serif",
          },
        },
      ],
    }),
    [selected, total, pct, t, tr],
  );
  return (
    <EChartCard
      title={tr`Share of the corpus`}
      subtitle={tr`${selected.toLocaleString(numberLocale())} / ${total.toLocaleString(numberLocale())} publications`}
      option={option}
      exportName="part-de-marche"
      height={260}
      shareable={false}
    />
  );
};

/** Line of the selection's yearly share (%). */
const ShareEvolution: React.FC<{ data: { year: number; pct: number }[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const ymax = Math.max(5, ...data.map((d) => d.pct * 1.2));
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v} %`, ...baseTooltip(t) },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: {
        type: 'value' as const,
        min: 0,
        max: Math.ceil(ymax),
        axisLabel: { formatter: '{value} %', color: t.inkMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 8,
          data: data.map((d) => d.pct),
          lineStyle: { color: t.series[4], width: 2 },
          itemStyle: { color: t.series[4], borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: t.series[4], opacity: 0.1 },
        },
      ],
    };
  }, [data, t]);
  return (
    <EChartCard
      title={tr`Yearly share of the selection`}
      option={option}
      exportName="part-de-marche-evolution"
      height={260}
      shareable={false}
    />
  );
};

/**
 * « Part de marché et évolution »: weight of a selection (country, team or
 * foreign organization) in the filtered corpus, and its yearly evolution.
 * Port of the Streamlit interactive block (not shareable: exploratory).
 */
export const MarketShareSection: React.FC<{
  publications: DashboardPublication[];
  range: YearRange;
  countryNames: Record<string, CountryName>;
  /** D3: publications already filtered by period (cf. InternationalAggregates.inRange),
   * so as not to redo it on every dimension change (country/team/organization). */
  inRange?: DashboardPublication[];
}> = ({ publications, range, countryNames, inRange }) => {
  const { t, i18n } = useLingui();
  const [dim, setDim] = useState<MarketDimension>('country');
  const [selection, setSelection] = useState<string[]>([]);

  const hasTeamData = useMemo(
    () => publications.some((p) => p.teams.some((t) => t && t !== 'Non identifié')),
    [publications],
  );
  const dims = DIMENSIONS.filter((d) => d.key !== 'team' || hasTeamData);
  // `dim` may get stuck on 'team' if a filter change later makes the team data disappear
  // (hasTeamData becomes false, 'team' leaves dims): no button remained active, yet the
  // index kept being computed on the removed dimension (review lot 9c, same defect as the
  // one fixed in ImpactTab.tsx::grouping).
  useEffect(() => {
    if (!dims.some((d) => d.key === dim)) setDim(dims[0]?.key ?? 'country');
  }, [dims, dim]);

  const index = useMemo(
    () => buildMarketIndex(publications, range, dim, countryNames, inRange),
    [publications, range, dim, countryNames, inRange, i18n.locale],
  );

  // Effective selection: by default, the first value of the ranking.
  const effective = useMemo(() => {
    const valid = selection.filter((v) => index.byValue.has(v));
    return valid.length ? valid : index.ranking.slice(0, 1);
  }, [selection, index]);

  const share = useMemo(() => computeMarketShare(index, effective), [index, effective]);

  const dimBtn = (active: boolean) =>
    `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
      active
        ? 'bg-ink text-white dark:bg-accent dark:text-ink'
        : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
    }`;

  if (index.ranking.length === 0) {
    return null;
  }

  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div>
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
          <Trans>Market share and evolution</Trans>
        </h3>
        <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
          <Trans>
            Weight of a selection (country, team or foreign organisation) in the whole filtered corpus, and its evolution over time.
          </Trans>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          {dims.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={dimBtn(dim === key)}
              onClick={() => {
                setDim(key);
                setSelection([]);
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <select
          className="input-soft !w-auto py-1.5 pr-7 text-sm cursor-pointer"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v && !effective.includes(v)) setSelection([...effective, v]);
          }}
        >
          <option value="">{t`Add to the selection…`}</option>
          {index.ranking.slice(0, 60).map((v) => (
            <option key={v} value={v} disabled={effective.includes(v)}>
              {v}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-1.5">
          {effective.map((v) => (
            <span
              key={v}
              className="pill px-2.5 py-1 text-xs bg-accent/25 dark:bg-accent/15 text-ink dark:text-accent"
            >
              {v}
              <button
                type="button"
                title={t`Remove`}
                className="ml-1 opacity-60 hover:opacity-100"
                onClick={() => setSelection(effective.filter((x) => x !== v))}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <ShareDonut selected={share.selected} total={share.total} pct={share.pct} />
        </div>
        <div className="lg:col-span-3">
          <ShareEvolution data={share.shareByYear} />
        </div>
      </div>
    </div>
  );
};
