import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Target } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import { apiErrorText } from '../../lib/apiErrors';
import { getUserInfo, hasCapability } from '../../lib/auth';
import { affiliationHistoryKey } from '../../lib/affiliationHistory';
import { callsWithMatches, withMyFeedback, type Call, type CallMatch, type FeedbackVerdict, type ProgrammeView } from '../../lib/calls/aggregate';
import type { EligibilityReason, EligibilityVerdict } from '../../lib/calls/eligibility';
import { CallMeta, MatchCard, fmtDate, localized, today, type PublicationLinks } from '../dashboard/CallMatchCard';
import { useEligibilityReasonLabel } from '../dashboard/CallCandidates';

// « Calls for proposals » block of the researcher record (druid-internal docs/plan-funding-calls.md, lot 7): the calls
// where the engines retained the person, with the same opinion buttons as the dashboard tab, and — institution right
// only (D5) — the calls reserved by career stage their PhD makes them eligible to. Served by
// /api/researchers/:key/calls; PostgreSQL instances only (capability HAS_CALLS); hidden when there is nothing to show.

interface EligibilityView {
  callId: string;
  programmeId: string;
  scheme: string;
  title: string;
  titleFr: string;
  deadlines: string[];
  url: string;
  phdFrom: string;
  phdTo: string;
  sourceText: string;
  verdict: EligibilityVerdict;
  reasons: EligibilityReason[];
  phdOn: string | null;
}
interface CallsAnswer {
  calls: Call[];
  programmes: ProgrammeView[];
  matches: CallMatch[];
  /** null when the viewer has no institution right. */
  eligibility: EligibilityView[] | null;
}

const labelCls = 'text-[11px] uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]';
// No dashboard publications on the record: the publications of a match link to an OpenAlex search.
const NO_LINKS: PublicationLinks = new Map();

const VERDICT_STYLE: Record<EligibilityVerdict, string> = {
  eligible: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  check: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  ineligible: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-[#c3beb0]',
};

export const CallsSection: React.FC<{ researcher: Researcher }> = ({ researcher }) => {
  const { t } = useLingui();
  const reasonLabel = useEligibilityReasonLabel();
  const key = affiliationHistoryKey(researcher);
  const enabled = hasCapability('HAS_CALLS') && !!key;
  const [data, setData] = useState<CallsAnswer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [includePast, setIncludePast] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setData(null);
    fetch(`/api/researchers/${encodeURIComponent(key!)}/calls`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CallsAnswer) => { if (!cancelled) { setData(d); setError(''); } })
      .catch((e) => { if (!cancelled) setError(apiErrorText(e)); });
    return () => { cancelled = true; };
  }, [key, enabled]);

  const programmeOf = useMemo(() => new Map((data?.programmes ?? []).map((p) => [p.programmeId, p])), [data]);
  const allCalls = useMemo(() => (data ? callsWithMatches(data.calls, data.matches, { today: today(), includePast: true }).filter((c) => c.matches.length > 0) : []), [data]);
  const shownCalls = includePast ? allCalls : allCalls.filter((c) => c.nextDeadline || c.deadlines.length === 0);
  const closed = allCalls.length - allCalls.filter((c) => c.nextDeadline || c.deadlines.length === 0).length;

  const onFeedback = async (pairId: string, verdict: FeedbackVerdict) => {
    setBusy(true);
    try {
      const res = await fetch('/api/calls/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairId, verdict }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((prev) => (prev ? { ...prev, matches: prev.matches.map((m) => (m.pairId === pairId ? withMyFeedback(m, verdict) : m)) } : prev));
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!enabled || (!data && !error)) return null;
  const eligibility = data?.eligibility ?? [];
  if (!error && !allCalls.length && !eligibility.length) return null;   // nothing to show: no empty card on the record
  const self = !!researcher.uid && getUserInfo().preferred_username === researcher.uid;

  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
          <Target className="w-4 h-4" /> {self ? <Trans>Calls for proposals for you</Trans> : <Trans>Calls for proposals</Trans>}
        </h4>
        <p className="text-[11px] text-muted-lighter dark:text-[#8f897c]">
          <Trans>Calls of the funding programmes where the matching retained this researcher from their publications known to the CRISalid graph. Your opinion on each match helps improve the matching.</Trans>
        </p>
      </div>
      {error && <p className="text-[12px] text-[#b23b3b] dark:text-[#e57373]">{error}</p>}

      {allCalls.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={labelCls}><Trans>Thematic matches</Trans></span>
            {closed > 0 && (
              <label className="inline-flex items-center gap-1.5 text-[12px] text-muted dark:text-[#c3beb0]">
                <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
                <Plural value={closed} one="Include # closed call" other="Include # closed calls" />
              </label>
            )}
          </div>
          {shownCalls.length === 0 ? (
            <p className="text-[13px] text-muted-lighter dark:text-[#8f897c]"><Trans>No open call: the calls where this researcher was retained are all closed.</Trans></p>
          ) : shownCalls.map((c) => {
            const programme = programmeOf.get(c.programmeId);
            return (
              <div key={c.callId} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-ink dark:text-[#f5f2ea]">{localized(c.title, c.titleFr)}</span>
                    <CallMeta call={c} programme={programme} showProgramme />
                  </span>
                  <span className="shrink-0 flex items-center gap-3 text-[12px]">
                    <span className={`font-semibold tabular-nums ${c.nextDeadline ? 'text-ink dark:text-[#f5f2ea]' : 'text-muted-lighter dark:text-[#8f897c]'}`}>
                      {c.nextDeadline ? t`Deadline ${fmtDate(c.nextDeadline)}` : c.deadlines.length ? t`Closed` : t`No deadline`}
                    </span>
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink dark:text-[#f5f2ea] hover:underline">
                        <ExternalLink className="w-3.5 h-3.5" /> <Trans>Page of the call</Trans>
                      </a>
                    )}
                  </span>
                </div>
                {c.matches.map((m) => (
                  <MatchCard key={m.pairId} match={m} onFeedback={onFeedback} busy={busy} showName={false} links={NO_LINKS} />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {eligibility.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={labelCls} title={t`Visible to the institution right only`}><Trans>Calls reserved by career stage</Trans></span>
          <ul className="flex flex-col divide-y divide-ink/5 dark:divide-white/10">
            {eligibility.map((e) => {
              const deadline = e.deadlines.find((d) => d >= today()) ?? null;
              const from = fmtDate(e.phdFrom);
              const to = fmtDate(e.phdTo);
              const phd = fmtDate(e.phdOn ?? '');
              return (
                <li key={e.callId} className="py-2 flex flex-col gap-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">{localized(e.title, e.titleFr)}</span>
                      <span className="block text-[12px] text-muted dark:text-[#c3beb0]">
                        {e.callId}{programmeOf.get(e.programmeId) && <> · {programmeOf.get(e.programmeId)!.name}</>}{e.scheme && <> · {e.scheme}</>}
                      </span>
                    </span>
                    <span className="shrink-0 flex items-center gap-3 text-[12px]">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${VERDICT_STYLE[e.verdict]}`}>
                        {e.verdict === 'eligible' ? <Trans>eligible</Trans> : <Trans>to check</Trans>}
                      </span>
                      {deadline && <span className="font-semibold tabular-nums text-ink dark:text-[#f5f2ea]">{t`Deadline ${fmtDate(deadline)}`}</span>}
                      {e.url && (
                        <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink dark:text-[#f5f2ea] hover:underline">
                          <ExternalLink className="w-3.5 h-3.5" /> <Trans>Page of the call</Trans>
                        </a>
                      )}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted dark:text-[#c3beb0]">
                    <Trans>PhD defended between {from} and {to}.</Trans>
                    {phd && <> <Trans>PhD of the record: {phd}.</Trans></>}
                    {e.reasons.length > 0 && <> {e.reasons.map(reasonLabel).join(' ; ')}.</>}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
