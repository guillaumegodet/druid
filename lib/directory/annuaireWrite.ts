// Druid → Grist encoding of the directory writes (records of the Annuaire table).
//
// Pure module shared by the browser and the server-side commands of the domain API (lib/directory/commands.ts,
// druid-internal docs/plan-migration-postgresql.md, lot 2 a). The helpers below moved verbatim out of
// lib/gristService.ts; the field builders are its createResearcher / updateResearcher bodies, made synchronous:
// the column metadata and the institutions are read once by the caller and passed in.
import type { Affiliation, Researcher } from '../../types';
import { normalizeFuzzyDate, fuzzyDateLowerBound, fuzzyDateUpperBound, isFuzzyDatePast } from '../dates';
import { validationToGristFields } from '../validation';
import { fteGristFields } from '../fte';
import { HR_ID_COLUMN, hrIdCell } from '../hrId';
import { STATUT_DYNA_MAP } from '../ldapCodes';
import {
  AFFILIATION_END_COL, AFFILIATION_START_COL, Institution, MEMBERSHIP_TYPE_COL, RATTACHEMENT_COL, RattachementRole,
  fromGristDate, fromGristFuzzyDate,
} from './gristMapping';

/** Converts 'YYYY-MM-DD' to an epoch timestamp (seconds, midnight UTC) for Grist Date columns. */
export const toGristEpoch = (ymd: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000);
};

/** Metadata of an Annuaire column (for merging: never write a formula). */
export interface AnnuaireColumnMeta { id: string; label: string; type: string; isFormula: boolean }

/** Row plan of a record's memberships, the write-side counterpart of `groupQualifiedRows`. */
export interface AffiliationRowPlan {
  /** Membership written on the record's own row (the PRINCIPAL one). */
  primary: Affiliation | undefined;
  /** `rattachement` of the record's row: PRINCIPAL when other rows exist, '' when the record is back to
   * a single row after carrying several, undefined = column left untouched. */
  mainRole: RattachementRole | '' | undefined;
  /** Existing qualified rows rewritten with a non-primary membership. */
  patches: { rowId: number; affiliation: Affiliation; role: RattachementRole }[];
  /** Non-primary memberships without a row to reuse → new Annuaire rows. */
  creates: { affiliation: Affiliation; role: RattachementRole }[];
  /** Qualified rows whose membership was removed from the record. */
  deletes: number[];
}

/**
 * Maps the memberships edited in a record onto Annuaire rows: the primary one on the record's row,
 * each other one on its own row (same uid_dyna), qualified HISTORIQUE when its end date is past,
 * SECONDAIRE otherwise. Rows are reused before any creation (a primary switch swaps the contents of
 * two rows instead of deleting + recreating), leftover qualified rows are deleted.
 * `qualifiedRowIds`: the person's other rows carrying a `rattachement` (excluding the record's row).
 */
export function planAffiliationRows(
  mainRowId: number, affiliations: Affiliation[], qualifiedRowIds: number[], todayIso: string,
): AffiliationRowPlan {
  const primary = affiliations.find((a) => a.isPrimary) ?? affiliations[0];
  const others = affiliations.filter((a) => a !== primary);
  const roleOf = (a: Affiliation): RattachementRole =>
    isFuzzyDatePast(normalizeFuzzyDate(a.endDate) ?? '', todayIso) ? 'HISTORIQUE' : 'SECONDAIRE';
  const pool = qualifiedRowIds.filter((id) => id !== mainRowId);
  const patches: AffiliationRowPlan['patches'] = [];
  const pending: Affiliation[] = [];
  for (const a of others) {
    const i = a.gristRowId ? pool.indexOf(a.gristRowId) : -1;
    if (i >= 0) patches.push({ rowId: pool.splice(i, 1)[0], affiliation: a, role: roleOf(a) });
    else pending.push(a);
  }
  const creates: AffiliationRowPlan['creates'] = [];
  for (const a of pending) {
    const rowId = pool.shift();
    if (rowId !== undefined) patches.push({ rowId, affiliation: a, role: roleOf(a) });
    else creates.push({ affiliation: a, role: roleOf(a) });
  }
  const mainRole = others.length > 0 ? 'PRINCIPAL' : qualifiedRowIds.length > 0 ? '' : undefined;
  return { primary, mainRole, patches, creates, deletes: pool };
}

/** The four employment / membership date columns holding reduced-precision dates (lib/dates.ts):
 * `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Text columns once scripts/migrate_fuzzy_dates.cjs has run on the
 * document; still Date (epoch) columns before that — both are read, the writer adapts (see
 * `fuzzyDateCellEncoder`). */
export const FUZZY_DATE_COLS = ['employment_start_date', 'employment_end_date', AFFILIATION_START_COL, AFFILIATION_END_COL] as const;

/** Encodes a Druid date (ISO YYYY-MM-DD, or legacy DD-MM-YYYY text) for a Grist Date column:
 * epoch seconds, the only valid representation whatever the column's `dateFormat`. Until
 * 2026-09-17 we wrote DD-MM-YYYY text: accepted by columns in DD-MM-YYYY format
 * (birth, employment) but stored as an invalid cell in `validation_date` and
 * `affiliation_*_date` (default format) — review lot 2, finding 1. Empty / unreadable → null. */
export const toGristDateCell = (date: any): number | null => toGristEpoch(fromGristDate(date));

/** What the field builders need to know about the document: its Annuaire columns (null when unreadable)
 * and the employing institutions (null when unreadable). */
export interface AnnuaireWriteContext {
  columns: AnnuaireColumnMeta[] | null;
  institutions: Institution[] | null;
}

/** Cell writer for the FUZZY_DATE_COLS, decided from the document's column types: Text column → canonical
 * fuzzy string; Date column (document not migrated yet) → epoch of the period bound (start columns: first day,
 * end columns: last day). Columns unknown → every column treated as Date, as before. Empty / unreadable → null. */
export type FuzzyDateEncoder = (col: string, value: any) => string | number | null;
export const fuzzyDateEncoderFor = (columns: AnnuaireColumnMeta[] | null): FuzzyDateEncoder => {
  const textCols = new Set((columns || [])
    .filter((c) => (FUZZY_DATE_COLS as readonly string[]).includes(c.id) && c.type === 'Text').map((c) => c.id));
  return (col, value) => {
    const d = fromGristFuzzyDate(value);
    if (!d) return null;
    if (textCols.has(col)) return d;
    return toGristEpoch(col.endsWith('_end_date') ? fuzzyDateUpperBound(d) : fuzzyDateLowerBound(d));
  };
};

/** `Employeur` (Reference to Etablissements) from the displayed label. Empty → 0 (reference cleared); a label
 * outside the list (legacy data) or institutions unknown → column left untouched. */
export const employerFieldsFor = (institutions: Institution[] | null, employer?: string): Record<string, number> => {
  const name = (employer || '').trim();
  if (!name) return { 'Employeur': 0 };
  const match = (institutions || []).find((e) => e.name === name);
  return match ? { 'Employeur': match.id } : {};
};

/** FTE cells, columns of the document only (lib/fte.ts); columns unknown → nothing written. */
export const fteFieldsFor = (columns: AnnuaireColumnMeta[] | null, values: { fte?: number | null; researchFte?: number | null }) =>
  (columns ? fteGristFields(columns, values) : {});

/** HR staff number cell, only when the Annuaire has the column (instances without HR data do not). */
export const hrIdFieldsFor = (columns: AnnuaireColumnMeta[] | null, hrId?: string): Record<string, number> => {
  const cell = hrIdCell(hrId || '');
  if (cell === null || !columns) return {};
  return columns.some((c) => c.id === HR_ID_COLUMN) ? { [HR_ID_COLUMN]: cell } : {};
};

/** Membership cells of an Annuaire row (lab, team, membership dates and type). */
export const membershipFieldsOf = (encodeDate: FuzzyDateEncoder, a: Affiliation | undefined): Record<string, any> => ({
  'LABO': a?.structureName || '',
  'team': a?.team || '',
  [AFFILIATION_START_COL]: encodeDate(AFFILIATION_START_COL, a?.startDate),
  [AFFILIATION_END_COL]: encodeDate(AFFILIATION_END_COL, a?.endDate),
  [MEMBERSHIP_TYPE_COL]: a?.membershipType || null,
});

/** Cells of a new record (formerly GristService.createResearcher). */
export function researcherCreateFields(researcher: Researcher, ctx: AnnuaireWriteContext): Record<string, any> {
  const encodeDate = fuzzyDateEncoderFor(ctx.columns);
  return {
    'Nom': researcher.lastName,
    'Prenom': researcher.firstName,
    'Civilite': researcher.civility,
    'uid_dyna': researcher.uid,
    'Email': researcher.email,
    'Nationalite': researcher.nationality,
    'DATE_DE_NAISSANCE_JJ_MM_AAAA': toGristDateCell(researcher.birthDate),
    // Affiliations: LABO (text, acronym) + Employeur (Reference, resolved by label)
    'LABO': researcher.affiliations[0]?.structureName || '',
    ...employerFieldsFor(ctx.institutions, researcher.employment.employer),
    'team': researcher.affiliations[0]?.team || '',
    [AFFILIATION_START_COL]: encodeDate(AFFILIATION_START_COL, researcher.affiliations[0]?.startDate),
    [AFFILIATION_END_COL]: encodeDate(AFFILIATION_END_COL, researcher.affiliations[0]?.endDate),
    [MEMBERSHIP_TYPE_COL]: researcher.affiliations[0]?.membershipType || null,
    'employment_start_date': encodeDate('employment_start_date', researcher.employment.startDate),
    'employment_end_date': encodeDate('employment_end_date', researcher.employment.endDate),
    'Corps_grade': researcher.employment.grade || null,
    'TYPE_EMPLOI': researcher.employment.contractType || null,
    ...fteFieldsFor(ctx.columns, researcher.employment),
    'ORCID': researcher.identifiers.orcid,
    'IdRef': researcher.identifiers.idref,
    'IdHAL': researcher.identifiers.halId,
    'IdHAL_i': researcher.identifiers.halIdNum?.replace(/\D/g, '') || null,
    'ID_SCOPUS': researcher.identifiers.scopusId,
    'photo_url': researcher.photoUrl?.trim() || null,
    // Declared public social media accounts (tracked by media monitoring).
    'Bluesky': researcher.socials?.bluesky || null,
    'Mastodon': researcher.socials?.mastodon || null,
    'YouTube': researcher.socials?.youtube || null,
    'Podcast_flux': researcher.socials?.podcast || null,
    'Blog': researcher.socials?.blog || null,
    'LinkedIn': researcher.socials?.linkedin || null,
    // Academic profiles & public CVs.
    'CV_institutionnel': researcher.profiles?.cvInstitutionnel || null,
    'CV_site_labo': researcher.profiles?.cvSiteLabo || null,
    'CV_pdf_docx_': researcher.profiles?.cvPdf || null,
    'CV_HAL': researcher.profiles?.cvHal || null,
    'Academia': researcher.profiles?.academia || null,
    'Researchgate': researcher.profiles?.researchgate || null,
    'Profil_GS': researcher.profiles?.googleScholar || null,
    'Site_web': researcher.profiles?.website || null,
    // Reliability layer (validated status/affiliation).
    ...validationToGristFields(researcher.validation, toGristDateCell),
    // Record filled from LDAP (« Fill from LDAP »): same traceability as the directory sync.
    ...(researcher.ldapPrefill ? {
      'statut_dyna': STATUT_DYNA_MAP[researcher.ldapPrefill.etat.toUpperCase()] || researcher.ldapPrefill.etat || null,
      'Data_source': 'LDAP',
      'LDAP_derniere_maj': researcher.ldapPrefill.date,
      ...hrIdFieldsFor(ctx.columns, researcher.hrId),
    } : {}),
  };
}

/** Cells of the record's own row on an update (formerly GristService.updateResearcher): identity, primary
 * membership of the row plan, employment, identifiers, profiles, validation. */
export function researcherUpdateFields(researcher: Researcher, plan: AffiliationRowPlan, ctx: AnnuaireWriteContext): Record<string, any> {
  const encodeDate = fuzzyDateEncoderFor(ctx.columns);
  return {
    'Nom': researcher.lastName,
    'Prenom': researcher.firstName,
    'Civilite': researcher.civility,
    'Email': researcher.email,
    'Nationalite': researcher.nationality,
    'DATE_DE_NAISSANCE_JJ_MM_AAAA': toGristDateCell(researcher.birthDate),
    // Affiliations: LABO (text, acronym) + Employeur (Reference, resolved by label)
    ...membershipFieldsOf(encodeDate, plan.primary),
    ...(plan.mainRole !== undefined ? { [RATTACHEMENT_COL]: plan.mainRole || null } : {}),
    ...employerFieldsFor(ctx.institutions, researcher.employment.employer),
    'ORCID': researcher.identifiers.orcid || null,
    'IdRef': researcher.identifiers.idref || null,
    'IdHAL': researcher.identifiers.halId || null,
    'IdHAL_i': researcher.identifiers.halIdNum?.replace(/\D/g, '') || null,   // entered in the record or by sync_hal (verify)
    'ID_SCOPUS': researcher.identifiers.scopusId || null,
    'photo_url': researcher.photoUrl?.trim() || null,   // editable from the record's tile
    'employment_start_date': encodeDate('employment_start_date', researcher.employment.startDate),
    'employment_end_date': encodeDate('employment_end_date', researcher.employment.endDate),
    'Corps_grade': researcher.employment.grade || null,
    'TYPE_EMPLOI': researcher.employment.contractType || null,
    ...fteFieldsFor(ctx.columns, researcher.employment),
    // Declared public social media accounts (tracked by media monitoring).
    'Bluesky': researcher.socials?.bluesky || null,
    'Mastodon': researcher.socials?.mastodon || null,
    'YouTube': researcher.socials?.youtube || null,
    'Podcast_flux': researcher.socials?.podcast || null,
    'Blog': researcher.socials?.blog || null,
    'LinkedIn': researcher.socials?.linkedin || null,
    // Academic profiles & public CVs.
    'CV_institutionnel': researcher.profiles?.cvInstitutionnel || null,
    'CV_site_labo': researcher.profiles?.cvSiteLabo || null,
    'CV_pdf_docx_': researcher.profiles?.cvPdf || null,
    'CV_HAL': researcher.profiles?.cvHal || null,
    'Academia': researcher.profiles?.academia || null,
    'Researchgate': researcher.profiles?.researchgate || null,
    'Profil_GS': researcher.profiles?.googleScholar || null,
    'Site_web': researcher.profiles?.website || null,
    // Reliability layer (validated status/affiliation).
    ...validationToGristFields(researcher.validation, toGristDateCell),
  };
}

/** Identity copied onto a new secondary-membership row (creation only: an existing row, from a merge, keeps
 * its own values). */
export const secondaryRowIdentity = (researcher: Researcher, uid: string): Record<string, any> => ({
  'uid_dyna': uid,
  'Nom': researcher.lastName,
  'Prenom': researcher.firstName,
  'Civilite': researcher.civility,
  'Email': researcher.email,
  'ORCID': researcher.identifiers.orcid || null,
  'IdRef': researcher.identifiers.idref || null,
  'IdHAL': researcher.identifiers.halId || null,
  'ID_SCOPUS': researcher.identifiers.scopusId || null,
});
