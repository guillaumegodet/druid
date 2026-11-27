import React, { useCallback, useEffect, useState } from 'react';
import { Check, FileX2, PencilLine, RefreshCw, RotateCw, Undo2 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { FieldConflictsApi, MERGED_FIELD_LABELS, SOURCE_LABELS, type FieldConflict, type FieldConflictAction, type FieldImport, type IdentifierConflict } from '../../lib/fieldConflicts';

interface Props {
  items: FieldConflict[];
  /** Identifiers set aside but brought again by a source, or still shown (lot 4 b). */
  identifiers?: IdentifierConflict[];
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
export const FieldConflictsPage: React.FC<Props> = ({ items, identifiers = [], onReload, onOpenResearcher, onResolved }) => {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const label = (map: Record<string, any>, code: string) => (map[code] ? i18n._(map[code]) : code);

  // Recent file and site imports, and « cancel an import » (case 19 of the plan).
  const [imports, setImports] = useState<FieldImport[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [undoneNote, setUndoneNote] = useState('');
  const loadImports = useCallback(async () => {
    try { setImports((await FieldConflictsApi.imports()).items); } catch (e) { console.warn('Imports:', e); }
  }, []);
  useEffect(() => { loadImports(); }, [loadImports]);
  const SCHEME_LABELS: Record<string, string> = { orcid: 'ORCID', idref: 'IdRef', idhal: 'IdHAL', idhal_i: 'IdHAL_i', scopus: 'Scopus', openalex: 'OpenAlex' };
  const sourceName = (code: string) => {
    if (!code.startsWith('align:')) return label(SOURCE_LABELS, code);
    const name = code.slice(6);
    return t`Alignment ${name}`;
  };
  const settleIdentifier = async (c: IdentifierConflict, action: 'keep' | 'accept') => {
    const k = `id:${c.personId}|${c.scheme}|${c.value}`;
    setBusy(k);
    setError('');
    try {
      await FieldConflictsApi.resolveIdentifier(c.personId, c.scheme, c.value, action);
      await onReload();
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const undo = async (imp: FieldImport) => {
    setBusy(`import:${imp.id}`);
    setError('');
    try {
      const r = await FieldConflictsApi.undoImport(imp.id);
      const n = r.values;
      const p = r.persons;
      setUndoneNote(t`${n} values removed, ${p} records recomputed.`);
      setConfirming(null);
      await Promise.all([loadImports(), onReload()]);
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
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
        {identifiers.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Identifiers set aside</Trans></h2>
            {identifiers.map((c) => {
              const k = `id:${c.personId}|${c.scheme}|${c.value}`;
              const by = c.rejectedBy ?? '';
              const on = c.rejectedAt ? c.rejectedAt.slice(0, 10) : '';
              const scheme = SCHEME_LABELS[c.scheme] ?? c.scheme;
              const value = c.value;
              const sources = c.sources.map((x) => `${sourceName(x.source)} (${x.at.slice(0, 10)})`).join(', ');
              return (
                <div key={k} className="rounded-2xl border border-ink/10 dark:border-white/10 bg-white/40 dark:bg-white/[.04] px-4 py-3 text-[13px]">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {c.recordId !== null
                      ? <button type="button" onClick={() => onOpenResearcher(c.recordId!, c.uid)} className="font-semibold text-ink dark:text-[#f5f2ea] hover:underline">{c.name}</button>
                      : <span className="font-semibold text-ink dark:text-[#f5f2ea]">{c.name}</span>}
                    {c.labs.length > 0 && <span className="text-muted dark:text-[#8f897c]">{c.labs.join(', ')}</span>}
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary dark:bg-primary-light/15 dark:text-primary-light">{scheme}</span>
                  </div>
                  <div className="mt-2">
                    {c.kind === 'brought_again'
                      ? <Trans><strong>{value}</strong> was set aside by {by} on {on}, and brought again by {sources}: not written.</Trans>
                      : <Trans><strong>{value}</strong> was set aside by {by} on {on}, but the record still shows it.</Trans>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy === k} onClick={() => settleIdentifier(c, 'keep')} className="btn-pill h-8 text-[12px]"
                      title={t`The value stays set aside (and leaves the record if it still shows it).`}>
                      <Check className="w-3.5 h-3.5" /> <Trans>Keep it set aside</Trans>
                    </button>
                    <button type="button" disabled={busy === k} onClick={() => settleIdentifier(c, 'accept')} className="btn-pill h-8 text-[12px]"
                      title={t`The rejection is lifted and the value kept in the record.`}>
                      <Undo2 className="w-3.5 h-3.5" /> <Trans>Accept the value</Trans>
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}
        {items.length === 0 && identifiers.length === 0 && (
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
        {imports.length > 0 && (
          <section className="pt-4">
            <h2 className="font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea] mb-1"><Trans>Recent imports</Trans></h2>
            <p className="text-[12px] text-muted dark:text-[#8f897c] mb-2">
              <Trans>Cancelling an import removes the values it brought to the date of birth and the grade; the records take the value of the other sources again. The records, memberships and identifiers it created stay.</Trans>
            </p>
            {undoneNote && <p className="text-[12px] font-semibold text-ink dark:text-[#f5f2ea] mb-2">{undoneNote}</p>}
            <div className="space-y-2">
              {imports.map((imp) => {
                const when = imp.createdAt.slice(0, 10);
                const who = imp.createdBy ?? '';
                const n = imp.values;
                const p = imp.persons;
                const undoneOn = imp.undoneAt ? imp.undoneAt.slice(0, 10) : '';
                const undoneBy = imp.undoneBy ?? '';
                return (
                  <div key={imp.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-ink/10 dark:border-white/10 bg-white/40 dark:bg-white/[.04] px-3 py-2 text-[12px]">
                    <span className="font-semibold text-ink dark:text-[#f5f2ea]">{imp.label || label(SOURCE_LABELS, imp.source)}</span>
                    <span className="px-1.5 py-0.5 rounded text-[11px] bg-primary/10 text-primary dark:bg-primary-light/15 dark:text-primary-light">{label(SOURCE_LABELS, imp.source)}</span>
                    <span className="text-muted dark:text-[#8f897c]"><Trans>{when} by {who}</Trans></span>
                    {imp.undoneAt
                      ? <span className="text-muted dark:text-[#8f897c] italic"><Trans>cancelled on {undoneOn} by {undoneBy}</Trans></span>
                      : <span className="text-muted dark:text-[#8f897c]"><Trans>{n} values, {p} records</Trans></span>}
                    <span className="flex-1" />
                    {!imp.undoneAt && imp.values > 0 && (confirming === imp.id ? (
                      <>
                        <span className="font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Remove these {n} values?</Trans></span>
                        <button type="button" disabled={busy === `import:${imp.id}`} onClick={() => undo(imp)} className="btn-pill h-8 text-[12px]">
                          {busy === `import:${imp.id}` ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} <Trans>Confirm</Trans>
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} className="btn-pill h-8 text-[12px]"><Trans>Cancel</Trans></button>
                      </>
                    ) : (
                      <button type="button" onClick={() => { setConfirming(imp.id); setUndoneNote(''); }} className="btn-pill h-8 text-[12px]">
                        <FileX2 className="w-3.5 h-3.5" /> <Trans>Cancel this import's values</Trans>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
