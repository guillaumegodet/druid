// Outbox of the corrections carried to the CRISalid knowledge graph (lib/graph/pg.ts, lot 11 b of druid-internal
// docs/plan-migration-postgresql.md), against a migrated database as the application role: a pass reads the primary
// identifiers, records the removals with the author found in the audit log, refuses a mass removal; a sent action
// updates the state. Needs DATABASE_URL_APP: run by the « database » CI job and `npm run test:db`. Rolled back.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';
import {
  GraphPlanRefused, actionsToSend, markGraphActionFailed, markGraphActionSent, planAndRecordGraphActions,
} from '../graph/pg';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(withActor(db!, 'test:graph', async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
    // The tables are empty in CI, not on a copy of a real base: the cases only see their own rows.
    await trx.deleteFrom('graph_action').execute();
    await trx.deleteFrom('graph_identifier_state').execute();
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};

const person = async (trx: Transaction<DB>, uid: string, ids: Record<string, string>) => {
  const p = await trx.insertInto('person').values({ uid, last_name: uid }).returning('id').executeTakeFirstOrThrow();
  for (const [scheme, value] of Object.entries(ids)) {
    await trx.insertInto('person_identifier').values({ person_id: p.id, scheme, value }).execute();
  }
  return p.id;
};
const state = (trx: Transaction<DB>, rows: [string, string, string][]) =>
  trx.insertInto('graph_identifier_state').values(rows.map(([uid, type, value]) => ({ uid, type, value, origin: 'snapshot' }))).execute();
const actions = (trx: Transaction<DB>) =>
  trx.selectFrom('graph_action').select(['uid', 'type', 'value', 'status', 'actor', 'attempts', 'last_error'])
    .orderBy('uid').orderBy('type').execute();

describe.skipIf(!url)('graph actions (PostgreSQL)', () => {
  it('a pass records the removals, with the author of the correction, and only once', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', { orcid: '0000-0002-1825-0097', idhal: 'ada-lovelace', scopus: '111' });
      await person(trx, 'zz-babbage-c', { idref: '012345678' });
      await state(trx, [
        ['zz-ada-l', 'orcid', '0000-0002-1825-0097'], ['zz-ada-l', 'idhals', 'ada-lovelace'], ['zz-ada-l', 'scopus', '111'],
        ['zz-babbage-c', 'idref', '123456789'], ['zz-gone-x', 'orcid', '0000-0003-5555-6660'],
      ]);
      // A manager removes the wrong IdHAL and Scopus (the audit log names them through druid.actor).
      await sql`SELECT set_config('druid.actor', 'manager-a', true)`.execute(trx);
      await trx.deleteFrom('person_identifier').where('person_id', '=', ada).where('scheme', 'in', ['idhal', 'scopus']).execute();
      await sql`SELECT set_config('druid.actor', 'test:graph', true)`.execute(trx);

      const recorded = await planAndRecordGraphActions(trx);
      expect(recorded).toEqual({ queued: 2, blocked: 1, unblocked: 0, cancelled: 0, unreadable: [], orphans: ['zz-gone-x'] });
      expect(await actions(trx)).toEqual([
        { uid: 'zz-ada-l', type: 'idhals', value: 'ada-lovelace', status: 'pending', actor: 'manager-a', attempts: 0, last_error: null },
        { uid: 'zz-ada-l', type: 'scopus', value: '111', status: 'blocked', actor: 'manager-a', attempts: 0, last_error: null },
        { uid: 'zz-babbage-c', type: 'idref', value: '123456789', status: 'pending', actor: null, attempts: 0, last_error: null },
      ]);
      expect(await planAndRecordGraphActions(trx)).toMatchObject({ queued: 0, blocked: 0, cancelled: 0 });
    });
  });

  it('a mass removal is refused unless forced', async () => {
    await inRollback(async (trx) => {
      await person(trx, 'zz-ada-l', {});
      await state(trx, [['zz-ada-l', 'orcid', '0000-0002-1825-0097'], ['zz-ada-l', 'idref', '012345678'], ['zz-ada-l', 'idhals', 'ada-lovelace']]);
      await expect(planAndRecordGraphActions(trx, { limit: 2 })).rejects.toBeInstanceOf(GraphPlanRefused);
      expect(await actions(trx)).toEqual([]);
      expect(await planAndRecordGraphActions(trx, { limit: 2, force: true })).toMatchObject({ queued: 3 });
    });
  });

  it('sending: a sent action leaves the state, a failed one is retried after the pending ones', async () => {
    await inRollback(async (trx) => {
      await person(trx, 'zz-ada-l', { idref: '012345678' });
      await state(trx, [['zz-ada-l', 'idref', '123456789'], ['zz-ada-l', 'orcid', '0000-0001-2345-6780']]);
      await planAndRecordGraphActions(trx);
      const [first, second] = await actionsToSend(trx);
      await markGraphActionFailed(trx, first.id, 'bus unreachable');
      expect((await actionsToSend(trx)).map((a) => a.id)).toEqual([second.id, first.id]);
      expect(await markGraphActionSent(trx, second.id)).toBe(true);
      expect(await markGraphActionSent(trx, second.id)).toBe(false);
      expect(await markGraphActionSent(trx, first.id)).toBe(true);
      expect(await trx.selectFrom('graph_identifier_state').selectAll().execute()).toEqual([]);
      expect((await actions(trx)).map((a) => [a.status, a.attempts, a.last_error]).sort()).toEqual([['sent', 1, null], ['sent', 2, null]]);
    });
  });

  it('a removal no longer needed is cancelled, the directory having the value again', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', {});
      await state(trx, [['zz-ada-l', 'orcid', '0000-0002-1825-0097']]);
      await planAndRecordGraphActions(trx);
      await trx.insertInto('person_identifier').values({ person_id: ada, scheme: 'orcid', value: '0000-0002-1825-0097' }).execute();
      expect(await planAndRecordGraphActions(trx)).toMatchObject({ queued: 0, cancelled: 1 });
      expect((await actions(trx)).map((a) => a.status)).toEqual(['cancelled']);
    });
  });
});
