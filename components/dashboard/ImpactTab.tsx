import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import {
  aggregateImpact,
  IMPACT_RESEARCHER_TOP,
  impactRowsByGrouping,
  type ImpactGrouping,
  topPublicationRows,
  TopTableKind,
} from './impactAggregates';
import { PubFilters } from './publicationFilters';
import { ImpactKpiCards } from './ImpactKpiCards';
import { QuartileChart } from './charts/QuartileChart';
import { TopByYearChart } from './charts/TopByYearChart';
import { FwciHistogramChart } from './charts/FwciHistogramChart';
import { FwciMeanByGroupChart, TopByGroupChart } from './charts/ImpactGroupCharts';
import { numberLocale } from '../../lib/i18n';
import { doiUrl } from '../../lib/doi';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

const TEAM_UNKNOWN = 'Non identifié';
// Local name kept: it is the placeholder of a translated message.
const RESEARCHER_TOP = IMPACT_RESEARCHER_TOP;
const PAGE_SIZE = 25;

type Grouping = ImpactGrouping;

const subBtn = (active: boolean) =>
  `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
    active
      ? 'bg-accent text-ink shadow-nav-active'
      : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
  }`;

/** « Impact par équipe ou chercheur » (formerly « Impact par regroupement » in the Streamlit). */
const ImpactGroupingSection: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const { t } = useLingui();
  const { publications, authors, teamLabel } = dataset;

  const groupings = useMemo(() => {
    const list: { key: Grouping; label: string }[] = [];
    if (publications.some((p) => p.sousStructures.length > 0)) {
      list.push({ key: 'sousStructure', label: t`By sub-structure` });
    }
    if (publications.some((p) => p.teams.some((tm) => tm && tm !== TEAM_UNKNOWN))) {
      list.push({ key: 'team', label: t`By ${teamLabel}` });
    }
    list.push({ key: 'researcher', label: t`By researcher` });
    return list;
  }, [publications, teamLabel, t]);

  const [grouping, setGrouping] = useState<Grouping>(groupings[0]?.key ?? 'researcher');
  // `groupings` may lose the current entry (e.g. no publication with a sub-structure left
  // after a range change) without `grouping` (frozen at mount) realigning — the active button
  // vanished from the UI while `rows` was still computed on the stale key, showing
  // « pas de données » although another grouping would have some (review lot 9c).
  useEffect(() => {
    if (groupings.length && !groupings.some((g) => g.key === grouping)) setGrouping(groupings[0].key);
  }, [groupings, grouping]);

  const rows = useMemo(
    () => impactRowsByGrouping(publications, authors, range, grouping),
    [publications, range, grouping, authors],
  );

  const suffix = grouping === 'sousStructure' ? 'sous-structure' : grouping === 'team' ? 'equipe' : 'chercheur';

  // The « par chercheur » grouping exposes no reliable id → no list link.
  const onGroup =
    onOpenList && grouping !== 'researcher'
      ? (group: string) => onOpenList(grouping === 'team' ? { team: group } : { sousStructure: group })
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h3 className="section-label"><Trans>Impact by team or researcher</Trans></h3>
        <div className="flex items-center gap-1.5">
          {groupings.map(({ key, label }) => (
            <button key={key} type="button" className={subBtn(grouping === key)} onClick={() => setGrouping(key)}>
              {label}
            </button>
          ))}
        </div>
        {grouping === 'researcher' && (
          <span className="text-[11px] text-muted-lighter dark:text-[#8f897c]">
            <Trans>Top {RESEARCHER_TOP} by mean FWCI</Trans>
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>No FWCI data for this grouping over the period.</Trans>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FwciMeanByGroupChart rows={rows} exportName={`impact-fwci-${suffix}`} onSelect={onGroup} />
          <TopByGroupChart
            rows={rows}
            exportName={`impact-top-${suffix}`}
            onSelect={
              onGroup
                ? (group, tranche) =>
                    onOpenList!(
                      grouping === 'team'
                        ? { team: group, [tranche]: true }
                        : { sousStructure: group, [tranche]: true },
                    )
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
};

/** Top 1% / Top 10% / FWCI ranking table, with CSV export. */
const TopPublicationsTable: React.FC<{ dataset: DashboardDataset; range: YearRange }> = ({
  dataset,
  range,
}) => {
  const { t } = useLingui();
  const [kind, setKind] = useState<TopTableKind>('top1');
  const [page, setPage] = useState(0);

  const rows = useMemo(
    () => topPublicationRows(dataset.publications, dataset.authors, range, kind),
    [dataset, range, kind],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const kinds: { key: TopTableKind; label: string }[] = [
    { key: 'top1', label: t`Top 1%` },
    { key: 'top10', label: t`Top 10%` },
    { key: 'fwci', label: t`FWCI ranking` },
  ];

  const csvEscape = (v: string | number | null) => {
    const s = (v ?? '').toString();
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const downloadCsv = () => {
    const header = 'year,title,authors,journal,fwci,citations,teams,doi';
    const lines = rows.map((r) =>
      [r.year, csvEscape(r.title), csvEscape(r.authors), csvEscape(r.journal), r.fwci ?? '', r.citedByCount, csvEscape(r.teams), r.doi ?? ''].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `impact_${kind}_${range.start}-${range.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="glass-card flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
            <Trans>Most cited publications</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Plural value={rows.length} one="# publication" other="# publications" /> — <Trans>citations normalised by discipline (FWCI)</Trans>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {kinds.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={subBtn(kind === key)}
                onClick={() => {
                  setKind(key);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={downloadCsv} title={t`Export as CSV`} className="btn-pill px-3 py-1.5 text-[13px]">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>No publication in this category for the current selection.</Trans>
        </p>
      ) : (
        <>
          <div className="overflow-x-auto px-2 pb-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                  <th className="px-3 py-2 w-14"><Trans>Year</Trans></th>
                  <th className="px-3 py-2"><Trans>Title</Trans></th>
                  <th className="px-3 py-2 w-56"><Trans>{dataset.lab} authors</Trans></th>
                  <th className="px-3 py-2 w-56"><Trans>Journal</Trans></th>
                  <th className="px-3 py-2 w-20 text-right">FWCI</th>
                  <th className="px-3 py-2 w-20 text-right"><Trans>Citations</Trans></th>
                  <th className="px-3 py-2 w-40"><Trans>Team</Trans></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={`${r.doi ?? r.title}-${i}`} className="border-t border-ink/5 dark:border-white/5 align-top">
                    <td className="px-3 py-2 font-semibold text-ink dark:text-[#f5f2ea]">{r.year}</td>
                    <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">
                      {r.doi ? (
                        <a href={doiUrl(r.doi) ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">
                          {r.title ?? r.doi}
                        </a>
                      ) : (
                        r.title ?? '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{r.authors || '—'}</td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{r.journal ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ink dark:text-[#f5f2ea]">
                      {r.fwci != null ? r.fwci.toLocaleString(numberLocale(), { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-muted dark:text-[#c3beb0]">
                      {r.citedByCount.toLocaleString(numberLocale())}
                    </td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{r.teams || '—'}</td>
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
        </>
      )}
    </div>
  );
};

/** « Impact et citations » tab (ported from the Streamlit + SoVisu+ mockups). */
export const ImpactTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const agg = useMemo(
    () => aggregateImpact(dataset.publications, range),
    [dataset, range],
  );

  return (
    <div className="flex flex-col gap-4">
      <ImpactKpiCards kpis={agg.kpis} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agg.quartileKnown > 0 ? (
          <QuartileChart
            data={agg.quartiles}
            onSelect={onOpenList ? (key) => onOpenList({ quartile: key }) : undefined}
          />
        ) : (
          <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
            <Trans>No Scimago-ranked journal over the period.</Trans>
          </div>
        )}
        <TopByYearChart
          data={agg.topByYear}
          onSelect={onOpenList ? (year, tranche) => onOpenList({ year, [tranche]: true }) : undefined}
        />
      </div>
      <FwciHistogramChart data={agg.fwciHistogram} />
      <ImpactGroupingSection dataset={dataset} range={range} onOpenList={onOpenList} />
      <TopPublicationsTable dataset={dataset} range={range} />
    </div>
  );
};
