import React, { useEffect, useState } from 'react';
import { History, Undo2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { GristService, MergeLogEntry } from '../../lib/gristService';
import { numberLocale } from '../../lib/i18n';
import { apiErrorText } from '../../lib/apiErrors';

interface MergeLogPanelProps {
  /** After a successful restore (refresh the data / the review). */
  onRestored?: (restoredRowId: number) => void;
  /** Increment to force a reload (e.g. after a merge). */
  refreshKey?: number;
}

/**
 * Merge log (Grist `Fusions_log` table) with a « Restaurer » action:
 * recreates the absorbed row from its snapshot and restores the fields written on the
 * kept row (docs/archive/plan-fusion-doublons.md, lot 2). Collapsed by default.
 */
export const MergeLogPanel: React.FC<MergeLogPanelProps> = ({ onRestored, refreshKey = 0 }) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<MergeLogEntry[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    GristService.listMerges(50)
      .then((e) => { if (!cancelled) setEntries(e); })
      .catch((e) => { if (!cancelled) setError(apiErrorText(e) || String(e)); });
    return () => { cancelled = true; };
  }, [open, refreshKey]);

  const restore = async (entry: MergeLogEntry) => {
    if (!window.confirm(t`Restore row G-${entry.dropped_rowid} (${entry.Nom})? The kept row gets its previous values back.`)) return;
    try {
      setBusy(entry.id);
      setError('');
      const { restoredRowId } = await GristService.restoreFusion(entry.id);
      setEntries((prev) => (prev || []).map((e) => (e.id === entry.id ? { ...e, restaure: true, restored_rowid: restoredRowId } : e)));
      onRestored?.(restoredRowId);
    } catch (e: any) {
      setError(apiErrorText(e) || String(e));
    } finally {
      setBusy(null);
    }
  };

  const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleString(numberLocale()) : '—');

  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 pb-2 mb-2 w-full border-b border-ink/5 dark:border-white/5 text-muted-lighter dark:text-[#8f897c]">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <History className="w-4 h-4" />
        <h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>Merge log</Trans></h3>
        {entries && <span className="text-[12px] font-normal text-muted-faint">({entries.length})</span>}
      </button>
      {open && (
        <div className="space-y-2">
          {error && <p className="text-[12.5px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
          {entries === null && !error && <p className="text-[13px] text-muted-faint flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading…</Trans></p>}
          {entries && entries.length === 0 && <p className="text-[13px] text-muted-faint"><Trans>No merge logged.</Trans></p>}
          {entries && entries.map((e) => (
            <div key={e.id} className={`rounded-card border px-4 py-2 text-[12.5px] flex flex-wrap items-center gap-x-3 gap-y-1 ${e.restaure ? 'border-ink/5 dark:border-white/5 bg-white/30 dark:bg-white/[.03] opacity-70' : 'border-ink/10 dark:border-white/10 bg-white/50 dark:bg-white/5'}`}>
              <span className="font-semibold text-ink dark:text-[#f5f2ea]">{e.Nom || '—'}</span>
              <span className="font-mono text-muted dark:text-[#8f897c]">{e.uid_dyna}</span>
              <span className="text-muted-faint"><Trans>G-{e.dropped_rowid} → G-{e.kept_rowid}</Trans></span>
              <span className="text-muted-faint">{fmtDate(e.date)} · {e.auteur}</span>
              {e.note && <span className="text-muted-faint italic" title={e.note}>{e.note.slice(0, 60)}</span>}
              <span className="ml-auto">
                {e.restaure ? (
                  <span className="text-[11px] font-semibold text-muted-faint"><Trans>restored (G-{e.restored_rowid})</Trans></span>
                ) : (
                  <button type="button" onClick={() => restore(e)} disabled={busy !== null} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[12px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 disabled:opacity-50">
                    {busy === e.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} <Trans>Restore</Trans>
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
