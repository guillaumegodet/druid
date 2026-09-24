/**
 * @file emeritus.ts
 * @description Emeritus status and retirement: single rule shared by record reading (gristService),
 * the LDAP sync (grade proposal) and the normalization script (scripts/normalize_emeritus.ts).
 *
 * Finding of 2026-09-15: emeritus status was scattered over three Annuaire columns — `Corps_grade`
 * (PREM/DREM for only a third of the records), `TYPE_EMPLOI` (« PROFESSEUR EMERITE », « EMERITE »,
 * HR category from LDAP) and `LIB_TYPE_EMPLOI` (« EMERITE », DRPI source). LDAP itself separates
 * the two: dynaCategorie = PROFESSEUR EMERITE but supannEmpCorps = original corps (300 → PR), which
 * the sync copied into Corps_grade.
 *
 * Target (CRISalid typology, see gradeTypology / cdb's employee_types.yml): emeritus status is a corps
 * in its own right carried by `Corps_grade`, hence by `position` in people.csv — three target codes:
 * MCFEM (associate professors), DREM (research directors), PREM (all other emeriti).
 * CREM is still recognized on read as an emeritus trace but is no longer produced.
 * TYPE_EMPLOI and LIB_TYPE_EMPLOI remain source values (traceability), left unchanged.
 *
 * Pure module (no network / DOM access).
 */
import { getGradeFromNcorps } from './gradeTypology';

export const EMERITUS_GRADES = ['PREM', 'MCFEM', 'DREM', 'CREM'] as const;
export type EmeritusGrade = (typeof EMERITUS_GRADES)[number];

const norm = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/** The grade is already an emeritus code of the typology. */
export const isEmeritusGrade = (grade: any): grade is EmeritusGrade =>
  (EMERITUS_GRADES as readonly string[]).includes(norm(grade));

/** Category / employment type label expressing emeritus status (« PROFESSEUR EMERITE », « EMERITE »…). */
export const isEmeritusLabel = (label: any): boolean => /EMERIT/.test(norm(label));

/** HR category « RETRAITE » (LDAP dynaCategorie or TYPE_EMPLOI). */
export const isRetireeLabel = (label: any): boolean => /^RETRAITE/.test(norm(label));

/** Everything on a record that may carry a trace of emeritus status or retirement. */
export interface EmeritusSignals {
  grade?: any;          // Corps_grade (or already resolved LDAP grade)
  typeEmploi?: any;     // TYPE_EMPLOI
  libTypeEmploi?: any;  // LIB_TYPE_EMPLOI (DRPI)
  ldapCategory?: any;  // dynaCategorie from the LDAP cache ('' when external employer: LDAP ignored)
}

/** Is there an emeritus trace in at least one of the sources? */
export const hasEmeritusTrace = (s: EmeritusSignals): boolean =>
  isEmeritusGrade(s.grade)
  || isEmeritusLabel(s.typeEmploi)
  || isEmeritusLabel(s.libTypeEmploi)
  || isEmeritusLabel(s.ldapCategory);

/**
 * Emeritus code matching an original corps (simplified rule, decision of 2026-09-15):
 * MCF, MCFHC, MCUPH ⇒ MCFEM; DR, DR1, DR2, DRCE, « DR CNRS » ⇒ DREM; any other emeritus ⇒ PREM
 * (professors, PUPH, CR, unknown or empty corps). Never returns null: an emeritus trace is enough.
 */
export const emeritusGradeFor = (baseGrade: any, _typeEmploi?: any): EmeritusGrade => {
  const g = norm(baseGrade);
  if (/^(MCF|MCFHC|MCUPH|MCFEM)$/.test(g)) return 'MCFEM';
  if (/^(DR|DR1|DR2|DRCE|DREM)$/.test(g) || /^DR[ _-]/.test(g)) return 'DREM';
  return 'PREM';
};

/**
 * Grade to keep from LDAP: the mapped NCORPS corps, transposed to an emeritus code when dynaCategorie
 * says emeritus (LDAP keeps the original corps). `gristGrade` is the fallback corps when LDAP has no
 * corps (18 emeriti without supannEmpCorps). `null` = nothing usable on the LDAP side.
 */
export const ldapGradeFor = (categorie: any, ncorps: any, gristGrade?: any): string | null => {
  const base = ncorps ? getGradeFromNcorps(String(ncorps)) : null;
  if (isEmeritusLabel(categorie)) return emeritusGradeFor(base ?? gristGrade ?? '');
  return base;
};

/**
 * Final grade of a record: if an emeritus trace exists, the emeritus code of the base corps; otherwise
 * the base corps as is. Read fallback for records not yet normalized in Grist.
 */
export const resolveGrade = (baseGrade: any, s: EmeritusSignals): string => {
  const base = String(baseGrade ?? '');
  if (!hasEmeritusTrace(s)) return base;
  return emeritusGradeFor(base);
};

/**
 * Retiree without emeritus status ⇒ « Parti » (decision of 2026-09-15): the HR category « RETRAITE »
 * (LDAP or TYPE_EMPLOI) takes precedence over the LDAP state, even if the account is still active (N).
 */
export const isRetireeWithoutEmeritus = (s: EmeritusSignals): boolean =>
  (isRetireeLabel(s.typeEmploi) || isRetireeLabel(s.ldapCategory)) && !hasEmeritusTrace(s);
