import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Network, Search, X, Loader2 } from 'lucide-react';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { aggregateNetwork } from './networkAggregates';
import { NetworkChart, InterLabRendering } from './charts/NetworkChart';
import {
  CommonPublication,
  InterLabNetworkResponse,
  LARGE_COLLAB_MAX_AUTHORS,
  NetworkLab,
  OTHER_LABS_CATEGORY,
  fetchCommonPublications,
  fetchInterLabNetwork,
  rankLabSuggestions,
} from './interLabNetwork';
import { hasCapability } from '../../lib/auth';
import { doiUrl } from '../../lib/doi';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

// URL parameters of the inter-lab mode (shareable link, docs/plan-reseau-inter-labos.md lot 3).
const URL_KEYS = ['labs', 'others', 'cross', 'large'] as const;
const readUrlState = () => {
  const p = new URLSearchParams(window.location.search);
  return {
    labs: (p.get('labs') ?? '').split(',').filter((s) => /^[a-z0-9_-]+$/.test(s)),
    aggregateOthers: p.get('others') === '1',
    crossOnly: p.get('cross') === '1',
    excludeLarge: p.get('large') !== '1',
  };
};
const writeUrlState = (s: { labs: string[]; aggregateOthers: boolean; crossOnly: boolean; excludeLarge: boolean } | null) => {
  const p = new URLSearchParams(window.location.search);
  for (const k of URL_KEYS) p.delete(k);
  if (s) {
    if (s.labs.length) p.set('labs', s.labs.join(','));
    if (s.aggregateOthers) p.set('others', '1');
    if (s.crossOnly) p.set('cross', '1');
    if (!s.excludeLarge) p.set('large', '1');
  }
  window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
};

/**
 * « Réseau » tab — co-authorships of the lab, with an adjustable publication threshold.
 * Inter-lab mode (HAS_NETWORK_API): other labs of the university can be added, from the
 * university-wide network computed by the server (/api/network, plan-reseau-inter-labos.md).
 */
export const NetworkTab: React.FC<{ dataset: DashboardDataset; range: YearRange; slug: string | null }> = ({
  dataset,
  range,
  slug,
}) => {
  const { t } = useLingui();
  const { publications, authors } = dataset;
  // Large corpora: higher initial threshold to keep the graph readable.
  const defaultMin = publications.length > 10000 ? 8 : 2;
  const [minPubs, setMinPubs] = useState(defaultMin);

  const initial = useMemo(readUrlState, []);
  const [labs, setLabs] = useState<string[]>(initial.labs);
  const [aggregateOthers, setAggregateOthers] = useState(initial.aggregateOthers);
  const [crossOnly, setCrossOnly] = useState(initial.crossOnly);
  const [excludeLarge, setExcludeLarge] = useState(initial.excludeLarge);

  // Labs of the university network (null = loading, 'none' = unavailable for this structure).
  const canInterLab = hasCapability('HAS_NETWORK_API') && !!slug;
  const [meta, setMeta] = useState<InterLabNetworkResponse | 'none' | null>(canInterLab ? null : 'none');
  useEffect(() => {
    if (!canInterLab || !slug) return;
    const ctrl = new AbortController();
    setMeta(null);
    fetchInterLabNetwork(slug, null, ctrl.signal)
      .then((m) => setMeta(m ?? 'none'))
      .catch((e) => { if (!ctrl.signal.aborted) { console.warn('[Network] meta:', e); setMeta('none'); } });
    return () => ctrl.abort();
  }, [canInterLab, slug]);
  const available = meta !== null && meta !== 'none' ? meta : null;
  const interMode = !!available && (labs.length > 0 || aggregateOthers);

  // Shareable link; the parameters are removed when leaving the tab.
  useEffect(() => {
    if (available) writeUrlState({ labs, aggregateOthers, crossOnly, excludeLarge });
  }, [available, labs, aggregateOthers, crossOnly, excludeLarge]);
  useEffect(() => () => writeUrlState(null), []);

  const local = useMemo(
    () => (interMode ? null : aggregateNetwork(publications, authors, range, minPubs)),
    [interMode, publications, authors, range, minPubs],
  );

  const [graph, setGraph] = useState<InterLabNetworkResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!interMode || !slug) { setGraph(null); return; }
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    fetchInterLabNetwork(slug, { labs, range, minPubs, crossOnly, aggregateOthers, excludeLarge }, ctrl.signal)
      .then((g) => { setGraph(g); setLoading(false); })
      .catch(() => { if (!ctrl.signal.aborted) { setError(true); setLoading(false); } });
    return () => ctrl.abort();
  }, [interMode, slug, labs, range, minPubs, crossOnly, aggregateOthers, excludeLarge]);

  // Publications behind a clicked link (lot 4).
  const [selectedLink, setSelectedLink] = useState<{ a: string; b: string } | null>(null);
  useEffect(() => { setSelectedLink(null); }, [labs, range, aggregateOthers, crossOnly, excludeLarge]);
  const nodeNames = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n.name])), [graph]);
  const interLab: InterLabRendering = useMemo(() => ({
    categoryLabel: (name) => (name === OTHER_LABS_CATEGORY ? t`Other labs (grouped)` : name),
    onLinkClick: (a, b) => setSelectedLink({ a, b }),
  }), [t]);

  const slider = (
    <div className="flex items-center gap-3 mr-2">
      {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-light" aria-label={t`Loading`} />}
      <label className="flex items-center gap-2 text-xs text-muted dark:text-[#c3beb0]">
        <span className="whitespace-nowrap"><Trans>Min. publications: {minPubs}</Trans></span>
        <input
          type="range"
          min={1}
          max={Math.max(10, defaultMin)}
          step={1}
          value={minPubs}
          onChange={(e) => setMinPubs(Number(e.target.value))}
          className="accent-[#7048e8] w-28"
        />
      </label>
    </div>
  );

  const toolbar = available ? (
    <InterLabToolbar
      meta={available}
      publications={publications}
      range={range}
      labs={labs}
      onLabsChange={setLabs}
      aggregateOthers={aggregateOthers}
      onAggregateOthersChange={setAggregateOthers}
      crossOnly={crossOnly}
      onCrossOnlyChange={setCrossOnly}
      excludeLarge={excludeLarge}
      onExcludeLargeChange={setExcludeLarge}
      graph={interMode ? graph : null}
    />
  ) : undefined;

  const data = interMode ? graph ?? { nodes: [], links: [], categories: [] } : local!;
  let emptyMessage: string | undefined;
  if (interMode && error) emptyMessage = t`The university network could not be loaded.`;
  else if (interMode && !graph) emptyMessage = t`Loading the university network…`;
  else if (data.nodes.length === 0) {
    emptyMessage = interMode && crossOnly
      ? t`No co-publication between these labs over the period.`
      : t`No author above the threshold over the period.`;
  }

  return (
    <div className="flex flex-col gap-4">
      <NetworkChart
        data={data}
        headerExtra={slider}
        toolbar={toolbar}
        interLab={interMode ? interLab : undefined}
        emptyMessage={emptyMessage}
      />
      {interMode && slug && selectedLink && (
        <CommonPublicationsPanel
          slug={slug}
          link={selectedLink}
          names={nodeNames}
          range={range}
          excludeLarge={excludeLarge}
          onClose={() => setSelectedLink(null)}
        />
      )}
    </div>
  );
};

const chipClass =
  'pill inline-flex items-center gap-1 px-2.5 py-1 text-xs cursor-pointer transition-colors';

/** Lab picker + options of the inter-lab mode, shown above the graph. */
const InterLabToolbar: React.FC<{
  meta: InterLabNetworkResponse;
  publications: DashboardDataset['publications'];
  range: YearRange;
  labs: string[];
  onLabsChange: (labs: string[]) => void;
  aggregateOthers: boolean;
  onAggregateOthersChange: (v: boolean) => void;
  crossOnly: boolean;
  onCrossOnlyChange: (v: boolean) => void;
  excludeLarge: boolean;
  onExcludeLargeChange: (v: boolean) => void;
  graph: InterLabNetworkResponse | null;
}> = ({
  meta, publications, range, labs, onLabsChange, aggregateOthers, onAggregateOthersChange,
  crossOnly, onCrossOnlyChange, excludeLarge, onExcludeLargeChange, graph,
}) => {
  const { t, i18n } = useLingui();
  const [query, setQuery] = useState('');
  const ranked = useMemo(
    () => rankLabSuggestions(meta.labs, meta.focus, publications, range),
    [meta, publications, range],
  );
  const bySlug = useMemo(() => new Map(meta.labs.map((l) => [l.slug, l])), [meta]);
  const selected = labs.map((s) => bySlug.get(s)).filter((l): l is NetworkLab => l != null);
  const suggestions = ranked.filter((r) => r.copubs > 0 && !labs.includes(r.lab.slug!)).slice(0, 6);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ranked.filter((r) => !labs.includes(r.lab.slug!) && r.lab.acronym.toLowerCase().includes(q)).slice(0, 8);
  }, [ranked, labs, query]);
  const add = (lab: NetworkLab) => { onLabsChange([...labs, lab.slug!]); setQuery(''); };

  const cov = meta.coverage;
  const coveragePct = cov.signatures ? Math.round((cov.resolvedSignatures / cov.signatures) * 100) : 0;
  const generated = new Date(meta.generatedAt).toLocaleDateString(i18n.locale);
  const truncated = graph?.truncated ?? 0;

  return (
    <div className="flex flex-col gap-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 font-semibold text-ink dark:text-[#f5f2ea] mr-1">
          <Network className="w-3.5 h-3.5" />
          {meta.focus ? <Trans>Open to other labs of the university</Trans> : <Trans>Labs to show</Trans>}
        </span>
        {selected.map((l) => (
          <button
            key={l.acronym}
            type="button"
            onClick={() => onLabsChange(labs.filter((s) => s !== l.slug))}
            title={t`Remove this lab`}
            className={`${chipClass} bg-accent/25 dark:bg-accent/20 text-ink dark:text-[#f5f2ea] hover:bg-accent/40`}
          >
            {l.acronym}
            <X className="w-3 h-3 opacity-60" />
          </button>
        ))}
        {suggestions.map(({ lab, copubs }) => (
          <button
            key={lab.acronym}
            type="button"
            onClick={() => add(lab)}
            title={t`Add this lab`}
            className={`${chipClass} bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-accent/20`}
          >
            + {lab.acronym}
            <span className="text-muted-light dark:text-[#8f897c]">
              <Plural value={copubs} one="# co-pub." other="# co-pubs" />
            </span>
          </button>
        ))}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-lighter" />
          <input
            className="input-soft !w-40 !pl-7 py-1 text-xs"
            placeholder={t`Other lab…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-56 glass-card-strong p-1 flex flex-col gap-0.5 max-h-64 overflow-y-auto">
              {matches.map(({ lab, copubs }) => (
                <button
                  key={lab.acronym}
                  type="button"
                  onClick={() => add(lab)}
                  className="text-left px-2.5 py-1.5 rounded-md text-ink dark:text-[#f5f2ea] hover:bg-accent/20 cursor-pointer flex justify-between gap-2"
                >
                  <span>{lab.acronym}</span>
                  <span className="text-muted-lighter"><Plural value={copubs} one="# co-pub." other="# co-pubs" /></span>
                </button>
              ))}
            </div>
          )}
        </div>
        {selected.length > 0 && (
          <button type="button" onClick={() => onLabsChange([])} className="text-muted-light dark:text-[#8f897c] hover:underline cursor-pointer">
            <Trans>Clear</Trans>
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted dark:text-[#c3beb0]">
        <label className="inline-flex items-center gap-1.5 cursor-pointer" title={t`Every lab not selected above becomes a single node`}>
          <input type="checkbox" checked={aggregateOthers} onChange={(e) => onAggregateOthersChange(e.target.checked)} className="accent-[#7048e8]" />
          <Trans>Show the other labs as grouped nodes</Trans>
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={crossOnly} onChange={(e) => onCrossOnlyChange(e.target.checked)} className="accent-[#7048e8]" />
          <Trans>Cross-lab links only</Trans>
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={excludeLarge} onChange={(e) => onExcludeLargeChange(e.target.checked)} className="accent-[#7048e8]" />
          <Trans>Exclude large collaborations (more than {LARGE_COLLAB_MAX_AUTHORS} authors)</Trans>
        </label>
      </div>
      {(labs.length > 0 || aggregateOthers) && (
        <p className="text-muted-light dark:text-[#8f897c] leading-relaxed">
          <Trans>
            Source: university-wide corpus ({meta.source}) of {generated}; {coveragePct}% of the internal signatures are
            linked to a lab, the others are not shown. Outlined authors belong to several labs.
          </Trans>
          {meta.restricted && (
            <> <Trans>Authors of other labs only appear when they co-published with your lab.</Trans></>
          )}
          {truncated > 0 && (
            <> <Plural value={truncated} one="# less active author hidden: raise the threshold or narrow the selection." other="# less active authors hidden: raise the threshold or narrow the selection." /></>
          )}
        </p>
      )}
    </div>
  );
};

/** List of the co-publications behind a clicked link of the graph. */
const CommonPublicationsPanel: React.FC<{
  slug: string;
  link: { a: string; b: string };
  names: Map<string, string>;
  range: YearRange;
  excludeLarge: boolean;
  onClose: () => void;
}> = ({ slug, link, names, range, excludeLarge, onClose }) => {
  const { t } = useLingui();
  const [state, setState] = useState<{ pubs: CommonPublication[]; total: number } | 'error' | null>(null);
  const load = useCallback((signal: AbortSignal) => {
    setState(null);
    fetchCommonPublications(slug, link.a, link.b, range, excludeLarge, signal)
      .then((r) => setState({ pubs: r.publications, total: r.total }))
      .catch(() => { if (!signal.aborted) setState('error'); });
  }, [slug, link, range, excludeLarge]);
  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);
  const from = names.get(link.a) ?? link.a;
  const to = names.get(link.b) ?? link.b;

  return (
    <div className="glass-card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
          <Trans>Co-publications {from} — {to}</Trans>
          {state && state !== 'error' && (
            <span className="ml-2 text-xs font-normal text-muted-light dark:text-[#8f897c]">
              <Plural value={state.total} one="# publication" other="# publications" />
            </span>
          )}
        </h3>
        <button type="button" onClick={onClose} title={t`Close`} className="p-1 rounded-md text-muted-light hover:text-ink dark:hover:text-[#f5f2ea] cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      {state === null && <p className="text-xs text-muted-light"><Trans>Loading…</Trans></p>}
      {state === 'error' && <p className="text-xs text-muted-light"><Trans>The publications could not be loaded.</Trans></p>}
      {state && state !== 'error' && (
        <ul className="flex flex-col gap-1.5 text-sm max-h-80 overflow-y-auto">
          {state.pubs.map((p, i) => {
            const url = p.doi ? doiUrl(p.doi) : null;
            return (
              <li key={`${p.doi ?? ''}-${i}`} className="flex gap-2">
                <span className="text-xs text-muted-light dark:text-[#8f897c] w-10 shrink-0 pt-0.5">{p.year}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-ink dark:text-[#f5f2ea] hover:underline">
                    {p.title ?? p.doi}
                  </a>
                ) : (
                  <span className="text-ink dark:text-[#f5f2ea]">{p.title ?? t`(untitled)`}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
