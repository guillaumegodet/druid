/**
 * @file identifiers.ts
 * @description Identifiers of a research structure (druid-internal docs/plan-druid-saas.md, § 4): the types Druid
 * aligns, how a raw value is normalized and which record it points to, and the V2 field of `extra` each single-valued
 * type is projected to (the exports and the record read those fields). Pure module, shared by the browser, the API and
 * the alignment job.
 */
export const STRUCTURE_ID_TYPES = ['rnsr', 'ror', 'hal_struct', 'hal_collection', 'openalex', 'idref', 'wikidata', 'isni', 'uai', 'siret', 'grid', 'scopus_affil'] as const;
export type StructureIdType = typeof STRUCTURE_ID_TYPES[number];

/** The types the alignment page shows as columns, in this order (the others are kept as bridges only). */
export const ALIGNED_STRUCTURE_ID_TYPES: StructureIdType[] = ['rnsr', 'ror', 'hal_struct', 'hal_collection', 'openalex', 'idref', 'wikidata'];

export interface StructureIdTypeMeta {
  label: string;
  /** Several confirmed values are normal (HAL structure records, OpenAlex institutions). */
  multi: boolean;
  /** V2 field of `extra` the primary value is projected to (none for the multi-valued types, see PROJECTED_LISTS). */
  v2Field?: string;
  normalize: (raw: unknown) => string | null;
  url: (value: string) => string;
}

const text = (raw: unknown): string => String(raw ?? '').trim();
const last = (raw: unknown): string => text(raw).replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^.*\//, '');
const matchOf = (raw: string, re: RegExp): string | null => { const m = raw.match(re); return m ? m[1] : null; };

export const STRUCTURE_ID_META: Record<StructureIdType, StructureIdTypeMeta> = {
  rnsr: {
    label: 'RNSR', multi: false, v2Field: 'nns',
    normalize: (raw) => matchOf(text(raw).toUpperCase(), /(\d{9}[A-Z])/),
    url: (v) => `https://appliweb.dgri.education.fr/rnsr/PresenteStruct.jsp?PUBLIC=OK&numNatStruct=${v}`,
  },
  ror: {
    label: 'ROR', multi: false, v2Field: 'ror',
    normalize: (raw) => matchOf(last(raw).toLowerCase(), /^(0[a-z0-9]{6}[0-9]{2})$/),
    url: (v) => `https://ror.org/${v}`,
  },
  hal_struct: {
    label: 'HAL (structure)', multi: true,
    normalize: (raw) => matchOf(last(raw), /^(\d{1,9})$/),
    url: (v) => `https://aurehal.archives-ouvertes.fr/structure/read/id/${v}`,
  },
  hal_collection: {
    label: 'HAL (collection)', multi: false, v2Field: 'hal_collection',
    normalize: (raw) => { const v = last(raw).toUpperCase(); return /^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(v) ? v : null; },
    url: (v) => `https://hal.science/${v}`,
  },
  openalex: {
    label: 'OpenAlex', multi: true,
    normalize: (raw) => matchOf(last(raw).toUpperCase(), /^(I\d{3,})$/),
    url: (v) => `https://openalex.org/${v}`,
  },
  idref: {
    label: 'IdRef', multi: false, v2Field: 'idref',
    normalize: (raw) => matchOf(last(raw).toUpperCase().replace(/\.(XML|JSON|RDF)$/, ''), /^(\d{8}[\dX])$/),
    url: (v) => `https://www.idref.fr/${v}`,
  },
  wikidata: {
    label: 'Wikidata', multi: false, v2Field: 'wikidata',
    normalize: (raw) => matchOf(last(raw).toUpperCase(), /^(Q\d+)$/),
    url: (v) => `https://www.wikidata.org/wiki/${v}`,
  },
  isni: {
    label: 'ISNI', multi: false, v2Field: 'isni',
    normalize: (raw) => matchOf(last(raw).toUpperCase().replace(/[\s-]/g, ''), /^(\d{15}[\dX])$/),
    url: (v) => `https://isni.org/isni/${v}`,
  },
  uai: {
    label: 'UAI', multi: false, v2Field: 'uai',
    normalize: (raw) => matchOf(text(raw).toUpperCase(), /^(\d{7}[A-Z])$/),
    url: (v) => `https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-principaux-etablissements-enseignement-superieur/table/?q=${v}`,
  },
  siret: {
    label: 'SIRET', multi: false,
    normalize: (raw) => matchOf(text(raw).replace(/\s/g, ''), /^(\d{14})$/),
    url: (v) => `https://annuaire-entreprises.data.gouv.fr/etablissement/${v}`,
  },
  grid: {
    label: 'GRID', multi: false,
    normalize: (raw) => matchOf(last(raw), /^(grid\.\d+\.[0-9a-z]+)$/i),
    url: (v) => `https://www.grid.ac/institutes/${v}`,
  },
  scopus_affil: {
    label: 'Scopus (affiliation)', multi: false, v2Field: 'scopus',
    normalize: (raw) => matchOf(text(raw).replace(/\.0+$/, ''), /^(\d{6,12})$/),
    url: (v) => `https://www.scopus.com/affil/profile.uri?afid=${v}`,
  },
};

/** V2 list fields of `extra` the multi-valued types are projected to (pipe-separated, primary first). */
export const PROJECTED_LISTS: Partial<Record<StructureIdType, string>> = { hal_struct: 'hal_struct_ids', openalex: 'openalex_ids' };

export const isStructureIdType = (v: unknown): v is StructureIdType => STRUCTURE_ID_TYPES.includes(v as StructureIdType);

/** Normalized value of `raw` for `type`, null when it is empty or not of that shape. */
export const normalizeStructureId = (type: StructureIdType, raw: unknown): string | null => STRUCTURE_ID_META[type].normalize(raw);

export const structureIdUrl = (type: StructureIdType, value: string): string => STRUCTURE_ID_META[type].url(value);

/** `a|b|c` → ['a', 'b', 'c'] (the V2 list fields). */
export const splitIdList = (raw: unknown): string[] => String(raw ?? '').split('|').map((s) => s.trim()).filter(Boolean);

export type StructureIdStatus = 'confirmed' | 'rejected';

/** One identifier of a structure as the API serves it. */
export interface StructureIdentifier {
  type: StructureIdType;
  value: string;
  isPrimary: boolean;
  status: StructureIdStatus;
  source: string;
  note: string | null;
  decidedBy: string | null;
  checkedAt: string | null;
  checkResult: Record<string, unknown> | null;
  url: string;
}

// ── Text normalization for the matching ───────────────────────────────────────────────────────────────────────────────
const STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'en', 'a', 'au', 'aux', 'pour', 'sur', 'of', 'the', 'and', 'for', 'in', 'on',
  'laboratoire', 'laboratory', 'lab', 'unite', 'unit', 'umr', 'ur', 'ea', 'fr', 'ums', 'umi', 'cnrs', 'inserm', 'inrae', 'inria', 'universite', 'university', 'univ', 'equipe', 'team']);

/** Lower-cased ASCII words of a label, without punctuation. */
export const nameTokens = (raw: unknown): string[] =>
  String(raw ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

/** Tokens that carry meaning (stop words and generic words removed). */
export const significantTokens = (raw: unknown): string[] => nameTokens(raw).filter((w) => !STOP_WORDS.has(w) && (w.length > 1 || /\d/.test(w)));

/** Dice coefficient of the significant tokens of two labels (0..1); 0 when one of them has none. */
export const nameSimilarity = (a: unknown, b: unknown): number => {
  const ta = new Set(significantTokens(a));
  const tb = new Set(significantTokens(b));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return (2 * common) / (ta.size + tb.size);
};

/** `LS2N` ≈ `ls2n` ≈ `L.S.2.N.`: acronyms compared without punctuation, accents or case. */
export const normalizeAcronymKey = (raw: unknown): string => nameTokens(raw).join('');

/** `UMR 6004` → { labelType: 'UMR', code: '6004' }; also reads `UMR_6004`, `UMR6004`, `UMR-S 1087`. */
export const parseUnitLabel = (raw: unknown): { labelType: string; code: string } | null => {
  const m = String(raw ?? '').trim().toUpperCase().match(/^([A-Z]{1,5}(?:[ _-]?[A-Z])?)[ _-]*(\d{2,5}[A-Z]?)$/);
  return m ? { labelType: m[1].replace(/[ _]/g, '-'), code: m[2] } : null;
};
