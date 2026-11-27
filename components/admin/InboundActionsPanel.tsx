import React, { useEffect, useState } from 'react';
import { ChevronRight, Inbox } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { numberLocale } from '../../lib/i18n';

/** GET /api/graph-inbound-status (server.cjs, lib/graph/inboundPg.ts inboundOverview); dates as ISO strings. */
type InboundStatus =
  | { available: false }
  | {
      available: true;
      counts: Record<'planned' | 'applied' | 'task' | 'ignored' | 'failed', number>;
      channels: Record<'bus' | 'reconcile', number>;
      lastReceivedAt: string | null;
      openTasks: number;
      recent: { id: string; uid: string | null; type: string | null; value: string | null; action: string | null; status: string;
        reason: string | null; channel: string; receivedAt: string }[];
      failed: { id: string; uid: string | null; type: string | null; attempts: number; lastError: string | null; updatedAt: string }[];
    };

const TYPE_LABELS: Record<string, string> = { orcid: 'ORCID', idref: 'IdRef', idhals: 'idHAL', idhali: 'idHAL (n°)' };

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(numberLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * @component InboundActionsPanel
 * @description Follow-up of the identifier actions coming back from SoVisu+ (Administration, lot 6 of druid-internal
 * docs/plan-retour-identifiants-sovisuplus.md): researchers and library staff add and remove identifiers in SoVisu+;
 * Druid reads them from the CRISalid bus (and replays at night those the bus did not deliver) and takes them over in the
 * record. Shows what was applied, what waits for a decision (tasks « To process »), what failed, and the messages read
 * in dry-run mode. Hidden before the first message and on instances without the CRISalid bus.
 */
export const InboundActionsPanel: React.FC<{
  /** Opens the record of a directory person. */
  onOpenResearcher?: (uid: string) => void;
}> = ({ onOpenResearcher }) => {
  const { t } = useLingui();
  const [status, setStatus] = useState<InboundStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/graph-inbound-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, []);

  if (!status?.available) return null;

  const statusLabel: Record<string, string> = {
    planned: t`dry run`, applied: t`applied`, task: t`to decide`, ignored: t`ignored`, failed: t`failed`,
  };
  const person = (uid: string | null) => (!uid ? <span>—</span> : onOpenResearcher
    ? <button type="button" onClick={() => onOpenResearcher(uid)} className="font-semibold text-ink dark:text-[#f5f2ea] hover:underline">{uid}</button>
    : <span className="font-semibold text-ink dark:text-[#f5f2ea]">{uid}</span>);
  const section = (title: React.ReactNode, rows: React.ReactNode[], hint?: React.ReactNode) => rows.length > 0 && (
    <div>
      <div className="text-[12px] font-semibold text-muted dark:text-[#8f897c]">{title}</div>
      {hint && <div className="text-[11px] text-muted-light dark:text-[#8f897c]">{hint}</div>}
      <ul className="mt-1 max-h-48 overflow-auto space-y-0.5 text-[12px]">{rows}</ul>
    </div>
  );
  const alert = status.failed.length > 0;

  return (
    <details className={`group rounded-card bg-white/40 dark:bg-white/5 border overflow-hidden ${
      alert ? 'border-red-300 dark:border-red-400/40' : 'border-ink/5 dark:border-white/10'}`}>
      <summary className="list-none [&::-webkit-details-marker]:hidden px-4 py-2 text-[12px] font-semibold text-muted dark:text-[#8f897c] flex flex-wrap items-center gap-x-3 gap-y-1 cursor-pointer hover:bg-accent/10 transition-colors">
        <span className="inline-flex items-center gap-1.5 text-ink dark:text-[#f5f2ea]">
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
          <Inbox className="w-3.5 h-3.5 text-[#7a9a24]" /> <Trans>Identifiers changed in SoVisu+</Trans>
        </span>
        {status.counts.planned > 0 && (
          <span className="pill px-2 py-0.5 bg-[rgba(224,158,42,.15)] text-[#a86f12]"><Trans>dry run: {status.counts.planned} read, nothing applied</Trans></span>
        )}
        <span><Trans>{status.counts.applied} applied</Trans></span>
        <span><Trans>{status.openTasks} tasks to do</Trans></span>
        <span className={status.failed.length ? 'text-red-600 dark:text-red-400' : ''}><Trans>{status.failed.length} failed</Trans></span>
        <span><Trans>last received {formatDate(status.lastReceivedAt)}</Trans></span>
        <span className="ml-auto underline decoration-dotted underline-offset-2 group-open:hidden"><Trans>Details</Trans></span>
        <span className="ml-auto underline decoration-dotted underline-offset-2 hidden group-open:inline"><Trans>Hide</Trans></span>
      </summary>
      <div className="px-4 py-3 space-y-3 text-[12px] text-muted-light dark:text-[#8f897c]">
        <p>
          <Trans>
            Researchers and library staff add and remove identifiers in SoVisu+. Druid receives these actions from the
            CRISalid bus and takes them over in the record: a removal is applied and set aside, an authenticated
            identifier becomes the primary one, an addition never replaces another value. The cases to settle become tasks
            « To process ». Every night, the actions the bus did not deliver are read again from SoVisu+.
          </Trans>
        </p>
        <p>
          <Trans>
            Received from the bus: {status.channels.bus}; replayed from SoVisu+ at night: {status.channels.reconcile}. Many
            replays mean that messages are lost on the bus.
          </Trans>
        </p>
        {section(<Trans>Failed ({status.failed.length})</Trans>, status.failed.map((f) => (
          <li key={f.id}>
            {person(f.uid)} <span className="text-muted-light dark:text-[#8f897c]">· {TYPE_LABELS[f.type ?? ''] ?? f.type ?? '—'} ·</span>{' '}
            <span className="text-red-600 dark:text-red-400">{f.lastError}</span>{' '}
            <Trans>({f.attempts} attempts, last on {formatDate(f.updatedAt)})</Trans>
          </li>
        )), <Trans>Tried again by the night reconciliation.</Trans>)}
        {section(<Trans>Recently received ({status.recent.length})</Trans>, status.recent.map((r) => (
          <li key={r.id}>
            {formatDate(r.receivedAt)} — {person(r.uid)}{' '}
            <span className="text-muted-light dark:text-[#8f897c]">
              · {r.action === 'ADD' ? t`added` : r.action === 'REMOVE' ? t`removed` : r.action ?? '—'} {TYPE_LABELS[r.type ?? ''] ?? r.type ?? ''}
            </span>{' '}
            {r.value && <span className="font-mono">{r.value}</span>}{' '}
            · <span className={r.status === 'failed' ? 'text-red-600 dark:text-red-400' : r.status === 'task' ? 'text-[#a86f12]' : ''}>{statusLabel[r.status] ?? r.status}</span>
            {r.reason && <span className="text-muted-light dark:text-[#8f897c]"> ({r.reason})</span>}
            {r.channel === 'reconcile' && <span className="text-muted-light dark:text-[#8f897c]"> · <Trans>replayed at night</Trans></span>}
          </li>
        )))}
      </div>
    </details>
  );
};
