import React, { useMemo, useState } from 'react';
import {
  Download, Euro, Sigma, Divide, ReceiptText, BadgeCheck, Tag, Ban, Wallet,
} from 'lucide-react';
import { DashboardDataset, DashboardPublication, OpenApcData } from './types';
import { YearRange, oaEurOf } from './overviewAggregates';
import { hasSubStructures } from './collabAggregates';
import { oaLabel } from './labels';
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

const eur = (v: number) => `${Math.round(v).toLocaleString(numberLocale())} €`;

/** Elsevier transformative agreement (confirmed Nantes U payer) attached to the publication, else null. */
const dealOf = (p: DashboardPublication) => p.publisherDeal ?? null;
/** Is the article OA under the agreement (APC covered)? subscription = OA waived. */
const isDealOa = (d: DashboardPublication['publisherDeal']) =>
  !!d && (d.model === 'gold' || d.model === 'hybrid');

/** Best known € amount: Elsevier agreement (exact, in €) if OA, otherwise OpenAlex estimate. */
function bestEurOf(p: DashboardPublication): number | null {
  const dl = p.publisherDeal;
  if (dl && isDealOa(dl)) return dl.listAmountEur ?? dl.paidAfterDiscountEur ?? oaEurOf(p);
  return oaEurOf(p);
}

/** Sort amount (€): OA agreement / OpenAlex estimate, non-OA opt-outs at the bottom. */
function sortAmount(p: DashboardPublication): number {
  const dl = p.publisherDeal;
  if (dl && !isDealOa(dl)) return -1; // subscription (OA waived): 0 APC
  return bestEurOf(p) ?? -1;
}

interface DealAggregates {
  oaCount: number; // OA articles under the agreement (APC covered)
  optOutCount: number; // articles where the author waived OA (no APC)
  listTotalEur: number; // cumulative list value (publisher list price, raw reference value)
  paidTotalEur: number; // cumulative actual residual cost (after the agreement discount)
}

/** Aggregate of the Elsevier transformative agreement over the period (Nantes U). */
export function aggregateDeal(pubs: DashboardPublication[], range: YearRange): DealAggregates {
  const inRange = pubs.filter(
    (p) =>
      p.publisherDeal &&
      typeof p.year === 'number' &&
      p.year >= range.start &&
      p.year <= range.end,
  );
  const oa = inRange.filter((p) => isDealOa(p.publisherDeal));
  const optOut = inRange.filter((p) => p.publisherDeal!.model === 'subscription');
  return {
    oaCount: oa.length,
    optOutCount: optOut.length,
    listTotalEur: Math.round(oa.reduce((s, p) => s + (p.publisherDeal!.listAmountEur ?? 0), 0)),
    paidTotalEur: Math.round(
      oa.reduce((s, p) => s + (p.publisherDeal!.paidAfterDiscountEur ?? 0), 0),
    ),
  };
}

interface ApcAggregates {
  pubs: DashboardPublication[]; // publications with APC in the period
  totalEur: number;
  meanEur: number | null;
  paidKnown: number;
  byYear: { year: number; total: number; n: number }[]; // total in €
  byJournal: { journal: string; mean: number; total: number; n: number }[]; // €
}

export function aggregateApc(pubs: DashboardPublication[], range: YearRange): ApcAggregates {
  const inRange = pubs.filter(
    (p) =>
      typeof p.year === 'number' && p.year >= range.start && p.year <= range.end && p.hasApc,
  );
  const eurs = inRange.map(oaEurOf).filter((v): v is number => v != null);
  const totalEur = eurs.reduce((s, v) => s + v, 0);
  const paidKnown = inRange.filter((p) => (p.apcDetail?.paidAmount ?? 0) > 0).length;

  const ym = new Map<number, { total: number; n: number }>();
  for (const p of inRange) {
    const cur = ym.get(p.year as number) ?? { total: 0, n: 0 };
    cur.total += oaEurOf(p) ?? 0;
    cur.n += 1;
    ym.set(p.year as number, cur);
  }
  const byYear = Array.from(ym.entries())
    .map(([year, v]) => ({ year, total: Math.round(v.total), n: v.n }))
    .sort((a, b) => a.year - b.year);

  const jm = new Map<string, { total: number; n: number }>();
  for (const p of inRange) {
    if (!p.journal) continue;
    const cur = jm.get(p.journal) ?? { total: 0, n: 0 };
    cur.total += oaEurOf(p) ?? 0;
    cur.n += 1;
    jm.set(p.journal, cur);
  }
  const byJournal = Array.from(jm.entries())
    .map(([journal, v]) => ({
      journal,
      mean: v.n ? Math.round(v.total / v.n) : 0,
      total: Math.round(v.total),
      n: v.n,
    }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 20);

  return {
    pubs: inRange,
    totalEur: Math.round(totalEur),
    meanEur: eurs.length ? Math.round(totalEur / eurs.length) : null,
    paidKnown,
    byYear,
    byJournal,
  };
}

/** Total APC cost per year (bars, publication count as label). */
export const ApcYearlyChart: React.FC<{ data: { year: number; total: number; n: number }[] }> = ({
  data,
}) => {
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
          return tr`${d.year}: ≈ €${d.total.toLocaleString(numberLocale())} — ${d.n} publication(s)`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: {
        ...baseValueAxis(t),
        name: '≈ €',
        nameTextStyle: { color: t.inkMuted, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.total),
          itemStyle: { color: t.series[4], borderRadius: [4, 4, 0, 0] },
          label: {
            show: true,
            position: 'top',
            fontSize: 10,
            color: t.inkSecondary,
            formatter: (p: { dataIndex: number }) => `${data[p.dataIndex].n}`,
          },
        },
      ],
    }),
    [data, t, tr],
  );
  return (
    <EChartCard
      title={tr`Total APC cost per year`}
      subtitle={tr`≈ € (paid if known, otherwise list price; USD converted) · label = number of publications`}
      option={option}
      exportName="apc-evolution"
    />
  );
};

/** Mean APC cost per journal (top 20 journals by billed publications). */
export const ApcByJournalChart: React.FC<{
  data: { journal: string; mean: number; total: number; n: number }[];
}> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.mean - b.mean);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = sorted[p[0].dataIndex];
          return `${d.journal}<br/>${tr`Mean APC: €${d.mean.toLocaleString(numberLocale())}`}<br/>${tr`${d.n} publication(s) — total ≈ €${d.total.toLocaleString(numberLocale())}`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        ...baseValueAxis(t),
        name: '≈ €',
        nameTextStyle: { color: t.inkMuted, fontSize: 11 },
      },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.journal),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 240, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => d.mean),
          itemStyle: { color: t.series[4], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
        },
      ],
    };
  }, [data, t, tr]);
  return (
    <EChartCard
      title={tr`Mean APC cost per journal`}
      subtitle={tr`Top 20 journals by number of invoiced publications`}
      option={option}
      exportName="apc-par-revue"
      height={Math.max(350, data.length * 26 + 90)}
    />
  );
};

// ── Breakdown of the Elsevier agreement per lab (composite institution) ──────
interface LaboAmount {
  labo: string;
  total: number; // cumulative list value in € (OA articles under the agreement)
  n: number;
}

/** Elsevier APCs (OA under the agreement) per lab. A co-signed publication counts in each lab. */
function aggregateDealByLabo(pubs: DashboardPublication[], range: YearRange): LaboAmount[] {
  const m = new Map<string, { total: number; n: number }>();
  for (const p of pubs) {
    const dl = p.publisherDeal;
    if (!dl || !isDealOa(dl)) continue;
    if (typeof p.year !== 'number' || p.year < range.start || p.year > range.end) continue;
    const val = dl.listAmountEur ?? dl.paidAfterDiscountEur ?? oaEurOf(p) ?? 0;
    const labos = Array.from(new Set(p.sousStructures.filter(Boolean)));
    for (const labo of labos.length ? labos : ['__unallocated__']) {
      const cur = m.get(labo) ?? { total: 0, n: 0 };
      cur.total += val;
      cur.n += 1;
      m.set(labo, cur);
    }
  }
  return Array.from(m.entries())
    .map(([labo, v]) => ({ labo, total: Math.round(v.total), n: v.n }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

/** Horizontal bars: Elsevier list value (€) per lab. */
const ApcByLaboChart: React.FC<{ data: LaboAmount[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.total - b.total);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = sorted[p[0].dataIndex];
          const labo = d.labo === '__unallocated__' ? tr`Unallocated` : d.labo;
          return `${labo}<br/>${tr`List value ≈ €${d.total.toLocaleString(numberLocale())}`}<br/>${tr`${d.n} OA article(s) under agreement`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), name: '≈ €', nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => (d.labo === '__unallocated__' ? tr`Unallocated` : d.labo)),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 220, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => d.total),
          itemStyle: { color: t.series[1], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary,
            formatter: (p: { dataIndex: number }) => `${sorted[p.dataIndex].n}` },
        },
      ],
    };
  }, [data, t, tr]);
  return (
    <EChartCard
      title={tr`Breakdown of the Elsevier agreement by lab`}
      subtitle={tr`€ list value of OA articles under agreement · label = number of articles (a co-signed publication counts in each lab)`}
      option={option}
      exportName="apc-elsevier-par-labo"
      height={Math.max(320, data.length * 26 + 90)}
    />
  );
};

// ── OpenAPC charts (actual spending) ────────────────────────────────────────
/** Vertical bars: actual APC spending (€) per year. */
const OpenApcYearChart: React.FC<{ data: OpenApcData['byYear'] }> = ({ data }) => {
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
          return tr`${d.year}: €${d.total.toLocaleString(numberLocale())} — ${d.n} APC paid`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.map((d) => String(d.year)) },
      yAxis: { ...baseValueAxis(t), name: '€', nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.total),
          itemStyle: { color: t.series[2], borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', fontSize: 10, color: t.inkSecondary,
            formatter: (p: { dataIndex: number }) => `${data[p.dataIndex].n}` },
        },
      ],
    }),
    [data, t, tr],
  );
  return (
    <EChartCard
      title={tr`Actual APC spending per year`}
      subtitle={tr`€ actually paid (SIFAC) · label = number of APCs`}
      option={option}
      exportName="openapc-par-annee"
    />
  );
};

/** Generic horizontal bars: actual spending (€) per category (publisher / journal). */
const OpenApcCategoryChart: React.FC<{
  data: OpenApcData['byPublisher'];
  title: string;
  subtitle: string;
  exportName: string;
  colorSlot?: number;
}> = ({ data, title, subtitle, exportName, colorSlot = 4 }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.total - b.total);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = sorted[p[0].dataIndex];
          return `${d.label}<br/>${d.total.toLocaleString(numberLocale())} €<br/>${tr`${d.n} APC paid`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), name: '€', nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.label),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 220, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => d.total),
          itemStyle: { color: t.series[colorSlot], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary,
            formatter: (p: { dataIndex: number }) => `${sorted[p.dataIndex].n}` },
        },
      ],
    };
  }, [data, t, colorSlot, tr]);
  return (
    <EChartCard
      title={title}
      subtitle={subtitle}
      option={option}
      exportName={exportName}
      height={Math.max(320, data.length * 26 + 90)}
    />
  );
};

/** « Dépenses réelles (OpenAPC) » sub-tab — SIFAC/Couperin amounts. */
const OpenApcSubTab: React.FC<{ data: OpenApcData }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const [page, setPage] = useState(0);
  const rows = data.rows;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const downloadCsv = () => {
    const header = 'year,publisher,journal,euro,type,doi';
    const esc = (v: string | number | null) => {
      const s = (v ?? '').toString();
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [r.year ?? '', esc(r.publisher), esc(r.journal), r.euro, r.hybrid ? 'hybride' : 'gold', r.doi ?? ''].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `openapc_${data.institution}_${data.yearMin ?? ''}-${data.yearMax ?? ''}.csv`.replace(/\s+/g, '_');
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
        <Trans>
          Amounts <strong>actually paid</strong> by {data.institution}, taken from the accounting system (<strong>SIFAC</strong>) and aggregated by the <strong>Couperin</strong> consortium via <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="underline">OpenAPC</a>. This is the most reliable source for actual APC spending — mostly “gold” APCs (natively open access journals: MDPI, Frontiers, PLoS…), complementary to the Elsevier agreement (hybrid). Period {data.yearMin}–{data.yearMax}.
        </Trans>
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={tr`Total actually paid`} value={eur(data.total)}
          icon={<Wallet className="w-5 h-5" />} color={t.series[2]} />
        <KpiCard label={tr`APC paid`} value={data.count.toLocaleString(numberLocale())}
          hint={`${data.yearMin}–${data.yearMax}`} icon={<ReceiptText className="w-5 h-5" />} color={t.series[0]} />
        <KpiCard label={tr`Mean cost / APC`} value={data.mean != null ? eur(data.mean) : '—'}
          icon={<Divide className="w-5 h-5" />} color={t.series[3]} />
        <KpiCard label={tr`Of which gold (native OA)`} value={eur(data.gold.total)}
          hint={tr`${data.gold.n} art. · hybrid ${eur(data.hybrid.total)}`} icon={<Tag className="w-5 h-5" />} color={t.series[4]} />
      </div>

      {data.byYear.length > 0 && <OpenApcYearChart data={data.byYear} />}
      {data.byPublisher.length > 0 && (
        <OpenApcCategoryChart data={data.byPublisher} colorSlot={4}
          title={tr`Actual APC spending by publisher`}
          subtitle={tr`€ paid · label = number of APCs`} exportName="openapc-par-editeur" />
      )}
      {data.byJournal.length > 0 && (
        <OpenApcCategoryChart data={data.byJournal} colorSlot={5}
          title={tr`Actual APC spending by journal (top)`}
          subtitle={tr`€ paid · label = number of APCs`} exportName="openapc-par-revue" />
      )}

      <div className="glass-card flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
              <Trans>Details of APCs paid</Trans>
            </h3>
            <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
              <Plural value={rows.length} one="# payment" other="# payments" /> — <Trans>source OpenAPC / SIFAC</Trans>
            </p>
          </div>
          <button type="button" onClick={downloadCsv} title={tr`Export (CSV)`} className="btn-pill px-3 py-1.5 text-[13px]">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                <th className="px-3 py-2 w-14"><Trans>Year</Trans></th>
                <th className="px-3 py-2 w-28 text-right"><Trans>Paid</Trans></th>
                <th className="px-3 py-2 w-24"><Trans>Type</Trans></th>
                <th className="px-3 py-2 w-52"><Trans>Publisher</Trans></th>
                <th className="px-3 py-2"><Trans>Journal / DOI</Trans></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={`${r.doi ?? r.journal}-${i}`} className="border-t border-ink/5 dark:border-white/5 align-top">
                  <td className="px-3 py-2 font-semibold text-ink dark:text-[#f5f2ea]">{r.year ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink dark:text-[#f5f2ea] whitespace-nowrap">{eur(r.euro)}</td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{r.hybrid ? tr`hybrid` : 'gold'}</td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{r.publisher}</td>
                  <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">
                    {r.doi ? (
                      <a href={doiUrl(r.doi) ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">{r.journal}</a>
                    ) : r.journal}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-ink/5 dark:border-white/5 text-sm text-muted dark:text-[#c3beb0]">
            <button type="button" className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← <Trans>Previous</Trans></button>
            <span><Trans>Page {currentPage + 1} / {pageCount}</Trans></span>
            <button type="button" className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}><Trans>Next</Trans> →</button>
          </div>
        )}
      </div>
    </div>
  );
};

/** « Suivi des APC » tab — 3 approaches as sub-tabs (estimate / agreement / actual). */
export const ApcTab: React.FC<{ dataset: DashboardDataset; range: YearRange }> = ({
  dataset,
  range,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const [page, setPage] = useState(0);
  const composite = useMemo(() => hasSubStructures(dataset.publications), [dataset.publications]);
  const openapc = dataset.openapc ?? null;
  const agg = useMemo(() => aggregateApc(dataset.publications, range), [dataset, range]);
  const deal = useMemo(() => aggregateDeal(dataset.publications, range), [dataset, range]);
  const byLabo = useMemo(
    () => (composite ? aggregateDealByLabo(dataset.publications, range) : []),
    [composite, dataset.publications, range],
  );
  const byId = useMemo(
    () => new Map(dataset.authors.map((a) => [a.id, a.label])),
    [dataset.authors],
  );

  // Detail of the « Accords éditeurs » sub-tab: articles covered by an agreement (opt-outs included).
  const dealRows = useMemo(
    () =>
      dataset.publications
        .filter(
          (p) =>
            p.publisherDeal &&
            typeof p.year === 'number' &&
            p.year >= range.start &&
            p.year <= range.end,
        )
        .sort((a, b) => sortAmount(b) - sortAmount(a)),
    [dataset.publications, range],
  );
  const hasDeal = deal.oaCount + deal.optOutCount > 0;

  type ApcSubTab = 'estimation' | 'deal' | 'openapc';
  const [sub, setSub] = useState<ApcSubTab>('estimation');
  const subTabs: { key: ApcSubTab; label: string }[] = [
    { key: 'estimation', label: tr`Estimate (OpenAlex)` },
    { key: 'deal', label: tr`Publisher agreements` },
    ...(openapc ? [{ key: 'openapc' as ApcSubTab, label: tr`Actual spending (OpenAPC)` }] : []),
  ];
  const subBtn = (active: boolean) =>
    `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
      active
        ? 'bg-accent text-ink shadow-nav-active'
        : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
    }`;

  const pageCount = Math.max(1, Math.ceil(dealRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = dealRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const authorsOf = (p: DashboardPublication) =>
    p.authorIds.map((id) => byId.get(id)).filter(Boolean).join(', ');

  const csvEscape = (v: string | number | null) => {
    const s = (v ?? '').toString();
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const downloadCsv = () => {
    const header =
      'year,title,authors,journal,issn,apc_list_amount,apc_list_currency,apc_list_usd,apc_paid_amount,apc_paid_currency,apc_paid_usd,corresponding_authors,corresponding_institutions,corresponding_countries,oa_status,doi,' +
      'deal_source,deal_agreement,deal_model,deal_confirmed_payer,deal_list_eur,deal_paid_after_discount_eur,apc_eur';
    const lines = dealRows.map((p) => {
      const d = p.apcDetail;
      const dl = p.publisherDeal;
      const best = bestEurOf(p);
      return [
        p.year, csvEscape(p.title), csvEscape(authorsOf(p)), csvEscape(p.journal), p.issn ?? '',
        d?.listAmount ?? '', d?.listCurrency ?? '', d?.listUsd ?? '',
        d?.paidAmount ?? '', d?.paidCurrency ?? '', d?.paidUsd ?? '',
        csvEscape(d?.correspondingAuthors?.join(' | ') ?? ''),
        csvEscape(d?.correspondingInstitutions?.join(' | ') ?? ''),
        csvEscape(d?.correspondingCountries?.join(' | ') ?? ''),
        p.oaStatus ?? '', p.doi ?? '',
        dl?.source ?? '', dl?.agreement ?? '', dl?.model ?? '',
        dl ? (dl.confirmedPayer ? 'oui' : 'non') : '',
        dl?.listAmountEur ?? '', dl?.paidAfterDiscountEur ?? '',
        best != null ? Math.round(best) : '',
      ].join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `apc_${dataset.slug}_${range.start}-${range.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const pctPaid = agg.pubs.length ? Math.round((agg.paidKnown / agg.pubs.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab bar: 3 approaches (estimate / publisher agreement / actual spending) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {subTabs.map(({ key, label }) => (
          <button key={key} type="button" className={subBtn(sub === key)} onClick={() => setSub(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* ─────────────── Sub-tab 1: OpenAlex estimate ────────────────────── */}
      {sub === 'estimation' &&
        (agg.pubs.length === 0 ? (
          <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
            <Trans>No publication with an estimated APC in the selection.</Trans>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
              <Trans>
                <strong>Estimate modelled by OpenAlex</strong> (all publishers): journal list price, or amount paid when known. OpenAlex <em>does not indicate who paid the fees</em> — an overview with no certainty about the payer or the actual spending (see the other sub-tabs for ground truth). Amounts converted to euros (foreign currencies converted from USD at ~€0.92).
              </Trans>
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                label={tr`Publications with estimated APC`}
                value={agg.pubs.length.toLocaleString(numberLocale())}
                icon={<ReceiptText className="w-5 h-5" />}
                color={t.series[0]}
              />
              <KpiCard
                label={tr`Total estimated cost`}
                value={`≈ ${agg.totalEur.toLocaleString(numberLocale())} €`}
                icon={<Sigma className="w-5 h-5" />}
                color={t.series[4]}
              />
              <KpiCard
                label={tr`Mean cost / publication`}
                value={agg.meanEur != null ? `≈ ${agg.meanEur.toLocaleString(numberLocale())} €` : '—'}
                icon={<Divide className="w-5 h-5" />}
                color={t.series[3]}
              />
              <KpiCard
                label={tr`Of which known amount paid`}
                value={agg.paidKnown.toLocaleString(numberLocale())}
                hint={`${pctPaid} %`}
                icon={<Euro className="w-5 h-5" />}
                color={t.series[2]}
              />
            </div>
            {agg.byYear.length > 0 && <ApcYearlyChart data={agg.byYear} />}
            {agg.byJournal.length > 0 && <ApcByJournalChart data={agg.byJournal} />}
          </>
        ))}

      {/* ─────────────── Sub-tab 3: actual OpenAPC spending ───────────────────── */}
      {sub === 'openapc' && openapc && <OpenApcSubTab data={openapc} />}

      {/* ─────────────── Sub-tab 2: publisher agreements (Elsevier) ──────────────── */}
      {sub === 'deal' &&
        (!hasDeal ? (
          <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
            <Trans>No article under a publisher agreement in the selection. (Elsevier for now; other publishers will follow.)</Trans>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
              <Trans>
                <strong>Elsevier transformative agreement</strong> (Couperin): ground truth from the publisher report — the Nantes U corresponding author triggered the agreement (<em>confirmed payer</em>). The APC is <em>covered by the national subscription</em>, paid as a lump sum by the universities (~€390k/year for Nantes U): it is not a per-article payment. The <em>list value</em> is the cumulative publisher list price (raw reference value, <strong>not a cost avoided</strong>); the <em>actual residual cost</em> is what remains invoiced after the discount (≈ 0 for most). “Non-OA” articles are those where the author declined open access (no APC), kept for monitoring. Amounts in euros.
              </Trans>
            </p>

            <div className="glass-card px-5 pt-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <BadgeCheck className="w-4 h-4" style={{ color: t.series[1] }} />
                <h3 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea]">
                  <Trans>Elsevier transformative agreement · Nantes U confirmed payer</Trans>
                </h3>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard
                  label={tr`Confirmed OA articles`}
                  value={deal.oaCount.toLocaleString(numberLocale())}
                  hint={tr`Nantes U payer`}
                  icon={<BadgeCheck className="w-5 h-5" />}
                  color={t.series[1]}
                />
                <KpiCard
                  label={tr`List value (agreement)`}
                  value={eur(deal.listTotalEur)}
                  hint={tr`publisher list price`}
                  icon={<Tag className="w-5 h-5" />}
                  color={t.series[4]}
                />
                <KpiCard
                  label={tr`Actual residual cost`}
                  value={eur(deal.paidTotalEur)}
                  hint={tr`after the agreement discount`}
                  icon={<Euro className="w-5 h-5" />}
                  color={t.series[2]}
                />
                <KpiCard
                  label={tr`Non-OA (author's choice)`}
                  value={deal.optOutCount.toLocaleString(numberLocale())}
                  hint={tr`no APC`}
                  icon={<Ban className="w-5 h-5" />}
                  color={t.series[3]}
                />
              </div>
            </div>

            {composite && byLabo.length > 0 && <ApcByLaboChart data={byLabo} />}

            {/* ── Detail of the articles under the agreement ── */}
            <div className="glass-card flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
                <div>
                  <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
                    <Trans>Details of articles under publisher agreement</Trans>
                  </h3>
                  <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
                    <Plural value={dealRows.length} one="# Elsevier article, sorted by decreasing amount" other="# Elsevier articles, sorted by decreasing amount" />
                  </p>
                </div>
          <button type="button" onClick={downloadCsv} title={tr`Export the APC list (CSV)`} className="btn-pill px-3 py-1.5 text-[13px]">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                <th className="px-3 py-2 w-14"><Trans>Year</Trans></th>
                <th className="px-3 py-2 w-56"><Trans>Journal</Trans></th>
                <th className="px-3 py-2 w-32 text-right"><Trans>APC amount</Trans></th>
                <th className="px-3 py-2 w-40"><Trans>Agreement / Payer</Trans></th>
                <th className="px-3 py-2 w-44"><Trans>Corresponding author</Trans></th>
                <th className="px-3 py-2 w-52"><Trans>Corresponding author's affiliation</Trans></th>
                <th className="px-3 py-2 w-48"><Trans>{dataset.lab} authors</Trans></th>
                <th className="px-3 py-2 w-28"><Trans>OA status</Trans></th>
                <th className="px-3 py-2"><Trans>Title / DOI</Trans></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p, i) => (
                <tr key={`${p.doi ?? p.title}-${i}`} className="border-t border-ink/5 dark:border-white/5 align-top">
                  <td className="px-3 py-2 font-semibold text-ink dark:text-[#f5f2ea]">{p.year}</td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{p.journal ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink dark:text-[#f5f2ea] whitespace-nowrap">
                    {(() => {
                      const dl = p.publisherDeal;
                      if (dl && dl.model === 'subscription')
                        return (
                          <span className="text-muted-light dark:text-[#8f897c] font-normal" title={tr`Non-OA: the author declined open access — no APC`}>
                            0 €
                          </span>
                        );
                      if (dl && isDealOa(dl)) {
                        const oa = oaEurOf(p);
                        return (
                          <>
                            <div>{dl.listAmountEur != null ? eur(dl.listAmountEur) : oa != null ? eur(oa) : '—'}</div>
                            {dl.paidAfterDiscountEur != null && (
                              <div className="text-[11px] font-normal text-muted-light dark:text-[#8f897c]">
                                <Trans>residual {eur(dl.paidAfterDiscountEur)}</Trans>
                              </div>
                            )}
                          </>
                        );
                      }
                      const oa = oaEurOf(p);
                      return oa != null ? eur(oa) : '—';
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    {(() => {
                      const dl = p.publisherDeal;
                      if (!dl) return <span className="text-muted-light dark:text-[#8f897c]">—</span>;
                      if (isDealOa(dl))
                        return (
                          <span className="inline-flex flex-col gap-0.5">
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap"
                              style={{ color: t.series[1] }}
                              title={tr`Nantes U corresponding author — agreement triggered (confirmed payer)`}
                            >
                              <BadgeCheck className="w-3.5 h-3.5" /> <Trans>Nantes U payer</Trans>
                            </span>
                            {dl.agreement && (
                              <span className="text-[10px] text-muted-light dark:text-[#8f897c]">{dl.agreement}</span>
                            )}
                          </span>
                        );
                      return (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-light dark:text-[#8f897c] whitespace-nowrap" title={tr`Elsevier article under agreement, published non-OA (no APC)`}>
                          <Ban className="w-3.5 h-3.5" /> Elsevier · non-OA
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">
                    {p.apcDetail?.correspondingAuthors.join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">
                    {p.apcDetail?.correspondingInstitutions.join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{authorsOf(p) || '—'}</td>
                  <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">
                    {p.oaStatus ? oaLabel(p.oaStatus) : '—'}
                  </td>
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
              ))}
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
          </>
        ))}
    </div>
  );
};
