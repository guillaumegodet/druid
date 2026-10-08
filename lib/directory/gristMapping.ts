// Grist → Druid domain mapping of the directory (people, structures, institutions).
//
// Pure module, runnable in the browser, in Node (server.cjs, through the server-api.cjs bundle) and in the
// Cloudflare Functions: no network, no DOM, no Lingui macro. It used to live inside lib/gristService.ts,
// where the browser read the raw Grist rows through the /api/grist proxy; it moved here verbatim when the
// directory became readable through the domain API (/api/v1, druid-internal docs/plan-migration-postgresql.md,
// lot 1). gristService.ts imports the helpers it still needs for its writes from this module.
import { Researcher, Structure, Membership, MembershipType, MEMBERSHIP_TYPES } from '../../types';
import { getPoleFromLab } from '../mappings';
import { ResearcherListSchema, StructureListSchema } from '../schemas';
import { ldapGradeFor, resolveGrade, isRetireeWithoutEmeritus, EmeritusSignals } from '../emeritus';
import { parseValidation, isExternalEmployer } from '../validation';
import { normalizeFuzzyDate } from '../dates';
import { withDerivedParents } from '../structureHierarchy';
import { FTE_COLUMNS, parseFteCell } from '../fte';
import { normalizeCivility } from '../civility';
import { HR_ID_COLUMN, normalizeHrId } from '../hrId';
import { derivePresence, employerKindOf, ldapAccountOf, legacyStatus, presenceFromValidated, PresenceInput } from '../presence';
import { getTutelleName } from '../uaiMapping';

/** A row as returned by the Grist REST API (`GET /tables/<table>/records`). */
export interface GristRecord {
  id: number;
  fields: Record<string, any>;
}

export const RATTACHEMENT_COL = 'rattachement';

export type RattachementRole = 'PRINCIPAL' | 'SECONDAIRE' | 'HISTORIQUE';

export const RATTACHEMENT_CHOICES: RattachementRole[] = ['PRINCIPAL', 'SECONDAIRE', 'HISTORIQUE'];

export const DUPLICATE_DECISION_COL = 'doublon_decision';

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

/** Employing institution (Grist table `Etablissements`). */
export interface Institution {
  id: number;   // Grist rowId — value of the Annuaire's `Employeur` Reference column
  name: string; // `Employeur` column (label)
  uai: string;  // `UAI` column
  ror: string;  // `ROR` column
  idref: string; // `idref` column — IdRef PPN of the corporate body (ABES export, 510 employer)
  label: string; // `Libelle` column — long form (e.g. « Nantes Université »), otherwise `Employeur`
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

export const fromGristDate = (rawDate: any): string => {
  if (!rawDate) return '';
  if (typeof rawDate === 'number') {
    // Grist sometimes returns a timestamp (seconds)
    try {
      return new Date(rawDate * 1000).toISOString().split('T')[0];
    } catch {
      return '';
    }
  }
  if (typeof rawDate === 'string') {
    const parts = rawDate.split(/[-/]/);
    if (parts.length === 3) {
      // If it is in DD-MM-YYYY format, convert to YYYY-MM-DD
      if (parts[0].length === 2 && parts[2].length === 4) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return rawDate;
    }
  }
  return String(rawDate);
};

export const AFFILIATION_START_COL = 'affiliation_start_date';

export const AFFILIATION_END_COL = 'affiliation_end_date';

/** Membership type (Grist Choice: stat_mmb / assoc_mmb / second_mmb / visit_mmb, created on 2026-09-14). */
export const MEMBERSHIP_TYPE_COL = 'membership_type';

export const toMembershipType = (v: any): MembershipType | undefined =>
  (MEMBERSHIP_TYPES as string[]).includes(String(v || '').trim()) ? (String(v).trim() as MembershipType) : undefined;

/** Reads a fuzzy-date cell (epoch seconds, canonical text, or legacy DD-MM-YYYY text) → canonical
 * fuzzy date, `''` when empty or unreadable. */
export const fromGristFuzzyDate = (raw: any): string => normalizeFuzzyDate(raw) ?? fromGristDate(raw);

/**
 * Decodes a V2 multi-label field such as `Valeur[fr]|Autre[en]`.
 * Returns the value in the preferred language (fr by default), otherwise the first one.
 */
export const parseMultiLabel = (raw: any, preferLang = 'fr'): string => {
  if (!raw || typeof raw !== 'string') return '';
  const parts = raw.split('|').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  const parsed = parts.map(p => {
    const m = p.match(/^(.*?)\s*\[([a-zA-Z]{2})\]\s*$/);
    return m ? { value: m[1].trim(), lang: m[2].toLowerCase() } : { value: p, lang: '' };
  });
  const preferred = parsed.find(p => p.lang === preferLang);
  return (preferred || parsed[0]).value;
};

/**
 * Decodes the TUTELLES (institutions) part of the V2 `participations` field:
 *   `uai-0442953W[main_supervision][20000101-]|uai-0353074B[associated_supervision][...]`
 * Keeps ONLY the institution refs (`uai-`/`ror-`), not the participations in
 * other research structures (`local-`, see parseStructureParticipations).
 */
export const parseParticipations = (raw: any): { codes: string[]; pipe: string } => {
  if (!raw || typeof raw !== 'string') return { codes: [], pipe: '' };
  const codes = raw.split('|')
    .map(p => p.trim())
    .filter(Boolean)
    .filter(p => !/^local-/i.test(p))
    .map(p => p.split('[')[0].trim().replace(/^uai-/i, ''))
    .filter(Boolean);
  return { codes, pipe: codes.join('|') };
};

/**
 * Decodes the PARTICIPATIONS in other research structures (`local-<local_id>` refs)
 * of the V2 `participations` field — e.g. the weak membership of a lab in a pole.
 * Returns the bare local_ids (without the `local-` prefix) and their `|` join.
 */
export const parseStructureParticipations = (raw: any): { localIds: string[]; pipe: string } => {
  if (!raw || typeof raw !== 'string') return { localIds: [], pipe: '' };
  const localIds = raw.split('|')
    .map(p => p.trim())
    .filter(Boolean)
    .filter(p => /^local-/i.test(p))
    .map(p => p.split('[')[0].trim().replace(/^local-/i, ''))
    .filter(Boolean);
  return { localIds, pipe: localIds.join('|') };
};

/**
 * Derives the Druid level (StructureLevel) from generic_type + V2 type.
 * The `type` (UMR/UR/ER/UFR/POLE/EPE…) carries the RNSR level; `generic_type`
 * (institution/unit/team) is not enough (it put every unit at level 2).
 * institution (4)  : generic_type=institution, or type EPE/GE
 * intermediate (3) : UFR, POLE (faculties / grouping poles)
 * team (1)         : generic_type=team or type TEAM (internal teams of the
 * labs, Structures table = druid-biblio source of truth),
 * or type ER (RNSR research team)
 * unit (2)         : UMR, UR, … (default)
 */
export const deriveStructureLevel = (genericType: any, type?: any): string => {
  const gt = String(genericType || '').toLowerCase();
  const t = String(type || '').toUpperCase();
  if (gt === 'institution' || t === 'EPE' || t === 'GE') return '4';
  if (gt === 'team' || t === 'TEAM' || t === 'ER') return '1';
  if (t === 'UFR' || t === 'POLE') return '3';
  return '2';
};

/** V2 `main_mission`/`secondary_missions` (texte) -> StructureMission Druid. */
export const missionFromV2 = (raw: any): string | null => {
  const v = String(raw || '').toLowerCase();
  if (!v) return null;
  if (v.includes('research') || v.includes('recherche')) return 'RECHERCHE';
  if (v.includes('scient')) return 'SERVICES_SCIENTIFIQUES';
  if (v.includes('admin')) return 'SERVICES_ADMINISTRATIFS';
  return 'RECHERCHE';
};

/** `YYYYMMDD` (compact V2 format) -> `YYYY-MM-DD` (empty if invalid). */
export const compactToIso = (d: any): string => {
  const s = String(d || '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
};

export const SUPERVISION_CODES = new Set(['main_supervision', 'associated_supervision', 'participating_supervision']);

/**
 * Decodes a V2 membership column (`inclusions` or `participations`) into Membership[].
 * Grammar of an entry: `<refType>-<ref>[<supervision>]?[<YYYYMMDD>-<YYYYMMDD>?]?`
 * refType ∈ local|uai|ror; a bare local_id (no prefix) is treated as `local`.
 * The brackets hold either a supervision code or a date range.
 */
export const parseMembershipList = (raw: any): Membership[] => {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split('|').map(p => p.trim()).filter(Boolean).map((entry): Membership => {
    const refPart = entry.split('[')[0].trim();
    const m = refPart.match(/^(local|uai|ror)-(.+)$/i);
    const refType = (m ? m[1].toLowerCase() : 'local') as Membership['refType'];
    const ref = m ? m[2] : refPart;
    let supervision: Membership['supervision'] = '';
    let startDate = '';
    let endDate = '';
    const brackets = entry.match(/\[([^\]]*)\]/g) || [];
    for (const b of brackets) {
      const inner = b.slice(1, -1).trim();
      if (SUPERVISION_CODES.has(inner)) {
        supervision = inner as Membership['supervision'];
      } else {
        const dm = inner.match(/^(\d{8})?-(\d{8})?$/);
        if (dm) { startDate = compactToIso(dm[1] || ''); endDate = compactToIso(dm[2] || ''); }
      }
    }
    return { refType, ref, supervision, startDate, endDate };
  });
};

/**
 * Annuaire rows → Druid researchers (moved verbatim from `GristService.fetchResearchers`, migration plan
 * lot 1): one researcher per row, qualified multi-row people grouped on their PRINCIPAL row, public ids
 * assigned, Zod-validated. `institutions` = raw `Etablissements` records (employer label and UAI),
 * `ldapCache` = content of ldap_status_cache.json keyed by uid (`{}` on an instance without LDAP). Pure.
 */
export function mapAnnuaireRecords(records: GristRecord[], institutions: GristRecord[], ldapCache: Record<string, any>): Researcher[] {
  if (!records || records.length === 0) return [];
  // No LDAP cache (instance without LDAP, test instance, sync never run): an uid missing from it
  // proves nothing — presence then comes from the dates and validations only.
  const ldapAvailable = Object.keys(ldapCache).length > 0;
  const institutionsMap: Record<number, string> = {};
  const institutionsUaiMap: Record<number, string> = {};
  institutions.forEach((r: any) => {
    institutionsMap[r.id] = r.fields['Employeur'] || `Etab ${r.id}`;
    institutionsUaiMap[r.id] = r.fields['UAI'] || '';
  });

  const researchersMapped = records.map((record: any) => {
    const fields = record.fields;
    const uid = fields['uid_dyna'];
    const employerId = fields['Employeur'];
    // Grist Reference column: an empty cell is 0 (not null) → no
    // employer, we display empty rather than « ID: 0 ».
    const employerName = (typeof employerId === 'number')
      ? (employerId === 0 ? '' : (institutionsMap[employerId] || `ID: ${employerId}`))
      : (employerId || '');

    // Three axes (lib/presence.ts, docs/plan-statut-employeur-ldap.md): employer, LDAP account and
    // presence. The uid only says whether there is an LDAP account to read (`ext_` = none).
    const employerUai = (typeof employerId === 'number') ? institutionsUaiMap[employerId] : '';
    // Known employer ≠ Nantes Université (INSERM, CNRS, Centrale…): the LDAP account is a hosted one —
    // its state, category and corps describe the account, not the job.
    const externalEmployer = isExternalEmployer(employerName, employerUai);
    const employerKind = employerKindOf(employerName, employerUai);
    const ldapEntry = uid ? ldapCache[uid] : undefined;
    const ldapEtat: string | undefined = ldapEntry === undefined ? undefined : (typeof ldapEntry === 'string' ? ldapEntry : ldapEntry.etat);
    const hasRealUid = typeof uid === 'string' && !!uid && !uid.startsWith('ext_');
    const ldapAccount = ldapAccountOf(uid, ldapEtat);

    const gristCiv = fields['Civilite'] || fields['Civilité'] || '';
    let ldapCiv = '';
    if (uid && ldapCache[uid] && (ldapCache[uid] as any).civilite) {
      ldapCiv = (ldapCache[uid] as any).civilite;
    }
    
    // LDAP first, otherwise Grist
    let researcherCivility = normalizeCivility(ldapCiv || gristCiv);

    // External employer: the LDAP category and corps describe the hosted account (« CDI
    // UNIVERSITE », generic corps → « IR ») and not the actual job → keep the Grist values.
    const ldapCategory: string = (!externalEmployer && uid && ldapCache[uid] && (ldapCache[uid] as any).categorie)
      ? (ldapCache[uid] as any).categorie
      : '';

    const ldapEmpCorps: string = (!externalEmployer && uid && ldapCache[uid] && (ldapCache[uid] as any).empCorps)
      ? (ldapCache[uid] as any).empCorps
      : '';
    // LDAP corps transposed to an emeritus code when dynaCategorie says emeritus (see lib/emeritus.ts).
    const ldapGrade: string | null = ldapGradeFor(ldapCategory, ldapEmpCorps, fields['Corps_grade']);

    const ldapEppn: string = (uid && ldapCache[uid] && (ldapCache[uid] as any).eppn)
      ? (ldapCache[uid] as any).eppn
      : '';

    let researcherBirthDate = fromGristDate(fields['DATE_DE_NAISSANCE_JJ_MM_AAAA']);
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
    // DREM, CREM) even if Grist is not normalized yet; retired without emeritus status ⇒ Parti.
    const baseGrade: string = ldapGrade ?? fields['Corps_grade'] ?? '';
    const emeritusSignals: EmeritusSignals = {
      grade: baseGrade, typeEmploi: fields['TYPE_EMPLOI'], libTypeEmploi: fields['LIB_TYPE_EMPLOI'], ldapCategory,
    };
    const finalGrade = resolveGrade(baseGrade, emeritusSignals);

    // Reliability layer: a validation covering the status sets the presence (INTERNE / EXTERNE, written
    // before 2026-10-07, read as PRESENT). `derivedPresence` = without it, to flag a conflict.
    const validation = parseValidation(fields, fromGristDate);
    const presenceInput: PresenceInput = {
      employer: employerKind, hasRealUid: hasRealUid && ldapAvailable, ldapEtat,
      employmentEnd: fromGristFuzzyDate(fields['employment_end_date']),
      membershipEnd: fromGristFuzzyDate(fields[AFFILIATION_END_COL]),
      retireeWithoutEmeritus: isRetireeWithoutEmeritus(emeritusSignals),
    };
    const derivedPresence = derivePresence(presenceInput);
    const validatedPresence = validation.validated && validation.validationScope.includes('statut')
      ? presenceFromValidated(fields['validated_status']) : undefined;
    const presence = derivePresence({ ...presenceInput, validated: validatedPresence });

    return {
      id: '',                 // filled after the map (real uid, otherwise ext_<name>-<initial>) — see assignPublicIds
      gristRowId: record.id,  // technical key for Grist writes
      uid: uid || '',
      civility: researcherCivility,
      lastName: fields['Nom'] || '',
      firstName: fields['Prenom'] || '',
      displayName: `${fields['Nom']?.toUpperCase()} ${fields['Prenom']}`,
      photoUrl: fields['photo_url'] || '',
      annuaireUrl: fields['annuaire_url'] || '',
      email: fields['Email'] || '',
      eppn: ldapEppn,
      hrId: normalizeHrId(fields[HR_ID_COLUMN]),
      nationality: fields['Nationalite'] || '',
      birthDate: researcherBirthDate,
      status: legacyStatus(presence, employerKind, ldapAccount),
      derivedStatus: legacyStatus(derivedPresence, employerKind, ldapAccount),
      presence,
      derivedPresence,
      ldapAccount,
      employerKind,
      employment: {
        employer: employerName,
        institutionId: (typeof employerId === 'number') ? (institutionsUaiMap[employerId] || '') : '',
        contractType: ldapCategory || fields['TYPE_EMPLOI'] || '',
        grade: finalGrade,
        ldapFields: [
          ...(ldapCategory ? ['contractType'] : []),
          ...(ldapGrade !== null ? ['grade'] : []),
        ],
        internalTypology: fields['LIB_TYPE_EMPLOI'] || '',
        startDate: fromGristFuzzyDate(fields['employment_start_date']),
        endDate: fromGristFuzzyDate(fields['employment_end_date']),
        // Optional columns (lib/fte.ts): absent or empty → null, a real 0 is kept.
        fte: parseFteCell(fields[FTE_COLUMNS.fte]),
        researchFte: parseFteCell(fields[FTE_COLUMNS.researchFte]),
      },
      affiliations: [{
        structureName: fields['LABO'] || '',
        team: fields['team'] || '',
        // Membership dates in the row's lab/team (affiliation_start/end_date columns, created on
        // 2026-09-14), distinct from the employment dates (employment_start/end_date, « Emploi » card).
        startDate: fromGristFuzzyDate(fields[AFFILIATION_START_COL]),
        endDate: fromGristFuzzyDate(fields[AFFILIATION_END_COL]),
        membershipType: toMembershipType(fields[MEMBERSHIP_TYPE_COL]),
        isPrimary: true
      }],
      ldapFields: [...(birthDateFromLdap ? ['birthDate'] : [])],
      // `groupes` column (names separated by « | ») — missing until
      // scripts/add_groups_column.cjs has been applied → no group.
      groups: String(fields['groupes'] || '')
        .split('|')
        .map((g: string) => g.trim())
        .filter(Boolean),
      identifiers: {
        orcid: fields['ORCID'] || '',
        idref: fields['IdRef'] || '',
        halId: fields['IdHAL'] || '',
        halIdNum: fields['IdHAL_i'] ? String(fields['IdHAL_i']) : '',   // filled by scripts/sync_hal.cjs (verify) or the Grist review
        scopusId: fields['ID_SCOPUS'] ? String(fields['ID_SCOPUS']) : '',   // Numeric column in Grist → string (Zod schema)
        openalexId: fields['openalex_author_id'] || '',
        openalexIds: fields['OpenAlex_ids'] || '',   // reviewed list (scripts/sync_openalex.cjs + Grist review)
      },
      // Declared public social media accounts (media monitoring),
      // editable from the record; columns created in phase 2 of media monitoring.
      socials: {
        bluesky: fields['Bluesky'] || '',
        mastodon: fields['Mastodon'] || '',
        youtube: fields['YouTube'] || '',
        podcast: fields['Podcast_flux'] || '',
        blog: fields['Blog'] || '',
        linkedin: fields['LinkedIn'] || '',
      },
      // Academic profiles & public CVs (Grist Annuaire columns).
      profiles: {
        cvInstitutionnel: fields['CV_institutionnel'] || '',
        cvSiteLabo: fields['CV_site_labo'] || '',
        cvPdf: fields['CV_pdf_docx_'] || '',
        cvHal: fields['CV_HAL'] || '',
        academia: fields['Academia'] || '',
        researchgate: fields['Researchgate'] || '',
        googleScholar: fields['Profil_GS'] || '',
        website: fields['Site_web'] || '',
      },
      nuFields: {
        pole: fields['Pole_de_rattac'] || getPoleFromLab(fields['LABO']),
        composante: fields['Composante_de_'],
        location: fields['Localisation_S'],
        doctoralSchool: fields['ED_de_rattache'],
        hdr: fields['HDR'] === 'OUI',
        hdrYear: fields['ANNEE_HDR'],
      },
      validation,
      lastSync: new Date().toISOString().split('T')[0],
    };
  });

  // Qualified multi-affiliations (`rattachement` column): a single record per person,
  // carried by the PRINCIPAL row, the other rows becoming memberships.
  const rowRole: Record<number, RattachementRole | ''> = {};
  const rowEnd: Record<number, string> = {};
  for (const record of records) {
    rowRole[record.id] = (String(record.fields[RATTACHEMENT_COL] || '').trim().toUpperCase() as RattachementRole) || '';
    rowEnd[record.id] = fromGristFuzzyDate(record.fields[AFFILIATION_END_COL]) || fromGristFuzzyDate(record.fields['employment_end_date']);
  }
  const researchersGrouped = groupQualifiedRows(researchersMapped, rowRole, rowEnd);

  // Public/central identifier: real uid (uid_dyna) when present, otherwise ext_<name>-<initial>.
  // The Grist rowId (gristRowId) stays internal for writes. See useUrlState / updateResearcher.
  assignPublicIds(researchersGrouped);

  const validation = ResearcherListSchema.safeParse(researchersGrouped);
  if (!validation.success) {
    console.warn('Zod Validation Warning (Researchers):', validation.error.format());
  }

  const researchers = (validation.success ? validation.data : researchersGrouped) as Researcher[];
  return researchers;
}

/**
 * Structures rows (V2 table, mirror of the directory bridge structures.csv) → Druid structures, parents
 * derived from the inclusions (moved verbatim from `GristService.fetchStructures`). Pure.
 */
export function mapStructureRecords(records: GristRecord[]): Structure[] {
  if (!records || records.length === 0) return [];
  const structuresMapped = records.map((record: any) => {
    const fields = record.fields;
    // Supervising institutions: V2 `participations` field -> bare UAI codes (V1 `tutelles` equivalent).
    const { codes: tutelleCodes, pipe: institutionCodes } = parseParticipations(fields['participations']);
    const supervisors = tutelleCodes.map((uai: string) => getTutelleName(uai));
    // Participations in other research structures (`local-` refs): bare local_ids.
    const { pipe: structureParticipations } = parseStructureParticipations(fields['participations']);
    const acronym = parseMultiLabel(fields['short_labels']);

    return {
      id: `S-${record.id}`,
      localId: String(fields['local_id'] || ''),
      level: deriveStructureLevel(fields['generic_type'], fields['type']),
      nature: 'PUBLIC',
      type: fields['type'] || '',
      acronym,
      officialName: parseMultiLabel(fields['long_labels']),
      description: parseMultiLabel(fields['descriptions']),
      cluster: getPoleFromLab(acronym) || '',
      parentStructure: String(fields['parent_structure'] || ''), // fallback, overridden by withDerivedParents()
      structureParticipations,
      // Structured memberships (edited in the « Appartenances » tab)
      inclusions: parseMembershipList(fields['inclusions']),
      participations: parseMembershipList(fields['participations']),
      code: String(fields['nns'] || ''),
      rnsrId: String(fields['nns'] || ''),
      status: 'ACTIVE',
      historyLinks: [],
      primaryMission: missionFromV2(fields['main_mission']) || 'RECHERCHE',
      secondaryMission: missionFromV2(fields['secondary_missions']),
      scientificDomains: [],
      ercFields: [],
      director: '',
      supervisors,
      institutionCodes,
      rawParticipations: fields['participations'] || '',
      doctoralSchools: [],
      address: '',
      zipCode: '',
      city: '',
      country: 'FR',
      website: fields['web'] || '',
      rorId: String(fields['ror'] || ''),
      halCollectionUrl: fields['hal_collection'] || '',
      identifiers: {
        halStructIds: [],
        // `idref` column (PPN of the corporate body record, created on 2026-09-11 for
        // l'export ABES — docs/plan-export-abes-idref.md, lot 0).
        idrefId: String(fields['idref'] || ''),
        scopusId: String(fields['scopus'] || ''),
        uai: String(fields['uai'] || ''),
        isni: String(fields['isni'] || ''),
        wikidata: String(fields['wikidata'] || ''),
      },
      signature: fields['signature'] || '',
      ercField: fields['erc_research_field'] || '',
      hceresAreas: fields['hceres_research_areas'] || '',
      campus: fields['campus'] || '',
    };
  });

  const validation = StructureListSchema.safeParse(structuresMapped);
  if (!validation.success) {
    console.warn('Zod Validation Warning (Structures):', validation.error.format());
  }
  
  // Hierarchical parent read from the inclusions (« Appartenances » tab), the stored
  // `parent_structure` column being only a fallback — see lib/structureHierarchy.ts.
  const structures = withDerivedParents(validation.success ? (validation.data as Structure[]) : (structuresMapped as Structure[]));
  return structures;
}

/** Etablissements rows → employing institutions, sorted by name, first row per name kept. Pure. */
export function mapInstitutionRecords(records: GristRecord[]): Institution[] {
  const all = (records || [])
    .map((r: any): Institution => ({
      id: r.id,
      name: r.fields['Employeur'] || '',
      uai: r.fields['UAI'] || '',
      ror: String(r.fields['ROR'] || ''),
      idref: String(r.fields['idref'] || ''),
      label: String(r.fields['Libelle'] || r.fields['Employeur'] || ''),
    }))
    .filter((e: Institution) => e.name)
    .sort((a: Institution, b: Institution) => a.name.localeCompare(b.name, 'fr') || a.id - b.id);
  // Defensive deduplication by label (the table once held a duplicated import —
  // cleaned up on 2026-07-07): the first row per name is kept.
  const seen = new Set<string>();
  return all.filter((e: Institution) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

/** Row of the merge log (`Fusions_log` table). */
export interface MergeLogEntry {
  id: number;
  uid_dyna: string;
  Nom: string;
  kept_rowid: number;
  dropped_rowid: number;
  auteur: string;
  date: string;
  note: string;
  restaure: boolean;
  restored_rowid: number | null;
}

/** Fusions_log rows → merge log, most recent first, `limit` entries (moved from GristService.listMerges). Pure. */
export function mapMergeLogRecords(records: GristRecord[], limit: number): MergeLogEntry[] {
  return records
    .map((r: any) => ({
      id: r.id, uid_dyna: r.fields.uid_dyna || '', Nom: r.fields.Nom || '',
      kept_rowid: r.fields.kept_rowid, dropped_rowid: r.fields.dropped_rowid,
      auteur: r.fields.auteur || '', date: r.fields.date || '', note: r.fields.note || '',
      restaure: !!r.fields.restaure, restored_rowid: r.fields.restored_rowid ?? null,
    }))
    .sort((a: MergeLogEntry, b: MergeLogEntry) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

/** ABES export fingerprint of a record already sent (druid-internal docs/plan-export-abes-idref.md). */
export interface AbesExportMark {
  /** uid_dyna, or `g<rowId>` for a row without uid. */
  key: string;
  hash: string;
  date: string;
}

/** Annuaire rows → fingerprints of the rows already sent to ABES (`ABES_export_hash` / `ABES_export_date`,
 * absent columns ⇒ none) — moved from GristService.fetchAbesSent. Pure. */
export function mapAbesExportMarks(records: GristRecord[]): AbesExportMark[] {
  const out: AbesExportMark[] = [];
  for (const r of records || []) {
    const f = r.fields || {};
    const hash = String(f['ABES_export_hash'] || '');
    if (!hash) continue;
    out.push({ key: f['uid_dyna'] || `g${r.id}`, hash, date: String(f['ABES_export_date'] || '') });
  }
  return out;
}
