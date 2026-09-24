import React, { useMemo, useState } from 'react';
import { Landmark, Banknote, FolderKanban, Award, Download } from 'lucide-react';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { hasSubStructures } from './collabAggregates';
import { KpiCard } from './KpiCards';
import {
  aggregateFunders,
  aggregateCategoryByLabo,
  FUNDER_CATEGORIES,
  CATEGORY_COLOR_SLOT,
  FunderCount,
  LaboCategoryRow,
  FundersAggregates,
} from './fundersAggregates';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from './EChartCard';
import { numberLocale } from '../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

const PAGE_SIZE = 25;
const nf = (v: number) => v.toLocaleString(numberLocale());

/** Displayed labels of the funder categories (keys = FunderCategory, stable in the data). */
const CATEGORY_LABELS: Record<string, MessageDescriptor> = {
  ANR: msg`ANR`,
  Europe: msg`Europe`,
  'Recherche nationale': msg`National research`,
  Régional: msg`Regional`,
  International: msg`International`,
  'Privé / fondations': msg`Private / foundations`,
  Autre: msg`Other`,
};

/** Top funders (horizontal bars), each bar colored by category. */
export const FundersTopChart: React.FC<{ data: FunderCount[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.count - b.count);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = sorted[p[0].dataIndex];
          return `${d.name}<br/>${tr`${nf(d.count)} publication(s)`}<br/><span style="opacity:.7">${tr(CATEGORY_LABELS[d.category])}</span>`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), name: tr`publications`, nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.name),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 240, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => ({
            value: d.count,
            itemStyle: { color: t.series[CATEGORY_COLOR_SLOT[d.category]], borderRadius: [0, 4, 4, 0] },
          })),
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
        },
      ],
    };
  }, [data, t, tr]);
  return (
    <EChartCard
      title={tr`Main funders`}
      subtitle={tr`Number of publications acknowledging each funder · colour = category · top 15`}
      option={option}
      exportName="funders-top"
      height={Math.max(340, data.length * 26 + 90)}
    />
  );
};

/** Breakdown of funded publications by funder category (donut). */
export const FundersCategoryChart: React.FC<{ data: { category: string; count: number }[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/>${tr`${nf(p.value)} publication(s)`} — ${p.percent}%`,
        ...baseTooltip(t),
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: t.surface, borderWidth: 2 },
          label: { show: false },
          data: data.map((d) => ({
            name: CATEGORY_LABELS[d.category] ? tr(CATEGORY_LABELS[d.category]) : d.category,
            value: d.count,
            itemStyle: {
              color: t.series[CATEGORY_COLOR_SLOT[d.category as keyof typeof CATEGORY_COLOR_SLOT] ?? 7],
            },
          })),
        },
      ],
    }),
    [data, t, tr],
  );
  return (
    <EChartCard
      title={tr`Breakdown by funder category`}
      subtitle={tr`ANR / Europe / national research / regional / international / private · a publication may count in several categories`}
      option={option}
      exportName="funders-categories"
      height={360}
    />
  );
};

/** Funding coverage per year: funded publications vs total (bars). */
export const FundersYearChart: React.FC<{ data: FundersAggregates['byYear'] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = data[p[0].dataIndex];
          const pct = d.total ? Math.round((d.funded / d.total) * 100) : 0;
          return tr`${d.year}: ${nf(d.funded)} funded publication(s) out of ${nf(d.total)} — ${pct}%`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: {
        ...baseValueAxis(t),
        name: tr`funded publications`,
        nameTextStyle: { color: t.inkMuted, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.funded),
          itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
          label: {
            show: true,
            position: 'top',
            fontSize: 10,
            color: t.inkSecondary,
            formatter: (p: { dataIndex: number }) => {
              const d = data[p.dataIndex];
              return d.total ? `${Math.round((d.funded / d.total) * 100)}%` : '';
            },
          },
        },
      ],
    }),
    [data, t, tr],
  );
  return (
    <EChartCard
      title={tr`Funded publications per year`}
      subtitle={tr`Bars = publications acknowledging ≥ 1 funder · label = share of the year's corpus`}
      option={option}
      exportName="funders-evolution"
    />
  );
};

/** Breakdown of funders per Structure (stacked bars lab × category). */
export const FundersByLaboChart: React.FC<{ data: LaboCategoryRow[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.total - b.total);
    const cats = FUNDER_CATEGORIES.filter((c) => sorted.some((r) => r.byCat[c] > 0));
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        ...baseTooltip(t),
      },
      legend: { type: 'scroll', top: 0, textStyle: { color: t.inkSecondary, fontSize: 11 }, icon: 'circle' },
      grid: { left: 8, right: 40, top: 32, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), name: tr`publications`, nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((r) => r.labo),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 200, overflow: 'truncate' as const },
      },
      series: cats.map((cat) => ({
        name: tr(CATEGORY_LABELS[cat]),
        type: 'bar',
        stack: 'funders',
        data: sorted.map((r) => r.byCat[cat]),
        itemStyle: { color: t.series[CATEGORY_COLOR_SLOT[cat]] },
      })),
    };
  }, [data, t, tr]);
  return (
    <EChartCard
      title={tr`Breakdown of funders by lab`}
      subtitle={tr`Funded publications by lab, broken down by category · a co-signed publication counts in each lab · top 15`}
      option={option}
      exportName="funders-par-labo"
      height={Math.max(360, data.length * 30 + 110)}
    />
  );
};

/** « Financements » tab — funders and projects acknowledged by the publications. */
export const FundersTab: React.FC<{ dataset: DashboardDataset; range: YearRange }> = ({
  dataset,
  range,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const [page, setPage] = useState(0);
  const agg = useMemo(() => aggregateFunders(dataset.publications, range), [dataset, range]);
  const composite = useMemo(() => hasSubStructures(dataset.publications), [dataset.publications]);
  const byLabo = useMemo(
    () => (composite ? aggregateCategoryByLabo(dataset.publications, range) : []),
    [composite, dataset.publications, range],
  );

  const projects = agg.topProjects;
  const pageCount = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = projects.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const csvEscape = (v: string | number | null) => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const downloadProjectsCsv = () => {
    const header = 'project_id,project_name,funder,category,source,n_publications';
    const lines = projects.map((p) =>
      [
        csvEscape(p.projectId),
        csvEscape(p.projectName),
        csvEscape(p.funderName),
        csvEscape(p.category),
        csvEscape(p.source),
        p.count,
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `financements_${dataset.slug}_${range.start}-${range.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (agg.fundedPubs === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>
          No funding data in the selection. Funders come from OpenAlex (funders/awards) and ANR/European projects declared in HAL — they may be missing from an old export or a poorly covered corpus.
        </Trans>
      </div>
    );
  }

  const topFunder = agg.topFunders[0];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
        <Trans>
          Funders and research projects <strong>acknowledged</strong> by the publications, according to OpenAlex (<em>funders / awards</em>) and ANR / European projects declared in HAL. ⚠️ A funder associated with a publication means the publication<strong> acknowledges</strong> it — it is <em>neither</em> “this funder paid Nantes Université” <em>nor</em> “a Nantes researcher holds the grant”. Declarative view (acknowledgements), not to be read as a budget. Coverage depends on the quality of funding metadata (variable across disciplines).
        </Trans>
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={tr`Funder coverage`}
          value={`${agg.coveragePct} %`}
          hint={tr`${nf(agg.fundedPubs)} / ${nf(agg.totalPubs)} publications`}
          icon={<Banknote className="w-5 h-5" />}
          color={t.series[0]}
        />
        <KpiCard
          label={tr`Distinct funders`}
          value={nf(agg.distinctFunders)}
          icon={<Landmark className="w-5 h-5" />}
          color={t.series[2]}
        />
        <KpiCard
          label={tr`Identified projects`}
          value={nf(agg.distinctProjects)}
          hint={tr`ANR / H2020 codes / grants`}
          icon={<FolderKanban className="w-5 h-5" />}
          color={t.series[3]}
        />
        <KpiCard
          label={tr`Main funder`}
          value={topFunder ? nf(topFunder.count) : '—'}
          hint={topFunder ? topFunder.name : undefined}
          icon={<Award className="w-5 h-5" />}
          color={t.series[CATEGORY_COLOR_SLOT[topFunder?.category ?? 'Autre']]}
        />
      </div>

      {agg.topFunders.length > 0 && <FundersTopChart data={agg.topFunders} />}
      {agg.byCategory.length > 0 && <FundersCategoryChart data={agg.byCategory} />}
      {composite && byLabo.length > 0 && <FundersByLaboChart data={byLabo} />}
      {agg.byYear.length > 0 && <FundersYearChart data={agg.byYear} />}

      {/* ── Projects / grants table ── */}
      <div className="glass-card flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
              <Trans>Most frequent projects and grants</Trans>
            </h3>
            <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
              <Plural value={agg.distinctProjects} one="# identified project" other="# identified projects" /> — <Trans>top {projects.length} by number of publications</Trans>
            </p>
          </div>
          <button
            type="button"
            onClick={downloadProjectsCsv}
            title={tr`Export projects (CSV)`}
            className="btn-pill px-3 py-1.5 text-[13px]"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                <th className="px-3 py-2 w-40"><Trans>Reference</Trans></th>
                <th className="px-3 py-2"><Trans>Project title</Trans></th>
                <th className="px-3 py-2 w-56"><Trans>Funder</Trans></th>
                <th className="px-3 py-2 w-28"><Trans>Category</Trans></th>
                <th className="px-3 py-2 w-20 text-right"><Trans>Pubs</Trans></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p, i) => (
                <tr
                  key={`${p.projectId ?? p.projectName}-${i}`}
                  className="border-t border-ink/5 dark:border-white/5 align-top"
                >
                  <td className="px-3 py-2 font-mono text-[12px] text-ink dark:text-[#f5f2ea] whitespace-nowrap">
                    {p.projectId ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">{p.projectName ?? '—'}</td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{p.funderName}</td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{
                        color: t.series[CATEGORY_COLOR_SLOT[p.category]],
                        backgroundColor: `${t.series[CATEGORY_COLOR_SLOT[p.category]]}1f`,
                      }}
                    >
                      {CATEGORY_LABELS[p.category] ? tr(CATEGORY_LABELS[p.category]) : p.category}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-ink dark:text-[#f5f2ea]">
                    {nf(p.count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-ink/5 dark:border-white/5 text-sm text-muted dark:text-[#c3beb0]">
            <button
              type="button"
              className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              ← <Trans>Previous</Trans>
            </button>
            <span>
              <Trans>Page {currentPage + 1} / {pageCount}</Trans>
            </span>
            <button
              type="button"
              className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <Trans>Next</Trans> →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
