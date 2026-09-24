import React, { useMemo, useState } from 'react';
import { ClipboardList, X, RefreshCw } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import {
  TASK_TYPES, TASK_TYPE_IDS, CANAL_LABELS, PRIORITY_LABELS, isTaskType,
  type TaskCanal, type TaskCreateInput, type TaskPriority, type TaskType,
} from '../../lib/tasks';
import { apiErrorText } from '../../lib/apiErrors';

interface Props {
  researchers: Researcher[];
  /** Prefilled researcher (« Report a correction » from the record). */
  initialResearcher?: Researcher | null;
  onClose: () => void;
  onSubmit: (input: TaskCreateInput) => Promise<unknown>;
}

const MAX_SUGGESTIONS = 8;

/** Modal « New task » (docs/plan-chantiers-taches.md, lot 2): the type prefills the base and
 * the channel; the researcher is picked from the loaded Directory (Grist row id + uid + lab
 * copied on the task, never a formula on the name as the legacy table did). */
export const TaskForm: React.FC<Props> = ({ researchers, initialResearcher = null, onClose, onSubmit }) => {
  const { t, i18n } = useLingui();
  const [type, setType] = useState<TaskType>('idref_ajouter_orcid');
  const [canal, setCanal] = useState<TaskCanal>(TASK_TYPES.idref_ajouter_orcid.canal);
  const [priorite, setPriorite] = useState<TaskPriority>('normale');
  const [researcher, setResearcher] = useState<Researcher | null>(initialResearcher);
  const [query, setQuery] = useState(initialResearcher?.displayName ?? '');
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [lien, setLien] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || (researcher && researcher.displayName === query)) return [];
    return researchers
      .filter((r) => r.displayName.toLowerCase().includes(q) || (r.uid && r.uid.toLowerCase().includes(q)))
      .slice(0, MAX_SUGGESTIONS);
  }, [query, researchers, researcher]);

  const changeType = (v: string) => {
    if (!isTaskType(v)) return;
    setType(v);
    setCanal(TASK_TYPES[v].canal);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        type,
        canal,
        priorite,
        titre: titre.trim() || undefined,
        description: description.trim(),
        lien: lien.trim(),
        assignee: assignee.trim(),
        chercheurRowId: researcher?.gristRowId,
        uid_dyna: researcher?.uid || '',
        nom: researcher ? `${researcher.lastName.toUpperCase()} ${researcher.firstName}`.trim() : '',
        labo: researcher?.affiliations[0]?.structureName || '',
      });
      onClose();
    } catch (e) {
      setError(apiErrorText(e) || t`Error creating the task`);
    } finally {
      setBusy(false);
    }
  };

  const labelCls = 'block text-xs text-muted-lighter dark:text-[#8f897c] mb-1';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-5 h-5 text-ink dark:text-accent" />
            <div>
              <h2 className="font-disp text-lg font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>New task</Trans></h2>
              <p className="text-[12px] text-muted-light dark:text-[#8f897c]"><Trans>Something to do outside Druid (IdRef, ORCID, HAL, OpenAlex, Scopus, HR)</Trans></p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-ink/5 dark:hover:bg-white/10 text-muted dark:text-[#8f897c]"><X className="w-5 h-5" /></button>
        </header>

        <div className="px-6 py-5 space-y-4 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelCls}><Trans>Type</Trans></label>
              <select value={type} onChange={(e) => changeType(e.target.value)} className="input-soft">
                {TASK_TYPE_IDS.map((id) => <option key={id} value={id}>{i18n._(TASK_TYPES[id].label)}</option>)}
              </select>
            </div>
            <div className="md:col-span-2 relative">
              <label className={labelCls}><Trans>Researcher</Trans></label>
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setResearcher(null); }}
                className="input-soft"
                placeholder={t`Name or uid in the Directory…`}
                autoFocus={!initialResearcher}
              />
              {suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 z-10 mt-1 rounded-2xl bg-cream-100 dark:bg-[#201e1a] border border-white/60 dark:border-white/10 shadow-soft-lg overflow-hidden">
                  {suggestions.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => { setResearcher(r); setQuery(r.displayName); }}
                        className="w-full text-left px-3.5 py-2 text-[13px] hover:bg-accent/10 text-ink dark:text-[#f5f2ea] flex justify-between gap-3"
                      >
                        <span className="font-semibold">{r.displayName}</span>
                        <span className="text-muted-light dark:text-[#8f897c] truncate">{r.affiliations[0]?.structureName || ''}{r.uid ? ` · ${r.uid}` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!researcher && query.trim() && suggestions.length === 0 && (
                <p className="mt-1 text-[11px] text-muted-light dark:text-[#8f897c]"><Trans>No record selected — the task will be created without a researcher link (badge « to complete »).</Trans></p>
              )}
            </div>
            <div>
              <label className={labelCls}><Trans>Channel</Trans></label>
              <select value={canal} onChange={(e) => setCanal(e.target.value as TaskCanal)} className="input-soft">
                {(Object.keys(CANAL_LABELS) as TaskCanal[]).map((c) => <option key={c} value={c}>{i18n._(CANAL_LABELS[c])}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}><Trans>Priority</Trans></label>
              <select value={priorite} onChange={(e) => setPriorite(e.target.value as TaskPriority)} className="input-soft">
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => <option key={p} value={p}>{i18n._(PRIORITY_LABELS[p])}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}><Trans>Title (optional — generated from the type and the name)</Trans></label>
              <input type="text" value={titre} onChange={(e) => setTitre(e.target.value)} className="input-soft" />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}><Trans>Description</Trans></label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input-soft" placeholder={t`What has to be done, and any useful detail (second identifier, date…)`} />
            </div>
            <div>
              <label className={labelCls}><Trans>Link (record / profile)</Trans></label>
              <input type="url" value={lien} onChange={(e) => setLien(e.target.value)} className="input-soft" placeholder="https://" />
            </div>
            <div>
              <label className={labelCls}><Trans>Assigned to (username)</Trans></label>
              <input type="text" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input-soft" />
            </div>
          </div>
          {error && <p className="text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-ink/5 dark:border-white/5 flex justify-end gap-2.5">
          <button onClick={onClose} className="btn-pill h-10" disabled={busy}><Trans>Cancel</Trans></button>
          <button onClick={submit} className="btn-pill-dark h-10 disabled:opacity-50" disabled={busy}>
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : null} <Trans>Create the task</Trans>
          </button>
        </div>
      </div>
    </div>
  );
};
