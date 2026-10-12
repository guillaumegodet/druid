import React, { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { Trans } from '@lingui/react/macro';
import { numberLocale } from '../../lib/i18n';

type Identifier = { uid: string; type: string; value: string };

/** GET /api/graph-actions-status (server.cjs, lib/graph/pg.ts graphActionsOverview); dates as ISO strings. */
type GraphActionsStatus =
  | { available: false }
  | {
      available: true;
      mode: 'dry-run' | 'on';
      counts: Record<'pending' | 'sent' | 'blocked' | 'failed' | 'cancelled', number>;
      toQueue: Identifier[];
      pending: (Identifier & { created_at: string })[];
      failed: (Identifier & { attempts: number; last_error: string | null; updated_at: string })[];
      blocked: (Identifier & { created_at: string })[];
      recentSent: (Identifier & { actor: string | null; sent_at: string | null })[];
      unreadable: Identifier[];
      orphans: string[];
      state: { snapshot: number; peopleCsv: number; lastSnapshotAt: string | null; lastPeopleCsvAt: string | null };
    };

const TYPE_LABELS: Record<string, string> = { orcid: 'ORCID', idref: 'IdRef', idhals: 'idHAL', idhali: 'idHAL (n°)', scopus: 'Scopus' };

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(numberLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * @component GraphActionsPanel
 * @description Follow-up of the identifier removals Druid sends to the CRISalid knowledge graph (Administration, lot 11
 * e of druid-internal docs/plan-migration-postgresql.md): an identifier removed or changed in the directory leaves as a
 * REMOVE user action so that the graph cleans up the publications harvested with it. Lists the failed, pending,
 * blocked (type the IKG refuses yet) and recently sent removals, the directory values to correct and the persons of
 * the graph without a record. Hidden when the publisher is off or the instance is not on PostgreSQL. Unmounted during a
 * SoVisu+ export (which sends the pending removals first), hence read again after it.
 */
export const GraphActionsPanel: React.FC<{
  /** Opens the record of a directory person. */
  onOpenResearcher?: (uid: string) => void;
}> = ({ onOpenResearcher }) => {
  const [status, setStatus] = useState<GraphActionsStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/graph-actions-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, []);

  if (!status?.available) return null;

  const toSend = status.pending.length + status.toQueue.length;
  const alert = status.failed.length > 0 || status.unreadable.length > 0;
  const person = (uid: string) => (onOpenResearcher
    ? <button type="button" onClick={() => onOpenResearcher(uid)} className="font-semibold text-ink dark:text-[#f5f2ea] hover:underline">{uid}</button>
    : <span className="font-semibold text-ink dark:text-[#f5f2ea]">{uid}</span>);
  const identifier = (a: Identifier) => (
    <>{person(a.uid)} <span className="text-muted-light dark:text-[#8f897c]">· {TYPE_LABELS[a.type] ?? a.type} ·</span>{' '}
      <span className="font-mono">{a.value}</span></>
  );
  const section = (title: React.ReactNode, rows: React.ReactNode[], hint?: React.ReactNode) => rows.length > 0 && (
    <div>
      <div className="text-[12px] font-semibold text-muted dark:text-[#8f897c]">{title}</div>
      {hint && <div className="text-[11px] text-muted-light dark:text-[#8f897c]">{hint}</div>}
      <ul className="mt-1 max-h-48 overflow-auto space-y-0.5 text-[12px]">{rows}</ul>
    </div>
  );

  return (
    <details className={`rounded-card bg-white/40 dark:bg-white/5 border overflow-hidden ${
      alert ? 'border-red-300 dark:border-red-400/40' : 'border-ink/5 dark:border-white/10'}`}>
      <summary className="px-4 py-2 text-[12px] font-semibold text-muted dark:text-[#8f897c] flex flex-wrap items-center gap-x-3 gap-y-1 cursor-pointer hover:bg-accent/10 transition-colors">
        <span className="inline-flex items-center gap-1.5 text-ink dark:text-[#f5f2ea]">
          <Share2 className="w-3.5 h-3.5 text-[#e09e2a]" /> <Trans>Identifier removals sent to the CRISalid graph</Trans>
        </span>
        {status.mode === 'dry-run' && (
          <span className="pill px-2 py-0.5 bg-[rgba(224,158,42,.15)] text-[#a86f12]"><Trans>dry run: nothing is sent</Trans></span>
        )}
        <span><Trans>{status.counts.sent} sent</Trans></span>
        <span><Trans>{toSend} to send</Trans></span>
        <span><Trans>{status.counts.blocked} blocked</Trans></span>
        <span className={status.failed.length ? 'text-red-600 dark:text-red-400' : ''}><Trans>{status.failed.length} failed</Trans></span>
        {status.unreadable.length > 0 && (
          <span className="text-red-600 dark:text-red-400"><Trans>{status.unreadable.length} values to correct</Trans></span>
        )}
      </summary>
      <div className="px-4 py-3 space-y-3 text-[12px] text-muted-light dark:text-[#8f897c]">
        <p>
          <Trans>
            An identifier removed or changed in the directory is sent to the CRISalid graph as a removal, so that the
            graph cleans up the publications harvested with it. One pass every night; the SoVisu+ export sends the
            pending removals first. The graph acknowledges nothing: a new snapshot of the graph checks that they were
            applied.
          </Trans>
        </p>
        <p>
          <Trans>
            Known state of the graph: {status.state.peopleCsv} identifiers from the people.csv export of{' '}
            {formatDate(status.state.lastPeopleCsvAt)}, {status.state.snapshot} from the snapshot of{' '}
            {formatDate(status.state.lastSnapshotAt)}.
          </Trans>
        </p>
        {section(<Trans>Failed ({status.failed.length})</Trans>, status.failed.map((a) => (
          <li key={`${a.uid}|${a.type}|${a.value}`}>
            {identifier(a)} — <span className="text-red-600 dark:text-red-400">{a.last_error}</span>{' '}
            <Trans>({a.attempts} attempts, last on {formatDate(a.updated_at)})</Trans>
          </li>
        )), <Trans>Sent again at the next pass.</Trans>)}
        {section(<Trans>To send ({toSend})</Trans>, [...status.pending, ...status.toQueue].map((a) => (
          <li key={`${a.uid}|${a.type}|${a.value}`}>{identifier(a)}</li>
        )), <Trans>At the next pass, or at the next SoVisu+ export.</Trans>)}
        {section(<Trans>Blocked ({status.blocked.length})</Trans>, status.blocked.map((a) => (
          <li key={`${a.uid}|${a.type}|${a.value}`}>{identifier(a)}</li>
        )), <Trans>The graph does not accept the removal of this type of identifier yet: the export to SoVisu+ keeps the value until it does.</Trans>)}
        {section(<Trans>Values to correct in the directory ({status.unreadable.length})</Trans>, status.unreadable.map((a) => (
          <li key={`${a.uid}|${a.type}|${a.value}`}>{identifier(a)}</li>
        )), <Trans>Not a well-formed identifier (several values in one field, « N/C »…): no removal can be derived from it.</Trans>)}
        {section(<Trans>Recently sent ({status.recentSent.length} of {status.counts.sent})</Trans>, status.recentSent.map((a) => (
          <li key={`${a.uid}|${a.type}|${a.value}|${a.sent_at}`}>
            {identifier(a)} — {formatDate(a.sent_at)}{a.actor ? <> · <Trans>correction by {a.actor}</Trans></> : null}
          </li>
        )))}
        {section(<Trans>Persons of the graph without a record ({status.orphans.length})</Trans>, status.orphans.map((uid) => (
          <li key={uid} className="font-mono">{uid}</li>
        )), <Trans>Merged, renamed or deleted records: their identifiers stay in the graph, to settle by hand.</Trans>)}
      </div>
    </details>
  );
};
