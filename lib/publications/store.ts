// Publications side of the storage (D10 of druid-internal docs/plan-migration-postgresql.md): the tables fed
// by druid-biblio or by the editorial workflow (Newsletter, axis corrections) stay in Grist and do not move
// to PostgreSQL with the directory. Druid reads them through this store, kept apart from the
// DirectoryRepository so that the directory can change storage without them.
import type { GristClient } from '../directory/repository';
import { mapNewsletterRecords, NewsletterItem } from './newsletter';
import { AXES_GRIST, AxisCorrectionRow, axisCorrectionRows } from './axes';

export interface PublicationsStore {
  /** News items of a structure (`slug` column of the Newsletter table), most recent first; none on an
   * instance whose document has no Newsletter table (created by scripts/add_newsletter_table.cjs). */
  newsletter(slug: string): Promise<NewsletterItem[]>;
  /** Axis corrections of a structure; null when the structure has none (AXES_GRIST). */
  axisCorrections(slug: string): Promise<AxisCorrectionRow[] | null>;
  /** Structure (`slug`) of a news item, null when the item does not exist (lot 2 f: scope of a write). */
  newsletterSlugOf(id: number): Promise<string | null>;
  /** Editorial fields of a news item (status, brief, validation). */
  updateNewsletterItem(id: number, fields: Partial<Record<NewsletterEditableField, string>>): Promise<void>;
  /** Retained axis of a publication in the correction table of the structure. */
  updateAxisCorrection(slug: string, rowId: number, axe: string): Promise<{ table: string }>;
}

/** Fields of a news item the editorial workflow writes (NewsletterPanel). */
export const NEWSLETTER_EDITABLE_FIELDS = ['statut', 'accroche', 'resume', 'valide_le', 'valide_par'] as const;
export type NewsletterEditableField = typeof NEWSLETTER_EDITABLE_FIELDS[number];

/** Thrown when the instance may not read the document holding the requested data. */
export class DocumentNotAllowedError extends Error {}

export interface GristPublicationsStoreOptions {
  /** Main document of the instance (Newsletter table). */
  main: GristClient;
  /** Client of another document, null when the instance may not use it (Nantes: GRIST_EXTRA_DOC_IDS). */
  readerFor: (docId: string) => GristClient | null;
}

export const createGristPublicationsStore = ({ main, readerFor }: GristPublicationsStoreOptions): PublicationsStore => ({
  async newsletter(slug) {
    // Both requests at once: the records read fails (404) when the table does not exist.
    const [tableIds, rows] = await Promise.all([
      main.tableIds(),
      main.records('Newsletter', { slug: [slug] }).catch((err: unknown) => err as Error),
    ]);
    if (!tableIds.includes('Newsletter')) return [];
    if (rows instanceof Error) throw rows;
    return mapNewsletterRecords(rows);
  },
  async axisCorrections(slug) {
    const cfg = AXES_GRIST[slug];
    if (!cfg) return null;
    const reader = readerFor(cfg.docId);
    if (!reader) throw new DocumentNotAllowedError(`Document not readable by this instance: ${cfg.docId}`);
    return axisCorrectionRows(await reader.records(cfg.table), cfg.field);
  },
  async newsletterSlugOf(id) {
    const rows = await main.records('Newsletter', { id: [id] });
    return rows.length ? String(rows[0].fields.slug || '') : null;
  },
  async updateNewsletterItem(id, fields) {
    await main.updateRecords('Newsletter', [{ id, fields }]);
  },
  async updateAxisCorrection(slug, rowId, axe) {
    const cfg = AXES_GRIST[slug];
    if (!cfg) throw new DocumentNotAllowedError(`No axis corrections for this structure: ${slug}`);
    const client = readerFor(cfg.docId);
    if (!client) throw new DocumentNotAllowedError(`Document not readable by this instance: ${cfg.docId}`);
    await client.updateRecords(cfg.table, [{ id: rowId, fields: { [cfg.field]: axe } }]);
    return { table: cfg.table };
  },
});
