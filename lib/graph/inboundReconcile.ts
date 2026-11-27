// Nightly reconciliation of the identifier actions with the SoVisu+ action table (lot 5 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md). SoVisu+ journals every action in its table `Action` (same transaction as
// the change) before publishing it, but a message can still be lost: SoVisu+ keeps undelivered messages in memory and
// drops them past 100 while marking the action `dispatched`, and the consumer may be down. The reconciliation reads the
// table (read-only role), rebuilds the messages Druid never received and hands them to the consumer's own code
// (processInboundMessage, channel `reconcile`). Its first run catches up since the move to CRISalid 1.7.
//
// The table is internal to SoVisu+ and may change with a release: its shape is checked first, and the run fails loudly
// instead of misreading it.
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.gen';
import { parseInboundMessage } from './inboundActions';
import { processInboundMessage, recordInboundFailure, type InboundMode } from './inboundPg';

/** Columns of `Action` the reconciliation reads, with the type families it accepts (format_type of PostgreSQL). */
const EXPECTED_COLUMNS: Record<string, RegExp> = {
  id: /^text$/,
  actionType: /^("ActionType"|text)$/,
  targetType: /^("ActionTargetType"|text)$/,
  targetUid: /^text$/,
  path: /^text$/,
  parameters: /^jsonb$/,
  timestamp: /^timestamp(\(\d\))? without time zone$/,
  dispatched: /^boolean$/,
  personUid: /^text$/,
};

export class ActionTableError extends Error {}

/** Differences between the columns of the table and what the reconciliation reads; empty when it can read it. */
export const actionSchemaProblems = (columns: { name: string; type: string }[]): string[] => {
  if (!columns.length) return ['table "Action" not found'];
  const byName = new Map(columns.map((c) => [c.name, c.type]));
  const problems: string[] = [];
  for (const [name, type] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = byName.get(name);
    if (actual === undefined) problems.push(`column "${name}" missing`);
    else if (!type.test(actual)) problems.push(`column "${name}" is ${actual}`);
  }
  return problems;
};

export interface ActionRow {
  id: string;
  actionType: string;
  targetType: string;
  targetUid: string;
  path: string | null;
  parameters: unknown;
  /** UTC, without time zone in the table: read as text to keep it exact. */
  timestamp: string;
  dispatched: boolean;
  personUid: string;
}

/** ISO form (UTC) of a `timestamp without time zone` of the table, as SoVisu+ puts it in the message. */
export const isoTimestamp = (ts: string): string => {
  const t = ts.trim().replace(' ', 'T');
  return /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? new Date(t).toISOString() : new Date(`${t}Z`).toISOString();
};

/** The message SoVisu+ publishes for an action (ActionDispatchService), rebuilt from its row. */
export const actionRowToMessage = (row: ActionRow) => ({
  id: row.id, actionType: row.actionType, targetType: row.targetType, targetUid: row.targetUid, path: row.path,
  parameters: row.parameters, timestamp: isoTimestamp(row.timestamp), personUid: row.personUid, application: 'sovisuplus',
});

export type ReconcileMessage = ReturnType<typeof actionRowToMessage>;

/** uid and identifier type of a message, the key that orders the actions on one identifier (null: not one Druid takes). */
const identifierKey = (m: ReconcileMessage): string | null => {
  const p = parseInboundMessage(m);
  return p.ok ? `${p.action.uid}|${p.action.scheme}` : null;
};

/**
 * Among the messages Druid never received (in the order of the table), those to replay and those a later action on the
 * same identifier, already handled, has superseded: replaying an ADD after the REMOVE that followed it would bring back
 * a value the researcher removed. `latestHandled`: per `uid|scheme`, the timestamp of the latest handled action.
 */
export const selectReplays = (missing: ReconcileMessage[], latestHandled: Map<string, string>) => {
  const replay: ReconcileMessage[] = [];
  const superseded: ReconcileMessage[] = [];
  for (const m of [...missing].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))) {
    const key = identifierKey(m);
    const later = key ? latestHandled.get(key) : undefined;
    if (later && later > m.timestamp) superseded.push(m);
    else replay.push(m);
  }
  return { replay, superseded };
};

// ── Database side ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Columns of `Action` as the SoVisu+ connection resolves it. */
export const readActionColumns = async (svp: Kysely<any>): Promise<{ name: string; type: string }[]> =>
  (await sql<{ name: string; type: string }>`
    SELECT attname AS name, format_type(atttypid, atttypmod) AS type FROM pg_catalog.pg_attribute
    WHERE attrelid = to_regclass('"Action"') AND attnum > 0 AND NOT attisdropped`.execute(svp)).rows;

/** Identifier actions on a person since `since` (ISO date), in the order of the table. */
export const readIdentifierActions = async (svp: Kysely<any>, since: string): Promise<ActionRow[]> =>
  (await sql<ActionRow>`
    SELECT id, "actionType"::text AS "actionType", "targetType"::text AS "targetType", "targetUid", path, parameters,
           "timestamp"::text AS "timestamp", dispatched, "personUid"
    FROM "Action"
    WHERE path = 'identifiers' AND "targetType"::text = 'PERSON' AND "actionType"::text IN ('ADD', 'REMOVE')
      AND "timestamp" >= ${since}::timestamp
    ORDER BY "timestamp", id`.execute(svp)).rows;

const HANDLED = ['applied', 'task', 'ignored'];

export interface ReconcileReport {
  mode: Exclude<InboundMode, 'off'>;
  since: string;
  /** Identifier actions of the table in the window. */
  scanned: number;
  /** Already received through the bus (or a previous reconciliation). */
  known: number;
  /** Replayed now, by resulting status (planned in dry-run). */
  replayed: Record<string, number>;
  /** Not replayed: a later action on the same identifier was already handled. */
  superseded: number;
  /** Actions SoVisu+ never published (`dispatched` false for more than an hour): its dispatch is stuck. */
  undispatched: number;
  /** `uid (type)` of the replayed messages, for the logs: never a value. */
  labels: string[];
}

/** One reconciliation pass: checks the table, replays what Druid never received, journals what was superseded. */
export const runReconcile = async ({ db, svp, mode, since, now = new Date() }: {
  db: Kysely<DB>; svp: Kysely<any>; mode: Exclude<InboundMode, 'off'>; since: string; now?: Date;
}): Promise<ReconcileReport> => {
  const problems = actionSchemaProblems(await readActionColumns(svp));
  if (problems.length) throw new ActionTableError(`the SoVisu+ action table changed (${problems.join('; ')}): reconciliation refused`);

  const rows = await readIdentifierActions(svp, since);
  const report: ReconcileReport = { mode, since, scanned: rows.length, known: 0, replayed: {}, superseded: 0, undispatched: 0, labels: [] };
  const hourAgo = now.getTime() - 3600_000;
  report.undispatched = rows.filter((r) => !r.dispatched && new Date(isoTimestamp(r.timestamp)).getTime() < hourAgo).length;
  if (!rows.length) return report;

  // What Druid already has: handled (or read in dry-run, which the next `on` start replays).
  const known = new Set<string>();
  for (let i = 0; i < rows.length; i += 1000) {
    const ids = rows.slice(i, i + 1000).map((r) => r.id);
    for (const r of await db.selectFrom('inbound_graph_action').select(['id', 'status']).where('id', 'in', ids).execute()) {
      if (HANDLED.includes(r.status) || r.status === 'planned') known.add(r.id);
    }
  }
  report.known = known.size;
  const missing = rows.filter((r) => !known.has(r.id)).map(actionRowToMessage);
  if (!missing.length) return report;

  // Latest handled action per identifier of the persons concerned (from the journal of Druid).
  const uids = [...new Set(missing.map((m) => (m.targetUid.startsWith('local-') ? m.targetUid.slice(6) : '')).filter(Boolean))];
  const latestHandled = new Map<string, string>();
  if (uids.length) {
    const handled = await db.selectFrom('inbound_graph_action').select(['payload']).where('uid', 'in', uids)
      .where('status', 'in', HANDLED).execute();
    for (const h of handled) {
      const m = h.payload as any;
      const key = m && typeof m.timestamp === 'string' ? identifierKey(m) : null;
      if (key && (!latestHandled.has(key) || latestHandled.get(key)! < m.timestamp)) latestHandled.set(key, m.timestamp);
    }
  }

  const { replay, superseded } = selectReplays(missing, latestHandled);
  for (const m of replay) {
    const raw = JSON.stringify(m);
    try {
      const r = await processInboundMessage(db, raw, mode, { channel: 'reconcile' });
      report.replayed[r.status] = (report.replayed[r.status] ?? 0) + 1;
      report.labels.push(r.label);
    } catch (err) {
      // Journaled as failed, tried again by the next pass; the other messages go on.
      await recordInboundFailure(db, raw, err, 'reconcile').catch(() => {});
      report.replayed.failed = (report.replayed.failed ?? 0) + 1;
    }
  }
  for (const m of superseded) {
    const p = parseInboundMessage(m);
    await db.insertInto('inbound_graph_action').values({
      id: m.id, channel: 'reconcile', status: 'ignored', reason: 'superseded', payload: JSON.stringify(m),
      application: 'sovisuplus', action_type: m.actionType, uid: p.ok ? p.action.uid : null,
      identifier_type: p.ok ? p.action.sovisuplusType : null, value: p.ok ? p.action.value : null,
      authenticated: p.ok ? p.action.authenticated : false, processed_at: now.toISOString(),
    } as any).onConflict((oc) => oc.column('id').doNothing()).execute();
  }
  report.superseded = superseded.length;
  return report;
};
