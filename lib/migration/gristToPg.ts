// Grist → PostgreSQL import, transformation part (druid-internal docs/plan-migration-postgresql.md, lot 5; mapping of
// docs/migration-postgresql-mapping.md). Pure: Grist records in, rows of the schema v1 out, plus the migration report.
// No network, no database: the loader (loadPg.ts) writes the rows, the script (scripts/migrate_grist_to_pg.ts) reads
// Grist. Nothing is dropped silently: every Annuaire column has a destination, a value that cannot be normalized is
// kept in `extra` under its Grist column id, and each such case is a report entry. The report names Grist row ids and
// columns, never a value (no personal data in it).
import { createHash } from 'node:crypto';
import type { GristRecord } from '../directory/gristMapping';
import { fromGristDate, mapStructureRecords } from '../directory/gristMapping';
import { normalizeFuzzyDate } from '../dates';
import { normalizeCivility } from '../civility';
import { normStatus, parseValidationScope } from '../validation';
import { normalizeAcronym } from '../normalize';

// ── Rows produced (column names of the schema; `$…` keys = references resolved by the loader) ────────────────────
export interface EstablishmentRow {
  legacy_grist_id: number; name: string; label: string | null; uai: string | null; ror: string | null; idref: string | null;
  extra: Record<string, unknown>;
}
export interface CorpsRow { code: string; category: string | null; label: string | null; extra: Record<string, unknown> }
export interface StructureRow {
  legacy_grist_id: number; local_id: string; acronym: string | null; name: string | null; type: string | null;
  level: string | null; nature: string | null; ror: string | null; rnsr: string | null; idref: string | null; url: string | null;
  extra: Record<string, unknown>;
  $parent: number | null; // legacy id of the parent structure
}
export interface PersonRow {
  id: string; legacy_grist_id: number; uid: string | null; last_name: string; first_name: string | null;
  civility: string | null; email: string | null; nationality: string | null; birth_date: string | null;
  corps_grade: string | null; employment_type: string | null; employment_type_label: string | null; hdr: string | null;
  hdr_year: number | null; doctoral_school: string | null; employment_start: string | null; employment_end: string | null;
  ldap_state: string | null; hr_id: string | null; fte_ratio: number | null; fte_research: number | null;
  photo_url: string | null; directory_url: string | null; presence_validated: boolean; presence_status: string | null;
  presence_validated_on: string | null; presence_validation_source: string | null; presence_validation_scope: string[];
  presence_validated_by: string | null; note: string | null; sources: string[]; extra: Record<string, unknown>;
  $employer: number | null; // legacy id of the establishment
}
export interface MembershipRow {
  legacy_grist_id: number; person_id: string; lab_label: string | null; type: string | null; role: string | null;
  start_date: string | null; end_date: string | null; team_labels: string[];
  $structure: number | null; $teams: number[]; // legacy ids of structures
}
export interface IdentifierRow { person_id: string; scheme: string; value: string; is_primary: boolean; source: string }
export interface IdentifierCheckRow { person_id: string; scheme: string; result: 'absent' }
export interface LinkRow { person_id: string; kind: string; url: string }
export interface SyncStateRow { person_id: string; source: string; last_run: string | null; changed_fields: string[] }

export interface DirectoryRows {
  establishment: EstablishmentRow[];
  ref_corps_grade: CorpsRow[];
  structure: StructureRow[];
  person: PersonRow[];
  membership: MembershipRow[];
  person_identifier: IdentifierRow[];
  person_identifier_check: IdentifierCheckRow[];
  person_link: LinkRow[];
  sync_state: SyncStateRow[];
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type IssueCode = keyof typeof ISSUE_EXPLANATIONS;
export interface Issue { code: IssueCode; table: string; rows: number[]; columns?: string[]; detail?: string }

/** Every report entry and what the import did about it: a code absent from here would be an unexplained case. */
export const ISSUE_EXPLANATIONS = {
  multi_row_person: 'Personne sur plusieurs lignes de l’Annuaire : une appartenance par ligne, champs personnels pris sur la ligne retenue (PRINCIPAL, sinon validée la plus récente, sinon mise à jour LDAP la plus récente, sinon la plus ancienne).',
  multi_row_divergence: 'Champs personnels différents entre les lignes d’une même personne : valeur de la ligne retenue gardée, à vérifier (page Doublons).',
  notes_merged: 'Commentaires de plusieurs lignes d’une même personne réunis dans la note, chaque bloc précédé de sa ligne d’origine.',
  identifier_from_other_row: 'Identifiant présent seulement sur une autre ligne que la ligne retenue : importé comme identifiant secondaire.',
  identifier_shared: 'Même valeur d’identifiant portée par plusieurs personnes : importée pour chacune (vue identifier_conflict, règle annuaire_ids_partages).',
  scopus_absent: 'ID_SCOPUS « absent » : vérification d’absence (person_identifier_check), pas d’identifiant.',
  sentinel_zero: 'Valeur 0 (ID_SCOPUS, numéro d’agent, Employeur, date de naissance) : « non renseigné », rien n’est importé.',
  value_kept_in_extra: 'Valeur non normalisable (texte dans une colonne numérique, valeur hors liste…) : gardée telle quelle dans extra sous le nom de sa colonne Grist.',
  fuzzy_date_invalid: 'Date imprécise illisible : gardée dans extra, la colonne normalisée reste vide.',
  date_invalid: 'Date (naissance, validation, synchronisation) illisible : gardée dans extra, la colonne normalisée reste vide.',
  civility_normalized: 'Civilité « M. » / « Mme » / « Madame »… ramenée à M / F.',
  presence_status_legacy: 'Statut validé INTERNE / EXTERNE (avant 2026-10-07) ramené à PRESENT, comme lib/validation.ts.',
  employer_resolved_by_label: 'Employeur saisi en texte au lieu d’une référence : rapproché par libellé d’Etablissements.',
  employer_unresolved: 'Employeur inconnu (référence ou libellé sans établissement) : employeur vide, valeur gardée dans extra.',
  employer_duplicate_row: 'Référence vers une ligne Etablissements en double : rattachée à la première ligne du même nom.',
  lab_unresolved: 'LABO sans structure de même acronyme : appartenance sans structure, libellé gardé (lab_label).',
  lab_parking: 'LABO de rangement (zzz ou vide) : appartenance sans structure.',
  team_unresolved: 'Équipe sans structure de même acronyme (ou plusieurs, aucune sous le labo de l’appartenance) : libellé gardé (team_labels), pas de lien membership_team.',
  link_split: 'Cellule de profil web contenant plusieurs URL : une ligne person_link par URL.',
  column_unmapped: 'Colonne de l’Annuaire inconnue de l’import : gardée dans extra (à classer).',
  establishment_duplicate_name: 'Etablissements : nom en double, première ligne gardée, les références des autres lignes y sont rattachées.',
  establishment_duplicate_uai: 'Etablissements : UAI en double, gardée sur la première ligne seulement (copie dans extra).',
  establishment_without_name: 'Etablissements : ligne sans nom, non importée.',
  structure_without_local_id: 'Structures : ligne sans local_id, non importée.',
  structure_duplicate_local_id: 'Structures : local_id en double, première ligne gardée.',
  structure_parent_unresolved: 'Structures : parent (dérivé des inclusions, sinon parent_structure) introuvable : pas de parent.',
  structure_idref_blank: 'Structures : idref fait seulement d’espaces : vide.',
  structure_acronym_ambiguous: 'Structures : acronyme porté par plusieurs structures : un LABO est rapproché de la première, une équipe de celle dont le parent est le labo de l’appartenance (sinon non rapprochée).',
  corps_duplicate_code: 'Corps_Categorie : code en double, première ligne gardée.',
  corps_without_code: 'Corps_Categorie : ligne sans code, non importée.',
  table_missing: 'Table absente du document : rien à importer.',
  // Work tables (lot 5 b, gristToPgWork.ts).
  work_person_unresolved: 'Ligne de travail rattachée à une fiche introuvable (Ref vide, ligne supprimée, uid inconnu) : importée sans personne quand la colonne le permet, sinon non importée.',
  work_person_by_uid: 'Revue d’alignement sans id de ligne Annuaire : personne retrouvée par son uid (ou g<id de ligne>).',
  work_value_kept_in_extra: 'Valeur de table de travail non normalisable (statut ou priorité hors liste, date, JSON illisible) : gardée dans extra sous le nom de sa colonne Grist.',
  work_duplicate: 'Ligne en double sur la clé de la table cible (même personne + source + candidat, même clé de tâche, même liste) : première ligne gardée.',
  work_orphan: 'Ligne qui renvoie à une ligne parente absente (événement sans tâche, partage ou génération sans rapport) : non importée.',
  work_column_unmapped: 'Colonne inconnue de l’import dans une table de travail : gardée dans extra / payload.',
} as const;

export interface MigrationReport {
  generatedAt: string;
  source: Record<string, number>;
  counts: Record<string, number>;
  summary: Partial<Record<IssueCode, number>>;
  issues: Issue[];
}

// ── Annuaire columns ─────────────────────────────────────────────────────────────────────────────────────────────
const PERSON_COLUMNS = [
  'uid_dyna', 'Nom', 'Prenom', 'Civilite', 'Email', 'Nationalite', 'DATE_DE_NAISSANCE_JJ_MM_AAAA', 'Corps_grade', 'TYPE_EMPLOI',
  'LIB_TYPE_EMPLOI', 'HDR', 'ANNEE_HDR', 'ED_de_rattachement', 'Employeur', 'employment_start_date', 'employment_end_date',
  'statut_dyna', 'N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_', 'etp_quotite', 'etp_recherche', 'photo_url', 'annuaire_url',
  'validated', 'validated_status', 'validation_date', 'validation_source', 'validation_scope', 'validated_by',
] as const;
/** Merged over the rows of a person (not compared). */
const MERGED_COLUMNS = ['Commentaires', 'Data_source'] as const;
const IDENTIFIER_COLUMNS: Record<string, string> = {
  IdRef: 'idref', IdRef_nom_valide: 'idref_name_validated', IdHAL: 'idhal', IdHAL_i: 'idhal_i', ORCID: 'orcid',
  ID_SCOPUS: 'scopus', OpenAlex_ids: 'openalex', openalex_author_id: 'openalex', Bluesky: 'bluesky', Mastodon: 'mastodon',
};
const LINK_COLUMNS = ['CV_institutionnel', 'CV_site_labo', 'CV_pdf_docx_', 'CV_HAL', 'Academia', 'Researchgate', 'Profil_GS',
  'LinkedIn', 'Site_web', 'YouTube', 'Blog', 'Podcast_flux'] as const;
const SYNC_SOURCES = ['LDAP', 'IdRef', 'HAL', 'ORCID', 'OpenAlex', 'Scopus'] as const;
const MEMBERSHIP_COLUMNS = ['LABO', 'team', 'affiliation_start_date', 'affiliation_end_date', 'membership_type', 'rattachement'] as const;
/** Columns without a normalized home (no use in the code, or not normalized yet): person.extra, from the kept row. */
const EXTRA_COLUMNS = [
  'Personnel_heberge_dans_les_locaux_de_Nantes_Universite', 'Panels_disciplinaires_Branches_d_Activites_Profession_BAP_',
  'Localisation_Site_global_', 'Pole_de_rattachement_Nantes_Univ_uniquement_', 'Composante_de_rattachement_Nantes_Univ_uniquement_',
  'campus', 'groupes', 'ABES_export_hash', 'ABES_export_date', 'doublon_decision',
] as const;
/** Formula columns, recomputed from the rest: not imported. */
const DERIVED_COLUMNS = ['institution_identifier', 'Alignement_annuaire'] as const;

const KNOWN_COLUMNS = new Set<string>([
  ...PERSON_COLUMNS, ...MERGED_COLUMNS, ...Object.keys(IDENTIFIER_COLUMNS), ...LINK_COLUMNS, ...MEMBERSHIP_COLUMNS,
  ...EXTRA_COLUMNS, ...DERIVED_COLUMNS, ...SYNC_SOURCES.flatMap((s) => [`${s}_derniere_maj`, `${s}_champs_modifies`]),
]);
const isTechnicalColumn = (c: string) => c === 'manualSort' || c.startsWith('gristHelper_');

const ROLES = ['PRINCIPAL', 'SECONDAIRE', 'HISTORIQUE'];

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const text = (v: unknown): string | null => (isEmpty(v) ? null : String(v).trim());
const splitList = (v: unknown, sep: RegExp): string[] =>
  isEmpty(v) ? [] : String(v).split(sep).map((s) => s.trim()).filter(Boolean);
const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** Stable person id (UUID v5 layout over SHA-1): the same key gives the same id at every import rehearsal. */
export const personUuid = (key: string): string => {
  const h = createHash('sha1').update(`druid:person:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
};

/** Key of a person: lower-case uid_dyna, otherwise the Grist row (records without uid). */
export const personKey = (r: GristRecord): string => {
  const uid = String(r.fields?.uid_dyna ?? '').trim().toLowerCase();
  return uid ? `u:${uid}` : `r:${r.id}`;
};

/** Grist epoch seconds (Date column) or text → YYYY-MM-DD, null when unreadable. */
const toIsoDate = (v: unknown): string | null => {
  if (isEmpty(v)) return null;
  const iso = fromGristDate(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && normalizeFuzzyDate(iso) === iso ? iso : null;
};

const sortKey = (r: GristRecord) => {
  const f = r.fields || {};
  const validatedOn = f.validated === true && typeof f.validation_date === 'number' ? f.validation_date : -1;
  return [
    String(f.rattachement || '').toUpperCase() === 'PRINCIPAL' ? 1 : 0,
    validatedOn,
    String(f.LDAP_derniere_maj || ''),
  ] as const;
};
/** Row whose personal fields the person takes (lot 0 mapping § 1). */
export const keptRow = (rows: GristRecord[]): GristRecord => [...rows].sort((a, b) => {
  const [ka, kb] = [sortKey(a), sortKey(b)];
  return (kb[0] - ka[0]) || (kb[1] - ka[1]) || kb[2].localeCompare(ka[2]) || (a.id - b.id);
})[0];

// ── Transformation ───────────────────────────────────────────────────────────────────────────────────────────────
export interface GristDirectoryInput {
  Annuaire: GristRecord[] | null;
  Structures: GristRecord[] | null;
  Etablissements: GristRecord[] | null;
  Corps_Categorie: GristRecord[] | null;
}

export const transformDirectory = (input: GristDirectoryInput, now = () => new Date().toISOString()): { rows: DirectoryRows; report: MigrationReport } => {
  const issues: Issue[] = [];
  const issue = (code: IssueCode, table: string, rows: number[], columns?: string[], detail?: string) => {
    issues.push({ code, table, rows, ...(columns ? { columns } : {}), ...(detail ? { detail } : {}) });
  };
  for (const [table, records] of Object.entries(input)) if (!records) issue('table_missing', table, []);

  // Establishments: first row per name kept; references to a duplicate row follow it.
  const establishment: EstablishmentRow[] = [];
  const establishmentOf = new Map<number, number>(); // Grist row → kept Grist row
  const establishmentByName = new Map<string, number>();
  const uaiSeen = new Set<string>();
  for (const r of [...(input.Etablissements || [])].sort((a, b) => a.id - b.id)) {
    const f = r.fields || {};
    const name = text(f.Employeur);
    if (!name) { issue('establishment_without_name', 'Etablissements', [r.id]); continue; }
    const kept = establishmentByName.get(name.toLowerCase());
    if (kept !== undefined) { establishmentOf.set(r.id, kept); issue('establishment_duplicate_name', 'Etablissements', [r.id, kept]); continue; }
    establishmentByName.set(name.toLowerCase(), r.id);
    establishmentOf.set(r.id, r.id);
    const extra: Record<string, unknown> = {};
    if (!isEmpty(f.commentaire)) extra.commentaire = f.commentaire;
    let uai = text(f.UAI);
    if (uai && uaiSeen.has(uai.toUpperCase())) { extra.UAI = uai; uai = null; issue('establishment_duplicate_uai', 'Etablissements', [r.id]); }
    if (uai) uaiSeen.add(uai.toUpperCase());
    establishment.push({ legacy_grist_id: r.id, name, label: text(f.Libelle), uai, ror: text(f.ROR), idref: text(f.idref), extra });
  }

  // Corps / grade reference (columns A-D unnamed: code = A, label = B, category = C, the whole row in extra).
  const ref_corps_grade: CorpsRow[] = [];
  const codes = new Set<string>();
  for (const r of [...(input.Corps_Categorie || [])].sort((a, b) => a.id - b.id)) {
    const f = r.fields || {};
    const code = text(f.A);
    if (!code) { issue('corps_without_code', 'Corps_Categorie', [r.id]); continue; }
    if (codes.has(code)) { issue('corps_duplicate_code', 'Corps_Categorie', [r.id]); continue; }
    codes.add(code);
    ref_corps_grade.push({ code, label: text(f.B), category: text(f.C), extra: { ...f } });
  }

  // Structures: labels, level and parent as the application derives them (mapStructureRecords); raw row in extra.
  const structureRecords = [...(input.Structures || [])].sort((a, b) => a.id - b.id);
  const mapped = new Map(mapStructureRecords(structureRecords).map((s) => [s.id, s]));
  const structure: StructureRow[] = [];
  const localIds = new Set<string>();
  const byAcronym = new Map<string, number>();
  const candidates = new Map<string, number[]>(); // every structure of an acronym (teams of the same name in two labs)
  for (const r of structureRecords) {
    const f = r.fields || {};
    const localId = text(f.local_id);
    if (!localId) { issue('structure_without_local_id', 'Structures', [r.id]); continue; }
    if (localIds.has(localId)) { issue('structure_duplicate_local_id', 'Structures', [r.id]); continue; }
    localIds.add(localId);
    const s = mapped.get(`S-${r.id}`);
    const acronym = text(s?.acronym);
    if (acronym) {
      const k = normalizeAcronym(acronym);
      if (!candidates.has(k)) candidates.set(k, []);
      candidates.get(k)!.push(r.id);
      if (byAcronym.has(k)) issue('structure_acronym_ambiguous', 'Structures', [r.id, byAcronym.get(k)!]);
      else byAcronym.set(k, r.id);
    }
    if (typeof f.idref === 'string' && f.idref !== '' && f.idref.trim() === '') issue('structure_idref_blank', 'Structures', [r.id]);
    const { local_id: _localId, ...extra } = f;
    structure.push({
      legacy_grist_id: r.id, local_id: localId, acronym, name: text(s?.officialName), type: text(f.type),
      level: text(s?.level), nature: text(s?.nature), ror: text(f.ror), rnsr: text(f.nns), idref: text(f.idref),
      url: text(f.url), extra, $parent: null,
    });
  }
  for (const row of structure) {
    const parent = text(mapped.get(`S-${row.legacy_grist_id}`)?.parentStructure);
    if (!parent) continue;
    const id = byAcronym.get(normalizeAcronym(parent));
    if (id !== undefined && id !== row.legacy_grist_id) row.$parent = id;
    else issue('structure_parent_unresolved', 'Structures', [row.legacy_grist_id]);
  }

  const parentOf = new Map(structure.map((x) => [x.legacy_grist_id, x.$parent]));

  // People and memberships.
  const person: PersonRow[] = [];
  const membership: MembershipRow[] = [];
  const person_identifier: IdentifierRow[] = [];
  const person_identifier_check: IdentifierCheckRow[] = [];
  const person_link: LinkRow[] = [];
  const sync_state: SyncStateRow[] = [];
  const groups = new Map<string, GristRecord[]>();
  for (const r of [...(input.Annuaire || [])].sort((a, b) => a.id - b.id)) {
    const k = personKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const unmapped = new Map<string, number[]>();
  const counters = { civility: [] as number[], legacyStatus: [] as number[], scopusZero: [] as number[], hrZero: [] as number[], employerZero: [] as number[], birthZero: [] as number[] };

  for (const [key, rows] of groups) {
    const kept = keptRow(rows);
    const f = kept.fields || {};
    const id = personUuid(key);
    const extra: Record<string, unknown> = {};
    const keepRaw = (col: string, value: unknown, code: IssueCode = 'value_kept_in_extra') => {
      extra[col] = value;
      issue(code, 'Annuaire', [kept.id], [col]);
    };
    const rowIds = rows.map((r) => r.id);
    if (rows.length > 1) {
      issue('multi_row_person', 'Annuaire', rowIds, undefined, `kept G-${kept.id}`);
      // uid_dyna is the grouping key (compared lower-case): not a divergence.
      const divergent = [...PERSON_COLUMNS, ...EXTRA_COLUMNS].filter((c) => c !== 'uid_dyna' &&
        new Set(rows.map((r) => r.fields?.[c]).filter((v) => !isEmpty(v) && v !== 0 && v !== false).map((v) => JSON.stringify(v))).size > 1);
      if (divergent.length) issue('multi_row_divergence', 'Annuaire', rowIds, divergent);
    }

    // Columns the import does not know: kept, never dropped.
    for (const r of rows) for (const c of Object.keys(r.fields || {})) {
      if (KNOWN_COLUMNS.has(c) || isTechnicalColumn(c) || isEmpty(r.fields[c])) continue;
      if (!unmapped.has(c)) unmapped.set(c, []);
      unmapped.get(c)!.push(r.id);
      if (r.id === kept.id) extra[c] = r.fields[c];
    }
    for (const c of EXTRA_COLUMNS) if (!isEmpty(f[c])) extra[c] = f[c];

    // Civility.
    let civility: string | null = null;
    if (!isEmpty(f.Civilite)) {
      // normalizeCivility falls back on the first letter: only F / M are a civility here.
      const c = normalizeCivility(String(f.Civilite));
      civility = c === 'F' || c === 'M' ? c : null;
      if (!civility) keepRaw('Civilite', f.Civilite);
      else if (civility !== String(f.Civilite).trim()) counters.civility.push(kept.id);
    }
    // Dates.
    // 0 = an emptied Date cell (the application reads it as empty).
    if (f.DATE_DE_NAISSANCE_JJ_MM_AAAA === 0) counters.birthZero.push(kept.id);
    const birth = f.DATE_DE_NAISSANCE_JJ_MM_AAAA === 0 ? null : toIsoDate(f.DATE_DE_NAISSANCE_JJ_MM_AAAA);
    if (!birth && !isEmpty(f.DATE_DE_NAISSANCE_JJ_MM_AAAA) && f.DATE_DE_NAISSANCE_JJ_MM_AAAA !== 0) keepRaw('DATE_DE_NAISSANCE_JJ_MM_AAAA', f.DATE_DE_NAISSANCE_JJ_MM_AAAA, 'date_invalid');
    const fuzzy = (col: string): string | null => {
      if (isEmpty(f[col])) return null;
      const v = normalizeFuzzyDate(f[col]);
      if (!v) keepRaw(col, f[col], 'fuzzy_date_invalid');
      return v ?? null;
    };
    const validatedOn = toIsoDate(f.validation_date);
    if (!validatedOn && !isEmpty(f.validation_date)) keepRaw('validation_date', f.validation_date, 'date_invalid');
    // HDR year: a year, otherwise the text stays in extra (« N/A », « oui »…).
    let hdrYear: number | null = null;
    if (!isEmpty(f.ANNEE_HDR)) {
      if (/^\s*\d{4}\s*$/.test(String(f.ANNEE_HDR))) hdrYear = Number(String(f.ANNEE_HDR).trim());
      else keepRaw('ANNEE_HDR', f.ANNEE_HDR);
    }
    // Staff number: 0 = not filled in; text (#N/A, ?, VACATAIRE…) kept in extra.
    let hrId: string | null = null;
    const hr = f.N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_;
    if (hr === 0) counters.hrZero.push(kept.id);
    else if (typeof hr === 'number') hrId = String(hr);
    else if (!isEmpty(hr)) keepRaw('N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_', hr);
    // Employer: Grist Ref (0 = none), sometimes typed text.
    let employer: number | null = null;
    const emp = f.Employeur;
    if (emp === 0) counters.employerZero.push(kept.id);
    else if (typeof emp === 'number') {
      const target = establishmentOf.get(emp);
      if (target === undefined) keepRaw('Employeur', emp, 'employer_unresolved');
      else { employer = target; if (target !== emp) issue('employer_duplicate_row', 'Annuaire', [kept.id]); }
    } else if (!isEmpty(emp)) {
      const target = establishmentByName.get(String(emp).trim().toLowerCase());
      if (target !== undefined) { employer = target; issue('employer_resolved_by_label', 'Annuaire', [kept.id]); }
      else keepRaw('Employeur', emp, 'employer_unresolved');
    }
    // Validated presence.
    let presence: string | null = null;
    if (!isEmpty(f.validated_status)) {
      presence = normStatus(f.validated_status) ?? null;
      if (!presence) keepRaw('validated_status', f.validated_status);
      else if (presence !== String(f.validated_status).trim().toUpperCase()) counters.legacyStatus.push(kept.id);
    }
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    for (const col of ['etp_quotite', 'etp_recherche']) if (!isEmpty(f[col]) && num(f[col]) === null) keepRaw(col, f[col]);

    // Notes and sources, merged over the rows.
    const notes = rows.filter((r) => !isEmpty(r.fields?.Commentaires));
    const note = notes.length === 0 ? null
      : notes.length === 1 ? String(notes[0].fields.Commentaires)
        : notes.map((r) => `[G-${r.id}]\n${r.fields.Commentaires}`).join('\n\n');
    if (notes.length > 1) issue('notes_merged', 'Annuaire', notes.map((r) => r.id));
    const sources = unique(rows.flatMap((r) => splitList(r.fields?.Data_source, /[|,]/)));

    person.push({
      id, legacy_grist_id: kept.id, uid: key.startsWith('u:') ? key.slice(2) : null,
      last_name: String(f.Nom ?? '').trim(), first_name: text(f.Prenom), civility, email: text(f.Email),
      nationality: text(f.Nationalite), birth_date: birth, corps_grade: text(f.Corps_grade), employment_type: text(f.TYPE_EMPLOI),
      employment_type_label: text(f.LIB_TYPE_EMPLOI), hdr: text(f.HDR), hdr_year: hdrYear, doctoral_school: text(f.ED_de_rattachement),
      employment_start: fuzzy('employment_start_date'), employment_end: fuzzy('employment_end_date'),
      ldap_state: text(f.statut_dyna), hr_id: hrId, fte_ratio: num(f.etp_quotite), fte_research: num(f.etp_recherche),
      photo_url: text(f.photo_url), directory_url: text(f.annuaire_url),
      presence_validated: f.validated === true, presence_status: presence, presence_validated_on: validatedOn,
      presence_validation_source: text(f.validation_source),
      presence_validation_scope: isEmpty(f.validation_scope) ? [] : parseValidationScope(f.validation_scope),
      presence_validated_by: text(f.validated_by), note, sources, extra, $employer: employer,
    });

    // Identifiers: union over the rows; the kept row's values are primary (OpenAlex: its first id only).
    const seen = new Set<string>();
    const identifierRows: IdentifierRow[] = [];
    let scopusAbsent = false;
    for (const r of [kept, ...rows.filter((x) => x !== kept)]) {
      const fromKept = r === kept;
      for (const [col, scheme] of Object.entries(IDENTIFIER_COLUMNS)) {
        const raw = r.fields?.[col];
        if (isEmpty(raw)) continue;
        if (col === 'ID_SCOPUS') {
          if (raw === 0) { if (fromKept) counters.scopusZero.push(r.id); continue; }
          if (typeof raw === 'string' && raw.trim().toLowerCase() === 'absent') { scopusAbsent = true; continue; }
          if (typeof raw !== 'number' && !/^\d+$/.test(String(raw).trim())) { if (fromKept) keepRaw(col, raw); continue; }
        }
        const values = col === 'OpenAlex_ids' ? splitList(raw, /[|,;\s]+/)
          : [typeof raw === 'number' ? String(Math.round(raw)) : String(raw).trim()];
        values.forEach((value, i) => {
          const k = `${scheme}|${value}`;
          if (seen.has(k)) return;
          seen.add(k);
          const primary = fromKept && (col !== 'OpenAlex_ids' || i === 0) && col !== 'openalex_author_id';
          if (!fromKept) issue('identifier_from_other_row', 'Annuaire', [r.id, kept.id], [col]);
          identifierRows.push({ person_id: id, scheme, value, is_primary: primary, source: `grist:${col}` });
        });
      }
    }
    person_identifier.push(...identifierRows);
    if (scopusAbsent) {
      person_identifier_check.push({ person_id: id, scheme: 'scopus', result: 'absent' });
      issue('scopus_absent', 'Annuaire', [kept.id]);
    }

    // Web profiles: union over the rows, one row per URL.
    const links = new Set<string>();
    for (const r of rows) for (const col of LINK_COLUMNS) {
      const urls = splitList(r.fields?.[col], /\s*[;\n]\s*|,\s+(?=https?:\/\/)/);
      if (urls.length > 1) issue('link_split', 'Annuaire', [r.id], [col]);
      for (const url of urls) {
        const kind = col.toLowerCase().replace(/_+$/, '');
        if (links.has(`${kind}|${url}`)) continue;
        links.add(`${kind}|${url}`);
        person_link.push({ person_id: id, kind, url });
      }
    }

    // Sync traces of the kept row.
    for (const source of SYNC_SOURCES) {
      const rawDate = f[`${source}_derniere_maj`];
      const changed = splitList(f[`${source}_champs_modifies`], /\|/);
      if (isEmpty(rawDate) && changed.length === 0) continue;
      const lastRun = isEmpty(rawDate) ? null : toIsoDate(rawDate);
      if (!lastRun && !isEmpty(rawDate)) keepRaw(`${source}_derniere_maj`, rawDate, 'date_invalid');
      sync_state.push({ person_id: id, source: source.toLowerCase(), last_run: lastRun, changed_fields: changed });
    }

    // One membership per row.
    for (const r of rows) {
      const m = r.fields || {};
      const lab = text(m.LABO);
      let structureId: number | null = null;
      if (!lab || lab.toLowerCase() === 'zzz') issue('lab_parking', 'Annuaire', [r.id]);
      else {
        structureId = byAcronym.get(normalizeAcronym(lab)) ?? null;
        if (structureId === null) issue('lab_unresolved', 'Annuaire', [r.id], ['LABO']);
      }
      const teamLabels = splitList(m.team, /\|/);
      const teams: number[] = [];
      for (const t of teamLabels) {
        // Same acronym in several labs: the team under the lab of this membership.
        const all = candidates.get(normalizeAcronym(t)) || [];
        const underLab = all.filter((id) => parentOf.get(id) === structureId);
        const s = all.length === 1 ? all[0] : underLab.length === 1 ? underLab[0] : undefined;
        if (s !== undefined && s !== structureId) teams.push(s);
        else if (s === undefined) issue('team_unresolved', 'Annuaire', [r.id], ['team'], all.length > 1 ? 'ambiguous' : undefined);
      }
      const fuzzyOf = (col: string): string | null => {
        if (isEmpty(m[col])) return null;
        const v = normalizeFuzzyDate(m[col]);
        if (!v) { extra[`${col}@G-${r.id}`] = m[col]; issue('fuzzy_date_invalid', 'Annuaire', [r.id], [col]); }
        return v ?? null;
      };
      const role = text(m.rattachement)?.toUpperCase() ?? null;
      if (role && !ROLES.includes(role)) { extra[`rattachement@G-${r.id}`] = m.rattachement; issue('value_kept_in_extra', 'Annuaire', [r.id], ['rattachement']); }
      membership.push({
        legacy_grist_id: r.id, person_id: id, lab_label: lab, type: text(m.membership_type),
        role: role && ROLES.includes(role) ? role : null,
        start_date: fuzzyOf('affiliation_start_date'), end_date: fuzzyOf('affiliation_end_date'),
        team_labels: teamLabels, $structure: structureId, $teams: unique(teams),
      });
    }
  }
  for (const [col, rows] of unmapped) issue('column_unmapped', 'Annuaire', rows, [col]);
  if (counters.civility.length) issue('civility_normalized', 'Annuaire', counters.civility, ['Civilite']);
  if (counters.legacyStatus.length) issue('presence_status_legacy', 'Annuaire', counters.legacyStatus, ['validated_status']);
  if (counters.scopusZero.length) issue('sentinel_zero', 'Annuaire', counters.scopusZero, ['ID_SCOPUS']);
  if (counters.hrZero.length) issue('sentinel_zero', 'Annuaire', counters.hrZero, ['N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_']);
  if (counters.employerZero.length) issue('sentinel_zero', 'Annuaire', counters.employerZero, ['Employeur']);
  if (counters.birthZero.length) issue('sentinel_zero', 'Annuaire', counters.birthZero, ['DATE_DE_NAISSANCE_JJ_MM_AAAA']);

  // Identifier values carried by several people (imported for each: identifier_conflict).
  const holders = new Map<string, Set<string>>();
  for (const i of person_identifier) {
    const k = `${i.scheme}|${i.value}`;
    if (!holders.has(k)) holders.set(k, new Set());
    holders.get(k)!.add(i.person_id);
  }
  const legacyOf = new Map(person.map((p) => [p.id, p.legacy_grist_id]));
  for (const [k, ids] of holders) {
    if (ids.size < 2) continue;
    issue('identifier_shared', 'Annuaire', [...ids].map((pid) => legacyOf.get(pid)!).sort((a, b) => a - b), [k.split('|')[0]]);
  }

  const rows: DirectoryRows = { establishment, ref_corps_grade, structure, person, membership, person_identifier, person_identifier_check, person_link, sync_state };
  const summary: Partial<Record<IssueCode, number>> = {};
  for (const i of issues) summary[i.code] = (summary[i.code] || 0) + 1;
  return {
    rows,
    report: {
      generatedAt: now(),
      source: Object.fromEntries(Object.entries(input).map(([t, r]) => [t, r ? r.length : 0])),
      counts: Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length])),
      summary,
      issues,
    },
  };
};

/** Adds the cases and counts of another transformation (work tables, lot 5 b) to a report. */
export const mergeReport = (report: MigrationReport, more: { issues: Issue[]; source: Record<string, number>; counts: Record<string, number> }): MigrationReport => {
  const issues = [...report.issues, ...more.issues];
  const summary: Partial<Record<IssueCode, number>> = {};
  for (const i of issues) summary[i.code] = (summary[i.code] || 0) + 1;
  return { ...report, source: { ...report.source, ...more.source }, counts: { ...report.counts, ...more.counts }, summary, issues };
};

/** Markdown view of the report (counts, then each kind of case with its explanation and a few row ids). */
export const reportMarkdown = (report: MigrationReport, sample = 12): string => {
  const lines = [`# Import Grist → PostgreSQL — rapport du ${report.generatedAt}`, '', '## Source', '',
    '| Table Grist | Lignes |', '|---|---:|', ...Object.entries(report.source).map(([t, n]) => `| ${t} | ${n} |`), '',
    '## Lignes produites', '', '| Table | Lignes |', '|---|---:|', ...Object.entries(report.counts).map(([t, n]) => `| ${t} | ${n} |`), '',
    '## Cas rencontrés', ''];
  for (const code of Object.keys(ISSUE_EXPLANATIONS) as IssueCode[]) {
    const items = report.issues.filter((i) => i.code === code);
    if (!items.length) continue;
    const columns = unique(items.flatMap((i) => i.columns || []));
    lines.push(`### ${code} (${items.length})`, '', ISSUE_EXPLANATIONS[code], '');
    if (columns.length) lines.push(`Colonnes : ${columns.map((c) => `\`${c}\``).join(', ')}`, '');
    lines.push(`Exemples (lignes Grist) : ${items.slice(0, sample).map((i) => i.rows.map((r) => `G-${r}`).join('+') || '—').join(', ')}${items.length > sample ? ', …' : ''}`, '');
  }
  return lines.join('\n');
};
