// Calls added by hand (druid-internal docs/plan-funding-calls.md, lot 6): the calls of the funders no collector reads
// (Region, foundations, France 2030 calls of other operators, PHC, ADEME, internal calls…), added from the URL or the
// PDF of the call — the server reads the text, the language model of the instance proposes the fields, a person reviews
// them — or from the catalogue of the research office (CSV or spreadsheet). They live in programmes of the `manual`
// source, which no collector touches (a collector closes the calls of its programmes that it no longer lists).
// Pure functions shared by the server and the tests (no Node import: the administration page imports the types); the
// store is lib/calls/manualStore.ts, the reading of a page or a PDF lib/calls/callDocument.ts.
import { FUNDER_CATEGORIES, statusFromDeadlines, type CallStatus, type FunderCategory } from './programmes';

export const MANUAL_SOURCE = 'manual';
/** Prefix of the funders, programmes and calls created by hand: they never collide with those of the collectors. */
export const MANUAL_PREFIX = 'm-';

export type ReviewStatus = 'to_validate' | 'validated' | 'rejected';
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['to_validate', 'validated', 'rejected'];

export const LIMITS = {
  title: 400,
  url: 1000,
  summary: 2000,
  objectives: 20000,
  scope: 20000,
  eligibility: 5000,
  budget: 500,
  subset: 120,
  name: 200,
  deadlines: 4,
  /** Characters of the text of a call handed to the language model (≈ 15 000 tokens). */
  extractChars: 60000,
  /** Rows of a catalogue imported at once. */
  csvRows: 1000,
} as const;

/** Programme of a call added by hand: an existing programme, or a new one (of an existing or new funder). */
export type ManualProgrammeRef =
  | { programmeId: string }
  | { name: string; funder: { funderId: string } | { name: string; category: FunderCategory; country?: string } };

/** A call as the form (or a row of a catalogue) gives it, before validation. */
export interface ManualCallInput {
  title: string;
  programme: ManualProgrammeRef;
  url?: string;
  lang?: string;
  openingDate?: string | null;
  deadlines?: string[];
  summary?: string;
  objectives?: string;
  scope?: string;
  eligibility?: string;
  budget?: string;
  subset?: string;
  /** Classification of the call (`source` of a catalogue: researchconnect…), at most 10 short entries. */
  taxonomy?: Record<string, string>;
}

/** The validated call, ready for the store. */
export interface ManualCall {
  title: string;
  programme: ManualProgrammeRef;
  url: string;
  lang: 'fr' | 'en';
  openingDate: string | null;
  deadlines: string[];
  summary: string;
  objectives: string;
  scope: string;
  eligibility: string;
  budget: string;
  subset: string;
  taxonomy: Record<string, string>;
  status: CallStatus;
}

/** A call added by hand as the administration lists it. */
export interface ManualCallView extends Omit<ManualCall, 'programme' | 'status'> {
  callId: string;
  programmeId: string;
  programmeName: string;
  funderId: string;
  funderName: string;
  status: CallStatus;
  reviewStatus: ReviewStatus;
  addedBy: string;
  reviewedBy: string;
  reviewedAt: string | null;
  updatedAt: string;
  matches: number;
}

/** A programme a call added by hand may go to (source `manual`), with its funder. */
export interface ManualProgrammeView {
  programmeId: string;
  name: string;
  funderId: string;
  funderName: string;
  category: FunderCategory;
  active: boolean;
}

export interface FunderView {
  funderId: string;
  name: string;
  category: FunderCategory;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** 'YYYY-MM-DD' of a real day, else null. */
export const isoDay = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  if (!ISO_DAY.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};

/** A day as people write it in a catalogue: ISO, French (31/12/2026, 31.12.2026), or a spreadsheet serial number. */
export const dayOf = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  if (!s) return null;
  const iso = isoDay(s.slice(0, 10));
  if (iso) return iso;
  const fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (fr) return isoDay(`${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`);
  // Serial number of a spreadsheet cell (days since 1899-12-30), between 2000 and 2100.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n > 36500 && n < 73000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return null;
};

const text = (v: unknown, max: number): string => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, max);
const line = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Lower-case ASCII slug (a-z, 0-9, dashes), at most `max` characters. */
export const slugOf = (s: string, max = 40): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

export const manualFunderId = (name: string): string => `${MANUAL_PREFIX}${slugOf(name, 40) || 'funder'}`;
export const manualProgrammeId = (funderId: string, name: string): string =>
  `${funderId.startsWith(MANUAL_PREFIX) ? '' : MANUAL_PREFIX}${funderId}-${slugOf(name, 30) || 'programme'}`.slice(0, 60).replace(/-+$/, '');

/** Validates a call of the form or of a catalogue; errors are English sentences shown as they are. */
export const validateManualCall = (input: ManualCallInput, today: string): { call: ManualCall | null; errors: string[] } => {
  const errors: string[] = [];
  const title = line(input.title, LIMITS.title);
  if (title.length < 3) errors.push('The title is missing');
  const url = line(input.url, LIMITS.url);
  if (url && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)) errors.push('The URL must start with http:// or https://');
  const lang = input.lang === 'en' ? 'en' : 'fr';
  let openingDate: string | null = null;
  if (input.openingDate) {
    openingDate = isoDay(input.openingDate);
    if (!openingDate) errors.push('The opening date is not a valid day (YYYY-MM-DD)');
  }
  const raw = (input.deadlines ?? []).map((d) => String(d ?? '').trim()).filter(Boolean);
  const deadlines = [...new Set(raw.map(isoDay))].filter((d): d is string => !!d).sort();
  if (deadlines.length < new Set(raw).size) errors.push('A deadline is not a valid day (YYYY-MM-DD)');
  if (deadlines.length > LIMITS.deadlines) errors.push('At most 4 deadlines');
  if (openingDate && deadlines.length && deadlines[deadlines.length - 1] < openingDate) errors.push('The deadline is before the opening date');
  const programme = programmeRefOf(input.programme, errors);
  const taxonomy: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.taxonomy ?? {}).slice(0, 10)) {
    const key = slugOf(String(k), 40);
    const value = line(v, 200);
    if (key && value) taxonomy[key] = value;
  }
  if (errors.length || !programme) return { call: null, errors };
  return {
    call: {
      title, programme, url, lang, openingDate, deadlines,
      summary: text(input.summary, LIMITS.summary), objectives: text(input.objectives, LIMITS.objectives),
      scope: text(input.scope, LIMITS.scope), eligibility: text(input.eligibility, LIMITS.eligibility),
      budget: line(input.budget, LIMITS.budget), subset: line(input.subset, LIMITS.subset), taxonomy,
      status: statusFromDeadlines(deadlines, today, openingDate),
    },
    errors,
  };
};

const programmeRefOf = (ref: ManualProgrammeRef | undefined, errors: string[]): ManualProgrammeRef | null => {
  if (!ref || typeof ref !== 'object') { errors.push('The programme is missing'); return null; }
  if ('programmeId' in ref) {
    const programmeId = String(ref.programmeId ?? '').trim();
    if (!/^[a-z0-9-]{1,60}$/.test(programmeId)) { errors.push('The programme is missing'); return null; }
    return { programmeId };
  }
  const name = line(ref.name, LIMITS.name);
  if (!name) { errors.push('The name of the programme is missing'); return null; }
  const funder = ref.funder;
  if (funder && 'funderId' in funder) {
    const funderId = String(funder.funderId ?? '').trim();
    if (!/^[a-z0-9-]{1,60}$/.test(funderId)) { errors.push('The funder is missing'); return null; }
    return { name, funder: { funderId } };
  }
  const funderName = line(funder?.name, LIMITS.name);
  if (!funderName) { errors.push('The funder is missing'); return null; }
  const category = FUNDER_CATEGORIES.includes(funder!.category) ? funder!.category : 'Autre';
  return { name, funder: { name: funderName, category, country: line(funder!.country, 2).toUpperCase() || 'FR' } };
};

// ── Extraction of the fields by the language model ───────────────────────────────────────────────────────────────────

/** What the model proposes from the text of a call; the person reviews it before anything is saved. */
export interface ExtractedCall {
  title: string;
  funder: string;
  programme: string;
  lang: 'fr' | 'en';
  openingDate: string | null;
  deadlines: string[];
  summary: string;
  objectives: string;
  scope: string;
  eligibility: string;
  budget: string;
}

export const EXTRACTION_SYSTEM = [
  "Tu lis le texte d'un appel à projets de recherche (page web ou PDF) et tu en extrais les champs, sans rien inventer.",
  'Réponds uniquement en JSON, avec exactement ces clés :',
  '{"titre": "", "financeur": "", "programme": "", "langue": "fr", "date_ouverture": null, "dates_limite": [],',
  ' "resume": "", "objectifs": "", "perimetre": "", "eligibilite": "", "budget": ""}',
  '- titre : intitulé officiel de l\'appel ; financeur : organisme qui finance (ex. « Région Pays de la Loire », « Fondation ARC ») ;',
  '  programme : dispositif ou programme dont relève l\'appel (ex. « Étoiles montantes », « PEPR Santé numérique »), sinon "".',
  '- langue : "fr" ou "en", la langue du texte.',
  '- date_ouverture : date d\'ouverture AAAA-MM-JJ ou null ; dates_limite : dates de clôture des dépôts AAAA-MM-JJ, de la',
  '  première à la dernière étape (au plus 4) ; une date sans année ou une heure seule est ignorée.',
  '- resume : 2 ou 3 phrases dans la langue du texte, ce que l\'appel finance et pour qui.',
  '- objectifs : les objectifs de l\'appel, repris du texte (au plus 300 mots).',
  '- perimetre : les thèmes, disciplines et sujets attendus, repris du texte (au plus 800 mots) ; c\'est ce texte qui sert à',
  '  trouver les chercheurs concernés, garde les termes scientifiques.',
  '- eligibilite : qui peut déposer (statut, étape de carrière, établissement, partenariat), repris du texte (au plus 200 mots).',
  '- budget : montant par projet ou enveloppe, tel que le texte le donne (une ligne).',
  'Un champ absent du texte reste "" (ou null, ou []).',
].join('\n');

/** The user message: the URL (it often names the funder) and the text, cut to the limit of the model. */
export const extractionPrompt = (documentText: string, url = ''): string =>
  `${url ? `Adresse : ${url}\n\n` : ''}Texte de l'appel :\n\n${documentText.slice(0, LIMITS.extractChars)}`;

/** Readable text of a whole web page: scripts, styles and navigation go, block ends become line breaks. */
export const pageText = (html: string, htmlToText: (h: string) => string): string => {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return htmlToText(main
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' '));
};

/** Title of an HTML page (og:title, else <title>), for a draft the model could not read. */
export const pageTitle = (html: string): string =>
  (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();

/** The model's answer → the proposed fields; null when it is not usable JSON or has no title. */
export const parseExtraction = (content: string): ExtractedCall | null => {
  const raw = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let o: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const title = line(o.titre ?? o.title, LIMITS.title);
  if (!title) return null;
  const dates = Array.isArray(o.dates_limite) ? o.dates_limite : o.dates_limite ? [o.dates_limite] : [];
  const deadlines = [...new Set(dates.map(isoDay).filter((d): d is string => !!d))].sort().slice(0, LIMITS.deadlines);
  return {
    title,
    funder: line(o.financeur, LIMITS.name),
    programme: line(o.programme, LIMITS.name),
    lang: o.langue === 'en' ? 'en' : 'fr',
    openingDate: isoDay(o.date_ouverture),
    deadlines,
    summary: text(o.resume, LIMITS.summary),
    objectives: text(o.objectifs, LIMITS.objectives),
    scope: text(o.perimetre, LIMITS.scope),
    eligibility: text(o.eligibilite, LIMITS.eligibility),
    budget: line(o.budget, LIMITS.budget),
  };
};

// ── Catalogue (CSV or spreadsheet of the research office) ────────────────────────────────────────────────────────────

/** Column of the catalogue → field; the headers are compared without accents, case or punctuation. */
const CSV_COLUMNS: Record<string, keyof CatalogueRow> = {
  titre: 'title', title: 'title', intitule: 'title',
  financeur: 'funder', funder: 'funder', organisme: 'funder',
  categorie: 'category', category: 'category', typedefinanceur: 'category',
  programme: 'programme', dispositif: 'programme', programmeid: 'programmeId',
  url: 'url', lien: 'url', link: 'url', adresse: 'url',
  langue: 'lang', lang: 'lang', language: 'lang',
  ouverture: 'openingDate', dateouverture: 'openingDate', openingdate: 'openingDate', opening: 'openingDate',
  datelimite: 'deadline', cloture: 'deadline', datecloture: 'deadline', deadline: 'deadline', echeance: 'deadline',
  datelimite2: 'deadline2', deadline2: 'deadline2', etape2: 'deadline2',
  resume: 'summary', summary: 'summary', description: 'summary',
  objectifs: 'objectives', objectives: 'objectives',
  perimetre: 'scope', scope: 'scope', thematiques: 'scope', themes: 'scope', motscles: 'scope', keywords: 'scope',
  eligibilite: 'eligibility', eligibility: 'eligibility', publiccible: 'eligibility',
  budget: 'budget', montant: 'budget', financement: 'budget',
  reference: 'reference', ref: 'reference', identifiant: 'reference', id: 'reference',
  source: 'source', origine: 'source',
};

export interface CatalogueRow {
  title: string;
  funder: string;
  category: string;
  programme: string;
  programmeId: string;
  url: string;
  lang: string;
  openingDate: string;
  deadline: string;
  deadline2: string;
  summary: string;
  objectives: string;
  scope: string;
  eligibility: string;
  budget: string;
  /** Identifier of the row in the catalogue: the same reference updates the same call on the next import. */
  reference: string;
  /** Where the catalogue comes from (researchconnect…), kept in the classification of the call. */
  source: string;
}

const headerKey = (h: string): string => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Fields recognised among the headers of a catalogue, and those ignored. */
export const catalogueColumns = (headers: string[]): { known: Record<string, keyof CatalogueRow>; ignored: string[] } => {
  const known: Record<string, keyof CatalogueRow> = {};
  const ignored: string[] = [];
  for (const h of headers) {
    const field = CSV_COLUMNS[headerKey(h)];
    if (field && !Object.values(known).includes(field)) known[h] = field;
    else ignored.push(h);
  }
  return { known, ignored };
};

/** A row of the catalogue (header → cell, as the spreadsheet reader gives it) → its fields. */
export const catalogueRowOf = (row: Record<string, unknown>, known: Record<string, keyof CatalogueRow>): CatalogueRow => {
  const out: CatalogueRow = {
    title: '', funder: '', category: '', programme: '', programmeId: '', url: '', lang: '', openingDate: '', deadline: '', deadline2: '',
    summary: '', objectives: '', scope: '', eligibility: '', budget: '', reference: '', source: '',
  };
  for (const [header, field] of Object.entries(known)) {
    const v = row[header];
    out[field] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim();
  }
  return out;
};

/** Category of a funder as a catalogue writes it (ANR, Europe, Region, Foundation…), or guessed from its name. */
export const categoryOf = (v: string): FunderCategory => {
  const k = headerKey(v);
  if (!k) return 'Autre';
  const exact = FUNDER_CATEGORIES.find((c) => headerKey(c) === k);
  if (exact) return exact;
  if (k.startsWith('anr')) return 'ANR';
  if (/^(europe|ue|eu|union|commission)/.test(k)) return 'Europe';
  if (/^(region|regional|departement|metropole|collectivite)/.test(k)) return 'Régional';
  if (/^(fondation|prive|association|entreprise|foundation)/.test(k)) return 'Privé / fondations';
  if (/^(international|etranger)/.test(k)) return 'International';
  if (/^(national|ministere|etat|france2030|pia)/.test(k)) return 'Recherche nationale';
  return 'Autre';
};

/** The call a row of the catalogue describes (programme found by id, else created from the funder and programme names). */
export const catalogueCallInput = (row: CatalogueRow): ManualCallInput => {
  const programme: ManualProgrammeRef = row.programmeId
    ? { programmeId: row.programmeId }
    : { name: row.programme || row.funder, funder: { name: row.funder, category: categoryOf(row.category || row.funder) } };
  const lang = headerKey(row.lang);
  return {
    title: row.title, programme, url: row.url, lang: lang === 'en' || lang === 'anglais' || lang === 'english' ? 'en' : 'fr',
    openingDate: dayOf(row.openingDate) ?? (row.openingDate ? row.openingDate : null),
    deadlines: [row.deadline, row.deadline2].filter(Boolean).map((d) => dayOf(d) ?? d),
    summary: row.summary, objectives: row.objectives, scope: row.scope, eligibility: row.eligibility, budget: row.budget,
    ...(row.source ? { taxonomy: { source: slugOf(row.source, 40) } } : {}),
  };
};
