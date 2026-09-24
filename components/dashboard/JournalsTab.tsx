import React, { useMemo, useState } from 'react';
import { Award, Download, Newspaper, Library, LockOpen, Hash, ExternalLink } from 'lucide-react';
import { DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import {
  aggregateJournals,
  accessLabel,
  JOURNAL_ACCESS_COLORS,
  NANTILUS_SEARCH,
  JournalsAggregates,
} from './phase4Aggregates';
import { oaLabel } from './labels';
import { PubFilters } from './publicationFilters';
import { TeamDonutChart } from './charts/TeamCharts';
import { TopJournalsChart } from './charts/TopJournalsChart';
import { KpiCard } from './KpiCards';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseCategoryAxis,
  baseValueAxis,
  useVizTheme,
} from './EChartCard';
import { numberLocale } from '../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

const PAGE_SIZE = 25;

/** Horizontal bars of the access categories (same colors as the donut). */
export const AccessBarChart: React.FC<{ data: { key: string; count: number }[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr, i18n } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.count - b.count);
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => accessLabel(d.key)),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 200, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => ({
            value: d.count,
            itemStyle: { color: JOURNAL_ACCESS_COLORS[d.key] ?? '#9E9E9E', borderRadius: [0, 4, 4, 0] },
          })),
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
        },
      ],
    };
  }, [data, t, i18n.locale]);
  return (
    <EChartCard
      title={tr`Publications by access category`}
      option={option}
      exportName="acces-revues-barres"
      height={340}
    />
  );
};

/** Yearly evolution of the share of publications accessible at NU (%). */
export const AccessibleEvolutionChart: React.FC<{
  data: { year: number; pct: number; total: number }[];
}> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        formatter: (p: { dataIndex: number }[]) => {
          const d = data[p[0].dataIndex];
          return tr`${d.year}: ${d.pct}% accessible (${d.total} journal publications)`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
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
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 8,
          data: data.map((d) => d.pct),
          lineStyle: { color: t.series[2], width: 2 },
          itemStyle: { color: t.series[2], borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: t.series[2], opacity: 0.1 },
        },
      ],
    }),
    [data, t, tr],
  );
  return (
    <EChartCard
      title={tr`Share of publications accessible at NU per year`}
      option={option}
      exportName="acces-revues-evolution"
      height={300}
    />
  );
};

/** « Toutes les revues » table with CSV export and Nantilus link. */
const AllJournalsTable: React.FC<{
  agg: JournalsAggregates;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ agg, range, onOpenList }) => {
  const { t } = useLingui();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agg.rows.filter(
      (r) =>
        !q ||
        r.journal.toLowerCase().includes(q) ||
        (r.publisher ?? '').toLowerCase().includes(q) ||
        (r.issn ?? '').toLowerCase().includes(q),
    );
  }, [agg.rows, query]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const hasPublisher = agg.rows.some((r) => r.publisher);
  const hasQuartile = agg.rows.some((r) => r.quartile);
  const hasLn = agg.rows.some((r) => r.licenceNationale);

  const csvEscape = (v: string | number | null) => {
    const s = (v ?? '').toString();
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const downloadCsv = () => {
    const header = 'revue,editeur,issn,publications,quartile,pct_acces_ouvert,citations,acces_nu,licence_nationale';
    const lines = rows.map((r) =>
      [
        csvEscape(r.journal), csvEscape(r.publisher), r.issn ?? '', r.publications,
        r.quartile ?? '', r.pctOpen, r.citations, csvEscape(accessLabel(r.accessCat)),
        r.licenceNationale ? 'oui' : '',
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `revues_${range.start}-${range.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="glass-card flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
            <Trans>All journals</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Plural value={rows.length} one="# journal" other="# journals" /> — <Trans>the Nantilus link searches the catalogue for the journal by ISSN</Trans>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input-soft !w-56 py-1.5 text-sm"
            placeholder={t`Journal, publisher or ISSN…`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
          <button type="button" onClick={downloadCsv} title={t`Export the journal list (CSV)`} className="btn-pill px-3 py-1.5 text-[13px]">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
              <th className="px-3 py-2"><Trans>Journal</Trans></th>
              {hasPublisher && <th className="px-3 py-2 w-48"><Trans>Publisher</Trans></th>}
              <th className="px-3 py-2 w-24">ISSN</th>
              <th className="px-3 py-2 w-16 text-right"><Trans>Pubs</Trans></th>
              {hasQuartile && <th className="px-3 py-2 w-16"><Trans>Quartile</Trans></th>}
              <th className="px-3 py-2 w-16 text-right">% OA</th>
              <th className="px-3 py-2 w-20 text-right"><Trans>Citations</Trans></th>
              <th className="px-3 py-2 w-44"><Trans>NU access</Trans></th>
              {hasLn && <th className="px-3 py-2 w-14" title={t`National licence (ISTEX) — permanent national access`}>LN</th>}
              <th className="px-3 py-2 w-20">Nantilus</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const linkable = r.issn && (r.accessCat !== 'inconnu' || r.licenceNationale);
              return (
                <tr key={r.journal} className="border-t border-ink/5 dark:border-white/5 align-top">
                  <td className="px-3 py-2 text-ink dark:text-[#f5f2ea] font-semibold">{r.journal}</td>
                  {hasPublisher && (
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{r.publisher ?? '—'}</td>
                  )}
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0] font-mono text-xs">{r.issn ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink dark:text-[#f5f2ea]">
                    {onOpenList ? (
                      <button
                        type="button"
                        onClick={() => onOpenList({ journal: r.journal })}
                        title={t`View these publications in the list`}
                        className="hover:underline decoration-dotted underline-offset-2 cursor-pointer"
                      >
                        {r.publications.toLocaleString(numberLocale())}
                      </button>
                    ) : (
                      r.publications.toLocaleString(numberLocale())
                    )}
                  </td>
                  {hasQuartile && (
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{r.quartile ?? '—'}</td>
                  )}
                  <td className="px-3 py-2 text-right text-muted dark:text-[#c3beb0]">{r.pctOpen} %</td>
                  <td className="px-3 py-2 text-right text-muted dark:text-[#c3beb0]">
                    {r.citations.toLocaleString(numberLocale())}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex items-center gap-1.5 text-xs text-muted dark:text-[#c3beb0]"
                      title={accessLabel(r.accessCat)}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: JOURNAL_ACCESS_COLORS[r.accessCat] ?? '#9E9E9E' }}
                      />
                      {accessLabel(r.accessCat)}
                    </span>
                  </td>
                  {hasLn && (
                    <td className="px-3 py-2 text-center">{r.licenceNationale ? '✓' : ''}</td>
                  )}
                  <td className="px-3 py-2">
                    {linkable ? (
                      <a
                        href={`${NANTILUS_SEARCH}${encodeURIComponent((r.issn ?? '').trim())}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-ink dark:text-accent hover:underline"
                      >
                        <Trans>View</Trans> <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      ''
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

/** « Revues » tab — full port of the Streamlit _tab_journals. */
export const JournalsTab: React.FC<{
  publications: DashboardPublication[];
  range: YearRange;
  /** Slug of the displayed structure — the FNEGE block is reserved for LEMNA. */
  slug?: string;
  /** Cross-tab link: opens the pre-filtered « Liste des publications ». */
  onOpenList?: (filters: PubFilters) => void;
}> = ({ publications, range, slug, onOpenList }) => {
  const t = useVizTheme();
  const { t: tr, i18n } = useLingui();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- i18n.locale: accessLabel() inside the data
  const agg = useMemo(() => aggregateJournals(publications, range), [publications, range, i18n.locale]);

  if (agg.nbPubs === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>
          No publication in an identified journal over the period (journal articles only, HAL/arXiv-type repositories excluded).
        </Trans>
      </div>
    );
  }

  const pctOpen = Math.round((agg.nbOpen / agg.nbPubs) * 100);
  const pctIssn = Math.round((agg.nbIssn / agg.nbPubs) * 100);
  const pctAccessible = Math.round((agg.nbAccessible / agg.nbPubs) * 100);

  return (
    <div className="flex flex-col gap-4">
      {/* ── KPI ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={tr`Journal publications`}
          value={agg.nbPubs.toLocaleString(numberLocale())}
          icon={<Newspaper className="w-5 h-5" />}
          color={t.series[0]}
        />
        <KpiCard
          label={tr`Distinct journals`}
          value={agg.nbJournals.toLocaleString(numberLocale())}
          icon={<Library className="w-5 h-5" />}
          color={t.series[3]}
        />
        <KpiCard
          label={tr({ message: `Open access`, context: "adverbial" })}
          value={agg.nbOpen.toLocaleString(numberLocale())}
          hint={tr`${pctOpen}% of publications`}
          icon={<LockOpen className="w-5 h-5" />}
          color={t.series[2]}
        />
        <KpiCard
          label={tr`With ISSN provided`}
          value={agg.nbIssn.toLocaleString(numberLocale())}
          hint={`${pctIssn} %`}
          icon={<Hash className="w-5 h-5" />}
          color={t.series[5]}
        />
      </div>
      {agg.topJournal && (
        <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
          <Trans>
            Most frequent journal: <strong className="text-ink dark:text-[#f5f2ea]">{agg.topJournal.name}</strong> ({agg.topJournal.count.toLocaleString(numberLocale())} publications).
          </Trans>
        </p>
      )}

      {/* ── FNEGE ranking (management sciences) — reserved for LEMNA (the other
             corpora contain ranked journals by accident, out of scope) ── */}
      {slug === 'lemna' && agg.hasFnege && (
        <>
          <div className="flex flex-col gap-1 px-1 mt-2">
            <h3 className="section-label"><Trans>FNEGE journal ranking</Trans></h3>
            <p className="text-sm text-muted dark:text-[#c3beb0]">
              <Trans>
                FNEGE 2025 reference list (management sciences), applied by ISSN then journal title to the period's journal articles. “Unranked” = articles published in a journal absent from the list.
              </Trans>
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {agg.fnege.map(({ rank, count }, i) => (
              <KpiCard
                key={rank}
                label={rank === 'EM' ? tr`Emerging journals` : tr`Ranked ${rank}`}
                value={count.toLocaleString(numberLocale())}
                hint={tr`${Math.round((count / agg.nbPubs) * 100)}% of articles`}
                icon={<Award className="w-5 h-5" />}
                color={t.series[i % t.series.length]}
              />
            ))}
            <KpiCard
              label={tr`Unranked (FNEGE)`}
              value={agg.nbFnegeUnranked.toLocaleString(numberLocale())}
              hint={tr`${Math.round((agg.nbFnegeUnranked / agg.nbPubs) * 100)}% of articles`}
              icon={<Award className="w-5 h-5" />}
              color="#9E9E9E"
            />
          </div>
        </>
      )}

      {/* ── Access at « Nantes Université » ── */}
      {agg.hasAccessData ? (
        <>
          <div className="flex flex-col gap-1 px-1">
            <h3 className="section-label"><Trans>Journal access at Nantes Université</Trans></h3>
            <p className="text-sm text-muted dark:text-[#c3beb0]">
              <Trans>
                <strong className="text-ink dark:text-[#f5f2ea]">{agg.nbAccessible.toLocaleString(numberLocale())}</strong> publications ({pctAccessible}%) published in a journal accessible to Nantes Université researchers.
              </Trans>
              {agg.lnJournals > 0 && (
                <>
                  {' '}
                  <Trans>
                    Including <strong className="text-ink dark:text-[#f5f2ea]">{agg.lnJournals} journals</strong> ({agg.lnPubs.toLocaleString(numberLocale())} publications) acquired under national licence (ISTEX) — permanent national access.
                  </Trans>
                </>
              )}
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TeamDonutChart
              title={tr`Breakdown by access category`}
              exportName="acces-revues"
              data={agg.byAccess.map((a) => ({
                name: accessLabel(a.key),
                value: a.count,
                color: JOURNAL_ACCESS_COLORS[a.key] ?? '#9E9E9E',
              }))}
              height={340}
            />
            <AccessBarChart data={agg.byAccess} />
          </div>
          <AccessibleEvolutionChart data={agg.accessibleByYear} />
        </>
      ) : (
        <>
          <div className="glass-card p-5 text-sm text-muted dark:text-[#c3beb0]">
            <Trans>
              Access enrichment not available for this structure — drop<code className="font-mono text-xs mx-1">journals_access.csv</code>in its druid-biblio folder to enable the breakdown by access. Meanwhile, OpenAlex open access / closed access breakdown:
            </Trans>
          </div>
          <div className="max-w-xl">
            <TeamDonutChart
              title={tr`OA status of the journal corpus`}
              exportName="acces-revues"
              data={agg.byOaFallback.map((d) => ({ name: oaLabel(d.key), value: d.count }))}
            />
          </div>
        </>
      )}

      {/* ── Top journals ── */}
      <TopJournalsChart rows={agg.rows} />
      {agg.top10SharePct != null && (
        <p className="text-sm text-muted dark:text-[#c3beb0] px-1 -mt-2">
          <Trans>The top 10 journals account for {agg.top10SharePct}% of publications.</Trans>
        </p>
      )}

      {/* ── Full table ── */}
      <AllJournalsTable agg={agg} range={range} onOpenList={onOpenList} />
    </div>
  );
};
