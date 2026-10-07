/**
 * @file ldapEmployer.ts
 * @description Employer deduced from an LDAP entry. The directory does NOT carry the employer:
 * `supannEtablissement` (and the `etab=` of `supannEmpProfil`) is the home institution for every
 * account, a CNRS researcher hosted in a lab included. Three other attributes tell:
 *
 * - `supannRefId {TOOL}<code><n>`: the account was opened by a hosting tool — HBRG (hosted),
 *   CNRS, PRST (contractor), CAPA, STAG (intern)… — except TITH (honorary tenured, home staff);
 * - `supannEmpCorps`: HR corps, empty for hosted accounts;
 * - `dynaCategorie`: TITULAIRE, CDD UNIVERSITE, DOCTORANT, CNRS-INSERM…
 *
 * Measured on the Annuaire records whose employer was already known (2026-10-07,
 * docs/plan-statut-employeur-ldap.md, lot 1): the « home » rule is right 95 % of the time, the
 * CNRS rule 89 %. The PU-PH / MCU-PH corps (324, 325: hospital-university, employer recorded as
 * CHU as often as university) and the H0x contract corps (half hosted) are left undecided.
 *
 * Pure module (no network / DOM access): testable, used by « Fill from LDAP »; the one-off bulk
 * fill of 2026-10-07 applied the same rule.
 */

/** Categories of staff employed by the home institution when they also have an HR corps. */
const HOME_CATEGORIES = new Set([
  'TITULAIRE', 'CDD UNIVERSITE', 'CDI UNIVERSITE', 'DOCTORANT', 'RETRAITE', 'PROFESSEUR EMERITE',
  'MAITRE DE CONFERENCES HONORAIRE',
]);

/** Corps that do not say who the employer is: hourly teachers, hospital-university, H0x contracts. */
const AMBIGUOUS_CORPS = /^(VN|VF|324|325|H0\d)$/;

/** Hosting tools of the home institution itself (honorary tenured staff). */
const HOME_TOOLS = new Set(['TITH', 'TITHA']);

/** `{TOOL}CNRS255` → `CNRS`; other `supannRefId` values (HR, student…) are ignored. */
export const hostingToolsOf = (refIds: string[]): string[] => refIds
  .map((v) => String(v).match(/^\{TOOL\}([A-Z]+)\d*$/i)?.[1]?.toUpperCase() || '')
  .filter(Boolean);

export interface LdapEmployerSignals {
  /** dynaCategorie. */
  categorie: string;
  /** supannEmpCorps, prefix stripped (« 301 »). */
  empCorps: string;
  /** Hosting tools from supannRefId (`hostingToolsOf`). */
  tools: string[];
}

/**
 * - `home`: employed by the home institution (Nantes Université);
 * - `CNRS`: account opened by the CNRS tool for a CNRS-INSERM category;
 * - null: undecided (hosted account of another employer, contractor, ambiguous corps…).
 */
export type LdapEmployer = 'home' | 'CNRS' | null;

export const inferLdapEmployer = ({ categorie, empCorps, tools }: LdapEmployerSignals): LdapEmployer => {
  const cat = String(categorie || '').trim().toUpperCase();
  const corps = String(empCorps || '').trim().toUpperCase();
  const hosted = tools.map((t) => t.toUpperCase()).filter((t) => !HOME_TOOLS.has(t));
  if (hosted.length) return cat === 'CNRS-INSERM' && hosted.some((t) => t.startsWith('CNRS')) ? 'CNRS' : null;
  return HOME_CATEGORIES.has(cat) && corps && !AMBIGUOUS_CORPS.test(corps) ? 'home' : null;
};
