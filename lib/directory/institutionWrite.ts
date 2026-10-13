// Employing institutions written from Druid (Administration › Institutions): the checks and the Grist encoding of a
// row of the `Etablissements` table, shared by the Grist commands (lib/directory/commands.ts) and the PostgreSQL ones
// (lib/directory/pg/commands.ts). Pure module: no network, no DOM.
//
// An institution is a label (`Employeur`, the value shown in the employer dropdown of the record form, hence unique),
// an optional long form (`Libelle`) and three optional identifiers: the UAI code of the French education ministry
// (7 digits + letter), the ROR identifier (9 characters, with or without its URL) and the IdRef PPN of the corporate
// body (8 digits + digit or X, used by the ABES export). Rows are never deleted from Druid: persons reference them.
import { ApiError } from './errors';
import type { Institution } from './gristMapping';

/** What the form sends (every field optional but the name; blanks mean « unknown »). */
export interface InstitutionInput {
  name: string;
  label?: string;
  uai?: string;
  ror?: string;
  idref?: string;
}

/** The same fields once checked and normalized (blank identifiers → ''). */
export interface InstitutionFields {
  name: string;
  label: string;
  uai: string;
  ror: string;
  idref: string;
}

const UAI = /^\d{7}[A-Z]$/;
const ROR = /^0[a-z0-9]{6}\d{2}$/;
const PPN = /^\d{8}[\dX]$/;

const clean = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Comparison key of a name: case, accents and punctuation ignored (« U. Paris-Nanterre » = « u paris nanterre »). */
export const institutionNameKey = (name: string): string =>
  clean(name).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Checks the input and normalizes it: trimmed texts, UAI in capitals, ROR without its URL and in lower case.
 * Throws a 400 ApiError on a missing name or a malformed identifier.
 */
export const normalizeInstitutionInput = (input: InstitutionInput): InstitutionFields => {
  const name = clean(input.name);
  if (!name) throw new ApiError(400, 'The institution name is required');
  if (name.length > 200) throw new ApiError(400, 'The institution name is too long');
  const label = clean(input.label);
  const uai = clean(input.uai).toUpperCase();
  const ror = clean(input.ror).toLowerCase().replace(/^https?:\/\/ror\.org\//, '');
  const idref = clean(input.idref).replace(/^https?:\/\/(www\.)?idref\.fr\//i, '').replace(/\.\w+$/, '').toUpperCase();
  if (uai && !UAI.test(uai)) throw new ApiError(400, `Invalid UAI code: ${uai}`);
  if (ror && !ROR.test(ror)) throw new ApiError(400, `Invalid ROR identifier: ${ror}`);
  if (idref && !PPN.test(idref)) throw new ApiError(400, `Invalid IdRef PPN: ${idref}`);
  return { name, label: label === name ? '' : label, uai, ror, idref };
};

/**
 * Refuses a name or a UAI already carried by another institution (409). `excludeId` = the row being updated.
 * Names are compared with institutionNameKey; the existing duplicates of the table (legacy import) are not
 * reported here, only a new collision is.
 */
export const assertInstitutionUnique = (fields: InstitutionFields, existing: Institution[], excludeId?: number): void => {
  const key = institutionNameKey(fields.name);
  for (const e of existing) {
    if (excludeId !== undefined && e.id === excludeId) continue;
    if (institutionNameKey(e.name) === key) throw new ApiError(409, `An institution with this name already exists: ${e.name}`);
    if (fields.uai && clean(e.uai).toUpperCase() === fields.uai) throw new ApiError(409, `An institution with this UAI already exists: ${e.name}`);
  }
};

/** Grist row of the `Etablissements` table (the columns mapInstitutionRecords reads). */
export const institutionGristFields = (fields: InstitutionFields): Record<string, string> =>
  ({ Employeur: fields.name, Libelle: fields.label, UAI: fields.uai, ROR: fields.ror, idref: fields.idref });

/** Checks, normalizes and refuses the duplicates in one go (what both command implementations do first). */
export const prepareInstitutionWrite = (input: InstitutionInput, existing: Institution[], excludeId?: number): InstitutionFields => {
  const fields = normalizeInstitutionInput(input);
  assertInstitutionUnique(fields, existing, excludeId);
  return fields;
};
