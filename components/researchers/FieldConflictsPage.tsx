import React, { useState } from 'react';
import { Check, PencilLine, RefreshCw, RotateCw, Undo2 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { FieldConflictsApi, MERGED_FIELD_LABELS, SOURCE_LABELS, type FieldConflict, type FieldConflictAction } from '../../lib/fieldConflicts';

interface Props {
  items: FieldConflict[];
  onReload: () => Promise<void> | void;
  onOpenResearcher: (record: number, uid: string) => void;
  onResolved: () => void;
}

/**
 * « To process › Source conflicts » (druid-internal `docs/plan-maj-chercheurs.md`, lot 2 d): a manual correction
 * wins over the sources, but a source that changed its value since (or appeared since) is shown here. Three ways out:
 * keep the correction (it then acknowledges what the sources say), go back to the sources (the most trusted one
 * wins), or type another value. Nothing is ever overwritten without one of these choices.
 */
export const FieldConflictsPage: React.FC<Props> = ({ items, onReload, onOpenResearcher, onResolved }) => {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const label = (map: Record<string, any>, code: string) => (map[code] ? i18n._(map[code]) : code);
  const keyOf = (c: FieldConflict) => `${c.personId}|${c.field}`;
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

  const act = async (c: FieldConflict, action: FieldConflictAction, value?: string) => {
    setBusy(keyOf(c));
    setError('');
    try {
      await FieldConflictsApi.resolve(c.personId, c.field, action, value);
      setEditing(null);
      await onReload();
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const refresh = async () => {
    setLoading(true);
    try { await onReload(); } finally { setLoading(false); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 md:px-7 pt-2 pb-3 flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-muted dark:text-[#8f897c]">
          <Trans>A manual correction wins over the imports and the LDAP. A source that changed its value since is listed here: nothing changes until you choose.</Trans>
        </p>
        <div className="flex-1" />
        <button type="button" onClick={refresh} className="btn-pill h-9 text-[13px]">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} <Trans>Refresh</Trans>
        </button>
      </div>
      <div className="flex-1 overflow-auto px-4 md:px-7 pb-6 space-y-3" data-page-scroll>
        {error && <p className="text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
        {items.length === 0 && (
          <p className="text-[13px] text-muted dark:text-[#8f897c] py-8 text-center"><Trans>No source conflict.</Trans></p>
        )}
        {items.map((c) => {
          const k = keyOf(c);
          const fieldLabel = label(MERGED_FIELD_LABELS, c.field);
          const by = c.correctedBy ?? '';
          const on = day(c.correctedAt);
          const shown = c.value ?? '∅';
          return (
            <div key={k} className="rounded-2xl border border-ink/10 dark:border-white/10 bg-white/40 dark:bg-white/[.04] px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {c.recordId !== null
                  ? <button type="button" onClick={() => onOpenResearcher(c.recordId!, c.uid)} className="font-semibold text-ink dark:text-[#f5f2ea] hover:underline">{c.name}</button>
                  : <span className="font-semibold text-ink dark:text-[#f5f2ea]">{c.name}</span>}
                {c.labs.length > 0 && <span className="text-muted dark:text-[#8f897c]">{c.labs.join(', ')}</span>}
                <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary dark:bg-primary-light/15 dark:text-primary-light">{fieldLabel}</span>
              </div>
              <div className="mt-2 grid gap-1">
                <div><Trans>Correction: <strong>{shown}</strong> (by {by} on {on})</Trans></div>
                {c.conflicts.map((d) => {
                  const source = label(SOURCE_LABELS, d.source);
                  const since = day(d.observedAt);
                  const value = d.value;
                  return (
                    <div key={d.source} className="text-muted dark:text-[#8f897c]">
                      {d.kind === 'new_since_manual'
                        ? <Trans>{source} now gives <strong className="text-ink dark:text-[#f5f2ea]">{value}</strong> (since {since}, after the correction)</Trans>
                        : <Trans>{source} changed to <strong className="text-ink dark:text-[#f5f2ea]">{value}</strong> (since {since})</Trans>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy === k} onClick={() => act(c, 'keep')} className="btn-pill h-8 text-[12px]"
                  title={t`The correction stays; the sources as they are now are acknowledged.`}>
                  <Check className="w-3.5 h-3.5" /> <Trans>Keep the correction</Trans>
                </button>
                <button type="button" disabled={busy === k} onClick={() => act(c, 'drop')} className="btn-pill h-8 text-[12px]"
                  title={t`The correction is removed: the most trusted source gives the value.`}>
                  <Undo2 className="w-3.5 h-3.5" /> <Trans>Back to the sources</Trans>
                </button>
                {editing === k ? (
                  <>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} className="input-soft !h-8 !py-1 text-[12px] w-44"
                      placeholder={c.field === 'birth_date' ? t`YYYY-MM-DD, YYYY-MM or YYYY` : t`Grade code`} autoFocus />
                    <button type="button" disabled={busy === k} onClick={() => act(c, 'correct', typed)} className="btn-pill h-8 text-[12px]">
                      {busy === k ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} <Trans>Save</Trans>
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="btn-pill h-8 text-[12px]"><Trans>Cancel</Trans></button>
                  </>
                ) : (
                  <button type="button" disabled={busy === k} onClick={() => { setEditing(k); setTyped(c.value ?? ''); }} className="btn-pill h-8 text-[12px]">
                    <PencilLine className="w-3.5 h-3.5" /> <Trans>Another value</Trans>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
