// « Sustainable Development Goals » tab (druid-internal docs/plan-odd-sdg.md, lot 1): the 17 United Nations
// goals OpenAlex tags on the publications — key figures, breakdown, yearly evolution, goals per lab
// or team, impact per goal. A publication counts in each of its goals (decision D2); the
// « excluding SDG 3 » toggle (D5) lets the other goals be read where health dominates.
import React, { useMemo, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Globe, Leaf, Target, Layers } from 'lucide-react';
import {
  EChartCard,
  baseCategoryAxis,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  useVizTheme,
} from './EChartCard';
import { KpiCard } from './KpiCards';
import { StackedAreaChart, StackedBarHChart } from './charts/TeamCharts';
import { shareByCategory } from './phase4Aggregates';
import { PubFilters } from './publicationFilters';
import { SDG_OTHER_COLOR, sdgColor, sdgLabel, sdgOfLabel, sdgTitle, sdgUrl } from './sdg';
import { SdgAggregates, aggregateSdgs } from './sdgAggregates';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { numberLocale } from '../../lib/i18n';

/** Colours of the yearly series (top goals, then gray for « Other SDGs »). */
export const sdgSeriesColors = (agg: SdgAggregates): string[] =>
  agg.seriesGoals.map((g) => (g == null ? SDG_OTHER_COLOR : sdgColor(g)));

/** Horizontal bars of the goals present, official order and colours. */
export const SdgBarChart: React.FC<{
  agg: SdgAggregates;
  exportName?: string;
  onSelect?: (goal: number) => void;
}> = ({ agg, exportName = 'sdg-repartition', onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const nf = (n: number) => n.toLocaleString(numberLocale());
  // Reversed: ECharts draws the first category at the bottom.
  const rows = useMemo(() => [...agg.byGoal].reverse(), [agg.byGoal]);
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const r = rows[p[0].dataIndex];
          return `${sdgLabel(r.id)}<br/>${tr`${nf(r.count)} publication(s) — ${r.pctTagged} % of the tagged publications, ${r.pctTotal} % of the corpus`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: rows.map((r) => sdgLabel(r.id)),
        axisLabel: { color: t.inkSecondary, width: 230, overflow: 'truncate' as const, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((r) => ({ value: r.count, itemStyle: { color: sdgColor(r.id), borderRadius: [0, 4, 4, 0] } })),
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
        },
      ],
    }),
    [rows, t, tr],
  );
  return (
    <EChartCard
      title={tr`Publications by Sustainable Development Goal`}
      subtitle={tr`${nf(agg.tagged)} tagged publication(s) · a publication counts in each of its goals`}
      option={option}
      exportName={exportName}
      height={Math.max(260, rows.length * 32 + 80)}
      emptyMessage={rows.length ? undefined : tr`No publication tagged with a goal over the period.`}
      onSeriesClick={onSelect ? (p) => { const r = rows[p.dataIndex]; if (r) onSelect(r.id); } : undefined}
    />
  );
};

/** Share of the publications tagged with at least one goal, per year. */
export const SdgCoverageChart: React.FC<{ agg: SdgAggregates; exportName?: string }> = ({ agg, exportName = 'sdg-couverture' }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        formatter: (p: { dataIndex: number }[]) => {
          const r = agg.taggedByYear[p[0].dataIndex];
          return `${r.year}<br/>${tr`${r.tagged} / ${r.total} publications tagged (${r.pct} %)`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: agg.taggedByYear.map((r) => String(r.year)) },
      yAxis: { ...baseValueAxis(t), max: 100, axisLabel: { color: t.inkSecondary, formatter: '{value} %' } },
      series: [
        {
          type: 'line',
          smooth: true,
          data: agg.taggedByYear.map((r) => r.pct),
          itemStyle: { color: t.series[0] },
          areaStyle: { color: t.series[0], opacity: 0.12 },
          label: { show: true, position: 'top', fontSize: 10, color: t.inkSecondary, formatter: '{c} %' },
        },
      ],
    }),
    [agg.taggedByYear, t, tr],
  );
  return (
    <EChartCard
      title={tr`Share of publications tagged with a goal, by year`}
      subtitle={tr`Stability of the OpenAlex tagging over time; the untagged part is not a lack of data`}
      option={option}
      exportName={exportName}
      height={260}
    />
  );
};

const ImpactTable: React.FC<{ agg: SdgAggregates; onOpenList?: (filters: PubFilters) => void }> = ({ agg, onOpenList }) => {
  const { t: tr } = useLingui();
  const nf = (n: number) => n.toLocaleString(numberLocale());
  const pct = (v: number | null) => (v == null ? '—' : `${v} %`);
  return (
    <div className="glass-card flex flex-col">
      <div className="px-5 pt-4 pb-3">
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]"><Trans>Open access and impact by goal</Trans></h3>
        <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
          <Trans>Same rules as the Impact tab: FWCI mean on the publications with a value, top 10 % among them.</Trans>
        </p>
      </div>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
              <th className="px-3 py-2"><Trans>Goal</Trans></th>
              <th className="px-3 py-2 text-right"><Trans>Publications</Trans></th>
              <th className="px-3 py-2 text-right"><Trans>Open access</Trans></th>
              <th className="px-3 py-2 text-right"><Trans>Mean FWCI</Trans></th>
              <th className="px-3 py-2 text-right"><Trans>Top 10 %</Trans></th>
              <th className="px-3 py-2 text-right"><Trans>International</Trans></th>
            </tr>
          </thead>
          <tbody>
            {agg.impact.map((r) => (
              <tr key={r.id} className="border-t border-ink/5 dark:border-white/5">
                <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex w-7 h-7 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white" style={{ background: sdgColor(r.id) }}>{r.id}</span>
                    <a href={sdgUrl(r.id)} target="_blank" rel="noreferrer" className="hover:underline" title={tr`UN page of the goal`}>{sdgTitle(r.id)}</a>
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-semibold text-ink dark:text-[#f5f2ea]">
                  {onOpenList ? (
                    <button type="button" className="hover:underline" onClick={() => onOpenList({ sdg: r.id })}>{nf(r.count)}</button>
                  ) : nf(r.count)}
                </td>
                <td className="px-3 py-2 text-right">{pct(r.pctOpen)}</td>
                <td className="px-3 py-2 text-right">{r.fwciMean == null ? '—' : r.fwciMean.toLocaleString(numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2 text-right">{pct(r.pctTop10)}</td>
                <td className="px-3 py-2 text-right">{pct(r.pctInternational)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const SdgTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const nf = (n: number) => n.toLocaleString(numberLocale());
  const [excludeHealth, setExcludeHealth] = useState(false);
  const [groupMode, setGroupMode] = useState<'count' | 'share'>('share');
  const agg = useMemo(
    () => aggregateSdgs(dataset.publications, range, { exclude: excludeHealth ? [3] : [] }),
    [dataset.publications, range, excludeHealth],
  );
  const hasAny = dataset.publications.some((p) => (p.sdgs?.length ?? 0) > 0);
  const seriesColors = sdgSeriesColors(agg);
  const groupColors = agg.goals.map(sdgColor);
  const goalOfSeries = (name: string) => sdgOfLabel(name);

  if (!hasAny) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>No Sustainable Development Goal in this export: regenerate the dashboard of the structure (druid-biblio harvests the OpenAlex field since 2026-10-22).</Trans>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 px-1">
        <p className="text-sm text-muted dark:text-[#c3beb0] max-w-3xl">
          <Trans>
            Goals assigned by OpenAlex to each publication (Aurora classifier, only the goals above its threshold). About half of a corpus carries a goal: the untagged publications are not missing data. A publication counts in each of its goals.
          </Trans>
        </p>
        <label className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer select-none whitespace-nowrap">
          <input type="checkbox" className="accent-ink" checked={excludeHealth} onChange={(e) => setExcludeHealth(e.target.checked)} />
          <Trans>Excluding SDG 3 (health)</Trans>
        </label>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={tr`Publications with a goal`}
          value={nf(agg.tagged)}
          hint={agg.pctTagged == null ? undefined : tr`${agg.pctTagged} % of ${nf(agg.total)} publications`}
          icon={<Leaf className="w-5 h-5" />}
          color={t.series[0]}
          onClick={onOpenList ? () => onOpenList({ sdg: 'any' }) : undefined}
        />
        <KpiCard
          label={tr`Goals covered`}
          value={`${agg.covered} / 17`}
          icon={<Target className="w-5 h-5" />}
          color={t.series[2]}
        />
        <KpiCard
          label={tr`Main goal`}
          value={agg.top ? nf(agg.top.count) : '—'}
          hint={agg.top ? sdgLabel(agg.top.id) : undefined}
          icon={<Globe className="w-5 h-5" />}
          color={agg.top ? sdgColor(agg.top.id) : t.series[3]}
          onClick={onOpenList && agg.top ? () => onOpenList({ sdg: agg.top!.id }) : undefined}
        />
        <KpiCard
          label={tr`Goals per tagged publication`}
          value={agg.meanPerTagged == null ? '—' : agg.meanPerTagged.toLocaleString(numberLocale())}
          icon={<Layers className="w-5 h-5" />}
          color={t.series[4]}
        />
      </div>

      <SdgBarChart agg={agg} onSelect={onOpenList ? (goal) => onOpenList({ sdg: goal }) : undefined} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <StackedAreaChart
            title={tr`Yearly evolution by goal`}
            exportName="sdg-evolution"
            data={agg.byYear}
            colors={seriesColors}
            onSelect={onOpenList ? (name, year) => { const g = goalOfSeries(name); onOpenList(g == null ? { sdg: 'any', year } : { sdg: g, year }); } : undefined}
          />
        </div>
        <div className="lg:col-span-2">
          <SdgCoverageChart agg={agg} />
        </div>
      </div>

      {agg.byGroup.categories.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-end gap-1 px-1">
            {([['share', tr`Share (%)`], ['count', tr`Publications`]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setGroupMode(k)}
                className={`px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors ${
                  groupMode === k
                    ? 'bg-ink text-white border-ink dark:bg-[#f5f2ea] dark:text-[#1c1a14] dark:border-[#f5f2ea]'
                    : 'bg-white/60 dark:bg-white/10 border-ink/10 dark:border-white/15 text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <StackedBarHChart
            title={
              agg.groupKind === 'sousStructure'
                ? (groupMode === 'share' ? tr`Goals by lab (share of each lab's tagged publications)` : tr`Goals by lab`)
                : (groupMode === 'share' ? tr`Goals by team (share of each team's tagged publications)` : tr`Goals by team`)
            }
            exportName="sdg-equipes"
            data={groupMode === 'share' ? shareByCategory(agg.byGroup) : agg.byGroup}
            colors={groupColors}
            height={Math.max(260, agg.byGroup.categories.length * 34 + 90)}
            onSelect={onOpenList ? (category, name) => {
              const g = goalOfSeries(name);
              const base: PubFilters = g == null ? { sdg: 'any' } : { sdg: g };
              if (!category) onOpenList(base);
              else onOpenList(agg.groupKind === 'sousStructure' ? { ...base, sousStructure: category } : { ...base, team: category });
            } : undefined}
          />
        </div>
      )}

      <ImpactTable agg={agg} onOpenList={onOpenList} />
      <p className="text-xs text-muted-light dark:text-[#8f897c] px-1">
        <Trans>Official titles and colours of the United Nations. The figures are not comparable with rankings built on other classifiers (THE Impact Rankings, SciVal).</Trans>
      </p>
    </div>
  );
};
