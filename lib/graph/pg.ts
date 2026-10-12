// PostgreSQL side of the corrections carried to the CRISalid knowledge graph (lot 11 of druid-internal
// docs/plan-migration-postgresql.md): reads what planGraphActions compares, records its plan in the outbox
// (graph_action) and keeps graph_identifier_state in step with what is actually sent. The publisher (lot 11 d) runs a
// pass in one transaction (plan recorded), then publishes the pending actions one by one.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import {
  GRAPH_TYPE_OF_SCHEME, comparableValue, planGraphActions,
  type GraphActionPlan, type GraphIdentifier, type GraphIdentifierType, type OpenAction,
} from './identifierActions';

type Queryable = Kysely<DB> | Transaction<DB>;

/** Runs `fn` in the caller's transaction, or in a new one. */
const inTransaction = <T>(db: Queryable, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> =>
  db.isTransaction ? fn(db as Transaction<DB>) : db.transaction().execute(fn);

const SCHEMES = Object.keys(GRAPH_TYPE_OF_SCHEME) as (keyof typeof GRAPH_TYPE_OF_SCHEME)[];
const SCHEME_OF_TYPE = Object.fromEntries(Object.entries(GRAPH_TYPE_OF_SCHEME).map(([s, t]) => [t, s])) as Record<GraphIdentifierType, string>;
const OPEN_STATUSES = ['pending', 'blocked', 'failed'] as const;

/** One writer of the outbox and the state at a time: two concurrent passes would queue the same removal (the unique
 * index would refuse it), a snapshot loaded during a pass would be planned against half a state. */
const lockGraphActions = (trx: Transaction<DB>) => sql`SELECT pg_advisory_xact_lock(hashtext('druid.graph_actions'))`.execute(trx);

/** Above this many removals to send in one pass, the pass is refused: a wrong read of the directory must not turn
 * into a mass removal (each one deletes publications in the graph). Lifted on purpose with `force`. */
export const MAX_REMOVALS_PER_PASS = 25;

export class GraphPlanRefused extends Error {
  constructor(readonly toSend: number, readonly limit: number) {
    super(`${toSend} identifier removals to send in one pass (limit ${limit}): refused, check the plan and force it`);
  }
}

/** Primary identifiers of the directory, state, open actions: what planGraphActions compares. */
export const loadGraphPlanInput = async (db: Queryable) => {
  const [identifiers, persons, state, open] = await Promise.all([
    db.selectFrom('person_identifier as pi').innerJoin('person as p', 'p.id', 'pi.person_id')
      .select(['p.uid', 'pi.scheme', 'pi.value'])
      .where('pi.is_primary', '=', true).where('pi.scheme', 'in', SCHEMES).where('p.uid', 'is not', null).execute(),
    db.selectFrom('person').select('uid').where('uid', 'is not', null).execute(),
    db.selectFrom('graph_identifier_state').select(['uid', 'type', 'value']).orderBy('uid').orderBy('type').execute(),
    db.selectFrom('graph_action').select(['id', 'uid', 'type', 'value', 'status'])
      .where('action_type', '=', 'REMOVE').where('status', 'in', OPEN_STATUSES).execute(),
  ]);
  return {
    directory: identifiers.map((i): GraphIdentifier => ({
      uid: i.uid!, type: GRAPH_TYPE_OF_SCHEME[i.scheme as keyof typeof GRAPH_TYPE_OF_SCHEME], value: i.value,
    })),
    uids: persons.map((p) => p.uid!),
    state: state as GraphIdentifier[],
    open: open as OpenAction[],
  };
};

/**
 * Author of a correction: last actor that deleted or changed this identifier of this person (audit log), null when
 * the log has none (a job without actor, a change older than the database).
 */
const correctionActor = async (trx: Transaction<DB>, id: GraphIdentifier): Promise<string | null> => {
  const row = await trx.selectFrom('audit_log as a')
    .innerJoin('person as p', (j) => j.on(sql<boolean>`p.id = (a.before ->> 'person_id')::uuid`))
    .select('a.actor')
    .where('a.table_name', '=', 'person_identifier').where('a.action', 'in', ['delete', 'update'])
    .where('p.uid', '=', id.uid)
    .where(sql`a.before ->> 'scheme'`, '=', SCHEME_OF_TYPE[id.type])
    .where(sql`lower(a.before ->> 'value')`, '=', comparableValue(id.value))
    .where('a.actor', 'is not', null)
    .orderBy('a.at', 'desc').limit(1)
    .executeTakeFirst();
  return row?.actor ?? null;
};

export interface RecordedPlan {
  queued: number;
  blocked: number;
  /** The removals queued (pending) and blocked by the pass: person and type, for the logs. */
  queuedActions: { uid: string; type: string }[];
  blockedActions: { uid: string; type: string }[];
  unblocked: number;
  cancelled: number;
  unreadable: GraphIdentifier[];
  orphans: string[];
}

/** Records a plan in the outbox (inside the caller's transaction). Refuses a pass with too many removals to send. */
export const recordGraphPlan = async (
  trx: Transaction<DB>, plan: GraphActionPlan, { force = false, limit = MAX_REMOVALS_PER_PASS } = {},
): Promise<RecordedPlan> => {
  const toSend = plan.removals.filter((r) => r.status === 'pending').length + plan.unblocked.length;
  if (toSend > limit && !force) throw new GraphPlanRefused(toSend, limit);
  for (const r of plan.removals) {
    await trx.insertInto('graph_action').values({
      action_type: 'REMOVE', uid: r.uid, type: r.type, value: r.value, status: r.status, actor: await correctionActor(trx, r),
    }).execute();
  }
  if (plan.unblocked.length) {
    await trx.updateTable('graph_action').set({ status: 'pending' }).where('id', 'in', plan.unblocked).where('status', '=', 'blocked').execute();
  }
  if (plan.cancelled.length) {
    await trx.updateTable('graph_action').set({ status: 'cancelled' }).where('id', 'in', plan.cancelled).where('status', 'in', OPEN_STATUSES).execute();
  }
  return {
    queued: plan.removals.filter((r) => r.status === 'pending').length,
    blocked: plan.removals.filter((r) => r.status === 'blocked').length,
    queuedActions: plan.removals.filter((r) => r.status === 'pending').map(({ uid, type }) => ({ uid, type })),
    blockedActions: plan.removals.filter((r) => r.status === 'blocked').map(({ uid, type }) => ({ uid, type })),
    unblocked: plan.unblocked.length,
    cancelled: plan.cancelled.length,
    unreadable: plan.unreadable,
    orphans: plan.orphans,
  };
};

/** One reconciliation pass: reads, plans and records in a single transaction (nothing is sent here). */
export const planAndRecordGraphActions = (
  db: Queryable, options: { force?: boolean; limit?: number; accepted?: Iterable<GraphIdentifierType> } = {},
): Promise<RecordedPlan> =>
  inTransaction(db, async (trx) => {
    await lockGraphActions(trx);
    const input = await loadGraphPlanInput(trx);
    return recordGraphPlan(trx, planGraphActions({ ...input, accepted: options.accepted }), options);
  });

/** Actions to publish, oldest first; `failed` ones are retried after the pending ones. */
export const actionsToSend = (db: Queryable, limit = MAX_REMOVALS_PER_PASS) =>
  db.selectFrom('graph_action').select(['id', 'uid', 'type', 'value', 'actor', 'attempts', 'created_at'])
    .where('status', 'in', ['pending', 'failed'])
    .orderBy(sql`status = 'failed'`).orderBy('created_at').orderBy('id').limit(limit)
    .execute() as Promise<(GraphIdentifier & { id: string; actor: string | null; attempts: number; created_at: Date })[]>;

/** The bus accepted the message: the graph no longer holds the identifier as far as Druid knows. */
export const markGraphActionSent = (db: Queryable, id: string) =>
  inTransaction(db, async (trx) => {
    const action = await trx.updateTable('graph_action')
      .set((eb) => ({ status: 'sent', sent_at: sql`now()`, attempts: eb('attempts', '+', 1), last_error: null }))
      .where('id', '=', id).where('status', 'in', ['pending', 'failed'])
      .returning(['uid', 'type', 'value']).executeTakeFirst();
    if (!action) return false;
    await trx.deleteFrom('graph_identifier_state').where('uid', '=', action.uid).where('type', '=', action.type)
      .where(sql`lower(value)`, '=', comparableValue(action.value)).execute();
    return true;
  });

/** The bus refused the message (or could not be reached): retried at the next pass. */
export const markGraphActionFailed = (db: Queryable, id: string, error: string) =>
  db.updateTable('graph_action')
    .set((eb) => ({ status: 'failed', attempts: eb('attempts', '+', 1), last_error: error.slice(0, 2000) }))
    .where('id', '=', id).where('status', 'in', ['pending', 'failed']).execute();

/** Removals published before `takenAt`: a snapshot taken afterwards shows whether the IKG applied them. */
export const removalsSentBefore = (db: Queryable, takenAt: string) =>
  db.selectFrom('graph_action').select(['id', 'uid', 'type', 'value', 'sent_at'])
    .where('action_type', '=', 'REMOVE').where('status', '=', 'sent').where('sent_at', '<', new Date(takenAt))
    .orderBy('sent_at').execute() as Promise<(GraphIdentifier & { id: string; sent_at: Date | null })[]>;

/**
 * Replaces the state with a snapshot of the graph (origin `snapshot`) and returns the previous state, for the report.
 * The snapshot is the truth: rows written since by people.csv exports or sent removals are replaced as well.
 */
export const replaceGraphState = (db: Queryable, identifiers: GraphIdentifier[]): Promise<GraphIdentifier[]> =>
  inTransaction(db, async (trx) => {
    await lockGraphActions(trx);
    const previous = await trx.selectFrom('graph_identifier_state').select(['uid', 'type', 'value']).execute() as GraphIdentifier[];
    await trx.deleteFrom('graph_identifier_state').execute();
    for (let i = 0; i < identifiers.length; i += 1000) {
      await trx.insertInto('graph_identifier_state')
        .values(identifiers.slice(i, i + 1000).map(({ uid, type, value }) => ({ uid, type, value, origin: 'snapshot' })))
        .execute();
    }
    return previous;
  });

/**
 * Gate of the people.csv export (server.cjs, /api/sync-sovisuplus) while the publisher is on. people.csv drops an
 * identifier from the person of the graph without cleaning up the publications harvested with it, so every removal
 * must have been sent first: `toSend` > 0 refuses the export. `keep`: values whose removal the IKG refuses yet
 * (blocked); people.csv writes them instead of the directory value, so that the graph keeps them and the removal can
 * still be sent once the IKG accepts the type.
 */
export const peopleCsvGate = async (db: Queryable, accepted?: Iterable<GraphIdentifierType>) => {
  const input = await loadGraphPlanInput(db);
  const plan = planGraphActions({ ...input, accepted });
  const cancelled = new Set(plan.cancelled);
  const unblocked = new Set(plan.unblocked);
  const open = input.open.filter((a) => !cancelled.has(a.id));
  const toSend = open.filter((a) => a.status !== 'blocked' || unblocked.has(a.id)).length
    + plan.removals.filter((r) => r.status === 'pending').length;
  const keep = [
    ...open.filter((a) => a.status === 'blocked' && !unblocked.has(a.id)),
    ...plan.removals.filter((r) => r.status === 'blocked'),
  ].map(({ uid, type, value }): GraphIdentifier => ({ uid, type, value }));
  return { toSend, keep };
};

/**
 * After a people.csv export: once cdb has loaded it, the graph holds for each exported person exactly the exported
 * identifiers (origin `people_csv`). Persons left out of the file keep their state.
 */
export const recordPeopleCsvExport = (db: Queryable, uids: string[], identifiers: GraphIdentifier[]) =>
  inTransaction(db, async (trx) => {
    await lockGraphActions(trx);
    for (let i = 0; i < uids.length; i += 1000) {
      await trx.deleteFrom('graph_identifier_state').where('uid', 'in', uids.slice(i, i + 1000)).execute();
    }
    const rows = new Map<string, GraphIdentifier>();
    for (const id of identifiers) {
      const k = `${id.uid}\u0000${id.type}`;
      if (id.value.trim() && !rows.has(k)) rows.set(k, id);
    }
    const values = [...rows.values()].map(({ uid, type, value }) => ({ uid, type, value: value.trim(), origin: 'people_csv' }));
    for (let i = 0; i < values.length; i += 1000) {
      await trx.insertInto('graph_identifier_state').values(values.slice(i, i + 1000)).execute();
    }
    return values.length;
  });
