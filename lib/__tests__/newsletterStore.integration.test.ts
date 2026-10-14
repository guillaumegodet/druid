// News items of the newsletter in PostgreSQL (lib/publications/pg.ts, lot 14 a of druid-internal
// docs/plan-migration-postgresql.md), against a migrated database as the application role: same answers as the Grist
// store (most recent publication first, ISO dates), writes signed in the audit log, axis corrections delegated.
// Needs DATABASE_URL_APP: run by the « database » CI job and `npm run test:db`. Rolled back.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, type DB } from '../db/client';
import { createPgPublicationsStore } from '../publications/pg';
import type { NewsletterNewItem } from '../publications/newsletter';
import type { PublicationsStore } from '../publications/store';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(db!.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726105)`.execute(trx);
    await trx.deleteFrom('newsletter_item').execute();
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};

const grist: PublicationsStore = {
  newsletter: async () => [], newsletterSlugOf: async () => null, updateNewsletterItem: async () => {},
  newsletterWorkIds: async () => new Set(), addNewsletterItem: async () => null,
  axisCorrections: async (slug) => (slug === 'ec-nantes' ? [{ gristId: 7, doi: '10.1/x', title: 'T', axe: 'énergies' }] : null),
  updateAxisCorrection: async () => ({ table: 'Publications_centrale_axes_strategiques2' }),
  axisReviewsSupported: false,
  axisReviews: async () => [],
  saveAxisReview: async () => { throw new Error('unsupported'); },
  deleteAxisReview: async () => false,
};
const item = (workId: string, over: Partial<NewsletterNewItem> = {}): NewsletterNewItem => ({
  work_id: workId, slug: 'zz-ls2n', numero: '2026-10', titre: `Titre ${workId}`, doi: '', date_publication: '2026-09-01',
  journal: '', auteurs: '', labs: '', accroche: '', resume: 'Résumé', resume_genere: '', statut: 'genere',
  chercheur_nom: '', chercheur_email: '', chercheur_photo: '', chercheur_url: '', genere_le: '2026-10-12T08:00:00.000Z',
  valide_le: '', valide_par: '', commentaire: '', ...over,
});

describe.skipIf(!url)('newsletter store (PostgreSQL)', () => {
  it('adds, lists most recent first, finds the structure of an item and the works already generated', async () => {
    await inRollback(async (trx) => {
      const store = createPgPublicationsStore({ db: trx, grist });
      const a = await store.addNewsletterItem(item('W1'), 'test:ada');
      const b = await store.addNewsletterItem(item('W2', { date_publication: '2026-09-20' }), 'test:ada');
      await store.addNewsletterItem(item('W1', { slug: 'zz-lppl' }));
      expect(typeof a).toBe('number');
      const items = await store.newsletter('zz-ls2n');
      expect(items.map((i) => i.work_id)).toEqual(['W2', 'W1']);
      expect(items[1]).toMatchObject({ id: a, titre: 'Titre W1', statut: 'genere', valide_par: '' });
      expect(await store.newsletterSlugOf(b!)).toBe('zz-ls2n');
      expect(await store.newsletterSlugOf(999999999)).toBeNull();
      expect([...await store.newsletterWorkIds('zz-ls2n')].sort()).toEqual(['W1', 'W2']);
      await expect(store.addNewsletterItem(item('W2'))).rejects.toThrow(/duplicate key/);
    });
  });

  it('updates the editorial fields under the actor, the validation date as a timestamp', async () => {
    await inRollback(async (trx) => {
      const store = createPgPublicationsStore({ db: trx, grist });
      const id = (await store.addNewsletterItem(item('W1'), 'test:ada'))!;
      await store.updateNewsletterItem(id, { statut: 'valide', valide_le: '2026-10-12T09:30:00.000Z', valide_par: 'bob-b', accroche: 'Accroche' }, 'test:bob');
      const [it1] = await store.newsletter('zz-ls2n');
      expect(it1).toMatchObject({ statut: 'valide', valide_par: 'bob-b', accroche: 'Accroche' });
      const row = await trx.selectFrom('newsletter_item').select(['valide_le', 'genere_le']).where('id', '=', String(id)).executeTakeFirstOrThrow();
      expect((row.valide_le as Date).toISOString()).toBe('2026-10-12T09:30:00.000Z');
      expect((row.genere_le as Date).toISOString()).toBe('2026-10-12T08:00:00.000Z');
      await store.updateNewsletterItem(id, { valide_le: '' }, 'test:bob');
      expect((await trx.selectFrom('newsletter_item').select('valide_le').where('id', '=', String(id)).executeTakeFirstOrThrow()).valide_le).toBeNull();
      const audit = await trx.selectFrom('audit_log').select(['action', 'actor']).where('table_name', '=', 'newsletter_item')
        .where('row_id', '=', String(id)).orderBy('at').orderBy('id').execute();
      expect(audit.map((x) => [x.action, x.actor])).toEqual([['insert', 'test:ada'], ['update', 'test:bob'], ['update', 'test:bob']]);
      await expect(store.updateNewsletterItem(id, { statut: 'brouillon' as never }, 'test:bob')).rejects.toThrow(/check constraint/);
    });
  });

  it('delegates the axis corrections to the Grist store', async () => {
    await inRollback(async (trx) => {
      const store = createPgPublicationsStore({ db: trx, grist });
      expect(await store.axisCorrections('ec-nantes')).toHaveLength(1);
      expect(await store.updateAxisCorrection('ec-nantes', 7, 'santé')).toEqual({ table: 'Publications_centrale_axes_strategiques2' });
    });
  });
});
