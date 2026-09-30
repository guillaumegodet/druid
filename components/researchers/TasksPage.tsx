import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCw, Plus, ExternalLink, User, ChevronDown, ChevronRight, MessageSquare, AlertTriangle, Mail, Copy, Check, Radar, GitMerge } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import {
  TASK_TYPES, TASK_BASES, CANAL_LABELS, STATUS_LABELS, PRIORITY_LABELS, EVENT_ACTION_LABELS, TASK_STATUSES,
  isTaskType, isOpenStatus, nextStatuses, mergePairsOf, TasksApi,
  type Task, type TaskEvent, type TaskStatus, type TaskCanal, type TaskBase, type TaskEventAction,
} from '../../lib/tasks';
import type { TasksState } from '../../hooks/useTasks';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import { translateApiError } from '../../lib/apiErrors';
import { buildTaskEmail, hasTaskEmail, mailtoUrl } from '../../lib/taskEmailTemplates';
import { copyToClipboard } from '../../lib/clipboard';
import { getUserInfo } from '../../lib/auth';
import { StatCard, PixelBtn } from './alignAtoms';

interface Props {
  state: TasksState;
  researchers: Researcher[];
  /** Current Keycloak username (« mine » filter). */
  me: string;
  onNewTask: () => void;
  /** Opens the Druid record of the task's researcher (Grist row id, then uid fallback). */
  onOpenResearcher: (task: Task) => void;
  /** Opens the merge assistant on two Annuaire rows (« shared identifiers » tasks). */
  onMerge?: (rowIds: [number, number]) => void;
}

type StatusFilter = 'open' | 'all' | TaskStatus;

const STATUS_TONE: Record<TaskStatus, string> = {
  a_faire: 'bg-[rgba(231,111,154,.2)] text-[#b23b3b] dark:text-[#f08c8c]',
  en_cours: 'bg-[rgba(224,158,42,.25)] text-[#9a6a12] dark:text-[#f0c266]',
  en_attente: 'bg-white/70 dark:bg-white/10 text-ink dark:text-[#f5f2ea] border border-ink/10 dark:border-white/10',
  fait: 'bg-[rgba(31,122,77,.15)] text-[#1f7a4d] dark:text-[#5fd39a]',
  abandonnee: 'bg-ink/5 dark:bg-white/5 text-muted dark:text-[#8f897c]',
  resolue_auto: 'bg-[rgba(31,122,77,.15)] text-[#1f7a4d] dark:text-[#5fd39a]',
};

const fmtDate = (iso: string): string => (iso ? new Date(iso).toLocaleString(numberLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '');

/** « À traiter › Tâches » tab (docs/plan-chantiers-taches.md, lot 2): filters, table, inline detail
 * with the event log and the workflow actions. Statuses come from lib/tasks (same table as the
 * server: a forbidden transition is refused there too). */
export const TasksPage: React.FC<Props> = ({ state, researchers, me, onNewTask, onOpenResearcher, onMerge }) => {
  const { t, i18n } = useLingui();
  const { tasks, loading, error, reload, transition, patch } = state;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [baseFilter, setBaseFilter] = useState<'' | TaskBase>('');
  const [canalFilter, setCanalFilter] = useState<'' | TaskCanal>('');
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  // Detection rules run (lot 5): trigger + polling, then reload of the list.
  const [detect, setDetect] = useState<{ running: boolean; created?: number; resolved?: number; reopened?: number; verified?: number; error?: string } | null>(null);
  const [detectError, setDetectError] = useState('');
  const runDetection = async () => {
    setDetectError('');
    setDetect({ running: true });
    try {
      const trig = await fetch('/api/tasks/detect/trigger');
      if (!trig.ok && trig.status !== 409) {
        const d = await trig.json().catch(() => ({}));
        throw new Error(translateApiError(String(d.error || '')) || t`Detection trigger failed: ${trig.status}`);
      }
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const pr = await fetch('/api/tasks/detect/progress', { cache: 'no-store' });
        const p = await pr.json().catch(() => ({ running: false }));
        setDetect(p);
        if (p.error) throw new Error(translateApiError(String(p.error)));
        if (!p.running) break;
      }
      await reload();
    } catch (e) {
      setDetect((prev) => (prev ? { ...prev, running: false } : prev));
      setDetectError(apiErrorText(e) || t`Error during the detection`);
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tasks ?? [])
      .filter((x) => (statusFilter === 'all' ? true : statusFilter === 'open' ? isOpenStatus(x.statut) : x.statut === statusFilter))
      .filter((x) => !baseFilter || x.base === baseFilter)
      .filter((x) => !canalFilter || x.canal === canalFilter)
      .filter((x) => !mine || x.assignee === me || x.pris_par === me)
      .filter((x) => !q || `${x.titre} ${x.nom} ${x.labo} ${x.description} ${x.uid_dyna}`.toLowerCase().includes(q))
      .sort((a, b) => (isOpenStatus(a.statut) === isOpenStatus(b.statut) ? String(b.cree_le).localeCompare(String(a.cree_le)) : isOpenStatus(a.statut) ? -1 : 1));
  }, [tasks, statusFilter, baseFilter, canalFilter, mine, me, query]);

  /** Directory record of a task (Grist row id first, uid_dyna fallback) — email, identifiers. */
  const resolveResearcher = (x: Task): Researcher | undefined =>
    (x.chercheur ? researchers.find((r) => r.gristRowId === x.chercheur) : undefined)
    || (x.uid_dyna ? researchers.find((r) => r.uid === x.uid_dyna) : undefined);
  const rowIdOfUid = (uid: string): number | undefined => researchers.find((r) => r.uid === uid)?.gristRowId;

  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = { a_faire: 0, en_cours: 0, en_attente: 0, fait: 0, abandonnee: 0, resolue_auto: 0 };
    for (const x of tasks ?? []) c[x.statut] = (c[x.statut] || 0) + 1;
    return c;
  }, [tasks]);

  const selectCls = 'input-soft !h-9 !py-1 text-[13px] w-auto';
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 md:px-7 pt-2 pb-3 flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={selectCls}>
          <option value="open">{t`Open`}</option>
          <option value="all">{t`All statuses`}</option>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{i18n._(STATUS_LABELS[s])}</option>)}
        </select>
        <select value={baseFilter} onChange={(e) => setBaseFilter(e.target.value as '' | TaskBase)} className={selectCls}>
          <option value="">{t`All bases`}</option>
          {TASK_BASES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={canalFilter} onChange={(e) => setCanalFilter(e.target.value as '' | TaskCanal)} className={selectCls}>
          <option value="">{t`All channels`}</option>
          {(Object.keys(CANAL_LABELS) as TaskCanal[]).map((c) => <option key={c} value={c}>{i18n._(CANAL_LABELS[c])}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> <Trans>Mine</Trans>
        </label>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t`Search (title, name, lab…)`} className="input-soft !h-9 !py-1 text-[13px] w-56" />
        <div className="flex-1" />
        <PixelBtn onClick={reload} disabled={loading} title={t`Re-reads the Grist table`}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} <Trans>Refresh</Trans>
        </PixelBtn>
        <PixelBtn onClick={runDetection} disabled={!!detect?.running} title={t`Runs the detection rules (two ORCID / IdHAL / Scopus profiles, LDAP departures with an open IdRef affiliation) from the alignment caches; situations gone since the last run are closed automatically`}>
          {detect?.running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
          {detect?.running ? t`Detecting…` : t`Run detection`}
        </PixelBtn>
        <PixelBtn onClick={onNewTask} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong">
          <Plus className="w-4 h-4" /> <Trans>New task</Trans>
        </PixelBtn>
      </div>
      {(detectError || (detect && !detect.running && !detect.error)) && (
        <p className={`px-4 md:px-7 pb-2 text-[12px] font-semibold ${detectError ? 'text-[#b23b3b] dark:text-[#f08c8c]' : 'text-muted dark:text-[#8f897c]'}`}>
          {detectError || t`Detection done: ${detect?.created ?? 0} created, ${detect?.verified ?? 0} verified, ${detect?.resolved ?? 0} resolved automatically, ${detect?.reopened ?? 0} reopened`}
        </p>
      )}

      <div className="flex-1 overflow-auto px-4 md:px-7 pb-6 space-y-4" data-page-scroll>
        {error && <p className="text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
        {!tasks ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-faint gap-3">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p className="text-[13px] font-semibold text-muted dark:text-[#8f897c]">{t`Loading the tasks…`}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label={i18n._(STATUS_LABELS.a_faire)} value={counts.a_faire} tone="bg-[rgba(231,111,154,.15)] dark:bg-[rgba(231,111,154,.12)]" />
              <StatCard label={i18n._(STATUS_LABELS.en_cours)} value={counts.en_cours} tone="bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.12)]" />
              <StatCard label={i18n._(STATUS_LABELS.en_attente)} value={counts.en_attente} />
              <StatCard label={t`Closed`} value={counts.fait + counts.abandonnee + counts.resolue_auto} tone="bg-[rgba(31,122,77,.12)] dark:bg-[rgba(31,122,77,.1)]" />
            </div>

            {rows.length === 0 ? (
              <p className="text-[13px] text-muted dark:text-[#8f897c] py-8 text-center"><Trans>No task matches these filters.</Trans></p>
            ) : (
              <div className="rounded-2xl border border-ink/10 dark:border-white/10 overflow-hidden bg-white/40 dark:bg-white/[.04]">
                <table className="w-full text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-lighter dark:text-[#8f897c] bg-white/60 dark:bg-white/5">
                    <tr>
                      <th className="text-left px-3 py-2 w-6" />
                      <th className="text-left px-3 py-2"><Trans>Task</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Researcher</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Base</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Channel</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Status</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Assigned</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Created</Trans></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
                      <React.Fragment key={x.id}>
                        <tr onClick={() => setOpenId(openId === x.id ? null : x.id)} className="border-t border-ink/5 dark:border-white/5 cursor-pointer hover:bg-white/60 dark:hover:bg-white/5">
                          <td className="px-3 py-2 text-muted-light">{openId === x.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-ink dark:text-[#f5f2ea]">{x.titre}</div>
                            <div className="text-[11px] text-muted-light dark:text-[#8f897c]">
                              {isTaskType(x.type) ? i18n._(TASK_TYPES[x.type].label) : x.type}
                              {x.priorite === 'haute' && <span className="ml-2 font-bold text-[#b23b3b] dark:text-[#f08c8c]">{i18n._(PRIORITY_LABELS.haute)}</span>}
                              {x.origine.startsWith('regle:') && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-accent/20 text-ink dark:text-[#f5f2ea] font-bold" title={t`Generated by a detection rule — closed automatically when the situation disappears`}><Trans>auto</Trans></span>}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {x.chercheur || x.uid_dyna ? (
                              <button type="button" onClick={(e) => { e.stopPropagation(); onOpenResearcher(x); }} className="inline-flex items-center gap-1 font-semibold text-ink dark:text-[#f5f2ea] hover:underline">
                                <User className="w-3.5 h-3.5" /> {x.nom || x.uid_dyna}
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#9a6a12] dark:text-[#f0c266]" title={t`No Directory record linked: link it from the Grist table`}>
                                <AlertTriangle className="w-3.5 h-3.5" /> <Trans>To complete</Trans>
                              </span>
                            )}
                            {x.labo && <div className="text-[11px] text-muted-light dark:text-[#8f897c]">{x.labo}</div>}
                          </td>
                          <td className="px-3 py-2">{x.base}</td>
                          <td className="px-3 py-2 text-muted dark:text-[#8f897c]">{x.canal in CANAL_LABELS ? i18n._(CANAL_LABELS[x.canal as TaskCanal]) : x.canal}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_TONE[x.statut]}`}>{i18n._(STATUS_LABELS[x.statut])}</span></td>
                          <td className="px-3 py-2 text-muted dark:text-[#8f897c]">{x.assignee || x.pris_par || '—'}</td>
                          <td className="px-3 py-2 text-muted dark:text-[#8f897c] whitespace-nowrap">{fmtDate(x.cree_le)}</td>
                        </tr>
                        {openId === x.id && (
                          <tr className="border-t border-ink/5 dark:border-white/5 bg-white/50 dark:bg-white/[.03]">
                            <td colSpan={8} className="px-4 py-4">
                              <TaskDetail task={x} me={me} researcher={resolveResearcher(x)} onTransition={transition} onPatch={patch} onOpenResearcher={onOpenResearcher}
                                mergePairs={onMerge ? mergePairsOf(x, rowIdOfUid) : []} onMerge={onMerge} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {researchers.length === 0 && <p className="text-[11px] text-muted-light dark:text-[#8f897c]"><Trans>Directory not loaded yet: researcher links open once the list is available.</Trans></p>}
          </>
        )}
      </div>
    </div>
  );
};

// ── Detail panel ─────────────────────────────────────────────────────────────
type PendingAction = { statut: TaskStatus; withText: boolean } | null;

const TaskDetail: React.FC<{
  task: Task;
  me: string;
  researcher?: Researcher;
  onTransition: TasksState['transition'];
  onPatch: TasksState['patch'];
  onOpenResearcher: (task: Task) => void;
  /** Record pairs of a « shared identifiers » task the merge assistant can open. */
  mergePairs: { uids: [string, string]; rowIds: [number, number] }[];
  onMerge?: (rowIds: [number, number]) => void;
}> = ({ task, me, researcher, onTransition, onPatch, onOpenResearcher, mergePairs, onMerge }) => {
  const { t, i18n } = useLingui();
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [text, setText] = useState('');
  const [comment, setComment] = useState('');
  const [assignee, setAssignee] = useState(task.assignee);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadEvents = () => TasksApi.events(task.id).then(setEvents).catch((e) => setError(apiErrorText(e)));
  useEffect(() => { loadEvents(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [task.id, task.statut, task.assignee]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try { await fn(); setPending(null); setText(''); }
    catch (e) { setError(apiErrorText(e) || t`Action failed`); }
    finally { setBusy(false); }
  };
  const actionLabel = (s: TaskStatus): string => {
    if (s === 'en_cours') return task.statut === 'a_faire' ? t`Take over` : t`Resume`;
    if (s === 'en_attente') return t`Put on hold`;
    if (s === 'fait') return t`Mark as done`;
    if (s === 'abandonnee') return t`Drop`;
    if (s === 'a_faire') return isOpenStatus(task.statut) ? t`Back to “to do”` : t`Reopen`;
    return i18n._(STATUS_LABELS[s]);
  };
  const needsText = (s: TaskStatus) => s === 'en_attente' || s === 'fait' || s === 'abandonnee';
  const confirmPending = () => {
    if (!pending) return;
    const extra = pending.statut === 'en_attente' ? { motif: text.trim() } : { resolution: text.trim() };
    run(() => onTransition(task.id, pending.statut, extra));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 text-[13px]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted dark:text-[#8f897c]">
          <span><Trans>Created by</Trans> <b className="text-ink dark:text-[#f5f2ea]">{task.cree_par}</b> · {fmtDate(task.cree_le)}</span>
          {task.pris_par && <span><Trans>Taken over by</Trans> <b className="text-ink dark:text-[#f5f2ea]">{task.pris_par}</b> · {fmtDate(task.pris_le)}</span>}
          {task.fait_par && <span><Trans>Closed by</Trans> <b className="text-ink dark:text-[#f5f2ea]">{task.fait_par}</b> · {fmtDate(task.fait_le)}</span>}
          {task.origine && task.origine !== 'manuel' && <span className="italic">{task.origine}</span>}
          {task.verifie_le && <span><Trans>Verified</Trans> {fmtDate(task.verifie_le)}</span>}
        </div>
        {task.description && <p className="whitespace-pre-wrap text-ink dark:text-[#f5f2ea]">{task.description}</p>}
        {task.statut === 'en_attente' && task.attente_motif && <p><Trans>Waiting for:</Trans> <i>{task.attente_motif}</i></p>}
        {task.resolution && <p><Trans>Resolution:</Trans> <i>{task.resolution}</i></p>}
        <div className="flex flex-wrap items-center gap-2">
          {task.lien && (
            <a href={task.lien} target="_blank" rel="noopener noreferrer" className="btn-pill h-8 text-[12px]"><ExternalLink className="w-3.5 h-3.5" /> <Trans>Open the link</Trans></a>
          )}
          {(task.chercheur || task.uid_dyna) && (
            <button type="button" onClick={() => onOpenResearcher(task)} className="btn-pill h-8 text-[12px]"><User className="w-3.5 h-3.5" /> <Trans>Open the record</Trans></button>
          )}
          {onMerge && mergePairs.map((p) => (
            <button key={p.uids.join('+')} type="button" onClick={() => onMerge(p.rowIds)} className="btn-pill h-8 text-[12px]"
              title={t`The task closes itself at the next detection, once the records are merged`}>
              <GitMerge className="w-3.5 h-3.5" /> {mergePairs.length > 1 ? t`Merge ${p.uids[0]} + ${p.uids[1]}` : t`Open the merge assistant`}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-ink/5 dark:border-white/5">
          {nextStatuses(task.statut).map((s) => (
            <PixelBtn key={s} disabled={busy} onClick={() => (needsText(s) ? setPending({ statut: s, withText: true }) : run(() => onTransition(task.id, s)))}
              tone={s === 'fait' ? 'bg-[#1f7a4d] text-white hover:bg-[#186540]' : s === 'en_cours' ? 'bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong' : undefined}>
              {actionLabel(s)}
            </PixelBtn>
          ))}
        </div>
        {pending && (
          <div className="flex flex-col gap-2 rounded-2xl border border-ink/10 dark:border-white/10 p-3 bg-white/60 dark:bg-white/5">
            <label className="text-[12px] text-muted dark:text-[#8f897c]">
              {pending.statut === 'en_attente' ? t`Waiting for what? (researcher's answer, ABES batch, external support…)` : t`Resolution (optional)`}
            </label>
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} className="input-soft" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') confirmPending(); }} />
            <div className="flex gap-2 justify-end">
              <button className="btn-pill h-8 text-[12px]" onClick={() => setPending(null)} disabled={busy}><Trans>Cancel</Trans></button>
              <button className="btn-pill-dark h-8 text-[12px]" onClick={confirmPending} disabled={busy || (pending.statut === 'en_attente' && !text.trim())}>{actionLabel(pending.statut)}</button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder={t`Assign to (username)`} className="input-soft !h-8 !py-1 text-[12px] w-48" />
          <button className="btn-pill h-8 text-[12px]" disabled={busy || assignee.trim() === (task.assignee || '')} onClick={() => run(() => onPatch(task.id, { assignee: assignee.trim() }))}><Trans>Reassign</Trans></button>
          {me && assignee.trim() !== me && <button className="btn-pill h-8 text-[12px]" disabled={busy} onClick={() => { setAssignee(me); run(() => onPatch(task.id, { assignee: me })); }}><Trans>Assign to me</Trans></button>}
        </div>
        {hasTaskEmail(task.type) && (
          <TaskEmailPanel task={task} researcher={researcher} busy={busy} onSent={(subject) => run(async () => {
            await TasksApi.addEvent(task.id, 'email_prepare', subject);
            // The email leaves the task waiting for the researcher's answer (lot 3): the
            // transition also refreshes the row (and thus the log) through the parent state.
            if (task.statut === 'a_faire' || task.statut === 'en_cours') await onTransition(task.id, 'en_attente', { motif: t`Email sent to the researcher` });
            else await loadEvents();
          })} />
        )}
        {error && <p className="font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-muted-lighter dark:text-[#8f897c]"><MessageSquare className="w-4 h-4" /><h4 className="font-disp font-bold text-ink dark:text-[#f5f2ea]"><Trans>History</Trans></h4></div>
        {!events ? (
          <p className="text-[12px] text-muted-light dark:text-[#8f897c]">{t`Loading…`}</p>
        ) : (
          <ul className="space-y-1.5 max-h-64 overflow-auto pr-1">
            {events.map((ev) => (
              <li key={ev.id} className="text-[12px]">
                <span className="text-muted-light dark:text-[#8f897c]">{fmtDate(ev.date)}</span> · <b className="text-ink dark:text-[#f5f2ea]">{ev.auteur}</b> · {ev.action in EVENT_ACTION_LABELS ? i18n._(EVENT_ACTION_LABELS[ev.action as TaskEventAction]) : ev.action}
                {ev.detail && <div className="text-muted dark:text-[#8f897c] whitespace-pre-wrap pl-2 border-l border-ink/10 dark:border-white/10 ml-1">{ev.detail}</div>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t`Add a comment…`} className="input-soft !h-8 !py-1 text-[12px] flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) run(async () => { await TasksApi.addEvent(task.id, 'commentaire', comment.trim()); setComment(''); await loadEvents(); }); }} />
          <button className="btn-pill h-8 text-[12px]" disabled={busy || !comment.trim()} onClick={() => run(async () => { await TasksApi.addEvent(task.id, 'commentaire', comment.trim()); setComment(''); await loadEvents(); })}><Trans>Send</Trans></button>
        </div>
      </div>
    </div>
  );
};

// ── Ready-to-copy email (lot 3) ─────────────────────────────────────────────
/** Draft generated from the type + the Directory record, editable before copy / mailto:. Druid
 * sends nothing: once copied or opened in the mail client, « Mark as sent » records the
 * `email_prepare` event and puts the task on hold (same caution as the newsletter: the mailto:
 * click alone proves nothing, the user confirms). */
const TaskEmailPanel: React.FC<{ task: Task; researcher?: Researcher; busy: boolean; onSent: (subject: string) => void }> = ({ task, researcher, busy, onSent }) => {
  const { t } = useLingui();
  const draft = useMemo(() => buildTaskEmail(task.type, {
    civility: researcher?.civility,
    firstName: researcher?.firstName || '',
    lastName: researcher?.lastName || task.nom,
    labo: task.labo || researcher?.affiliations[0]?.structureName,
    orcid: researcher?.identifiers.orcid,
    halId: researcher?.identifiers.halId,
    scopusId: researcher?.identifiers.scopusId,
    description: task.description,
    senderName: getUserInfo().name,
  }), [task.id, task.type, task.description, task.nom, task.labo, researcher]); // eslint-disable-line react-hooks/exhaustive-deps
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<'copied' | 'opened' | null>(null);
  const to = researcher?.email || '';
  if (!draft) return null;
  const email = { subject, body };
  const copy = async () => {
    const ok = await copyToClipboard(`${t`Subject:`} ${subject}\n\n${body}`);
    if (ok) setPrepared('copied');
  };
  return (
    <div className="rounded-2xl border border-ink/10 dark:border-white/10 bg-white/60 dark:bg-white/5">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-left font-semibold text-ink dark:text-[#f5f2ea]">
        <Mail className="w-4 h-4" /> <Trans>Email to the researcher</Trans>
        {to ? <span className="text-[12px] font-normal text-muted dark:text-[#8f897c]">— {to}</span> : <span className="text-[11px] font-bold text-[#9a6a12] dark:text-[#f0c266]"><Trans>no email in the Directory</Trans></span>}
        <span className="flex-1" />
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="input-soft !h-8 !py-1 text-[12px]" aria-label={t`Subject`} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="input-soft text-[12px] font-mono leading-snug" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={copy} className="btn-pill h-8 text-[12px]" disabled={busy}>
              {prepared === 'copied' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} <Trans>Copy the email</Trans>
            </button>
            {to && (
              <a href={mailtoUrl(to, email)} onClick={() => setPrepared('opened')} className="btn-pill h-8 text-[12px]">
                <ExternalLink className="w-3.5 h-3.5" /> <Trans>Open in the mail client</Trans>
              </a>
            )}
            {prepared && (
              <button type="button" onClick={() => { onSent(subject); setPrepared(null); }} className="btn-pill-dark h-8 text-[12px]" disabled={busy}>
                <Trans>Mark as sent (task on hold)</Trans>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
