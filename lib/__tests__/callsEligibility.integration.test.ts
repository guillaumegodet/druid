// Calls a person may apply to (lib/calls/eligibilityStore.ts ofPerson, druid-internal docs/plan-funding-calls.md lot 7,
// block of the researcher record), against a migrated database as the application role: found by the uid, or by any
// membership of a person without uid, deadline first, nobody else's. Needs DATABASE_URL_APP: run by the « database »
// CI job and `npm run test:db`. Rolled back.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, type DB } from '../db/client';
import { createEligibilityStore } from '../calls/eligibilityStore';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(db!.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726107)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};

describe.skipIf(!url)('eligibility of a person (PostgreSQL)', () => {
  it('lists the calls of the person, by uid or by membership, deadline first', async () => {
    await inRollback(async (trx) => {
      await trx.insertInto('funder').values({ funder_id: 'test-erc', name: 'Test ERC', category: 'Europe' }).execute();
      await trx.insertInto('funding_programme').values({ programme_id: 'test-erc-prog', funder_id: 'test-erc', name: 'Test ERC' }).execute();
      for (const [callId, deadline] of [['TEST-STG', '2027-01-14'], ['TEST-COG', '2026-11-20']]) {
        await trx.insertInto('funding_call').values({ call_id: callId, programme_id: 'test-erc-prog', title: callId, deadlines: [deadline], status: 'open' }).execute();
        await trx.insertInto('call_eligibility_rule').values({ call_id: callId, scheme: callId.slice(5), phd_from: '2017-01-01', phd_to: '2026-12-31' }).execute();
      }
      const ada = await trx.insertInto('person').values({ uid: 'test-ada', last_name: 'Lovelace' }).returning('id').executeTakeFirstOrThrow();
      const bob = await trx.insertInto('person').values({ last_name: 'Sans-Uid' }).returning('id').executeTakeFirstOrThrow();
      const [m1, m2] = await trx.insertInto('membership').values([{ person_id: bob.id }, { person_id: bob.id }]).returning('id').execute();
      await trx.insertInto('call_eligibility').values([
        { call_id: 'TEST-STG', person_id: ada.id, uid: 'test-ada', verdict: 'eligible', reasons: ['phd-in-window'], phd_on: '2019' },
        { call_id: 'TEST-COG', person_id: ada.id, uid: 'test-ada', verdict: 'check', reasons: ['phd-year-at-bound'], phd_on: '2019' },
        { call_id: 'TEST-STG', person_id: bob.id, verdict: 'eligible', reasons: ['phd-in-window'], row_ids: [m1.id], phd_on: '2020-06-01' },
      ]).execute();

      const store = createEligibilityStore(trx as never);
      const ofAda = await store.ofPerson({ uid: 'test-ada' });
      expect(ofAda.map((e) => [e.callId, e.verdict])).toEqual([['TEST-COG', 'check'], ['TEST-STG', 'eligible']]);
      expect(ofAda[1]).toMatchObject({ programmeId: 'test-erc-prog', scheme: 'STG', phdFrom: '2017-01-01', phdTo: '2026-12-31', reasons: ['phd-in-window'], phdOn: '2019' });
      // A record without uid is found by any of its memberships, not only the one the eligibility kept.
      expect((await store.ofPerson({ rowId: Number(m2.id) })).map((e) => e.callId)).toEqual(['TEST-STG']);
      expect(await store.ofPerson({ uid: 'test-nobody' })).toEqual([]);
      expect(await store.ofPerson({ rowId: 999999999 })).toEqual([]);
    });
  });
});
