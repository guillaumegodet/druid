import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, RefreshCw, AlertTriangle, Info, ExternalLink, X, CalendarCheck } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import { apiErrorText } from '../../lib/apiErrors';
import {
  AffiliationHistoryApi, AhError, affiliationHistoryKey, timelineRows, yearRange, sortSignals, suggestedEndDate,
  suggestedStartDate, publicationsOf, type AhEntry, type AhRun, type AhSignal, type TimelineRow, type OrgClass,
} from '../../lib/affiliationHistory';
import { AffiliationTimelineChart } from './AffiliationTimelineChart';

// « Parcours » block of the researcher record (docs/plan-parcours-affiliations.md, lot 3): affiliations
// observed in the publications (CRISalid graph, OpenAlex, Scopus), positions declared in ORCID and the
// Scopus profile, computed weekly by scripts/sync_affiliation_history.cjs and served by
// /api/researchers/:key/affiliation-history. The date buttons only fill the employment fields of the
// record: the record's « Save » button writes them (never an automatic change of status, D4).

interface Props {
  researcher: Researcher;
  /** Fills a field of the record (same contract as GeneralTab); absent = read-only record. */
  onUpdateField?: (field: string, value: string, subObject?: string) => void;
}

const MAX_CHART_ROWS = 14;
const labelCls = 'text-[11px] uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]';
const CLASS_DOT: Record<OrgClass, string> = {
  local: 'bg-[#2ea066]',
  other: 'bg-[#3b5bdb] dark:bg-[#5c7cfa]',
  neutral: 'bg-[#9a9486] dark:bg-[#8f897c]',
  unknown: 'bg-[#9a9486] dark:bg-[#8f897c]',
};
const periodText = (first: number | null, last: number | null) => (first ? (first === last ? String(first) : `${first}–${last}`) : '—');

/** One banner line per signal (the destination / dates come from the job, see computeSignals). */
const SignalLine: React.FC<{ s: AhSignal }> = ({ s }) => {
  const { t } = useLingui();
  const dest = s.destination || '';
  switch (s.type) {
    case 'depart_confirme': {
      const sources = (s.sources || []).map((x) => (x === 'orcid' ? 'ORCID' : x === 'scopus' ? 'Scopus' : t`publications`)).join(' + ');
      const date = s.date || '';
      return dest ? <Trans>Departure confirmed by {sources}: left around {date}, towards {dest}.</Trans> : <Trans>Departure confirmed by {sources}: left around {date}.</Trans>;
    }
    case 'depart_declare': {
      const date = s.date || '';
      return <Trans>ORCID: the last position at the institution ended in {date}.</Trans>;
    }
    case 'nouveau_poste_declare': {
      const date = s.date || '';
      return <Trans>ORCID: new position at {dest} since {date}.</Trans>;
    }
    case 'depart_observe': {
      const date = s.date || '';
      const count = s.count || 0;
      if (s.rule === 'dominant') {
        const since = s.since || '';
        const local = s.local || 0;
        return dest
          ? <Trans>Publications: mostly affiliated elsewhere since {since} ({count} against {local} at the institution), mostly {dest}; last one affiliated to the institution in {date}.</Trans>
          : <Trans>Publications: mostly affiliated elsewhere since {since} ({count} against {local} at the institution); last one affiliated to the institution in {date}.</Trans>;
      }
      return dest
        ? <Trans>Publications: none affiliated to the institution after {date}; {count} affiliated elsewhere, mostly {dest}.</Trans>
        : <Trans>Publications: none affiliated to the institution after {date}; {count} affiliated elsewhere.</Trans>;
    }
    case 'scopus_courante_non_locale':
      return <Trans>Scopus: current affiliation {dest} (computed by Elsevier from the latest publications).</Trans>;
    case 'statut_incoherent': {
      const endYear = s.endYear || '';
      const lastLocal = s.lastLocal || '';
      return s.lastLocal
        ? <Trans>The record ended in {endYear}, yet publications are still affiliated to the institution in {lastLocal}.</Trans>
        : <Trans>The record ended in {endYear}, yet ORCID shows an ongoing position at the institution.</Trans>;
    }
    case 'identifiant_suspect':
      return <Trans>Identifiers to check: their publications or profile never mention the institution (homonym or wrong identifier?).</Trans>;
    default:
      return null;
  }
};

/** Publications of one establishment (click on a table row or a chart dot). */
const PublicationsModal: React.FC<{ entry: AhEntry; row: TimelineRow; onClose: () => void }> = ({ entry, row, onClose }) => {
  const { t } = useLingui();
  const pubs = row.estIndex === null ? [] : publicationsOf(entry, row.mergedIndexes?.length ? row.mergedIndexes : row.estIndex);
  const truncated = entry.totals.pubs > entry.pubs.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const name = row.name;
  // Portal: the block's glass card has a backdrop-filter, which would make `fixed` relative to the card.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card-strong w-full max-w-3xl p-5 flex flex-col gap-3 bg-white/95 dark:bg-[#33312c] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h4 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]"><Trans>Publications affiliated to {name}</Trans></h4>
          <button type="button" onClick={onClose} title={t`Close`} className="p-1.5 rounded-lg text-muted-light dark:text-[#8f897c] hover:bg-ink/5 dark:hover:bg-white/10"><X className="w-4 h-4" /></button>
        </div>
        {truncated && <p className="text-[11px] text-muted-lighter dark:text-[#8f897c]"><Trans>Only the most recent publications of the record are kept for this list.</Trans></p>}
        <ul className="flex flex-col divide-y divide-ink/5 dark:divide-white/10 overflow-y-auto">
          {pubs.map((p, i) => (
            <li key={i} className="py-2 flex items-baseline gap-3 text-[13px]">
              <span className="w-10 shrink-0 tabular-nums text-muted dark:text-[#c3beb0]">{p.y || '—'}</span>
              <span className="flex-1 text-ink dark:text-[#f5f2ea]">{p.t || t`(untitled)`}</span>
              <span className="shrink-0 text-[11px] text-muted-lighter dark:text-[#8f897c]">{p.s.map((x) => (x === 'graph' ? 'CRISalid' : x === 'openalex' ? 'OpenAlex' : 'Scopus')).join(' · ')}</span>
              {p.doi && (
                <a href={`https://doi.org/${p.doi}`} target="_blank" rel="noopener noreferrer" title={p.doi} className="shrink-0 text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </li>
          ))}
          {!pubs.length && <li className="py-2 text-[13px] text-muted dark:text-[#c3beb0]"><Trans>No publication: this establishment only comes from ORCID.</Trans></li>}
        </ul>
      </div>
    </div>,
    document.body,
  );
};

export const AffiliationHistorySection: React.FC<Props> = ({ researcher, onUpdateField }) => {
  const { t, i18n } = useLingui();
  const key = affiliationHistoryKey(researcher);
  const [entry, setEntry] = useState<AhEntry | null>(null);
  const [run, setRun] = useState<AhRun | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [openRow, setOpenRow] = useState<TimelineRow | null>(null);
  const [reported, setReported] = useState<{ end?: string; start?: string }>({});
  const now = new Date().getFullYear();

  const load = useCallback(async () => {
    if (!key) { setState('missing'); return; }
    setState('loading');
    try {
      const r = await AffiliationHistoryApi.get(key);
      setEntry(r.entry); setRun(r.run); setState('ready');
    } catch (e) {
      if (e instanceof AhError && e.status === 404) { setRun(e.run); setState('missing'); }
      else { setError(apiErrorText(e)); setState('error'); }
    }
  }, [key]);
  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    if (!key) return;
    setRefreshing(true); setError('');
    try { const r = await AffiliationHistoryApi.refresh(key); setEntry(r.entry); setRun(r.run); setState('ready'); }
    catch (e) { setError(apiErrorText(e)); }
    finally { setRefreshing(false); }
  };

  const rows = useMemo(() => (entry ? timelineRows(entry) : []), [entry]);
  const chartRows = useMemo(() => rows.filter((r) => r.count || r.periods.length).slice(0, MAX_CHART_ROWS), [rows]);
  const employment = { start: researcher.employment?.startDate || '', end: researcher.employment?.endDate || '' };
  const range = useMemo(() => yearRange(chartRows, employment, now), [chartRows, employment.start, employment.end, now]);
  const signals = entry ? sortSignals(entry.signals).filter((s) => s.type !== 'arrivee') : [];
  const endSuggestion = entry ? suggestedEndDate(entry.signals, employment.end) : null;
  const startSuggestion = entry ? suggestedStartDate(entry.signals, employment.start) : null;
  const alert = signals.some((s) => ['depart_confirme', 'depart_declare', 'nouveau_poste_declare', 'depart_observe'].includes(s.type));

  const computedAt = entry ? new Date(entry.computedAt).toLocaleDateString(i18n.locale) : '';
  const { graph: nGraph, openalex: nOpenalex, scopus: nScopus, orcid: nOrcid } = entry?.sources || { graph: null, openalex: null, scopus: null, orcid: null };
  const sourcesText = [
    nGraph !== null ? t`CRISalid graph (${nGraph})` : null,
    nOpenalex !== null ? t`OpenAlex (${nOpenalex})` : null,
    nScopus !== null ? t`Scopus (${nScopus})` : null,
    nOrcid !== null ? t`ORCID (${nOrcid} positions)` : null,
  ].filter(Boolean).join(' · ');

  const runDone = run?.done ?? 0;
  const runTotal = run?.total ?? 0;
  const totalPubs = entry?.totals.pubs ?? 0;
  const withAffiliation = entry?.totals.withAffiliation ?? 0;

  const reportedEnd = reported.end || '';
  const reportedStart = reported.start || '';

  const report = (kind: 'end' | 'start', date: string) => {
    onUpdateField?.(kind === 'end' ? 'endDate' : 'startDate', date, 'employment');
    setReported((r) => ({ ...r, [kind]: date }));
  };

  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
            <History className="w-4 h-4" /> <Trans>Career path</Trans>
          </h4>
          {entry && (
            <p className="text-[11px] text-muted-lighter dark:text-[#8f897c]">
              <Trans>Computed on {computedAt} · {sourcesText}</Trans>
              {entry.incomplete.length > 0 && <> · <Trans>incomplete (source unavailable at that time)</Trans></>}
            </p>
          )}
        </div>
        {key && (
          <button type="button" onClick={refresh} disabled={refreshing} className="btn-pill text-[13px] disabled:opacity-50" title={t`Recompute now from the identifiers of the record (about ten seconds)`}>
            <RefreshCw className={`w-4 h-4${refreshing ? ' animate-spin' : ''}`} /> {refreshing ? t`Computing…` : t`Refresh`}
          </button>
        )}
      </div>

      {error && <p className="text-[12px] text-[#b23b3b] dark:text-[#e57373]">{error}</p>}

      {state === 'loading' && <p className="text-xs text-muted dark:text-[#c3beb0]"><Trans>Loading…</Trans></p>}
      {state === 'missing' && (
        <p className="text-xs text-muted dark:text-[#c3beb0]">
          {run?.running
            ? <Trans>Not computed yet: the weekly computation is in progress ({runDone}/{runTotal} records). Use « Refresh » to compute this record now.</Trans>
            : <Trans>Not computed yet. The path is built from the ORCID, IdHAL, IdRef, OpenAlex and Scopus identifiers of the record (see « Researcher identifiers alignment »): use « Refresh » once they are filled.</Trans>}
        </p>
      )}

      {state === 'ready' && entry && (
        <>
          {(signals.length > 0 || endSuggestion || startSuggestion || reported.end || reported.start) && (
            <div className={`rounded-2xl px-4 py-3 flex flex-col gap-2 text-[13px] ${alert ? 'bg-[rgba(224,158,42,.12)] border border-[rgba(224,158,42,.35)]' : 'bg-ink/[.03] dark:bg-white/5 border border-ink/5 dark:border-white/10'}`}>
              {signals.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-ink dark:text-[#f5f2ea]">
                  {alert && i === 0 ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-[#ab7f10] dark:text-[#e0b04a]" /> : <Info className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />}
                  <span><SignalLine s={s} /></span>
                </div>
              ))}
              {onUpdateField && (endSuggestion || startSuggestion || reported.end || reported.start) && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {/* Once reported, the field holds the date and the suggestion disappears: keep the notice. */}
                  {reported.end
                    ? <span className="text-[12px] text-muted dark:text-[#c3beb0]"><CalendarCheck className="inline w-3.5 h-3.5 mr-1" /><Trans>End of employment set to {reportedEnd} — save the record to keep it.</Trans></span>
                    : endSuggestion && <button type="button" onClick={() => report('end', endSuggestion)} className="btn-pill text-[12px]"><Trans>Report {endSuggestion} as end of employment</Trans></button>}
                  {reported.start
                    ? <span className="text-[12px] text-muted dark:text-[#c3beb0]"><CalendarCheck className="inline w-3.5 h-3.5 mr-1" /><Trans>Start of employment set to {reportedStart} — save the record to keep it.</Trans></span>
                    : startSuggestion && <button type="button" onClick={() => report('start', startSuggestion)} className="btn-pill text-[12px]"><Trans>Report {startSuggestion} as start of employment</Trans></button>}
                </div>
              )}
            </div>
          )}

          {chartRows.length > 0 ? (
            <AffiliationTimelineChart rows={chartRows} range={range} employment={employment} now={now} onRowClick={(r) => r.estIndex !== null && setOpenRow(r)} />
          ) : (
            <p className="text-xs text-muted dark:text-[#c3beb0]"><Trans>No affiliated publication and no ORCID position found for the identifiers of this record.</Trans></p>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className={labelCls}>
                    <th className="text-left font-normal py-1.5 pr-3"><Trans>Establishment</Trans></th>
                    <th className="text-left font-normal py-1.5 pr-3">ORCID</th>
                    <th className="text-left font-normal py-1.5 pr-3">Scopus</th>
                    <th className="text-left font-normal py-1.5 pr-3"><Trans>Publications</Trans></th>
                    <th className="text-right font-normal py-1.5"><Trans>Count</Trans></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5 dark:divide-white/10">
                  {rows.map((r, i) => {
                    const est = r.estIndex !== null ? entry.establishments[r.estIndex] : null;
                    return (
                      <tr key={i} className={`align-top ${r.estIndex !== null ? 'cursor-pointer hover:bg-ink/[.03] dark:hover:bg-white/5' : ''}`} onClick={() => r.estIndex !== null && setOpenRow(r)}>
                        <td className="py-2 pr-3 text-ink dark:text-[#f5f2ea]">
                          <span className="inline-flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${CLASS_DOT[r.cls]}`} aria-hidden />
                            <span>{r.name}</span>
                            {r.country && <span className="text-[11px] text-muted-lighter dark:text-[#8f897c]">{r.country}</span>}
                          </span>
                          {est && est.labs.length > 0 && (
                            <div className="text-[11px] text-muted dark:text-[#c3beb0] mt-0.5 pl-[18px]">{est.labs.slice(0, 3).map((l) => `${l.name} (${l.count})`).join(' · ')}</div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-muted dark:text-[#c3beb0] whitespace-nowrap">
                          {r.periods.length ? r.periods.map((p, k) => <div key={k}>{p.start || '?'} – {p.end || t`ongoing`}{p.kind === 'invited' ? ` (${t`invited`})` : ''}</div>) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-muted dark:text-[#c3beb0]">{r.inScopus === 'current' ? t`current` : r.inScopus === 'history' ? t`history` : '—'}</td>
                        <td className="py-2 pr-3 text-muted dark:text-[#c3beb0] tabular-nums">{periodText(r.first, r.last)}</td>
                        <td className="py-2 text-right tabular-nums text-ink dark:text-[#f5f2ea]">{r.count || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-lighter dark:text-[#8f897c]">
                <Trans>{totalPubs} publications, {withAffiliation} with an affiliation. A publication counts for each establishment it declares, so the counts may exceed the total. National organisms (CNRS, Inserm…) are shown but never read as a departure.</Trans>
              </p>
            </div>
          )}
        </>
      )}

      {openRow && entry && <PublicationsModal entry={entry} row={openRow} onClose={() => setOpenRow(null)} />}
    </div>
  );
};
