// Calls added by hand in PostgreSQL (lib/calls/manualStore.ts, druid-internal docs/plan-funding-calls.md lot 6), against
// a migrated database as the application role: funders and programmes created on the fly and reused by name, review
// queue, duplicates by URL, programmes of the collectors refused, catalogue previewed then imported, only validated
// calls in the tab. Needs DATABASE_URL_APP: run by the « database » CI job and `npm run test:db`. Rolled back.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, type DB } from '../db/client';
import { createManualCallsStore } from '../calls/manualStore';
import { createCallsStore } from '../calls/pg';
import { validateManualCall, type ManualCallInput } from '../calls/manual';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(db!.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726106)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};
// The store opens its own transactions: inside the test transaction they become savepoints.
const storeOf = (trx: Transaction<DB>) => createManualCallsStore(Object.assign(trx, { transaction: () => ({ execute: (f: (t: Transaction<DB>) => unknown) => f(trx) }) }) as never);

const TODAY = '2026-10-17';
const valid = (input: ManualCallInput) => {
  const { call, errors } = validateManualCall(input, TODAY);
  if (!call) throw new Error(errors.join('; '));
  return call;
};
const region = { name: 'Étoiles montantes', funder: { name: 'Région Test-Loire', category: 'Régional' as const } };

describe.skipIf(!url)('calls added by hand (PostgreSQL)', () => {
  it('creates the funder and the programme, reuses them by name, and keeps the review queue', async () => {
    await inRollback(async (trx) => {
      const store = storeOf(trx);
      const a = await store.save(valid({ title: 'Étoiles montantes 2027', programme: region, url: 'https://www.region.example/etoiles', deadlines: ['2026-12-01'], summary: 'Pour les jeunes.', scope: 'Toutes disciplines' }),
        { reviewStatus: 'to_validate', user: 'test:ada' });
      expect(a).toMatchObject({ created: true, programmeId: 'm-region-test-loire-etoiles-montantes' });
      const b = await store.save(valid({ title: 'Autre appel', programme: { name: 'étoiles MONTANTES', funder: { name: 'région test-loire', category: 'Autre' } } }),
        { reviewStatus: 'validated', user: 'test:bob' });
      expect(b.programmeId).toBe(a.programmeId);
      expect((await store.programmes()).filter((p) => p.funderId === 'm-region-test-loire')).toHaveLength(1);

      const listed = await store.list();
      const first = listed.find((c) => c.callId === a.callId)!;
      expect(listed[0].reviewStatus).toBe('to_validate');
      expect(first).toMatchObject({ funderName: 'Région Test-Loire', status: 'open', addedBy: 'test:ada', reviewedBy: '', scope: 'Toutes disciplines', summary: 'Pour les jeunes.' });
      expect(listed.find((c) => c.callId === b.callId)).toMatchObject({ reviewStatus: 'validated', reviewedBy: 'test:bob' });

      // The tab shows the validated calls only, a French summary being its own translation.
      const tab = await createCallsStore(trx as never).calls();
      expect(tab.map((c) => c.callId)).toContain(b.callId);
      expect(tab.map((c) => c.callId)).not.toContain(a.callId);
      expect(await store.setReview(a.callId, 'validated', 'test:bob')).toBe(true);
      expect((await createCallsStore(trx as never).calls()).find((c) => c.callId === a.callId)?.summaryFr).toBe('Pour les jeunes.');

      // Edit: same id, new text; reject; delete.
      await store.save(valid({ title: 'Étoiles montantes 2027 (v2)', programme: { programmeId: a.programmeId }, url: 'https://www.region.example/etoiles' }),
        { callId: a.callId, reviewStatus: 'to_validate', user: 'test:ada' });
      expect((await store.list()).find((c) => c.callId === a.callId)).toMatchObject({ title: 'Étoiles montantes 2027 (v2)', reviewStatus: 'to_validate', reviewedBy: '' });
      expect(await store.duplicatesOf('https://WWW.region.example/etoiles/')).toEqual([{ callId: a.callId, title: 'Étoiles montantes 2027 (v2)', programmeId: a.programmeId }]);
      expect(await store.duplicatesOf('https://www.region.example/etoiles', a.callId)).toEqual([]);
      expect(await store.setReview(b.callId, 'rejected', 'test:bob')).toBe(true);
      expect(await store.remove(a.callId)).toBe('deleted');
      expect(await store.remove(a.callId)).toBe('unknown');
    });
  });

  it('refuses the programmes of the collectors and the calls they collected', async () => {
    await inRollback(async (trx) => {
      const store = storeOf(trx);
      await trx.insertInto('funder').values({ funder_id: 'zz-eu', name: 'ZZ Europe', category: 'Europe' }).execute();
      await trx.insertInto('funding_programme').values({ programme_id: 'zz-collected', funder_id: 'zz-eu', name: 'Collected', source: 'ft-portal' }).execute();
      await trx.insertInto('funding_call').values({ call_id: 'ZZ-TOPIC-1', programme_id: 'zz-collected', title: 'Topic' }).execute();
      await expect(store.save(valid({ title: 'Appel', programme: { programmeId: 'zz-collected' } }), { reviewStatus: 'validated', user: 'test:ada' }))
        .rejects.toMatchObject({ status: 400 });
      await expect(store.save(valid({ title: 'Appel', programme: { programmeId: 'm-unknown' } }), { reviewStatus: 'validated', user: 'test:ada' }))
        .rejects.toMatchObject({ status: 404 });
      expect(await store.setReview('ZZ-TOPIC-1', 'rejected', 'test:ada')).toBe(false);
      expect(await store.remove('ZZ-TOPIC-1')).toBe('unknown');
    });
  });

  it('previews then imports a catalogue, a reference updating the same call', async () => {
    await inRollback(async (trx) => {
      const store = storeOf(trx);
      const headers = ['Référence', 'Titre', 'Financeur', 'Catégorie', 'Programme', 'Date limite', 'Source', 'Commentaire'];
      const rows = [
        { Référence: 'DRI-1', Titre: 'Amorçage', Financeur: 'Fondation ZZ', Catégorie: 'Fondation', Programme: 'Amorçage', 'Date limite': '15/01/2027', Source: 'ResearchConnect' },
        { Référence: 'DRI-2', Titre: '', Financeur: 'Fondation ZZ' },
        {},
        { Référence: 'DRI-1', Titre: 'Amorçage (corrigé)', Financeur: 'Fondation ZZ', Programme: 'Amorçage', 'Date limite': '2027-01-20', Source: 'ResearchConnect' },
      ];
      const preview = await store.importCatalogue(rows, headers, { apply: false, validate: true, user: 'test:ada', today: TODAY });
      expect(preview.ignored).toEqual(['Commentaire']);
      expect(preview.lines.map((l) => [l.line, l.action, l.errors])).toEqual([[2, 'new', []], [3, 'error', ['The title is missing']], [5, 'update', []]]);
      expect(await store.programmes()).toEqual(expect.not.arrayContaining([expect.objectContaining({ funderName: 'Fondation ZZ' })]));

      const report = await store.importCatalogue(rows, headers, { apply: true, validate: true, user: 'test:ada', today: TODAY });
      expect(report.lines.map((l) => l.action)).toEqual(['new', 'error', 'update']);
      const calls = (await store.list()).filter((c) => c.funderName === 'Fondation ZZ');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ title: 'Amorçage (corrigé)', deadlines: ['2027-01-20'], reviewStatus: 'validated', taxonomy: { source: 'researchconnect' } });
      await expect(store.importCatalogue(rows, ['Financeur'], { apply: false, validate: false, user: 'test:ada', today: TODAY })).rejects.toMatchObject({ status: 400 });
    });
  });
});
