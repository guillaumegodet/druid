// News items of the general-public newsletter, publications side of the storage (D10 of druid-internal
// docs/plan-migration-postgresql.md): PostgreSQL table `newsletter_item` on an instance on PostgreSQL (lot 14 a),
// Grist table `Newsletter` otherwise; Druid reads them through the PublicationsStore. Pure module, shared by the
// browser and the API.
import type { GristRecord } from '../directory/gristMapping';

export type NewsletterStatus = 'genere' | 'envoye' | 'valide' | 'rejete' | 'publie';

export interface NewsletterItem {
  id: number;
  work_id: string;
  numero: string;
  titre: string;
  doi: string;
  date_publication: string;
  journal: string;
  auteurs: string;
  labs: string;
  accroche: string;
  resume: string;
  statut: NewsletterStatus;
  chercheur_nom: string;
  chercheur_email: string;
  chercheur_photo: string;
  chercheur_url: string;
  valide_par: string;
}

/** Columns of a news item as the generation writes it (Grist `Newsletter` table, PostgreSQL `newsletter_item`). */
export interface NewsletterNewItem {
  work_id: string;
  slug: string;
  numero: string;
  titre: string;
  doi: string;
  date_publication: string;
  journal: string;
  auteurs: string;
  labs: string;
  accroche: string;
  resume: string;
  resume_genere: string;
  statut: NewsletterStatus;
  chercheur_nom: string;
  chercheur_email: string;
  chercheur_photo: string;
  chercheur_url: string;
  /** ISO date-time of the generation. */
  genere_le: string;
  valide_le: string;
  valide_par: string;
  commentaire: string;
}

/** Newsletter rows → items, most recent publication first (moved from NewsletterPanel). Pure. */
export function mapNewsletterRecords(records: GristRecord[]): NewsletterItem[] {
  const rows: NewsletterItem[] = (records || []).map((r: any) => ({
    id: r.id,
    work_id: String(r.fields.work_id || ''),
    numero: String(r.fields.numero || ''),
    titre: String(r.fields.titre || ''),
    doi: String(r.fields.doi || ''),
    date_publication: String(r.fields.date_publication || ''),
    journal: String(r.fields.journal || ''),
    auteurs: String(r.fields.auteurs || ''),
    labs: String(r.fields.labs || ''),
    accroche: String(r.fields.accroche || ''),
    resume: String(r.fields.resume || ''),
    statut: (String(r.fields.statut || 'genere') as NewsletterStatus),
    chercheur_nom: String(r.fields.chercheur_nom || ''),
    chercheur_email: String(r.fields.chercheur_email || ''),
    chercheur_photo: String(r.fields.chercheur_photo || ''),
    chercheur_url: String(r.fields.chercheur_url || ''),
    valide_par: String(r.fields.valide_par || ''),
  }));
  rows.sort((a, b) => (b.date_publication || '').localeCompare(a.date_publication || ''));
  return rows;
}
