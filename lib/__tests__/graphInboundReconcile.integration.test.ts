// Reconciliation with the SoVisu+ action table (lib/graph/inboundReconcile.ts, lot 5 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md), against a migrated database as the application role. A temporary table
// "Action" (same columns as SoVisu+ 1.7, enums as text) stands for the SoVisu+ database. Needs DATABASE_URL_APP: run by
// the « database » CI job and `npm run test:db`. Rolled back. Identifiers are fictitious.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';
import { processInboundMessage } from '../graph/inboundPg';
import { ActionTableError, runReconcile } from '../graph/inboundReconcile';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(withActor(db!, 'test:reconcile', async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726105)`.execute(trx);
    await trx.deleteFrom('inbound_graph_action').execute();
    await trx.deleteFrom('graph_identifier_state').execute();
    await sql`CREATE TEMP TABLE "Action" (
      id text PRIMARY KEY, "actionType" text NOT NULL, "targetType" text NOT NULL, "targetUid" text NOT NULL, path text,
      parameters jsonb NOT NULL, "timestamp" timestamp(3) without time zone NOT NULL DEFAULT now(), dispatched boolean NOT NULL DEFAULT false,
      "personUid" text NOT NULL) ON COMMIT DROP`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};

const person = async (trx: Transaction<DB>, uid: string, ids: Record<string, string>) => {
  const p = await trx.insertInto('person').values({ uid, last_name: uid, first_name: 'Test' }).returning('id').executeTakeFirstOrThrow();
  for (const [scheme, value] of Object.entries(ids)) {
    await trx.insertInto('person_identifier').values({ person_id: p.id, scheme, value, is_primary: true }).execute();
  }
  return p.id;
};
const action = (trx: Transaction<DB>, id: string, actionType: string, uid: string, type: string, value: string, timestamp: string, dispatched = true) =>
  sql`INSERT INTO "Action" (id, "actionType", "targetType", "targetUid", path, parameters, "timestamp", dispatched, "personUid")
      VALUES (${id}, ${actionType}, 'PERSON', ${`local-${uid}`}, 'identifiers',
              ${JSON.stringify(actionType === 'ADD' ? { identifier: { type, value, authenticated: false } } : { type, value })}::jsonb,
              ${timestamp}::timestamp, ${dispatched}, ${`local-${uid}`})`.execute(trx);
const identifiers = (trx: Transaction<DB>, personId: string) =>
  trx.selectFrom('person_identifier').select(['scheme', 'value']).where('person_id', '=', personId).orderBy('scheme').execute();
const journal = (trx: Transaction<DB>) =>
  trx.selectFrom('inbound_graph_action').select(['id', 'status', 'reason', 'channel']).orderBy('id').execute();

describe.skipIf(!url)('reconciliation with the SoVisu+ action table (PostgreSQL)', () => {
  it('replays only what the bus did not deliver, and is idempotent', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', { orcid: '0000-0002-1825-0097' });
      await action(trx, 'r-1', 'REMOVE', 'zz-ada-l', 'orcid', '0000-0002-1825-0097', '2026-11-20 10:00:00');
      await action(trx, 'r-2', 'ADD', 'zz-ada-l', 'idref', '12345678X', '2026-11-21 10:00:00');
      // Another kind of action of the table: never read.
      await sql`INSERT INTO "Action" VALUES ('r-x', 'UPDATE', 'DOCUMENT', 'doc-1', 'contributions', '{}'::jsonb, '2026-11-21', true, 'local-zz-ada-l')`.execute(trx);
      // r-1 came through the bus.
      await processInboundMessage(trx, JSON.stringify({ id: 'r-1', actionType: 'REMOVE', targetType: 'PERSON', targetUid: 'local-zz-ada-l',
        path: 'identifiers', parameters: { type: 'orcid', value: '0000-0002-1825-0097' }, timestamp: '2026-11-20T10:00:00.000Z',
        personUid: 'local-zz-ada-l', application: 'sovisuplus' }), 'on');

      const r = await runReconcile({ db: trx, svp: trx, mode: 'on', since: '2026-11-13', now: new Date('2026-11-28T03:00:00Z') });
      expect(r).toMatchObject({ scanned: 2, known: 1, replayed: { applied: 1 }, superseded: 0, undispatched: 0, labels: ['zz-ada-l (idref)'] });
      expect(await identifiers(trx, ada)).toEqual([{ scheme: 'idref', value: '12345678X' }]);
      expect(await journal(trx)).toEqual([
        { id: 'r-1', status: 'applied', reason: null, channel: 'bus' },
        { id: 'r-2', status: 'applied', reason: null, channel: 'reconcile' },
      ]);

      // A second pass finds nothing to do.
      expect(await runReconcile({ db: trx, svp: trx, mode: 'on', since: '2026-11-13' })).toMatchObject({ known: 2, replayed: {} });
    });
  });

  it('an action superseded by a later one already handled is journaled, not replayed', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', {});
      await action(trx, 'r-add', 'ADD', 'zz-ada-l', 'idref', '12345678X', '2026-11-20 10:00:00');
      await action(trx, 'r-rem', 'REMOVE', 'zz-ada-l', 'idref', '12345678X', '2026-11-21 10:00:00');
      // Only the removal came through the bus: replaying the lost addition now would bring the value back.
      await processInboundMessage(trx, JSON.stringify({ id: 'r-rem', actionType: 'REMOVE', targetType: 'PERSON', targetUid: 'local-zz-ada-l',
        path: 'identifiers', parameters: { type: 'idref', value: '12345678X' }, timestamp: '2026-11-21T10:00:00.000Z',
        personUid: 'local-zz-ada-l', application: 'sovisuplus' }), 'on');

      const r = await runReconcile({ db: trx, svp: trx, mode: 'on', since: '2026-11-13' });
      expect(r).toMatchObject({ known: 1, replayed: {}, superseded: 1 });
      expect(await identifiers(trx, ada)).toEqual([]);
      expect((await journal(trx)).find((j) => j.id === 'r-add')).toEqual({ id: 'r-add', status: 'ignored', reason: 'superseded', channel: 'reconcile' });
    });
  });

  it('dry-run journals the replays as planned; undispatched actions are counted', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', {});
      await action(trx, 'r-3', 'ADD', 'zz-ada-l', 'idref', '12345678X', '2026-11-27 10:00:00', false);
      const r = await runReconcile({ db: trx, svp: trx, mode: 'dry-run', since: '2026-11-13', now: new Date('2026-11-28T03:00:00Z') });
      expect(r).toMatchObject({ replayed: { planned: 1 }, undispatched: 1 });
      expect(await identifiers(trx, ada)).toEqual([]);
      expect(await journal(trx)).toEqual([{ id: 'r-3', status: 'planned', reason: null, channel: 'reconcile' }]);
      // Known (planned) at the next dry-run pass: not journaled twice.
      expect(await runReconcile({ db: trx, svp: trx, mode: 'dry-run', since: '2026-11-13' })).toMatchObject({ known: 1, replayed: {} });
    });
  });

  it('refuses a table whose shape changed', async () => {
    await inRollback(async (trx) => {
      await sql`ALTER TABLE "Action" DROP COLUMN parameters`.execute(trx);
      await expect(runReconcile({ db: trx, svp: trx, mode: 'on', since: '2026-11-13' })).rejects.toBeInstanceOf(ActionTableError);
    });
  });
});
