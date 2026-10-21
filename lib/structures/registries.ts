/**
 * @file registries.ts
 * @description The open registries of research structures as the alignment reads them (druid-internal
 * docs/plan-druid-saas.md, § 4.2): RNSR (open data of the ministry), ROR v2, AureHAL structures and HAL collections,
 * OpenAlex institutions, IdRef corporate bodies, Wikidata. Pure parsers from the raw API records to one common
 * `RegistryRecord` (unit-tested on fixtures); the HTTP side lives in registryClient.ts.
 */
import { normalizeStructureId, type StructureIdType } from './identifiers';

/** One record of a registry, whatever the registry: what the matching and the user need. */
export interface RegistryRecord {
  /** Identifier type of the registry the record comes from. */
  type: StructureIdType;
  /** Normalized identifier of the record in that registry. */
  id: string;
  label: string;
  acronym: string | null;
  altNames: string[];
  city: string | null;
  countryCode: string | null;
  /** The registry's own typing: `Unité mixte`, `laboratory`, `researchteam`, `education`, `facility`… */
  kind: string | null;
  /** `UMR 6004` when the registry carries the unit label. */
  unitLabel: string | null;
  /** Closed, inactive or superseded record (HAL `OLD`, ROR `inactive`/`withdrawn`). */
  closed: boolean;
  /** OpenAlex only. */
  worksCount: number | null;
  /** Names of the supervising institutions or parents. */
  tutelles: string[];
  /** Identifiers of the parents (ROR parents, HAL parent records, OpenAlex parent institutions). */
  parentIds: Partial<Record<StructureIdType, string[]>>;
  /** The other identifiers the record carries: the bridges. */
  links: Partial<Record<StructureIdType, string[]>>;
  url: string;
  /** Free text the matching may search a city in (HAL address). */
  address: string | null;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const arr = (v: unknown): string[] => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v]).map(str).filter(Boolean);
const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** Adds the normalized values of `raw` under `type` (bridges), ignoring what does not have the type's shape. */
const link = (into: Partial<Record<StructureIdType, string[]>>, type: StructureIdType, raw: unknown): void => {
  const values = uniq(arr(raw).map((v) => normalizeStructureId(type, v)).filter((v): v is string => !!v));
  if (values.length) into[type] = uniq([...(into[type] || []), ...values]);
};

const base = (type: StructureIdType, id: string, label: string, url: string): RegistryRecord => ({
  type, id, label, acronym: null, altNames: [], city: null, countryCode: null, kind: null, unitLabel: null, closed: false,
  worksCount: null, tutelles: [], parentIds: {}, links: {}, url, address: null,
});

/** `Nantes Cedex 3` → `Nantes`. */
export const cityOf = (raw: unknown): string | null => {
  const c = str(raw).replace(/\s+CEDEX.*$/i, '').replace(/\s+\d{5}\s*$/, '').trim();
  return c || null;
};

// ── RNSR (fr-esr-structures-recherche-publiques-actives, API Explore v2.1) ────────────────────────────────────────────
export const RNSR_DATASET = 'fr-esr-structures-recherche-publiques-actives';
export const RNSR_API = `https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/${RNSR_DATASET}/records`;

export const rnsrRecord = (raw: any): RegistryRecord | null => {
  const id = normalizeStructureId('rnsr', raw?.numero_national_de_structure);
  if (!id) return null;
  const r = base('rnsr', id, str(raw.libelle) || str(raw.sigle) || id, `https://appliweb.dgri.education.fr/rnsr/PresenteStruct.jsp?PUBLIC=OK&numNatStruct=${id}`);
  r.acronym = str(raw.sigle) || null;
  r.unitLabel = arr(raw.label_numero)[0] || null;
  r.kind = str(raw.type_de_structure) || null;
  r.city = cityOf(raw.commune);
  r.countryCode = 'FR';
  r.tutelles = uniq([...arr(raw.tutelles), ...arr(raw.sigles_des_tutelles)]);
  r.address = [str(raw.adresse), str(raw.code_postal), str(raw.commune)].filter(Boolean).join(' ') || null;
  link(r.parentIds, 'rnsr', raw.numero_de_structure_parent);
  // Some records carry the identifiers of the structure itself (recent exports of the dataset).
  link(r.links, 'ror', raw.identifiant_ror);
  link(r.links, 'idref', raw.identifiant_idref);
  link(r.links, 'wikidata', raw.identifiant_wikidata);
  link(r.links, 'hal_struct', raw.identifiant_hal);
  if (str(raw.annee_de_fermeture)) r.closed = true;
  return r;
};

/** Identifiers of the supervising institutions (UAI, SIRET): not the structure's own, but a matching clue. */
export const rnsrTutelleIds = (raw: any): { uai: string[]; siret: string[] } => ({
  uai: uniq(arr(raw?.uai_des_tutelles).map((v) => normalizeStructureId('uai', v)).filter((v): v is string => !!v)),
  siret: uniq(arr(raw?.siret_des_tutelles).map((v) => normalizeStructureId('siret', v)).filter((v): v is string => !!v)),
});

/** ODS `where` clause escaping (double quotes inside a quoted literal). */
export const odsLiteral = (s: string): string => `"${String(s).replace(/["\\]/g, ' ').trim()}"`;

// ── ROR v2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const ROR_API = 'https://api.ror.org/v2/organizations';

export const rorRecord = (raw: any): RegistryRecord | null => {
  const id = normalizeStructureId('ror', raw?.id);
  if (!id) return null;
  const names: any[] = Array.isArray(raw.names) ? raw.names : [];
  const ofType = (t: string) => names.filter((n) => (n?.types || []).includes(t)).map((n) => str(n.value)).filter(Boolean);
  const display = ofType('ror_display')[0] || ofType('label')[0] || id;
  const r = base('ror', id, display, `https://ror.org/${id}`);
  r.acronym = ofType('acronym')[0] || null;
  r.altNames = uniq([...ofType('label'), ...ofType('alias'), ...ofType('acronym')].filter((n) => n !== display));
  const loc = raw.locations?.[0]?.geonames_details || {};
  r.city = str(loc.name) || null;
  r.countryCode = str(loc.country_code) || null;
  r.kind = arr(raw.types)[0] || null;
  r.closed = !!raw.status && raw.status !== 'active';
  for (const ext of raw.external_ids || []) {
    const values = [ext?.preferred, ...(ext?.all || [])].filter(Boolean);
    if (ext?.type === 'wikidata') link(r.links, 'wikidata', values);
    if (ext?.type === 'grid') link(r.links, 'grid', values);
    if (ext?.type === 'isni') link(r.links, 'isni', values);
  }
  for (const rel of raw.relationships || []) {
    if (rel?.type !== 'parent') continue;
    link(r.parentIds, 'ror', rel.id);
    if (str(rel.label)) r.tutelles.push(str(rel.label));
  }
  r.tutelles = uniq(r.tutelles);
  return r;
};

// ── AureHAL structures (api.archives-ouvertes.fr/ref/structure) and HAL collections ──────────────────────────────────
export const HAL_STRUCTURE_API = 'https://api.archives-ouvertes.fr/ref/structure/';
export const HAL_SEARCH_API = 'https://api.archives-ouvertes.fr/search/';
export const HAL_STRUCTURE_FIELDS = 'docid,label_s,name_s,acronym_s,rnsr_s,ror_s,idref_s,isni_s,parentDocid_i,parentName_s,parentAcronym_s,valid_s,type_s,address_s,country_s,url_s,startDate_s,endDate_s';

export const halStructureRecord = (raw: any): RegistryRecord | null => {
  const id = normalizeStructureId('hal_struct', raw?.docid);
  if (!id) return null;
  const label = str(raw.name_s) || str(raw.label_s).replace(/\s*\[[^\]]*\]\s*$/, '') || id;
  const r = base('hal_struct', id, label, `https://aurehal.archives-ouvertes.fr/structure/read/id/${id}`);
  r.acronym = str(raw.acronym_s) || null;
  r.kind = str(raw.type_s) || null;
  r.closed = !!raw.valid_s && String(raw.valid_s).toUpperCase() !== 'VALID';
  r.countryCode = str(raw.country_s).toUpperCase() || null;
  r.address = str(raw.address_s) || null;
  r.tutelles = uniq([...arr(raw.parentName_s), ...arr(raw.parentAcronym_s)]);
  link(r.parentIds, 'hal_struct', raw.parentDocid_i);
  link(r.links, 'rnsr', raw.rnsr_s);
  link(r.links, 'ror', raw.ror_s);
  link(r.links, 'idref', raw.idref_s);
  link(r.links, 'isni', raw.isni_s);
  const unit = str(raw.label_s).match(/\b((?:UMR|UMR-S|UMR_S|UR|EA|FR|FRE|UMS|UMI|UPR|USR|UAR|ERL|U)\s?-?\s?\d{2,5}[A-Z]?)\b/i);
  if (unit) r.unitLabel = unit[1].toUpperCase().replace(/\s+/g, ' ');
  return r;
};

/** Solr field list of the `/ref/structure` call reading one record or searching. */
export const halStructureQuery = (q: string, rows = 10): string =>
  `${HAL_STRUCTURE_API}?q=${encodeURIComponent(q)}&fl=${HAL_STRUCTURE_FIELDS}&wt=json&rows=${rows}`;

/** `collCode_s` facet of the documents of a structure: `[code, count, code, count…]` → codes with their counts. */
export const halCollectionFacet = (raw: any): { code: string; count: number }[] => {
  const flat: any[] = raw?.facet_counts?.facet_fields?.collCode_s || [];
  const out: { code: string; count: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const code = normalizeStructureId('hal_collection', flat[i]);
    if (code) out.push({ code, count: Number(flat[i + 1]) || 0 });
  }
  return out;
};
export const halDocCount = (raw: any): number => Number(raw?.response?.numFound) || 0;

/** Solr query escaping of a value put between double quotes. */
export const solrPhrase = (s: string): string => `"${String(s).replace(/["\\]/g, ' ').trim()}"`;

// ── OpenAlex institutions ────────────────────────────────────────────────────────────────────────────────────────────
export const OPENALEX_API = 'https://api.openalex.org/institutions';
export const OPENALEX_FIELDS = 'id,display_name,display_name_alternatives,display_name_acronyms,ror,ids,country_code,type,works_count,geo,associated_institutions';

export const openalexRecord = (raw: any): RegistryRecord | null => {
  const id = normalizeStructureId('openalex', raw?.id);
  if (!id) return null;
  const r = base('openalex', id, str(raw.display_name) || id, `https://openalex.org/${id}`);
  r.acronym = arr(raw.display_name_acronyms)[0] || null;
  r.altNames = uniq([...arr(raw.display_name_alternatives), ...arr(raw.display_name_acronyms)]);
  r.kind = str(raw.type) || null;
  r.worksCount = raw.works_count === null || raw.works_count === undefined ? null : Number(raw.works_count) || 0;
  r.city = str(raw.geo?.city) || null;
  r.countryCode = str(raw.country_code).toUpperCase() || null;
  link(r.links, 'ror', raw.ror || raw.ids?.ror);
  link(r.links, 'grid', raw.ids?.grid);
  link(r.links, 'wikidata', raw.ids?.wikidata);
  for (const a of raw.associated_institutions || []) {
    if (a?.relationship !== 'parent') continue;
    link(r.parentIds, 'openalex', a.id);
    link(r.parentIds, 'ror', a.ror);
    if (str(a.display_name)) r.tutelles.push(str(a.display_name));
  }
  r.tutelles = uniq(r.tutelles);
  return r;
};

// ── IdRef corporate bodies (Solr) ────────────────────────────────────────────────────────────────────────────────────
export const IDREF_SOLR = 'https://www.idref.fr/Sru/Solr';

export const idrefRecord = (doc: any): RegistryRecord | null => {
  const id = normalizeStructureId('idref', doc?.ppn_z);
  if (!id) return null;
  const full = str(doc.affcourt_z) || id;
  // `Laboratoire des Sciences du Numérique de Nantes (2017-....)`, `Université de Nantes. Laboratoire X (Nantes)`
  const label = full.replace(/\s*\((?:\d{4}|\.{4})[^)]*\)\s*$/, '').trim();
  const r = base('idref', id, label || full, `https://www.idref.fr/${id}`);
  const m = full.match(/\(([^()\d]+?)\)\s*$/);
  if (m) r.city = cityOf(m[1]);
  const dates = full.match(/\((\d{4})-(\d{4}|\.{4})\)/);
  if (dates && dates[2] !== '....') r.closed = true;
  r.kind = 'corporate';
  return r;
};

/** Solr query of a corporate body by name (`recordtype_z:b` = corporate bodies). */
export const idrefSearchQuery = (q: string, rows = 10): string =>
  `${IDREF_SOLR}?q=${encodeURIComponent(`recordtype_z:b AND all:(${q.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim()})`)}&wt=json&fl=ppn_z,affcourt_z,recordtype_z&rows=${rows}`;
export const idrefPpnQuery = (ppn: string): string => `${IDREF_SOLR}?q=${encodeURIComponent(`ppn_z:${ppn}`)}&wt=json&fl=ppn_z,affcourt_z,recordtype_z&rows=1`;

// ── Wikidata ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
/** Properties that carry the identifiers Druid aligns. */
export const WIKIDATA_PROPS: Record<string, StructureIdType> = { P6782: 'ror', P2427: 'grid', P213: 'isni', P269: 'idref', P10283: 'openalex' };

export const wikidataRecord = (entity: any): RegistryRecord | null => {
  const id = normalizeStructureId('wikidata', entity?.id);
  if (!id) return null;
  const label = str(entity.labels?.fr?.value) || str(entity.labels?.en?.value) || id;
  const r = base('wikidata', id, label, `https://www.wikidata.org/wiki/${id}`);
  const aliases = [...(entity.aliases?.fr || []), ...(entity.aliases?.en || [])].map((a: any) => str(a?.value)).filter(Boolean);
  r.altNames = uniq([str(entity.labels?.en?.value), ...aliases].filter((n) => n && n !== label));
  const claims = entity.claims || {};
  const values = (prop: string): string[] => (claims[prop] || []).map((c: any) => c?.mainsnak?.datavalue?.value).filter((v: any) => v !== undefined && v !== null)
    .map((v: any) => (typeof v === 'object' ? str(v.id) : str(v)));
  for (const [prop, type] of Object.entries(WIKIDATA_PROPS)) link(r.links, type, values(prop));
  link(r.parentIds, 'wikidata', values('P749'));
  const dissolved = values('P576');
  if (dissolved.length) r.closed = true;
  return r;
};
