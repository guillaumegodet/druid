import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Loader2, Minus, Sparkles, X } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { YearRange } from './overviewAggregates';
import { LARGE_COLLAB_MAX_AUTHORS } from './interLabNetwork';
import { CommonPublicationsPanel } from './NetworkTab';
import { ChartStateContext, type ChartState } from './EChartCard';
import {
  DISTANT_PROFILES,
  PairAuthor,
  PairRelation,
  PairsParams,
  PairsResponse,
  PairTrend,
  ResearcherPair,
  fetchPairs,
  pairsChartParams,
} from './pairsApi';
import { pairsKpiItems } from './pairsKpis';
import { numberLocale } from '../../lib/i18n';
import { toCsv } from '../../lib/chartExport';
import { downloadBlob } from './chartFileExport';
import { KpiGrid } from './KpiCards';
import { PairMatrixChart } from './charts/PairMatrixChart';
import { helpUrl } from '../../lib/helpLinks';

type SortKey = 'shared' | 'distance' | 'last';
const PAGE = 100;

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)} %`);

/** Lab chips and reliability badges of one researcher of a pair. */
const AuthorCell: React.FC<{ author: PairAuthor }> = ({ author }) => {
  const { t } = useLingui();
  const kinds = new Set(Object.values(author.m ?? {}));
  const name = author.uid ? (
    <a
      href={`${window.location.pathname}?page=RESEARCHER_DETAIL&id=${encodeURIComponent(author.uid)}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="font-semibold text-ink dark:text-[#f5f2ea] hover:underline"
    >
      {author.label}
    </a>
  ) : (
    <span className="font-semibold text-ink dark:text-[#f5f2ea]">{author.label}</span>
  );
  const badge = 'pill px-1.5 py-px text-[10px] whitespace-nowrap';
  return (
    <div className="flex flex-col gap-0.5">
      {name}
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted dark:text-[#c3beb0]">
        <span>{author.labs.join(', ')}</span>
        {author.poles.length > 0 && (
          <span className="text-muted-light dark:text-[#8f897c]">· {author.poles.join(', ')}</span>
        )}
        {kinds.has('assoc') && (
          <span className={`${badge} bg-pixel-teal/15 text-ink dark:text-[#f5f2ea]`} title={t`Associate or visiting member of the lab in the directory`}>
            <Trans>associate</Trans>
          </span>
        )}
        {kinds.has('pubs') && (
          <span className={`${badge} bg-[#f0b429]/20 text-ink dark:text-[#f5f2ea]`} title={t`Lab deduced from the publications only: the directory does not list this person in the lab`}>
            <Trans>lab from publications</Trans>
          </span>
        )}
        {author.phd && (
          <span className={`${badge} bg-white/60 dark:bg-white/10`}>
            <Trans>PhD student</Trans>
          </span>
        )}
      </div>
    </div>
  );
};

const TrendCell: React.FC<{ trend: PairTrend; first: number; last: number }> = ({ trend, first, last }) => {
  const { t } = useLingui();
  const labels: Record<PairTrend, { icon: React.ReactNode; label: string; title: string }> = {
    new: { icon: <Sparkles className="w-3.5 h-3.5 text-pixel-teal" />, label: t`New`, title: t`First joint publication in the last three years` },
    rising: { icon: <ArrowUp className="w-3.5 h-3.5 text-pixel-teal" />, label: t`Rising`, title: t`More joint publications in the last three years than in the three before` },
    steady: { icon: <Minus className="w-3.5 h-3.5 text-muted-light" />, label: t`Steady`, title: t`Joint publications in the last three years, no more than before` },
    dormant: { icon: <ArrowDown className="w-3.5 h-3.5 text-[#b23b3b] dark:text-[#f08c8c]" />, label: t`Dormant`, title: t`No joint publication in the last three years` },
  };
  const l = labels[trend];
  return (
    <div className="flex flex-col gap-0.5" title={l.title}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">{l.icon}{l.label}</span>
      <span className="text-[11px] text-muted-light dark:text-[#8f897c]">{first === last ? first : `${first}–${last}`}</span>
    </div>
  );
};

/**
 * « Researcher pairs » sub-tab of Partnerships (druid-internal `docs/plan-binomes-chercheurs.md`, lot 1): the
 * researchers who already co-sign across labs and poles, from the university-wide co-authorship network.
 */
export const PairsSection: React.FC<{ slug: string; range: YearRange }> = ({ slug, range }) => {
  const { t, i18n } = useLingui();
  const [relation, setRelation] = useState<PairRelation>('lab');
  const [scope, setScope] = useState<PairsParams['scope']>('all');
  const [distantOnly, setDistantOnly] = useState(false);
  const [membership, setMembership] = useState<PairsParams['membership']>('all');
  const [includePhd, setIncludePhd] = useState(true);
  const [excludeLarge, setExcludeLarge] = useState(true);
  const [minShared, setMinShared] = useState(2);
  const [sort, setSort] = useState<SortKey>('shared');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<ResearcherPair | null>(null);

  const [data, setData] = useState<PairsResponse | 'none' | 'error' | null>(null);
  const [loading, setLoading] = useState(false);
  const params = useMemo<PairsParams>(
    () => ({ range, relation, scope, distantOnly, membership, includePhd, excludeLarge, minShared }),
    [range, relation, scope, distantOnly, membership, includePhd, excludeLarge, minShared],
  );
  // « Add to a report » on a matrix keeps the options of the sub-tab (PAIRS_PARAMS of chartMeta.ts).
  const chartState = useMemo<ChartState>(() => ({ params: pairsChartParams(params) }), [params]);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchPairs(slug, params, ctrl.signal)
      .then((r) => { setData(r ?? 'none'); setLoading(false); })
      .catch(() => { if (!ctrl.signal.aborted) { setData('error'); setLoading(false); } });
    return () => ctrl.abort();
  }, [slug, params]);

  // Cell of the lab matrix: the table lists the pairs of that couple of labs (the matrices and the key
  // figures stay those of every pair).
  const [labPair, setLabPair] = useState<[string, string] | null>(null);
  const [cellData, setCellData] = useState<PairsResponse | null>(null);
  useEffect(() => { setLabPair(null); }, [params]);
  useEffect(() => {
    setCellData(null);
    if (!labPair) return;
    const ctrl = new AbortController();
    fetchPairs(slug, { ...params, labPair }, ctrl.signal)
      .then((r) => setCellData(r))
      .catch(() => { /* the table keeps every pair */ });
    return () => ctrl.abort();
  }, [slug, params, labPair]);
  useEffect(() => { setShown(PAGE); setSelected(null); }, [data, cellData, sort]);

  const loaded = data && typeof data === 'object' ? data : null;
  const tableData = labPair ? cellData : loaded;
  const rows = useMemo(() => {
    if (!tableData) return [];
    const list = [...tableData.pairs];
    if (sort === 'distance') list.sort((x, y) => (y.distance ?? -1) - (x.distance ?? -1) || y.shared - x.shared);
    else if (sort === 'last') list.sort((x, y) => y.last - x.last || y.shared - x.shared);
    return list;
  }, [tableData, sort]);

  const poleCouples = useMemo(() => {
    const poles = loaded?.poles ?? [];
    const out: { value: PairRelation; label: string }[] = [];
    poles.forEach((p, i) => poles.slice(i).forEach((q) => {
      out.push({ value: `${p.acronym}|${q.acronym}`, label: `${p.acronym} × ${q.acronym}` });
    }));
    return out;
  }, [loaded?.poles]);

  if (data === 'none') {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>This structure is not part of the university co-authorship network.</Trans>
      </div>
    );
  }

  const fmt = (n: number) => n.toLocaleString(numberLocale());
  const select = 'input-soft !w-auto py-1 pr-7 text-xs cursor-pointer';
  const check = 'inline-flex items-center gap-1.5 cursor-pointer';
  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className={`uppercase tracking-wide cursor-pointer ${sort === key ? 'text-ink dark:text-[#f5f2ea] underline' : 'hover:underline'}`}
    >
      {label}
    </button>
  );
  const kpis = loaded ? pairsKpiItems(loaded) : [];

  const downloadCsv = () => {
    const kind = (a: PairAuthor) => Object.values(a.m ?? {}).join('|');
    const csv = toCsv({
      name: 'binomes',
      columns: [
        'researcher_1', 'labs_1', 'poles_1', 'membership_1', 'researcher_2', 'labs_2', 'poles_2', 'membership_2',
        'joint_publications', 'share_1', 'share_2', 'first_year', 'last_year', 'trend', 'distance', 'subfields',
      ],
      rows: rows.map((p) => [
        p.a.label, p.a.labs.join('|'), p.a.poles.join('|'), kind(p.a),
        p.b.label, p.b.labs.join('|'), p.b.poles.join('|'), kind(p.b),
        p.shared, p.share[0], p.share[1], p.first, p.last, p.trend, p.distance, p.subfields.join('|'),
      ]),
    });
    const suffix = labPair ? `-${labPair.join('-')}` : '';
    downloadBlob(new Blob([`\ufeff${csv}\r\n`], { type: 'text/csv;charset=utf-8' }),
      `binomes-${slug}-${range.start}-${range.end}${suffix}.csv`);
  };

  const cov = loaded?.coverage;
  const coveragePct = cov && cov.signatures ? Math.round((cov.resolvedSignatures / cov.signatures) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-4 flex flex-col gap-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <select className={select} value={relation} onChange={(e) => setRelation(e.target.value as PairRelation)} title={t`Which pairs`}>
            <option value="lab">{t`Researchers of different labs`}</option>
            {poleCouples.length > 0 && <option value="pole">{t`Researchers of different poles`}</option>}
            {poleCouples.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {loaded?.structureLabs && (
            <select className={select} value={scope} onChange={(e) => setScope(e.target.value as PairsParams['scope'])} title={t`Scope`}>
              <option value="all">{t`At least one researcher of the structure`}</option>
              <option value="structure">{t`Both researchers in the structure`}</option>
            </select>
          )}
          <select className={select} value={membership} onChange={(e) => setMembership(e.target.value as PairsParams['membership'])} title={t`Lab membership of the researchers`}>
            <option value="all">{t`Every lab attribution`}</option>
            <option value="associates">{t`Labs of the directory (members and associates)`}</option>
            <option value="members">{t`Labs of the directory (members only)`}</option>
          </select>
          <select className={select} value={minShared} onChange={(e) => setMinShared(Number(e.target.value))} title={t`Minimum joint publications`}>
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>{t`≥ ${n} joint publications`}</option>
            ))}
          </select>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-light" aria-label={t`Loading`} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted dark:text-[#c3beb0]">
          <label className={check} title={t`Distance between the OpenAlex field profiles of the two researchers, outside their joint publications`}>
            <input type="checkbox" checked={distantOnly} onChange={(e) => setDistantOnly(e.target.checked)} className="accent-[#7048e8]" />
            <Trans>Distant disciplinary profiles only (distance ≥ {DISTANT_PROFILES})</Trans>
          </label>
          <label className={check}>
            <input type="checkbox" checked={includePhd} onChange={(e) => setIncludePhd(e.target.checked)} className="accent-[#7048e8]" />
            <Trans>Include PhD students</Trans>
          </label>
          <label className={check}>
            <input type="checkbox" checked={excludeLarge} onChange={(e) => setExcludeLarge(e.target.checked)} className="accent-[#7048e8]" />
            <Trans>Exclude large collaborations (more than {LARGE_COLLAB_MAX_AUTHORS} authors)</Trans>
          </label>
        </div>
      </div>

      {data === 'error' && (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>The researcher pairs could not be loaded.</Trans>
        </div>
      )}
      {data === null && (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>Loading the university network…</Trans>
        </div>
      )}

      {loaded && (
        <>
          <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
            <Plural
              value={loaded.total}
              one="# pair of researchers"
              other="# pairs of researchers"
            />{' '}
            <Trans>
              involving {fmt(loaded.counts.authors)} researchers — {fmt(loaded.counts.crossPole)} between poles,{' '}
              {fmt(loaded.counts.distant)} with distant profiles, {fmt(loaded.counts.new)} new,{' '}
              {fmt(loaded.counts.dormant)} dormant.
            </Trans>
          </p>

          <KpiGrid items={kpis} className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3" />

          <ChartStateContext.Provider value={chartState}>
          <div className={`grid grid-cols-1 gap-4 ${loaded.poleMatrix.length > 0 ? 'xl:grid-cols-3' : ''}`}>
            {loaded.poleMatrix.length > 0 && (
              <PairMatrixChart
                cells={loaded.poleMatrix}
                title={t`Pairs by couple of poles`}
                subtitle={t`Diagonal: pairs of different labs within a pole`}
                exportName="collab-pairs-poles"
              />
            )}
            <div className={loaded.poleMatrix.length > 0 ? 'xl:col-span-2' : ''}>
              <PairMatrixChart
                cells={loaded.labMatrix}
                title={t`Pairs by couple of labs`}
                subtitle={t`Number of pairs, not of publications · click a cell to list its pairs`}
                exportName="collab-pairs-labs"
                selected={labPair}
                onCellClick={(a, b) => setLabPair(labPair && labPair[0] === a && labPair[1] === b ? null : [a, b])}
              />
            </div>
          </div>
          </ChartStateContext.Provider>

          <div className="flex flex-wrap items-center gap-2 px-1">
            {labPair && (
              <button
                type="button"
                onClick={() => setLabPair(null)}
                title={t`Show every pair`}
                className="pill inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/25 dark:bg-accent/20 text-ink dark:text-[#f5f2ea] hover:bg-accent/40 cursor-pointer"
              >
                {labPair[0]} × {labPair[1]}
                {cellData && <span className="text-muted-light dark:text-[#8f897c]">· {fmt(cellData.total)}</span>}
                <X className="w-3 h-3 opacity-60" />
              </button>
            )}
            {rows.length > 0 && (
              <button
                type="button"
                onClick={downloadCsv}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted dark:text-[#c3beb0] hover:underline cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> <Trans>Pairs (CSV)</Trans>
              </button>
            )}
          </div>

          {selected && (
            <CommonPublicationsPanel
              slug={slug}
              link={{ a: `a:${selected.a.id}`, b: `a:${selected.b.id}` }}
              names={new Map([[`a:${selected.a.id}`, selected.a.label], [`a:${selected.b.id}`, selected.b.label]])}
              range={range}
              excludeLarge={excludeLarge}
              onClose={() => setSelected(null)}
              university
            />
          )}

          {labPair && !cellData ? (
            <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>Loading…</Trans>
            </div>
          ) : rows.length === 0 ? (
            <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>No pair of researchers matches these filters over the period.</Trans>
            </div>
          ) : (
            <div className="glass-card overflow-x-auto px-2 pb-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                    <th className="px-3 py-2"><Trans>Researcher</Trans></th>
                    <th className="px-3 py-2"><Trans>Researcher</Trans></th>
                    <th className="px-3 py-2 text-right">{sortBtn('shared', t`Joint pubs`)}</th>
                    <th className="px-3 py-2 text-right" title={t`Part of each researcher's publications of the period`}><Trans>Share</Trans></th>
                    <th className="px-3 py-2">{sortBtn('last', t`Trend`)}</th>
                    <th className="px-3 py-2 text-right">{sortBtn('distance', t`Distance`)}</th>
                    <th className="px-3 py-2"><Trans>Main subfields</Trans></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((p) => (
                    <tr
                      key={`${p.a.id}-${p.b.id}`}
                      onClick={() => setSelected(p)}
                      title={t`Show the joint publications`}
                      className={`border-t border-ink/5 dark:border-white/5 align-top cursor-pointer hover:bg-accent/10 ${selected === p ? 'bg-accent/15' : ''}`}
                    >
                      <td className="px-3 py-2"><AuthorCell author={p.a} /></td>
                      <td className="px-3 py-2"><AuthorCell author={p.b} /></td>
                      <td className="px-3 py-2 text-right font-semibold text-ink dark:text-[#f5f2ea]">{p.shared}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-muted dark:text-[#c3beb0]">
                        {pct(p.share[0])} · {pct(p.share[1])}
                      </td>
                      <td className="px-3 py-2 text-xs"><TrendCell trend={p.trend} first={p.first} last={p.last} /></td>
                      <td className="px-3 py-2 text-right">
                        {p.distance == null ? '—' : (
                          <span className={p.distance >= DISTANT_PROFILES ? 'font-semibold text-ink dark:text-[#f5f2ea]' : 'text-muted dark:text-[#c3beb0]'}>
                            {p.distance.toLocaleString(i18n.locale, { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted dark:text-[#c3beb0]">{p.subfields.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > shown && (
                <div className="flex justify-center py-2">
                  <button type="button" onClick={() => setShown(shown + PAGE)} className="text-xs text-muted dark:text-[#c3beb0] hover:underline cursor-pointer">
                    <Trans>Show more ({fmt(rows.length - shown)} remaining)</Trans>
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-light dark:text-[#8f897c] leading-relaxed px-1">
            <Trans>
              Source: university-wide corpus ({loaded.source}) of {new Date(loaded.generatedAt).toLocaleDateString(i18n.locale)}.
              The numbers are lower bounds: {coveragePct}% of the internal signatures are linked to a lab. They describe
              joint publications, not the performance of the researchers. The trend compares the last three years up to{' '}
              {loaded.refYear ?? '—'} with the three before.
            </Trans>
            {loaded.version < 3 && (
              <> <Trans>Disciplinary distance and directory memberships are unavailable until the network is regenerated.</Trans></>
            )}
            {loaded.restricted && (
              <> <Trans>Only the pairs involving a researcher of your lab are shown.</Trans></>
            )}{' '}
            <a href={helpUrl('/guides/tableau-de-bord/binomes/', i18n.locale)} target="_blank" rel="noreferrer" className="underline hover:text-ink dark:hover:text-[#f5f2ea]">
              <Trans>How to read this view</Trans>
            </a>
          </p>
        </>
      )}
    </div>
  );
};
