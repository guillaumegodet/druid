// Curation view of the strategic axes on the axis reviews (druid-internal docs/plan-axes-embeddings.md, lot 3): every
// publication of the period with its automatic axis (embeddings + model, or keywords), its confidence and rationale,
// and the decision of the reviewers — confirm, correct (one or several axes), outside the axes, unsure — with filters,
// progress per axis and a review sample. The decisions apply at once to the charts of the tab (AxesTab axeOf).
import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, CircleHelp, Dices, Pencil, RefreshCw, Search, Undo2, XCircle } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import type { DashboardPublication } from './types';
import type { YearRange } from './overviewAggregates';
import { AXE_OTHER } from './phase4Aggregates';
import type { AxisReviews } from './axisReviewsHook';
import type { AxisReview, AxisReviewDecision } from '../../lib/publications/axisReviews';
import { autoAxisOf, reviewProgress, reviewSample } from '../../lib/publications/axisReviewStats';
import { numberLocale } from '../../lib/i18n';
import { doiUrl } from '../../lib/doi';

const PAGE_SIZE = 25;
type StatusFilter = 'all' | 'todo' | 'reviewed' | 'sample' | AxisReviewDecision;

const DECISION_STYLE: Record<AxisReviewDecision, string> = {
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  corrected: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  rejected: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-[#c3beb0]',
  unsure: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
};

const ConfidenceDot: React.FC<{ value: number | null | undefined }> = ({ value }) => {
  const { t } = useLingui();
  if (value === null || value === undefined) return null;
  const color = value >= 0.7 ? 'bg-emerald-500' : value >= 0.45 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-light dark:text-[#8f897c] tabular-nums" title={t`Confidence of the automatic classification`}>
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} /> {Math.round(value * 100)} %
    </span>
  );
};

const ProgressBar: React.FC<{ value: number; total: number }> = ({ value, total }) => (
  <div className="h-2 rounded-full bg-ink/10 dark:bg-white/10 overflow-hidden" aria-hidden>
    <div className="h-full bg-ink dark:bg-[#f5f2ea] transition-all" style={{ width: `${total ? Math.round((100 * value) / total) : 0}%` }} />
  </div>
);

export const AxisReviewTable: React.FC<{
  publications: DashboardPublication[];
  range: YearRange;
  axes: string[];
  reviews: AxisReviews;
  /** Effective axis (review, Grist correction or automatic classification). */
  axeOf: (p: DashboardPublication) => string;
  canWrite: boolean;
}> = ({ publications, range, axes, reviews, axeOf, canWrite }) => {
  const { t } = useLingui();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('todo');
  const [axisFilter, setAxisFilter] = useState('__all__');
  const [lowConfidence, setLowConfidence] = useState(false);
  const [page, setPage] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<Set<DashboardPublication> | null>(null);
  const [editing, setEditing] = useState<DashboardPublication | null>(null);
  const [draftAxes, setDraftAxes] = useState<string[]>([]);
  const [draftNote, setDraftNote] = useState('');

  const inRange = useMemo(
    () => publications.filter((p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end),
    [publications, range],
  );
  const progress = useMemo(() => reviewProgress(inRange, reviews.index, axes, AXE_OTHER), [inRange, reviews.index, axes]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inRange
      .filter((p) => {
        const r = reviews.reviewOf(p);
        if (status === 'todo') return !r;
        if (status === 'reviewed') return !!r;
        if (status === 'sample') return !!sample?.has(p);
        if (status === 'all') return true;
        return r?.decision === status;
      })
      .filter((p) => axisFilter === '__all__' || autoAxisOf(p, AXE_OTHER) === axisFilter)
      .filter((p) => !lowConfidence || (p.axeConfidence ?? 1) < 0.5)
      .filter((p) => !q || (p.title ?? '').toLowerCase().includes(q) || (p.doi ?? '').toLowerCase().includes(q) || (p.journal ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.axeConfidence ?? 1) - (b.axeConfidence ?? 1) || (b.year ?? 0) - (a.year ?? 0));
  }, [inRange, reviews, status, sample, axisFilter, lowConfidence, query]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const act = async (p: DashboardPublication, fn: () => Promise<string | null>) => {
    const key = `${p.doi ?? ''}|${p.title ?? ''}`;
    setBusyKey(key);
    setError(null);
    const err = await fn();
    setBusyKey(null);
    if (err) setError(err);
    else {
      setFlashKey(key);
      window.setTimeout(() => setFlashKey(null), 1200);
    }
  };
  const decide = (p: DashboardPublication, decision: AxisReviewDecision, retained: string[] = [], note = '') =>
    act(p, () => reviews.save(p, { decision, axes: retained, note }, autoAxisOf(p, AXE_OTHER)));
  const startEdit = (p: DashboardPublication, current?: AxisReview) => {
    setEditing(p);
    const auto = autoAxisOf(p, AXE_OTHER);
    setDraftAxes(current?.axes.length ? current.axes : auto !== AXE_OTHER ? [auto] : []);
    setDraftNote(current?.note ?? '');
  };
  const toggleDraftAxis = (axis: string) =>
    setDraftAxes((d) => (d.includes(axis) ? d.filter((a) => a !== axis) : [...d, axis]));
  const commitEdit = async () => {
    if (!editing || !draftAxes.length) return;
    const p = editing;
    setEditing(null);
    await decide(p, 'corrected', draftAxes, draftNote);
  };
  const drawSample = () => {
    const picked = reviewSample(inRange, reviews.index, 40, AXE_OTHER, Date.now() % 100000);
    setSample(new Set(picked));
    setStatus('sample');
    setPage(0);
  };

  const decisionLabel: Record<AxisReviewDecision, string> = {
    confirmed: t`Confirmed`, corrected: t`Corrected`, rejected: t`Outside the axes`, unsure: t`Unsure`,
  };

  return (
    <div className="glass-card flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-[260px] flex-1">
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
            <Pencil className="w-4 h-4" /> <Trans>Classification curation</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Trans>
              {progress.reviewed.toLocaleString(numberLocale())} of {progress.total.toLocaleString(numberLocale())} publications reviewed over the period
            </Trans>
            {progress.agreement !== null && (
              <> · <Trans>automatic axis confirmed in {Math.round(progress.agreement * 100)} % of the decisions</Trans></>
            )}
          </p>
          <div className="mt-2 max-w-md"><ProgressBar value={progress.reviewed} total={progress.total} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-pill px-3 py-1.5 text-[13px] inline-flex items-center gap-1.5" onClick={drawSample} title={t`40 publications not reviewed yet, spread over the axes, the doubtful ones first`}>
            <Dices className="w-4 h-4" /> <Trans>Draw a sample</Trans>
          </button>
        </div>
      </div>

      {/* Per-axis progress */}
      <div className="px-5 pb-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1 text-xs text-muted dark:text-[#c3beb0]">
        {progress.byAxis.map((row) => (
          <div key={row.axis} className="flex items-center gap-2">
            <span className="truncate flex-1" title={row.axis}>{row.axis}</span>
            <span className="tabular-nums shrink-0">{row.reviewed}/{row.total}</span>
            <span className="w-20 shrink-0"><ProgressBar value={row.reviewed} total={row.total} /></span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <select className="input-soft !w-auto py-1.5 pr-7 text-sm cursor-pointer" value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(0); }} title={t`Review status`}>
          <option value="todo">{t`To review`}</option>
          <option value="reviewed">{t`Reviewed`}</option>
          <option value="confirmed">{decisionLabel.confirmed}</option>
          <option value="corrected">{decisionLabel.corrected}</option>
          <option value="rejected">{decisionLabel.rejected}</option>
          <option value="unsure">{decisionLabel.unsure}</option>
          {sample && <option value="sample">{t`Current sample`}</option>}
          <option value="all">{t`All publications`}</option>
        </select>
        <select className="input-soft !w-auto py-1.5 pr-7 text-sm cursor-pointer" value={axisFilter} onChange={(e) => { setAxisFilter(e.target.value); setPage(0); }} title={t`Filter by automatic axis`}>
          <option value="__all__">{t`All axes`}</option>
          {[...axes, AXE_OTHER].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-[13px] text-muted dark:text-[#c3beb0]">
          <input type="checkbox" checked={lowConfidence} onChange={(e) => { setLowConfidence(e.target.checked); setPage(0); }} /> <Trans>Low confidence only</Trans>
        </label>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
          <input className="input-soft !w-56 !pl-8 py-1.5 text-sm" placeholder={t`Title, DOI or journal…`} value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
        </div>
        <span className="text-xs text-muted-light dark:text-[#8f897c] tabular-nums"><Plural value={rows.length} one="# publication" other="# publications" /></span>
      </div>

      {error && <p className="px-5 pb-2 text-xs font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
      {!canWrite && <p className="px-5 pb-2 text-xs text-muted-light dark:text-[#8f897c]"><Trans>Read-only: the decisions are shown but cannot be changed here.</Trans></p>}

      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
              <th className="px-3 py-2 w-14"><Trans>Year</Trans></th>
              <th className="px-3 py-2"><Trans>Title</Trans></th>
              <th className="px-3 py-2 w-64"><Trans>Automatic axis</Trans></th>
              <th className="px-3 py-2 w-56"><Trans>Decision</Trans></th>
              <th className="px-3 py-2 w-72"><Trans>Actions</Trans></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p, i) => {
              const r = reviews.reviewOf(p);
              const auto = autoAxisOf(p, AXE_OTHER);
              const key = `${p.doi ?? ''}|${p.title ?? ''}`;
              const busy = busyKey === key;
              const isEditing = editing === p;
              return (
                <tr key={`${key}-${i}`} className="border-t border-ink/5 dark:border-white/5 align-top">
                  <td className="px-3 py-2 font-semibold text-ink dark:text-[#f5f2ea]">{p.year}</td>
                  <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">
                    {p.doi ? (
                      <a href={doiUrl(p.doi) ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">{p.title ?? p.doi}</a>
                    ) : (p.title ?? '—')}
                    {p.axeMotivation && (
                      <details className="mt-1 text-xs text-muted-light dark:text-[#8f897c]">
                        <summary className="cursor-pointer"><Trans>Rationale</Trans></summary>
                        <p className="mt-1 leading-relaxed">{p.axeMotivation}</p>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className={auto === AXE_OTHER ? 'text-muted-light dark:text-[#8f897c]' : 'text-ink dark:text-[#f5f2ea] font-semibold'}>{auto}</div>
                    {p.axesSecondary && p.axesSecondary.length > 0 && (
                      <div className="text-muted-light dark:text-[#8f897c]" title={t`Secondary axes`}>+ {p.axesSecondary.join(', ')}</div>
                    )}
                    <div className="mt-0.5 flex items-center gap-2"><ConfidenceDot value={p.axeConfidence} />{p.axeMethod === 'keywords' && <span className="text-[11px] text-muted-light dark:text-[#8f897c]"><Trans>keywords</Trans></span>}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r ? (
                      <div className="space-y-0.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold ${DECISION_STYLE[r.decision]}`}>{decisionLabel[r.decision]}</span>
                        {r.decision === 'corrected' && <div className="text-ink dark:text-[#f5f2ea]">{r.axes.join(' + ')}</div>}
                        {r.note && <div className="text-muted-light dark:text-[#8f897c] italic">{r.note}</div>}
                        <div className="text-muted-lighter dark:text-[#8f897c]">{r.author}</div>
                        {axeOf(p) !== auto && <div className="text-muted-light dark:text-[#8f897c]"><Trans>Shown as:</Trans> {axeOf(p)}</div>}
                      </div>
                    ) : (
                      <span className="text-muted-lighter dark:text-[#8f897c]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {!canWrite ? null : isEditing ? (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-1">
                          {axes.map((a) => (
                            <button key={a} type="button" onClick={() => toggleDraftAxis(a)}
                              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${draftAxes.includes(a) ? 'bg-ink text-white border-ink dark:bg-[#f5f2ea] dark:text-[#1c1a14]' : 'bg-white/60 dark:bg-white/10 border-ink/10 dark:border-white/15 text-ink dark:text-[#f5f2ea]'}`}
                              title={draftAxes[0] === a ? t`Principal axis` : t`Click to add or remove; the first one chosen is the principal axis`}>
                              {draftAxes[0] === a ? '1. ' : draftAxes.includes(a) ? `${draftAxes.indexOf(a) + 1}. ` : ''}{a}
                            </button>
                          ))}
                        </div>
                        <input className="input-soft !w-full py-1 text-xs" placeholder={t`Note (optional)`} value={draftNote} onChange={(e) => setDraftNote(e.target.value)} />
                        <div className="flex gap-1.5">
                          <button type="button" className="btn-pill px-3 py-1 text-[12px] disabled:opacity-40" disabled={!draftAxes.length} onClick={commitEdit}><Trans>Save</Trans></button>
                          <button type="button" className="btn-pill px-3 py-1 text-[12px]" onClick={() => setEditing(null)}><Trans>Cancel</Trans></button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-lighter" /> : flashKey === key ? <Check className="w-3.5 h-3.5 text-pixel-teal" /> : null}
                        {auto !== AXE_OTHER && r?.decision !== 'confirmed' && (
                          <button type="button" className="btn-pill px-2.5 py-1 text-[12px] inline-flex items-center gap-1" disabled={busy} onClick={() => decide(p, 'confirmed')} title={t`The automatic axis is right`}>
                            <CheckCircle2 className="w-3.5 h-3.5" /> <Trans>Confirm</Trans>
                          </button>
                        )}
                        <button type="button" className="btn-pill px-2.5 py-1 text-[12px] inline-flex items-center gap-1" disabled={busy} onClick={() => startEdit(p, r)} title={t`Choose one or several axes`}>
                          <Pencil className="w-3.5 h-3.5" /> <Trans>Correct</Trans>
                        </button>
                        {r?.decision !== 'rejected' && (
                          <button type="button" className="btn-pill px-2.5 py-1 text-[12px] inline-flex items-center gap-1" disabled={busy} onClick={() => decide(p, 'rejected')} title={t`Theoretical or methodological work: stays unclassified`}>
                            <XCircle className="w-3.5 h-3.5" /> <Trans>Outside the axes</Trans>
                          </button>
                        )}
                        {r?.decision !== 'unsure' && (
                          <button type="button" className="btn-pill px-2.5 py-1 text-[12px] inline-flex items-center gap-1" disabled={busy} onClick={() => decide(p, 'unsure')} title={t`To be decided by someone else`}>
                            <CircleHelp className="w-3.5 h-3.5" /> <Trans>Unsure</Trans>
                          </button>
                        )}
                        {r && (
                          <button type="button" className="btn-pill px-2.5 py-1 text-[12px] inline-flex items-center gap-1" disabled={busy} onClick={() => act(p, () => reviews.remove(p))} title={t`Remove the decision`}>
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-light dark:text-[#8f897c]"><Trans>No publication matches these filters.</Trans></td></tr>
            )}
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
  );
};
