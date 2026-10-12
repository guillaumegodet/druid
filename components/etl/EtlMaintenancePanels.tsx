import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, RefreshCw, Users } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { EffectifRow, EffectifsResponse, EffectifsSyncStats, EtlConsoleApi } from './etlConsoleApi';

const cardCls = 'rounded-panel bg-white/70 dark:bg-white/[.06] border border-white/80 dark:border-white/10 shadow-soft p-4 flex flex-col gap-3';
const PREVIEW_ROWS = 40;

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
