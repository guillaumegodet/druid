// Plan of the import of the news items from Grist (table `Newsletter`) into PostgreSQL (`newsletter_item`), lot 14 a of
// druid-internal docs/plan-migration-postgresql.md. Pure: scripts/import_newsletter.ts reads, plans, then writes.
import type { NewsletterStatus } from './newsletter';

const STATUSES: NewsletterStatus[] = ['genere', 'envoye', 'valide', 'rejete', 'publie'];
const TEXT_COLUMNS = [
  'numero', 'titre', 'doi', 'date_publication', 'journal', 'auteurs', 'labs', 'accroche', 'resume', 'resume_genere',
  'chercheur_nom', 'chercheur_email', 'chercheur_photo', 'chercheur_url', 'valide_par', 'commentaire',
] as const;

export interface NewsletterImportRow extends Record<(typeof TEXT_COLUMNS)[number], string> {
  /** Grist row id, kept; undefined when PostgreSQL already uses it for another item (a new id is taken). */
  id: number | undefined;
  slug: string;
  work_id: string;
  statut: NewsletterStatus;
  genere_le: Date | null;
  valide_le: Date | null;
}

export interface NewsletterImportPlan {
  rows: NewsletterImportRow[];
  /** Items already in PostgreSQL (same structure and work): left as they are. */
  alreadyPresent: number;
  /** Grist rows not imported, with the reason (no text of the item). */
  setAside: { id: number; reason: string }[];
  byStructure: Record<string, number>;
  byStatus: Record<string, number>;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const timestamp = (v: unknown): Date | null => {
  const s = text(v).trim();
  if (!s) return null;
  // Grist Date / DateTime columns hold seconds since the epoch; the generation wrote ISO strings.
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const planNewsletterImport = (
  records: { id: number; fields: Record<string, unknown> }[],
  present: { id: number; slug: string; work_id: string }[],
): NewsletterImportPlan => {
  const plan: NewsletterImportPlan = { rows: [], alreadyPresent: 0, setAside: [], byStructure: {}, byStatus: {} };
  const keys = new Set(present.map((p) => `${p.slug}\u0000${p.work_id}`));
  const takenIds = new Set(present.map((p) => p.id));
  const seen = new Map<string, number>();
  for (const r of [...records].sort((a, b) => a.id - b.id)) {
    const slug = text(r.fields.slug).trim();
    const workId = text(r.fields.work_id).trim();
    if (!slug || !workId) { plan.setAside.push({ id: r.id, reason: 'structure ou œuvre OpenAlex vide' }); continue; }
    const key = `${slug}\u0000${workId}`;
    if (keys.has(key)) { plan.alreadyPresent++; continue; }
    if (seen.has(key)) { plan.setAside.push({ id: r.id, reason: `doublon de la ligne ${seen.get(key)}` }); continue; }
    const statut = (text(r.fields.statut).trim() || 'genere') as NewsletterStatus;
    if (!STATUSES.includes(statut)) { plan.setAside.push({ id: r.id, reason: `statut inconnu « ${statut} »` }); continue; }
    seen.set(key, r.id);
    const row = {
      id: takenIds.has(r.id) ? undefined : r.id, slug, work_id: workId, statut,
      genere_le: timestamp(r.fields.genere_le), valide_le: timestamp(r.fields.valide_le),
    } as NewsletterImportRow;
    for (const c of TEXT_COLUMNS) row[c] = text(r.fields[c]);
    plan.rows.push(row);
    plan.byStructure[slug] = (plan.byStructure[slug] || 0) + 1;
    plan.byStatus[statut] = (plan.byStatus[statut] || 0) + 1;
  }
  return plan;
};
