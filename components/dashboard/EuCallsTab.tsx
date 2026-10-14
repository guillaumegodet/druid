// « European calls » tab of the dashboard (druid-internal docs/plan-eu-calls.md, lot 3): the Horizon Europe
// work programme topics matched to the researchers of the structure by the Topic-to-Researcher Match batch of
// crisalid-agents (imported by scripts/import_trm.ts), in two views — by topic, by researcher — with the opinion of the
// users on each pair. The server already limits the matches to the scope of the user; the structure shown narrows them
// to its own directory records.
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Search, ThumbsDown, ThumbsUp, Briefcase } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import type { Researcher } from '../../types';
import { apiErrorText } from '../../lib/apiErrors';
import {
  matchesByResearcher, topicsWithMatches, uidsOf,
  type EuMatch, type EuTopic, type FeedbackVerdict, type TopicWithMatches,
} from '../../lib/euCalls/aggregate';
import type { MatchOverall } from '../../lib/euCalls/trm';

type View = 'topics' | 'researchers';

const PORTAL = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`).toLocaleDateString(i18n.locale) : d);

const OVERALL_STYLE: Record<MatchOverall, string> = {
  strong: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  plausible: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  weak: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-[#c3beb0]',
  none: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-[#c3beb0]',
};

/** Strength assessed by the model (the badge), and beside it the relative score within the topic as a thin bar: the
 * best candidate of a topic always scores 1, whatever the model thinks of it, so the number alone misled. */
const OverallBadge: React.FC<{ overall: MatchOverall; score: number }> = ({ overall, score }) => {
  const { t } = useLingui();
  const label: Record<MatchOverall, string> = { strong: t`strong match`, plausible: t`plausible match`, weak: t`weak match`, none: t`unrated` };
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${OVERALL_STYLE[overall]}`} title={t`Strength of the match as assessed by the language model from the publications`}>
        {label[overall]}
      </span>
      <span className="inline-block w-12 h-1.5 rounded-full bg-ink/10 dark:bg-white/10 overflow-hidden" title={t`Relative score within the topic: the best candidate of the topic is at 100 %, the others in proportion`} aria-label={t`Relative score ${Math.round(score * 100)} %`}>
        <span className="block h-full bg-ink/50 dark:bg-[#f5f2ea]/60" style={{ width: `${Math.round(score * 100)}%` }} />
      </span>
    </span>
  );
};

const FeedbackButtons: React.FC<{ match: EuMatch; onFeedback: (pairId: string, verdict: FeedbackVerdict) => void; busy: boolean }> = ({ match, onFeedback, busy }) => {
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
  match: EuMatch; researcher?: Researcher | null; onOpenResearcher?: (r: Researcher) => void;
  onFeedback: (pairId: string, verdict: FeedbackVerdict) => void; busy: boolean; showName?: boolean;
}> = ({ match, researcher, onOpenResearcher, onFeedback, busy, showName = true }) => {
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
      {match.justification && <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed">{match.justification}</p>}
      {relevant.length > 0 && (
        <ul className="text-[12.5px] space-y-1">
          {shown.map((p) => (
            <li key={p.uid} className="flex gap-2">
              <span className="shrink-0 text-muted-lighter dark:text-[#8f897c] tabular-nums">{p.year ?? '—'}</span>
              <span className="text-ink dark:text-[#f5f2ea]">{p.title}</span>
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

const TopicRow: React.FC<{
  topic: TopicWithMatches; byUid: Map<string, Researcher>; onOpenResearcher?: (r: Researcher) => void;
  onFeedback: (pairId: string, verdict: FeedbackVerdict) => void; busy: boolean;
}> = ({ topic, byUid, onOpenResearcher, onFeedback, busy }) => {
  const [open, setOpen] = useState(false);
  const { t } = useLingui();
  const strong = topic.matches.filter((m) => m.overall === 'strong').length;
  return (
    <div className="rounded-2xl bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted dark:text-[#c3beb0]">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-ink dark:text-[#f5f2ea]">{topic.title}</span>
          <span className="block text-[12px] text-muted dark:text-[#c3beb0] mt-0.5">
            {topic.topicId}
            {topic.destination && <> · {topic.destination}</>}
          </span>
        </span>
        <span className="shrink-0 flex flex-col items-end gap-1 text-[12px]">
          <span className={`font-semibold tabular-nums ${topic.nextDeadline ? 'text-ink dark:text-[#f5f2ea]' : 'text-muted-lighter dark:text-[#8f897c]'}`}>
            {topic.nextDeadline ? t`Deadline ${fmtDate(topic.nextDeadline)}` : topic.deadlines.length ? t`Closed` : t`No deadline`}
          </span>
          <span className="text-muted dark:text-[#c3beb0] tabular-nums">
            <Plural value={topic.matches.length} _0="No researcher" one="# researcher" other="# researchers" />
            {strong > 0 && <> · <Plural value={strong} one="# strong" other="# strong" /></>}
          </span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {topic.summary && <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed">{topic.summary}</p>}
          <div className="flex flex-wrap gap-3 text-[12px] text-muted dark:text-[#c3beb0]">
            {topic.callId && <span><Trans>Call</Trans> {topic.callId}</span>}
            {topic.deadlines.length > 0 && <span><Trans>Deadlines</Trans> {topic.deadlines.map(fmtDate).join(', ')}</span>}
            <a href={`${PORTAL}${topic.topicId.toLowerCase()}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink dark:text-[#f5f2ea] hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> <Trans>Funding & Tenders portal</Trans>
            </a>
          </div>
          {topic.matches.length === 0 ? (
            <p className="text-[13px] text-muted-lighter dark:text-[#8f897c]"><Trans>No researcher of this structure was retained for this topic.</Trans></p>
          ) : (
            <div className="space-y-2">
              {topic.matches.map((m) => (
                <MatchCard key={m.pairId} match={m} researcher={byUid.get(m.uid)} onOpenResearcher={onOpenResearcher} onFeedback={onFeedback} busy={busy} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ViewSwitch: React.FC<{ view: View; onChange: (v: View) => void }> = ({ view, onChange }) => {
  const { t } = useLingui();
  return (
    <div className="flex items-center gap-1 p-1 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft w-fit">
      {([['topics', t`Topics`], ['researchers', t`Researchers`]] as const).map(([k, label]) => (
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

export const EuCallsTab: React.FC<{
  /** Directory records of the structure shown; null = no directory for this structure (every match of the scope). */
  researchers: Researcher[] | null;
  structureLabel: string;
  onOpenResearcher?: (r: Researcher) => void;
}> = ({ researchers, structureLabel, onOpenResearcher }) => {
  const { t } = useLingui();
  const [view, setView] = useState<View>('topics');
  const [topics, setTopics] = useState<EuTopic[] | null>(null);
  const [matches, setMatches] = useState<EuMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cluster, setCluster] = useState<string>('');
  const [query, setQuery] = useState('');
  const [includePast, setIncludePast] = useState(false);
  const [onlyMatched, setOnlyMatched] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/eu-calls/topics', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch('/api/eu-calls/matches', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    ])
      .then(([tp, mt]) => { if (!cancelled) { setTopics(tp.items ?? []); setMatches(mt.items ?? []); } })
      .catch((e) => { if (!cancelled) setError(apiErrorText(e)); });
    return () => { cancelled = true; };
  }, []);

  const uids = useMemo(() => (researchers ? uidsOf(researchers) : null), [researchers]);
  const byUid = useMemo(() => new Map((researchers ?? []).filter((r) => r.uid).map((r) => [r.uid!, r])), [researchers]);
  const clusters = useMemo(() => [...new Set((topics ?? []).map((tp) => tp.cluster))].sort(), [topics]);

  const topicRows = useMemo(() => {
    if (!topics) return [];
    const q = query.trim().toLowerCase();
    return topicsWithMatches(topics, matches, { uids, today: today(), includePast })
      .filter((tp) => !cluster || tp.cluster === cluster)
      .filter((tp) => !onlyMatched || tp.matches.length > 0)
      .filter((tp) => !q || tp.title.toLowerCase().includes(q) || tp.topicId.toLowerCase().includes(q) || tp.destination.toLowerCase().includes(q));
  }, [topics, matches, uids, includePast, cluster, onlyMatched, query]);

  const researcherRows = useMemo(() => {
    if (!topics) return [];
    const q = query.trim().toLowerCase();
    const todayStr = today();
    return matchesByResearcher(topics, matches, uids)
      .map((r) => ({
        ...r,
        matches: r.matches
          .filter((m) => !cluster || m.topic.cluster === cluster)
          .filter((m) => includePast || m.topic.deadlines.length === 0 || m.topic.deadlines.some((d) => d >= todayStr)),
      }))
      .filter((r) => r.matches.length > 0)
      .filter((r) => !q || (byUid.get(r.uid)?.displayName || r.personName).toLowerCase().includes(q));
  }, [topics, matches, uids, cluster, includePast, query, byUid]);

  const matchedUids = useMemo(() => new Set(matches.filter((m) => !uids || uids.has(m.uid)).map((m) => m.uid)), [matches, uids]);

  const onFeedback = async (pairId: string, verdict: FeedbackVerdict) => {
    setBusy(true);
    try {
      const res = await fetch('/api/eu-calls/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairId, verdict }) });
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
  if (!topics) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-white/80 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
          <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading the European calls…</Trans>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed">
        <Trans>
          Horizon Europe work programme topics matched automatically to the researchers of {structureLabel} from the publications known to
          the CRISalid graph (partial coverage). Your opinion on each match helps improve the matching.
        </Trans>
        {' '}
        <span className="tabular-nums">
          <Plural value={matchedUids.size} _0="No researcher retained yet." one="# researcher retained on at least one topic." other="# researchers retained on at least one topic." />
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <ViewSwitch view={view} onChange={setView} />
        <label className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-lighter dark:text-[#8f897c]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={view === 'topics' ? t`Search a topic…` : t`Search a researcher…`}
            className="pl-9 pr-3 py-1.5 rounded-full text-[13px] bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] w-56"
          />
        </label>
        <select
          value={cluster}
          onChange={(e) => setCluster(e.target.value)}
          className="px-3 py-1.5 rounded-full text-[13px] bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea]"
          aria-label={t`Cluster`}
        >
          <option value="">{t`All clusters`}</option>
          {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-[13px] text-muted dark:text-[#c3beb0]">
          <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} /> <Trans>Include closed calls</Trans>
        </label>
        {view === 'topics' && (
          <label className="inline-flex items-center gap-1.5 text-[13px] text-muted dark:text-[#c3beb0]">
            <input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} /> <Trans>Topics with researchers only</Trans>
          </label>
        )}
      </div>

      {view === 'topics' ? (
        topicRows.length === 0 ? (
          <p className="text-[13px] text-muted-lighter dark:text-[#8f897c]"><Trans>No topic matches these filters.</Trans></p>
        ) : (
          <div className="space-y-2">
            {topicRows.map((tp) => <TopicRow key={tp.topicId} topic={tp} byUid={byUid} onOpenResearcher={onOpenResearcher} onFeedback={onFeedback} busy={busy} />)}
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
                  <span className="text-[12px] text-muted dark:text-[#c3beb0] tabular-nums"><Plural value={r.matches.length} one="# topic" other="# topics" /></span>
                </div>
                <div className="space-y-2">
                  {r.matches.map((m) => (
                    <div key={m.pairId} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-semibold text-ink dark:text-[#f5f2ea]">{m.topic.title}</span>
                        <span className="text-muted dark:text-[#c3beb0]">{m.topic.topicId}</span>
                        {m.topic.deadlines.length > 0 && <span className="text-muted dark:text-[#c3beb0] tabular-nums">{m.topic.deadlines.map(fmtDate).join(', ')}</span>}
                      </div>
                      <MatchCard match={m} researcher={record} onFeedback={onFeedback} busy={busy} showName={false} />
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
