// View « Candidates » of the « Calls for proposals » tab (druid-internal docs/plan-funding-calls.md, lot 5, decision
// D5): for a call reserved by career stage (ERC Starting / Consolidator…), the researchers its rule makes eligible
// or to check, from the date of their PhD (theses.fr), computed by scripts/compute_eligibility.cjs. Institution
// right only (the server refuses the others); on the dashboard of a structure, its own directory records only.
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import { apiErrorText } from '../../lib/apiErrors';
import type { EligibilityReason, EligibilityVerdict } from '../../lib/calls/eligibility';

interface RuleView {
  callId: string;
  scheme: string;
  title: string;
  phdFrom: string;
  phdTo: string;
  extensionYears: number;
  sourceText: string;
  deadlines: string[];
  eligible: number;
  toCheck: number;
  computedAt: string;
}
interface CandidateView {
  uid: string;
  personName: string;
  units: string[];
  grade: string;
  rowIds: number[];
  verdict: EligibilityVerdict;
  reasons: EligibilityReason[];
  phdOn: string | null;
}

const SELECT_CLASS = 'px-3 py-1.5 rounded-full text-[13px] bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea]';
const fmtDate = (d: string): string => (/^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('/') : d);

/** Sentence of a reason of the eligibility engine (also used by the block of the researcher record). */
export const useEligibilityReasonLabel = (): ((r: EligibilityReason) => string) => {
  const { t } = useLingui();
  return (r) => ({
    'phd-in-window': t`PhD within the window of the call`,
    'phd-year-at-bound': t`PhD date known to the year only, at a bound of the window`,
    'phd-before-window-extension': t`PhD just before the window: eligible only with a documented extension (maternity, parental leave, illness, national service, clinical training)`,
    'phd-before-window': t`PhD before the window`,
    'phd-after-window': t`PhD after the window`,
  } as Record<EligibilityReason, string>)[r] ?? r;
};

export const CallCandidates: React.FC<{
  /** Directory records of the structure shown; null = every candidate (institution view). */
  researchers: Researcher[] | null;
  onOpenResearcher?: (r: Researcher) => void;
}> = ({ researchers, onOpenResearcher }) => {
  const { t } = useLingui();
  const [rules, setRules] = useState<RuleView[] | null>(null);
  const [callId, setCallId] = useState('');
  const [candidates, setCandidates] = useState<CandidateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<EligibilityVerdict | ''>('');
  const [grade, setGrade] = useState('');

  const reasonLabel = useEligibilityReasonLabel();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/calls/eligibility', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b?.error || `HTTP ${r.status}`)))))
      .then((d) => {
        if (cancelled) return;
        const list: RuleView[] = d.rules ?? [];
        setRules(list);
        setCallId((c) => c || list[0]?.callId || '');
      })
      .catch((e) => { if (!cancelled) setError(apiErrorText(e instanceof Error ? e.message : String(e))); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    setCandidates(null);
    fetch(`/api/calls/eligibility/${encodeURIComponent(callId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b?.error || `HTTP ${r.status}`)))))
      .then((d) => { if (!cancelled) setCandidates(d.candidates ?? []); })
      .catch((e) => { if (!cancelled) setError(apiErrorText(e instanceof Error ? e.message : String(e))); });
    return () => { cancelled = true; };
  }, [callId]);

  // A candidate is found among the records shown by its uid, or by its directory rows when it has none.
  const byUid = useMemo(() => new Map((researchers ?? []).filter((r) => r.uid).map((r) => [r.uid!.toLowerCase(), r])), [researchers]);
  const byRow = useMemo(() => {
    const m = new Map<number, Researcher>();
    for (const r of researchers ?? []) {
      if (r.gristRowId) m.set(r.gristRowId, r);
      for (const a of r.affiliations ?? []) if (a.gristRowId) m.set(a.gristRowId, r);
    }
    return m;
  }, [researchers]);
  const recordOf = (c: CandidateView): Researcher | undefined =>
    (c.uid ? byUid.get(c.uid.toLowerCase()) : undefined) ?? c.rowIds.map((id) => byRow.get(id)).find(Boolean);
  const inStructure = useMemo(
    () => (candidates ?? []).filter((c) => researchers === null || !!recordOf(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, researchers, byUid, byRow],
  );
  const grades = useMemo(() => [...new Set(inStructure.map((c) => c.grade).filter(Boolean))].sort(), [inStructure]);
  const rows = inStructure.filter((c) => (!verdict || c.verdict === verdict) && (!grade || c.grade === grade));
  const rule = rules?.find((r) => r.callId === callId) ?? null;

  const downloadCsv = () => {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['call_id', 'uid', 'name', 'units', 'grade', 'phd', 'verdict', 'reasons'];
    const lines = [head.join(';'), ...rows.map((c) => [callId, c.uid, c.personName, c.units.join(' | '), c.grade, c.phdOn, c.verdict, c.reasons.map(reasonLabel).join(' ; ')].map(cell).join(';'))];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `candidates-${callId.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return <p className="flex items-center gap-2 text-[13px] text-red-700 dark:text-red-300"><AlertCircle className="w-4 h-4" /> {error}</p>;
  }
  if (!rules) return <p className="text-[13px] text-muted dark:text-[#c3beb0]"><Trans>Loading…</Trans></p>;
  if (!rules.length) {
    return (
      <p className="text-[13px] text-muted-lighter dark:text-[#8f897c]">
        <Trans>No open call states an eligibility rule by career stage yet (ERC Starting and Consolidator Grants, ANR JCJC…).</Trans>
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select value={callId} onChange={(e) => setCallId(e.target.value)} className={SELECT_CLASS} aria-label={t`Call`}>
          {rules.map((r) => <option key={r.callId} value={r.callId}>{r.callId} — {r.title}</option>)}
        </select>
        <select value={verdict} onChange={(e) => setVerdict(e.target.value as EligibilityVerdict | '')} className={SELECT_CLASS} aria-label={t`Verdict`}>
          <option value="">{t`Eligible and to check`}</option>
          <option value="eligible">{t`Eligible`}</option>
          <option value="check">{t`To check`}</option>
        </select>
        {grades.length > 1 && (
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className={SELECT_CLASS} aria-label={t`Grade`}>
            <option value="">{t`All grades`}</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <button type="button" onClick={downloadCsv} disabled={!rows.length} className={`${SELECT_CLASS} inline-flex items-center gap-1.5 font-semibold disabled:opacity-50`}>
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>
      {rule && (
        <p className="text-[13px] rounded-2xl px-4 py-2 bg-white/60 dark:bg-white/5 text-muted dark:text-[#c3beb0]">
          <Trans>PhD defended between {fmtDate(rule.phdFrom)} and {fmtDate(rule.phdTo)}</Trans>
          {rule.deadlines.length > 0 && <> · <Trans>Deadline {rule.deadlines.map(fmtDate).join(', ')}</Trans></>}
          {rule.sourceText && <span className="block italic mt-0.5">« {rule.sourceText} »</span>}
          <span className="block mt-0.5"><Trans>From the date of the PhD on theses.fr only: the other conditions of the call (previous grants, host institution, time in Europe) are not checked.</Trans></span>
        </p>
      )}
      {candidates === null ? (
        <p className="text-[13px] text-muted dark:text-[#c3beb0]"><Trans>Loading…</Trans></p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-lighter dark:text-[#8f897c]"><Trans>No candidate matches these filters.</Trans></p>
      ) : (
        <>
          <p className="text-[12px] text-muted dark:text-[#c3beb0] tabular-nums"><Plural value={rows.length} one="# candidate" other="# candidates" /></p>
          <div className="overflow-x-auto rounded-2xl bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-muted dark:text-[#c3beb0]">
                  <th className="px-3 py-2 font-semibold"><Trans>Researcher</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Labs</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Grade</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>PhD</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Verdict</Trans></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const record = recordOf(c);
                  return (
                    <tr key={c.uid || c.rowIds.join('-') || c.personName} className="border-t border-black/5 dark:border-white/10 align-top">
                      <td className="px-3 py-2">
                        {record && onOpenResearcher
                          ? <button type="button" onClick={() => onOpenResearcher(record)} className="font-semibold text-ink dark:text-[#f5f2ea] hover:underline text-left">{c.personName}</button>
                          : <span className="font-semibold text-ink dark:text-[#f5f2ea]">{c.personName}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{c.units.join(', ')}</td>
                      <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{c.grade}</td>
                      <td className="px-3 py-2 tabular-nums">{c.phdOn ? fmtDate(c.phdOn) : ''}</td>
                      <td className="px-3 py-2">
                        <span className={`font-semibold ${c.verdict === 'eligible' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                          {c.verdict === 'eligible' ? t`Eligible` : t`To check`}
                        </span>
                        {c.verdict === 'check' && <span className="block text-[12px] text-muted dark:text-[#c3beb0]">{c.reasons.map(reasonLabel).join(' ; ')}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
