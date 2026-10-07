/**
 * @file ldapPerson.ts
 * @description « Fill from LDAP » of the researcher creation form: fetches one directory entry
 * by uid (GET /api/ldap/person/:uid, scripts/lib/ldap_person.cjs) and maps it onto the new
 * record — same LDAP → Druid conventions as the directory sync (civility, grade, status).
 */
import { ResearcherStatus, Researcher, Structure, StructureLevel } from '../types';
import { ldapGradeFor } from './emeritus';
import { HOME_EMPLOYER, isExternalEmployer } from './validation';
import { translateApiError } from './apiErrors';
import { normalizeHrId } from './hrId';

/** Entry returned by /api/ldap/person/:uid. */
export interface LdapPerson {
  uid: string;
  lastName: string;
  firstName: string;
  email: string;
  civilite: string;
  /** YYYY-MM-DD or YYYYMMDD. */
  birthDate: string;
  eppn: string;
  /** dynaEtat code: N (normal), D (departure), A (anticipated). */
  etat: string;
  /** dynaCategorie (« TITULAIRE », « CDD UNIVERSITE »…) → TYPE_EMPLOI. */
  categorie: string;
  /** BCN N_CORPS code, prefix stripped (« 301 »). */
  empCorps: string;
  /** Latest « [datefin=…] » of supannEmpProfil (YYYY-MM-DD), '' for an open-ended contract. */
  dateFin: string;
  /** supannEmpId = HR staff number (Mangue), '' when absent (lib/hrId.ts). */
  empId?: string;
  etablissementUai: string;
  population: string;
  /** supannEntiteAffectation: supannCodeEntite codes = local_id of the Grist Structures. */
  affectationCodes: string[];
  affectationPrincipale: string;
  affectationLabels: string[];
  affectationPrincipaleLabel: string;
}

/** Mapping dynaEtat code (LDAP) -> statut_dyna label (Grist). */
export const STATUT_DYNA_MAP: Record<string, string> = { N: 'NORMAL', D: 'DEPART', A: 'ANTICIPE' };

/** Druid status derived from an LDAP dynaEtat code (N → `Interne`, D → `Départ`, other → `Externe`). */
export const statusFromEtat = (etat: any): ResearcherStatus => {
  const c = String(etat ?? '').trim().toUpperCase().charAt(0);
  if (c === 'N') return ResearcherStatus.INTERNE;
  if (c === 'D') return ResearcherStatus.DEPART;
  return ResearcherStatus.EXTERNE;
};

/** LDAP/Grist civility (« Mme », « M. », « Madame »…) → F / M. */
export const normalizeCivility = (val: string): string => {
  if (!val) return '';
  const v = val.toUpperCase().trim();
  if (v === 'F' || v === 'FEMME' || v.startsWith('MME') || v.startsWith('MLLE') || v.startsWith('MADAME')) return 'F';
  if (v === 'M' || v === 'HOMME' || v.startsWith('M.') || v.startsWith('MONSIEUR') || v.startsWith('MR')) return 'M';
  return v.charAt(0);
};

const isoBirthDate = (b: string): string => {
  const s = String(b || '').trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};

export interface LdapPrefill {
  researcher: Researcher;
  /** Lab (acronym, as in the membership menu) found among the LDAP affectations — the principal
   * affectation first; '' when none of the codes is a known lab. */
  lab: string;
  /** Other labs found in the affectations (multi-affiliation: left to the user). */
  otherLabs: string[];
}

/**
 * Applies an LDAP entry to a record being created. LDAP is authoritative for the fields it
 * carries: they replace what was typed; the fields it does not carry are left as is.
 */
export const prefillFromLdap = (
  researcher: Researcher,
  person: LdapPerson,
  structures: Structure[],
  employerOptions: string[],
  today: string = new Date().toISOString().slice(0, 10),
): LdapPrefill => {
  const lastName = person.lastName.toUpperCase();
  const externalEmployer = !!person.etablissementUai && person.etablissementUai !== HOME_EMPLOYER.uai;
  const homeEmployer = employerOptions.find((o) => o.trim() && !/^non renseign/i.test(o.trim()) && !isExternalEmployer(o));
  const grade = ldapGradeFor(person.categorie, person.empCorps);

  const next: Researcher = {
    ...researcher,
    uid: person.uid,
    hrId: normalizeHrId(person.empId) || researcher.hrId,
    lastName: lastName || researcher.lastName,
    firstName: person.firstName || researcher.firstName,
    displayName: `${lastName} ${person.firstName}`.trim() || researcher.displayName,
    civility: normalizeCivility(person.civilite) || researcher.civility,
    email: person.email || researcher.email,
    eppn: person.eppn || researcher.eppn,
    birthDate: isoBirthDate(person.birthDate) || researcher.birthDate,
    status: person.etat ? (externalEmployer ? ResearcherStatus.EXTERNE : statusFromEtat(person.etat)) : researcher.status,
    employment: {
      ...researcher.employment,
      employer: (!externalEmployer && person.etablissementUai && homeEmployer) || researcher.employment.employer,
      grade: grade || researcher.employment.grade,
      contractType: person.categorie || researcher.employment.contractType,
      endDate: person.dateFin || researcher.employment.endDate,
    },
    ldapPrefill: { etat: person.etat, date: today },
  };

  const labs = labsFromAffectations(person, labIndex(structures));
  return { researcher: next, lab: labs[0] || '', otherLabs: labs.slice(1) };
};

/** Labs = structures of level « Unité » by local_id (supannCodeEntite) → name as in the membership menu. */
export const labIndex = (structures: Structure[]): Map<string, string> => {
  const labByCode = new Map<string, string>();
  for (const s of structures) {
    const name = s.acronym || s.officialName;
    if (s.level === StructureLevel.ENTITE && s.localId && name) labByCode.set(String(s.localId), name);
  }
  return labByCode;
};

/** Labs among the LDAP affectation codes, the principal affectation first. */
export const labsFromAffectations = (
  person: Pick<LdapPerson, 'affectationPrincipale' | 'affectationCodes'>,
  labByCode: Map<string, string>,
): string[] => {
  const codes = [person.affectationPrincipale, ...person.affectationCodes].filter(Boolean);
  return Array.from(new Set(codes.map((c) => labByCode.get(c)).filter((l): l is string => !!l)));
};

/** GET /api/ldap/person/:uid → the entry, or an Error carrying the (translated) server message. */
export const fetchLdapPerson = async (uid: string): Promise<LdapPerson> => {
  const resp = await fetch(`/api/ldap/person/${encodeURIComponent(uid.trim())}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`);
  return data as LdapPerson;
};
