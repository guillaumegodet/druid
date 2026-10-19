// Passages of the open calls and their vectors in PostgreSQL (lib/calls/passageStore.ts, druid-internal
// docs/plan-funding-calls.md lot 7, « My project » assistant), against a migrated database as the application role:
// calls to embed (open, active programme, not awaiting validation), vectors read back as floats, search limited to the
// model and to the open calls, drop of the closed calls, what the prompt shows. Needs DATABASE_URL_APP: run by the
// « database » CI job and `npm run test:db`. Rolled back.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, type DB } from '../db/client';
import { createCallPassageStore } from '../calls/passageStore';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(db!.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726108)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};
// The store opens its own transactions: inside the test transaction they become savepoints.
const storeOf = (trx: Transaction<DB>) => createCallPassageStore(Object.assign(trx, { transaction: () => ({ execute: (f: (t: Transaction<DB>) => unknown) => f(trx) }) }) as never);

describe.skipIf(!url)('passages of the calls (PostgreSQL)', () => {
  it('stores the vectors of the open calls and searches them', async () => {
    await inRollback(async (trx) => {
      await trx.insertInto('funder').values({ funder_id: 'test-f', name: 'Test funder', category: 'Europe' }).execute();
      await trx.insertInto('funding_programme').values([
        { programme_id: 'test-on', funder_id: 'test-f', name: 'Active programme', active: true },
        { programme_id: 'test-off', funder_id: 'test-f', name: 'Inactive programme', active: false },
      ]).execute();
      await trx.insertInto('funding_call').values([
        { call_id: 'TEST-OPEN', programme_id: 'test-on', title: 'Open call', summary: 'About batteries.', scope: 'Grid storage.', status: 'open', deadlines: ['2027-01-15'], url: 'https://example.org/open' },
        { call_id: 'TEST-CLOSED', programme_id: 'test-on', title: 'Closed call', status: 'closed' },
        { call_id: 'TEST-OFF', programme_id: 'test-off', title: 'Call of an inactive programme', status: 'open' },
        { call_id: 'TEST-PENDING', programme_id: 'test-on', title: 'Call to validate', status: 'open', review_status: 'to_validate' },
      ]).execute();
      const store = storeOf(trx);
      expect((await store.callsToEmbed()).map((c) => c.callId).filter((id) => id.startsWith('TEST-'))).toEqual(['TEST-OPEN']);

      const before = await store.version();
      const vector = [0.6, 0.8, ...Array.from({ length: 1022 }, () => 0)];
      await store.savePassages('TEST-OPEN', [
        { idx: 0, section: 'summary', text: 'About batteries.', textHash: 'h0', model: 'bge-m3', embedding: vector },
        { idx: 1, section: 'scope', text: 'Grid storage.', textHash: 'h1', model: 'bge-m3', embedding: vector },
      ]);
      await store.savePassages('TEST-CLOSED', [{ idx: 0, section: 'summary', text: '', textHash: 'h', model: 'bge-m3', embedding: vector }]);
      expect(await store.version()).not.toBe(before);
      expect(await store.stored()).toSatisfy((m: Map<string, unknown[]>) => m.get('TEST-OPEN')?.length === 2);

      // Floats back (not strings), the closed call and another model left out.
      const found = (await store.searchable('bge-m3')).filter((p) => p.callId.startsWith('TEST-'));
      expect(found.map((p) => [p.callId, p.section])).toEqual(expect.arrayContaining([['TEST-OPEN', 'summary'], ['TEST-OPEN', 'scope']]));
      expect(found).toHaveLength(2);
      expect(found[0].vector[0]).toBeCloseTo(0.6, 5);
      expect(found[0].vector).toHaveLength(1024);
      expect((await store.searchable('other-model')).filter((p) => p.callId.startsWith('TEST-'))).toHaveLength(0);

      // Replaced, not added; the passages of the calls no longer open are dropped.
      await store.savePassages('TEST-OPEN', [{ idx: 0, section: 'summary', text: 'New.', textHash: 'h2', model: 'bge-m3', embedding: vector }]);
      expect((await store.stored()).get('TEST-OPEN')).toEqual([{ idx: 0, textHash: 'h2', model: 'bge-m3' }]);
      const keep = [...(await store.stored()).keys()].filter((id) => id !== 'TEST-CLOSED');
      expect(await store.dropExcept(keep)).toBe(1);
      expect((await store.stored()).has('TEST-CLOSED')).toBe(false);

      const info = await store.callsInfo(['TEST-OPEN']);
      expect(info.get('TEST-OPEN')).toMatchObject({ title: 'Open call', programme: 'Active programme', funder: 'Test funder', deadlines: ['2027-01-15'], status: 'open', url: 'https://example.org/open' });
    });
  });
});
