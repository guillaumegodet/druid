// Opinions on the suggested connections in PostgreSQL (lib/pairs/feedback.ts, druid-internal
// `docs/archive/plan-binomes-chercheurs.md` lot 4), against a migrated database as the application role: one opinion per user
// and pair (the last one wins), withdrawal, counts and the viewer's own, ordering of the suggestions, CSV rows. Needs
// DATABASE_URL_APP: run by the « database » CI job and `npm run test:db`. Rolled back. Fictitious names.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, type DB } from '../db/client';
import { createPairFeedbackStore } from '../pairs/feedback';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(db!.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726109)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};

const ANA = { uid: 'test-rivet-a', label: 'Ana Rivet', labs: ['L1'] };
const BEN = { label: 'Ben Losier', labs: ['L2'] };
const CLEO = { uid: 'test-vannier-c', label: 'Cleo Vannier', labs: ['L3'] };

describe.skipIf(!url)('opinions on the suggested connections (PostgreSQL)', () => {
  it('keeps one opinion per user and pair, counts them and orders the suggestions', async () => {
    await inRollback(async (trx) => {
      const store = createPairFeedbackStore(trx as never);
      const anaBen = store.pairKeyOf(ANA, BEN);
      const anaCleo = store.pairKeyOf(ANA, CLEO);
      await store.save({ pairKey: anaBen, slug: 'univ-test', a: ANA, b: BEN, verdict: 'relevant', comment: '', author: 'test-viewer' });
      // The last opinion wins.
      await store.save({ pairKey: anaBen, slug: 'univ-test', a: ANA, b: BEN, verdict: 'not_relevant', comment: 'déjà vu', author: 'test-viewer' });
      await store.save({ pairKey: anaBen, slug: 'univ-test', a: BEN, b: ANA, verdict: 'relevant', comment: '', author: 'test-other' });
      await store.save({ pairKey: anaCleo, slug: 'univ-test', a: ANA, b: CLEO, verdict: 'already_in_contact', comment: '', author: 'test-other' });

      const fb = await store.forPairs([anaBen, anaCleo, 'u:none|u:nobody'], 'test-viewer');
      expect(fb.get(anaBen)).toEqual({ counts: { not_relevant: 1, relevant: 1 }, mine: 'not_relevant' });
      expect(fb.get(anaCleo)).toEqual({ counts: { already_in_contact: 1 }, mine: null });
      expect(fb.has('u:none|u:nobody')).toBe(false);

      // Ana × Ben was set aside by the viewer: after Ana × Cleo.
      const ordered = await store.annotate([{ a: ANA, b: BEN }, { a: ANA, b: CLEO }], 'test-viewer');
      expect(ordered.map((s) => s.key)).toEqual([anaCleo, anaBen]);

      await store.remove(anaBen, 'test-viewer');
      expect((await store.forPairs([anaBen], 'test-viewer')).get(anaBen)).toEqual({ counts: { relevant: 1 }, mine: null });

      const rows = (await store.rows()).filter((r) => r.author.startsWith('test-'));
      expect(rows.map((r) => [r.a_label, r.b_label, r.a_labs, r.verdict])).toEqual([
        ['Ben Losier', 'Ana Rivet', 'L2', 'relevant'],
        ['Ana Rivet', 'Cleo Vannier', 'L1', 'already_in_contact'],
      ]);
      expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
