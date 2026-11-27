// PostgreSQL side of the identifier actions coming back from SoVisu+ (lot 3 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md). For each message of the queue druid-person-actions: load the state of
// the record for the scheme of the action, derive the effects (lib/graph/inboundActions.ts), apply them through the
// provenance functions of the record, keep the known state of the graph in step and journal the message
// (inbound_graph_action), all in one transaction whose writes the audit log attributes to `sovisuplus:<person>`.
//
// DRUID_GRAPH_INBOUND chooses the mode: `off` (default), `dry-run` (the message is journaled `planned` with the effects
// it would have, nothing else is written; the messages are replayed when the mode turns `on`), `on`.
import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import { ALIGN_SOURCE_OF_SCHEME, liftRejection, recordIdentifierValues, rememberRemovedIdentifiers } from '../directory/pg/identifierProvenance';
import { GRAPH_TYPE_OF_SCHEME, comparableValue } from './identifierActions';
import {
  REMOVED_IN_SOVISUPLUS, parseInboundMessage, planInboundEffects,
  type InboundAction, type InboundConflictKind, type InboundEffect, type InboundPersonState, type InboundPlan,
} from './inboundActions';
import { lockGraphActions } from './pg';

export type InboundMode = 'off' | 'dry-run' | 'on';
const MODES: InboundMode[] = ['off', 'dry-run', 'on'];

export const inboundModeFromEnv = (env: Record<string, string | undefined>): InboundMode => {
  const mode = (env.DRUID_GRAPH_INBOUND || 'off').trim().toLowerCase() as InboundMode;
  if (!MODES.includes(mode)) throw new Error(`DRUID_GRAPH_INBOUND must be one of ${MODES.join(', ')}`);
  return mode;
};

/** Failures of one message before it goes to the dead-letter queue (dlq.druid-person-actions). */
export const MAX_INBOUND_ATTEMPTS = 3;

/** Task type of each conflict (« To process »); the shared identifier keeps the existing type. */
export const TASK_OF_CONFLICT: Record<InboundConflictKind, string> = {
  removed_by_researcher: 'sovisuplus_retrait_identifiant',
  replaced_by_researcher: 'sovisuplus_identifiant_remplace',
  differs_from_directory: 'sovisuplus_identifiant_different',
};

const SCHEME_LABEL: Record<string, string> = { orcid: 'ORCID', idref: 'IdRef', idhal: 'IdHAL', idhal_i: 'IdHAL_i' };

/** Title and description of a task, in French like the other tasks of the directory (scripts/lib/tasks_schema.cjs). */
const taskText = (e: Extract<InboundEffect, { kind: 'conflict' | 'task' }>, a: InboundAction): { title: string; description: string } => {
  const label = SCHEME_LABEL[e.scheme] ?? e.scheme;
  const ref = `(action SoVisu+ ${a.id}${a.timestamp ? ` du ${a.timestamp.slice(0, 10)}` : ''})`;
  if (e.kind === 'task') {
    return {
      title: 'Identifiant porté par deux personnes : le corriger',
      description: `${label} ${e.value} ajouté dans SoVisu+ ${ref}, déjà porté par ${e.otherUids.join(', ')} : non écrit dans la fiche.`,
    };
  }
  switch (e.conflict) {
    case 'removed_by_researcher':
      return {
        title: 'Identifiant retiré dans SoVisu+ : vérifier',
        description: `${label} ${e.value} retiré dans SoVisu+ ${ref} alors qu'il venait du LDAP ou d'une saisie dans Druid. `
          + 'Retiré de la fiche et écarté : le rétablir dans la fiche s’il était juste.',
      };
    case 'replaced_by_researcher':
      return {
        title: 'Identifiant remplacé par le chercheur : vérifier',
        description: `${label} ${e.value} authentifié dans SoVisu+ ${ref} : devenu principal ; l'ancien ${label} ${e.other} reste en secondaire.`,
      };
    case 'differs_from_directory':
      return {
        title: 'Identifiant différent dans SoVisu+ : choisir',
        description: `${label} ${e.value} ajouté dans SoVisu+ ${ref}, la fiche porte ${e.other} : non écrit. `
          + 'Le prochain export people.csv remettra la valeur de la fiche dans le graphe : choisir vite.',
      };
  }
};

// ── State of the record ─────────────────────────────────────────────────────────────────────────────────────────────

interface LoadedPerson {
  personId: string;
  name: string;
  state: InboundPersonState;
}

/** The record of the action's uid with its identifiers of that scheme, their sources, the values set aside and the
 * other records carrying the value; null when no record has that uid. */
export const loadInboundState = async (trx: Transaction<DB> | Kysely<DB>, a: InboundAction): Promise<LoadedPerson | null> => {
  const person = await trx.selectFrom('person').select(['id', 'first_name', 'last_name']).where('uid', '=', a.uid).executeTakeFirst();
  if (!person) return null;
  const [ids, sources, rejected, holders] = await Promise.all([
    trx.selectFrom('person_identifier').select(['value', 'is_primary']).where('person_id', '=', person.id).where('scheme', '=', a.scheme).execute(),
    trx.selectFrom('person_identifier_source').select(['value', 'source']).where('person_id', '=', person.id).where('scheme', '=', a.scheme).execute(),
    ALIGN_SOURCE_OF_SCHEME[a.scheme]
      ? trx.selectFrom('alignment_candidate').select('candidate_id').where('person_id', '=', person.id)
        .where('source', '=', ALIGN_SOURCE_OF_SCHEME[a.scheme]).where('decision', '=', 'Rejeté').execute()
      : Promise.resolve([] as { candidate_id: string }[]),
    trx.selectFrom('person_identifier as pi').innerJoin('person as p', 'p.id', 'pi.person_id').select('p.uid')
      .where('pi.scheme', '=', a.scheme).where(sql<string>`lower(pi.value)`, '=', comparableValue(a.value))
      .where('pi.person_id', '<>', person.id).execute(),
  ]);
  const same = (x: string, y: string) => comparableValue(x) === comparableValue(y);
  return {
    personId: person.id,
    name: `${String(person.last_name ?? '').toUpperCase()} ${person.first_name ?? ''}`.trim(),
    state: {
      identifiers: ids.map((i) => ({
        value: i.value, isPrimary: !!i.is_primary, sources: sources.filter((s) => same(s.value, i.value)).map((s) => s.source),
      })),
      rejected: rejected.map((r) => r.candidate_id),
      otherHolders: [...new Set(holders.map((h) => h.uid).filter((u): u is string => !!u))],
    },
  };
};

// ── Effects ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const demoteOthers = (trx: Transaction<DB>, personId: string, scheme: string, value: string) =>
  trx.updateTable('person_identifier').set({ is_primary: false }).where('person_id', '=', personId).where('scheme', '=', scheme)
    .where('value', '<>', value).where('is_primary', '=', true).execute();

/** Applies the effects of a plan to the record (same tables and provenance functions as the record's own writes). */
export const applyInboundEffects = async (trx: Transaction<DB>, p: LoadedPerson, a: InboundAction, effects: InboundEffect[]): Promise<void> => {
  const by = `sovisuplus:${a.personUid}`;
  let n = 0;
  for (const e of effects) {
    switch (e.kind) {
      case 'record_source':
        await recordIdentifierValues(trx, p.personId, e.scheme, [e.value], e.source, by);
        break;
      case 'write':
        if (e.primary) await demoteOthers(trx, p.personId, e.scheme, e.value);
        await trx.insertInto('person_identifier').values({ person_id: p.personId, scheme: e.scheme, value: e.value, is_primary: e.primary, source: 'record' })
          .onConflict((oc) => oc.columns(['person_id', 'scheme', 'value']).doUpdateSet({ is_primary: e.primary })).execute();
        break;
      case 'set_primary':
        await demoteOthers(trx, p.personId, e.scheme, e.value);
        await trx.updateTable('person_identifier').set({ is_primary: true }).where('person_id', '=', p.personId).where('scheme', '=', e.scheme)
          .where('value', '=', e.value).execute();
        break;
      case 'remove':
        await trx.deleteFrom('person_identifier').where('person_id', '=', p.personId).where('scheme', '=', e.scheme).where('value', '=', e.value).execute();
        break;
      case 'reject':
        await rememberRemovedIdentifiers(trx, p.personId, e.scheme, [e.value], e.decidedBy, e.note || REMOVED_IN_SOVISUPLUS);
        break;
      case 'lift_rejection':
        await liftRejection(trx, p.personId, e.scheme, [e.value]);
        break;
      case 'conflict':
      case 'task': {
        const { title, description } = taskText(e, a);
        await trx.insertInto('task').values({
          key: `sovisuplus:${a.id}:${n++}`, type: e.kind === 'task' ? e.taskType : TASK_OF_CONFLICT[e.conflict],
          base: 'Annuaire', channel: 'interne', title, description, person_id: p.personId, uid: a.uid, person_name: p.name,
          origin: 'sovisuplus', created_by: 'job:graph_consume',
        }).onConflict((oc) => oc.column('key').doNothing()).execute();
        break;
      }
    }
  }
};

/** The graph applied the same message: the known state follows (one value per type, as in the graph). */
export const updateGraphStateForAction = async (trx: Transaction<DB>, a: InboundAction): Promise<void> => {
  const type = GRAPH_TYPE_OF_SCHEME[a.scheme];
  await lockGraphActions(trx);
  if (a.actionType === 'ADD') {
    await trx.insertInto('graph_identifier_state').values({ uid: a.uid, type, value: a.value, origin: 'sovisuplus' })
      .onConflict((oc) => oc.columns(['uid', 'type']).doUpdateSet({ value: a.value, origin: 'sovisuplus', updated_at: new Date().toISOString() } as any))
      .execute();
  } else {
    await trx.deleteFrom('graph_identifier_state').where('uid', '=', a.uid).where('type', '=', type)
      .where(sql<string>`lower(value)`, '=', comparableValue(a.value)).execute();
  }
};

// ── Messages ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How Druid received a message: from its queue, or replayed from the SoVisu+ action table (lot 5). */
export type InboundChannel = 'bus' | 'reconcile';

export interface InboundResult {
  id: string;
  status: 'planned' | 'applied' | 'task' | 'ignored' | 'duplicate';
  reason?: string;
  /** `uid (type)` for the logs: never the identifier value. */
  label: string;
}

const readPayload = (raw: string): { payload: unknown; id: string } => {
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { payload = { unreadable: raw.slice(0, 2000) }; }
  const id = payload && typeof payload === 'object' && typeof (payload as any).id === 'string' && (payload as any).id.trim()
    ? (payload as any).id.trim()
    : `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  return { payload, id };
};

const FINAL = new Set(['applied', 'task', 'ignored']);

/**
 * Handles one message of the queue in one transaction. A message already handled (same id) is a duplicate: nothing is
 * done again. In dry-run mode the message is journaled `planned`; in `on` mode a `planned` message is applied.
 */
export const processInboundMessage = async (db: Kysely<DB>, raw: string, mode: Exclude<InboundMode, 'off'>,
  { channel = 'bus' }: { channel?: InboundChannel } = {}): Promise<InboundResult> => {
  const { payload, id } = readPayload(raw);
  const parsed = parseInboundMessage(raw);
  const actor = parsed.ok ? `sovisuplus:${parsed.action.personUid}` : 'job:graph_consume';
  const label = parsed.ok ? `${parsed.action.uid} (${parsed.action.sovisuplusType})` : id;
  // In the caller's transaction when there is one (tests), else a transaction per message.
  const inTransaction = <T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> =>
    db.isTransaction ? fn(db as Transaction<DB>) : db.transaction().execute(fn);
  return inTransaction(async (trx) => {
    await sql`SELECT set_config('druid.actor', ${actor}, true)`.execute(trx);
    await sql`SELECT pg_advisory_xact_lock(hashtext('druid.inbound_graph_action'))`.execute(trx);
    const existing = await trx.selectFrom('inbound_graph_action').select(['status']).where('id', '=', id).executeTakeFirst();
    if (existing && (FINAL.has(existing.status) || (mode === 'dry-run' && existing.status === 'planned'))) {
      return { id, status: 'duplicate', label };
    }
    const a = parsed.ok ? parsed.action : null;
    let plan: InboundPlan;
    let person: LoadedPerson | null = null;
    if (!a) {
      plan = { outcome: 'ignored', reason: parsed.ok ? undefined : parsed.reason, effects: [] };
    } else {
      person = await loadInboundState(trx, a);
      plan = planInboundEffects(a, person?.state ?? null);
    }
    // A message that is not an action Druid takes over has nothing to replay: ignored in both modes.
    const status = mode === 'dry-run' && a ? 'planned' : plan.outcome;
    if (mode === 'on' && a) {
      if (person) await applyInboundEffects(trx, person, a, plan.effects);
      await updateGraphStateForAction(trx, a);
    }
    const row = {
      application: a?.application ?? ((payload as any)?.application ?? null), action_type: a?.actionType ?? null, uid: a?.uid ?? null,
      identifier_type: a?.sovisuplusType ?? null, value: a?.value ?? null, authenticated: a?.authenticated ?? false,
      status, reason: plan.reason ?? (parsed.ok ? null : parsed.detail ?? null), effects: JSON.stringify(plan.effects),
      processed_at: new Date().toISOString(), last_error: null,
    };
    await trx.insertInto('inbound_graph_action').values({ id, payload: JSON.stringify(payload), channel, ...row } as any)
      .onConflict((oc) => oc.column('id').doUpdateSet(row as any)).execute();
    return { id, status, reason: plan.reason, label };
  });
};

/** Journals a failure of a message (outside the failed transaction); returns the number of attempts so far. */
export const recordInboundFailure = async (db: Kysely<DB>, raw: string, error: unknown, channel: InboundChannel = 'bus'): Promise<number> => {
  const { payload, id } = readPayload(raw);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const row = await db.insertInto('inbound_graph_action')
    .values({ id, payload: JSON.stringify(payload), channel, status: 'failed', attempts: 1, last_error: message } as any)
    .onConflict((oc) => oc.column('id').doUpdateSet({
      status: 'failed', attempts: sql`inbound_graph_action.attempts + 1`, last_error: message,
    } as any))
    .returning('attempts').executeTakeFirstOrThrow();
  return row.attempts;
};

export type DeliveryVerdict = 'ack' | 'retry' | 'dead-letter';

/** What to tell the broker about a message: handled (ack), to try again, or to drop into the dead-letter queue. */
export const handleInboundDelivery = async (db: Kysely<DB>, raw: string, mode: Exclude<InboundMode, 'off'>,
  log: (line: string) => void = console.log): Promise<DeliveryVerdict> => {
  try {
    const r = await processInboundMessage(db, raw, mode);
    log(`[graph_consume] ${r.status}${r.reason ? ` (${r.reason})` : ''}: ${r.label}`);
    return 'ack';
  } catch (err) {
    const attempts = await recordInboundFailure(db, raw, err).catch(() => MAX_INBOUND_ATTEMPTS);
    log(`[graph_consume] failed (attempt ${attempts}/${MAX_INBOUND_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`);
    return attempts >= MAX_INBOUND_ATTEMPTS ? 'dead-letter' : 'retry';
  }
};

/** Messages read in dry-run mode, applied in order once the mode is `on` (at the start of the consumer). */
export const replayPlannedMessages = async (db: Kysely<DB>, log: (line: string) => void = console.log): Promise<number> => {
  // In the order of the actions (a message replayed by the reconciliation arrives after the later ones of the queue).
  const rows = await db.selectFrom('inbound_graph_action').select(['id', 'payload']).where('status', '=', 'planned')
    .orderBy(sql`payload ->> 'timestamp' asc nulls last`).orderBy('received_at').orderBy('id').execute();
  for (const r of rows) {
    const verdict = await handleInboundDelivery(db, JSON.stringify(r.payload), 'on', log);
    if (verdict !== 'ack') log(`[graph_consume] replay of ${r.id} left for later`);
  }
  return rows.length;
};
