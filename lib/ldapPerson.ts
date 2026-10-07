/**
 * @file ldapPerson.ts
 * @description « Fill from LDAP » of the researcher creation form: fetches one directory entry
 * by uid (GET /api/ldap/person/:uid, scripts/lib/ldap_person.cjs) and maps it onto the new
 * record — same LDAP → Druid conventions as the directory sync (civility, grade, status).
 */
import { ResearcherStatus, Researcher, Structure, StructureLevel, Presence } from '../types';
import { employerKindOf, ldapAccountOf } from './presence';
import { ldapGradeFor } from './emeritus';
import { HOME_EMPLOYER, isExternalEmployer } from './validation';
import { translateApiError } from './apiErrors';
import { normalizeHrId } from './hrId';
import { hostingToolsOf, inferLdapEmployer, LdapEmployer } from './ldapEmployer';
import { normalizeCivility } from './civility';

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
  /** `{TOOL}…` values of supannRefId: hosting tool that opened the account (lib/ldapEmployer.ts). */
  toolRefs?: string[];
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

export { normalizeCivility };

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
  /** Employer deduced from the entry (lib/ldapEmployer.ts); null = undecided, the employer typed is kept. */
  inferredEmployer: LdapEmployer;
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
  // Account of another institution's directory, or employer deduced from the hosting tool / corps /
  // category (lib/ldapEmployer.ts): supannEtablissement alone is the home UAI for hosted staff too.
  const otherInstitution = !!person.etablissementUai && person.etablissementUai !== HOME_EMPLOYER.uai;
  const inferredEmployer: LdapEmployer = otherInstitution ? null
    : inferLdapEmployer({ categorie: person.categorie, empCorps: person.empCorps, tools: hostingToolsOf(person.toolRefs || []) });
  const externalEmployer = otherInstitution || inferredEmployer === 'CNRS';
  const homeEmployer = employerOptions.find((o) => o.trim() && !/^non renseign/i.test(o.trim()) && !isExternalEmployer(o));
  const cnrsEmployer = employerOptions.find((o) => o.trim().toUpperCase() === 'CNRS');
  const deducedEmployer = inferredEmployer === 'home' ? homeEmployer : inferredEmployer === 'CNRS' ? cnrsEmployer : undefined;
  // External employer: the LDAP category, corps and end date describe the hosted account, not the
  // job — same rule as the directory sync (computeLdapDiff), the typed values are kept.
  const grade = externalEmployer ? null : ldapGradeFor(person.categorie, person.empCorps);
  const employer = deducedEmployer || researcher.employment.employer;
  // Status as gristService computes it once saved: a known external employer (deduced or typed) ⇒ EXTERNE.
  const externalStatus = externalEmployer || isExternalEmployer(employer);

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
    status: person.etat ? (externalStatus ? ResearcherStatus.EXTERNE : statusFromEtat(person.etat)) : researcher.status,
    // Three axes (lib/presence.ts) as fetchResearchers will compute them once saved.
    presence: !externalStatus && /^D/i.test(person.etat) ? Presence.DEPART : Presence.PRESENT,
    ldapAccount: ldapAccountOf(person.uid, person.etat || undefined),
    employerKind: employerKindOf(employer),
    employment: {
      ...researcher.employment,
      employer,
      grade: grade || researcher.employment.grade,
      contractType: (!externalEmployer && person.categorie) || researcher.employment.contractType,
      endDate: (!externalEmployer && person.dateFin) || researcher.employment.endDate,
    },
    ldapPrefill: { etat: person.etat, date: today },
  };

  const labs = labsFromAffectations(person, labIndex(structures));
  return { researcher: next, lab: labs[0] || '', otherLabs: labs.slice(1), inferredEmployer };
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
