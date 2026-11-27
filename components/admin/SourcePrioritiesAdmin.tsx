import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Download, Eye, Plus, RefreshCw } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { DirectoryApi } from '../../lib/directoryApi';
import { MERGED_FIELD_LABELS, SOURCE_LABELS } from '../../lib/fieldConflicts';
import type { SourceOrderEffectView, SourceOrders } from '../../lib/directory/commands';

/**
 * Administration › Record sources (lot 5 of druid-internal `docs/plan-maj-chercheurs.md`, D6): the order in which the
 * sources of each field merged by source are trusted. A manual correction always wins and is not part of the order.
 * Changing an order recomputes the records of the field: a preview (how many records would change, a few of them)
 * comes first, the change is logged.
 */
export const SourcePrioritiesAdmin: React.FC = () => {
  const { t, i18n } = useLingui();
  const [data, setData] = useState<SourceOrders | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [effects, setEffects] = useState<Record<string, SourceOrderEffectView | null>>({});
  const [saved, setSaved] = useState<Record<string, SourceOrderEffectView | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const d = await DirectoryApi.sourceOrders();
      setData(d);
      setDrafts(Object.fromEntries(d.fields.map((f) => [f.field, f.sources.map((s) => s.source)])));
      setEffects({});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, []);

  const sourceName = (code: string) => (SOURCE_LABELS[code] ? i18n._(SOURCE_LABELS[code]) : code);
  const fieldName = (code: string) => (MERGED_FIELD_LABELS[code] ? i18n._(MERGED_FIELD_LABELS[code]) : code);
  const setDraft = (field: string, order: string[]) => {
    setDrafts((d) => ({ ...d, [field]: order }));
    setEffects((e) => ({ ...e, [field]: null }));
    setSaved((s) => ({ ...s, [field]: null }));
  };
  const move = (field: string, i: number, delta: number) => {
    const order = [...drafts[field]];
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setDraft(field, order);
  };
  const applyProfile = (profile: string[]) => {
    if (!data) return;
    for (const f of data.fields) {
      const extra = drafts[f.field].filter((s) => !profile.includes(s));
      setDraft(f.field, [...profile, ...extra]);
    }
  };
  const run = async (field: string, save: boolean) => {
    setBusy(field);
    setError('');
    try {
      if (save) {
        const r = await DirectoryApi.setSourceOrder(field, drafts[field]);
        setSaved((s) => ({ ...s, [field]: r }));
        await load();
      } else {
        const r = await DirectoryApi.previewSourceOrder(field, drafts[field]);
        setEffects((e) => ({ ...e, [field]: r }));
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const exportJson = () => {
    if (!data) return;
    const json = JSON.stringify({ format: 'druid-source-priorities/1', fields: data.fields.map((f) => ({ field: f.field, order: f.sources.map((s) => s.source) })) }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'druid-source-priorities.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!data) {
    return error ? <p className="text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>
      : <p className="text-[13px] text-muted"><RefreshCw className="inline w-4 h-4 animate-spin" /> <Trans>Loading…</Trans></p>;
  }
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted dark:text-[#8f897c]">
        <Trans>For each field, the record shows the value of the most trusted source that gives one. A correction typed in a record always wins and is not part of the order. Changing an order recomputes the records of the field: preview it first.</Trans>
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted dark:text-[#8f897c]"><Trans>Starting profile:</Trans></span>
        <button type="button" onClick={() => applyProfile(data.profiles.ldap)} className="btn-pill h-8 text-[12px]"><Trans>University with an LDAP directory</Trans></button>
        <button type="button" onClick={() => applyProfile(data.profiles.no_ldap)} className="btn-pill h-8 text-[12px]"><Trans>Without LDAP (HR export first)</Trans></button>
        <span className="flex-1" />
        <button type="button" onClick={exportJson} className="btn-pill h-8 text-[12px]"><Download className="w-3.5 h-3.5" /> <Trans>Export (JSON)</Trans></button>
      </div>
      {error && <p className="text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {data.fields.map((f) => {
          const order = drafts[f.field] ?? [];
          const changedOrder = order.join('|') !== f.sources.map((s) => s.source).join('|');
          const effect = effects[f.field];
          const done = saved[f.field];
          const unranked = [...new Set([...f.unranked, ...f.sources.map((s) => s.source)])].filter((s) => !order.includes(s));
          const n = effect?.changed ?? 0;
          const total = effect?.persons ?? 0;
          const m = done?.changed ?? 0;
          return (
            <div key={f.field} className="rounded-2xl border border-ink/10 dark:border-white/10 bg-white/40 dark:bg-white/[.04] px-4 py-3 text-[13px]">
              <div className="font-semibold text-ink dark:text-[#f5f2ea] mb-2">{fieldName(f.field)}</div>
              <ol className="space-y-1">
                {order.map((s, i) => (
                  <li key={s} className="flex items-center gap-2">
                    <span className="w-5 text-right text-muted">{i + 1}.</span>
                    <span className="flex-1">{sourceName(s)}</span>
                    <button type="button" onClick={() => move(f.field, i, -1)} disabled={i === 0} aria-label={t`Move up`} className="p-1 rounded hover:bg-white/60 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => move(f.field, i, 1)} disabled={i === order.length - 1} aria-label={t`Move down`} className="p-1 rounded hover:bg-white/60 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                  </li>
                ))}
              </ol>
              {unranked.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-muted dark:text-[#8f897c]">
                  <Trans>Not ranked (come last):</Trans>
                  {unranked.map((s) => (
                    <button key={s} type="button" onClick={() => setDraft(f.field, [...order, s])} className="btn-pill h-6 text-[11px]"><Plus className="w-3 h-3" /> {sourceName(s)}</button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={!changedOrder || busy === f.field} onClick={() => run(f.field, false)} className="btn-pill h-8 text-[12px]">
                  {busy === f.field && !effect ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />} <Trans>Preview</Trans>
                </button>
                <button type="button" disabled={!changedOrder || !effect || busy === f.field} onClick={() => run(f.field, true)} className="btn-pill h-8 text-[12px]">
                  <Check className="w-3.5 h-3.5" /> <Trans>Save and recompute</Trans>
                </button>
                {changedOrder && <button type="button" onClick={() => setDraft(f.field, f.sources.map((s) => s.source))} className="text-[12px] underline text-muted"><Trans>Cancel</Trans></button>}
              </div>
              {effect && (
                <div className="mt-2 text-[12px]">
                  <div className="font-semibold text-ink dark:text-[#f5f2ea]"><Trans>{n} of {total} records would change.</Trans></div>
                  {effect.examples.length > 0 && (
                    <ul className="mt-1 text-muted dark:text-[#8f897c]">
                      {effect.examples.map((x, i) => <li key={i}>{x.name} : {x.before ?? '∅'} → {x.after ?? '∅'}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {done && <p className="mt-2 text-[12px] font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Saved: {m} records recomputed.</Trans></p>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
