// Doctoral theses of a researcher from theses.fr (druid-internal docs/plan-funding-calls.md, lot 5, decision D5): the
// public API of the national thesis portal describes a person by its IdRef (`/api/v1/personnes/personne/<idref>`):
// the theses where it is author, supervisor, reviewer… The theses it authored give the date of its PhD, which drives
// the eligibility to the young researcher schemes (ERC Starting / Consolidator, MSCA Postdoctoral Fellowships, ANR
// JCJC). Pure: parsing and choice of the PhD, shared by the sync script and its tests.

export const THESES_PERSON_API = 'https://theses.fr/api/v1/personnes/personne/';
export const thesisPageUrl = (nnt: string): string => `https://theses.fr/${encodeURIComponent(nnt)}`;

export type ThesisStatus = 'defended' | 'in_progress';

export interface Thesis {
  /** National thesis number (2016MONTD064). */
  nnt: string;
  title: string;
  /** Fuzzy date: YYYY-MM-DD, or YYYY when theses.fr gives 1 January (its value when it only knows the year). */
  defendedOn: string | null;
  status: ThesisStatus;
  institution: string;
  discipline: string;
}

/** Text of a field, without the invisible direction and width marks some records carry (« Clermont Auvergne\u200e »). */
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();

/** Date of defence as stored: the year alone for a 1 January, the day otherwise; null when unreadable. */
export const thesisDate = (v: unknown): string | null => {
  const m = str(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return /^\d{4}$/.test(str(v)) ? str(v) : null;
  return m[2] === '01' && m[3] === '01' ? m[1] : `${m[1]}-${m[2]}-${m[3]}`;
};

const STATUS: Record<string, ThesisStatus> = { soutenue: 'defended', encours: 'in_progress' };

/**
 * Theses authored by the person of a theses.fr answer; null when theses.fr does not know the person (its answer to an
 * unknown IdRef is `{"status":"BAD_REQUEST","message":"Person not found"}`). The role key is « Auteur / Autrice »;
 * any key starting with « Auteur » is read, in case the label changes.
 */
export const parseThesesPerson = (body: unknown): Thesis[] | null => {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!root || !root.theses || typeof root.theses !== 'object') return null;
  const theses = root.theses as Record<string, unknown>;
  const authored = Object.entries(theses).filter(([role]) => /^auteur/i.test(role)).flatMap(([, list]) => (Array.isArray(list) ? list : []));
  const out: Thesis[] = [];
  for (const t of authored as Record<string, unknown>[]) {
    const nnt = str(t?.id);
    const status = STATUS[str(t?.status).toLowerCase().replace(/\s+/g, '')];
    if (!nnt || !status) continue;
    const institution = t.etablissement_soutenance as { nom?: unknown } | null | undefined;
    out.push({
      nnt, title: str(t.titre), defendedOn: status === 'defended' ? thesisDate(t.date_soutenance) : null, status,
      institution: str(institution?.nom), discipline: str(t.discipline),
    });
  }
  return out;
};

/** The PhD of a person: its first defended thesis (a second one is rare: another doctorate); null without one. */
export const phdOf = <T extends Pick<Thesis, 'status' | 'defendedOn'>>(theses: readonly T[]): T | null =>
  theses.filter((t) => t.status === 'defended' && t.defendedOn).sort((a, b) => a.defendedOn!.localeCompare(b.defendedOn!))[0] ?? null;

/** Year of a fuzzy date, null without one. */
export const yearOf = (fuzzy: string | null | undefined): number | null => (fuzzy && /^\d{4}/.test(fuzzy) ? Number(fuzzy.slice(0, 4)) : null);
