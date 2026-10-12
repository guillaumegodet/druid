// News items of the newsletter in PostgreSQL (lot 14 a of druid-internal docs/plan-migration-postgresql.md, D10 revised
// on 2026-10-12): table `newsletter_item`, written under the actor of the request (audit log). The axis corrections are
// in the Grist document of the structure (Centrale) until lot 10: delegated to the Grist store.
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { withActor, type DB } from '../db/client';
import type { NewsletterItem as NewsletterItemRow } from '../db/schema.gen';
import { mapNewsletterRecords, type NewsletterNewItem } from './newsletter';
import type { PublicationsStore } from './store';

/** '' or an unreadable date → NULL; the panel and the generation write ISO strings. */
const timestampOf = (v: string | undefined): Date | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const isoOf = (v: Date | string | null) => (v ? new Date(v).toISOString() : '');

type Queryable = Kysely<DB> | Transaction<DB>;

/** Writes under `actor` (audit log): in the caller's transaction (tests), or in a new one. */
const asActor = async <T>(db: Queryable, actor: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> => {
  if (!db.isTransaction) return withActor(db as Kysely<DB>, actor, fn);
  await sql`SELECT set_config('druid.actor', ${actor}, true)`.execute(db);
  return fn(db as Transaction<DB>);
};

/** Row → the record shape of the Grist table, so that the items are mapped (and sorted) by one function. */
const recordOf = (r: Selectable<NewsletterItemRow>) => ({
  id: Number(r.id),
  fields: { ...r, id: undefined, genere_le: isoOf(r.genere_le), valide_le: isoOf(r.valide_le) } as Record<string, unknown>,
});

export interface PgPublicationsStoreOptions {
  db: Queryable;
  /** Grist store of the instance: axis corrections. */
  grist: PublicationsStore;
}

export const createPgPublicationsStore = ({ db, grist }: PgPublicationsStoreOptions): PublicationsStore => ({
  async newsletter(slug) {
    const rows = await db.selectFrom('newsletter_item').selectAll().where('slug', '=', slug).execute();
    return mapNewsletterRecords(rows.map(recordOf) as Parameters<typeof mapNewsletterRecords>[0]);
  },
  axisCorrections: (slug) => grist.axisCorrections(slug),
  async newsletterSlugOf(id) {
    const row = await db.selectFrom('newsletter_item').select('slug').where('id', '=', String(id)).executeTakeFirst();
    return row ? row.slug : null;
  },
  async updateNewsletterItem(id, fields, actor = 'druid') {
    const { valide_le, ...rest } = fields;
    await asActor(db, actor, (trx) => trx.updateTable('newsletter_item')
      .set({ ...rest, ...(valide_le === undefined ? {} : { valide_le: timestampOf(valide_le) }) })
      .where('id', '=', String(id)).execute());
  },
  async newsletterWorkIds(slug) {
    const rows = await db.selectFrom('newsletter_item').select('work_id').where('slug', '=', slug).execute();
    return new Set(rows.map((r) => r.work_id));
  },
  async addNewsletterItem(item: NewsletterNewItem, actor = 'druid') {
    const row = await asActor(db, actor, (trx) => trx.insertInto('newsletter_item')
      .values({ ...item, genere_le: timestampOf(item.genere_le), valide_le: timestampOf(item.valide_le) })
      .returning('id').executeTakeFirst());
    return row ? Number(row.id) : null;
  },
  updateAxisCorrection: (slug, rowId, axe) => grist.updateAxisCorrection(slug, rowId, axe),
});
