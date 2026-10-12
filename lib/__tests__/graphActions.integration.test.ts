// Outbox of the corrections carried to the CRISalid knowledge graph (lib/graph/pg.ts, lot 11 b of druid-internal
// docs/plan-migration-postgresql.md), against a migrated database as the application role: a pass reads the primary
// identifiers, records the removals with the author found in the audit log, refuses a mass removal; a sent action
// updates the state. Needs DATABASE_URL_APP: run by the « database » CI job and `npm run test:db`. Rolled back.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';
import {
  GraphPlanRefused, actionsToSend, graphActionsOverview, markGraphActionFailed, markGraphActionSent, planAndRecordGraphActions,
  peopleCsvGate, recordPeopleCsvExport, removalsSentBefore, replaceGraphState,
} from '../graph/pg';
import { GraphBusError, type GraphBus } from '../graph/bus';
import { prepareGraphForPeopleCsv, runGraphPass } from '../graph/publisher';

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
      expect(recorded).toEqual({
        queued: 2, blocked: 1, unblocked: 0, cancelled: 0, unreadable: [], orphans: ['zz-gone-x'],
        queuedActions: [{ uid: 'zz-ada-l', type: 'idhals' }, { uid: 'zz-babbage-c', type: 'idref' }],
        blockedActions: [{ uid: 'zz-ada-l', type: 'scopus' }],
      });
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

  it('a snapshot replaces the state; a removal it still shows is queued again at the next pass', async () => {
    await inRollback(async (trx) => {
      await person(trx, 'zz-ada-l', {});
      await state(trx, [['zz-ada-l', 'idref', '123456789']]);
      await planAndRecordGraphActions(trx);
      const [action] = await actionsToSend(trx);
      await markGraphActionSent(trx, action.id);
      await trx.updateTable('graph_action').set({ sent_at: '2026-10-12T08:00:00Z' }).execute();
      expect(await removalsSentBefore(trx, '2026-10-12T07:59:00Z')).toEqual([]);
      expect((await removalsSentBefore(trx, '2026-10-12T09:00:00Z')).map((a) => a.id)).toEqual([action.id]);

      // The graph did not apply it: the snapshot brings the value back, with another row.
      const previous = await replaceGraphState(trx, [
        { uid: 'zz-ada-l', type: 'idref', value: '123456789' }, { uid: 'zz-ada-l', type: 'orcid', value: '0000-0003-1111-2222' },
      ]);
      expect(previous).toEqual([]);
      expect(await trx.selectFrom('graph_identifier_state').select(['type', 'origin']).orderBy('type').execute())
        .toEqual([{ type: 'idref', origin: 'snapshot' }, { type: 'orcid', origin: 'snapshot' }]);
      expect(await planAndRecordGraphActions(trx)).toMatchObject({ queued: 2 });
    });
  });

  /** Bus that records the messages; `fail(n)` makes the n-th publish fail (fatal or not). */
  const fakeBus = (failures: Record<number, GraphBusError> = {}) => {
    const sent: { key: string; message: any }[] = [];
    let n = 0;
    let closed = false;
    const bus: GraphBus = {
      publish: async (key, message) => {
        n++;
        if (failures[n]) throw failures[n];
        sent.push({ key, message });
      },
      close: async () => { closed = true; },
    };
    return { bus, sent, closed: () => closed };
  };

  it('a pass « on » queues and publishes the removals, in the SoVisu+ format; « dry-run » and « off » change nothing', async () => {
    await inRollback(async (trx) => {
      await person(trx, 'zz-ada-l', { idref: '012345678' });
      await state(trx, [['zz-ada-l', 'idref', '123456789'], ['zz-ada-l', 'scopus', '11111111111']]);
      const { bus, sent, closed } = fakeBus();
      const openBus = async () => bus;
      expect((await runGraphPass({ db: trx, mode: 'off', openBus })).planned.queued).toEqual([]);
      const dry = await runGraphPass({ db: trx, mode: 'dry-run', openBus });
      expect(dry.planned).toMatchObject({ queued: ['zz-ada-l (idref)'], blocked: ['zz-ada-l (scopus)'] });
      expect(await actions(trx)).toEqual([]);

      const report = await runGraphPass({ db: trx, mode: 'on', openBus });
      expect(report).toMatchObject({ sent: ['zz-ada-l (idref)'], failed: [] });
      expect(sent).toEqual([{ key: 'task.people.person.remove.interactive', message: expect.objectContaining({
        actionType: 'REMOVE', targetType: 'PERSON', targetUid: 'local-zz-ada-l', path: 'identifiers',
        parameters: { type: 'idref', value: '123456789' }, personUid: 'druid', application: 'druid',
      }) }]);
      expect(closed()).toBe(true);
      expect((await actions(trx)).map((a) => [a.type, a.status])).toEqual([['idref', 'sent'], ['scopus', 'blocked']]);
      expect(await trx.selectFrom('graph_identifier_state').select('type').execute()).toEqual([{ type: 'scopus' }]);
    });
  });

  it('a refused message is marked failed and retried; a lost channel stops the pass; an unreachable bus fails them all', async () => {
    await inRollback(async (trx) => {
      await person(trx, 'zz-ada-l', {});
      await state(trx, [['zz-ada-l', 'idref', '123456789'], ['zz-ada-l', 'orcid', '0000-0001-2345-6780'], ['zz-ada-l', 'idhals', 'ada-lovelace']]);
      const unroutable = fakeBus({ 1: new GraphBusError('no queue bound', false), 2: new GraphBusError('ACCESS_REFUSED', true) });
      const first = await runGraphPass({ db: trx, mode: 'on', openBus: async () => unroutable.bus });
      expect(first.failed.map((f) => f.error)).toEqual(['no queue bound', 'ACCESS_REFUSED']);
      expect(first.sent).toEqual([]);
      expect((await actions(trx)).map((a) => a.status).sort()).toEqual(['failed', 'failed', 'pending']);

      const down = await runGraphPass({ db: trx, mode: 'on', openBus: async () => { throw new Error('ECONNREFUSED'); } });
      expect(down.failed.map((f) => f.error)).toEqual(Array(3).fill('bus unreachable: ECONNREFUSED'));

      const ok = fakeBus();
      expect((await runGraphPass({ db: trx, mode: 'on', openBus: async () => ok.bus })).sent).toHaveLength(3);
      expect((await actions(trx)).map((a) => [a.status, a.last_error])).toEqual(Array(3).fill(['sent', null]));
    });
  });

  it('before people.csv, the export sends the removals itself; it waits if the bus refuses them or if there are too many', async () => {
    await inRollback(async (trx) => {
      await person(trx, 'zz-ada-l', { idref: '012345678' });
      await state(trx, [['zz-ada-l', 'idref', '123456789'], ['zz-ada-l', 'scopus', '11111111111']]);
      const down = await prepareGraphForPeopleCsv({ db: trx, openBus: async () => { throw new Error('ECONNREFUSED'); } });
      expect(down).toMatchObject({ refused: 0, toSend: 1 });
      expect(down.pass?.failed.map((f) => f.error)).toEqual(['bus unreachable: ECONNREFUSED']);

      const ok = fakeBus();
      expect(await prepareGraphForPeopleCsv({ db: trx, openBus: async () => ok.bus })).toMatchObject({
        refused: 0, toSend: 0, keep: [{ uid: 'zz-ada-l', type: 'scopus', value: '11111111111' }],
      });
      expect(ok.sent.map((m) => m.message.parameters)).toEqual([{ type: 'idref', value: '123456789' }]);

      for (let i = 0; i < 26; i++) {
        const uid = `zz-p-${String(i).padStart(2, '0')}`;
        await person(trx, uid, {});
        await state(trx, [[uid, 'idref', '123456789']]);
      }
      const many = fakeBus();
      expect(await prepareGraphForPeopleCsv({ db: trx, openBus: async () => many.bus })).toEqual({ pass: null, refused: 26, toSend: 26, keep: [] });
      expect(many.sent).toEqual([]);
    });
  });

  it('overview: outbox by status, removals of the next pass, values to correct, persons of the graph without a record', async () => {
    await inRollback(async (trx) => {
      await person(trx, 'zz-ada-l', { idref: '012345678' });
      await person(trx, 'zz-babbage-c', { orcid: 'N/C' });
      await state(trx, [
        ['zz-ada-l', 'idref', '123456789'], ['zz-ada-l', 'scopus', '11111111111'], ['zz-ada-l', 'orcid', '0000-0001-2345-6780'],
        ['zz-babbage-c', 'orcid', '0000-0003-1111-2220'], ['zz-gone-x', 'idref', '02345678X'],
      ]);
      await planAndRecordGraphActions(trx);
      const [first] = await actionsToSend(trx);
      await markGraphActionSent(trx, first.id);
      const [second] = await actionsToSend(trx);
      await markGraphActionFailed(trx, second.id, 'no queue bound');
      // Corrected since the pass: queued by the next one.
      await person(trx, 'zz-dora-e', {});
      await state(trx, [['zz-dora-e', 'idref', '034567891']]);

      const o = await graphActionsOverview(trx);
      expect(o.counts).toEqual({ pending: 0, sent: 1, blocked: 1, failed: 1, cancelled: 0 });
      expect(o.recentSent.map((a) => [a.uid, a.type])).toEqual([[first.uid, first.type]]);
      expect(o.failed).toMatchObject([{ uid: second.uid, type: second.type, attempts: 1, last_error: 'no queue bound' }]);
      expect(o.blocked).toMatchObject([{ uid: 'zz-ada-l', type: 'scopus', value: '11111111111' }]);
      expect(o.toQueue).toEqual([{ uid: 'zz-dora-e', type: 'idref', value: '034567891' }]);
      expect(o.unreadable).toEqual([{ uid: 'zz-babbage-c', type: 'orcid', value: 'N/C' }]);
      expect(o.orphans).toEqual(['zz-gone-x']);
      expect(o.state).toMatchObject({ snapshot: 5, peopleCsv: 0, lastPeopleCsvAt: null }); // 5 + 1 - the sent one
      expect(o.state.lastSnapshotAt).toBeInstanceOf(Date);
    });
  });

  it('people.csv export: refused while removals are to send, keeps the values blocked by the IKG, then becomes the state', async () => {
    await inRollback(async (trx) => {
      await person(trx, 'zz-ada-l', { idref: '012345678' });
      await state(trx, [['zz-ada-l', 'idref', '123456789'], ['zz-ada-l', 'scopus', '11111111111']]);
      expect(await peopleCsvGate(trx)).toEqual({ toSend: 1, keep: [{ uid: 'zz-ada-l', type: 'scopus', value: '11111111111' }] });
      await planAndRecordGraphActions(trx);
      expect((await peopleCsvGate(trx)).toSend).toBe(1);
      const [a] = await actionsToSend(trx);
      await markGraphActionSent(trx, a.id);
      expect(await peopleCsvGate(trx)).toEqual({ toSend: 0, keep: [{ uid: 'zz-ada-l', type: 'scopus', value: '11111111111' }] });

      expect(await recordPeopleCsvExport(trx, ['zz-ada-l', 'zz-babbage-c'], [
        { uid: 'zz-ada-l', type: 'idref', value: '012345678' }, { uid: 'zz-ada-l', type: 'scopus', value: '11111111111' },
        { uid: 'zz-babbage-c', type: 'orcid', value: ' 0000-0003-1111-2222 ' }, { uid: 'zz-babbage-c', type: 'orcid', value: 'other' },
      ])).toBe(3);
      expect(await trx.selectFrom('graph_identifier_state').select(['uid', 'type', 'value', 'origin']).orderBy('uid').orderBy('type').execute()).toEqual([
        { uid: 'zz-ada-l', type: 'idref', value: '012345678', origin: 'people_csv' },
        { uid: 'zz-ada-l', type: 'scopus', value: '11111111111', origin: 'people_csv' },
        { uid: 'zz-babbage-c', type: 'orcid', value: '0000-0003-1111-2222', origin: 'people_csv' },
      ]);
      expect(await peopleCsvGate(trx)).toMatchObject({ toSend: 0 });
    });
  });
});

