import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Archive, Download, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';

/**
 * « Data of the institution » card of « My institution » on a tenant (druid-internal docs/plan-druid-saas.md, lot 6 a-3),
 * for the owners, also on a suspended tenant: the export of every data of the Druid (an archive prepared by the
 * runner, downloadable for 7 days) and its deletion (confirmed with its name, done 30 days later, cancellable until
 * then). API: functions/api/tenant (exports, deletion), rules in lib/saas/lifecycle.ts.
 */

export interface DeletionView { requestedAt: string; requestedBy: string | null; deleteAfter: string }
interface ExportView {
  id: string; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; createdAt: string; finishedAt: string | null;
  createdBy: string | null; fileName: string | null; size: number | null; expiresAt: string | null; available: boolean; error: string | null;
}

const inputCls = 'input-soft py-1.5 text-sm font-normal';
const btnDark = 'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50';
const btnLight = 'inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11.5px] font-semibold bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 disabled:opacity-50';
const btnDanger = 'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-[#b23b3b] text-white disabled:opacity-40';

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`/api/tenant${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 409) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

/** Size in the units of the language (« 1,2 Mo », « 1.2 MB »). */
const sizeOf = (bytes: number | null) => {
  if (bytes === null) return '';
  const mb = bytes / (1024 * 1024);
  const unit = (u: string, v: number) => new Intl.NumberFormat(numberLocale(), { style: 'unit', unit: u, maximumFractionDigits: 1 }).format(v);
  return mb >= 1 ? unit('megabyte', mb) : unit('kilobyte', Math.max(1, Math.round(bytes / 1024)));
};

export const DataLifecycle: React.FC<{ slug: string; deletion: DeletionView | null }> = ({ slug, deletion }) => {
  const { t } = useLingui();
  const [exports, setExports] = useState<ExportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const timer = useRef<number | null>(null);

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(numberLocale(), { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString(numberLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '');

  const load = async () => {
    try {
      const d = await call('GET', '/exports') as { exports: ExportView[] };
      setExports(d.exports); setError(null);
      // An export in progress is followed until it ends.
      if (timer.current) window.clearTimeout(timer.current);
      if (d.exports.some((e) => e.status === 'queued' || e.status === 'running')) timer.current = window.setTimeout(load, 5000);
    } catch (e) { setError(apiErrorText(e) || String(e)); }
  };
  useEffect(() => { load(); return () => { if (timer.current) window.clearTimeout(timer.current); }; }, []);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setError(null);
    try { await fn(); if (after) after(); else await load(); } catch (e) { setError(apiErrorText(e) || String(e)); } finally { setBusy(false); }
  };
  // The status of the tenant changes for the whole app (read-only or back): reloaded.
  const reloadApp = () => window.location.reload();

  const live = exports?.some((e) => e.status === 'queued' || e.status === 'running');
  const statusText = (e: ExportView) => {
    if (e.status === 'queued') return t`Waiting for the server…`;
    if (e.status === 'running') return t`Being prepared…`;
    if (e.status === 'failed') return t`Failed: ${e.error ?? ''}`;
    if (e.status === 'cancelled') return t`Stopped`;
    if (e.available) return t`Ready — ${sizeOf(e.size)}, until ${date(e.expiresAt)}`;
    return t`Expired (removed after 7 days)`;
  };

  return (
    <div className="glass-card p-4 flex flex-col gap-4">
      <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
        <Archive className="w-4 h-4" /> <Trans>Data of the institution</Trans>
      </h4>
      {error && <div className="flex items-start gap-2 text-[13px] text-[#b23b3b] dark:text-[#f08c8c]"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}</div>}

      {/* ── Export ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="font-semibold text-[13px] text-ink dark:text-[#f5f2ea]"><Trans>Export the data</Trans></span>
        <p className="text-[11.5px] text-muted dark:text-[#c3beb0] -mt-1">
          <Trans>One archive with everything this Druid holds: the database (PostgreSQL, restorable as is), the dashboards of the labs and the list of the accounts. It is prepared on the server, you receive an e-mail when it is ready, and it can be downloaded here for 7 days. It holds personal data: keep it safe.</Trans>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnDark} disabled={busy || !!live} onClick={() => run(() => call('POST', '/exports'))}>
            {live ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />} <Trans>Prepare an export</Trans>
          </button>
        </div>
        {!!exports?.length && (
          <ul className="flex flex-col gap-1.5">
            {exports.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className="text-muted dark:text-[#8f897c]">{dateTime(e.createdAt)}</span>
                <span className={e.status === 'failed' ? 'text-[#b3441f] dark:text-[#e08a6a]' : 'text-ink dark:text-[#f5f2ea]'}>{statusText(e)}</span>
                {e.available && (
                  <a className={btnLight} href={`/api/tenant/exports/${e.id}/download`} download={e.fileName ?? undefined}>
                    <Download className="w-3.5 h-3.5" /> <Trans>Download</Trans>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Deletion ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-white/60 dark:border-white/10">
        <span className="font-semibold text-[13px] text-ink dark:text-[#f5f2ea]"><Trans>Delete this Druid</Trans></span>
        {deletion ? (
          <>
            <p className="flex items-start gap-2 text-[12.5px] font-semibold text-[#b3441f] dark:text-[#e08a6a]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span><Trans>Deletion planned on {date(deletion.deleteAfter)} (asked by {deletion.requestedBy ?? '—'} on {date(deletion.requestedAt)}). Until then the Druid is read-only; export its data now if you need them.</Trans></span>
            </p>
            <div>
              <button type="button" className={btnLight} disabled={busy} onClick={() => { if (window.confirm(t`Cancel the deletion? The Druid becomes writable again.`)) run(() => call('DELETE', '/deletion'), reloadApp); }}>
                <RotateCcw className="w-3.5 h-3.5" /> <Trans>Cancel the deletion</Trans>
              </button>
            </div>
          </>
        ) : (
          <details className="text-[12px] text-muted dark:text-[#c3beb0]">
            <summary className="cursor-pointer font-semibold"><Trans>Ask for the deletion of this Druid and of all its data</Trans></summary>
            <div className="flex flex-col gap-2 pt-2">
              <p className="text-[11.5px]">
                <Trans>The Druid becomes read-only at once for every account, and is deleted for good 30 days later: database, dashboards, exports, accounts and keys. Every owner receives an e-mail; until the last day an owner can cancel here. Prepare an export first if you want to keep the data.</Trans>
              </p>
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => call('POST', '/deletion', { confirm }), reloadApp); }}>
                <label className="flex flex-col gap-1 text-[11.5px] font-semibold">
                  <Trans>Type <code className="font-mono">{slug}</code> to confirm</Trans>
                  <input className={`${inputCls} w-64`} value={confirm} autoComplete="off" onChange={(e) => setConfirm(e.target.value)} />
                </label>
                <button type="submit" className={btnDanger} disabled={busy || confirm.trim().toLowerCase() !== slug}>
                  <Trash2 className="w-3.5 h-3.5" /> <Trans>Delete in 30 days</Trans>
                </button>
              </form>
            </div>
          </details>
        )}
      </div>
    </div>
  );
};
