import React, { useMemo, useState } from 'react';
import { Download, FileCheck2, BadgeCheck, Landmark, Percent } from 'lucide-react';
import { DashboardDataset, DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { aggregateCharte, charterCompliant } from './phase4Aggregates';
import { PubFilters } from './publicationFilters';
import { TeamDonutChart } from './charts/TeamCharts';
import { KpiCard } from './KpiCards';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from './EChartCard';
import { numberLocale } from '../../lib/i18n';
import { doiUrl } from '../../lib/doi';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

const PAGE_SIZE = 25;

const subBtn = (active: boolean) =>
  `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
    active
      ? 'bg-accent text-ink shadow-nav-active'
      : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
  }`;

/** Distribution of compliance scores (%) with a marker at the current threshold. */
export const CharteScoresChart: React.FC<{
  data: { label: string; count: number }[];
  thresholdPct?: number;
}> = ({ data, thresholdPct = 75 }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        ...baseCategoryAxis(t),
        data: data.map((d) => d.label),
        name: tr`Score (%)`,
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: t.inkMuted, fontSize: 11 },
      },
      yAxis: baseValueAxis(t),
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.count),
          itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
          barCategoryGap: '10%',
          markLine: {
            symbol: 'none',
            lineStyle: { color: t.inkMuted, type: 'dashed' },
            label: { formatter: tr`threshold`, position: 'end', color: t.inkSecondary, fontSize: 10 },
            data: [{ xAxis: Math.min(10, Math.floor(thresholdPct / 10)) }],
          },
        },
      ],
    }),
    [data, thresholdPct, t, tr],
  );
  return (
    <EChartCard
      title={tr`Distribution of compliance scores`}
      option={option}
      exportName="charte-scores"
      height={300}
    />
  );
};

/** Yearly evolution: compliance rate and « Nantes Université » mention rate. */
export const CharteRateChart: React.FC<{
  data: { year: number; pctConf: number; pctNu: number; n: number }[];
  /** Click on a point (year) — opens the filtered list. */
  onSelect?: (year: number, series: string) => void;
}> = ({ data, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const confName = tr`Compliance rate`;
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        formatter: (p: { dataIndex: number }[]) => {
          const d = data[p[0].dataIndex];
          return tr`${d.year} — compliant: ${d.pctConf}% · “NU” mention: ${d.pctNu}% (${d.n} analysed)`;
        },
        ...baseTooltip(t),
      },
      legend: { bottom: 0, textStyle: { color: t.inkSecondary, fontSize: 11 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 16, bottom: 36, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: {
        type: 'value' as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value} %', color: t.inkMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
      },
      series: [
        {
          name: confName,
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 7,
          data: data.map((d) => d.pctConf),
          lineStyle: { color: t.series[2], width: 2 },
          itemStyle: { color: t.series[2], borderColor: t.surface, borderWidth: 2 },
        },
        {
          name: tr`“Nantes Université” mention`,
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 7,
          data: data.map((d) => d.pctNu),
          lineStyle: { color: t.series[3], width: 2 },
          itemStyle: { color: t.series[3], borderColor: t.surface, borderWidth: 2 },
        },
      ],
    }),
    [data, t, tr, confName],
  );
  return (
    <EChartCard
      title={tr`Compliance rate per year`}
      subtitle={tr`Full compliance vs simple “Nantes Université” mention`}
      option={option}
      exportName="charte-evolution"
      height={300}
      onSeriesClick={
        onSelect ? (p) => data[p.dataIndex] && onSelect(data[p.dataIndex].year, p.seriesName === confName ? 'conf' : 'nu') : undefined
      }
    />
  );
};

/** Presence rate of each charter criterion (%). */
export const CharteCriteresChart: React.FC<{ data: { label: string; pct: number }[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.pct - b.pct);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: number) => `${v} %`,
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value' as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value} %', color: t.inkMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
      },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.label),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 180, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => d.pct),
          itemStyle: { color: t.series[2], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary, formatter: '{c} %' },
        },
      ],
    };
  }, [data, t]);
  return (
    <EChartCard
      title={tr`Presence rate by criterion`}
      subtitle={tr`Share of analysed publications satisfying each element of the signature`}
      option={option}
      exportName="charte-criteres"
      height={300}
    />
  );
};

/** Compliance rate per team (teams with ≥ 3 analyzable publications). */
export const CharteTeamsChart: React.FC<{
  data: { team: string; pct: number; n: number }[];
  /** Click on a bar (team) — opens the filtered list. */
  onSelect?: (team: string) => void;
}> = ({ data, onSelect }) => {
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
          return tr`${d.team}: ${d.pct}% compliant (${d.n} analysable publications)`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value' as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value} %', color: t.inkMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
      },
      yAxis: {
        ...baseCategoryAxis(t),
        data: data.map((d) => d.team),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 160, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.pct),
          itemStyle: { color: t.series[2], borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right',
            fontSize: 10,
            color: t.inkSecondary,
            formatter: (p: { dataIndex: number; value: number }) =>
              `${p.value} % (${data[p.dataIndex].n})`,
          },
        },
      ],
    }),
    [data, t, tr],
  );
  return (
    <EChartCard
      title={tr`Compliance rate by team`}
      subtitle={tr`Teams with at least 3 analysable publications`}
      option={option}
      exportName="charte-equipes"
      height={Math.max(260, data.length * 26 + 80)}
      onSeriesClick={
        onSelect ? (p) => data[p.dataIndex] && onSelect(data[p.dataIndex].team) : undefined
      }
    />
  );
};

type StatusFilter = 'all' | 'conf' | 'nonconf';

/** « Signatures repérées » table: filters, search, authors of the structure, CSV. */
const SignaturesTable: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  seuil: number;
}> = ({ dataset, range, seuil }) => {
  const { t } = useLingui();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const byId = useMemo(
    () => new Map(dataset.authors.map((a) => [a.id, a.label])),
    [dataset.authors],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dataset.publications
      .filter(
        (p): p is DashboardPublication =>
          typeof p.year === 'number' &&
          p.year >= range.start &&
          p.year <= range.end &&
          p.charte != null &&
          p.charte.score != null,
      )
      .filter((p) => {
        if (status === 'conf') return charterCompliant(p, seuil);
        if (status === 'nonconf') return !charterCompliant(p, seuil);
        return true;
      })
      .filter((p) => !q || (p.charte!.signature ?? '').toLowerCase().includes(q))
      .sort(
        (a, b) =>
          (a.charte!.score as number) - (b.charte!.score as number) ||
          (b.year ?? 0) - (a.year ?? 0),
      );
  }, [dataset.publications, range, status, query, seuil]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const authorsOf = (p: DashboardPublication) =>
    p.authorIds.map((id) => byId.get(id)).filter(Boolean).join(', ');

  const csvEscape = (v: string | number | null) => {
    const s = (v ?? '').toString();
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const downloadCsv = () => {
    const header = 'year,score_pct,conforme,mention_nu,modele,signature,auteurs,title,doi';
    const lines = rows.map((p) =>
      [
        p.year,
        Math.round((p.charte!.score as number) * 100),
        charterCompliant(p, seuil) ? 'oui' : '',
        p.charte!.nuSeul ? 'oui' : '',
        csvEscape(p.charte!.modele),
        csvEscape(p.charte!.signature),
        csvEscape(authorsOf(p)),
        csvEscape(p.title),
        p.doi ?? '',
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `conformite_charte_${dataset.slug}_${range.start}-${range.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t({ message: `All`, context: "feminine" }) },
    { key: 'conf', label: t({ message: `Compliant`, context: "plural" }) },
    { key: 'nonconf', label: t({ message: `Non-compliant`, context: "plural" }) },
  ];

  return (
    <div className="glass-card flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
            <Trans>Detected signatures</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Plural value={rows.length} one="# signature, sorted from least to most compliant" other="# signatures, sorted from least to most compliant" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            {filters.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={subBtn(status === key)}
                onClick={() => {
                  setStatus(key);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="input-soft !w-64 py-1.5 text-sm"
            placeholder={t`Search in the signature…`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
          <button type="button" onClick={downloadCsv} title={t`Download the list (CSV)`} className="btn-pill px-3 py-1.5 text-[13px]">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
              <th className="px-3 py-2 w-14"><Trans>Year</Trans></th>
              <th className="px-3 py-2 w-16 text-right"><Trans>Score</Trans></th>
              <th className="px-3 py-2 w-20"><Trans>Compliant</Trans></th>
              <th className="px-3 py-2"><Trans>Signature (raw affiliation)</Trans></th>
              <th className="px-3 py-2 w-52"><Trans>{dataset.lab} authors</Trans></th>
              <th className="px-3 py-2 w-64"><Trans>Title</Trans></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p, i) => {
              const conf = charterCompliant(p, seuil);
              return (
                <tr key={`${p.doi ?? p.title}-${i}`} className="border-t border-ink/5 dark:border-white/5 align-top">
                  <td className="px-3 py-2 font-semibold text-ink dark:text-[#f5f2ea]">{p.year}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink dark:text-[#f5f2ea]">
                    {Math.round((p.charte!.score as number) * 100)} %
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-lg text-[11px] font-bold ${
                        conf
                          ? 'bg-[rgba(46,160,102,.16)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.22)] dark:text-[#5fd39a]'
                          : 'bg-[rgba(214,69,69,.14)] text-[#b23b3b] dark:bg-[rgba(214,69,69,.22)] dark:text-[#f08c8c]'
                      }`}
                    >
                      {conf ? t`Compliant` : t`Non-compliant`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0] font-mono text-xs leading-relaxed">
                    {p.charte!.signature ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{authorsOf(p) || '—'}</td>
                  <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">
                    {p.doi ? (
                      <a href={doiUrl(p.doi) ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">
                        {p.title ?? p.doi}
                      </a>
                    ) : (
                      p.title ?? '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-ink/5 dark:border-white/5 text-sm text-muted dark:text-[#c3beb0]">
          <button type="button" className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            ← <Trans>Previous</Trans>
          </button>
          <span>
            <Trans>Page {currentPage + 1} / {pageCount}</Trans>
          </span>
          <button type="button" className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>
            <Trans>Next</Trans> →
          </button>
        </div>
      )}
    </div>
  );
};

/** « Charte de signature » tab — compliance with the NU charter (June 2022). */
export const CharteTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const [thresholdPct, setSeuilPct] = useState(75);
  const seuil = thresholdPct / 100;
  const agg = useMemo(
    () => aggregateCharte(dataset.publications, range, seuil),
    [dataset.publications, range, seuil],
  );

  if (agg.analysable === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>
          Compliance not computed for this structure: it requires the raw OpenAlex affiliations (column missing from old ETLs — rerun the ETL) and a signature model in the Nantes Université charter (appendix 2).
        </Trans>
      </div>
    );
  }

  const pctConf = Math.round((agg.conformes / agg.analysable) * 100);
  const pctNu = Math.round((agg.nuSeul / agg.analysable) * 100);
  const nonAnalysees = agg.total - agg.analysable;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
        <Trans>
          Compares the raw OpenAlex affiliation of the structure's authors with the signature model of the common charter (June 2022). The score is the share of charter criteria satisfied.
        </Trans>
      </p>
      {dataset.charteModele && (
        <div className="glass-card-strong px-4 py-3 text-sm">
          <span className="section-label mr-2"><Trans>Reference model</Trans></span>
          <code className="font-mono text-xs text-ink dark:text-[#f5f2ea]">{dataset.charteModele}</code>
        </div>
      )}
      {dataset.charteComposite && (
        <div className="glass-card-strong px-4 py-3 text-sm text-muted dark:text-[#c3beb0]">
          <span className="section-label mr-2"><Trans>Aggregated monitoring</Trans></span>
          <Trans>
            This structure has no official signature of its own: each publication is assessed against the charter model of <strong>its lab</strong>, and the indicators below are the sum of the member labs' monitoring.
          </Trans>
        </div>
      )}

      {/* Compliance threshold */}
      <label className="flex flex-wrap items-center gap-3 px-1 text-sm text-muted dark:text-[#c3beb0]">
        <Trans>Compliance threshold (share of criteria to satisfy):</Trans>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={thresholdPct}
          onChange={(e) => setSeuilPct(Number(e.target.value))}
          className="accent-[#7048e8] w-44"
        />
        <strong className="text-ink dark:text-[#f5f2ea]">{thresholdPct} %</strong>
      </label>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={tr`Analysable publications`}
          value={agg.analysable.toLocaleString(numberLocale())}
          hint={nonAnalysees > 0 ? tr`${nonAnalysees.toLocaleString(numberLocale())} without raw affiliation` : undefined}
          icon={<FileCheck2 className="w-5 h-5" />}
          color={t.series[0]}
        />
        <KpiCard
          label={tr`Compliant signatures`}
          value={agg.conformes.toLocaleString(numberLocale())}
          hint={`${pctConf} %`}
          icon={<BadgeCheck className="w-5 h-5" />}
          color={t.series[2]}
        />
        <KpiCard
          label={tr`“Nantes Université” mention`}
          value={agg.nuSeul.toLocaleString(numberLocale())}
          hint={tr`${pctNu}% — historical minimum criterion`}
          icon={<Landmark className="w-5 h-5" />}
          color={t.series[3]}
        />
        <KpiCard
          label={tr`Mean score`}
          value={agg.scoreMean != null ? `${Math.round(agg.scoreMean * 100)} %` : '—'}
          icon={<Percent className="w-5 h-5" />}
          color={t.series[6]}
        />
      </div>
      {nonAnalysees > 0 && (
        <p className="text-[11px] text-muted-lighter dark:text-[#8f897c] px-1 -mt-2">
          <Trans>
            ⚠️ {nonAnalysees.toLocaleString(numberLocale())} publication(s) out of {agg.total.toLocaleString(numberLocale())} without raw OpenAlex affiliation are not analysed (BSO-only corpus).
          </Trans>
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <TeamDonutChart
            title={tr`Corpus compliance`}
            exportName="charte-conformite"
            data={[
              { name: tr({ message: `Compliant`, context: "plural" }), value: agg.conformes, color: t.series[2] },
              { name: tr({ message: `Non-compliant`, context: "plural" }), value: agg.analysable - agg.conformes, color: t.series[7] },
            ]}
            onSelect={
              onOpenList ? (name) => name === tr({ message: `Compliant`, context: "plural" }) && onOpenList({ charterCompliant: true, charteSeuil: seuil }) : undefined
            }
          />
        </div>
        <div className="lg:col-span-3">
          <CharteScoresChart data={agg.scoreHistogram} thresholdPct={thresholdPct} />
        </div>
      </div>
      <CharteRateChart
        data={agg.rateByYear}
        onSelect={
          onOpenList
            ? (year, series) =>
                onOpenList(series === 'conf' ? { year, charterCompliant: true, charteSeuil: seuil } : { year })
            : undefined
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CharteCriteresChart data={agg.byCritere} />
        {agg.byTeam.length > 0 ? (
          <CharteTeamsChart
            data={agg.byTeam}
            onSelect={onOpenList ? (team) => onOpenList({ team, charterCompliant: true, charteSeuil: seuil }) : undefined}
          />
        ) : (
          <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
            <Trans>
              Compliance by team unavailable: no team with at least 3 analysable publications (staff not matched?).
            </Trans>
          </div>
        )}
      </div>

      <SignaturesTable dataset={dataset} range={range} seuil={seuil} />
    </div>
  );
};
