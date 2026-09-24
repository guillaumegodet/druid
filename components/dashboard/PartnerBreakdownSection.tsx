import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Landmark } from 'lucide-react';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { PubFilters } from './publicationFilters';
import {
  aggregatePartnerBreakdown,
  PartnerBreakdownEntry,
  PartnerCatalogEntry,
} from './collabAggregates';
import type { ConsortiumMember } from './consortia';
import { RankBarChart, StackedAreaChart } from './charts/TeamCharts';
import { numberLocale } from '../../lib/i18n';
import { doiUrl } from '../../lib/doi';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

/** « grande collaboration » threshold (ALICE/CMS hyper-authorship…) — cf. plan §4, to be tuned with use. */
export const HYPER_AUTHORED_THRESHOLD = 50;
const RECENT_PUBLICATIONS_N = 10;

/**
 * Lot 3 of the « collaborations par groupe d'universités » plan
 * (docs/archive/plan-collab-consortium.md, 2026-09-15): institution-by-institution
 * detail of a selection of ≥ 2 partners (typically a consortium chosen via
 * the picker chips). Overview (bars + stacked evolution, non-exclusive
 * counting) then panel of the current institution: internal researchers
 * « Nom (labo) », OpenAlex topics, recent publications with DOI link, and
 * links to the filtered list (PubFilters.partnerKeys combined with
 * authorId / themeKeys). Mounted by PartnerBilanSection below the global summary.
 */
export const PartnerBreakdownSection: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  selectedKeys: string[];
  catalog: PartnerCatalogEntry[];
  /** Label of the selection (« EUniWell », « ce groupe (3 institutions) »…). */
  groupLabel: string;
  /** Consortium members without any co-publication (note below the chart). */
  missingMembers?: ConsortiumMember[];
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, selectedKeys, catalog, groupLabel, missingMembers = [], onOpenList }) => {
  const { t } = useLingui();
  const [excludeHyper, setExcludeHyper] = useState(false);
  // The filter only makes sense if the export carries the author count (≥ 2026-09-15).
  const hasAuthorCount = useMemo(
    () => dataset.publications.some((p) => typeof p.authorCount === 'number'),
    [dataset.publications],
  );
  // Same threshold for the aggregate and for the lists opened from the section
  // (PubFilters.maxAuthors), so that « Voir les N publications » indeed yields N rows.
  const maxAuthors = excludeHyper && hasAuthorCount ? HYPER_AUTHORED_THRESHOLD : undefined;
  const breakdown = useMemo(
    () =>
      aggregatePartnerBreakdown(dataset.publications, range, selectedKeys, dataset.authors, catalog, {
        maxAuthors,
      }),
    [dataset.publications, dataset.authors, range, selectedKeys, catalog, maxAuthors],
  );
  const { entries } = breakdown;

  const [currentKey, setCurrentKey] = useState<string | null>(null);
  // Current institution: the top co-signer by default, and we fall back to it
  // if the selection or the filter makes the chosen institution disappear.
  useEffect(() => {
    if (entries.length === 0) {
      setCurrentKey(null);
      return;
    }
    if (!currentKey || !entries.some((e) => e.key === currentKey)) setCurrentKey(entries[0].key);
  }, [entries, currentKey]);
  const current: PartnerBreakdownEntry | null = useMemo(
    () => entries.find((e) => e.key === currentKey) ?? null,
    [entries, currentKey],
  );
  const keyByName = useMemo(() => new Map(entries.map((e) => [e.name, e.key])), [entries]);

  // Falls back to `null` only if the emptiness is not caused by excludeHyper: otherwise the
  // « Exclure les grandes collaborations » checkbox (just below) vanished with everything else,
  // with no way to uncheck it to go back (review lot 9c). The rest of the rendering already
  // handles an empty `entries` (detail panel guarded by `current &&`, lists that simply render nothing).
  if (entries.length === 0 && !excludeHyper) return null;

  const fmt = (n: number) => n.toLocaleString(numberLocale());

  return (
    <div className="glass-card p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-1.5">
            <Landmark className="w-4 h-4" /> <Trans>By university</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Trans>
              Nantes Université's collaborations with each member of {groupLabel}. A publication co-signed by several members counts for each of them: the bars add up to more than the total of {fmt(breakdown.total)} publications.
            </Trans>
          </p>
        </div>
        {hasAuthorCount && (
          <label className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              className="accent-current w-3.5 h-3.5"
              checked={excludeHyper}
              onChange={(e) => setExcludeHyper(e.target.checked)}
            />
            <Trans>{"Exclude large collaborations (> "}{HYPER_AUTHORED_THRESHOLD} authors)</Trans>
            {excludeHyper && breakdown.excludedHyperAuthored > 0 && (
              <span className="text-xs text-muted-light dark:text-[#8f897c]">
                — <Plural value={breakdown.excludedHyperAuthored} one="# publication excluded" other="# publications excluded" />
              </span>
            )}
          </label>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <RankBarChart
            title={t`Co-publications by university`}
            subtitle={t`Click a bar for details`}
            exportName="partner-breakdown-top"
            data={entries.map((e) => ({ label: e.name, count: e.total, teams: [] }))}
            colorSlot={4}
            height={Math.max(240, entries.length * 28 + 60)}
            onItemClick={(name) => {
              const k = keyByName.get(name);
              if (k) setCurrentKey(k);
            }}
          />
        </div>
        <div className="lg:col-span-3">
          <StackedAreaChart
            title={t`Yearly trend by university`}
            exportName="partner-breakdown-evolution"
            data={breakdown.byYearStacked}
          />
        </div>
      </div>

      {missingMembers.length > 0 && (
        <p className="text-xs text-muted-light dark:text-[#8f897c]">
          <Plural
            value={missingMembers.length}
            one="Member with no co-publication in the corpus:"
            other="Members with no co-publication in the corpus:"
          />{' '}
          {missingMembers.map((m) => m.name).join(', ')}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={() => setCurrentKey(e.key)}
            className={`pill px-2.5 py-1 text-xs cursor-pointer ${
              e.key === currentKey
                ? 'bg-accent text-ink shadow-nav-active'
                : 'bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25'
            }`}
          >
            {e.name} · {fmt(e.total)}
          </button>
        ))}
      </div>

      {current && (
        <div className="flex flex-col gap-4">
          <div className="glass-card-strong p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted dark:text-[#c3beb0]">
              <strong className="text-ink dark:text-[#f5f2ea]">{current.name}</strong> —{' '}
              <strong className="text-ink dark:text-[#f5f2ea]">{fmt(current.total)}</strong>{' '}
              <Plural value={current.total} one="joint publication" other="joint publications" />{' '}
              <Trans>over the period.</Trans>
            </p>
            {onOpenList && (
              <button
                type="button"
                onClick={() => onOpenList({ partnerKeys: [current.key], maxAuthors })}
                className="pill px-3 py-1.5 text-xs bg-accent text-ink shadow-nav-active cursor-pointer shrink-0"
              >
                <Trans>View the {fmt(current.total)} publications</Trans>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <RankBarChart
              title={t`Most frequent Nantes Université researchers`}
              subtitle={t`Name (laboratory)`}
              exportName="partner-breakdown-chercheurs"
              data={current.topResearchers}
              colorSlot={2}
              height={Math.max(260, current.topResearchers.length * 26 + 60)}
              onItemSelect={
                onOpenList && current
                  ? (item) =>
                      item.id != null &&
                      onOpenList({ authorId: item.id, partnerKeys: [current.key], maxAuthors })
                  : undefined
              }
            />
            <RankBarChart
              title={t`Topics of the co-publications`}
              subtitle={t`OpenAlex topics`}
              exportName="partner-breakdown-topics"
              data={current.topTopics.map((tp) => ({ label: tp.key, count: tp.count, teams: [] }))}
              colorSlot={3}
              height={Math.max(260, current.topTopics.length * 26 + 60)}
              onItemClick={
                onOpenList && current
                  ? (topic) => onOpenList({ themeKeys: [topic], partnerKeys: [current.key], maxAuthors })
                  : undefined
              }
            />
            <div className="glass-card-strong p-4 flex flex-col gap-2 min-w-0">
              <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea]">
                <Trans>Recent publications</Trans>
              </h4>
              <ul className="flex flex-col gap-2 text-[13px]">
                {current.publications.slice(0, RECENT_PUBLICATIONS_N).map((p, i) => {
                  const url = doiUrl(p.doi);
                  return (
                    <li key={`${p.doi ?? p.title}-${i}`} className="flex gap-2 min-w-0">
                      <span className="font-semibold text-ink dark:text-[#f5f2ea] shrink-0 w-10">
                        {p.year ?? '—'}
                      </span>
                      <span className="min-w-0">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ink dark:text-[#f5f2ea] hover:underline inline-flex items-start gap-1"
                          >
                            <span>{p.title ?? p.doi}</span>
                            <ExternalLink className="w-3 h-3 mt-1 shrink-0 opacity-60" />
                          </a>
                        ) : (
                          <span className="text-ink dark:text-[#f5f2ea]">{p.title ?? '—'}</span>
                        )}
                        {p.journal && (
                          <span className="block text-xs text-muted-light dark:text-[#8f897c]">
                            {p.journal}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {current.publications.length > RECENT_PUBLICATIONS_N && (
                <p className="text-xs text-muted-light dark:text-[#8f897c]">
                  <Plural
                    value={current.publications.length - RECENT_PUBLICATIONS_N}
                    one="+ # more publication, see the full list above."
                    other="+ # more publications, see the full list above."
                  />
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
