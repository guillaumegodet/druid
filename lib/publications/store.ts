// Publications side of the storage (D10 of druid-internal docs/plan-migration-postgresql.md): the tables fed
// by druid-biblio or by the editorial workflow (Newsletter, axis corrections) stay in Grist and do not move
// to PostgreSQL with the directory. Druid reads them through this store, kept apart from the
// DirectoryRepository so that the directory can change storage without them.
import type { GristReader } from '../directory/repository';
import { mapNewsletterRecords, NewsletterItem } from './newsletter';
import { AXES_GRIST, AxisCorrectionRow, axisCorrectionRows } from './axes';

export interface PublicationsStore {
  /** News items of a structure (`slug` column of the Newsletter table), most recent first. */
  newsletter(slug: string): Promise<NewsletterItem[]>;
  /** Axis corrections of a structure; null when the structure has none (AXES_GRIST). */
  axisCorrections(slug: string): Promise<AxisCorrectionRow[] | null>;
}

/** Thrown when the instance may not read the document holding the requested data. */
export class DocumentNotAllowedError extends Error {}

export interface GristPublicationsStoreOptions {
  /** Main document of the instance (Newsletter table). */
  main: GristReader;
  /** Reader of another document, null when the instance may not read it (Nantes: GRIST_EXTRA_DOC_IDS). */
  readerFor: (docId: string) => GristReader | null;
}

export const createGristPublicationsStore = ({ main, readerFor }: GristPublicationsStoreOptions): PublicationsStore => ({
  async newsletter(slug) {
    return mapNewsletterRecords(await main.records('Newsletter', { slug: [slug] }));
  },
  async axisCorrections(slug) {
    const cfg = AXES_GRIST[slug];
    if (!cfg) return null;
    const reader = readerFor(cfg.docId);
    if (!reader) throw new DocumentNotAllowedError(`Document not readable by this instance: ${cfg.docId}`);
    return axisCorrectionRows(await reader.records(cfg.table), cfg.field);
  },
});
