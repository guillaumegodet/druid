import React, { useEffect, useMemo, useState } from 'react';
import { X, CalendarCheck, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import { TASK_TYPES, isTaskType, type Task } from '../../lib/tasks';
import type { TasksState } from '../../hooks/useTasks';
import { AffiliationHistoryApi, affiliationHistoryKey, suggestedEndDate } from '../../lib/affiliationHistory';
import { GristService } from '../../lib/gristService';
import { apiErrorText } from '../../lib/apiErrors';

/** Career-path entries read at once (one request per record). */
const CONCURRENCY = 4;

type RowState =
  | { kind: 'loading' }
  | { kind: 'ready'; researcher: Researcher; date: string }
  | { kind: 'skip'; reason: string };
type Outcome = { kind: 'done' } | { kind: 'error'; message: string };

interface Props {
  /** Open departure tasks of the batch types (lib/tasks.ts BATCH_DEPARTURE_TYPES). */
  tasks: Task[];
  /** Directory record of a task (TasksPage resolveResearcher). */
  resolveResearcher: (task: Task) => Researcher | undefined;
  onTransition: TasksState['transition'];
  onClose: () => void;
  /** After at least one record was written: reload of the directory. */
  onWritten: () => void;
}

/**
 * « Report the departures in batch » (Tasks tab of the to-do page): for each departure task, the employment end the career
 * path suggests (lib/affiliationHistory.ts suggestedEndDate, the same date as the « Report … as end of employment »
 * button of the record), to review and tick. Applying saves each record like the form does (GristService
 * updateResearcher: same write, same provenance « manual », same audit) and closes its task as done.
 * Departures confirmed by several sources are ticked by default; those declared in ORCID only are left to tick.
 */
export const BulkDepartureModal: React.FC<Props> = ({ tasks, resolveResearcher, onTransition, onClose, onWritten }) => {
  const { t, i18n } = useLingui();
  const [rows, setRows] = useState<Record<number, RowState>>(() => Object.fromEntries(tasks.map((x) => [x.id, { kind: 'loading' }])));
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const queue = [...tasks];
    const load = async (task: Task): Promise<RowState> => {
      const researcher = resolveResearcher(task);
      if (!researcher) return { kind: 'skip', reason: t`Record not found in the loaded directory` };
      if (researcher.employment?.endDate) return { kind: 'skip', reason: t`End of employment already entered (${researcher.employment.endDate})` };
      if (researcher.employment?.ldapFields?.includes('endDate')) return { kind: 'skip', reason: t`End of employment set by the LDAP` };
      const key = affiliationHistoryKey(researcher);
      if (!key) return { kind: 'skip', reason: t`Record without key` };
      try {
        const { entry } = await AffiliationHistoryApi.get(key);
        const date = suggestedEndDate(entry.signals, researcher.employment?.endDate);
        return date ? { kind: 'ready', researcher, date } : { kind: 'skip', reason: t`No end date proposed by the career path` };
      } catch (e) {
        return { kind: 'skip', reason: apiErrorText(e) || t`Career path unavailable` };
      }
    };
    const worker = async () => {
      for (let task = queue.shift(); task && !cancelled; task = queue.shift()) {
        const state = await load(task);
        if (cancelled) return;
        setRows((r) => ({ ...r, [task.id]: state }));
        if (state.kind === 'ready' && task.type === 'parcours_depart_confirme') setChecked((c) => new Set(c).add(task.id));
      }
    };
    void Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaded once for the tasks the modal was opened with
  }, []);

  const loading = useMemo(() => Object.values(rows).some((r) => r.kind === 'loading'), [rows]);
  const ready = tasks.filter((x) => rows[x.id]?.kind === 'ready' && !outcomes[x.id]);
  const toApply = ready.filter((x) => checked.has(x.id));
  const toggle = (id: number) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = ready.length > 0 && ready.every((x) => checked.has(x.id));

  const apply = async () => {
    setApplying(true);
    let written = 0;
    for (const task of toApply) {
      const row = rows[task.id];
      if (row.kind !== 'ready') continue;
      try {
        await GristService.updateResearcher({ ...row.researcher, employment: { ...row.researcher.employment, endDate: row.date } });
        written++;
        await onTransition(task.id, 'fait', { resolution: t`End of employment ${row.date} reported in batch from the career path` });
        setOutcomes((o) => ({ ...o, [task.id]: { kind: 'done' } }));
      } catch (e) {
        setOutcomes((o) => ({ ...o, [task.id]: { kind: 'error', message: apiErrorText(e) || t`Error while saving` } }));
      }
    }
    setApplying(false);
    if (written) onWritten();
  };

  const doneCount = Object.values(outcomes).filter((o) => o.kind === 'done').length;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <CalendarCheck className="w-5 h-5 text-ink dark:text-accent" />
            <div>
              <h2 className="font-disp text-lg font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>Report the departures in batch</Trans></h2>
              <p className="text-[12px] text-muted-light dark:text-[#8f897c]"><Trans>End of employment proposed by the career path of each record (same date as the button of the record). Each ticked record is saved like the form does, and its task is closed as done.</Trans></p>
            </div>
          </div>
          <button onClick={onClose} disabled={applying} className="p-2 rounded-full hover:bg-ink/5 dark:hover:bg-white/10 text-muted dark:text-[#8f897c]" aria-label={t`Close`}><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-muted-lighter dark:text-[#8f897c]">
              <tr>
                <th className="text-left px-2 py-2 w-8">
                  <input type="checkbox" checked={allChecked} disabled={applying || !ready.length} aria-label={t`Tick all`}
                    onChange={() => setChecked(allChecked ? new Set() : new Set(ready.map((x) => x.id)))} />
                </th>
                <th className="text-left px-2 py-2"><Trans>Researcher</Trans></th>
                <th className="text-left px-2 py-2"><Trans>Signal</Trans></th>
                <th className="text-left px-2 py-2"><Trans>Proposed end</Trans></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((x) => {
                const row = rows[x.id];
                const out = outcomes[x.id];
                return (
                  <tr key={x.id} className="border-t border-ink/5 dark:border-white/5 align-top">
                    <td className="px-2 py-2">
                      {row?.kind === 'ready' && !out && <input type="checkbox" checked={checked.has(x.id)} disabled={applying} onChange={() => toggle(x.id)} aria-label={x.nom} />}
                    </td>
                    <td className="px-2 py-2">
                      <div className="font-semibold text-ink dark:text-[#f5f2ea]">{x.nom || x.uid_dyna}</div>
                      <div className="text-[11px] text-muted-light dark:text-[#8f897c]">{x.labo}{x.labo ? ' · ' : ''}{isTaskType(x.type) ? i18n._(TASK_TYPES[x.type].label) : x.type}</div>
                    </td>
                    <td className="px-2 py-2 text-[12px] text-muted dark:text-[#c3beb0] max-w-md">{x.description.split('\n')[0]}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {row?.kind === 'loading' && <RefreshCw className="w-4 h-4 animate-spin text-muted-faint" />}
                      {row?.kind === 'skip' && <span className="text-[12px] text-muted-light dark:text-[#8f897c]">{row.reason}</span>}
                      {row?.kind === 'ready' && <span className="font-semibold text-ink dark:text-[#f5f2ea]">{row.date}</span>}
                      {out?.kind === 'done' && <span className="ml-2 inline-flex items-center gap-1 text-[12px] font-bold text-[#1f7a4d] dark:text-[#5fd39a]"><Check className="w-3.5 h-3.5" /><Trans>reported</Trans></span>}
                      {out?.kind === 'error' && <span className="ml-2 inline-flex items-center gap-1 text-[12px] font-bold text-[#b23b3b] dark:text-[#f08c8c]"><AlertTriangle className="w-3.5 h-3.5" />{out.message}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="px-6 py-4 border-t border-ink/5 dark:border-white/5 bg-white/50 dark:bg-white/[.03] flex items-center justify-between gap-3">
          <span className="text-[12px] text-muted-faint">
            {loading ? t`Reading the career paths…` : doneCount
              ? <Plural value={doneCount} one="# record updated, its task closed." other="# records updated, their tasks closed." />
              : <Plural value={ready.length} one="# record with a proposed date." other="# records with a proposed date." />}
          </span>
          <div className="flex items-center gap-3">
            <button onClick={onClose} disabled={applying} className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full font-disp font-semibold text-[13px] bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 shadow-soft transition-colors disabled:opacity-50">
              {doneCount ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}
            </button>
            <button onClick={apply} disabled={applying || !toApply.length}
              className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full font-disp font-semibold text-[13px] bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong shadow-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
              {applying ? t`Reporting…` : <Plural value={toApply.length} one="Report # end date" other="Report # end dates" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
