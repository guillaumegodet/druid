// One pass of the graph publisher (lot 11 d of druid-internal docs/plan-migration-postgresql.md): plans and records
// the identifier removals (lib/graph/pg.ts), then publishes the pending and failed ones to the CRISalid bus. Run once a
// night by scripts/graph_publish.ts, and by the people.csv export just before it writes the file.
// DRUID_GRAPH_ACTIONS chooses the mode: `off` (default: nothing), `dry-run` (plan computed and reported, nothing
// recorded nor sent), `on`. A message published but whose `sent` mark could not be written is sent again at the next
// pass: the IKG then answers « nothing to remove », without effect.
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen';
import type { GraphBus } from './bus';
import {
  GRAPH_TYPE_OF_SCHEME, IKG_ACCEPTED_TYPES, planGraphActions, removalMessage, removalRoutingKey,
  type GraphIdentifier, type GraphIdentifierType,
} from './identifierActions';
import {
  GraphPlanRefused, MAX_REMOVALS_PER_PASS, actionsToSend, loadGraphPlanInput, markGraphActionFailed, markGraphActionSent,
  peopleCsvGate, planAndRecordGraphActions,
} from './pg';

export type GraphActionsMode = 'off' | 'dry-run' | 'on';

const MODES: GraphActionsMode[] = ['off', 'dry-run', 'on'];
const GRAPH_TYPES = Object.values(GRAPH_TYPE_OF_SCHEME) as GraphIdentifierType[];

export const graphActionsModeFromEnv = (env: Record<string, string | undefined>): GraphActionsMode => {
  const mode = (env.DRUID_GRAPH_ACTIONS || 'off').trim().toLowerCase() as GraphActionsMode;
  if (!MODES.includes(mode)) throw new Error(`DRUID_GRAPH_ACTIONS must be one of ${MODES.join(', ')}`);
  return mode;
};

/** Types the IKG accepts (DRUID_GRAPH_ACCEPTED_TYPES, comma-separated): unblocks Scopus without a release once the
 * IKG takes it. */
export const acceptedTypesFromEnv = (env: Record<string, string | undefined>): GraphIdentifierType[] => {
  const raw = (env.DRUID_GRAPH_ACCEPTED_TYPES || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!raw.length) return [...IKG_ACCEPTED_TYPES];
  const unknown = raw.filter((t) => !GRAPH_TYPES.includes(t as GraphIdentifierType));
  if (unknown.length) throw new Error(`DRUID_GRAPH_ACCEPTED_TYPES: unknown types ${unknown.join(', ')}`);
  return raw as GraphIdentifierType[];
};

/** uid (type) of an action, for the logs: never the identifier value. */
const label = (a: { uid: string; type: string }) => `${a.uid} (${a.type})`;

export interface GraphPassReport {
  mode: GraphActionsMode;
  /** Removals newly queued, blocked, unblocked and cancelled by this pass (dry-run: what it would do). */
  planned: { queued: string[]; blocked: string[]; unblocked: number; cancelled: number; unreadable: string[]; orphans: number };
  sent: string[];
  failed: { action: string; error: string }[];
}

export interface GraphPassOptions {
  db: Kysely<DB>;
  mode: GraphActionsMode;
  openBus: () => Promise<GraphBus>;
  accepted?: GraphIdentifierType[];
  force?: boolean;
  limit?: number;
}

export const runGraphPass = async ({
  db, mode, openBus, accepted = [...IKG_ACCEPTED_TYPES], force = false, limit = MAX_REMOVALS_PER_PASS,
}: GraphPassOptions): Promise<GraphPassReport> => {
  const report: GraphPassReport = {
    mode, planned: { queued: [], blocked: [], unblocked: 0, cancelled: 0, unreadable: [], orphans: 0 }, sent: [], failed: [],
  };
  if (mode === 'off') return report;
  if (mode === 'dry-run') {
    const plan = planGraphActions({ ...(await loadGraphPlanInput(db)), accepted });
    report.planned = {
      queued: plan.removals.filter((r) => r.status === 'pending').map(label),
      blocked: plan.removals.filter((r) => r.status === 'blocked').map(label),
      unblocked: plan.unblocked.length, cancelled: plan.cancelled.length,
      unreadable: plan.unreadable.map(label), orphans: plan.orphans.length,
    };
    return report;
  }

  const recorded = await planAndRecordGraphActions(db, { force, limit, accepted });
  report.planned = {
    queued: recorded.queuedActions.map(label), blocked: recorded.blockedActions.map(label),
    unblocked: recorded.unblocked, cancelled: recorded.cancelled,
    unreadable: recorded.unreadable.map(label), orphans: recorded.orphans.length,
  };
  const actions = await actionsToSend(db, limit);
  if (!actions.length) return report;

  let bus: GraphBus;
  try {
    bus = await openBus();
  } catch (err) {
    const error = `bus unreachable: ${err instanceof Error ? err.message : String(err)}`;
    for (const a of actions) {
      await markGraphActionFailed(db, a.id, error);
      report.failed.push({ action: label(a), error });
    }
    return report;
  }
  try {
    for (const a of actions) {
      try {
        await bus.publish(removalRoutingKey, removalMessage(a, new Date().toISOString()));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await markGraphActionFailed(db, a.id, error);
        report.failed.push({ action: label(a), error });
        // The channel is gone: the remaining actions stay as they are, retried at the next pass.
        if ((err as { fatal?: boolean }).fatal) break;
        continue;
      }
      await markGraphActionSent(db, a.id);
      report.sent.push(label(a));
    }
  } finally {
    await bus.close();
  }
  return report;
};

export interface PeopleCsvPreparation {
  pass: GraphPassReport | null;
  /** More removals to send than one pass allows: nothing was sent, an administrator checks the plan and forces it. */
  refused: number;
  /** Removals still to send after the pass (bus refused or unreachable): the export must wait. */
  toSend: number;
  /** Values of the graph kept in people.csv: their removal is refused by the IKG yet. */
  keep: GraphIdentifier[];
}

/**
 * Before a people.csv export with the publisher on: people.csv drops an identifier from the person of the graph
 * without cleaning up the publications harvested with it, and the IKG then answers « nothing to remove » to the
 * removal. So the export sends the removals still to send itself (one pass), then checks that none is left.
 */
export const prepareGraphForPeopleCsv = async (
  { db, openBus, accepted = [...IKG_ACCEPTED_TYPES] }: Pick<GraphPassOptions, 'db' | 'openBus' | 'accepted'>,
): Promise<PeopleCsvPreparation> => {
  let pass: GraphPassReport | null = null;
  try {
    pass = await runGraphPass({ db, mode: 'on', openBus, accepted });
  } catch (err) {
    if (!(err instanceof GraphPlanRefused)) throw err;
    return { pass: null, refused: err.toSend, toSend: err.toSend, keep: [] };
  }
  return { pass, refused: 0, ...(await peopleCsvGate(db, accepted)) };
};
