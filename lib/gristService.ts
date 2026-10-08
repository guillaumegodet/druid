import { t } from '@lingui/core/macro';
import { Researcher, ResearcherStatus, Structure, StructureLevel } from '../types';
import { purgeStoredDirectory } from './directoryStorage';
import { getGradeFromNcorps } from './gradeTypology';

import { ValidationInfo } from './validation';

// --- LDAP sync: diff structures (Phase 1, read only) ---

import { PARKING_LABOS, LdapDuplicateKind } from './mergeProposal';
import { statusFromEtat } from './ldapPerson';

import { DirectoryApi } from './directoryApi';
import { computeDuplicateGroups, DuplicateGroup, DuplicatesDiff } from './directory/duplicates';
import type { LdapDiff, LdapCandidatesDiff, LdapResolved, StructuresLdapDiff } from './directory/ldap';
// Alignments (types, pure computations, unified view) moved to lib/directory/alignments.ts (migration plan, lot 2 e),
// re-exported for the existing importers.
export * from './directory/alignments';
import type { AlignCandidate, AlignMode, IdrefCandidate, ReviewDecision, UnifiedAlignDiff, UnifiedAlignSource, UnifiedArbitrateDecision } from './directory/alignments';
import { UNIFIED_ALIGN_SOURCES } from './directory/alignments';
import { localizeAlignTokens } from './directory/alignTexts';
import { i18nAlignTexts } from './alignTextsI18n';
// LDAP types moved to lib/directory/ldap.ts (migration plan, lot 2 d), re-exported for the existing importers.
export type {
  LdapFieldChange, LdapDiff, StructuresLdapDiff, LdapCandidateMatch, LdapCandidate, LdapAmbiguous, LdapResolved, LdapCandidatesDiff,
} from './directory/ldap';
// Moved to lib/directory/duplicates.ts (migration plan, lot 2 c), re-exported for the existing importers.
export { computeDuplicateGroups };
export type { DuplicateGroup, DuplicatesDiff };
import { RATTACHEMENT_COL, RattachementRole, DUPLICATE_DECISION_COL, Institution, MergeLogEntry, fromGristDate } from './directory/gristMapping';
// Moved to lib/directory/gristMapping.ts (migration plan, lot 1), re-exported for the existing importers.
export { RATTACHEMENT_COL, groupQualifiedRows } from './directory/gristMapping';
export type { RattachementRole, Institution, MergeLogEntry } from './directory/gristMapping';
import { AnnuaireColumnMeta, planAffiliationRows } from './directory/annuaireWrite';
import { makeLocalId } from './directory/structureWrite';
// Moved to lib/directory/annuaireWrite.ts / structureWrite.ts (migration plan, lots 2 a-b), re-exported for the
// existing importers.
export { resolveNewStructureLocalId } from './directory/structureWrite';
export { planAffiliationRows };
export type { AnnuaireColumnMeta, AffiliationRowPlan } from './directory/annuaireWrite';
export { PARKING_LABOS };
export type { LdapDuplicateKind };

// Every read and write of the directory goes through the domain API (lib/directoryApi.ts → /api/v1, druid-internal
// docs/plan-migration-postgresql.md, lot 2): this module no longer talks to Grist.

/** Qualification columns for multi-affiliations (duplicate merge plan, lot 1): lib/directory/gristMapping.ts. */
export { DUPLICATE_DECISION_COL };

/** Cache of the Annuaire columns (rarely changes). */
let _annuaireColumnsCache: AnnuaireColumnMeta[] | null = null;
async function fetchAnnuaireColumnsInternal(): Promise<AnnuaireColumnMeta[]> {
  if (_annuaireColumnsCache) return _annuaireColumnsCache;
  _annuaireColumnsCache = await DirectoryApi.annuaireColumns();
  return _annuaireColumnsCache!;
}






// Simple in-memory cache: the Etablissements table rarely changes.
let institutionsCache: Institution[] | null = null;

async function fetchInstitutionsInternal(): Promise<Institution[]> {
  if (institutionsCache) return institutionsCache;
  institutionsCache = await DirectoryApi.institutions();
  return institutionsCache;
}

// Cache of the directory and of the structures, in MEMORY only (plan-separation-test-prod-rssi.md, lot 7): it used
// to be kept in localStorage, i.e. on the disk of every browser that ever opened Druid, after the logout and for the
// other users of the same computer. It now lasts as long as the tab. One timestamp per cache: with a shared one, a
// successful structures refresh marked the researchers cache as fresh although its fetch had failed (review lot 2).
const memoryCache: { researchers?: { updatedAt: string; data: Researcher[] }; structures?: { updatedAt: string; data: Structure[] } } = {};
purgeStoredDirectory();

/** LDAP civility / free input → Grist Choice `Civilite` (F / M). A single definition: the LDAP
 * review, the LDAP diff and the attachment of LDAP candidates (which wrote a raw « Mme », review lot 2,
 * finding 2) doivent normaliser pareil. */
// --- Helpers for Grist <-> Druid date conversion ---

/** Sentinel id of a structure being created (« Nouvelle structure » page). */
export const NEW_STRUCTURE_ID = 'S-new';

// --- Helpers for the Structures V2 table format (= structures.csv of the directory bridge) ---




export const GristService = {
  /**
   * Researchers of the directory, mapped and filtered to the user's labs by the server (domain API
   * /api/v1/people, lib/directory/gristMapping.ts). The last good list is kept for the tab's lifetime and
   * served again when the API fails, as before. `force` is kept for the callers: the server checks the
   * document's modification date on every call.
   */
  fetchResearchers: async (_force = false): Promise<Researcher[]> => {
    try {
      const researchers = await DirectoryApi.people();
      memoryCache.researchers = { updatedAt: new Date().toISOString(), data: researchers };
      return researchers;
    } catch (error) {
      console.error('Directory API error (people):', error);
      return memoryCache.researchers?.data ?? [];
    }
  },

  /** Structures of the directory (domain API /api/v1/structures), same fallback as fetchResearchers. */
  fetchStructures: async (_force = false): Promise<Structure[]> => {
    try {
      const structures = await DirectoryApi.structures();
      memoryCache.structures = { updatedAt: new Date().toISOString(), data: structures };
      return structures;
    } catch (error) {
      console.error('Directory API error (structures):', error);
      return memoryCache.structures?.data ?? [];
    }
  },

  /** Employing institutions (record dropdown + name → rowId resolution). */
  fetchInstitutions: (): Promise<Institution[]> => fetchInstitutionsInternal(),

  /** New record (domain API POST /api/v1/people: fields built and scope checked by the server). */
  createResearcher: async (researcher: Researcher): Promise<void> => {
    await DirectoryApi.createPerson(researcher);
  },

  /** Saves a record and its memberships (domain API PUT /api/v1/people/:recordId: one Annuaire row per
   * membership, removed rows logged in Fusions_log — lib/directory/commands.ts). */
  updateResearcher: async (researcher: Researcher): Promise<void> => {
    // Grist writes go by row number (gristRowId); the public id (uid/ext_) does not allow it.
    // Fallback to the old `G-<rowId>` id format for caches possibly older than the uid pivot.
    const gristId = researcher.gristRowId
      ?? (researcher.id.startsWith('G-') ? parseInt(researcher.id.slice(2)) : NaN);
    if (!gristId || isNaN(gristId)) throw new Error(t`Invalid Grist ID (gristRowId missing)`);
    await DirectoryApi.updatePerson(gristId, researcher);
  },

  /**
   * Persists membership in functional groups (`groupes` column of the
   * Annuaire, names separated by « | »). Grouped PATCH by gristRowId on this
   * single column — does not touch the other fields of the records.
   */
  updateResearcherGroups: async (
    entries: Array<{ gristRowId: number; groups: string[] }>,
  ): Promise<void> => {
    const valid = entries.filter((e) => e.gristRowId && !Number.isNaN(e.gristRowId));
    if (valid.length === 0) return;
    await DirectoryApi.setGroups(valid.map((e) => ({ recordId: e.gristRowId, groups: e.groups })));
  },

  /**
   * Persists the confirmed OpenAlex author ID (name resolution of members
   * without ORCID, group dashboards). Single-column PATCH by gristRowId.
   */
  updateResearcherOpenalexId: async (gristRowId: number, openalexId: string): Promise<void> => {
    await DirectoryApi.setOpenalexId(gristRowId, openalexId);
  },

  /**
   * Applies a validation layer to several records in bulk (import of a
   * reliable list). Grouped PATCH on the validation columns only, by
   * gristRowId — does not touch the other fields of the record.
   */
  applyValidation: async (
    entries: Array<{ gristRowId: number; validation: ValidationInfo }>,
  ): Promise<void> => {
    const valid = entries.filter((e) => e.gristRowId && !Number.isNaN(e.gristRowId));
    if (valid.length === 0) return;
    await DirectoryApi.applyValidations(valid.map((e) => ({ recordId: e.gristRowId, validation: e.validation })));
  },

  /**
   * ABES export (docs/plan-export-abes-idref.md) — fingerprints of the rows already sent:
   * uid_dyna → { hash, date } (ABES_export_hash / ABES_export_date columns, created by
   * scripts/add_abes_columns.cjs; missing ⇒ empty object).
   */
  fetchAbesSent: async (): Promise<Record<string, { hash: string; date: string }>> => {
    const out: Record<string, { hash: string; date: string }> = {};
    for (const m of await DirectoryApi.abesExports()) out[m.key] = { hash: m.hash, date: m.date };
    return out;
  },

  /** Flags records as sent to ABES (fingerprint + date), by Grist row number. */
  markAbesSent: async (entries: Array<{ gristRowId: number; hash: string }>, date: string): Promise<number> => {
    const valid = entries.filter((e) => e.gristRowId && !Number.isNaN(e.gristRowId));
    if (valid.length === 0) return 0;
    return DirectoryApi.markAbesSent(valid.map((e) => ({ recordId: e.gristRowId, hash: e.hash })), date);
  },

  /** Local id generated for a new structure without entity code (lib/directory/structureWrite.ts). */
  makeLocalId: (structure: Pick<Structure, 'level' | 'acronym' | 'parentStructure'>): string => makeLocalId(structure),

  /** Blank structure for the creation page (sentinel id `S-new`). */
  blankStructure: (init: Partial<Structure> = {}): Structure => ({
    id: NEW_STRUCTURE_ID,
    localId: '',
    level: StructureLevel.ENTITE,
    nature: 'PUBLIC' as any,
    type: '',
    acronym: '',
    officialName: '',
    description: '',
    cluster: '',
    parentStructure: '',
    structureParticipations: '',
    inclusions: [],
    participations: [],
    code: '',
    rnsrId: '',
    status: 'ACTIVE' as any,
    historyLinks: [],
    primaryMission: 'RECHERCHE' as any,
    secondaryMission: undefined,
    scientificDomains: [],
    ercFields: [],
    director: '',
    supervisors: [],
    institutionCodes: '',
    doctoralSchools: [],
    address: '', zipCode: '', city: '', country: 'FR',
    website: '', rorId: '', halCollectionUrl: '',
    identifiers: { halStructIds: [], idrefId: '', scopusId: '', uai: '', isni: '', wikidata: '' } as any,
    ...init,
  } as Structure),

  /**
   * Creates a structure (« Nouvelle structure » page): domain API POST /api/v1/structures — local_id, team
   * inclusion and uniqueness decided by the server against every structure (lib/directory/structureWrite.ts).
   * Returns the Druid id `S-<rowId>`. `_allStructures` is kept for the callers.
   */
  createStructure: async (structure: Structure, _allStructures: Structure[] = []): Promise<string> =>
    DirectoryApi.createStructure(structure),

  updateStructure: async (structure: any): Promise<void> => {
    const gristId = parseInt(structure.id.replace('S-', ''));
    if (isNaN(gristId)) throw new Error(t`Invalid ID`);
    await DirectoryApi.updateStructure(gristId, structure);
  },

  /**
   * Phase 1 (READ ONLY): computes the gap between the LDAP cache and the Annuaire table.
   * Writes NOTHING to Grist — serves as a review preview before a future application (Phase 2).
   */
  /** « Doublons » page (docs/archive/plan-reorganisation-sync-ldap.md, lot 3): uid_dyna groups computed
   * on the Annuaire alone — no LDAP run needed, unlike computeLdapDiff. */
  computeDuplicatesDiff: (): Promise<DuplicatesDiff> => DirectoryApi.duplicates(),

  /** LDAP review: diff computed by the server from the LDAP cache and the Annuaire (domain API, lot 2 d). */
  computeLdapDiff: (): Promise<LdapDiff> => DirectoryApi.ldapDiff(),

  /**
   * Phase 2: applies the selected LDAP updates to the Annuaire.
   * Writes only the LDAP-authoritative fields of the checked records + traceability
   * (Data_source += LDAP, LDAP_derniere_maj, LDAP_champs_modifies, dated line in Commentaires).
   * Creates NO record (decision: update only).
   */
  // ─── Merge of Annuaire rows (docs/archive/plan-fusion-doublons.md, lot 2) ────────────────

  /**
   * Qualifies a group of rows sharing a uid (lot 1):
   * - `concomitant` : the chosen row becomes PRINCIPAL, the others SECONDAIRE;
   * - `successif`   : the chosen row becomes PRINCIPAL, the others HISTORIQUE (+ `affiliation_end_date`, formerly `employment_end_date`
   * if provided and empty);
   * - `a_revoir`    : no role set, « A_REVOIR » decision stored to take the group out of the list.
   * Creates the columns on first use. Trace: `doublon_decision` = « <MODE> <date> <auteur> ».
   */
  qualifyDoublon: (args: {
    rowIds: number[]; principalRowId?: number; mode: 'concomitant' | 'successif' | 'a_revoir'; endDate?: string; author: string;
  }): Promise<{ updated: number }> => DirectoryApi.qualifyDuplicates(args),

  /** Removes the qualification of a group (roles and decision cleared) → it becomes a pending duplicate again. */
  unqualifyDoublon: (rowIds: number[]): Promise<{ updated: number }> => DirectoryApi.unqualifyDuplicates(rowIds),

  /** Annuaire columns (label, type, formula) — for the merge assistant. */
  fetchAnnuaireColumns: (): Promise<AnnuaireColumnMeta[]> => fetchAnnuaireColumnsInternal(),

  /** Raw Annuaire rows (unconverted Grist values) for given rowIds. */
  fetchAnnuaireRows: (rowIds: number[]): Promise<{ rowId: number; fields: Record<string, any> }[]> => DirectoryApi.recordRows(rowIds),

  /**
   * Moves a record to its LDAP uid (`annuaire_uid_ldap` task, docs/plan-statut-employeur-ldap.md,
   * lot 2): every row of `fromUid` (or the single row `rowId` of a record without uid) gets
   * `uid_dyna = toUid`, with a dated line in Commentaires keeping the former uid. Refused when a row
   * already carries `toUid` — that case is a merge.
   */
  switchAnnuaireUid: (args: { fromUid: string; rowId?: number; toUid: string; author: string }): Promise<{ updated: number }> =>
    DirectoryApi.switchUid(args),

  /** Institution labels (rowId → name) to display the Employeur column (Ref). */
  fetchInstitutionLabels: async (): Promise<Record<number, string>> => {
    const out: Record<number, string> = {};
    for (const e of await fetchInstitutionsInternal()) out[e.id] = e.name;
    return out;
  },

  /**
   * Merges two Annuaire rows: logs (JSON snapshot of the deleted row
   * + previous values of the fields modified on the kept row), PATCHes the kept
   * row, then deletes the other. Order chosen so that no data is lost
   * if a step fails: the log exists before any destructive write.
   */
  mergeAnnuaireRows: (args: {
    keepRowId: number; dropRowId: number; fields: Record<string, any>; author: string; note?: string;
  }): Promise<{ logId: number }> => DirectoryApi.mergeRows(args),

  /** Merge log, most recent first (domain API /api/v1/merges, institution right). */
  listMerges: (limit = 50): Promise<MergeLogEntry[]> => DirectoryApi.merges(limit),

  /**
   * Undoes a merge: recreates the absorbed row from its snapshot (new rowId —
   * the old one does not come back, Druid URLs use the uid) and restores the previous
   * values of the fields written on the kept row.
   */
  restoreFusion: (logId: number): Promise<{ restoredRowId: number }> => DirectoryApi.restoreMerge(logId),

  /** Applies the checked LDAP updates: the server recomputes the cells from its own diff (the ids only are sent). */
  applyLdapUpdates: (_diff: LdapDiff, selectedIds: string[]): Promise<{ updated: number }> => DirectoryApi.applyLdapUpdates(selectedIds),

  /**
   * « Mark as left » of the LDAP « Arrivals and departures » tab: on every Annuaire row of the uid,
   * statut_dyna = DEPART and employment / membership end = the date the account left (unless an
   * earlier end is already recorded) — both ends past ⇒ the record becomes « Parti »
   * (isDepartureCertain). LDAP traceability as in applyLdapUpdates. `accountLabel` describes the
   * account state for the dated comment line.
   */
  markLdapDeparted: (uid: string, date: string, accountLabel: string): Promise<{ updated: number }> =>
    DirectoryApi.markLdapDeparted(uid, date, accountLabel),

  /**
   * READ ONLY: reads the LDAP candidates cache (ldap_candidates_cache.json,
   * regenerated by /api/sync-ldap-candidates-trigger) and discards the records
   * attached since (uid_dyna filled in the meantime).
   */
  computeLdapCandidatesDiff: (): Promise<LdapCandidatesDiff> => DirectoryApi.ldapCandidates(),

  /**
   * Attaches records to their LDAP identity: writes `uid_dyna` (the pivot) and
   * fills `Civilite` / `Corps_grade` / birth date ONLY when the Grist cell is
   * empty (non-destructive), with LDAP traceability. Takes entries that are
   * ALREADY resolved (accepted proposal or arbitrated homonym).
   */
  /** Attaches the resolved entries: the server takes their LDAP identity from its candidates cache. */
  applyLdapCandidates: (entries: LdapResolved[]): Promise<{ updated: number; skippedDuplicates: { gristRowId: number; uid: string; existingRowId: number }[] }> =>
    DirectoryApi.applyLdapCandidates(entries.map((e) => ({ gristRowId: e.gristRowId, uid: e.ldap.uid }))),











  /**
   * READ ONLY: compares the LDAP structures cache (structures_ldap_cache.json,
   * key = supannCodeEntite) with the Grist Structures table (key local_id).
   * Classifies into: to update (type / name if empty / LDAP code), to create, orphans.
   */
  /** Unified alignment view: diff computed by the server (domain API, lot 2 e), its texts localized here. */
  computeUnifiedAlignDiff: async (sources: UnifiedAlignSource[] = UNIFIED_ALIGN_SOURCES, mode: AlignMode = 'search'): Promise<UnifiedAlignDiff> =>
    localizeAlignTokens(await DirectoryApi.alignmentsUnified(sources, mode), i18nAlignTexts),

  /** Applies the selection of the unified view: the server rebuilds the updates from its own diff. */
  applyUnifiedSelection: (selection: { mode: AlignMode; selected: string[]; chosen: Record<string, string>; decisions: Record<string, UnifiedArbitrateDecision> }): Promise<{ updated: number }> =>
    DirectoryApi.applyAlignSelection(selection),

  /** « Mettre à jour » of a replaced IdRef record (new PPN of the verify run). */
  applyIdrefRedirection: (rowId: string, ppn: string): Promise<{ updated: number }> => DirectoryApi.applyIdrefRedirection(rowId, ppn),

  /** « Mauvais candidat » / « Identité mêlée »: row of the source's review table (blacklist / ticket). */
  rejectUnifiedCandidate: (
    source: UnifiedAlignSource, row: { id: string; uid: string; displayName: string; labo?: string },
    candidate: AlignCandidate | IdrefCandidate, candidateCount = 1, decision: ReviewDecision = 'Rejeté', note = '',
  ): Promise<{ rejected: number; tableCreated: boolean }> =>
    DirectoryApi.rejectAlignCandidate({ source, row, candidate, candidateCount, decision, note }),

  computeStructuresLdapDiff: (): Promise<StructuresLdapDiff> => DirectoryApi.ldapStructures(),

  /** Applies the checked LDAP structure updates and creations (recomputed by the server from its diff). */
  applyStructuresLdapUpdates: (_diff: StructuresLdapDiff, updateIds: string[], createKeys: string[]): Promise<{ updated: number; created: number }> =>
    DirectoryApi.applyStructuresLdap(updateIds, createKeys),
};

/** Grist date conversion (epoch s) → ISO, exposed for display outside the service (merge assistant). */
export const gristDateToIso = fromGristDate;
