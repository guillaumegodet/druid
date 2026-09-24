import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, Loader2, RefreshCw, Save, Search, Users } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import {
  Correction, CorrectionPatch, EffectifRow, EffectifsResponse, EffectifsSyncStats, EtlConsoleApi,
} from './etlConsoleApi';

const cardCls = 'rounded-panel bg-white/70 dark:bg-white/[.06] border border-white/80 dark:border-white/10 shadow-soft p-4 flex flex-col gap-3';
const inputCls = 'input-soft py-1 text-[12.5px]';
const PREVIEW_ROWS = 40;
const EDITABLE: (keyof CorrectionPatch)[] = ['statut', 'date_soumission', 'date_resolution', 'notes'];

/**
 * @component EffectifsPanel
 * @description State of effectifs.csv (local cache of the validated researchers
 * of the Grist Annuaire) and on-demand resync — port of section 5
 * of the Streamlit admin. Lot 3 of docs/archive/plan-console-etl-native.md.
 */
export const EffectifsPanel: React.FC<{ slug: string; gristLabo: string; disabled?: boolean; onSynced?: () => void }> = ({
  slug, gristLabo, disabled, onSynced,
}) => {
  const { t, i18n } = useLingui();
  const [data, setData] = useState<EffectifsResponse | null>(null);
  const [stats, setStats] = useState<EffectifsSyncStats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showRows, setShowRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleString(i18n.locale) : '—');

  const load = useCallback(async () => {
    try {
      setData(await EtlConsoleApi.effectifs(slug));
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Staff list could not be read`);
    }
  }, [slug, t]);

  useEffect(() => {
    setData(null);
    setStats(null);
    setError(null);
    setNotice(null);
    setShowRows(false);
    void load();
  }, [load]);

  const sync = async () => {
    setError(null);
    setNotice(null);
    setSyncing(true);
    try {
      const r = await EtlConsoleApi.syncEffectifs(slug);
      setStats(r.stats);
      if (r.written) {
        setData({ rows: r.rows || [], count: r.count, columns: r.columns, updatedAt: r.updatedAt ?? null });
        setNotice(t`${r.count} validated researchers synchronised → effectifs.csv`);
        onSynced?.();
      } else {
        setError(r.warning || t`Nothing to synchronise`);
      }
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Grist error`);
    } finally {
      setSyncing(false);
    }
  };

  const columns = data?.columns?.length ? data.columns : Object.keys(data?.rows[0] || {});
  const rows: EffectifRow[] = showRows ? (data?.rows || []) : (data?.rows || []).slice(0, PREVIEW_ROWS);

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="section-label flex items-center gap-2"><Users className="w-4 h-4" /> <Trans>Staff (Grist directory)</Trans></h4>
        <button type="button" className="btn-pill !h-8 px-3 text-xs" onClick={() => void sync()} disabled={disabled || syncing || !gristLabo}
          title={gristLabo ? t`Filter LABO = “${gristLabo}”, validated researchers excluding departures` : t`Fill in the Grist acronym (section 3) and save`}>
          {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <Trans>Resynchronise from Grist</Trans>
        </button>
      </div>
      <p className="text-[12.5px] text-muted-light dark:text-[#8f897c]">
        {data?.count
          ? t`${data.count} members in effectifs.csv — updated on ${fmtDate(data.updatedAt)}. The file is also resynchronised at each regeneration.`
          : t`No cached staff list for this structure.`}
      </p>
      {stats && (
        <p className="text-[12px] text-muted-light dark:text-[#8f897c]">
          <Trans>
            Out of {stats.total_labo ?? 0} row(s) LABO = {gristLabo} in the directory: {stats.valides_retenus ?? 0} validated kept, {stats.non_valides_ignores ?? 0} unvalidated ignored, {stats.departs_ignores ?? 0} departing ignored.
          </Trans>
        </p>
      )}
      {error && <p className="flex items-start gap-2 text-[13px] text-[#d64545]"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}</p>}
      {notice && <p className="flex items-start gap-2 text-[13px] text-[#1f7a4d] dark:text-[#5fd39a]"><CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> {notice}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-xl border border-ink/10 dark:border-white/10">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-white/90 dark:bg-[#2a2823]">
              <tr>{columns.map((c) => <th key={c} className="text-left font-semibold px-2 py-1.5 text-muted dark:text-[#c3beb0]">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-ink/5 dark:border-white/5">
                  {columns.map((c) => <td key={c} className="px-2 py-1 text-ink dark:text-[#f5f2ea] whitespace-nowrap">{r[c]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(data?.rows.length || 0) > PREVIEW_ROWS && (
        <button type="button" className="text-[12px] underline text-muted self-start" onClick={() => setShowRows((v) => !v)}>
          {showRows ? t`Collapse the preview` : t`Show all ${data?.rows.length ?? 0} rows`}
        </button>
      )}
    </section>
  );
};

type Bucket = 'suspectes' | 'en_cours' | 'historique';
const BUCKETS: { key: Bucket; statuses: string[] }[] = [
  { key: 'suspectes', statuses: ['Détectée'] },
  { key: 'en_cours', statuses: ['Soumise'] },
  { key: 'historique', statuses: ['Traitée', 'Ignorée'] },
];

/**
 * @component CorrectionsPanel
 * @description OpenAlex affiliation check: detection of suspicious
 * publications (config keywords, pushed to the Grist table
 * Corrections_affiliations_Openalex) and tracking of corrections — status, dates,
 * notes editable row by row. Port of section 6 of the Streamlit admin.
 */
export const CorrectionsPanel: React.FC<{ slug: string; hasParquet: boolean; hasKeywords: boolean; disabled?: boolean }> = ({
  slug, hasParquet, hasKeywords, disabled,
}) => {
  const { t } = useLingui();
  const [items, setItems] = useState<Correction[]>([]);
  const [statuses, setStatuses] = useState<string[]>(['Détectée', 'Soumise', 'Traitée', 'Ignorée']);
  const [bucket, setBucket] = useState<Bucket>('suspectes');
  const [edits, setEdits] = useState<Record<number, CorrectionPatch>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const bucketLabel: Record<Bucket, string> = {
    suspectes: t`Suspicious`,
    en_cours: t`In progress`,
    historique: t`History`,
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await EtlConsoleApi.corrections(slug);
      setItems(r.corrections);
      setStatuses(r.statuses);
      setEdits({});
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Corrections could not be read`);
    } finally {
      setLoading(false);
    }
  }, [slug, t]);

  useEffect(() => {
    setItems([]);
    setError(null);
    setNotice(null);
    setBucket('suspectes');
    void load();
  }, [load]);

  const detect = async () => {
    setError(null);
    setNotice(null);
    setDetecting(true);
    try {
      const r = await EtlConsoleApi.detectAffiliations(slug);
      setNotice(r.suspects === 0
        ? t`No suspicious affiliation detected.`
        : t`${r.suspects} suspect(s) detected — ${r.added} new added to Grist, ${r.alreadyPresent} already present.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Detection error`);
    } finally {
      setDetecting(false);
    }
  };

  const edit = (id: number, key: keyof CorrectionPatch, value: string) =>
    setEdits((m) => ({ ...m, [id]: { ...(m[id] || {}), [key]: value } }));

  const value = (c: Correction, key: keyof CorrectionPatch): string => {
    const e = edits[c.id];
    return e && key in e ? String(e[key] ?? '') : String(c[key] ?? '');
  };

  const isDirty = (c: Correction) => EDITABLE.some((k) => value(c, k) !== String(c[k] ?? ''));

  const saveRow = async (c: Correction) => {
    const patch: CorrectionPatch = {};
    for (const k of EDITABLE) {
      if (value(c, k) !== String(c[k] ?? '')) patch[k] = value(c, k);
    }
    if (!Object.keys(patch).length) return;
    setSavingId(c.id);
    setError(null);
    try {
      await EtlConsoleApi.updateCorrection(slug, c.id, patch);
      setItems((list) => list.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
      setEdits((m) => {
        const { [c.id]: _dropped, ...rest } = m;
        return rest;
      });
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Save error`);
    } finally {
      setSavingId(null);
    }
  };

  const counts = useMemo(() => Object.fromEntries(
    BUCKETS.map((b) => [b.key, items.filter((c) => b.statuses.includes(c.statut)).length]),
  ) as Record<Bucket, number>, [items]);
  const visible = items.filter((c) => BUCKETS.find((b) => b.key === bucket)!.statuses.includes(c.statut));
  const canDetect = hasParquet && hasKeywords;

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="section-label flex items-center gap-2"><Search className="w-4 h-4" /> <Trans>OpenAlex affiliation checks</Trans></h4>
        <button type="button" className="btn-pill !h-8 px-3 text-xs" onClick={() => void detect()} disabled={disabled || detecting || !canDetect}
          title={!hasParquet ? t`Regenerate the data first` : !hasKeywords ? t`Fill in the affiliation keywords (section 3) and save` : t`Compares the authors' raw affiliation with the keywords and pushes suspects to Grist`}>
          {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          <Trans>Detect suspicious affiliations</Trans>
        </button>
      </div>
      {error && <p className="flex items-start gap-2 text-[13px] text-[#d64545]"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}</p>}
      {notice && <p className="flex items-start gap-2 text-[13px] text-[#1f7a4d] dark:text-[#5fd39a]"><CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> {notice}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => (
          <button key={b.key} type="button" onClick={() => setBucket(b.key)}
            className={`pill px-3 py-1 text-[12.5px] cursor-pointer ${bucket === b.key ? 'bg-ink text-white dark:bg-accent dark:text-ink' : 'bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea]'}`}>
            {bucketLabel[b.key]} <span className="opacity-70">{counts[b.key]}</span>
          </button>
        ))}
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-light" />}
        <span className="text-[12px] text-muted-light dark:text-[#8f897c] ml-auto">
          <Trans>{items.length} entry(ies) in Grist for this structure</Trans>
        </span>
      </div>
      {visible.length === 0 && !loading && (
        <p className="text-[12.5px] text-muted-light dark:text-[#8f897c]"><Trans>No entry in this category.</Trans></p>
      )}
      {visible.length > 0 && (
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto rounded-xl border border-ink/10 dark:border-white/10">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-white/90 dark:bg-[#2a2823]">
              <tr className="text-left text-muted dark:text-[#c3beb0]">
                <th className="px-2 py-1.5 font-semibold"><Trans>Publication</Trans></th>
                <th className="px-2 py-1.5 font-semibold"><Trans>Raw affiliation</Trans></th>
                <th className="px-2 py-1.5 font-semibold"><Trans>Reason</Trans></th>
                <th className="px-2 py-1.5 font-semibold"><Trans>Status</Trans></th>
                <th className="px-2 py-1.5 font-semibold"><Trans>Submitted on</Trans></th>
                <th className="px-2 py-1.5 font-semibold"><Trans>Resolved on</Trans></th>
                <th className="px-2 py-1.5 font-semibold"><Trans>Notes</Trans></th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className="border-t border-ink/5 dark:border-white/5 align-top">
                  <td className="px-2 py-1.5 min-w-[16rem] max-w-[22rem] text-ink dark:text-[#f5f2ea]">
                    <div className="font-semibold leading-snug">{c.titre}</div>
                    <div className="text-muted-light dark:text-[#8f897c]">
                      {c.annee} · {c.auteur}
                      {c.url_openalex && (
                        <> · <a href={c.url_openalex} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">OpenAlex <ExternalLink className="w-3 h-3" /></a></>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 min-w-[14rem] max-w-[20rem] text-ink dark:text-[#f5f2ea]" title={c.affiliation_brute}>
                    <div className="line-clamp-3">{c.affiliation_brute}</div>
                  </td>
                  <td className="px-2 py-1.5 min-w-[10rem] text-muted dark:text-[#c3beb0]">{c.raison_detection}</td>
                  <td className="px-2 py-1.5">
                    <select className={`${inputCls} !w-auto`} value={value(c, 'statut')} onChange={(e) => edit(c.id, 'statut', e.target.value)} disabled={disabled}>
                      {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="date" className={`${inputCls} !w-36`} value={value(c, 'date_soumission')} onChange={(e) => edit(c.id, 'date_soumission', e.target.value)} disabled={disabled} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="date" className={`${inputCls} !w-36`} value={value(c, 'date_resolution')} onChange={(e) => edit(c.id, 'date_resolution', e.target.value)} disabled={disabled} />
                  </td>
                  <td className="px-2 py-1.5 min-w-[12rem]">
                    <input className={inputCls} value={value(c, 'notes')} onChange={(e) => edit(c.id, 'notes', e.target.value)} disabled={disabled} />
                  </td>
                  <td className="px-2 py-1.5">
                    {isDirty(c) && (
                      <button type="button" className="btn-pill-dark !h-7 px-2.5 text-[11px]" onClick={() => void saveRow(c)} disabled={disabled || savingId === c.id} title={t`Save to Grist`}>
                        {savingId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
