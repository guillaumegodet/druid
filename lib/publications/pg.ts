// News items of the newsletter in PostgreSQL (lot 14 a of druid-internal docs/plan-migration-postgresql.md, D10 revised
// on 2026-10-12): table `newsletter_item`, written under the actor of the request (audit log). The axis corrections are
// in the Grist document of the structure (Centrale) until lot 10: delegated to the Grist store.
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { withActor, type DB } from '../db/client';
import { ApiError } from '../directory/errors';
import type { NewsletterItem as NewsletterItemRow } from '../db/schema.gen';
import { mapNewsletterRecords, type NewsletterNewItem } from './newsletter';
import type { PublicationsStore } from './store';
import type { AxisReview, AxisReviewInput } from './axisReviews';
import type { AxisReview as AxisReviewRow } from '../db/schema.gen';

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

const reviewOf = (r: Selectable<AxisReviewRow>): AxisReview => ({
  workKey: r.work_key, doi: r.doi, title: r.title, decision: r.decision as AxisReview['decision'], axes: r.axes,
  autoAxis: r.auto_axis, autoConfidence: r.auto_confidence, author: r.author, note: r.note, updatedAt: isoOf(r.updated_at),
});

/** Row → the record shape of the Grist table, so that the items are mapped (and sorted) by one function. */
const recordOf = (r: Selectable<NewsletterItemRow>) => ({
  id: Number(r.id),
  fields: { ...r, id: undefined, genere_le: isoOf(r.genere_le), valide_le: isoOf(r.valide_le) } as Record<string, unknown>,
});

export interface PgPublicationsStoreOptions {
  db: Queryable;
  /** Grist store of the instance: axis corrections. Absent (Cloudflare, lot 10 a): no structure has axes. */
  grist?: PublicationsStore;
}

export const createPgPublicationsStore = ({ db, grist }: PgPublicationsStoreOptions): PublicationsStore => ({
  async newsletter(slug) {
    // By id: same order as the Grist rows for items published the same day (the import keeps the Grist row order).
    const rows = await db.selectFrom('newsletter_item').selectAll().where('slug', '=', slug).orderBy('id').execute();
    return mapNewsletterRecords(rows.map(recordOf) as Parameters<typeof mapNewsletterRecords>[0]);
  },
  axisCorrections: (slug) => (grist ? grist.axisCorrections(slug) : Promise.resolve(null)),
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
  updateAxisCorrection: (slug, rowId, axe) => {
    if (!grist) throw new ApiError(404, `No axis corrections for structure: ${slug}`);
    return grist.updateAxisCorrection(slug, rowId, axe);
  },
  // Axis reviews (druid-internal docs/plan-axes-embeddings.md, lot 2): table axis_review, one row per publication and
  // structure, written under the actor of the request.
  axisReviewsSupported: true,
  async axisReviews(slug) {
    const rows = await db.selectFrom('axis_review').selectAll().where('slug', '=', slug).orderBy('updated_at', 'desc').execute();
    return rows.map(reviewOf);
  },
  async saveAxisReview(slug, input: AxisReviewInput, actor) {
    const values = {
      slug, work_key: input.workKey, doi: input.doi ?? '', title: input.title ?? '', decision: input.decision, axes: input.axes ?? [],
      auto_axis: input.autoAxis ?? '', auto_confidence: input.autoConfidence ?? null, author: actor, note: input.note ?? '',
    };
    const row = await asActor(db, actor, (trx) => trx.insertInto('axis_review').values(values)
      .onConflict((oc) => oc.columns(['slug', 'work_key']).doUpdateSet({ ...values, slug: undefined, work_key: undefined } as any))
      .returningAll().executeTakeFirstOrThrow());
    return reviewOf(row);
  },
  async deleteAxisReview(slug, workKey, actor) {
    const result = await asActor(db, actor, (trx) => trx.deleteFrom('axis_review').where('slug', '=', slug).where('work_key', '=', workKey).executeTakeFirst());
    return Number(result.numDeletedRows) > 0;
  },
});
