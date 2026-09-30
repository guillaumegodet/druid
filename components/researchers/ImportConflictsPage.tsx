import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCw, Check, Undo2, PenLine, User, AlertTriangle } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  ImportConflictsApi, FIELD_LABELS, FAMILY_LABELS, RESOLVE_BATCH, isDateField,
  type ConflictTable, type ConflictDecision, type ImportConflict,
} from '../../lib/importConflicts';
import { apiErrorText } from '../../lib/apiErrors';
import { StatCard, PixelBtn } from './alignAtoms';

interface Props {
  tables: ConflictTable[];
  /** Opens the Druid record (Annuaire row id, uid_dyna fallback). */
  onOpenResearcher: (record: number, uid: string) => void;
  /** Called after each resolution (refreshes the tab counter and the researchers). */
  onResolved: () => void;
}

const MAX_PEOPLE = 80;

/**
 * « À traiter › Conflits annuaire <source> »: one card per person, one line per Annuaire cell
 * where the imported directory and Druid disagree. Each line is settled by keeping the current
 * value, taking the imported one, or typing another; the bulk bar applies one choice to every
 * displayed line (after an inline confirmation). Only open, still diverging lines are listed.
 */
export const ImportConflictsPage: React.FC<Props> = ({ tables, onOpenResearcher, onResolved }) => {
  const { t, i18n } = useLingui();
  const [table, setTable] = useState(() => (tables.find((x) => x.open > 0) ?? tables[0])?.id ?? '');
  const [items, setItems] = useState<ImportConflict[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [family, setFamily] = useState('');
  const [field, setField] = useState('');
  const [query, setQuery] = useState('');
  const [other, setOther] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [pendingBulk, setPendingBulk] = useState<'import' | 'current' | null>(null);
  const source = tables.find((x) => x.id === table)?.source ?? '';

  const load = async () => {
    if (!table) return;
    setLoading(true);
    setError('');
    try { setItems((await ImportConflictsApi.list(table)).conflicts); }
    catch (e) { setError(apiErrorText(e)); setItems((prev) => prev ?? []); }
    finally { setLoading(false); }
  };
  useEffect(() => { setItems(null); load(); }, [table]);

  const fieldLabel = (f: string) => (FIELD_LABELS[f] ? i18n._(FIELD_LABELS[f]) : f);

  const fieldCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of items ?? []) if (!family || c.family === family) m.set(c.field, (m.get(c.field) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, family]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? [])
      .filter((c) => !family || c.family === family)
      .filter((c) => !field || c.field === field)
      .filter((c) => !q || `${c.person} ${c.lab} ${c.current} ${c.imported}`.toLowerCase().includes(q));
  }, [items, family, field, query]);

  const people = useMemo(() => {
    const m = new Map<number, ImportConflict[]>();
    for (const c of rows) m.set(c.record, [...(m.get(c.record) || []), c]);
    return [...m.values()].sort((a, b) => a[0].person.localeCompare(b[0].person, 'fr'));
  }, [rows]);

  const resolve = async (decisions: ConflictDecision[]) => {
    if (decisions.length === 0) return;
    setBusy(true);
    setError('');
    try {
      for (let i = 0; i < decisions.length; i += RESOLVE_BATCH) {
        await ImportConflictsApi.resolve(table, decisions.slice(i, i + RESOLVE_BATCH));
      }
      const done = new Set(decisions.map((d) => d.id));
      setItems((prev) => (prev ?? []).filter((c) => !done.has(c.id)));
      setEditing(null);
      onResolved();
    } catch (e) {
      setError(apiErrorText(e));
      await load();
    } finally {
      setBusy(false);
      setPendingBulk(null);
    }
  };

  const recordsCount = new Set((items ?? []).map((c) => c.record)).size;
  const changedCount = (items ?? []).filter((c) => c.changedSinceImport).length;
  const cell = 'px-3 py-2 align-top';
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 md:px-7 pt-2 pb-3 flex flex-wrap items-center gap-2">
        {tables.length > 1 && (
          <select value={table} onChange={(e) => setTable(e.target.value)} className="input-soft !h-9 !py-1 text-[13px] w-auto">
            {tables.map((x) => <option key={x.id} value={x.id}>{x.source} ({x.open})</option>)}
          </select>
        )}
        <select value={family} onChange={(e) => { setFamily(e.target.value); setField(''); }} className="input-soft !h-9 !py-1 text-[13px] w-auto">
          <option value="">{t`All kinds`}</option>
          {Object.entries(FAMILY_LABELS).map(([k, label]) => <option key={k} value={k}>{i18n._(label)}</option>)}
        </select>
        <select value={field} onChange={(e) => setField(e.target.value)} className="input-soft !h-9 !py-1 text-[13px] w-auto">
          <option value="">{t`All fields`}</option>
          {fieldCounts.map(([f, n]) => <option key={f} value={f}>{fieldLabel(f)} ({n})</option>)}
        </select>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t`Search (name, lab, value…)`} className="input-soft !h-9 !py-1 text-[13px] w-56" />
        <div className="flex-1" />
        <PixelBtn onClick={load} disabled={loading || busy} title={t`Re-reads the arbitration table and the directory`}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} <Trans>Refresh</Trans>
        </PixelBtn>
      </div>

      <div className="flex-1 overflow-auto px-4 md:px-7 pb-6 space-y-4" data-page-scroll>
        {error && <p className="text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
        {!items ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-faint gap-3">
            <RefreshCw className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard label={t`Conflicts to settle`} value={items.length} tone="bg-[rgba(231,111,154,.15)] dark:bg-[rgba(231,111,154,.12)]" />
              <StatCard label={t`Records concerned`} value={recordsCount} />
              <StatCard label={t`Edited since the import`} value={changedCount} />
            </div>
            <p className="text-[12px] text-muted dark:text-[#8f897c]">
              <Trans>Values of the {source} directory that differ from Druid. The empty cells have already been filled by the import; here, choose for each line which value to keep. The choice is written to the record at once, with a line in its comments.</Trans>
            </p>

            {rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink/10 dark:border-white/10 bg-white/40 dark:bg-white/[.04] px-3 py-2 text-[13px]">
                {pendingBulk ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-[#b23b3b] dark:text-[#f08c8c]" />
                    <span className="font-semibold text-ink dark:text-[#f5f2ea]">
                      {pendingBulk === 'import'
                        ? t`Take the ${source} value for the ${rows.length} displayed conflicts?`
                        : t`Keep the current value for the ${rows.length} displayed conflicts?`}
                    </span>
                    <button type="button" disabled={busy} onClick={() => resolve(rows.map((c) => ({ id: c.id, choice: pendingBulk })))} className="btn-pill h-8 text-[12px]">
                      {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} <Trans>Confirm</Trans>
                    </button>
                    <button type="button" disabled={busy} onClick={() => setPendingBulk(null)} className="btn-pill h-8 text-[12px]"><Trans>Cancel</Trans></button>
                  </>
                ) : (
                  <>
                    <span className="text-muted dark:text-[#8f897c]"><Trans>For the {rows.length} displayed conflicts:</Trans></span>
                    <button type="button" disabled={busy} onClick={() => setPendingBulk('import')} className="btn-pill h-8 text-[12px]"><Check className="w-3.5 h-3.5" /> <Trans>Take {source}</Trans></button>
                    <button type="button" disabled={busy} onClick={() => setPendingBulk('current')} className="btn-pill h-8 text-[12px]"><Undo2 className="w-3.5 h-3.5" /> <Trans>Keep current</Trans></button>
                  </>
                )}
              </div>
            )}

            {rows.length === 0 ? (
              <p className="text-[13px] text-muted dark:text-[#8f897c] py-8 text-center">
                {items.length === 0 ? <Trans>No conflict left to settle.</Trans> : <Trans>Nothing to show with these filters.</Trans>}
              </p>
            ) : (
              people.slice(0, MAX_PEOPLE).map((group) => {
                const head = group[0];
                return (
                  <div key={head.record} className="rounded-2xl border border-ink/10 dark:border-white/10 overflow-hidden bg-white/40 dark:bg-white/[.04]">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white/60 dark:bg-white/5">
                      <button type="button" onClick={() => onOpenResearcher(head.record, head.uid)} className="inline-flex items-center gap-1.5 font-semibold text-ink dark:text-[#f5f2ea] hover:underline" title={t`Open the record`}>
                        <User className="w-3.5 h-3.5" /> {head.person}
                      </button>
                      {head.lab && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-ink/5 dark:bg-white/10 text-muted dark:text-[#8f897c]">{head.lab}</span>}
                      <div className="flex-1" />
                      {group.length > 1 && (
                        <button type="button" disabled={busy} onClick={() => resolve(group.map((c) => ({ id: c.id, choice: 'import' })))} className="text-[12px] font-semibold text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] hover:underline">
                          <Trans>Take {source} for this record</Trans>
                        </button>
                      )}
                    </div>
                    <table className="w-full text-[13px]">
                      <thead className="text-[11px] uppercase tracking-wide text-muted-lighter dark:text-[#8f897c]">
                        <tr>
                          <th className="text-left px-3 py-1.5 w-44"><Trans>Field</Trans></th>
                          <th className="text-left px-3 py-1.5"><Trans>Current value</Trans></th>
                          <th className="text-left px-3 py-1.5"><Trans>{source} value</Trans></th>
                          <th className="text-right px-3 py-1.5 w-[330px]"><Trans>Decision</Trans></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((c) => (
                          <tr key={c.id} className="border-t border-ink/5 dark:border-white/5">
                            <td className={`${cell} font-semibold text-ink dark:text-[#f5f2ea]`}>{fieldLabel(c.field)}</td>
                            <td className={`${cell} break-all`}>
                              {c.current || <span className="text-muted-faint">—</span>}
                              {c.changedSinceImport && <div className="text-[11px] text-[#9a6b00] dark:text-[#e0b24a]"><Trans>edited since the import</Trans></div>}
                            </td>
                            <td className={`${cell} break-all`}>
                              {c.imported}
                              {c.remark && <div className="text-[11px] text-muted dark:text-[#8f897c]">{c.remark}</div>}
                            </td>
                            <td className={`${cell} text-right`}>
                              {editing === c.id ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <input
                                    autoFocus
                                    value={other[c.id] ?? c.imported}
                                    onChange={(e) => setOther((o) => ({ ...o, [c.id]: e.target.value }))}
                                    onKeyDown={(e) => { if (e.key === 'Enter') resolve([{ id: c.id, choice: 'other', value: other[c.id] ?? c.imported }]); if (e.key === 'Escape') setEditing(null); }}
                                    placeholder={isDateField(c.field) ? t`dd/mm/yyyy` : ''}
                                    className="input-soft !h-8 !py-1 text-[12px] w-44"
                                  />
                                  <button type="button" disabled={busy} onClick={() => resolve([{ id: c.id, choice: 'other', value: other[c.id] ?? c.imported }])} className="btn-pill h-8 text-[12px]"><Check className="w-3.5 h-3.5" /></button>
                                  <button type="button" onClick={() => setEditing(null)} className="btn-pill h-8 text-[12px]" title={t`Cancel`}>×</button>
                                </span>
                              ) : (
                                <span className="inline-flex flex-wrap justify-end gap-1.5">
                                  <button type="button" disabled={busy} onClick={() => resolve([{ id: c.id, choice: 'current' }])} className="btn-pill h-8 text-[12px]" title={t`Keep the current value`}><Undo2 className="w-3.5 h-3.5" /> <Trans>Keep</Trans></button>
                                  <button type="button" disabled={busy} onClick={() => resolve([{ id: c.id, choice: 'import' }])} className="btn-pill h-8 text-[12px]" title={t`Write the ${source} value in the record`}><Check className="w-3.5 h-3.5" /> <Trans>Take {source}</Trans></button>
                                  <button type="button" disabled={busy} onClick={() => setEditing(c.id)} className="btn-pill h-8 text-[12px]" title={t`Type another value`}><PenLine className="w-3.5 h-3.5" /></button>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })
            )}
            {people.length > MAX_PEOPLE && (
              <p className="text-[11px] text-muted dark:text-[#8f897c]"><Trans>First {MAX_PEOPLE} records out of {people.length} — narrow with the filters.</Trans></p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
