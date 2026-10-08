// Grist → Druid domain mapping of the directory (people, structures, institutions).
//
// Pure module, runnable in the browser, in Node (server.cjs, through the server-api.cjs bundle) and in the
// Cloudflare Functions: no network, no DOM, no Lingui macro. It used to live inside lib/gristService.ts,
// where the browser read the raw Grist rows through the /api/grist proxy; it moved here verbatim when the
// directory became readable through the domain API (/api/v1, druid-internal docs/plan-migration-postgresql.md,
// lot 1). gristService.ts imports the helpers it still needs for its writes from this module.
import { Researcher, Structure, Membership, MembershipType, MEMBERSHIP_TYPES } from '../../types';
import { getPoleFromLab } from '../mappings';
import { StructureListSchema } from '../schemas';
import { parseValidation } from '../validation';
import { normalizeFuzzyDate } from '../dates';
import { withDerivedParents } from '../structureHierarchy';
import { FTE_COLUMNS, parseFteCell } from '../fte';
import { HR_ID_COLUMN, normalizeHrId } from '../hrId';
import { getTutelleName } from '../uaiMapping';
import { DirectoryRow, EmployerIndex, RattachementRole, mapDirectoryRows } from './people';

/** A row as returned by the Grist REST API (`GET /tables/<table>/records`). */
export interface GristRecord {
  id: number;
  fields: Record<string, any>;
}

export const RATTACHEMENT_COL = 'rattachement';

// Business rules of the people (storage-independent since lot 6): re-exported for the existing importers.
export { RATTACHEMENT_CHOICES, assignPublicIds, groupQualifiedRows, slugForExtId } from './people';
export type { RattachementRole } from './people';

export const DUPLICATE_DECISION_COL = 'doublon_decision';

/** Employing institution (Grist table `Etablissements`). */
export interface Institution {
  id: number;   // Grist rowId — value of the Annuaire's `Employeur` Reference column
  name: string; // `Employeur` column (label)
  uai: string;  // `UAI` column
  ror: string;  // `ROR` column
  idref: string; // `idref` column — IdRef PPN of the corporate body (ABES export, 510 employer)
  label: string; // `Libelle` column — long form (e.g. « Nantes Université »), otherwise `Employeur`
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

/** Annuaire record → directory row (lib/directory/people.ts): Grist cells decoded, column ids resolved here. Pure. */
export function gristDirectoryRow(record: GristRecord): DirectoryRow {
  const fields = record.fields || {};
  return {
    rowId: record.id,
    uid: fields['uid_dyna'] || '',
    lastName: fields['Nom'] || '',
    firstName: fields['Prenom'] || '',
    civility: fields['Civilite'] || fields['Civilité'] || '',
    email: fields['Email'] || '',
    nationality: fields['Nationalite'] || '',
    photoUrl: fields['photo_url'] || '',
    annuaireUrl: fields['annuaire_url'] || '',
    birthDate: fromGristDate(fields['DATE_DE_NAISSANCE_JJ_MM_AAAA']),
    corpsGrade: fields['Corps_grade'] ?? null,
    employmentType: fields['TYPE_EMPLOI'] ?? null,
    employmentTypeLabel: fields['LIB_TYPE_EMPLOI'] ?? null,
    // Grist Reference column: an empty cell is 0 (not null).
    employer: fields['Employeur'] ?? null,
    employmentStart: fromGristFuzzyDate(fields['employment_start_date']),
    employmentEnd: fromGristFuzzyDate(fields['employment_end_date']),
    hrId: normalizeHrId(fields[HR_ID_COLUMN]),
    fte: parseFteCell(fields[FTE_COLUMNS.fte]),
    researchFte: parseFteCell(fields[FTE_COLUMNS.researchFte]),
    validation: parseValidation(fields, fromGristDate),
    validatedStatus: fields['validated_status'],
    lab: fields['LABO'] || '',
    team: fields['team'] || '',
    membershipStart: fromGristFuzzyDate(fields[AFFILIATION_START_COL]),
    membershipEnd: fromGristFuzzyDate(fields[AFFILIATION_END_COL]),
    membershipType: toMembershipType(fields[MEMBERSHIP_TYPE_COL]),
    role: (String(fields[RATTACHEMENT_COL] || '').trim().toUpperCase() as RattachementRole) || '',
    // `groupes` column (names separated by « | ») — missing until scripts/add_groups_column.cjs has been applied.
    groups: String(fields['groupes'] || '').split('|').map((g: string) => g.trim()).filter(Boolean),
    identifiers: {
      orcid: fields['ORCID'] || '',
      idref: fields['IdRef'] || '',
      halId: fields['IdHAL'] || '',
      halIdNum: fields['IdHAL_i'] ? String(fields['IdHAL_i']) : '',   // filled by scripts/sync_hal.cjs (verify) or the Grist review
      scopusId: fields['ID_SCOPUS'] ? String(fields['ID_SCOPUS']) : '',   // Numeric column in Grist → string (Zod schema)
      openalexId: fields['openalex_author_id'] || '',
      openalexIds: fields['OpenAlex_ids'] || '',   // reviewed list (scripts/sync_openalex.cjs + Grist review)
    },
    socials: {
      bluesky: fields['Bluesky'] || '', mastodon: fields['Mastodon'] || '', youtube: fields['YouTube'] || '',
      podcast: fields['Podcast_flux'] || '', blog: fields['Blog'] || '', linkedin: fields['LinkedIn'] || '',
    },
    profiles: {
      cvInstitutionnel: fields['CV_institutionnel'] || '', cvSiteLabo: fields['CV_site_labo'] || '', cvPdf: fields['CV_pdf_docx_'] || '',
      cvHal: fields['CV_HAL'] || '', academia: fields['Academia'] || '', researchgate: fields['Researchgate'] || '',
      googleScholar: fields['Profil_GS'] || '', website: fields['Site_web'] || '',
    },
    hdr: fields['HDR'],
    hdrYear: fields['ANNEE_HDR'],
  };
}

/** Etablissements records → employer index (name, UAI) by Grist row id. Pure. */
export const gristEmployerIndex = (institutions: GristRecord[]): EmployerIndex =>
  new Map((institutions || []).map((r: any) => [r.id, { name: r.fields['Employeur'] || `Etab ${r.id}`, uai: r.fields['UAI'] || '' }]));

/**
 * Annuaire rows → Druid researchers (business rules of lib/directory/people.ts). `institutions` = raw
 * `Etablissements` records (employer label and UAI), `ldapCache` = content of ldap_status_cache.json keyed by uid
 * (`{}` on an instance without LDAP). Pure.
 */
export function mapAnnuaireRecords(records: GristRecord[], institutions: GristRecord[], ldapCache: Record<string, any>): Researcher[] {
  return mapDirectoryRows((records || []).map(gristDirectoryRow), gristEmployerIndex(institutions), ldapCache);
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
