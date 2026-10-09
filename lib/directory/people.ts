// People of the directory, independent of the storage (druid-internal docs/plan-migration-postgresql.md, lot 6): the
// business rules that turn directory rows into Druid researchers — three-axis presence, emeritus status, LDAP
// overrides, grouping of qualified multi-row people, public ids. Both stores feed them the same `DirectoryRow`
// view: the Grist Annuaire rows (gristMapping.ts) and the PostgreSQL people and memberships (lib/directory/pg/).
// Moved from gristMapping.mapAnnuaireRecords, rules unchanged. Pure.
import { Researcher, MembershipType } from '../../types';
import { getPoleFromLab } from '../mappings';
import { ResearcherListSchema } from '../schemas';
import { ldapGradeFor, resolveGrade, isRetireeWithoutEmeritus, EmeritusSignals } from '../emeritus';
import { isExternalEmployer, ValidationInfo } from '../validation';
import { normalizeCivility } from '../civility';
import { derivePresence, employerKindOf, ldapAccountOf, legacyStatus, presenceFromValidated, PresenceInput } from '../presence';

export type RattachementRole = 'PRINCIPAL' | 'SECONDAIRE' | 'HISTORIQUE';

export const RATTACHEMENT_CHOICES: RattachementRole[] = ['PRINCIPAL', 'SECONDAIRE', 'HISTORIQUE'];

/**
 * One directory row — a person in one lab — as the business rules read it, whatever the storage. Values already
 * decoded by the store (dates canonical, identifiers as text); the person fields are those of the row.
 */
export interface DirectoryRow {
  /** Record id: Grist Annuaire row id = PostgreSQL membership id (stable ids). */
  rowId: number;
  uid: string;
  lastName: string;
  firstName: string;
  /** Civility as stored (« Mme », « M. », F, M…): normalized here. */
  civility: string;
  email: string;
  nationality: string;
  photoUrl: string;
  annuaireUrl: string;
  /** YYYY-MM-DD (or the stored text when it is not a date), '' when none. */
  birthDate: string;
  /** Corps / grade, employment type and its label, as stored (null when the cell is empty). */
  corpsGrade: string | null;
  employmentType: string | null;
  employmentTypeLabel: string | null;
  /** Employer: id of the institution (0 = none), or a label typed in place of a reference. */
  employer: number | string | null;
  /** Canonical reduced-precision dates, '' when none. */
  employmentStart: string;
  employmentEnd: string;
  hrId: string;
  fte: number | null;
  researchFte: number | null;
  validation: ValidationInfo;
  /** Validated status as stored (PRESENT / DEPART / PARTI, INTERNE / EXTERNE before 2026-10-07). */
  validatedStatus: unknown;
  lab: string;
  team: string;
  membershipStart: string;
  membershipEnd: string;
  membershipType: MembershipType | undefined;
  role: RattachementRole | '';
  groups: string[];
  identifiers: { orcid: string; idref: string; halId: string; halIdNum: string; scopusId: string; openalexId: string; openalexIds: string };
  socials: { bluesky: string; mastodon: string; youtube: string; podcast: string; blog: string; linkedin: string };
  profiles: { cvInstitutionnel: string; cvSiteLabo: string; cvPdf: string; cvHal: string; academia: string; researchgate: string; googleScholar: string; website: string };
  /** HDR as stored (« OUI »…) and its year as stored. */
  hdr: unknown;
  hdrYear: unknown;
}

/** Employing institutions by id: name and UAI (employer label and kind of the researchers). */
export type EmployerIndex = Map<number, { name: string; uai: string }>;

/**
 * Groups the QUALIFIED Annuaire rows of the same person (same uid_dyna, exactly one
 * `rattachement = PRINCIPAL` row) into a single Druid researcher carried by the principal row,
 * with one membership per row (SECONDAIRE = concurrent, HISTORIQUE = ended).
 * Unqualified groups remain distinct records (visible for arbitration).
 * In-place mutation; returns the filtered list.
 */
export function groupQualifiedRows(researchers: any[], rowRole: Record<number, RattachementRole | ''>, rowEnd: Record<number, string>): any[] {
  const byUid = new Map<string, any[]>();
  for (const r of researchers) if (r.uid) { if (!byUid.has(r.uid)) byUid.set(r.uid, []); byUid.get(r.uid)!.push(r); }
  const drop = new Set<number>();
  for (const rows of byUid.values()) {
    if (rows.length < 2) continue;
    const principals = rows.filter((r) => rowRole[r.gristRowId] === 'PRINCIPAL');
    if (principals.length !== 1) continue;                       // not qualified → unchanged
    const others = rows.filter((r) => r !== principals[0] && rowRole[r.gristRowId]);
    if (others.length !== rows.length - 1) continue;             // a row without role → unchanged
    const main = principals[0];
    main.affiliations = [
      { ...main.affiliations[0], isPrimary: true, role: 'PRINCIPAL', gristRowId: main.gristRowId },
      ...others.map((o) => ({
        ...o.affiliations[0], isPrimary: false, role: rowRole[o.gristRowId], gristRowId: o.gristRowId,
        endDate: rowRole[o.gristRowId] === 'HISTORIQUE' ? (rowEnd[o.gristRowId] || o.affiliations[0]?.endDate || '') : o.affiliations[0]?.endDate,
      })),
    ];
    for (const o of others) drop.add(o.gristRowId);
  }
  return drop.size ? researchers.filter((r) => !drop.has(r.gristRowId)) : researchers;
}

/** Lowercase ASCII slug used to build an ext_ identifier (accents removed, non-alphanumerics -> '-'). */
export const slugForExtId = (s: string): string =>
  (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Assigns the public/central identifier of each researcher (in-place mutation).
 * - real uid_dyna present: id = uid (1st record). Duplicate uids (≈17): the 1st keeps the bare uid
 * (served by the URL), the next ones take `uid-<rowId>` to stay navigable/unique → counted in the log.
 * - No uid (records outside the LDAP directory): synthetic id `ext_<name>-<first-name initial>`,
 * suffixed with the rowId on collision. NB: for harvestable externals, this same `ext_`
 * is now PERSISTED in uid_dyna (+ people.csv) → they go through the « real uid » branch
 * above; the synthetic computation is only a fallback for externals without uid_dyna.
 */
export function assignPublicIds(researchers: any[]): void {
  const used = new Set<string>();
  const uidSeen = new Set<string>();
  const dupUids = new Set<string>();

  // 1) Records with a real uid
  for (const r of researchers) {
    if (!r.uid) continue;
    if (!uidSeen.has(r.uid)) {
      r.id = r.uid;
      uidSeen.add(r.uid);
    } else {
      r.id = `${r.uid}-${r.gristRowId}`;
      dupUids.add(r.uid);
    }
    used.add(r.id);
  }

  // 2) Records without uid -> synthetic identifier ext_<name>-<initial>
  for (const r of researchers) {
    if (r.id) continue;
    const nom = slugForExtId(r.lastName);
    const initiale = slugForExtId(r.firstName).charAt(0) || 'x';
    const base = `ext_${nom || 'inconnu'}-${initiale}`;
    let candidate = base;
    if (used.has(candidate)) candidate = `${base}-${r.gristRowId}`;
    r.id = candidate;
    used.add(candidate);
  }

  // Count only: this now runs on the server, whose logs must not list people (the uids are listed by the
  // Duplicates page).
  if (dupUids.size > 0) {
    console.warn(`[directory] ${dupUids.size} duplicated uid_dyna in the Annuaire: the URL opens the first record, the next ones get a suffixed id.`);
  }
}

/**
 * Directory rows → Druid researchers: one researcher per row, qualified multi-row people grouped on their PRINCIPAL
 * row, public ids assigned, Zod-validated. `ldapCache` = content of ldap_status_cache.json keyed by uid (`{}` on an
 * instance without LDAP). Pure.
 */
export function mapDirectoryRows(rows: DirectoryRow[], employers: EmployerIndex, ldapCache: Record<string, any>): Researcher[] {
  if (!rows || rows.length === 0) return [];
  // No LDAP cache (instance without LDAP, test instance, sync never run): an uid missing from it
  // proves nothing — presence then comes from the dates and validations only.
  const ldapAvailable = Object.keys(ldapCache).length > 0;

  const researchersMapped = rows.map((row) => {
    const uid = row.uid;
    const employerId = row.employer;
    // Reference: 0 = no employer, we display empty rather than « ID: 0 ».
    const employerName = (typeof employerId === 'number')
      ? (employerId === 0 ? '' : (employers.get(employerId)?.name || `ID: ${employerId}`))
      : (employerId || '');

    // Three axes (lib/presence.ts, docs/plan-statut-employeur-ldap.md): employer, LDAP account and
    // presence. The uid only says whether there is an LDAP account to read (`ext_` = none).
    const employerUai = (typeof employerId === 'number') ? employers.get(employerId)?.uai : '';
    // Known employer ≠ Nantes Université (INSERM, CNRS, Centrale…): the LDAP account is a hosted one —
    // its state, category and corps describe the account, not the job.
    const externalEmployer = isExternalEmployer(employerName, employerUai);
    const employerKind = employerKindOf(employerName, employerUai);
    const ldapEntry = uid ? ldapCache[uid] : undefined;
    const ldapEtat: string | undefined = ldapEntry === undefined ? undefined : (typeof ldapEntry === 'string' ? ldapEntry : ldapEntry.etat);
    const hasRealUid = typeof uid === 'string' && !!uid && !uid.startsWith('ext_');
    const ldapAccount = ldapAccountOf(uid, ldapEtat);

    let ldapCiv = '';
    if (uid && ldapCache[uid] && (ldapCache[uid] as any).civilite) {
      ldapCiv = (ldapCache[uid] as any).civilite;
    }

    // LDAP first, otherwise the stored civility
    const researcherCivility = normalizeCivility(ldapCiv || row.civility);

    // External employer: the LDAP category and corps describe the hosted account (« CDI
    // UNIVERSITE », generic corps → « IR ») and not the actual job → keep the stored values.
    const ldapCategory: string = (!externalEmployer && uid && ldapCache[uid] && (ldapCache[uid] as any).categorie)
      ? (ldapCache[uid] as any).categorie
      : '';

    const ldapEmpCorps: string = (!externalEmployer && uid && ldapCache[uid] && (ldapCache[uid] as any).empCorps)
      ? (ldapCache[uid] as any).empCorps
      : '';
    // LDAP corps transposed to an emeritus code when dynaCategorie says emeritus (see lib/emeritus.ts).
    const ldapGrade: string | null = ldapGradeFor(ldapCategory, ldapEmpCorps, row.corpsGrade);

    const ldapEppn: string = (uid && ldapCache[uid] && (ldapCache[uid] as any).eppn)
      ? (ldapCache[uid] as any).eppn
      : '';

    let researcherBirthDate = row.birthDate;
    let birthDateFromLdap = false;

    if (uid && ldapCache[uid] && (ldapCache[uid] as any).birthDate) {
      const ldapBirth = (ldapCache[uid] as any).birthDate;
      if (/^\d{8}$/.test(ldapBirth)) {
        researcherBirthDate = `${ldapBirth.substring(0, 4)}-${ldapBirth.substring(4, 6)}-${ldapBirth.substring(6, 8)}`;
        birthDateFromLdap = true;
      } else if (ldapBirth) {
        researcherBirthDate = ldapBirth;
        birthDateFromLdap = true;
      }
    }

    // Emeritus status / retirement (see lib/emeritus.ts): trace of emeritus status ⇒ emeritus grade (PREM, MCFEM,
    // DREM, CREM) even if the stored grade is not normalized yet; retired without emeritus status ⇒ Parti.
    const baseGrade: string = ldapGrade ?? row.corpsGrade ?? '';
    const emeritusSignals: EmeritusSignals = {
      grade: baseGrade, typeEmploi: row.employmentType, libTypeEmploi: row.employmentTypeLabel, ldapCategory,
    };
    const finalGrade = resolveGrade(baseGrade, emeritusSignals);

    // Reliability layer: a validation covering the status sets the presence (INTERNE / EXTERNE, written
    // before 2026-10-07, read as PRESENT). `derivedPresence` = without it, to flag a conflict.
    const validation = row.validation;
    const presenceInput: PresenceInput = {
      employer: employerKind, hasRealUid: hasRealUid && ldapAvailable, ldapEtat,
      employmentEnd: row.employmentEnd,
      membershipEnd: row.membershipEnd,
      retireeWithoutEmeritus: isRetireeWithoutEmeritus(emeritusSignals),
    };
    const derivedPresence = derivePresence(presenceInput);
    const validatedPresence = validation.validated && validation.validationScope.includes('statut')
      ? presenceFromValidated(row.validatedStatus) : undefined;
    const presence = derivePresence({ ...presenceInput, validated: validatedPresence });

    return {
      id: '',                 // filled after the map (real uid, otherwise ext_<name>-<initial>) — see assignPublicIds
      gristRowId: row.rowId,  // record id, technical key of the writes
      uid: uid || '',
      civility: researcherCivility,
      lastName: row.lastName,
      firstName: row.firstName,
      displayName: `${row.lastName.toUpperCase()} ${row.firstName}`,
      photoUrl: row.photoUrl,
      annuaireUrl: row.annuaireUrl,
      email: row.email,
      eppn: ldapEppn,
      hrId: row.hrId,
      nationality: row.nationality,
      birthDate: researcherBirthDate,
      status: legacyStatus(presence, employerKind, ldapAccount),
      derivedStatus: legacyStatus(derivedPresence, employerKind, ldapAccount),
      presence,
      derivedPresence,
      ldapAccount,
      employerKind,
      employment: {
        employer: employerName,
        institutionId: (typeof employerId === 'number') ? (employers.get(employerId)?.uai || '') : '',
        contractType: ldapCategory || row.employmentType || '',
        employmentTypeCode: row.employmentType || '',
        grade: finalGrade,
        ldapFields: [
          ...(ldapCategory ? ['contractType'] : []),
          ...(ldapGrade !== null ? ['grade'] : []),
        ],
        internalTypology: row.employmentTypeLabel || '',
        startDate: row.employmentStart,
        endDate: row.employmentEnd,
        // Optional columns (lib/fte.ts): absent or empty → null, a real 0 is kept.
        fte: row.fte,
        researchFte: row.researchFte,
      },
      affiliations: [{
        structureName: row.lab,
        team: row.team,
        // Membership dates in the row's lab/team, distinct from the employment dates (« Emploi » card).
        startDate: row.membershipStart,
        endDate: row.membershipEnd,
        membershipType: row.membershipType,
        isPrimary: true
      }],
      ldapFields: [...(birthDateFromLdap ? ['birthDate'] : [])],
      groups: row.groups,
      identifiers: { ...row.identifiers },
      // Declared public social media accounts (media monitoring), editable from the record.
      socials: { ...row.socials },
      // Academic profiles & public CVs.
      profiles: { ...row.profiles },
      // Nantes Université fields. Only the pole (from the lab) and the HDR are filled: the composante, location
      // and doctoral school were read from column ids that do not exist (« Composante_de_ »…), hence always
      // empty — kept as they are by the move to this module (lot 6), to be fixed on their own.
      nuFields: {
        pole: getPoleFromLab(row.lab),
        composante: undefined,
        location: undefined,
        doctoralSchool: undefined,
        hdr: row.hdr === 'OUI',
        hdrYear: row.hdrYear as any,
      },
      validation,
      lastSync: new Date().toISOString().split('T')[0],
    };
  });

  // Qualified multi-affiliations: a single record per person, carried by the PRINCIPAL row, the other rows
  // becoming memberships.
  const rowRole: Record<number, RattachementRole | ''> = {};
  const rowEnd: Record<number, string> = {};
  for (const row of rows) {
    rowRole[row.rowId] = row.role;
    rowEnd[row.rowId] = row.membershipEnd || row.employmentEnd;
  }
  const researchersGrouped = groupQualifiedRows(researchersMapped, rowRole, rowEnd);

  // Public/central identifier: real uid when present, otherwise ext_<name>-<initial>.
  // The record id (gristRowId) stays internal for writes. See useUrlState / updateResearcher.
  assignPublicIds(researchersGrouped);

  const validation = ResearcherListSchema.safeParse(researchersGrouped);
  if (!validation.success) {
    console.warn('Zod Validation Warning (Researchers):', validation.error.format());
  }

  return (validation.success ? validation.data : researchersGrouped) as Researcher[];
}
