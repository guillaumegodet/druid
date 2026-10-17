// « Calls for proposals » tab of the dashboard (druid-internal docs/plan-funding-calls.md, lot 1; formerly the
// « European calls » of docs/plan-eu-calls.md): the calls of the funding programmes (Horizon Europe topics first)
// matched to the researchers of the structure by the engines of crisalid-agents (imported by scripts/import_calls.ts),
// in two views — by call, by researcher — with the opinion of the users on each pair, filtered by funder category,
// programme and subset (cluster, axis…). The server already limits the matches to the scope of the user; the structure
// shown narrows them to its own directory records.
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Search, ThumbsDown, ThumbsUp, Briefcase } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import type { Researcher } from '../../types';
import type { DashboardPublication } from './types';
import { normTitle } from '../../lib/normalize';
import { doiUrl } from '../../lib/doi';
import { apiErrorText } from '../../lib/apiErrors';
import {
  callsWithMatches, matchesByResearcher, uidsOf, subsetsOf, programmesOfCategory, inPerimeter,
  type Call, type CallMatch, type CallWithMatches, type FeedbackVerdict, type ProgrammeView,
} from '../../lib/calls/aggregate';
import type { MatchOverall } from '../../lib/calls/trm';
import type { FunderCategory } from '../../lib/calls/programmes';
import { MANUAL_SOURCE } from '../../lib/calls/manual';
import { FUNDER_CATEGORY_LABELS } from './fundersAggregates';
import { CallCandidates } from './CallCandidates';
import { canUseEstablishmentTools } from '../../lib/auth';

type View = 'calls' | 'researchers' | 'candidates';

const OPENALEX_SEARCH = 'https://openalex.org/works?filter=default.search:';

/** Link of a publication named by the batch (graph uid, title, year): its DOI when the dashboard knows the publication
 * by its title, else a search on OpenAlex. The batch does not carry the DOI. */
type PublicationLinks = Map<string, string>;
const publicationLinksOf = (pubs: DashboardPublication[] | undefined): PublicationLinks => {
  const map: PublicationLinks = new Map();
  for (const p of pubs ?? []) {
    const key = normTitle(p.title);
    const url = doiUrl(p.doi);
    if (key && url && !map.has(key)) map.set(key, url);
  }
  return map;
};
const linkOf = (links: PublicationLinks, title: string): string =>
  links.get(normTitle(title)) ?? `${OPENALEX_SEARCH}${encodeURIComponent(title)}`;

const today = () => new Date().toISOString().slice(0, 10);
/** The French rendering when the interface is French and the text was translated, else the English original. */
const localized = (en: string, fr?: string): string => (i18n.locale === 'fr' && fr ? fr : en);
const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`).toLocaleDateString(i18n.locale) : d);

const OVERALL_STYLE: Record<MatchOverall, string> = {
  strong: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  plausible: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  weak: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-[#c3beb0]',
  none: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-[#c3beb0]',
};

const SELECT_CLASS = 'px-3 py-1.5 rounded-full text-[13px] bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] max-w-[16rem]';

/** Strength assessed by the model (the badge), and beside it the relative score within the call as a thin bar: the
 * best candidate of a call always scores 1, whatever the model thinks of it, so the number alone misled. */
const OverallBadge: React.FC<{ overall: MatchOverall; score: number }> = ({ overall, score }) => {
  const { t } = useLingui();
  const label: Record<MatchOverall, string> = { strong: t`strong match`, plausible: t`plausible match`, weak: t`weak match`, none: t`unrated` };
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${OVERALL_STYLE[overall]}`} title={t`Strength of the match as assessed by the language model from the publications`}>
        {label[overall]}
      </span>
      <span className="inline-block w-12 h-1.5 rounded-full bg-ink/10 dark:bg-white/10 overflow-hidden" title={t`Relative score within the call: the best candidate of the call is at 100 %, the others in proportion`} aria-label={t`Relative score ${Math.round(score * 100)} %`}>
        <span className="block h-full bg-ink/50 dark:bg-[#f5f2ea]/60" style={{ width: `${Math.round(score * 100)}%` }} />
      </span>
    </span>
  );
};

const FeedbackButtons: React.FC<{ match: CallMatch; onFeedback: (pairId: string, verdict: FeedbackVerdict) => void; busy: boolean }> = ({ match, onFeedback, busy }) => {
  const { t } = useLingui();
  const options: { verdict: FeedbackVerdict; label: string; icon: React.ReactNode }[] = [
    { verdict: 'relevant', label: t`Relevant`, icon: <ThumbsUp className="w-3.5 h-3.5" /> },
    { verdict: 'not_relevant', label: t`Not relevant`, icon: <ThumbsDown className="w-3.5 h-3.5" /> },
    { verdict: 'already_applying', label: t`Already applying`, icon: <Briefcase className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const count = match.feedback[o.verdict] ?? 0;
        const mine = match.mine === o.verdict;
        return (
          <button
            key={o.verdict}
            type="button"
            disabled={busy}
            onClick={() => onFeedback(match.pairId, o.verdict)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors ${
              mine
                ? 'bg-ink text-white border-ink dark:bg-[#f5f2ea] dark:text-[#1c1a14] dark:border-[#f5f2ea]'
                : 'bg-white/70 dark:bg-white/10 border-white/80 dark:border-white/15 text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]'
            }`}
            title={t`Your opinion on this match (one per person, the last one wins)`}
          >
            {mine ? <Check className="w-3.5 h-3.5" /> : o.icon}
            {o.label}
            {count > 0 && <span className="tabular-nums opacity-70">{count}</span>}
          </button>
        );
      })}
    </div>
  );
};

const MatchCard: React.FC<{
  match: CallMatch; researcher?: Researcher | null; onOpenResearcher?: (r: Researcher) => void;
  onFeedback: (pairId: string, verdict: FeedbackVerdict) => void; busy: boolean; showName?: boolean; links: PublicationLinks;
}> = ({ match, researcher, onOpenResearcher, onFeedback, busy, showName = true, links }) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const relevant = match.publications.filter((p) => p.relevant);
  const shown = open ? relevant : relevant.slice(0, 3);
  return (
    <div className="rounded-2xl bg-white/60 dark:bg-white/5 border border-white/80 dark:border-white/10 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {showName && (researcher && onOpenResearcher ? (
            <button type="button" onClick={() => onOpenResearcher(researcher)} className="font-semibold text-[14px] text-ink dark:text-[#f5f2ea] hover:underline truncate">
              {researcher.displayName || match.personName}
            </button>
          ) : (
            <span className="font-semibold text-[14px] text-ink dark:text-[#f5f2ea] truncate">{match.personName}</span>
          ))}
          <OverallBadge overall={match.overall} score={match.score} />
        </div>
        <FeedbackButtons match={match} onFeedback={onFeedback} busy={busy} />
      </div>
      {match.justification && <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed">{localized(match.justification, match.justificationFr)}</p>}
      {relevant.length > 0 && (
        <ul className="text-[12.5px] space-y-1">
          {shown.map((p) => (
            <li key={p.uid} className="flex gap-2">
              <span className="shrink-0 text-muted-lighter dark:text-[#8f897c] tabular-nums">{p.year ?? '—'}</span>
              <a
                href={linkOf(links, p.title)}
                target="_blank"
                rel="noreferrer"
                className="text-ink dark:text-[#f5f2ea] hover:underline inline-flex items-start gap-1"
                title={links.has(normTitle(p.title)) ? t`Open the publication (DOI)` : t`Search this title on OpenAlex (DOI unknown)`}
              >
                <span>{p.title}</span>
                <ExternalLink className="w-3 h-3 mt-1 shrink-0 opacity-60" />
              </a>
            </li>
          ))}
          {relevant.length > 3 && (
            <li>
              <button type="button" onClick={() => setOpen(!open)} className="text-[12px] font-semibold text-muted hover:text-ink dark:text-[#c3beb0] dark:hover:text-[#f5f2ea]">
                {open ? <Trans>Fewer publications</Trans> : <Plural value={relevant.length - 3} one="# more publication" other="# more publications" />}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

/** Second line of a call: identifier, programme (when several are shown) and the classification of the source. */
const CallMeta: React.FC<{ call: Call; programme?: ProgrammeView; showProgramme: boolean }> = ({ call, programme, showProgramme }) => (
  <span className="block text-[12px] text-muted dark:text-[#c3beb0] mt-0.5">
    {call.callId}
    {showProgramme && programme && <> · {programme.name}</>}
    {call.scheme && <> · {call.scheme}</>}
    {call.taxonomy.destination && <> · {call.taxonomy.destination}</>}
  </span>
);

const CallRow: React.FC<{
  call: CallWithMatches; programme?: ProgrammeView; showProgramme: boolean; byUid: Map<string, Researcher>; onOpenResearcher?: (r: Researcher) => void;
  onFeedback: (pairId: string, verdict: FeedbackVerdict) => void; busy: boolean; links: PublicationLinks;
}> = ({ call, programme, showProgramme, byUid, onOpenResearcher, onFeedback, busy, links }) => {
  const [open, setOpen] = useState(false);
  const { t } = useLingui();
  const strong = call.matches.filter((m) => m.overall === 'strong').length;
  return (
    <div className="rounded-2xl bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted dark:text-[#c3beb0]">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-ink dark:text-[#f5f2ea]">{localized(call.title, call.titleFr)}</span>
          <CallMeta call={call} programme={programme} showProgramme={showProgramme} />
        </span>
        <span className="shrink-0 flex flex-col items-end gap-1 text-[12px]">
          <span className={`font-semibold tabular-nums ${call.nextDeadline ? 'text-ink dark:text-[#f5f2ea]' : 'text-muted-lighter dark:text-[#8f897c]'}`}>
            {call.nextDeadline ? t`Deadline ${fmtDate(call.nextDeadline)}` : call.deadlines.length ? t`Closed` : t`No deadline`}
          </span>
          <span className="text-muted dark:text-[#c3beb0] tabular-nums">
            <Plural value={call.matches.length} _0="No researcher" one="# researcher" other="# researchers" />
            {strong > 0 && <> · <Plural value={strong} one="# strong" other="# strong" /></>}
          </span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {call.summary && <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed">{localized(call.summary, call.summaryFr)}</p>}
          <div className="flex flex-wrap gap-3 text-[12px] text-muted dark:text-[#c3beb0]">
            {call.taxonomy.call && <span><Trans>Call</Trans> {call.taxonomy.call}</span>}
            {call.openingDate && <span><Trans>Opening</Trans> {fmtDate(call.openingDate)}</span>}
            {call.deadlines.length > 0 && <span><Trans>Deadlines</Trans> {call.deadlines.map(fmtDate).join(', ')}</span>}
            {call.url && (
              <a href={call.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink dark:text-[#f5f2ea] hover:underline">
                <ExternalLink className="w-3.5 h-3.5" /> {programme?.funderId === 'eu' ? <Trans>Funding & Tenders portal</Trans> : <Trans>Page of the call</Trans>}
              </a>
            )}
          </div>
          {call.matches.length === 0 ? (
            <p className="text-[13px] text-muted-lighter dark:text-[#8f897c]"><Trans>No researcher of this structure was retained for this call.</Trans></p>
          ) : (
            <div className="space-y-2">
              {call.matches.map((m) => (
                <MatchCard key={m.pairId} match={m} researcher={byUid.get(m.uid)} onOpenResearcher={onOpenResearcher} onFeedback={onFeedback} busy={busy} links={links} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ViewSwitch: React.FC<{ view: View; onChange: (v: View) => void; withCandidates: boolean }> = ({ view, onChange, withCandidates }) => {
  const { t } = useLingui();
  const views: [View, string][] = [['calls', t`Calls`], ['researchers', t`Researchers`]];
  // Candidates by career stage (lot 5): institution right only (D5).
  if (withCandidates) views.push(['candidates', t`Candidates`]);
  return (
    <div className="flex items-center gap-1 p-1 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft w-fit">
      {views.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${
            view === k ? 'bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14]' : 'text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

/**
 * Kind of subset of the selected programmes (their `subsetLabel`: cluster, scheme, mission, destination, axis, panel, domain),
 * '' when they differ: names the subset filter.
 */
const subsetKindOf = (programmes: ProgrammeView[], selected: Set<string>): string => {
  const kinds = new Set(programmes.filter((p) => selected.size === 0 || selected.has(p.programmeId)).map((p) => p.subsetLabel).filter(Boolean));
  return kinds.size === 1 ? [...kinds][0] : '';
};

export const CallsTab: React.FC<{
  /** Directory records of the structure shown; null = no directory for this structure (every match of the scope). */
  researchers: Researcher[] | null;
  structureLabel: string;
  /** druid-biblio slug of the structure shown (acronym), matched against the perimeter of the engines. */
  slug: string;
  /** Structures enclosing the one shown (its lab, pole, the institution of the instance), nearest first: a structure
   * is inside the perimeter of a run on one of them. */
  enclosing?: readonly { slug: string; label: string }[];
  /** Publications of the dashboard: give the publications named by the batch their DOI link (title match). */
  publications?: DashboardPublication[];
  onOpenResearcher?: (r: Researcher) => void;
}> = ({ researchers, structureLabel, slug, enclosing, publications, onOpenResearcher }) => {
  const { t } = useLingui();
  const [view, setView] = useState<View>('calls');
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [programmes, setProgrammes] = useState<ProgrammeView[]>([]);
  const [perimeters, setPerimeters] = useState<string[]>([]);
  const [matches, setMatches] = useState<CallMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<FunderCategory | ''>('');
  const [programmeId, setProgrammeId] = useState<string>('');
  const [subset, setSubset] = useState<string>('');
  const [query, setQuery] = useState('');
  const [includePast, setIncludePast] = useState(false);
  const [onlyMatched, setOnlyMatched] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const get = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    Promise.all([get('/api/calls/calls'), get('/api/calls/programmes'), get('/api/calls/matches')])
      .then(([cl, pr, mt]) => {
        if (cancelled) return;
        setCalls(cl.items ?? []);
        setPerimeters(Array.isArray(cl.perimeters) ? cl.perimeters : []);
        setProgrammes(pr.items ?? []);
        setMatches(mt.items ?? []);
      })
      .catch((e) => { if (!cancelled) setError(apiErrorText(e)); });
    return () => { cancelled = true; };
  }, []);

  const uids = useMemo(() => (researchers ? uidsOf(researchers) : null), [researchers]);
  const links = useMemo(() => publicationLinksOf(publications), [publications]);
  const byUid = useMemo(() => new Map((researchers ?? []).filter((r) => r.uid).map((r) => [r.uid!, r])), [researchers]);
  const programmeOf = useMemo(() => new Map(programmes.map((p) => [p.programmeId, p])), [programmes]);
  // Only the programmes that have calls are offered; the categories, those of these programmes.
  const programmesWithCalls = useMemo(() => {
    const ids = new Set((calls ?? []).map((c) => c.programmeId));
    return programmes.filter((p) => ids.has(p.programmeId));
  }, [programmes, calls]);
  const categories = useMemo(() => [...new Set(programmesWithCalls.map((p) => p.category))], [programmesWithCalls]);
  const programmeOptions = useMemo(() => programmesOfCategory(programmesWithCalls, category), [programmesWithCalls, category]);
  // Programmes kept by the filters: the one selected, else every programme of the category, else all.
  const programmeIds = useMemo(() => new Set(programmeId ? [programmeId] : programmeOptions.map((p) => p.programmeId)), [programmeId, programmeOptions]);
  const subsets = useMemo(() => subsetsOf(calls ?? [], programmeIds), [calls, programmeIds]);
  // Labels written here so that the macro extracts them (a `t` passed as an argument is not the macro); the context
  // keeps them apart from the clusters and groups of the directory.
  const subsetLabels = ({
    cluster: { all: t({ message: 'All clusters', context: 'funding calls' }), one: t({ message: 'Cluster', context: 'funding calls' }) },
    scheme: { all: t({ message: 'All schemes', context: 'funding calls' }), one: t({ message: 'Scheme', context: 'funding calls' }) },
    mission: { all: t({ message: 'All missions', context: 'funding calls' }), one: t({ message: 'Mission', context: 'funding calls' }) },
    destination: { all: t({ message: 'All destinations', context: 'funding calls' }), one: t({ message: 'Destination', context: 'funding calls' }) },
    axis: { all: t({ message: 'All axes', context: 'funding calls' }), one: t({ message: 'Axis', context: 'funding calls' }) },
    panel: { all: t({ message: 'All panels', context: 'funding calls' }), one: t({ message: 'Panel', context: 'funding calls' }) },
    domain: { all: t({ message: 'All domains', context: 'funding calls' }), one: t({ message: 'Domain', context: 'funding calls' }) },
  } as Record<string, { all: string; one: string }>)[subsetKindOf(programmes, programmeIds)]
    ?? { all: t({ message: 'All subsets', context: 'funding calls' }), one: t({ message: 'Subset', context: 'funding calls' }) };
  const showProgramme = programmesWithCalls.length > 1 && !programmeId;

  const filters = useMemo(() => ({ uids, today: today(), includePast, programmeIds, subset }), [uids, includePast, programmeIds, subset]);

  const callRows = useMemo(() => {
    if (!calls) return [];
    const q = query.trim().toLowerCase();
    return callsWithMatches(calls, matches, filters)
      // A call added by hand is shown before any matching ran on its programme: it was added for this institution.
      .filter((c) => !onlyMatched || c.matches.length > 0 || programmeOf.get(c.programmeId)?.source === MANUAL_SOURCE)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || (c.titleFr ?? '').toLowerCase().includes(q) || c.callId.toLowerCase().includes(q)
        || Object.values(c.taxonomy).some((v) => v.toLowerCase().includes(q)));
  }, [calls, matches, filters, onlyMatched, query, programmeOf]);

  const researcherRows = useMemo(() => {
    if (!calls) return [];
    const q = query.trim().toLowerCase();
    return matchesByResearcher(calls, matches, filters)
      .filter((r) => !q || (byUid.get(r.uid)?.displayName || r.personName).toLowerCase().includes(q));
  }, [calls, matches, filters, query, byUid]);

  const matchedUids = useMemo(() => new Set(matches.filter((m) => !uids || uids.has(m.uid)).map((m) => m.uid)), [matches, uids]);
  // Outside the perimeter of the engines: the matches shown say nothing about the coverage of this structure.
  const outsidePerimeter = !!researchers && !inPerimeter(perimeters, { slug, label: structureLabel }, enclosing);

  const onFeedback = async (pairId: string, verdict: FeedbackVerdict) => {
    setBusy(true);
    try {
      const res = await fetch('/api/calls/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairId, verdict }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMatches((prev) => prev.map((m) => {
        if (m.pairId !== pairId) return m;
        const feedback = { ...m.feedback };
        if (m.mine) feedback[m.mine] = Math.max(0, (feedback[m.mine] ?? 1) - 1);
        feedback[verdict] = (feedback[verdict] ?? 0) + 1;
        return { ...m, feedback, mine: verdict };
      }));
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-[13px]">
        <AlertCircle className="w-4 h-4" /> {error}
      </div>
    );
  }
  if (!calls) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-white/80 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
          <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading the calls for proposals…</Trans>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed">
        <Trans>
          Calls of the funding programmes matched automatically to the researchers of {structureLabel} from the publications known to
          the CRISalid graph (partial coverage). Your opinion on each match helps improve the matching.
        </Trans>
        {' '}
        <span className="tabular-nums">
          <Plural value={matchedUids.size} _0="No researcher retained yet." one="# researcher retained on at least one call." other="# researchers retained on at least one call." />
        </span>
      </p>
      {perimeters.length > 0 && (
        <p className={`text-[13px] rounded-2xl px-4 py-2 ${outsidePerimeter ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100' : 'bg-white/60 dark:bg-white/5 text-muted dark:text-[#c3beb0]'}`}>
          <Trans>Matching computed on the publications of: {perimeters.join(', ')}.</Trans>
          {outsidePerimeter && (
            <> <Trans>{structureLabel} is outside this perimeter: only its researchers who co-signed publications of that perimeter can appear here, which says nothing about its own coverage.</Trans></>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ViewSwitch view={view} onChange={setView} withCandidates={canUseEstablishmentTools()} />
        {view !== 'candidates' && (<>
        <label className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-lighter dark:text-[#8f897c]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={view === 'calls' ? t`Search a call…` : t`Search a researcher…`}
            className="pl-9 pr-3 py-1.5 rounded-full text-[13px] bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] w-56"
          />
        </label>
        {categories.length > 1 && (
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value as FunderCategory | ''); setProgrammeId(''); setSubset(''); }}
            className={SELECT_CLASS}
            aria-label={t`Funder`}
          >
            <option value="">{t`All funders`}</option>
            {categories.map((c) => <option key={c} value={c}>{FUNDER_CATEGORY_LABELS[c] ? i18n._(FUNDER_CATEGORY_LABELS[c]) : c}</option>)}
          </select>
        )}
        {programmeOptions.length > 1 && (
          <select
            value={programmeId}
            onChange={(e) => { setProgrammeId(e.target.value); setSubset(''); }}
            className={SELECT_CLASS}
            aria-label={t`Programme`}
          >
            <option value="">{t`All programmes`}</option>
            {programmeOptions.map((p) => <option key={p.programmeId} value={p.programmeId}>{p.name}</option>)}
          </select>
        )}
        {subsets.length > 1 && (
          <select
            value={subset}
            onChange={(e) => setSubset(e.target.value)}
            className={SELECT_CLASS}
            aria-label={subsetLabels.one}
          >
            <option value="">{subsetLabels.all}</option>
            {subsets.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <label className="inline-flex items-center gap-1.5 text-[13px] text-muted dark:text-[#c3beb0]">
          <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} /> <Trans>Include closed calls</Trans>
        </label>
        {view === 'calls' && (
          <label className="inline-flex items-center gap-1.5 text-[13px] text-muted dark:text-[#c3beb0]">
            <input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} /> <Trans>Calls with researchers only</Trans>
          </label>
        )}
        </>)}
      </div>

      {view === 'candidates' ? (
        <CallCandidates researchers={researchers} onOpenResearcher={onOpenResearcher} />
      ) : view === 'calls' ? (
        callRows.length === 0 ? (
          <p className="text-[13px] text-muted-lighter dark:text-[#8f897c]"><Trans>No call matches these filters.</Trans></p>
        ) : (
          <div className="space-y-2">
            {callRows.map((c) => (
              <CallRow key={c.callId} call={c} programme={programmeOf.get(c.programmeId)} showProgramme={showProgramme} byUid={byUid} onOpenResearcher={onOpenResearcher} onFeedback={onFeedback} busy={busy} links={links} />
            ))}
          </div>
        )
      ) : researcherRows.length === 0 ? (
        <p className="text-[13px] text-muted-lighter dark:text-[#8f897c]"><Trans>No researcher matches these filters.</Trans></p>
      ) : (
        <div className="space-y-3">
          {researcherRows.map((r) => {
            const record = byUid.get(r.uid);
            return (
              <div key={r.uid} className="rounded-2xl bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {record && onOpenResearcher ? (
                    <button type="button" onClick={() => onOpenResearcher(record)} className="font-semibold text-[15px] text-ink dark:text-[#f5f2ea] hover:underline">{record.displayName}</button>
                  ) : (
                    <span className="font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">{r.personName}</span>
                  )}
                  <span className="text-[12px] text-muted dark:text-[#c3beb0] tabular-nums"><Plural value={r.matches.length} one="# call" other="# calls" /></span>
                </div>
                <div className="space-y-2">
                  {r.matches.map((m) => (
                    <div key={m.pairId} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-semibold text-ink dark:text-[#f5f2ea]">{localized(m.call.title, m.call.titleFr)}</span>
                        <span className="text-muted dark:text-[#c3beb0]">{m.call.callId}</span>
                        {showProgramme && programmeOf.get(m.call.programmeId) && <span className="text-muted dark:text-[#c3beb0]">{programmeOf.get(m.call.programmeId)!.name}</span>}
                        {m.call.deadlines.length > 0 && <span className="text-muted dark:text-[#c3beb0] tabular-nums">{m.call.deadlines.map(fmtDate).join(', ')}</span>}
                      </div>
                      <MatchCard match={m} researcher={record} onFeedback={onFeedback} busy={busy} showName={false} links={links} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
