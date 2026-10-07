import { t } from '@lingui/core/macro';
import { Researcher, ResearcherStatus, Affiliation, Structure, Membership, MembershipType, MEMBERSHIP_TYPES, StructureLevel } from '../types';
import { getPoleFromLab } from './mappings';
import { hasCapability } from './auth';
import { purgeStoredDirectory } from './directoryStorage';
import { ResearcherListSchema, StructureListSchema } from './schemas';
import { getGradeFromNcorps } from './gradeTypology';
import { ldapGradeFor, resolveGrade, hasEmeritusTrace, isRetireeWithoutEmeritus, EmeritusSignals } from './emeritus';
import { parseValidation, validationToGristFields, ValidationInfo, isExternalEmployer } from './validation';
import { normalizeFuzzyDate, isFuzzyDatePast, fuzzyDateLowerBound, fuzzyDateUpperBound } from './dates';

// --- LDAP sync: diff structures (Phase 1, read only) ---

export interface LdapFieldChange {
  field: string;   // Grist column (Annuaire)
  label: string;   // human-readable label
  before: string;  // current Grist value
  after: string;   // value coming from LDAP
}

import { PARKING_LABOS, classifyDuplicate, LdapDuplicateKind } from './mergeProposal';
import { MERGE_LOG_TABLE, buildMergeLogColumns, buildMergeLogRow } from './mergeLog';
import { withDerivedParents } from './structureHierarchy';
import { gristDocUrl } from './instanceRuntime';
import { FTE_COLUMNS, parseFteCell, fteGristFields } from './fte';
import { STATUT_DYNA_MAP, statusFromEtat, normalizeCivility } from './ldapPerson';
import { HR_ID_COLUMN, normalizeHrId, hrIdCell, hrIdProposal } from './hrId';
import { derivePresence, employerKindOf, ldapAccountOf, legacyStatus, presenceFromValidated, PresenceInput } from './presence';
export { PARKING_LABOS };
export type { LdapDuplicateKind };

export interface LdapDiff {
  generatedAt: string;
  stats: {
    ldapTotal: number;
    gristTotal: number;
    aMettreAJour: number;
    /** Duplicate groups NOT yet qualified (pending). */
    doublonsUid: number;
    /** Qualified groups (declared multi-affiliation or « à revoir »). */
    qualifiedDuplicates?: number;
    /** Breakdown of unqualified groups by class (see `doublonsUid[].kind`). */
    duplicatesByKind?: Record<LdapDuplicateKind, number>;
    orphelins: number;
    ldapWithoutRecord: number;
  };
  /** Existing records (uid_dyna match) where ≥1 LDAP-authoritative field differs.
   * `validated`: the record carries a manual validation; `validationConflict`:
   * an LDAP change contradicts the validated status → to arbitrate, not to overwrite. */
  aMettreAJour: { id: string; uid: string; displayName: string; labo?: string; changes: LdapFieldChange[]; validated?: boolean; validationConflict?: boolean;
    /** The record holds another HR staff number than LDAP: unchecked by default (two people mixed up, or a wrong uid). */
    hrIdConflict?: boolean }[];
  /** Same uid_dyna on ≥2 Annuaire rows. `kind` classifies the group (see docs/archive/plan-fusion-doublons.md):
   * - same_labo  : every row carries the same LABO → probable duplicate, to merge;
   * - parking    : one row sits in a parking LABO (`zzz`, empty) → to absorb into the lab row;
   * - multi_labo : different LABOs → multi-affiliation (concurrent or successive) to qualify.
   * `ids`/`names` kept for compatibility; `rows` carries the per-row detail. */
  doublonsUid: {
    uid: string; ids: string[]; names: string[];
    kind: LdapDuplicateKind;
    /** Qualified (lot 1): exactly one PRINCIPAL row and every other one SECONDAIRE/HISTORIQUE,
     * or an « À revoir » decision recorded → leaves the list of duplicates to process. */
    qualified: boolean;
    decision: string;
    rows: { id: string; gristRowId: number; name: string; labo: string; validated: boolean; dataSource: string; role: RattachementRole | ''; endDate: string }[];
  }[];
  /** Grist record whose uid_dyna is missing from LDAP (probable departure).
   * `validated`: presence validated manually → do not conclude a departure without review. */
  orphelins: { id: string; uid: string; displayName: string; validated?: boolean }[];
  /** uids present in LDAP but missing from the Annuaire (creation in Phase 2) */
  ldapWithoutRecord: string[];
}

/** « Doublons » page: uid_dyna groups of the Annuaire, without LDAP (docs/archive/plan-reorganisation-sync-ldap.md, lot 3). */
export interface DuplicatesDiff {
  generatedAt: string;
  stats: { gristTotal: number; pending: number; qualified: number; parKind: Record<LdapDuplicateKind, number> };
  doublonsUid: LdapDiff['doublonsUid'];
}

/** Groups of Annuaire records sharing a uid_dyna (≥ 2 rows), classified (same_labo / parking /
 * multi_labo) and flagged `qualified` when the multi-affiliation is declared (exactly one
 * PRINCIPAL row, every other one SECONDAIRE/HISTORIQUE) or the decision is « A_REVOIR ». Pure
 * logic on raw Grist records — shared by computeLdapDiff and computeDuplicatesDiff. */
export function computeDuplicateGroups(records: any[]): { doublonsUid: LdapDiff['doublonsUid']; duplicatesByKind: Record<LdapDuplicateKind, number> } {
  const nameOf = (f: any) => `${(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim();
  const byUid: Record<string, any[]> = {};
  for (const rec of records) {
    const uid = rec.fields['uid_dyna'];
    if (uid) (byUid[uid] = byUid[uid] || []).push(rec);
  }
  const doublonsUid: LdapDiff['doublonsUid'] = [];
  const duplicatesByKind: Record<LdapDuplicateKind, number> = { same_labo: 0, parking: 0, multi_labo: 0 };
  for (const [uid, recs] of Object.entries(byUid)) {
    if (recs.length < 2) continue;
    const rows = recs.map((r) => {
      const v = parseValidation(r.fields, fromGristDate);
      return {
        id: `G-${r.id}`, gristRowId: r.id, name: nameOf(r.fields),
        labo: String(r.fields['LABO'] || '').trim(), validated: v.validated,
        dataSource: String(r.fields['Data_source'] || ''),
        role: ((String(r.fields[RATTACHEMENT_COL] || '').trim().toUpperCase() as RattachementRole) || '') as RattachementRole | '',
        endDate: fromGristFuzzyDate(r.fields[AFFILIATION_END_COL]) || fromGristFuzzyDate(r.fields['employment_end_date']),
      };
    });
    const kind = classifyDuplicate(rows.map((r) => r.labo));
    const decision = String(recs.map((r) => r.fields[DUPLICATE_DECISION_COL] || '').find(Boolean) || '');
    const qualified =
      (rows.filter((r) => r.role === 'PRINCIPAL').length === 1 && rows.every((r) => !!r.role))
      || decision.toUpperCase().startsWith('A_REVOIR');
    if (!qualified) duplicatesByKind[kind]++;
    doublonsUid.push({ uid, ids: rows.map((r) => r.id), names: rows.map((r) => r.name), kind, qualified, decision, rows });
  }
  // Probable duplicates first, then parking, then multi-affiliations; by name within each class
  const kindOrder: Record<LdapDuplicateKind, number> = { same_labo: 0, parking: 1, multi_labo: 2 };
  doublonsUid.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.names[0].localeCompare(b.names[0]));
  return { doublonsUid, duplicatesByKind };
}

/** Diff structures LDAP (supannEntite) ↔ table Grist Structures. */
export interface StructuresLdapDiff {
  generatedAt: string;
  stats: { ldapTotal: number; gristTotal: number; aMettreAJour: number; aCreer: number; orphelins: number };
  /** Existing structures (local_id match) to update (type / name if empty / LDAP code / parent) */
  aMettreAJour: { id: string; local_id: string; displayName: string; rattachement?: string; changes: LdapFieldChange[] }[];
  /** LDAP structures missing from Grist → to create */
  aCreer: { local_id: string; displayName: string; type: string; rattachement?: string; fields: Record<string, any> }[];
  /** Grist structures whose local_id is outside the LDAP scope (info) */
  orphelins: { id: string; local_id: string; displayName: string }[];
}

// --- IdRef alignment (idref_align_cache.json cache produced by scripts/sync_idref.cjs) ---

export interface IdrefCandidate {
  ppn: string;
  fullName: string;
  job?: string;
  birth?: string;
  death?: string;
  description?: string;
  orcid?: string;
  idhal?: string;
  isni?: string;
  gender?: string | null;
  /** Additive fields (ABES export, docs/plan-export-abes-idref.md) — missing from caches older than 2026-09-11. */
  nameIdref?: string;
  scopus?: string;
  externalIds?: Record<string, string[]>;
  affiliations?: { ppn: string; dates: string; label: string; qualifier?: string; rel?: string }[];
  notes?: string[];
}

/** Proposed write of an identifier (empty Grist cell only). */
export interface IdrefFieldProposal {
  field: 'IdRef' | 'ORCID' | 'IdHAL';
  label: string;
  after: string;
}

/** « Identité mêlée » row of a review table: remote profile mixing several people, to untangle at the source. */
export interface ReviewMixedItem { id: string; uid: string; displayName: string; labo?: string; candidateId: string; url: string; fullName: string; note: string; signaleLe: string }

export interface IdrefDiff {
  generatedAt: string;
  mode: 'search' | 'verify';
  stats: {
    cacheTotal: number;
    gristTotal: number;
    aRenseigner: number;
    ambigus: number;
    aEnrichir: number;
    aArbitrer: number;
    conflits: number;
    nonTrouves: number;
    redirections?: number;
  };
  /** Distinct labs (LABO column) of the Annuaire — feeds the UI structure filter. */
  labos?: string[];
  /** verify: the Annuaire's IdRef record was merged/replaced (301 to `newPpn`) → « Mettre à
   * jour » button that writes the new PPN. `candidate` = replacement record (if readable);
   * `confirmedOld` = the name mismatch had been validated on the old PPN (IdRef_nom_valide, to carry over). */
  redirections?: { id: string; uid: string; displayName: string; labo: string; group?: AlignGroup; ppn: string; newPpn: string; candidate?: IdrefCandidate; nameMismatch: boolean; confirmedOld: boolean }[];
  /** search: empty Grist IdRef + a single candidate → IdRef proposed (+ ORCID/IdHAL if empty).
   * matchedIds: identifiers already SHARED by the Grist record and the candidate (e.g. same ORCID)
   * → strong evidence it is the right person, highlighted for quick validation. */
  aRenseigner: { id: string; uid: string; displayName: string; labo: string; group?: AlignGroup; candidate: IdrefCandidate; proposals: IdrefFieldProposal[]; matchedIds?: string[] }[];
  /** search : plusieurs candidats → l'utilisateur arbitre */
  ambigus: { id: string; uid: string; displayName: string; labo: string; group?: AlignGroup; candidates: IdrefCandidate[] }[];
  /** verify: record re-read, matching name, ORCID/IdHAL missing from Grist → safe enrichment */
  aEnrichir: { id: string; uid: string; displayName: string; labo: string; group?: AlignGroup; ppn: string; candidate: IdrefCandidate; proposals: IdrefFieldProposal[]; matchedIds?: string[] }[];
  /** verify: unconfirmed name mismatch → arbitration workshop (confirm = same person / detach = wrong IdRef).
   * Enrichment (proposals) is held back until confirmed. suspect = no shared name token. */
  aArbitrer: { id: string; uid: string; displayName: string; labo?: string; group?: AlignGroup; ppn: string; notice: IdrefCandidate; grist: { orcid: string; idhal: string }; proposals: IdrefFieldProposal[]; suspect: boolean }[];
  /** info: Grist value ≠ record (matching name), or unreadable record — never overwritten */
  conflits: { id: string; uid: string; displayName: string; labo?: string; group?: AlignGroup; reason: string; detail: string; ppn?: string }[];
  /** info: no candidate found */
  nonTrouves: { uid: string; displayName: string; labo?: string; group?: AlignGroup }[];
  /** « Identité mêlée » tickets of the review table (info, to untangle at the source). */
  melees?: ReviewMixedItem[];
}

/** A concrete write decided by the UI: Grist fields → value. */
export interface IdrefUpdate {
  id: string;
  uid: string;
  displayName: string;
  fields: Record<string, string>; // ex. { IdRef: '028736036', ORCID: '0000-...' }
}

// --- ORCID / HAL / OpenAlex alignments (<source>_align_cache.json caches produced by
// scripts/sync_orcid.cjs, sync_hal.cjs, sync_openalex.cjs; see docs/archive/plan-alignement-orcid-hal.md and
// docs/archive/plan-alignement-openalex.md) ---------------------------------------------------------------
// OpenAlex differs: MULTI-VALUED target (OpenAlex_ids, pipe-separated A-ids) → a non-empty target is not
// a conflict, we ADD; a profile already in the list is never proposed again.

// Scopus (docs/plan-alignement-scopus.md): single-valued Numeric target `ID_SCOPUS`, same contract as
// ORCID (filled only when empty; an explicit text such as « absent » counts as filled).

export type AlignSource = 'orcid' | 'hal' | 'openalex' | 'scopus';
export type AlignMode = 'search' | 'verify';

/** Remote candidate (ORCID profile, HAL author profile or OpenAlex author profile), common shape for the UI. */
export interface AlignCandidate {
  /** Target identifier: ORCID (0000-…), idHal_s (slug) or OpenAlex A-id. */
  id: string;
  url: string;
  fullName: string;
  forms?: string[];
  /** strong = cross identifier already in the Annuaire; medium = Nantes affiliation; weak = homonym without evidence. */
  score?: 'fort' | 'moyen' | 'faible';
  evidence?: string[];
  /** Identifiers already shared by record and candidate (e.g. identical ORCID) — strong evidence. */
  matchedIds?: string[];
  /** Details shown under the name (HAL labs, ORCID employments, email domains…). */
  details?: string[];
  /** Suspected mixed identity (reasons) — signal computed by the script, never a decision (OpenAlex plan § 8.2). */
  suspect?: string[];
  /** ORCID: profile with no public data besides the name (orcid.org: « There's no displayable data for this record »). */
  emptyRecord?: boolean;
  ids: { orcid?: string; idhal?: string; idhalI?: string; idref?: string; scopus?: string; openalex?: string };
}

export interface AlignFieldProposal {
  field: 'ORCID' | 'ID_SCOPUS' | 'IdHAL' | 'IdHAL_i' | 'IdRef' | 'OpenAlex_ids';
  label: string;
  after: string;
}

export interface AlignDiff {
  source: AlignSource;
  mode: AlignMode;
  generatedAt: string;
  stats: { cacheTotal: number; gristTotal: number; aRenseigner: number; ambigus: number; aEnrichir: number; conflits: number; nonTrouves: number; sansAffiliation: number };
  labos?: string[];
  /** search: a single candidate kept → the identifier is proposed (+ secondary ones if empty).
   * OpenAlex: one row per strong profile (id `G-<row>#<A-id>`), `existing` = A-ids already in the list. */
  aRenseigner: { id: string; uid: string; displayName: string; labo: string; group?: AlignGroup; candidate: AlignCandidate; proposals: AlignFieldProposal[]; matchedIds?: string[]; score?: AlignCandidate['score']; existing?: string[] }[];
  /** search: several candidates → arbitration (radio; checkboxes for a multi-valued target). */
  ambigus: { id: string; uid: string; displayName: string; labo: string; group?: AlignGroup; candidates: AlignCandidate[]; existing?: string[] }[];
  /** verify: identifier verified, secondary cells empty → enrichment (IdHAL_i, ORCID, IdRef, ID_SCOPUS);
   * OpenAlex: fragments (profiles missing from the list) to add. */
  aEnrichir: { id: string; uid: string; displayName: string; labo: string; group?: AlignGroup; candidate: AlignCandidate; proposals: AlignFieldProposal[]; matchedIds?: string[]; score?: AlignCandidate['score']; existing?: string[] }[];
  /** info: unknown / invalid identifier, diverging name, Grist value ≠ profile — never overwritten. */
  conflits: { id: string; uid: string; displayName: string; labo?: string; group?: AlignGroup; reason: string; detail: string; candidate?: AlignCandidate; existing?: string[] }[];
  nonTrouves: { uid: string; displayName: string; labo?: string; group?: AlignGroup; existing?: string[] }[];
  /** « Identité mêlée » tickets of the review table (info, to untangle at the source). */
  melees?: ReviewMixedItem[];
}

/** Grist review table and identifier column per source (same names as in the scripts). */
export const ALIGN_SOURCE_META: Record<AlignSource, { label: string; table: string; idColumn: string; targetField: 'ORCID' | 'IdHAL' | 'OpenAlex_ids' | 'ID_SCOPUS'; multi?: boolean; cache: string; url: (id: string) => string }> = {
  orcid: { label: 'ORCID', table: 'Alignement_ORCID', idColumn: 'ORCID_candidat', targetField: 'ORCID', cache: '/orcid_align_cache.json', url: (id) => `https://orcid.org/${id}` },
  hal: { label: 'HAL', table: 'Alignement_HAL', idColumn: 'IdHAL_candidat', targetField: 'IdHAL', cache: '/hal_align_cache.json', url: (id) => `https://hal.science/search/index/q/*/authIdHal_s/${id}` },   // not cv.hal.science: only authors who created a HAL CV have a page there
  openalex: { label: 'OpenAlex', table: 'Alignement_OpenAlex', idColumn: 'OpenAlex_candidat', targetField: 'OpenAlex_ids', multi: true, cache: '/openalex_align_cache.json', url: (id) => `https://openalex.org/${id}` },
  scopus: { label: 'Scopus', table: 'Alignement_Scopus', idColumn: 'Scopus_candidat', targetField: 'ID_SCOPUS', cache: '/scopus_align_cache.json', url: (id) => `https://www.scopus.com/authid/detail.uri?authorId=${id}` },
};

/** Numeric Scopus Author ID of an ID_SCOPUS cell ('' when empty, 0, or an explicit text such as « absent »). */
export const scopusIdOf = (v: any): string => {
  const d = String(v ?? '').replace(/\D/g, '');
  return /^\d{6,12}$/.test(d) && String(v).trim() !== '0' ? d : '';
};

/** A-ids of an OpenAlex_ids cell (pipe-separated, tolerates URLs / commas), deduplicated, order kept. */
export const parseOpenalexIds = (v: any): string[] => {
  const out: string[] = [];
  for (const x of String(v || '').split(/[|,;\s]+/)) {
    const m = x.match(/(A\d{4,})/i);
    if (m && !out.includes(m[1].toUpperCase())) out.push(m[1].toUpperCase());
  }
  return out;
};

// --- Unified alignment view (docs/plan-alignement-unifie.md, lot 0) ------------------------------
// Pivots the per-source diffs (IdRef/ORCID/HAL/OpenAlex, each keyed on the same Annuaire record)
// into one row per person. Does not touch the scoring engines (sync_*.cjs): only aggregates
// what computeAlignDiff / computeIdrefAlignDiff already produce. IdRef is only covered in
// « recherche simple » mode (Qualinka, computeIdrefAlignDiff) — the « Vérifier les identifiants
// liés » tool (aArbitrer/redirections/nameMismatch) stays out of scope, see plan §5.

/** Authority sources of the unified view: the 3 generic sources + IdRef (search mode only). */
export type UnifiedAlignSource = AlignSource | 'idref';
export const UNIFIED_ALIGN_SOURCES: UnifiedAlignSource[] = ['idref', 'orcid', 'hal', 'openalex', 'scopus'];

export type PersonAlignStatus = 'present' | 'strong' | 'ambiguous' | 'arbitrate' | 'redirect' | 'conflict' | 'not_found' | 'none';

/** State of one authority source for a person. `status` = the dominant state (strong > ambiguous >
 * conflict > present > not_found > none) but the parts coexist: a record can have a strong
 * candidate AND a divergence on a secondary field (`fill` + `conflicts`), or a value already
 * present AND additions to make in verify mode (`existing` + `fill`). The drawer of the unified
 * view shows everything that is there, like the per-source pages.
 * `fill` is an array: only OpenAlex (multi-valued target) puts several strong profiles in it
 *  (cf. `AlignDiff.aRenseigner`, id `G-<row>#<A-id>`). */
export interface PersonAlignCell {
  status: PersonAlignStatus;
  /** Value(s) already in the Annuaire (several only for OpenAlex) — always set when not empty. */
  existing?: string[];
  /** Candidat(s) fort(s) : cochables directement. */
  fill?: { candidate: AlignCandidate | IdrefCandidate; proposals: (AlignFieldProposal | IdrefFieldProposal)[]; matchedIds?: string[]; score?: AlignCandidate['score'] }[];
  /** Several candidates to arbitrate (radio for a single-valued source, checkboxes for OpenAlex). */
  ambiguous?: { candidates: (AlignCandidate | IdrefCandidate)[] };
  /** Manual review (free text) — several reasons possible for the same record. */
  conflicts?: { reason: string; detail: string; candidate?: AlignCandidate | IdrefCandidate }[];
  /** IdRef, verify mode: record/authority name mismatch → confirm (same person) or detach
   * (wrong IdRef) — see `IdrefDiff.aArbitrer` and `ArbitrageCard`. */
  arbitrate?: IdrefDiff['aArbitrer'][number];
  /** IdRef, verify mode: authority record merged/replaced by ABES (301) → « Mettre à jour » writes
   *  `newPpn` — cf. `IdrefDiff.redirections`. */
  redirection?: NonNullable<IdrefDiff['redirections']>[number];
}

/** One row = one Annuaire record, with the state of each requested authority source. */
export interface PersonAlignRow {
  /** Grist id of the record (`G-<row>`), shared by the 4 source diffs. */
  id: string;
  uid: string;
  displayName: string;
  labo?: string;
  group?: AlignGroup;
  sources: Partial<Record<UnifiedAlignSource, PersonAlignCell>>;
}

export interface UnifiedAlignDiff {
  generatedAt: string;
  mode: AlignMode;
  sources: UnifiedAlignSource[];
  rows: PersonAlignRow[];
  labos?: string[];
  /** « Identité mêlée » tickets of the review tables, per source (info, like MixedSection on the legacy pages). */
  melees?: Partial<Record<UnifiedAlignSource, ReviewMixedItem[]>>;
}

/** Reads the value(s) already present in the Annuaire for a given authority source. */
const UNIFIED_EXISTING_READERS: Record<UnifiedAlignSource, (f: any) => string[]> = {
  idref: (f) => (String(f['IdRef'] || '').trim() ? [String(f['IdRef']).trim()] : []),
  orcid: (f) => (String(f['ORCID'] || '').trim() ? [String(f['ORCID']).trim()] : []),
  hal: (f) => (String(f['IdHAL'] || '').trim() ? [String(f['IdHAL']).trim()] : []),
  openalex: (f) => parseOpenalexIds(f['OpenAlex_ids']),
  scopus: (f) => (scopusIdOf(f['ID_SCOPUS']) ? [scopusIdOf(f['ID_SCOPUS'])] : []),
};

/** Pivots Annuaire records + per-source diffs (already computed) into `PersonAlignRow[]` — exported
 * for the pivot unit tests (record present in 0/1/several sources, ambiguous on one source
 * and strong on another…). Performs no fetch: `computeUnifiedAlignDiff` takes care of that. */
export function pivotUnifiedAlignDiffs(
  records: any[],
  sources: UnifiedAlignSource[],
  mode: AlignMode,
  perSource: Partial<Record<UnifiedAlignSource, AlignDiff | IdrefDiff>>,
): UnifiedAlignDiff {
  type FillEntry = NonNullable<PersonAlignCell['fill']>[number];
  type ConflictEntry = NonNullable<PersonAlignCell['conflicts']>[number];
  const fillBySource = new Map<UnifiedAlignSource, Map<string, FillEntry[]>>();
  const ambigBySource = new Map<UnifiedAlignSource, Map<string, any>>();
  const conflictBySource = new Map<UnifiedAlignSource, Map<string, ConflictEntry[]>>();
  const notFoundBySource = new Map<UnifiedAlignSource, Set<string>>();
  const melees: NonNullable<UnifiedAlignDiff['melees']> = {};
  const arbitrateById = new Map<string, IdrefDiff['aArbitrer'][number]>();
  const redirectionById = new Map<string, NonNullable<IdrefDiff['redirections']>[number]>();

  for (const src of sources) {
    const diff = perSource[src];
    if (!diff) continue;
    // OpenAlex: several `G-<row>#<A-id>` entries can share the same record (several strong
    // profiles) → grouped by record id (prefix before `#`), never by full id.
    const fillMap = new Map<string, FillEntry[]>();
    const fillBucket = (mode === 'search' ? diff.aRenseigner : diff.aEnrichir) as any[];
    for (const r of fillBucket) {
      const baseId = String(r.id).split('#')[0];
      const list = fillMap.get(baseId) || [];
      list.push({ candidate: r.candidate, proposals: r.proposals, matchedIds: r.matchedIds, score: r.score ?? r.candidate?.score });
      fillMap.set(baseId, list);
    }
    fillBySource.set(src, fillMap);

    const ambigMap = new Map<string, any>();
    for (const a of diff.ambigus) ambigMap.set(a.id, a);
    ambigBySource.set(src, ambigMap);

    // Several conflicts are possible for the same record (diverging name + suspected mixed identity…)
    // — all kept, as on the per-source pages.
    const conflictMap = new Map<string, ConflictEntry[]>();
    for (const c of diff.conflits as any[]) {
      const list = conflictMap.get(c.id) || [];
      list.push({ reason: c.reason, detail: c.detail, candidate: c.candidate });
      conflictMap.set(c.id, list);
    }
    conflictBySource.set(src, conflictMap);

    const nfSet = new Set<string>();
    for (const n of diff.nonTrouves) nfSet.add(n.uid);
    notFoundBySource.set(src, nfSet);
    if (diff.melees?.length) melees[src] = diff.melees;
    // IdRef verify (computeIdrefDiff): name mismatches to arbitrate and replaced records.
    if (src === 'idref') {
      const d = diff as IdrefDiff;
      for (const a of d.aArbitrer || []) arbitrateById.set(a.id, a);
      for (const r of d.redirections || []) redirectionById.set(r.id, r);
    }
  }

  const rows: PersonAlignRow[] = records.map((rec) => {
    const f = rec.fields;
    const id = `G-${rec.id}`;
    const uid = f['uid_dyna'] || '';
    const displayName = `${(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim();
    const labo = f['LABO'] || '';
    const group = alignGroupOf(f);
    const cells: Partial<Record<UnifiedAlignSource, PersonAlignCell>> = {};
    for (const src of sources) {
      if (!perSource[src]) continue;   // source requested but not covered for this mode (e.g. idref/verify)
      const existing = UNIFIED_EXISTING_READERS[src](f);
      const fill = fillBySource.get(src)?.get(id);
      const ambigEntry = ambigBySource.get(src)?.get(id);
      const conflicts = conflictBySource.get(src)?.get(id);
      // Actionable buckets take precedence over « déjà présent »: in verify mode a record has by
      // construction its identifier (existing) AND additions to make (aEnrichir) or a
      // divergence (conflicts) — otherwise the verify view would never show anything.
      const arbitrate = src === 'idref' ? arbitrateById.get(id) : undefined;
      const redirection = src === 'idref' ? redirectionById.get(id) : undefined;
      const status: PersonAlignStatus = fill?.length ? 'strong'
        : ambigEntry ? 'ambiguous'
          : arbitrate ? 'arbitrate'
            : redirection ? 'redirect'
              : conflicts?.length ? 'conflict'
                : existing.length ? 'present'
                  : notFoundBySource.get(src)?.has(uid) ? 'not_found'
                    : 'none';   // record never covered by a run of this source
      const cell: PersonAlignCell = { status };
      if (existing.length) cell.existing = existing;
      if (fill?.length) cell.fill = fill;
      if (ambigEntry) cell.ambiguous = { candidates: ambigEntry.candidates };
      if (conflicts?.length) cell.conflicts = conflicts;
      if (arbitrate) cell.arbitrate = arbitrate;
      if (redirection) cell.redirection = redirection;
      cells[src] = cell;
    }
    return { id, uid, displayName, labo, group, sources: cells };
  });

  return { generatedAt: new Date().toISOString(), mode, sources, rows, labos: distinctLabos(records), melees };
}

// --- Selection and grouped application (lots 2/3 of the plan) --------------------------------
// The unified view selects cells (person × source), possibly several sources for the same
// person (IdRef + ORCID checked at once) → buildUnifiedUpdates groups them into ONE write
// per Grist record (a single PATCH per person, see plan §2 « Application groupée »).
// Pure logic (no fetch) to stay testable like pivotUnifiedAlignDiffs; UnifiedAlignPage
// (lot 2) calls it in a useMemo, GristService.applyUnifiedUpdates (lot 3, not written yet)
// will consume its result for the real PATCH + per-source traceability.

/** Candidate identifier, uniform between AlignCandidate (`id`) and IdrefCandidate (`ppn`). */
export const unifiedCandidateId = (src: UnifiedAlignSource, c: AlignCandidate | IdrefCandidate): string =>
  (src === 'idref' ? (c as IdrefCandidate).ppn : (c as AlignCandidate).id);

/** Target Annuaire column of an authority source (the one written when arbitrating an ambiguous case). */
export const unifiedTargetField = (src: UnifiedAlignSource): string =>
  (src === 'idref' ? 'IdRef' : ALIGN_SOURCE_META[src].targetField);

/** Selection key of a « strong » candidate (status `strong`) — direct checkbox in the row
 * when `fill.length === 1`, otherwise in the detail drawer (OpenAlex, several profiles). */
export const unifiedFillKey = (rowId: string, src: UnifiedAlignSource, candId: string): string => `${rowId}::${src}#${candId}`;

/** Arbitration key of an ambiguous case (status `ambiguous`) — one entry in `chosen`, value = id(s)
 * of the chosen candidate(s), joined with `|` for a multi-valued target (OpenAlex). */
export const unifiedAmbigKey = (rowId: string, src: UnifiedAlignSource): string => `${rowId}::${src}`;

/** Grouped write decided in the unified view: several authority sources can contribute to the
 * same record (e.g. IdRef+ORCID checked for the same person) — `sources`/`fieldsBySource`
 * keep, besides the merged `fields` (for the PATCH), the detail per contributing source
 * (so that the write, lot 3, traces Data_source/`<SOURCE>_derniere_maj` per source — not
 * only for the record as a whole). */
export interface PersonAlignUpdate {
  id: string;
  uid: string;
  displayName: string;
  /** Grist fields → value, merged from every authority source checked for this record (PATCH). */
  fields: Record<string, string>;
  /** Same fields, split by contributing authority source (per-source traceability, lot 3). */
  fieldsBySource: Partial<Record<UnifiedAlignSource, Record<string, string>>>;
  sources: UnifiedAlignSource[];
}

/**
 * Groups by Grist record the checked cells (`selected`, strong candidates) and arbitrated
 * ones (`chosen`, ambiguous) into `PersonAlignUpdate[]`. Deliberate simplification for the
 * arbitration of an ambiguous case: only writes the source's target column (`unifiedTargetField`) —
 * unlike `AlignPage` (e.g. an arbitrated HAL also writes `IdHAL_i` when known), no secondary field
 * here (see plan §4 « limites assumées »; to revisit if it turns out to be missing in practice).
 */
/** Decision on an IdRef name mismatch (verify mode): confirm = same person (writes
 * IdRef_nom_valide + the additions from the record), detach = wrong IdRef (clears the column). */
export type UnifiedArbitrateDecision = 'confirm' | 'detach' | 'ignore';

export function buildUnifiedUpdates(
  diff: UnifiedAlignDiff | null,
  selected: ReadonlySet<string>,
  chosen: Readonly<Record<string, string>>,
  decisions: Readonly<Record<string, UnifiedArbitrateDecision>> = {},
): PersonAlignUpdate[] {
  if (!diff) return [];
  const byRow = new Map<string, PersonAlignUpdate>();
  const addFields = (row: PersonAlignRow, src: UnifiedAlignSource, fields: Record<string, string>) => {
    if (!Object.keys(fields).length) return;
    const entry = byRow.get(row.id) || { id: row.id, uid: row.uid, displayName: row.displayName, fields: {}, fieldsBySource: {}, sources: [] };
    Object.assign(entry.fields, fields);
    entry.fieldsBySource[src] = { ...(entry.fieldsBySource[src] || {}), ...fields };
    if (!entry.sources.includes(src)) entry.sources.push(src);
    byRow.set(row.id, entry);
  };
  // Merges the proposals of several CHECKED candidates for the same (record, source): a
  // multi-valued field (OpenAlex_ids) proposed by two strong candidates must be ADDED UP (union),
  // not overwritten (that would lose the first checked candidate) — the other sources never
  // propose more than one strong candidate per record, so no collision in practice for them.
  const mergeProposal = (fields: Record<string, string>, field: string, after: string) => {
    if (fields[field] && fields[field] !== after) {
      const ids = new Set([...fields[field].split('|'), ...after.split('|')].filter(Boolean));
      fields[field] = [...ids].join('|');
    } else {
      fields[field] = after;
    }
  };

  for (const row of diff.rows) {
    for (const src of diff.sources) {
      const cell = row.sources[src];
      if (!cell) continue;
      if (cell.status === 'strong') {
        const fields: Record<string, string> = {};
        for (const f of cell.fill || []) {
          const candId = unifiedCandidateId(src, f.candidate);
          if (!selected.has(unifiedFillKey(row.id, src, candId))) continue;
          for (const p of f.proposals) mergeProposal(fields, p.field, p.after);
        }
        addFields(row, src, fields);
      } else if (cell.status === 'ambiguous') {
        const chosenIds = (chosen[unifiedAmbigKey(row.id, src)] || '').split('|').filter(Boolean);
        if (chosenIds.length) addFields(row, src, { [unifiedTargetField(src)]: chosenIds.join('|') });
      }
      // IdRef name mismatch (verify) — same logic as IdrefAlignPage: confirm writes
      // IdRef_nom_valide (+ ORCID/IdHAL from the record if empty), detach clears IdRef.
      if (cell.arbitrate) {
        const dec = decisions[unifiedAmbigKey(row.id, src)];
        if (dec === 'confirm') {
          const fields: Record<string, string> = { IdRef_nom_valide: cell.arbitrate.ppn };
          for (const p of cell.arbitrate.proposals) fields[p.field] = p.after;
          addFields(row, src, fields);
        } else if (dec === 'detach') {
          addFields(row, src, { IdRef: '' });
        }
      }
    }
  }
  return [...byRow.values()];
}

/** Converts 'YYYY-MM-DD' to an epoch timestamp (seconds, midnight UTC) for Grist Date columns. */
const toGristEpoch = (ymd: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000);
};

// Grist doc and API base come from /api/me at runtime (lib/instanceRuntime.ts): gristDocUrl().
// The Grist API key never reaches the client: the /api/grist proxy (server.cjs, functions/) injects it.
// A read-only instance whose doc is public (demo, docs/plan-instance-demo-cloudflare.md lot A2)
// reads Grist directly: no request against the account-wide quota of Cloudflare Functions.

/** Grist write error carrying what was actually written before the failure. */
export interface PartialWriteError extends Error {
  updated: number;
  updatedRowIds: Set<number>;
}

/**
 * PATCH `Annuaire` in batches of 100, already grouped by column signature by the caller
 * (the Grist API requires the same columns within one PATCH). If a batch fails, the previous
 * batches remain written in Grist: without this tracking, the 4 `applyXxxUpdates` of this file
 * just rethrew `throw new Error(...)`, losing the count of writes already done —
 * the caller displayed « 0 fiche écrite » and removed no row from its in-memory queue,
 * although some were already up to date in Grist (review lot 6a).
 */
async function patchAnnuaireInChunks(
  groups: Map<string, { id: number; fields: Record<string, any> }[]>,
  errorLabel: string,
): Promise<{ updated: number; updatedRowIds: Set<number> }> {
  let updated = 0;
  const updatedRowIds = new Set<number>();
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 100) {
      const chunk = group.slice(i, i + 100);
      const r = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: chunk }),
      });
      if (!r.ok) {
        const err = new Error(`${errorLabel}: ${await r.text()}`) as PartialWriteError;
        err.updated = updated;
        err.updatedRowIds = updatedRowIds;
        throw err;
      }
      updated += chunk.length;
      for (const rec of chunk) updatedRowIds.add(rec.id);
    }
  }
  return { updated, updatedRowIds };
}

/** Grist table for the collaborative review of IdRef suggestions (created on the fly by pushIdrefReview). */
const IDREF_REVIEW_TABLE = 'Alignement_IdRef';

/** Metadata of an Annuaire column (for merging: never write a formula). */
export interface AnnuaireColumnMeta { id: string; label: string; type: string; isFormula: boolean }

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

/** Qualification columns for multi-affiliations (duplicate merge plan, lot 1). */
export const RATTACHEMENT_COL = 'rattachement';
export const DUPLICATE_DECISION_COL = 'doublon_decision';
export type RattachementRole = 'PRINCIPAL' | 'SECONDAIRE' | 'HISTORIQUE';
const RATTACHEMENT_CHOICES: RattachementRole[] = ['PRINCIPAL', 'SECONDAIRE', 'HISTORIQUE'];

/** Creates the `rattachement` (Choice) and `doublon_decision` (Text) columns if missing. Idempotent. */
async function ensureAffiliationColumns(): Promise<void> {
  const cols = await fetchAnnuaireColumnsInternal();
  const have = new Set(cols.map((c) => c.id));
  const missing: any[] = [];
  if (!have.has(RATTACHEMENT_COL)) missing.push({ id: RATTACHEMENT_COL, fields: { label: 'Rattachement (multi-lignes)', type: 'Choice', widgetOptions: JSON.stringify({ choices: RATTACHEMENT_CHOICES }) } });
  if (!have.has(DUPLICATE_DECISION_COL)) missing.push({ id: DUPLICATE_DECISION_COL, fields: { label: 'Décision doublon', type: 'Text' } });
  if (missing.length === 0) return;
  const r = await fetch(`${gristDocUrl()}/tables/Annuaire/columns`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columns: missing }),
  });
  if (!r.ok) throw new Error(t`Error creating the affiliation columns: ${await r.text()}`);
  _annuaireColumnsCache = null;
}

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

/** Cache of the Annuaire columns (rarely changes). */
let _annuaireColumnsCache: AnnuaireColumnMeta[] | null = null;
async function fetchAnnuaireColumnsInternal(): Promise<AnnuaireColumnMeta[]> {
  if (_annuaireColumnsCache) return _annuaireColumnsCache;
  const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/columns`);
  if (!resp.ok) throw new Error('Erreur Grist (colonnes Annuaire)');
  const { columns } = await resp.json();
  _annuaireColumnsCache = columns.map((c: any) => ({
    id: c.id, label: c.fields?.label || c.id, type: c.fields?.type || 'Any', isFormula: !!c.fields?.isFormula,
  }));
  return _annuaireColumnsCache!;
}

/**
 * A numeric string written into a Numeric/Int column is stored by Grist as text (invalid cell in
 * red) — the alignment proposals are strings (`ID_SCOPUS` of the Scopus alignment, or of an ORCID
 * profile): coerced to numbers according to the column type before the PATCH. Mutates and returns `fields`.
 */
function coerceNumericColumns(cols: AnnuaireColumnMeta[], fields: Record<string, any>): Record<string, any> {
  for (const [k, v] of Object.entries(fields)) {
    const type = cols.find((c) => c.id === k)?.type || '';
    if ((type === 'Numeric' || type === 'Int') && typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) fields[k] = Number(v);
  }
  return fields;
}

/**
 * Traceability columns of a write by `label` into the Annuaire (`<Label>_derniere_maj`,
 * `<Label>_champs_modifies`), keeping only those present in the schema: a doc where they were never
 * provisioned (Centrale had no Scopus_* columns until 2026-10-05) would otherwise get the whole PATCH
 * rejected by Grist ("Invalid column"). `<Label>_derniere_maj` is written as an epoch when the column is
 * Date (Centrale), as AAAA-MM-JJ text otherwise.
 */
export function traceColumnsFor(cols: AnnuaireColumnMeta[], label: string, today: string, modified: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  const lastUpdate = cols.find((c) => c.id === `${label}_derniere_maj`);
  if (lastUpdate) out[lastUpdate.id] = lastUpdate.type === 'Date' ? toGristEpoch(today) : today;
  if (cols.some((c) => c.id === `${label}_champs_modifies`)) out[`${label}_champs_modifies`] = modified.join('|');
  return out;
}

async function ensureMergeLogTable(): Promise<void> {
  const tablesResp = await fetch(`${gristDocUrl()}/tables`);
  if (!tablesResp.ok) throw new Error(t`Grist error (table list)`);
  const { tables } = await tablesResp.json();
  if (tables.some((t: any) => t.id === MERGE_LOG_TABLE)) return;
  const r = await fetch(`${gristDocUrl()}/tables`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: [{ id: MERGE_LOG_TABLE, columns: buildMergeLogColumns() }] }),
  });
  if (!r.ok) throw new Error(t`Error creating table ${MERGE_LOG_TABLE}: ${await r.text()}`);
}


/** Group of a record on the alignment pages (IdRef / ORCID / HAL / OpenAlex): tabs
 * « Personnel » / « Doctorants » / « Sans obligation de recherche ». The last two are low priorities
 * (records rarely holding researcher identifiers, or whose alignment matters less) isolated
 * so as not to drown the research staff. Same logic as alignGroupOf in
 * scripts/lib/align_common.cjs (--group filter of the scripts). */
export type AlignGroup = 'personnel' | 'doctorants' | 'hors_recherche';
export const ALIGN_GROUPS: AlignGroup[] = ['personnel', 'doctorants', 'hors_recherche'];
/** PhD student — the raw `TYPE_EMPLOI` code (e.g. 'DOCTORANT') is reliable; `LIB_TYPE_EMPLOI` (HR label)
 * is empty for almost every PhD student in the Nantes Annuaire (checked 2026-09-07: 187/192 empty). */
const isDoctorantTypology = (f: any): boolean => String(f?.['TYPE_EMPLOI'] || '').trim().toUpperCase() === 'DOCTORANT';
/** Staff without statutory research duty — HR label `LIB_TYPE_EMPLOI` « Personnel titulaire /
 * non titulaire n'ayant pas d'obligation statutaire de recherche » (~1,200 records in the Nantes Annuaire). */
const isNonResearchTypology = (f: any): boolean =>
  /n'ayant pas d'obligation statutaire de recherche/i.test(String(f?.['LIB_TYPE_EMPLOI'] || '').replace(/[’‘]/g, "'"));
/** PhD student (TYPE_EMPLOI, takes precedence) > no research duty > staff. */
export const alignGroupOf = (f: any): AlignGroup =>
  isDoctorantTypology(f) ? 'doctorants' : isNonResearchTypology(f) ? 'hors_recherche' : 'personnel';

/** Exact death year (4 digits) of an IdRef candidate, or null if missing/approximate
 * ("19XX", "17.."). Used to discard upfront candidates who died before DEATH_MIN_YEAR (obviously
 * wrong candidate: we look for current staff/PhD students) — see computeIdrefAlignDiff
 * and scripts/sync_idref_qualinka.cjs::candidateDeathYear (same threshold, same logic). */
const DEATH_MIN_YEAR = 2015;
const candidateDeathYear = (death: any): number | null => {
  const m = /^(\d{4})$/.exec(String(death || '').trim());
  return m ? parseInt(m[1], 10) : null;
};

/** Distinct labs (LABO column) of the Annuaire records, sorted — for the structure filter. */
const distinctLabos = (records: any[]): string[] =>
  Array.from(new Set(records.map((r: any) => String(r.fields['LABO'] || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'fr'));

/** Employing institution (Grist table `Etablissements`). */
export interface Institution {
  id: number;   // Grist rowId — value of the Annuaire's `Employeur` Reference column
  name: string; // `Employeur` column (label)
  uai: string;  // `UAI` column
  ror: string;  // `ROR` column
  idref: string; // `idref` column — IdRef PPN of the corporate body (ABES export, 510 employer)
  label: string; // `Libelle` column — long form (e.g. « Nantes Université »), otherwise `Employeur`
}

// Simple in-memory cache: the Etablissements table rarely changes.
let institutionsCache: Institution[] | null = null;

async function fetchInstitutionsInternal(): Promise<Institution[]> {
  if (institutionsCache) return institutionsCache;
  const resp = await fetch(`${gristDocUrl()}/tables/Etablissements/records`);
  if (!resp.ok) throw new Error('Erreur Grist (Etablissements)');
  const { records } = await resp.json();
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
  institutionsCache = all.filter((e: Institution) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
  return institutionsCache!;
}

/**
 * Grist `Employeur` field (Reference column → rowId of `Etablissements`) from the
 * displayed label. Empty → 0 (reference cleared). A label outside the list
 * (legacy data) or an unreachable table → column left untouched.
 */
async function employerToGristFields(employer?: string): Promise<Record<string, number>> {
  const name = (employer || '').trim();
  if (!name) return { 'Employeur': 0 };
  try {
    const match = (await fetchInstitutionsInternal()).find((e) => e.name === name);
    return match ? { 'Employeur': match.id } : {};
  } catch {
    return {};
  }
}

// Cache of the directory and of the structures, in MEMORY only (plan-separation-test-prod-rssi.md, lot 7): it used
// to be kept in localStorage, i.e. on the disk of every browser that ever opened Druid, after the logout and for the
// other users of the same computer. It now lasts as long as the tab. One timestamp per cache: with a shared one, a
// successful structures refresh marked the researchers cache as fresh although its fetch had failed (review lot 2).
const memoryCache: { researchers?: { updatedAt: string; data: Researcher[] }; structures?: { updatedAt: string; data: Structure[] } } = {};
purgeStoredDirectory();

/** Lowercase ASCII slug used to build an ext_ identifier (accents removed, non-alphanumerics -> '-'). */
const slugForExtId = (s: string): string =>
  (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Assigns the public/central identifier of each researcher (in-place mutation).
 * - real uid_dyna present: id = uid (1st record). Duplicate uids (≈17): the 1st keeps the bare uid
 * (served by the URL), the next ones take `uid-<rowId>` to stay navigable/unique → reported in the console.
 * - No uid (records outside the LDAP directory): synthetic id `ext_<name>-<first-name initial>`,
 * suffixed with the rowId on collision. NB: for harvestable externals, this same `ext_`
 * is now PERSISTED in uid_dyna (+ people.csv) → they go through the « real uid » branch
 * above; the synthetic computation is only a fallback for externals without uid_dyna.
 */
function assignPublicIds(researchers: any[]): void {
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

  if (dupUids.size > 0) {
    console.warn(
      `[Druid] ${dupUids.size} uid_dyna en doublon dans l'Annuaire — l'URL ouvre la 1re fiche ; ` +
      `les doublons reçoivent un id suffixé. uids: ${[...dupUids].join(', ')}`
    );
  }
}

/** LDAP civility / free input → Grist Choice `Civilite` (F / M). A single definition: the LDAP
 * review, the LDAP diff and the attachment of LDAP candidates (which wrote a raw « Mme », review lot 2,
 * finding 2) doivent normaliser pareil. */
// --- Helpers for Grist <-> Druid date conversion ---

const fromGristDate = (rawDate: any): string => {
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

/** Grist columns of the membership dates in the row's lab/team (Date, created on 2026-09-14),
 * distinct from the employment dates `employment_start_date` / `employment_end_date`. */
/** Sentinel id of a structure being created (« Nouvelle structure » page). */
export const NEW_STRUCTURE_ID = 'S-new';
const AFFILIATION_START_COL = 'affiliation_start_date';
const AFFILIATION_END_COL = 'affiliation_end_date';
/** Membership type (Grist Choice: stat_mmb / assoc_mmb / second_mmb / visit_mmb, created on 2026-09-14). */
const MEMBERSHIP_TYPE_COL = 'membership_type';
const toMembershipType = (v: any): MembershipType | undefined =>
  (MEMBERSHIP_TYPES as string[]).includes(String(v || '').trim()) ? (String(v).trim() as MembershipType) : undefined;

/** The four employment / membership date columns holding reduced-precision dates (lib/dates.ts):
 * `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Text columns once scripts/migrate_fuzzy_dates.cjs has run on the
 * document; still Date (epoch) columns before that — both are read, the writer adapts (see
 * `fuzzyDateCellEncoder`). */
const FUZZY_DATE_COLS = ['employment_start_date', 'employment_end_date', AFFILIATION_START_COL, AFFILIATION_END_COL] as const;

/** Reads a fuzzy-date cell (epoch seconds, canonical text, or legacy DD-MM-YYYY text) → canonical
 * fuzzy date, `''` when empty or unreadable. */
const fromGristFuzzyDate = (raw: any): string => normalizeFuzzyDate(raw) ?? fromGristDate(raw);

/** Encodes a Druid date (ISO YYYY-MM-DD, or legacy DD-MM-YYYY text) for a Grist Date column:
 * epoch seconds, the only valid representation whatever the column's `dateFormat`. Until
 * 2026-09-17 we wrote DD-MM-YYYY text: accepted by columns in DD-MM-YYYY format
 * (birth, employment) but stored as an invalid cell in `validation_date` and
 * `affiliation_*_date` (default format) — review lot 2, finding 1. Empty / unreadable → null. */
const toGristDateCell = (date: any): number | null => toGristEpoch(fromGristDate(date));

/** Cell writer for the FUZZY_DATE_COLS, decided from the document's column types (cached
 * metadata): Text column → canonical fuzzy string; Date column (document not migrated yet) → epoch
 * of the period bound (start columns: first day, end columns: last day), i.e. the precision is
 * lost until migration. Empty / unreadable → null. */
type FuzzyDateEncoder = (col: string, value: any) => string | number | null;
async function fuzzyDateCellEncoder(): Promise<FuzzyDateEncoder> {
  let textCols = new Set<string>();
  try {
    const cols = await fetchAnnuaireColumnsInternal();
    textCols = new Set(cols.filter((c) => (FUZZY_DATE_COLS as readonly string[]).includes(c.id) && c.type === 'Text').map((c) => c.id));
  } catch (e) {
    console.warn('[gristService] Annuaire column types unavailable, fuzzy dates written as epochs:', e);
  }
  return (col, value) => {
    const d = fromGristFuzzyDate(value);
    if (!d) return null;
    if (textCols.has(col)) return d;
    return toGristEpoch(col.endsWith('_end_date') ? fuzzyDateUpperBound(d) : fuzzyDateLowerBound(d));
  };
}

/** FTE cells of an Annuaire write (lib/fte.ts): columns of the document only, null when empty.
 * Column list unavailable → nothing written (the rest of the record is still saved). */
async function fteCellFields(values: { fte?: number | null; researchFte?: number | null }): Promise<Record<string, number | null>> {
  try {
    return fteGristFields(await fetchAnnuaireColumnsInternal(), values);
  } catch (e) {
    console.warn('[gristService] Annuaire columns unavailable, FTE not written:', e);
    return {};
  }
}

/** HR staff number cell, only when the Annuaire has the column (instances without HR data do not). */
async function hrIdCellFields(hrId?: string): Promise<Record<string, number>> {
  const cell = hrIdCell(hrId || '');
  if (cell === null) return {};
  try {
    return (await fetchAnnuaireColumnsInternal()).some((c) => c.id === HR_ID_COLUMN) ? { [HR_ID_COLUMN]: cell } : {};
  } catch (e) {
    console.warn('[gristService] Annuaire columns unavailable, HR staff number not written:', e);
    return {};
  }
}

// --- Helpers for the Structures V2 table format (= structures.csv of the directory bridge) ---

/**
 * Decodes a V2 multi-label field such as `Valeur[fr]|Autre[en]`.
 * Returns the value in the preferred language (fr by default), otherwise the first one.
 */
const parseMultiLabel = (raw: any, preferLang = 'fr'): string => {
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
 * Re-encodes a simple value in the V2 multi-label format for writing (`Valeur[fr]`).
 */
const encodeMultiLabel = (value: any, lang = 'fr'): string => {
  const v = (value === null || value === undefined) ? '' : String(value).trim();
  return v ? `${v}[${lang}]` : '';
};

/**
 * Decodes the TUTELLES (institutions) part of the V2 `participations` field:
 *   `uai-0442953W[main_supervision][20000101-]|uai-0353074B[associated_supervision][...]`
 * Keeps ONLY the institution refs (`uai-`/`ror-`), not the participations in
 * other research structures (`local-`, see parseStructureParticipations).
 */
const parseParticipations = (raw: any): { codes: string[]; pipe: string } => {
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
const parseStructureParticipations = (raw: any): { localIds: string[]; pipe: string } => {
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
const deriveStructureLevel = (genericType: any, type?: any): string => {
  const gt = String(genericType || '').toLowerCase();
  const t = String(type || '').toUpperCase();
  if (gt === 'institution' || t === 'EPE' || t === 'GE') return '4';
  if (gt === 'team' || t === 'TEAM' || t === 'ER') return '1';
  if (t === 'UFR' || t === 'POLE') return '3';
  return '2';
};

/** V2 `main_mission`/`secondary_missions` (texte) -> StructureMission Druid. */
const missionFromV2 = (raw: any): string | null => {
  const v = String(raw || '').toLowerCase();
  if (!v) return null;
  if (v.includes('research') || v.includes('recherche')) return 'RECHERCHE';
  if (v.includes('scient')) return 'SERVICES_SCIENTIFIQUES';
  if (v.includes('admin')) return 'SERVICES_ADMINISTRATIFS';
  return 'RECHERCHE';
};

/** Druid StructureMission -> V2 text value for writing. */
const missionToV2 = (mission: any): string => {
  switch (mission) {
    case 'RECHERCHE': return 'research';
    case 'SERVICES_SCIENTIFIQUES': return 'scientific_services';
    case 'SERVICES_ADMINISTRATIFS': return 'administrative_services';
    default: return '';
  }
};

/** `YYYYMMDD` (compact V2 format) -> `YYYY-MM-DD` (empty if invalid). */
const compactToIso = (d: any): string => {
  const s = String(d || '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
};
/** `YYYY-MM-DD` -> `YYYYMMDD` (empty if invalid). */
const isoToCompact = (d: any): string => {
  const s = String(d || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, '') : '';
};

const SUPERVISION_CODES = new Set(['main_supervision', 'associated_supervision', 'participating_supervision']);

/**
 * Decodes a V2 membership column (`inclusions` or `participations`) into Membership[].
 * Grammar of an entry: `<refType>-<ref>[<supervision>]?[<YYYYMMDD>-<YYYYMMDD>?]?`
 * refType ∈ local|uai|ror; a bare local_id (no prefix) is treated as `local`.
 * The brackets hold either a supervision code or a date range.
 */
const parseMembershipList = (raw: any): Membership[] => {
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
 * Re-encodes a Membership[] to the V2 column (`inclusions`/`participations`).
 * Keeps the supervision code and always emits a date range
 * (default start `20000101`, end possibly empty = open), as expected by
 * the CRISalid directory bridge.
 */
const serializeMembershipList = (list: any): string => {
  if (!Array.isArray(list)) return '';
  return list
    .filter((m: any) => m && m.ref)
    .map((m: any) => {
      let out = `${m.refType || 'local'}-${String(m.ref).trim()}`;
      if (m.supervision) out += `[${m.supervision}]`;
      const start = isoToCompact(m.startDate) || '20000101';
      const end = isoToCompact(m.endDate);
      out += `[${start}-${end}]`;
      return out;
    })
    .join('|');
};

/**
 * Column definitions of the Alignement_IdRef review table (created by pushIdrefReview).
 * The Valider_action / Rejeter_action columns are Python FORMULAS (Grist side) that
 * produce the {button, description, actions} payload expected by the custom widget
 * « Action Button » (https://gristlabs.github.io/grist-widget/actionbutton/).
 * The Valider formula re-reads the Annuaire record AT CLICK TIME: non-empty cell → never
 * overwritten (divergence = inert « Conflit » button), same traceability as applyIdrefUpdates,
 * and the competing candidates of the same uid are auto-rejected in the same transaction.
 */
// ── Decisions of the review tables (mirror of scripts/lib/align_common.cjs) ────────────────────
// « À traiter » → « Validé » / « Rejeté » / « Identité mêlée » (OpenAlex plan § 8): a remote profile that
// mixes several people is neither written nor permanently blacklisted — it is a ticket to untangle
// at the source (Note, Signale_le), excluded from proposals as long as it stays in this state.
export const DECISION_MIXED = 'Identité mêlée';
export type ReviewDecision = 'Rejeté' | typeof DECISION_MIXED;
const REVIEW_DECISIONS = ['À traiter', 'Validé', 'Rejeté', DECISION_MIXED];
const DECISION_CHOICE_OPTIONS = {
  'À traiter': { fillColor: '#FFE5B4', textColor: '#000000' },
  'Validé': { fillColor: '#C7F0C2', textColor: '#000000' },
  'Rejeté': { fillColor: '#F2C2C2', textColor: '#000000' },
  [DECISION_MIXED]: { fillColor: '#D9C8F5', textColor: '#000000' },
};
const isDecided = (d: string) => d === 'Validé' || d === 'Rejeté' || d === DECISION_MIXED;
/** Excluded from proposals: rejected or mixed identity. */
const isExcluded = (d: string) => d === 'Rejeté' || d === DECISION_MIXED;
const reviewDecisionColumns = (table: string): { id: string; fields: Record<string, any> }[] => [
  { id: 'Decision', fields: { label: 'Décision', type: 'Choice', widgetOptions: JSON.stringify({ choices: REVIEW_DECISIONS, choiceOptions: DECISION_CHOICE_OPTIONS }) } },
  { id: 'Note', fields: { label: 'Note (identité mêlée : qui possède quoi)', type: 'Text' } },
  { id: 'Signale_le', fields: { label: 'Signalé à la source le', type: 'Text' } },
  {
    id: 'Meler_action',
    fields: {
      label: 'Identité mêlée (action)', type: 'Any', isFormula: true,
      formula: [
        `if $Decision != "À traiter":`,
        `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
        `today = NOW().strftime("%Y-%m-%d")`,
        `return {"button": "Identité mêlée", "description": "Profil qui mélange plusieurs personnes pour %s : ni validé ni rejeté, à démêler à la source (renseigner Note et Signale_le)" % $Nom_annuaire, "actions": [["UpdateRecord", "${table}", $id, {"Decision": "${DECISION_MIXED}", "Date_application": today}]]}`,
      ].join('\n'),
    },
  },
];

/** « Identité mêlée » row of the Alignement_IdRef table → ReviewMixedItem. The record id is found
 * by uid_dyna in the Annuaire index: the IdRef table has no Annuaire_id column (unlike the
 * ORCID/HAL/OpenAlex tables of the scripts), `G-${Annuaire_id}` always gave « G- » (review lot 2, finding 9). */
const idrefMelee = (r: any, byUid: Record<string, any>): ReviewMixedItem => {
  const uid = String(r.fields['uid_dyna'] || '');
  const rowId = byUid[uid]?.id ?? r.fields['Annuaire_id'] ?? '';
  const ppn = String(r.fields['PPN_candidat'] || '').match(/([0-9]{6,}[0-9X])/i)?.[1]?.toUpperCase() || '';
  return {
    id: `G-${rowId}`, uid, displayName: r.fields['Nom_annuaire'] || '', labo: r.fields['LABO'] || '',
    candidateId: ppn, url: `https://www.idref.fr/${ppn}`, fullName: r.fields['Nom_notice'] || '',
    note: r.fields['Note'] || '', signaleLe: r.fields['Signale_le'] || '',
  };
};

const buildIdrefReviewColumns = (): { id: string; fields: Record<string, any> }[] => {
  const validerFormula = [
    // Rows already processed: inert button (empty actions) — returning None would make
    // the Action Button widget display a « Missing keys » error.
    `if $Decision == "Validé":`,
    `  return {"button": "Validé ✓", "description": "Déjà appliqué%s" % ((" le " + $Date_application) if $Date_application else ""), "actions": []}`,
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `ann = Annuaire.lookupOne(uid_dyna=$uid_dyna)`,
    `if not ann:`,
    `  return {"button": "Fiche introuvable", "description": "Aucune fiche Annuaire avec uid_dyna=%s" % $uid_dyna, "actions": []}`,
    `import re`,
    `def _ppn(v):`,
    `  m = re.search(r"([0-9]{6,}[0-9Xx])", str(v or ""))`,
    `  return m.group(1).upper() if m else ""`,
    `fields = {}`,
    `done = []`,
    `cur = str(ann.IdRef or "").strip()`,
    `if not cur:`,
    `  fields["IdRef"] = $PPN_candidat`,
    `  done.append("IdRef")`,
    `elif _ppn(cur) != _ppn($PPN_candidat):`,
    `  return {"button": "Conflit IdRef", "description": "L'Annuaire contient déjà l'IdRef %s (différent de %s) : à régler dans Druid" % (cur, $PPN_candidat), "actions": []}`,
    `if str($ORCID_candidat or "").strip() and not str(ann.ORCID or "").strip():`,
    `  fields["ORCID"] = $ORCID_candidat`,
    `  done.append("ORCID")`,
    `if str($IdHAL_candidat or "").strip() and not str(ann.IdHAL or "").strip():`,
    `  fields["IdHAL"] = $IdHAL_candidat`,
    `  done.append("IdHAL")`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `actions = []`,
    `if fields:`,
    `  src = str(ann.Data_source or "")`,
    `  parts = [s.strip().upper() for s in re.split(r"[|,]", src) if s.strip()]`,
    `  if "IDREF" not in parts:`,
    `    fields["Data_source"] = (src + "|IdRef") if src else "IdRef"`,
    `  fields["IdRef_derniere_maj"] = today`,
    `  fields["IdRef_champs_modifies"] = "|".join(done)`,
    `  note = "[%s] MAJ IdRef (revue Grist): %s" % (today, ", ".join(done))`,
    `  com = str(ann.Commentaires or "")`,
    `  fields["Commentaires"] = (com + "\\n" + note) if com else note`,
    `  actions.append(["UpdateRecord", "Annuaire", ann.id, fields])`,
    `actions.append(["UpdateRecord", "${IDREF_REVIEW_TABLE}", $id, {"Decision": "Validé", "Applique": True, "Date_application": today}])`,
    `# Les autres candidats encore en attente pour la même personne sont auto-rejetés.`,
    `for sib in ${IDREF_REVIEW_TABLE}.lookupRecords(uid_dyna=$uid_dyna):`,
    `  if sib.id != $id and sib.Decision == "À traiter":`,
    `    actions.append(["UpdateRecord", "${IDREF_REVIEW_TABLE}", sib.id, {"Decision": "Rejeté", "Date_application": today}])`,
    `label = ("Valider " + " + ".join(done)) if done else "Valider (rien à écrire)"`,
    `return {"button": label, "description": "%s -> IdRef %s" % ($Nom_annuaire, $PPN_candidat), "actions": actions}`,
  ].join('\n');

  const rejeterFormula = [
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `return {"button": "Rejeter", "description": "Écarte ce candidat pour %s (il ne sera plus reproposé)" % $Nom_annuaire, "actions": [["UpdateRecord", "${IDREF_REVIEW_TABLE}", $id, {"Decision": "Rejeté", "Date_application": today}]]}`,
  ].join('\n');

  const text = (id: string, label: string) => ({ id, fields: { label, type: 'Text' } });
  return [
    text('uid_dyna', 'uid_dyna'),
    text('Nom_annuaire', 'Nom annuaire'),
    text('LABO', 'LABO'),
    { id: 'Nb_candidats', fields: { label: 'Nb candidats', type: 'Int' } },
    text('PPN_candidat', 'PPN candidat'),
    {
      id: 'Lien_IdRef',
      fields: {
        label: 'Lien IdRef', type: 'Text', isFormula: true,
        formula: `"https://www.idref.fr/" + str($PPN_candidat or "")`,
        widgetOptions: JSON.stringify({ widget: 'HyperLink' }),
      },
    },
    text('Nom_notice', 'Nom notice'),
    text('Profession', 'Profession'),
    text('Naissance', 'Naissance'),
    text('Description_notice', 'Description notice'),
    text('ORCID_candidat', 'ORCID candidat'),
    text('IdHAL_candidat', 'IdHAL candidat'),
    ...reviewDecisionColumns(IDREF_REVIEW_TABLE),   // Decision (4 values), Note, Signale_le, Meler_action
    { id: 'Applique', fields: { label: 'Appliqué', type: 'Bool' } },
    text('Date_application', 'Date application'),
    text('Pousse_le', 'Poussé le'),
    { id: 'Valider_action', fields: { label: 'Valider (action)', type: 'Any', isFormula: true, formula: validerFormula } },
    { id: 'Rejeter_action', fields: { label: 'Rejeter (action)', type: 'Any', isFormula: true, formula: rejeterFormula } },
  ];
};

/**
 * Service to interact with the collaborative Grist document.
 */
/** LDAP entry proposed to attach a record without uid (search by email). */
export interface LdapCandidateMatch {
  uid: string;
  displayName: string;
  sn?: string;
  givenName?: string;
  etat?: string;
  categorie?: string; // dynaCategorie (emeritus → PREM/MCFEM grade, see lib/emeritus.ts)
  empCorps?: string;
  civilite?: string;
  birthDate?: string;
  eppn?: string;
}

/** A proposal « Annuaire record without uid » ↔ « LDAP staff member » (1 sure candidate). */
export interface LdapCandidate {
  gristRowId: number;
  nom: string;
  prenom: string;
  email: string;
  labo: string;
  matchedBy?: 'email' | 'name';
  ldap: LdapCandidateMatch;
  /** The proposed uid is ALREADY carried by another row of the same LABO: attaching would create a
   * duplicate → propose merging the two rows instead (duplicate merge plan, lot 4). */
  duplicateOf?: { gristRowId: number; name: string };
}

/** Record without uid with several LDAP homonyms → manual arbitration required. */
export interface LdapAmbiguous {
  gristRowId: number;
  nom: string;
  prenom: string;
  email: string;
  labo: string;
  candidates: LdapCandidateMatch[];
}

/** A resolved entry ready to write (accepted proposal or arbitrated homonym). */
export interface LdapResolved {
  gristRowId: number;
  email: string;
  ldap: LdapCandidateMatch;
}

/** Result of the LDAP candidate search (email + name, with homonyms). */
export interface LdapCandidatesDiff {
  generatedAt?: string;
  /** Records matched to a single candidate (email, or unique name) → ready to attach. */
  proposals: LdapCandidate[];
  /** Records with several homonyms → to arbitrate. */
  ambiguous: LdapAmbiguous[];
  /** Cache entries attached in the meantime (ignored). */
  alreadyLinked: number;
  /** LDAP uid → Annuaire row already carrying it, per LABO (`uid::LABO`) — to flag the
   * homonyms where a candidate would create a duplicate. */
  uidTaken?: Record<string, { gristRowId: number; name: string }>;
}

/**
 * `local_id` of a structure being created: the entity code entered on creation (supannCodeEntite, e.g. 1485)
 * or, failing that, the generated D-/T- id. It becomes the Neo4j uid `local-<local_id>` through cdb, hence
 * no spaces or special characters.
 */
export const resolveNewStructureLocalId = (entered: unknown, generate: () => string): string => {
  const code = String(entered ?? '').trim();
  if (!code) return generate();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(code)) {
    throw new Error(t`Invalid entity code “${code}”: letters, digits, “-”, “_” or “.” only`);
  }
  return code;
};

export const GristService = {
  /**
   * Fetches the last modification date of the Grist document.
   */
  getDocUpdatedAt: async (): Promise<string> => {
    try {
      const resp = await fetch(`${gristDocUrl()}`);
      if (resp.ok) {
        const data = await resp.json();
        return data.updatedAt || '';
      }
    } catch (e) {
      console.warn('Could not fetch Doc info');
    }
    return '';
  },

  /**
   * Fetches the list of researchers from Grist and maps them to the Druid format.
   */
  fetchResearchers: async (force = false): Promise<Researcher[]> => {
    try {
      const remoteUpdatedAt = await GristService.getDocUpdatedAt();
      const cached = memoryCache.researchers;
      if (!force && cached && cached.updatedAt === remoteUpdatedAt) {
        console.log('Using cached researchers...');
        return cached.data;
      }

      console.log('Fetching fresh researchers from Grist...');

      // 2. Load the LDAP cache
      let ldapCache: Record<string, any> = {};
      try {
        const ldapResp = await fetch('/ldap_status_cache.json');
        if (ldapResp.ok) {
          ldapCache = await ldapResp.json();
        }
      } catch (e) {
        console.warn('LDAP cache not found.');
      }

      // 3. Fetch the institutions
      const institutionsResp = await fetch(`${gristDocUrl()}/tables/Etablissements/records`);
      const institutionsMap: Record<number, string> = {};
      const institutionsUaiMap: Record<number, string> = {};
      if (institutionsResp.ok) {
        const { records } = await institutionsResp.json();
        records.forEach((r: any) => {
          institutionsMap[r.id] = r.fields['Employeur'] || `Etab ${r.id}`;
          institutionsUaiMap[r.id] = r.fields['UAI'] || '';
        });
      }

      // 4. Fetch the researchers
      const recordsResp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
      if (!recordsResp.ok) throw new Error('Erreur Grist');
      const { records } = await recordsResp.json();
      if (!records || records.length === 0) return [];

      // 5. Mapper
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
          employer: employerKind, hasRealUid, ldapEtat,
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

      const researchers = validation.success ? validation.data : researchersGrouped as Researcher[];
      memoryCache.researchers = { updatedAt: remoteUpdatedAt, data: researchers };
      return researchers;
    } catch (error) {
      console.error('Grist Sync Error:', error);
      return memoryCache.researchers?.data ?? [];
    }
  },

  /**
   * Fetches the list of structures with cache handling.
   */
  fetchStructures: async (force = false): Promise<Structure[]> => {
    try {
      const remoteUpdatedAt = await GristService.getDocUpdatedAt();
      const cached = memoryCache.structures;
      if (!force && cached && cached.updatedAt === remoteUpdatedAt) {
        console.log('Using cached structures...');
        return cached.data;
      }

      console.log('Fetching fresh structures from Grist...');
      // V2 « Structures » table: mirrors structures.csv of the CRISalid directory bridge.
      const resp = await fetch(`${gristDocUrl()}/tables/Structures/records`);
      if (!resp.ok) throw new Error('Erreur Structures Grist');
      const { records } = await resp.json();
      if (!records || records.length === 0) return [];

      const { getTutelleName } = await import('./uaiMapping');

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
      memoryCache.structures = { updatedAt: remoteUpdatedAt, data: structures };
      return structures;
    } catch (error) {
      console.error('Grist Structures Sync Error:', error);
      return memoryCache.structures?.data ?? [];
    }
  },

  /** Employing institutions (record dropdown + name → rowId resolution). */
  fetchInstitutions: (): Promise<Institution[]> => fetchInstitutionsInternal(),

  createResearcher: async (researcher: Researcher): Promise<void> => {
    const encodeDate = await fuzzyDateCellEncoder();
    const fields = {
      'Nom': researcher.lastName,
      'Prenom': researcher.firstName,
      'Civilite': researcher.civility,
      'uid_dyna': researcher.uid,
      'Email': researcher.email,
      'Nationalite': researcher.nationality,
      'DATE_DE_NAISSANCE_JJ_MM_AAAA': toGristDateCell(researcher.birthDate),
      // Affiliations: LABO (text, acronym) + Employeur (Reference, resolved by label)
      'LABO': researcher.affiliations[0]?.structureName || '',
      ...(await employerToGristFields(researcher.employment.employer)),
      'team': researcher.affiliations[0]?.team || '',
      [AFFILIATION_START_COL]: encodeDate(AFFILIATION_START_COL, researcher.affiliations[0]?.startDate),
      [AFFILIATION_END_COL]: encodeDate(AFFILIATION_END_COL, researcher.affiliations[0]?.endDate),
      [MEMBERSHIP_TYPE_COL]: researcher.affiliations[0]?.membershipType || null,
      'employment_start_date': encodeDate('employment_start_date', researcher.employment.startDate),
      'employment_end_date': encodeDate('employment_end_date', researcher.employment.endDate),
      'Corps_grade': researcher.employment.grade || null,
      'TYPE_EMPLOI': researcher.employment.contractType || null,
      ...(await fteCellFields(researcher.employment)),
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
        ...(await hrIdCellFields(researcher.hrId)),
      } : {}),
    };

    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ records: [{ fields }] })
    });

    if (!resp.ok) throw new Error('Erreur CREATE Grist');
  },

  updateResearcher: async (researcher: Researcher): Promise<void> => {
    // Grist writes go by row number (gristRowId); the public id (uid/ext_) does not allow it.
    // Fallback to the old `G-<rowId>` id format for caches possibly older than the uid pivot.
    const gristId = researcher.gristRowId
      ?? (researcher.id.startsWith('G-') ? parseInt(researcher.id.slice(2)) : NaN);
    if (!gristId || isNaN(gristId)) throw new Error(t`Invalid Grist ID (gristRowId missing)`);
    const encodeDate = await fuzzyDateCellEncoder();

    // One Annuaire row per membership (grouped back by groupQualifiedRows on read): before
    // 2026-09-25 only affiliations[0] was written, every other membership entered was silently lost.
    const uid = String(researcher.uid || '').trim();
    const siblings = uid
      ? (await GristService.fetchAnnuaireRowsByUid(uid)).filter((r) => r.rowId !== gristId)
      : [];
    const qualified = siblings.filter((r) => String(r.fields[RATTACHEMENT_COL] || '').trim()).map((r) => r.rowId);
    const plan = planAffiliationRows(gristId, researcher.affiliations || [], qualified, new Date().toISOString().slice(0, 10));
    if (plan.patches.length + plan.creates.length > 0) {
      if (!uid) throw new Error(t`Several affiliations can only be saved for a person with a directory identifier (uid_dyna).`);
      if (qualified.length < siblings.length) {
        throw new Error(t`This person has other directory rows not yet qualified: resolve them on the Duplicates page before adding an affiliation.`);
      }
      await ensureAffiliationColumns();
    }
    const membershipFields = (a: Affiliation | undefined) => ({
      'LABO': a?.structureName || '',
      'team': a?.team || '',
      [AFFILIATION_START_COL]: encodeDate(AFFILIATION_START_COL, a?.startDate),
      [AFFILIATION_END_COL]: encodeDate(AFFILIATION_END_COL, a?.endDate),
      [MEMBERSHIP_TYPE_COL]: a?.membershipType || null,
    });

    const fields = {
      'Nom': researcher.lastName,
      'Prenom': researcher.firstName,
      'Civilite': researcher.civility,
      'Email': researcher.email,
      'Nationalite': researcher.nationality,
      'DATE_DE_NAISSANCE_JJ_MM_AAAA': toGristDateCell(researcher.birthDate),
      // Affiliations: LABO (text, acronym) + Employeur (Reference, resolved by label)
      ...membershipFields(plan.primary),
      ...(plan.mainRole !== undefined ? { [RATTACHEMENT_COL]: plan.mainRole || null } : {}),
      ...(await employerToGristFields(researcher.employment.employer)),
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
      ...(await fteCellFields(researcher.employment)),
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

    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ records: [{ id: gristId, fields }] })
    });

    if (!resp.ok) throw new Error('Erreur UPDATE Grist');

    const headers = { 'Content-Type': 'application/json' };
    if (plan.patches.length > 0) {
      const pr = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ records: plan.patches.map((p) => ({
          id: p.rowId, fields: { ...membershipFields(p.affiliation), [RATTACHEMENT_COL]: p.role },
        })) }),
      });
      if (!pr.ok) throw new Error(t`Grist error (writing the secondary affiliations): ${await pr.text()}`);
    }
    if (plan.creates.length > 0) {
      // Identity copied on creation only: an existing row (from a merge) keeps its own values.
      const identity = {
        'uid_dyna': uid,
        'Nom': researcher.lastName,
        'Prenom': researcher.firstName,
        'Civilite': researcher.civility,
        'Email': researcher.email,
        'ORCID': researcher.identifiers.orcid || null,
        'IdRef': researcher.identifiers.idref || null,
        'IdHAL': researcher.identifiers.halId || null,
        'ID_SCOPUS': researcher.identifiers.scopusId || null,
      };
      const cr = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
        method: 'POST', headers,
        body: JSON.stringify({ records: plan.creates.map((c) => ({
          fields: { ...identity, ...membershipFields(c.affiliation), [RATTACHEMENT_COL]: c.role },
        })) }),
      });
      if (!cr.ok) throw new Error(t`Grist error (creating the secondary affiliations): ${await cr.text()}`);
    }
    if (plan.deletes.length > 0) {
      // Snapshot in Fusions_log before deleting (restorable like a merge).
      await ensureMergeLogTable();
      const keep = { rowId: gristId, fields: { uid_dyna: uid, Nom: researcher.lastName, Prenom: researcher.firstName } };
      const logs = siblings.filter((r) => plan.deletes.includes(r.rowId)).map((drop) => ({
        fields: buildMergeLogRow({ keep, drop, patch: {}, author: 'druid', note: 'affiliation removed from the record' }),
      }));
      const lr = await fetch(`${gristDocUrl()}/tables/${MERGE_LOG_TABLE}/records`, {
        method: 'POST', headers, body: JSON.stringify({ records: logs }),
      });
      if (!lr.ok) throw new Error(t`Grist error (merge log): ${await lr.text()}`);
      const dr = await fetch(`${gristDocUrl()}/tables/Annuaire/data/delete`, {
        method: 'POST', headers, body: JSON.stringify(plan.deletes),
      });
      if (!dr.ok) throw new Error(t`Grist error (deleting the removed affiliations): ${await dr.text()}`);
    }
  },

  /**
   * Persists membership in functional groups (`groupes` column of the
   * Annuaire, names separated by « | »). Grouped PATCH by gristRowId on this
   * single column — does not touch the other fields of the records.
   */
  updateResearcherGroups: async (
    entries: Array<{ gristRowId: number; groups: string[] }>,
  ): Promise<void> => {
    const records = entries
      .filter((e) => e.gristRowId && !Number.isNaN(e.gristRowId))
      .map((e) => ({ id: e.gristRowId, fields: { groupes: e.groups.join('|') } }));
    if (records.length === 0) return;

    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records }),
    });
    if (!resp.ok) {
      throw new Error(
        t`Error saving the groups — does the \`groupes\` column exist in the Annuaire? (provisioning: node scripts/add_groups_column.cjs --apply)`,
      );
    }
  },

  /**
   * Persists the confirmed OpenAlex author ID (name resolution of members
   * without ORCID, group dashboards). Single-column PATCH by gristRowId.
   */
  updateResearcherOpenalexId: async (gristRowId: number, openalexId: string): Promise<void> => {
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [{ id: gristRowId, fields: { openalex_author_id: openalexId } }],
      }),
    });
    if (!resp.ok) {
      throw new Error(
        t`Error saving the author ID — does the \`openalex_author_id\` column exist in the Annuaire? (provisioning: node scripts/add_groups_column.cjs --apply)`,
      );
    }
  },

  /**
   * Applies a validation layer to several records in bulk (import of a
   * reliable list). Grouped PATCH on the validation columns only, by
   * gristRowId — does not touch the other fields of the record.
   */
  applyValidation: async (
    entries: Array<{ gristRowId: number; validation: ValidationInfo }>,
  ): Promise<void> => {
    const records = entries
      .filter((e) => e.gristRowId && !Number.isNaN(e.gristRowId))
      .map((e) => ({ id: e.gristRowId, fields: validationToGristFields(e.validation, toGristDateCell) }));
    if (records.length === 0) return;

    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records }),
    });
    if (!resp.ok) throw new Error('Erreur APPLY VALIDATION Grist');
  },

  /**
   * ABES export (docs/plan-export-abes-idref.md) — fingerprints of the rows already sent:
   * uid_dyna → { hash, date } (ABES_export_hash / ABES_export_date columns, created by
   * scripts/add_abes_columns.cjs; missing ⇒ empty object).
   */
  fetchAbesSent: async (): Promise<Record<string, { hash: string; date: string }>> => {
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error('Erreur Grist (Annuaire)');
    const { records } = await resp.json();
    const out: Record<string, { hash: string; date: string }> = {};
    for (const r of records || []) {
      const f = r.fields || {};
      const hash = String(f['ABES_export_hash'] || '');
      if (!hash) continue;
      out[f['uid_dyna'] || `g${r.id}`] = { hash, date: String(f['ABES_export_date'] || '') };
    }
    return out;
  },

  /** Flags records as sent to ABES (fingerprint + date), by Grist row number. */
  markAbesSent: async (entries: Array<{ gristRowId: number; hash: string }>, date: string): Promise<number> => {
    const records = entries
      .filter((e) => e.gristRowId && !Number.isNaN(e.gristRowId))
      .map((e) => ({ id: e.gristRowId, fields: { ABES_export_hash: e.hash, ABES_export_date: date } }));
    for (let i = 0; i < records.length; i += 200) {
      const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: records.slice(i, i + 200) }),
      });
      if (!resp.ok) throw new Error(`Erreur Grist (marquage ABES) : ${await resp.text()}`);
    }
    return records.length;
  },

  /** Local id of a structure created from Druid when no entity code (supannCodeEntite) is entered: `T-<LABO>-<SIGLE>` for a
   * team (convention already in place in the table, e.g. T-GEM-MULTIX), `D-<SIGLE>` otherwise. */
  makeLocalId: (structure: Pick<Structure, 'level' | 'acronym' | 'parentStructure'>): string => {
    const slug = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return String(structure.level) === StructureLevel.EQUIPE
      ? `T-${slug(structure.parentStructure || '')}-${slug(structure.acronym)}`
      : `D-${slug(structure.acronym)}`;
  },

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
   * Creates a structure in the Grist « Structures » table (« Nouvelle structure » page, or
   * « Ajouter une équipe… » entry of the researcher record's Team menu). The `local_id` is the entity code
   * entered on creation (supannCodeEntite), otherwise generated (makeLocalId);
   * for a team, `parent_structure` = lab and `inclusions` = `local-<lab local_id>` (consistent with
   * structures.csv / cdb). Refuses a duplicate acronym + lab. Returns the Druid id `S-<rowId>`.
   */
  createStructure: async (structure: Structure, allStructures: Structure[] = []): Promise<string> => {
    const acronym = String(structure.acronym || '').trim();
    if (!acronym) throw new Error(t`The acronym / short name is required`);
    const level = String(structure.level);
    const parent = String(structure.parentStructure || '').trim();
    if (level === StructureLevel.EQUIPE && !parent) throw new Error(t`A team must be included in a lab (Memberships tab)`);
    const norm = (s: string) => String(s || '').trim().toUpperCase();
    // Duplicate = same acronym at the same level (a team and a lab often share an acronym); for a
    // team, within the same lab (review lot 2, finding 10).
    const dup = allStructures.find((s) => norm(s.acronym) === norm(acronym) && String(s.level) === level
      && (level !== StructureLevel.EQUIPE || norm(s.parentStructure || '') === norm(parent)));
    if (dup) throw new Error(t`A structure “${dup.acronym}” already exists${level === StructureLevel.EQUIPE ? t` in ${parent}` : ''}`);
    const lab = level === StructureLevel.EQUIPE ? allStructures.find((s) => norm(s.acronym) === norm(parent) && String(s.level) === StructureLevel.ENTITE) : undefined;
    const today = new Date().toISOString().slice(0, 10);
    const inclusions: Membership[] = (structure.inclusions && structure.inclusions.length)
      ? structure.inclusions
      : lab?.localId ? [{ refType: 'local', ref: lab.localId, startDate: today }] : [];
    const genericType = level === StructureLevel.EQUIPE ? 'team' : level === StructureLevel.ETABLISSEMENT ? 'institution' : 'unit';
    const type = String(structure.type || '').trim() || (level === StructureLevel.EQUIPE ? 'TEAM' : '');
    const localId = resolveNewStructureLocalId(structure.localId,
      () => GristService.makeLocalId({ level: structure.level, acronym, parentStructure: parent }));
    if (allStructures.some((s) => s.localId === localId)) throw new Error(t`local_id “${localId}” already used`);
    const rawScopus = structure.identifiers?.scopusId;
    const scopusNum = rawScopus ? Number(rawScopus) : null;
    const fields = {
      'generic_type': genericType,
      'type': type,
      'local_id': localId,
      'parent_structure': parent,
      'short_labels': encodeMultiLabel(acronym),
      'long_labels': encodeMultiLabel(structure.officialName || acronym),
      'descriptions': encodeMultiLabel(structure.description || ''),
      'nns': structure.rnsrId || '',
      'web': structure.website || '',
      'ror': structure.rorId || '',
      'hal_collection': structure.halCollectionUrl || '',
      'scopus': Number.isFinite(scopusNum) ? scopusNum : null,
      'signature': (structure as any).signature || '',
      'uai': structure.identifiers?.uai || '',
      'isni': structure.identifiers?.isni || '',
      'wikidata': structure.identifiers?.wikidata || '',
      'inclusions': serializeMembershipList(inclusions),
      'participations': serializeMembershipList(structure.participations || []),
      'main_mission': missionToV2(structure.primaryMission),
      'secondary_missions': missionToV2(structure.secondaryMission),
      'erc_research_field': (structure as any).ercField || '',
      'hceres_research_areas': (structure as any).hceresAreas || '',
      'campus': (structure as any).campus || '',
    };
    const resp = await fetch(`${gristDocUrl()}/tables/Structures/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields }] }),
    });
    if (!resp.ok) throw new Error(t`Error creating the Grist structure: ${await resp.text()}`);
    const data = await resp.json().catch(() => ({}));
    const rowId = data?.records?.[0]?.id;
    return rowId ? `S-${rowId}` : NEW_STRUCTURE_ID;
  },

  updateStructure: async (structure: any): Promise<void> => {
    const gristId = parseInt(structure.id.replace('S-', ''));
    if (isNaN(gristId)) throw new Error(t`Invalid ID`);

    // Write to the V2 « Structures » table. Only the fields present in the V2 schema
    // are persisted; the fields without equivalent (city, address, director, level,
    // nature, status, dates, lineage) are not written back — the table is otherwise
    // fed by structures.csv of the directory bridge.
    const rawScopus = structure.identifiers?.scopusId;
    const scopusNum = rawScopus ? Number(rawScopus) : null;
    const fields = {
      'type': structure.type,
      'parent_structure': structure.parentStructure || '',
      'short_labels': encodeMultiLabel(structure.acronym),
      'long_labels': encodeMultiLabel(structure.officialName),
      'descriptions': encodeMultiLabel(structure.description),
      'nns': structure.rnsrId,
      'web': structure.website,
      'ror': structure.rorId,
      'hal_collection': structure.halCollectionUrl,
      'scopus': Number.isFinite(scopusNum) ? scopusNum : null,
      'signature': structure.signature,
      // Identifiants tiers V2
      'uai': structure.identifiers?.uai || '',
      'isni': structure.identifiers?.isni || '',
      'wikidata': structure.identifiers?.wikidata || '',
      // Memberships: re-encoding of both families to the V2 columns.
      'inclusions': serializeMembershipList(structure.inclusions),
      'participations': serializeMembershipList(structure.participations),
      // Missions & themes
      'main_mission': missionToV2(structure.primaryMission),
      'secondary_missions': missionToV2(structure.secondaryMission),
      'erc_research_field': structure.ercField || '',
      'hceres_research_areas': structure.hceresAreas || '',
      'campus': structure.campus || ''
    };

    const resp = await fetch(`${gristDocUrl()}/tables/Structures/records`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ records: [{ id: gristId, fields }] })
    });

    if (!resp.ok) throw new Error('Erreur UPDATE Structure Grist');
  },

  /**
   * Phase 1 (READ ONLY): computes the gap between the LDAP cache and the Annuaire table.
   * Writes NOTHING to Grist — serves as a review preview before a future application (Phase 2).
   */
  /** « Doublons » page (docs/archive/plan-reorganisation-sync-ldap.md, lot 3): uid_dyna groups computed
   * on the Annuaire alone — no LDAP run needed, unlike computeLdapDiff. */
  computeDuplicatesDiff: async (): Promise<DuplicatesDiff> => {
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error('Erreur Grist (Annuaire)');
    const { records } = await resp.json();
    const { doublonsUid, duplicatesByKind } = computeDuplicateGroups(records);
    return {
      generatedAt: new Date().toISOString(),
      stats: { gristTotal: records.length, pending: doublonsUid.filter((d) => !d.qualified).length, qualified: doublonsUid.filter((d) => d.qualified).length, parKind: duplicatesByKind },
      doublonsUid,
    };
  },

  computeLdapDiff: async (): Promise<LdapDiff> => {
    // 1. LDAP cache (regenerated beforehand by /api/sync-ldap-trigger)
    let ldapCache: Record<string, any> = {};
    try {
      const ldapResp = await fetch('/ldap_status_cache.json', { cache: 'no-store' });
      if (ldapResp.ok) ldapCache = await ldapResp.json();
    } catch (e) {
      console.warn('LDAP cache not found');
    }

    // 2. Annuaire (raw Grist values) + Etablissements (employer: external ≠ Nantes Université)
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error('Erreur Grist (Annuaire)');
    const etabs: Record<number, { name: string; uai: string }> = {};
    try {
      const er = await fetch(`${gristDocUrl()}/tables/Etablissements/records`);
      if (er.ok) for (const r of (await er.json()).records) etabs[r.id] = { name: String(r.fields['Employeur'] || ''), uai: String(r.fields['UAI'] || '') };
    } catch (e) { console.warn('Etablissements unreadable — external employers not detected'); }
    const hasExternalEmployer = (f: any): boolean => {
      const id = f['Employeur'];
      const e = (typeof id === 'number') ? etabs[id] : undefined;
      return e ? isExternalEmployer(e.name, e.uai) : isExternalEmployer(typeof id === 'number' ? '' : id, '');
    };
    const { records } = await resp.json();

    const fmtBirth = (b: string): string => {
      if (!b) return '';
      return /^\d{8}$/.test(b) ? `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}` : b;
    };
    const nameOf = (f: any) => `${(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim();

    // Index uid_dyna -> records
    const byUid: Record<string, any[]> = {};
    for (const rec of records) {
      const uid = rec.fields['uid_dyna'];
      if (uid) (byUid[uid] = byUid[uid] || []).push(rec);
    }

    const aMettreAJour: LdapDiff['aMettreAJour'] = [];
    const orphelins: LdapDiff['orphelins'] = [];

    // uid_dyna duplicates (same uid on ≥2 records): same computation as the « Doublons » page
    // (computeDuplicateGroups, on the Annuaire alone), kept here for the diff counters.
    const { doublonsUid, duplicatesByKind } = computeDuplicateGroups(records);

    // Diff per matched LDAP entry — on EVERY row carrying the uid (a duplicated or
    // multi-affiliated person has several records; before, only the 1st was compared
    // and the others stayed stale).
    for (const [uid, entry] of Object.entries(ldapCache)) {
      const recs = byUid[uid];
      if (!recs || recs.length === 0) continue;
      const e: any = entry;
      for (const rec of recs) {
        const f = rec.fields;
        const changes: LdapFieldChange[] = [];
        const push = (field: string, label: string, before: any, after: any) => {
          const b = (before ?? '').toString().trim();
          const a = (after ?? '').toString().trim();
          if (a && a !== b) changes.push({ field, label, before: b, after: a }); // never clear when LDAP is empty
        };
        // External employer (INSERM, CNRS, Centrale…) with a hosted LDAP account: the LDAP state,
        // employment end, category (« CDI UNIVERSITE ») and corps describe the account, not the
        // actual job → only civility and birth date are proposed; derived status EXTERNE.
        const externalEmployer = hasExternalEmployer(f);
        push('Civilite', 'Civilité', normalizeCivility(f['Civilite'] || f['Civilité'] || ''), normalizeCivility(e.civilite || ''));
        if (!externalEmployer) {
          // Grade: LDAP corps, transposed to an emeritus code when a trace of emeritus status exists (LDAP or Grist) —
          // otherwise the sync proposed PR/MCF again for an emeritus (LDAP keeps the original corps).
          const ldapBase = ldapGradeFor(e.categorie, e.empCorps, f['Corps_grade']);
          const gradeSignals: EmeritusSignals = { grade: f['Corps_grade'], typeEmploi: f['TYPE_EMPLOI'], libTypeEmploi: f['LIB_TYPE_EMPLOI'], ldapCategory: e.categorie };
          const gradeTarget = hasEmeritusTrace(gradeSignals) ? resolveGrade(ldapBase ?? f['Corps_grade'] ?? '', gradeSignals) : (ldapBase || '');
          push('Corps_grade', 'Grade', f['Corps_grade'] || '', gradeTarget);
          push('TYPE_EMPLOI', 'Type emploi', f['TYPE_EMPLOI'] || '', e.categorie || '');
        }
        push('DATE_DE_NAISSANCE_JJ_MM_AAAA', 'Date naissance', fromGristDate(f['DATE_DE_NAISSANCE_JJ_MM_AAAA']), fmtBirth(e.birthDate || ''));
        // Employment end: « [datefin=…] » of supannEmpProfil (`dateFin` cache, YYYY-MM-DD). Added on
        // 2026-09-15: before, an LDAP departure never surfaced the date in employment_end_date.
        if (!externalEmployer) push('employment_end_date', "Fin d'emploi", fromGristFuzzyDate(f['employment_end_date']), e.dateFin || '');
        // HR staff number (supannEmpId, lib/hrId.ts): for hosted accounts too — it identifies the person, not the job.
        const hrId = hrIdProposal(f[HR_ID_COLUMN], e.empId);
        if (hrId) changes.push({ field: HR_ID_COLUMN, label: 'N° agent', before: hrId.before, after: hrId.after });
        // Status: Grist stores a label ("NORMAL"), LDAP a code ("N") → compare on the code,
        // and propose the mapped label as the target value. (statut_dyna made editable on the Grist side.)
        const statutCode = (v: any) => (v ?? '').toString().trim().toUpperCase().charAt(0);
        if (!externalEmployer && e.etat && statutCode(f['statut_dyna']) !== statutCode(e.etat)) {
          changes.push({
            field: 'statut_dyna',
            label: 'Statut (dynaEtat)',
            before: (f['statut_dyna'] || '').toString().trim(),
            after: STATUT_DYNA_MAP[String(e.etat).toUpperCase()] || String(e.etat),
          });
        }
        // Manually validated status contradicted by LDAP (e.g. « INTERNE validé » from a lab
        // website, but dynaEtat = D): the record displays the validated status, so the departure stays
        // invisible until the validation is aligned. Proposed as a change to arbitrate (conflict).
        const v = parseValidation(f, fromGristDate);
        if (e.etat && v.validated && v.validationScope.includes('statut') && v.validatedStatus) {
          const derived = externalEmployer ? ResearcherStatus.EXTERNE : statusFromEtat(e.etat);
          if (v.validatedStatus !== derived) {
            changes.push({ field: 'validated_status', label: 'Statut validé', before: v.validatedStatus, after: derived });
          }
        }
        if (changes.length) {
          // Validation guard: if the record is validated on the status, an LDAP status
          // change becomes a conflict to arbitrate (LDAP must not overwrite).
          const validationConflict =
            v.validated && v.validationScope.includes('statut')
            && changes.some((c) => c.field === 'statut_dyna' || c.field === 'validated_status');
          aMettreAJour.push({
            id: `G-${rec.id}`, uid, displayName: nameOf(f), changes,
            labo: recs.length > 1 ? String(f['LABO'] || '').trim() : undefined,
            validated: v.validated, validationConflict,
            hrIdConflict: hrId?.kind === 'conflict',
          });
        }
      }
    }

    // Orphans: Grist record whose uid_dyna is no longer in LDAP
    for (const [uid, recs] of Object.entries(byUid)) {
      if (!ldapCache[uid]) {
        for (const rec of recs) {
          const v = parseValidation(rec.fields, fromGristDate);
          orphelins.push({ id: `G-${rec.id}`, uid, displayName: nameOf(rec.fields), validated: v.validated });
        }
      }
    }

    // LDAP uid without Annuaire record
    const ldapWithoutRecord = Object.keys(ldapCache).filter((uid) => !byUid[uid]);

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        ldapTotal: Object.keys(ldapCache).length,
        gristTotal: records.length,
        aMettreAJour: aMettreAJour.length,
        doublonsUid: doublonsUid.filter((d) => !d.qualified).length,
        qualifiedDuplicates: doublonsUid.filter((d) => d.qualified).length,
        duplicatesByKind,
        orphelins: orphelins.length,
        ldapWithoutRecord: ldapWithoutRecord.length,
      },
      aMettreAJour,
      doublonsUid,
      orphelins,
      ldapWithoutRecord,
    };
  },

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
  qualifyDoublon: async (args: {
    rowIds: number[]; principalRowId?: number; mode: 'concomitant' | 'successif' | 'a_revoir'; endDate?: string; author: string;
  }): Promise<{ updated: number }> => {
    const { rowIds, principalRowId, mode, endDate, author } = args;
    if (mode !== 'a_revoir' && (principalRowId === undefined || !rowIds.includes(principalRowId))) {
      throw new Error(t`Qualification: primary row required`);
    }
    await ensureAffiliationColumns();
    const encodeDate = await fuzzyDateCellEncoder();
    const today = new Date().toISOString().slice(0, 10);
    const decision = `${mode === 'a_revoir' ? 'A_REVOIR' : mode === 'concomitant' ? 'CONCOMITANT' : 'SUCCESSIF'} ${today} ${author}`;
    const rows = await GristService.fetchAnnuaireRows(rowIds);
    const records = rows.map((r) => {
      const fields: Record<string, any> = { [DUPLICATE_DECISION_COL]: decision };
      if (mode === 'a_revoir') {
        fields[RATTACHEMENT_COL] = null;
      } else if (r.rowId === principalRowId) {
        fields[RATTACHEMENT_COL] = 'PRINCIPAL';
      } else {
        fields[RATTACHEMENT_COL] = mode === 'concomitant' ? 'SECONDAIRE' : 'HISTORIQUE';
        // Successive affiliation: the end of the old row is a lab MEMBERSHIP end
        // (affiliation_end_date), not an employment end — before 2026-09-14 it was written to
        // employment_end_date (fallback kept when reading).
        if (mode === 'successif' && endDate && !r.fields[AFFILIATION_END_COL] && !r.fields['employment_end_date']) {
          const cell = encodeDate(AFFILIATION_END_COL, endDate);
          if (cell !== null) fields[AFFILIATION_END_COL] = cell;
        }
      }
      return { id: r.rowId, fields };
    });
    // Different column signatures possible (employment_end_date) → one PATCH per row.
    for (const rec of records) {
      const pr = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [rec] }),
      });
      if (!pr.ok) throw new Error(`Erreur Grist (qualification G-${rec.id}) : ${await pr.text()}`);
    }
    return { updated: records.length };
  },

  /** Removes the qualification of a group (roles and decision cleared) → it becomes a pending duplicate again. */
  unqualifyDoublon: async (rowIds: number[]): Promise<{ updated: number }> => {
    await ensureAffiliationColumns();
    const pr = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: rowIds.map((id) => ({ id, fields: { [RATTACHEMENT_COL]: null, [DUPLICATE_DECISION_COL]: '' } })) }),
    });
    if (!pr.ok) throw new Error(t`Grist error (de-qualification): ${await pr.text()}`);
    return { updated: rowIds.length };
  },

  /** Annuaire columns (label, type, formula) — for the merge assistant. */
  fetchAnnuaireColumns: (): Promise<AnnuaireColumnMeta[]> => fetchAnnuaireColumnsInternal(),

  /** Raw Annuaire rows (unconverted Grist values) for given rowIds. */
  fetchAnnuaireRows: async (rowIds: number[]): Promise<{ rowId: number; fields: Record<string, any> }[]> => {
    const filter = encodeURIComponent(JSON.stringify({ id: rowIds }));
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records?filter=${filter}`);
    if (!resp.ok) throw new Error('Erreur Grist (lecture Annuaire)');
    const { records } = await resp.json();
    return records.map((r: any) => ({ rowId: r.id, fields: r.fields }));
  },

  /** Raw Annuaire rows of a person (every row sharing this uid_dyna). */
  fetchAnnuaireRowsByUid: async (uid: string): Promise<{ rowId: number; fields: Record<string, any> }[]> => {
    const filter = encodeURIComponent(JSON.stringify({ uid_dyna: [uid] }));
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records?filter=${filter}`);
    if (!resp.ok) throw new Error('Erreur Grist (lecture Annuaire)');
    const { records } = await resp.json();
    return records.map((r: any) => ({ rowId: r.id, fields: r.fields }));
  },

  /**
   * Moves a record to its LDAP uid (`annuaire_uid_ldap` task, docs/plan-statut-employeur-ldap.md,
   * lot 2): every row of `fromUid` (or the single row `rowId` of a record without uid) gets
   * `uid_dyna = toUid`, with a dated line in Commentaires keeping the former uid. Refused when a row
   * already carries `toUid` — that case is a merge.
   */
  switchAnnuaireUid: async (args: { fromUid: string; rowId?: number; toUid: string; author: string }): Promise<{ updated: number }> => {
    const { fromUid, rowId, toUid, author } = args;
    if (!toUid || toUid.startsWith('ext_')) throw new Error(t`Invalid LDAP uid: ${toUid}`);
    if ((await GristService.fetchAnnuaireRowsByUid(toUid)).length) {
      throw new Error(t`The uid ${toUid} already has a directory record: merge the two records instead`);
    }
    const rows = fromUid ? await GristService.fetchAnnuaireRowsByUid(fromUid) : rowId ? await GristService.fetchAnnuaireRows([rowId]) : [];
    if (!rows.length) throw new Error(t`Record not found in Grist (uid ${fromUid || '—'})`);
    const today = new Date().toISOString().slice(0, 10);
    const note = `[${today}] uid ${fromUid || '(vide)'} → ${toUid} (n° agent = compte LDAP), par ${author}`;
    const records = rows.map((r) => {
      const com = String(r.fields['Commentaires'] || '').trimEnd();
      return { id: r.rowId, fields: { uid_dyna: toUid, Commentaires: com ? `${com}\n${note}` : note } };
    });
    const pr = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }),
    });
    if (!pr.ok) throw new Error(t`Grist error (uid change): ${await pr.text()}`);
    return { updated: records.length };
  },

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
  mergeAnnuaireRows: async (args: {
    keepRowId: number; dropRowId: number; fields: Record<string, any>; author: string; note?: string;
  }): Promise<{ logId: number }> => {
    const { keepRowId, dropRowId, fields, author, note = '' } = args;
    if (keepRowId === dropRowId) throw new Error(t`Merge: both rows are identical`);
    const rows = await GristService.fetchAnnuaireRows([keepRowId, dropRowId]);
    const keep = rows.find((r) => r.rowId === keepRowId);
    const drop = rows.find((r) => r.rowId === dropRowId);
    if (!keep || !drop) throw new Error(t`Merge: one of the rows no longer exists in Grist`);

    // Never write a formula column nor the technical columns.
    const cols = await fetchAnnuaireColumnsInternal();
    const writable = new Set(cols.filter((c) => !c.isFormula).map((c) => c.id));
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) if (writable.has(k)) patch[k] = v;
    await ensureMergeLogTable();
    const headers = { 'Content-Type': 'application/json' };
    const logResp = await fetch(`${gristDocUrl()}/tables/${MERGE_LOG_TABLE}/records`, {
      method: 'POST', headers,
      body: JSON.stringify({ records: [{ fields: buildMergeLogRow({ keep, drop, patch, author, note }) }] }),
    });
    if (!logResp.ok) throw new Error(t`Grist error (merge log): ${await logResp.text()}`);
    const logId: number = (await logResp.json()).records[0].id;

    if (Object.keys(patch).length > 0) {
      const pr = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
        method: 'PATCH', headers, body: JSON.stringify({ records: [{ id: keepRowId, fields: patch }] }),
      });
      if (!pr.ok) throw new Error(t`Grist error (writing the kept row, log #${logId}): ${await pr.text()}`);
    }
    const dr = await fetch(`${gristDocUrl()}/tables/Annuaire/data/delete`, {
      method: 'POST', headers, body: JSON.stringify([dropRowId]),
    });
    if (!dr.ok) throw new Error(t`Grist error (deleting the absorbed row, log #${logId}): ${await dr.text()}`);
    return { logId };
  },

  /** Merge log, most recent first. */
  listMerges: async (limit = 50): Promise<MergeLogEntry[]> => {
    const tablesResp = await fetch(`${gristDocUrl()}/tables`);
    if (!tablesResp.ok) throw new Error(t`Grist error (table list)`);
    const { tables } = await tablesResp.json();
    if (!tables.some((t: any) => t.id === MERGE_LOG_TABLE)) return [];
    const resp = await fetch(`${gristDocUrl()}/tables/${MERGE_LOG_TABLE}/records`);
    if (!resp.ok) throw new Error(t`Grist error (merge log)`);
    const { records } = await resp.json();
    return records
      .map((r: any) => ({
        id: r.id, uid_dyna: r.fields.uid_dyna || '', Nom: r.fields.Nom || '',
        kept_rowid: r.fields.kept_rowid, dropped_rowid: r.fields.dropped_rowid,
        auteur: r.fields.auteur || '', date: r.fields.date || '', note: r.fields.note || '',
        restaure: !!r.fields.restaure, restored_rowid: r.fields.restored_rowid ?? null,
      }))
      .sort((a: MergeLogEntry, b: MergeLogEntry) => b.date.localeCompare(a.date))
      .slice(0, limit);
  },

  /**
   * Undoes a merge: recreates the absorbed row from its snapshot (new rowId —
   * the old one does not come back, Druid URLs use the uid) and restores the previous
   * values of the fields written on the kept row.
   */
  restoreFusion: async (logId: number): Promise<{ restoredRowId: number }> => {
    const headers = { 'Content-Type': 'application/json' };
    const filter = encodeURIComponent(JSON.stringify({ id: [logId] }));
    const resp = await fetch(`${gristDocUrl()}/tables/${MERGE_LOG_TABLE}/records?filter=${filter}`);
    if (!resp.ok) throw new Error(t`Grist error (merge log)`);
    const rec = (await resp.json()).records[0];
    if (!rec) throw new Error(t`Merge #${logId} not found`);
    if (rec.fields.restaure) throw new Error(t`Merge #${logId} already restored`);

    const cols = await fetchAnnuaireColumnsInternal();
    const writable = new Set(cols.filter((c) => !c.isFormula).map((c) => c.id));
    const dropped = JSON.parse(rec.fields.dropped_json || '{}');
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(dropped)) if (writable.has(k) && v !== null) fields[k] = v;
    const cr = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
      method: 'POST', headers, body: JSON.stringify({ records: [{ fields }] }),
    });
    if (!cr.ok) throw new Error(t`Grist error (re-creating the row): ${await cr.text()}`);
    const restoredRowId: number = (await cr.json()).records[0].id;

    // The log is flagged AS SOON AS the row is recreated (and its PATCH checked): otherwise a later
    // failure left `restaure=false` and a second click recreated the row a second time (review lot 2,
    // finding 6). The next steps raise an explicit error without undoing what is done.
    const lr = await fetch(`${gristDocUrl()}/tables/${MERGE_LOG_TABLE}/records`, {
      method: 'PATCH', headers, body: JSON.stringify({ records: [{ id: logId, fields: { restaure: true, restored_rowid: restoredRowId } }] }),
    });
    if (!lr.ok) {
      throw new Error(t`Row re-created (#${restoredRowId}) but merge log not updated: ${await lr.text()} — do not restart the restoration`);
    }
    const before = JSON.parse(rec.fields.kept_before_json || '{}');
    if (Object.keys(before).length > 0) {
      const pr = await fetch(`${gristDocUrl()}/tables/Annuaire/records`, {
        method: 'PATCH', headers, body: JSON.stringify({ records: [{ id: rec.fields.kept_rowid, fields: before }] }),
      });
      if (!pr.ok) {
        throw new Error(t`Row re-created (#${restoredRowId}) but kept row #${rec.fields.kept_rowid} not restored: ${await pr.text()}`);
      }
    }
    return { restoredRowId };
  },

  applyLdapUpdates: async (diff: LdapDiff, selectedIds: string[]): Promise<{ updated: number }> => {
    const selected = new Set(selectedIds);
    const entries = diff.aMettreAJour.filter((r) => selected.has(r.id));
    if (entries.length === 0) return { updated: 0 };

    // Current values (to append to Data_source / Commentaires without overwriting)
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error(t`Grist error (reading the Annuaire before writing)`);
    const { records } = await resp.json();
    const byId: Record<number, any> = {};
    records.forEach((r: any) => { byId[r.id] = r.fields; });

    const today = new Date().toISOString().slice(0, 10);
    const encodeDate = await fuzzyDateCellEncoder();

    const patchRecords = entries.map((e) => {
      const gid = parseInt(e.id.replace('G-', ''));
      const cur = byId[gid] || {};
      const fields: Record<string, any> = {};

      for (const c of e.changes) {
        if (c.field === 'employment_end_date') {
          const cell = encodeDate(c.field, c.after);   // fuzzy-date column (text once migrated, else epoch)
          if (cell !== null) fields[c.field] = cell;
        } else if (c.field === 'DATE_DE_NAISSANCE_JJ_MM_AAAA') {
          const ep = toGristEpoch(c.after);
          if (ep !== null) fields[c.field] = ep; // Date column = epoch seconds
        } else if (c.field === HR_ID_COLUMN) {
          fields[c.field] = hrIdCell(c.after);   // Numeric column
        } else if (c.field === 'validated_status') {
          // Explicit arbitration (record checked despite the conflict): the validated status follows LDAP,
          // the validation is re-dated; original source and author kept (traceability).
          fields[c.field] = c.after;
          fields['validation_date'] = toGristEpoch(today);
        } else {
          fields[c.field] = c.after; // Civilite/Corps_grade (Choice), TYPE_EMPLOI/statut_dyna (Text)
        }
      }

      // Traceability
      const curSrc = (cur['Data_source'] || '').toString();
      const hasLdap = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).includes('LDAP');
      fields['Data_source'] = hasLdap ? curSrc : (curSrc ? `${curSrc}|LDAP` : 'LDAP');
      fields['LDAP_derniere_maj'] = today;
      fields['LDAP_champs_modifies'] = e.changes.map((c) => c.field).join('|');
      const note = `[${today}] MAJ LDAP: ${e.changes.map((c) => c.label).join(', ')}`;
      const curCom = (cur['Commentaires'] || '').toString();
      fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;

      return { id: gid, fields };
    });

    // The Grist API requires every record of one PATCH to have EXACTLY the same
    // set of columns ("PATCH requires all records to have same fields").
    // As the modified fields vary from one record to the next, we group by key
    // signature, then send each group in batches of 100.
    const groups = new Map<string, { id: number; fields: Record<string, any> }[]>();
    for (const rec of patchRecords) {
      const sig = Object.keys(rec.fields).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(rec);
    }

    const { updated } = await patchAnnuaireInChunks(groups, 'Erreur PATCH Annuaire');
    return { updated };
  },

  /**
   * « Mark as left » of the LDAP « Arrivals and departures » tab: on every Annuaire row of the uid,
   * statut_dyna = DEPART and employment / membership end = the date the account left (unless an
   * earlier end is already recorded) — both ends past ⇒ the record becomes « Parti »
   * (isDepartureCertain). LDAP traceability as in applyLdapUpdates. `accountLabel` describes the
   * account state for the dated comment line.
   */
  markLdapDeparted: async (uid: string, date: string, accountLabel: string): Promise<{ updated: number }> => {
    const rows = await GristService.fetchAnnuaireRowsByUid(uid);
    if (rows.length === 0) return { updated: 0 };
    const today = new Date().toISOString().slice(0, 10);
    const encodeDate = await fuzzyDateCellEncoder();
    const groups = new Map<string, { id: number; fields: Record<string, any> }[]>();
    for (const { rowId, fields: cur } of rows) {
      const fields: Record<string, any> = {};
      const changed: string[] = [];
      if (String(cur['statut_dyna'] ?? '').trim().toUpperCase().charAt(0) !== 'D') { fields['statut_dyna'] = STATUT_DYNA_MAP.D; changed.push('statut_dyna'); }
      for (const col of ['employment_end_date', AFFILIATION_END_COL]) {
        const end = fromGristFuzzyDate(cur[col]);
        if (end && fuzzyDateUpperBound(end) <= date) continue;
        const cell = encodeDate(col, date);
        if (cell !== null) { fields[col] = cell; changed.push(col); }
      }
      if (changed.length === 0) continue;
      const curSrc = (cur['Data_source'] || '').toString();
      const hasLdap = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).includes('LDAP');
      fields['Data_source'] = hasLdap ? curSrc : (curSrc ? `${curSrc}|LDAP` : 'LDAP');
      fields['LDAP_derniere_maj'] = today;
      fields['LDAP_champs_modifies'] = changed.join('|');
      const note = `[${today}] Départ LDAP : ${accountLabel} depuis le ${date}`;
      const curCom = (cur['Commentaires'] || '').toString();
      fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;
      const sig = Object.keys(fields).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push({ id: rowId, fields });
    }
    const { updated } = await patchAnnuaireInChunks(groups, 'Erreur PATCH Annuaire');
    return { updated };
  },

  /**
   * READ ONLY: reads the LDAP candidates cache (ldap_candidates_cache.json,
   * regenerated by /api/sync-ldap-candidates-trigger) and discards the records
   * attached since (uid_dyna filled in the meantime).
   */
  computeLdapCandidatesDiff: async (): Promise<LdapCandidatesDiff> => {
    let cache: any = { proposals: [], ambiguous: [] };
    try {
      const r = await fetch('/ldap_candidates_cache.json', { cache: 'no-store' });
      if (r.ok) cache = await r.json();
    } catch (e) { console.warn('LDAP candidates cache not found'); }
    const proposals: LdapCandidate[] = Array.isArray(cache.proposals) ? cache.proposals : [];
    const ambiguous: LdapAmbiguous[] = Array.isArray(cache.ambiguous) ? cache.ambiguous : [];

    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    const linked = new Set<number>();
    // uid::LABO → row already carrying this uid in this lab (duplicate prevention)
    const uidTaken: Record<string, { gristRowId: number; name: string }> = {};
    if (resp.ok) {
      const { records } = await resp.json();
      for (const rec of records) {
        const uid = String(rec.fields['uid_dyna'] || '').trim();
        if (!uid) continue;
        linked.add(rec.id);
        const key = `${uid}::${String(rec.fields['LABO'] || '').trim()}`;
        if (!uidTaken[key]) uidTaken[key] = { gristRowId: rec.id, name: `${String(rec.fields['Nom'] || '').toUpperCase()} ${rec.fields['Prenom'] || ''}`.trim() };
      }
    }
    const freshP = proposals.filter((p) => !linked.has(p.gristRowId)).map((p) => {
      const dup = uidTaken[`${p.ldap.uid}::${String(p.labo || '').trim()}`];
      return dup && dup.gristRowId !== p.gristRowId ? { ...p, duplicateOf: dup } : p;
    });
    const freshA = ambiguous.filter((a) => !linked.has(a.gristRowId));
    const alreadyLinked = (proposals.length - freshP.length) + (ambiguous.length - freshA.length);
    return { generatedAt: cache.generatedAt, proposals: freshP, ambiguous: freshA, alreadyLinked, uidTaken };
  },

  /**
   * Attaches records to their LDAP identity: writes `uid_dyna` (the pivot) and
   * fills `Civilite` / `Corps_grade` / birth date ONLY when the Grist cell is
   * empty (non-destructive), with LDAP traceability. Takes entries that are
   * ALREADY resolved (accepted proposal or arbitrated homonym).
   */
  applyLdapCandidates: async (entries: LdapResolved[]): Promise<{ updated: number; skippedDuplicates: { gristRowId: number; uid: string; existingRowId: number }[] }> => {
    if (!entries || entries.length === 0) return { updated: 0, skippedDuplicates: [] };

    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error('Erreur Grist (Annuaire)');
    const { records } = await resp.json();
    const byId: Record<number, any> = {};
    records.forEach((r: any) => { byId[r.id] = r.fields; });

    // Duplicate guard (lot 4): a uid already carried by another row of the SAME lab is
    // not reassigned — the right action is merging the two rows, not a 2nd attachment.
    const uidByLabo: Record<string, number> = {};
    for (const r of records) {
      const uid = String(r.fields['uid_dyna'] || '').trim();
      if (uid) uidByLabo[`${uid}::${String(r.fields['LABO'] || '').trim()}`] ??= r.id;
    }
    const skippedDuplicates: { gristRowId: number; uid: string; existingRowId: number }[] = [];
    entries = entries.filter((p) => {
      const labo = String(byId[p.gristRowId]?.['LABO'] || '').trim();
      const existing = uidByLabo[`${p.ldap.uid}::${labo}`];
      if (existing && existing !== p.gristRowId) { skippedDuplicates.push({ gristRowId: p.gristRowId, uid: p.ldap.uid, existingRowId: existing }); return false; }
      return true;
    });
    if (entries.length === 0) return { updated: 0, skippedDuplicates };

    const today = new Date().toISOString().slice(0, 10);
    const normBirth = (b: string): string | null => {
      const s = String(b || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    };

    const patchRecords = entries.map((p) => {
      const cur = byId[p.gristRowId] || {};
      const fields: Record<string, any> = { uid_dyna: p.ldap.uid };
      const setIfEmpty = (col: string, val: any) => {
        if (val && !String(cur[col] || '').trim()) fields[col] = val;
      };
      setIfEmpty('Civilite', normalizeCivility(p.ldap.civilite));
      // supannEmpCorps = BCN N_CORPS code (e.g. « 057 ») → mapped to a Druid grade (MCF/PR/TECH…),
      // transposed to an emeritus code when dynaCategorie says emeritus (see lib/emeritus.ts).
      const grade = ldapGradeFor(p.ldap.categorie, p.ldap.empCorps);
      setIfEmpty('Corps_grade', grade);
      if (!String(cur['DATE_DE_NAISSANCE_JJ_MM_AAAA'] || '').trim()) {
        const nb = normBirth(p.ldap.birthDate || '');
        const ep = nb ? toGristEpoch(nb) : null;
        if (ep !== null) fields['DATE_DE_NAISSANCE_JJ_MM_AAAA'] = ep;
      }
      // Traceability (same convention as the LDAP status sync)
      const curSrc = (cur['Data_source'] || '').toString();
      const hasLdap = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).includes('LDAP');
      fields['Data_source'] = hasLdap ? curSrc : (curSrc ? `${curSrc}|LDAP` : 'LDAP');
      fields['LDAP_derniere_maj'] = today;
      const via = p.email && p.email.includes('@') ? `email (${p.email})` : 'nom';
      const note = `[${today}] Rattachement LDAP par ${via} → uid ${p.ldap.uid}`;
      const curCom = (cur['Commentaires'] || '').toString();
      fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;
      return { id: p.gristRowId, fields };
    });

    // The Grist API requires the same columns per PATCH → group by signature.
    const groups = new Map<string, { id: number; fields: Record<string, any> }[]>();
    for (const rec of patchRecords) {
      const sig = Object.keys(rec.fields).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(rec);
    }
    const { updated } = await patchAnnuaireInChunks(groups, 'Erreur PATCH Annuaire');
    return { updated, skippedDuplicates };
  },

  /**
   * READ ONLY: compares the IdRef alignment cache (idref_align_cache.json, key = uid_dyna,
   * regenerated by /api/sync-idref-trigger) with the Grist Annuaire table.
   * Classifies according to the mode:
   *  - search: aRenseigner (1 candidate, empty IdRef), ambigus (>1), nonTrouves (0)
   * - verify: aEnrichir (ORCID/IdHAL missing), conflicts (value ≠ record / diverging name)
   * NEVER proposes to overwrite a non-empty cell (same rule as LDAP).
   */
  computeIdrefDiff: async (mode: 'search' | 'verify' = 'search', preloadedRecords?: any[]): Promise<IdrefDiff> => {
    let cache: Record<string, any> = {};
    try {
      const r = await fetch('/idref_align_cache.json', { cache: 'no-store' });
      if (r.ok) cache = await r.json();
    } catch (e) { console.warn('IdRef cache not found'); }

    // preloadedRecords: avoids one Annuaire fetch per source from computeUnifiedAlignDiff (verify mode).
    let records = preloadedRecords;
    if (!records) {
      const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
      if (!resp.ok) throw new Error('Erreur Grist (Annuaire)');
      ({ records } = await resp.json());
    }

    const nameOf = (f: any) => `${(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim();
    const byUid: Record<string, any> = {};
    const byRecId: Record<string, any> = {};
    for (const rec of records) { const u = rec.fields['uid_dyna']; if (u && !byUid[u]) byUid[u] = rec; byRecId[String(rec.id)] = rec; }
    // Cache key = uid_dyna, or g<rowId> for a record without LDAP identity (instances without LDAP), as computeAlignDiff.
    const recFor = (key: string) => byUid[key] || (/^g\d+$/.test(key) ? byRecId[key.slice(1)] : undefined);

    // Tolerant comparisons (PPN on digits+X, ORCID/IdHAL on trim/lower)
    const ppnDigits = (v: any) => String(v || '').match(/([0-9]{6,}[0-9X])/i)?.[1]?.toUpperCase() || '';
    const norm = (v: any) => String(v || '').trim().toLowerCase();

    // Blacklist: candidates rejected (or flagged « identité mêlée ») by colleagues in the Grist
    // review table (Alignement_IdRef) → never propose them again; mixed identities are listed separately.
    const rejected = new Set<string>();
    const melees: IdrefDiff['melees'] = [];
    try {
      const rr = await fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/records`);
      if (rr.ok) {
        const { records: revRecs } = await rr.json();
        for (const r of revRecs) {
          const dec = String(r.fields['Decision'] || '');
          if (isExcluded(dec)) rejected.add(`${r.fields['uid_dyna'] || ''}::${ppnDigits(r.fields['PPN_candidat'])}`);
          if (dec === DECISION_MIXED) melees.push(idrefMelee(r, byUid));
        }
      }
    } catch { /* review table missing: no blacklist */ }

    const aRenseigner: IdrefDiff['aRenseigner'] = [];
    const ambigus: IdrefDiff['ambigus'] = [];
    const aEnrichir: IdrefDiff['aEnrichir'] = [];
    const aArbitrer: IdrefDiff['aArbitrer'] = [];
    const conflits: IdrefDiff['conflits'] = [];
    const nonTrouves: IdrefDiff['nonTrouves'] = [];
    const redirections: NonNullable<IdrefDiff['redirections']> = [];

    // Pre-sort: do two names share at least one significant token (≥3 letters)?
    // Otherwise the mismatch is « suspect » (probable wrong IdRef, e.g. two unrelated names).
    const deburr = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const tokens = (s: string) => new Set(deburr(s).split(/[^a-z]+/).filter((t) => t.length >= 3));
    const shareToken = (a: string, b: string) => {
      const ta = tokens(a); const tb = tokens(b);
      for (const t of ta) if (tb.has(t)) return true;
      return false;
    };

    // proposals (empty cells) + conflicts (cells ≠) + matched (identifier already shared by
    // record/candidate, IdRef excluded — strong identity evidence) for a given candidate
    const compare = (f: any, cand: IdrefCandidate) => {
      const proposals: IdrefFieldProposal[] = [];
      const localConflicts: string[] = [];
      const matched: string[] = [];
      const fields: { field: IdrefFieldProposal['field']; label: string; cand: string; cur: string; eq: boolean }[] = [
        { field: 'IdRef', label: 'IdRef', cand: cand.ppn || '', cur: f['IdRef'] || '', eq: ppnDigits(cand.ppn) === ppnDigits(f['IdRef']) },
        { field: 'ORCID', label: 'ORCID', cand: cand.orcid || '', cur: f['ORCID'] || '', eq: norm(cand.orcid) === norm(f['ORCID']) },
        { field: 'IdHAL', label: 'IdHAL', cand: cand.idhal || '', cur: f['IdHAL'] || '', eq: norm(cand.idhal) === norm(f['IdHAL']) },
      ];
      for (const x of fields) {
        if (!x.cand) continue;
        if (!String(x.cur).trim()) proposals.push({ field: x.field, label: x.label, after: x.cand });
        else if (!x.eq) localConflicts.push(`${x.label}: Grist «${x.cur}» ≠ notice «${x.cand}»`);
        else if (x.field !== 'IdRef') matched.push(x.label);
      }
      return { proposals, localConflicts, matched };
    };

    let cacheTotal = 0;
    for (const [key, raw] of Object.entries(cache)) {
      const entry: any = raw;
      if (entry.mode !== mode) continue;       // view per mode (the cache may hold both)
      cacheTotal++;
      const rec = recFor(key);
      if (!rec) continue;                       // cache entry without Annuaire record (uid gone)
      const f = rec.fields;
      const uid = f['uid_dyna'] || key;
      const id = `G-${rec.id}`;
      const displayName = entry.queryName || nameOf(f);
      const group = alignGroupOf(f);

      if (mode === 'search') {
        if (ppnDigits(f['IdRef'])) continue;   // filled in the meantime (stale search entry), as in computeAlignDiff
        // Filters the candidates rejected in the Grist review; an ambiguous case can thus become « à renseigner » again.
        const cands: IdrefCandidate[] = (entry.candidates || []).filter(
          (c: IdrefCandidate) => !rejected.has(`${uid}::${ppnDigits(c.ppn)}`)
        );
        if (entry.status === 'not_found' || !cands.length) {
          nonTrouves.push({ uid, displayName, labo: f['LABO'] || '', group });
        } else if (cands.length > 1) {
          ambigus.push({ id, uid, displayName, labo: f['LABO'] || '', group, candidates: cands });
        } else {
          const cand: IdrefCandidate = cands[0];
          const { proposals, localConflicts, matched } = compare(f, cand);
          if (proposals.length) aRenseigner.push({ id, uid, displayName, labo: f['LABO'] || '', group, candidate: cand, proposals, matchedIds: matched });
          if (localConflicts.length) conflits.push({ id, uid, displayName, labo: f['LABO'] || '', group, reason: t`Identifier mismatch`, detail: localConflicts.join(' · '), ppn: cand.ppn });
        }
      } else { // verify
        const cand: IdrefCandidate | undefined = entry.candidates?.[0];
        const ppn = entry.ppn || cand?.ppn || '';
        // The verify run only handles records WITH an IdRef (sync_idref.cjs): if the Annuaire no longer
        // carries this PPN (IdRef removed since — « Mauvais IdRef », manual fix — or replaced),
        // the cache entry is stale. Without this guard, compare() proposed « IdRef ∅ → PPN » as
        // enrichment, i.e. to fill in again an IdRef that had just been detached (bug of
        // 2026-09-21: « Vérifier les existants » listed people without IdRef).
        if (!ppnDigits(f['IdRef']) || ppnDigits(f['IdRef']) !== ppnDigits(ppn)) continue;
        if (entry.status === 'redirected' && entry.newPpn) {
          // Merged/replaced record: proposed as « Mettre à jour » rather than as an unreadable conflict.
          const confirmedOld = !!ppnDigits(f['IdRef_nom_valide']) && ppnDigits(f['IdRef_nom_valide']) === ppnDigits(ppn);
          redirections.push({ id, uid, displayName, labo: f['LABO'] || '', group, ppn, newPpn: String(entry.newPpn), candidate: cand, nameMismatch: !!entry.nameMismatch, confirmedOld });
          continue;
        }
        if (entry.status === 'notice_missing') {
          conflits.push({ id, uid, displayName, labo: f['LABO'] || '', group, reason: t`Record deleted`, detail: t`PPN ${ppn || '?'}: the record no longer exists on IdRef (404) — fix or remove the IdRef from the Annuaire`, ppn });
          continue;
        }
        if (entry.status === 'notice_error' || !cand) {
          conflits.push({ id, uid, displayName, labo: f['LABO'] || '', group, reason: t`Record unreadable`, detail: t`PPN ${ppn || '?'}: IdRef record unreachable (network error or IdRef down during the run — rerun)`, ppn });
          continue;
        }
        const { proposals, localConflicts, matched } = compare(f, cand);
        // Name mismatch already validated? (IdRef_nom_valide == current PPN → no longer reported)
        const confirmed = !!ppnDigits(f['IdRef_nom_valide']) && ppnDigits(f['IdRef_nom_valide']) === ppnDigits(ppn);

        if (entry.nameMismatch && !confirmed) {
          // Enrichment is held back as long as the identity is not confirmed (anti-pollution).
          aArbitrer.push({
            id, uid, displayName, labo: f['LABO'] || '', group, ppn, notice: cand,
            grist: { orcid: f['ORCID'] || '', idhal: f['IdHAL'] || '' },
            proposals,
            suspect: !shareToken(displayName, cand.fullName),
          });
        } else {
          if (proposals.length) aEnrichir.push({ id, uid, displayName, labo: f['LABO'] || '', group, ppn, candidate: cand, proposals, matchedIds: matched });
          if (localConflicts.length) conflits.push({ id, uid, displayName, labo: f['LABO'] || '', group, reason: t`Identifier mismatch`, detail: localConflicts.join(' · '), ppn });
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      mode,
      stats: {
        cacheTotal,
        gristTotal: records.length,
        aRenseigner: aRenseigner.length,
        ambigus: ambigus.length,
        aEnrichir: aEnrichir.length,
        aArbitrer: aArbitrer.length,
        conflits: conflits.length,
        nonTrouves: nonTrouves.length,
        redirections: redirections.length,
      },
      labos: distinctLabos(records),
      aRenseigner, ambigus, aEnrichir, aArbitrer, conflits, nonTrouves, melees, redirections,
    };
  },

  /**
   * QUALINKA VARIANT (prototype) — READ ONLY: reads the enriched alignment cache
   * (idref_align_qualinka_cache.json, produced by scripts/sync_idref_qualinka.cjs) where each
   * entry carries a scoring STATUS, and maps it onto the buckets of the « search » review:
   * accepted       → « À renseigner »  (best PPN + ORCID/IdHAL already extracted → proposals)
   *   ambiguous      → Ambigus       (exact-name homonyms → radio arbitration)
   *   low_confidence → Ambigus       (probable name variants → arbitration / ignore)
   * not_found      → « Non trouvés »
   * Produces an IdrefDiff `mode:'search'` consumable as is by IdrefSyncReview (UI unchanged).
   * Same guards as computeIdrefDiff: Grist blacklist, never overwrite a cell.
   */
  computeIdrefAlignDiff: async (preloadedRecords?: any[]): Promise<IdrefDiff> => {
    let cache: Record<string, any> = {};
    try {
      const r = await fetch('/idref_align_qualinka_cache.json', { cache: 'no-store' });
      if (r.ok) cache = await r.json();
    } catch (e) { console.warn('IdRef (Qualinka) cache not found'); }

    // preloadedRecords: avoids one Annuaire fetch per source when called from
    // computeUnifiedAlignDiff (cf. docs/plan-alignement-unifie.md, lot 0).
    let records = preloadedRecords;
    if (!records) {
      const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
      if (!resp.ok) throw new Error('Erreur Grist (Annuaire)');
      ({ records } = await resp.json());
    }

    const nameOf = (f: any) => `${(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim();
    // Cache → Grist record remapping: by row id (gristId, reliable for ALL, externals included)
    // with fallback to uid_dyna for old cache entries.
    const byUid: Record<string, any> = {};
    const byRecId: Record<string, any> = {};
    for (const rec of records) { const u = rec.fields['uid_dyna']; if (u && !byUid[u]) byUid[u] = rec; byRecId[rec.id] = rec; }
    const ppnDigits = (v: any) => String(v || '').match(/([0-9]{6,}[0-9X])/i)?.[1]?.toUpperCase() || '';
    const norm = (v: any) => String(v || '').trim().toLowerCase();

    // Collaborative blacklist (Alignement_IdRef table) — identical to computeIdrefDiff: « Rejeté » AND
    // « Identité mêlée » (isExcluded); filtering only « Rejeté » proposed the mixed PPNs again (review lot 2,
    // finding 5). Mixed identities are listed separately (melees).
    const rejected = new Set<string>();
    const melees: IdrefDiff['melees'] = [];
    try {
      const rr = await fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/records`);
      if (rr.ok) {
        const { records: revRecs } = await rr.json();
        for (const r of revRecs) {
          const dec = String(r.fields['Decision'] || '');
          if (isExcluded(dec)) rejected.add(`${r.fields['uid_dyna'] || ''}::${ppnDigits(r.fields['PPN_candidat'])}`);
          if (dec === DECISION_MIXED) melees.push(idrefMelee(r, byUid));
        }
      }
    } catch { /* review table missing */ }

    // Align candidate (ppn/prefered/bioNote/…) → UI IdrefCandidate.
    // ids (ORCID/IdHAL) are only attached to the best of an « accepted » (extracted by enrichIdentifiers).
    const toCand = (c: any, ids?: any): IdrefCandidate => ({
      ppn: c.ppn,
      fullName: c.prefered || '',
      job: '',
      birth: c.birth || '',
      death: c.death || '',
      description: c.bioNote || '',
      orcid: ids?.orcid || '',
      idhal: ids?.idhal || '',
      isni: ids?.isni || '',
      gender: c.gender ?? null,
    });
    const compare = (f: any, cand: IdrefCandidate) => {
      const proposals: IdrefFieldProposal[] = [];
      const localConflicts: string[] = [];
      const matched: string[] = [];
      const fields: { field: IdrefFieldProposal['field']; label: string; cand: string; cur: string; eq: boolean }[] = [
        { field: 'IdRef', label: 'IdRef', cand: cand.ppn || '', cur: f['IdRef'] || '', eq: ppnDigits(cand.ppn) === ppnDigits(f['IdRef']) },
        { field: 'ORCID', label: 'ORCID', cand: cand.orcid || '', cur: f['ORCID'] || '', eq: norm(cand.orcid) === norm(f['ORCID']) },
        { field: 'IdHAL', label: 'IdHAL', cand: cand.idhal || '', cur: f['IdHAL'] || '', eq: norm(cand.idhal) === norm(f['IdHAL']) },
      ];
      for (const x of fields) {
        if (!x.cand) continue;
        if (!String(x.cur).trim()) proposals.push({ field: x.field, label: x.label, after: x.cand });
        else if (!x.eq) localConflicts.push(`${x.label}: Grist «${x.cur}» ≠ notice «${x.cand}»`);
        else if (x.field !== 'IdRef') matched.push(x.label);
      }
      return { proposals, localConflicts, matched };
    };

    const aRenseigner: IdrefDiff['aRenseigner'] = [];
    const ambigus: IdrefDiff['ambigus'] = [];
    const conflits: IdrefDiff['conflits'] = [];
    const nonTrouves: IdrefDiff['nonTrouves'] = [];

    // The same Grist row can have TWO cache keys (« g<id> » from before its LDAP attachment,
    // then its uid) → two cards with the same React key, checkbox impossible to tick (bug of
    // 2026-09-09, 54 people). Only the most recent entry per row is kept.
    const latestByRec = new Map<number, string>();
    for (const [key, raw] of Object.entries(cache)) {
      const entry: any = raw;
      if (entry.mode !== 'align') continue;
      const rec = (entry.gristId != null ? byRecId[entry.gristId] : null) || byUid[key];
      if (!rec) continue;
      const prev = latestByRec.get(rec.id);
      const prevAt = prev ? String((cache[prev] as any).checkedAt || '') : '';
      if (!prev || String(entry.checkedAt || '') >= prevAt) latestByRec.set(rec.id, key);
    }
    const keptKeys = new Set(latestByRec.values());

    let cacheTotal = 0;
    for (const [uid, raw] of Object.entries(cache)) {
      const entry: any = raw;
      if (entry.mode !== 'align') continue;
      cacheTotal++;
      const rec = (entry.gristId != null ? byRecId[entry.gristId] : null) || byUid[uid];
      if (!rec) continue;
      if (!keptKeys.has(uid)) continue;
      const f = rec.fields;
      const id = `G-${rec.id}`;
      const displayName = entry.queryName || nameOf(f);
      const labo = f['LABO'] || '';
      const group = alignGroupOf(f);
      // Filters the blacklist AND the candidates whose record indicates a death before DEATH_MIN_YEAR
      // (obviously wrong candidate) — applied here too for the cache already produced before this
      // filter was added on the script side, without waiting for a new run.
      const cands: any[] = (entry.candidates || []).filter((c: any) => {
        if (rejected.has(`${uid}::${ppnDigits(c.ppn)}`)) return false;
        const dy = candidateDeathYear(c.death);
        return !(dy !== null && dy < DEATH_MIN_YEAR);
      });

      if (entry.status === 'not_found' || !cands.length) {
        nonTrouves.push({ uid, displayName, labo, group });
      } else {
        const bc = entry.status === 'accepted' && entry.best
          ? cands.find((c) => ppnDigits(c.ppn) === ppnDigits(entry.best))
          : null;
        if (bc) {
          // A single PPN kept by the scoring → direct proposal (with ORCID/IdHAL if extracted).
          const cand = toCand(bc, entry.identifiers);
          const { proposals, localConflicts, matched } = compare(f, cand);
          if (proposals.length) aRenseigner.push({ id, uid, displayName, labo, group, candidate: cand, proposals, matchedIds: matched });
          if (localConflicts.length) conflits.push({ id, uid, displayName, labo, group, reason: t`Identifier mismatch`, detail: localConflicts.join(' · '), ppn: cand.ppn });
        } else {
          // ambiguous (exact-name homonyms) or low_confidence (variants) → human arbitration.
          // Also covers the case where the original "accepted" candidate was discarded by the death
          // filter above: the remaining candidates (if any) go back to arbitration.
          ambigus.push({ id, uid, displayName, labo, group, candidates: cands.map((c) => toCand(c)) });
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      mode: 'search',
      stats: {
        cacheTotal, gristTotal: records.length,
        aRenseigner: aRenseigner.length, ambigus: ambigus.length,
        aEnrichir: 0, aArbitrer: 0, conflits: conflits.length, nonTrouves: nonTrouves.length,
      },
      labos: distinctLabos(records),
      aRenseigner, ambigus, aEnrichir: [], aArbitrer: [], conflits, nonTrouves, melees,
    };
  },

  /**
   * Applies to the Annuaire the IdRef writes decided by the UI (checked boxes + arbitration
   * of ambiguous cases). Writes only the provided columns (IdRef/ORCID/IdHAL) + traceability
   * (Data_source += IdRef, IdRef_derniere_maj, IdRef_champs_modifies, dated line in Commentaires).
   * Reuses the grouping by column signature + batches of 100 of applyLdapUpdates.
   */
  applyIdrefUpdates: async (updates: IdrefUpdate[]): Promise<{ updated: number }> => {
    const entries = updates.filter((u) => u.fields && Object.keys(u.fields).length > 0);
    if (entries.length === 0) return { updated: 0 };

    // Data_source (LDAP, Nantes) is missing from the Annuaire schema on instances without LDAP
    // (Centrale): including it without a guard makes Grist reject the whole PATCH ("Invalid column").
    // IdRef_derniere_maj is Date on Centrale, Text on Nantes (schema divergence predating
    // the catch-up): a text PATCH on a Date column is also refused by Grist (both handled by traceColumnsFor).
    const cols = await fetchAnnuaireColumnsInternal();
    const hasDataSourceCol = cols.some((c) => c.id === 'Data_source');

    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error(t`Grist error (reading the Annuaire before writing)`);
    const { records } = await resp.json();
    const byId: Record<number, any> = {};
    records.forEach((r: any) => { byId[r.id] = r.fields; });

    const today = new Date().toISOString().slice(0, 10);

    const gidToId = new Map<number, string>();
    const patchRecords = entries.map((e) => {
      const gid = parseInt(e.id.replace('G-', ''));
      gidToId.set(gid, e.id);
      const cur = byId[gid] || {};
      const fields: Record<string, any> = { ...e.fields };

      // Traceability
      if (hasDataSourceCol) {
        const curSrc = (cur['Data_source'] || '').toString();
        const hasIdref = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).includes('IDREF');
        fields['Data_source'] = hasIdref ? curSrc : (curSrc ? `${curSrc}|IdRef` : 'IdRef');
      }
      Object.assign(fields, traceColumnsFor(cols, 'IdRef', today, Object.keys(e.fields)));
      const note = `[${today}] MAJ IdRef: ${Object.keys(e.fields).join(', ')}`;
      const curCom = (cur['Commentaires'] || '').toString();
      fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;

      return { id: gid, fields };
    });

    // The Grist API requires the same set of columns per PATCH → group by signature.
    const groups = new Map<string, { id: number; fields: Record<string, any> }[]>();
    for (const rec of patchRecords) {
      const sig = Object.keys(rec.fields).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(rec);
    }

    try {
      const { updated } = await patchAnnuaireInChunks(groups, 'Erreur PATCH Annuaire (IdRef)');
      return { updated };
    } catch (err: any) {
      // Converts the Grist rowIds (numeric) already written into `IdrefUpdate` ids (« G-<n> »):
      // the caller (App.tsx::handleApplyIdref) filters its in-memory queue by these ids, not by
      // rowId — without this, the rows already written before the failure stayed displayed « à traiter »
      // (revue lot 6a, finding 1).
      if (err.updatedRowIds) err.updatedIds = new Set([...err.updatedRowIds].map((gid: number) => gidToId.get(gid) ?? `G-${gid}`));
      throw err;
    }
  },

  /**
   * COLLABORATIVE REVIEW: pushes the IdRef alignment suggestions (search mode:
   * aRenseigner + ambiguous) to the Grist Alignement_IdRef table where colleagues
   * validate/reject them through « Action Button » buttons (Grist custom widget).
   * - Creates the table on the fly if missing, with the formula columns that generate
   * the button actions (the formula re-reads the Annuaire record at click time
   * → the « never overwrite a non-empty cell » rule and the traceability are
   * applied in the same transaction as the decision).
   * - Upsert by (uid_dyna, PPN): rows already decided (`Validé`/`Rejeté`) are
   * never touched again — the `Rejeté` rows serve as a blacklist for computeIdrefDiff.
   * - Purges the pending suggestions that became obsolete (IdRef filled
   * elsewhere in the Annuaire).
   */
  pushIdrefReview: async (diff: IdrefDiff): Promise<{ created: number; refreshed: number; skipped: number; purged: number; tableCreated: boolean }> => {
    if (diff.mode !== 'search') throw new Error(t`The Grist review only applies to the “search for missing” mode`);
    const today = new Date().toISOString().slice(0, 10);
    const ppnDigits = (v: any) => String(v || '').match(/([0-9]{6,}[0-9X])/i)?.[1]?.toUpperCase() || '';
    const authHeaders = { 'Content-Type': 'application/json' };

    // 1. Does the table exist? Otherwise create it (data columns + button formulas).
    const tablesResp = await fetch(`${gristDocUrl()}/tables`);
    if (!tablesResp.ok) throw new Error(t`Grist error (table list)`);
    const { tables } = await tablesResp.json();
    const tableCreated = !tables.some((t: any) => t.id === IDREF_REVIEW_TABLE);
    if (tableCreated) {
      const r = await fetch(`${gristDocUrl()}/tables`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ tables: [{ id: IDREF_REVIEW_TABLE, columns: buildIdrefReviewColumns() }] }),
      });
      if (!r.ok) throw new Error(t`Error creating table ${IDREF_REVIEW_TABLE}: ${await r.text()}`);
    }

    // 2. Suggestions to push: 1 row per (person, candidate) pair.
    type Row = Record<string, any>;
    const desired = new Map<string, Row>(); // uid::ppn key
    const baseRow = (uid: string, displayName: string, labo: string, nb: number, c: IdrefCandidate): Row => ({
      uid_dyna: uid,
      Nom_annuaire: displayName,
      LABO: labo,
      Nb_candidats: nb,
      PPN_candidat: c.ppn,
      Nom_notice: c.fullName || '',
      Profession: c.job || '',
      Naissance: [c.birth, c.death].filter(Boolean).join('–'),
      Description_notice: c.description || '',
      ORCID_candidat: c.orcid || '',
      IdHAL_candidat: c.idhal || '',
    });
    for (const r of diff.aRenseigner) desired.set(`${r.uid}::${ppnDigits(r.candidate.ppn)}`, baseRow(r.uid, r.displayName, r.labo, 1, r.candidate));
    for (const a of diff.ambigus) for (const c of a.candidates) desired.set(`${a.uid}::${ppnDigits(c.ppn)}`, baseRow(a.uid, a.displayName, a.labo, a.candidates.length, c));

    // 3. Existing rows (for the upsert) + Annuaire (to purge obsolete ones).
    const [revResp, annResp] = await Promise.all([
      fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/records`),
      fetch(`${gristDocUrl()}/tables/Annuaire/records`),
    ]);
    if (!revResp.ok) throw new Error(`Erreur Grist (${IDREF_REVIEW_TABLE})`);
    if (!annResp.ok) throw new Error('Erreur Grist (Annuaire)');
    const { records: revRecs } = await revResp.json();
    const { records: annRecs } = await annResp.json();
    const annIdrefByUid: Record<string, string> = {};
    for (const rec of annRecs) { const u = rec.fields['uid_dyna']; if (u && !(u in annIdrefByUid)) annIdrefByUid[u] = String(rec.fields['IdRef'] || '').trim(); }

    const existing = new Map<string, { id: number; decision: string; uid: string }>();
    for (const rec of revRecs) {
      const key = `${rec.fields['uid_dyna'] || ''}::${ppnDigits(rec.fields['PPN_candidat'])}`;
      existing.set(key, { id: rec.id, decision: String(rec.fields['Decision'] || ''), uid: rec.fields['uid_dyna'] || '' });
    }

    // 4. Sort: to create / to refresh (pending) / to keep (decided) / to purge.
    const toCreate: Row[] = [];
    const toPatch: { id: number; fields: Row }[] = [];
    let skipped = 0;
    for (const [key, row] of desired) {
      const ex = existing.get(key);
      if (!ex) toCreate.push({ ...row, Decision: 'À traiter', Applique: false, Date_application: '', Pousse_le: today });
      else if (isDecided(ex.decision)) skipped++;
      else toPatch.push({ id: ex.id, fields: { ...row, Pousse_le: today } });
    }
    // Purge: rows still « À traiter » whose Annuaire record has (since) an IdRef,
    // or which are no longer proposed by the current cache.
    const toDelete: number[] = [];
    for (const [key, ex] of existing) {
      if (ex.decision !== 'À traiter' && ex.decision !== '') continue;
      if (!desired.has(key) || (annIdrefByUid[ex.uid] || '').length > 0) toDelete.push(ex.id);
    }

    // 5. Writes in batches of 100 (same columns everywhere → no grouping by signature).
    for (let i = 0; i < toCreate.length; i += 100) {
      const r = await fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/records`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ records: toCreate.slice(i, i + 100).map((fields) => ({ fields })) }),
      });
      if (!r.ok) throw new Error(`Erreur POST ${IDREF_REVIEW_TABLE}: ${await r.text()}`);
    }
    for (let i = 0; i < toPatch.length; i += 100) {
      const r = await fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/records`, {
        method: 'PATCH', headers: authHeaders,
        body: JSON.stringify({ records: toPatch.slice(i, i + 100) }),
      });
      if (!r.ok) throw new Error(`Erreur PATCH ${IDREF_REVIEW_TABLE}: ${await r.text()}`);
    }
    if (toDelete.length) {
      const r = await fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/data/delete`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify(toDelete),
      });
      if (!r.ok) throw new Error(`Erreur purge ${IDREF_REVIEW_TABLE}: ${await r.text()}`);
    }

    return { created: toCreate.length, refreshed: toPatch.length, skipped, purged: toDelete.length, tableCreated };
  },

  /**
   * DIRECT BLACKLIST: flags one (or several) candidate(s) « Rejeté » in the Alignement_IdRef
   * table from the Druid UI — without going through the collaborative review. Both
   * diffs (computeIdrefDiff / computeIdrefAlignDiff) already filter these (uid, PPN) pairs:
   * the discarded candidate will not be proposed again, even after a new run.
   * Upsert by (uid_dyna, PPN): existing row → set to `Rejeté` (unless already `Rejeté`);
   * missing → created directly as `Rejeté`. Creates the table on the fly if needed.
   */
  /**
   * READ ONLY: compares the ORCID or HAL alignment cache (produced by scripts/sync_<source>.cjs,
   * key = uid_dyna or g<rowId>) with the Annuaire. Same classification as IdRef: aRenseigner (search, 1
   * candidate kept), ambigus (search), aEnrichir (verify), conflits (info), nonTrouves. Blacklist =
   * « Rejeté » rows of the Alignement_<SOURCE> table. Never proposes to overwrite a non-empty cell.
   */
  computeAlignDiff: async (source: AlignSource, mode: AlignMode = 'search', preloadedRecords?: any[]): Promise<AlignDiff> => {
    const meta = ALIGN_SOURCE_META[source];
    let cache: Record<string, any> = {};
    try {
      const r = await fetch(meta.cache, { cache: 'no-store' });
      if (r.ok) cache = await r.json();
    } catch (e) { console.warn(`${meta.label} cache not found`); }

    // preloadedRecords: avoids one Annuaire fetch per source when called from
    // computeUnifiedAlignDiff (cf. docs/plan-alignement-unifie.md, lot 0).
    let records = preloadedRecords;
    if (!records) {
      const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
      if (!resp.ok) throw new Error('Erreur Grist (Annuaire)');
      ({ records } = await resp.json());
    }
    const byUid: Record<string, any> = {};
    const byRecId: Record<string, any> = {};
    for (const rec of records) { const u = rec.fields['uid_dyna']; if (u && !byUid[u]) byUid[u] = rec; byRecId[String(rec.id)] = rec; }
    const recFor = (key: string) => byUid[key] || (/^g\d+$/.test(key) ? byRecId[key.slice(1)] : undefined);

    const nameOf = (f: any) => `${(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim();
    const normOrcid = (v: any) => String(v || '').match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i)?.[1]?.toUpperCase() || '';
    const normIdhal = (v: any) => String(v || '').trim().replace(/\/+$/, '').split('/').pop()!.trim().toLowerCase();
    const ppnDigits = (v: any) => String(v || '').match(/([0-9]{6,}[0-9X])/i)?.[1]?.toUpperCase() || '';
    const digits = (v: any) => String(v || '').replace(/\D/g, '');
    const normOa = (v: any) => parseOpenalexIds(v)[0] || '';
    const normId = source === 'orcid' ? normOrcid : source === 'openalex' ? normOa : source === 'scopus' ? digits : normIdhal;
    /** Identifier of a raw cached candidate (field name differs per script). */
    const candId = (c: any): string => (source === 'orcid' ? c.orcid : source === 'scopus' ? String(c.id || '') : c.idhal);

    const rejected = new Set<string>();
    const melees: AlignDiff['melees'] = [];
    try {
      const rr = await fetch(`${gristDocUrl()}/tables/${meta.table}/records`);
      if (rr.ok) {
        const { records: revRecs } = await rr.json();
        for (const r of revRecs) {
          const dec = String(r.fields['Decision'] || '');
          if (isExcluded(dec)) rejected.add(`${r.fields['uid_dyna'] || ''}::${normId(r.fields[meta.idColumn])}`);
          if (dec === DECISION_MIXED) melees.push({ id: `G-${r.fields['Annuaire_id'] || ''}`, uid: r.fields['uid_dyna'] || '', displayName: r.fields['Nom_annuaire'] || '', labo: r.fields['LABO'] || '', candidateId: normId(r.fields[meta.idColumn]), url: meta.url(normId(r.fields[meta.idColumn])), fullName: r.fields['Nom_profil'] || '', note: r.fields['Note'] || '', signaleLe: r.fields['Signale_le'] || '' });
        }
      }
    } catch { /* review table missing */ }

    // ── OpenAlex: multi-valued target (OpenAlex_ids). search = records without a list; verify = list resolved by
    // the script (merges / vanished / ORCID profile already written directly) + fragments to add.
    // One « À renseigner » / « À enrichir » row per (record, strong profile) — id `G-<row>#<A-id>`; the
    // medium / weak candidates are arbitrated with checkboxes (several profiles can be right).
    if (source === 'openalex') {
      const aRenseigner: AlignDiff['aRenseigner'] = [];
      const ambigus: AlignDiff['ambigus'] = [];
      const aEnrichir: AlignDiff['aEnrichir'] = [];
      const conflits: AlignDiff['conflits'] = [];
      const nonTrouves: AlignDiff['nonTrouves'] = [];
      let cacheTotal = 0;
      const toOa = (c: any): AlignCandidate => ({
        id: c.id, url: meta.url(c.id), fullName: c.fullName || c.id, forms: c.forms || [], score: c.score, evidence: c.evidence || [],
        matchedIds: c.matchedIds || [], details: [...(c.affiliations || []), ...(c.orcid ? [`ORCID ${c.orcid}`] : [])], suspect: c.suspect || [],
        ids: { openalex: c.id, orcid: c.orcid || '' },
      });
      const proposal = (c: AlignCandidate): AlignFieldProposal[] => [{ field: 'OpenAlex_ids', label: 'OpenAlex', after: c.id }];
      for (const [key, raw] of Object.entries(cache)) {
        const entry: any = raw;
        if (entry.mode !== mode) continue;
        cacheTotal++;
        const rec = recFor(key);
        if (!rec) continue;
        const f = rec.fields;
        const rowId = `G-${rec.id}`;
        const uid = f['uid_dyna'] || key;
        const displayName = entry.queryName || nameOf(f);
        const labo = f['LABO'] || '';
        const group = alignGroupOf(f);
        const existing = parseOpenalexIds(f['OpenAlex_ids']);
        const written = new Set<string>([...(entry.writtenIds || []), ...(entry.next || [])]);
        const cands: any[] = (entry.candidates || []).filter((c: any) => !rejected.has(`${key}::${c.id}`) && !existing.includes(c.id) && !written.has(c.id));
        const base = { uid, displayName, labo, group, existing };
        if (mode === 'search') {
          if (entry.status === 'error' && !cands.length) { conflits.push({ id: rowId, ...base, reason: t`Search error`, detail: t`API unreachable during the run — rerun.` }); continue; }
          if (!cands.length) { if (!existing.length) nonTrouves.push(base); continue; }
          const strong = cands.filter((c) => c.score === 'fort');
          for (const c of strong) { const cand = toOa(c); aRenseigner.push({ id: `${rowId}#${c.id}`, ...base, candidate: cand, proposals: proposal(cand), matchedIds: cand.matchedIds, score: cand.score }); }
          const rest = cands.filter((c) => c.score !== 'fort');
          if (rest.length) ambigus.push({ id: rowId, ...base, candidates: rest.map(toOa) });
        } else {
          if (entry.status === 'error') { conflits.push({ id: rowId, ...base, reason: t`Verification error`, detail: t`API unreachable during the run — rerun.` }); continue; }
          if (entry.status !== 'checked') continue;
          const bad = (entry.resolved || []).filter((r: any) => r.status === 'ok' && !r.nameMatch);
          if (bad.length) conflits.push({ id: rowId, ...base, reason: t`Name mismatch`, detail: bad.map((r: any) => t`${r.id} “${r.fullName || '?'}” ≠ Annuaire “${displayName}”`).join(' · '), candidate: toOa({ id: bad[0].id, fullName: bad[0].fullName, orcid: bad[0].orcid }) });
          for (const sus of entry.suspects || []) conflits.push({ id: rowId, ...base, reason: t`Suspected mixed identity`, detail: t`${sus.id} “${sus.fullName || '?'}”: ${(sus.reasons || []).join(' ; ')} — check the profile, flag it “Mixed identity” if needed`, candidate: toOa({ id: sus.id, fullName: sus.fullName, suspect: sus.reasons }) });
          if (entry.changed && !entry.written) {
            const detail = [
              ...(entry.replaced || []).map(([a, b]: string[]) => t`${a} merged into ${b}`),
              ...(entry.removed || []).map((a: string) => t`${a} gone`),
              ...(entry.added || []).map((a: string) => t`${a} = missing ORCID profile`),
            ].join(' · ');
            conflits.push({ id: rowId, ...base, reason: t`List to fix (not written)`, detail: t`${detail} → rerun (direct write) or fix OpenAlex_ids` });
          }
          const sorted = [...cands].sort((a, b) => ({ fort: 0, moyen: 1, faible: 2 } as any)[a.score] - ({ fort: 0, moyen: 1, faible: 2 } as any)[b.score]);
          for (const c of sorted) { const cand = toOa(c); aEnrichir.push({ id: `${rowId}#${c.id}`, ...base, candidate: cand, proposals: proposal(cand), matchedIds: cand.matchedIds, score: cand.score }); }
        }
      }
      return {
        source, mode, generatedAt: new Date().toISOString(),
        stats: { cacheTotal, gristTotal: records.length, aRenseigner: aRenseigner.length, ambigus: ambigus.length, aEnrichir: aEnrichir.length, conflits: conflits.length, nonTrouves: nonTrouves.length, sansAffiliation: 0 },
        labos: distinctLabos(records),
        aRenseigner, ambigus, aEnrichir, conflits, nonTrouves, melees,
      };
    }

    const toCand = (c: any): AlignCandidate => source === 'orcid'
      ? {
          id: c.orcid, url: meta.url(c.orcid), fullName: c.fullName || c.orcid, forms: c.forms || [], score: c.score, evidence: c.evidence || [],
          matchedIds: c.matchedIds || [], details: [...(c.institutions || []), ...(c.employments || []), ...(c.emails || [])], emptyRecord: !!c.emptyRecord,
          ids: { orcid: c.orcid, scopus: c.scopus || '', idhal: c.viaIdhal || '' },
        }
      : source === 'scopus'
      ? {
          id: String(c.id), url: meta.url(String(c.id)), fullName: c.fullName || String(c.id), forms: c.forms || [], score: c.score, evidence: c.evidence || [],
          matchedIds: c.matchedIds || [], suspect: c.suspect || [],
          details: [
            ...(c.affiliation ? [c.affiliation] : []), ...(c.history || []),
            ...(c.docCount !== undefined ? [`${c.docCount} document(s)${c.range ? ` ${c.range}` : ''}`] : []), ...(c.subjects || []),
          ],
          ids: { scopus: String(c.id), orcid: c.orcid || '' },
        }
      : {
          id: c.idhal, url: meta.url(c.idhal), fullName: c.fullName || c.idhal, forms: c.forms || [], score: c.score, evidence: c.evidence || [],
          matchedIds: c.matchedIds || [], details: [...(c.labs || []), ...(c.emailDomains || []).map((d: string) => `@${d}`)], suspect: c.suspect || [],
          ids: { idhal: c.idhal, idhalI: String(c.idhalI || ''), orcid: c.orcid || '', idref: c.idref || '' },
        };

    /** Proposals (empty cell) and divergences (non-empty cell ≠ candidate) for a record. */
    const compare = (f: any, cand: AlignCandidate, primary: boolean) => {
      const proposals: AlignFieldProposal[] = [];
      const conflicts: string[] = [];
      const matched: string[] = [...(cand.matchedIds || [])];
      type Row = { field: AlignFieldProposal['field']; label: string; cand: string; cur: string; eq: boolean; primary: boolean };
      const rows: Row[] = source === 'orcid'
        ? [
            { field: 'ORCID', label: 'ORCID', cand: cand.ids.orcid || '', cur: f['ORCID'] || '', eq: normOrcid(cand.ids.orcid) === normOrcid(f['ORCID']), primary: true },
            { field: 'ID_SCOPUS', label: 'Scopus', cand: cand.ids.scopus || '', cur: f['ID_SCOPUS'] || '', eq: digits(cand.ids.scopus) === digits(f['ID_SCOPUS']), primary: false },
          ]
        : source === 'scopus'
        ? [
            { field: 'ID_SCOPUS', label: 'Scopus', cand: cand.ids.scopus || '', cur: f['ID_SCOPUS'] || '', eq: digits(cand.ids.scopus) === digits(f['ID_SCOPUS']), primary: true },
            { field: 'ORCID', label: 'ORCID', cand: cand.ids.orcid || '', cur: f['ORCID'] || '', eq: normOrcid(cand.ids.orcid) === normOrcid(f['ORCID']), primary: false },
          ]
        : [
            { field: 'IdHAL', label: 'IdHAL', cand: cand.ids.idhal || '', cur: f['IdHAL'] || '', eq: normIdhal(cand.ids.idhal) === normIdhal(f['IdHAL']), primary: true },
            { field: 'IdHAL_i', label: 'IdHAL_i', cand: cand.ids.idhalI || '', cur: f['IdHAL_i'] || '', eq: digits(cand.ids.idhalI) === digits(f['IdHAL_i']), primary: false },
            { field: 'ORCID', label: 'ORCID', cand: cand.ids.orcid || '', cur: f['ORCID'] || '', eq: normOrcid(cand.ids.orcid) === normOrcid(f['ORCID']), primary: false },
            { field: 'IdRef', label: 'IdRef', cand: cand.ids.idref || '', cur: f['IdRef'] || '', eq: ppnDigits(cand.ids.idref) === ppnDigits(f['IdRef']), primary: false },
          ];
      for (const x of rows) {
        if (!x.cand) continue;
        if (x.primary && !primary) continue;   // verify: the main identifier is already there
        if (!String(x.cur).trim()) proposals.push({ field: x.field, label: x.label, after: x.cand });
        else if (!x.eq) conflicts.push(`${x.label}: Grist «${x.cur}» ≠ profil «${x.cand}»`);
      }
      return { proposals, conflicts, matched };
    };

    const aRenseigner: AlignDiff['aRenseigner'] = [];
    const ambigus: AlignDiff['ambigus'] = [];
    const aEnrichir: AlignDiff['aEnrichir'] = [];
    const conflits: AlignDiff['conflits'] = [];
    const nonTrouves: AlignDiff['nonTrouves'] = [];
    let cacheTotal = 0;
    let sansAffiliation = 0;

    for (const [key, raw] of Object.entries(cache)) {
      const entry: any = raw;
      if (entry.mode !== mode) continue;
      cacheTotal++;
      const rec = recFor(key);
      if (!rec) continue;
      const f = rec.fields;
      const id = `G-${rec.id}`;
      const uid = f['uid_dyna'] || key;
      const displayName = entry.queryName || nameOf(f);
      const labo = f['LABO'] || '';
      const group = alignGroupOf(f);

      if (mode === 'search') {
        if (String(f[meta.targetField] || '').trim()) continue;   // filled in the meantime
        const cands: any[] = (entry.candidates || []).filter((c: any) => !rejected.has(`${key}::${normId(candId(c))}`));
        if (entry.status === 'error') { conflits.push({ id, uid, displayName, labo, group, reason: t`Search error`, detail: t`API unreachable during the run — rerun.` }); continue; }
        if (!cands.length) { nonTrouves.push({ uid, displayName, labo, group }); continue; }
        const bestRaw = entry.status === 'found' ? cands.find((c) => candId(c) === String(entry.best)) : null;
        if (bestRaw) {
          const cand = toCand(bestRaw);
          const { proposals, conflicts, matched } = compare(f, cand, true);
          if (proposals.length) aRenseigner.push({ id, uid, displayName, labo, group, candidate: cand, proposals, matchedIds: matched, score: cand.score });
          if (conflicts.length) conflits.push({ id, uid, displayName, labo, group, reason: t`Identifier mismatch`, detail: conflicts.join(' · '), candidate: cand });
        } else {
          ambigus.push({ id, uid, displayName, labo, group, candidates: cands.map(toCand) });
        }
      } else {
        if (entry.status === 'not_found_hal' || entry.status === 'not_found_orcid' || entry.status === 'not_found_scopus') {
          const reason = source === 'orcid' ? t`Unknown ORCID` : source === 'scopus' ? t`Unknown Scopus Author ID` : t`IdHAL unknown to HAL`;
          conflits.push({ id, uid, displayName, labo, group, reason, detail: t`${entry.orcid || entry.idhal || entry.scopus || ''}: no profile — fix it in the Annuaire` });
          continue;
        }
        if (entry.status === 'invalid') {
          if (source === 'scopus') conflits.push({ id, uid, displayName, labo, group, reason: t`Invalid ID_SCOPUS`, detail: t`${entry.scopus}: not a numeric Scopus identifier (the text « absent » is accepted to mark a verified absence)` });
          else conflits.push({ id, uid, displayName, labo, group, reason: t`Invalid ORCID`, detail: t`${entry.orcid}: wrong format or check digit` });
          continue;
        }
        if (entry.status === 'error') { conflits.push({ id, uid, displayName, labo, group, reason: t`Verification error`, detail: t`API unreachable during the run — rerun.` }); continue; }
        if (entry.status !== 'checked' || !entry.candidate) continue;
        const cand = toCand({ ...entry.candidate, score: undefined });
        if (entry.affiliation === 'aucune') sansAffiliation++;
        // Scopus merged the profile into another one: the Annuaire still holds the old id (never rewritten silently).
        if (entry.merged) conflits.push({ id, uid, displayName, labo, group, reason: t`Profile merged by Scopus`, detail: t`${entry.scopus} → ${entry.merged}: Scopus merged this profile into another one — update ID_SCOPUS`, candidate: cand });
        if ((cand.suspect || []).length) conflits.push({ id, uid, displayName, labo, group, reason: t`Suspected mixed identity`, detail: t`${cand.suspect!.join(' ; ')} — check the profile, flag it “Mixed identity” if needed`, candidate: cand });
        if (entry.nameMismatch) {
          conflits.push({ id, uid, displayName, labo, group, reason: t`Name mismatch`, detail: t`Annuaire “${displayName}” ≠ profile “${cand.fullName}”${(cand.forms || []).length > 1 ? ` (${cand.forms!.join(' | ')})` : ''}`, candidate: cand });
          continue;
        }
        const { proposals, conflicts, matched } = compare(f, cand, false);
        if (proposals.length) aEnrichir.push({ id, uid, displayName, labo, group, candidate: cand, proposals, matchedIds: matched });
        if (conflicts.length) conflits.push({ id, uid, displayName, labo, group, reason: t`Identifier mismatch`, detail: conflicts.join(' · '), candidate: cand });
      }
    }

    return {
      source, mode, generatedAt: new Date().toISOString(),
      stats: { cacheTotal, gristTotal: records.length, aRenseigner: aRenseigner.length, ambigus: ambigus.length, aEnrichir: aEnrichir.length, conflits: conflits.length, nonTrouves: nonTrouves.length, sansAffiliation },
      labos: distinctLabos(records),
      aRenseigner, ambigus, aEnrichir, conflits, nonTrouves, melees,
    };
  },

  /**
   * Unified alignment view (docs/plan-alignement-unifie.md, lot 0): one row per Annuaire
   * record, the state of each requested authority source. Fetches the `Annuaire` table ONCE (instead
   * of once per source), delegates the per-source computation to computeAlignDiff/computeIdrefAlignDiff
   * (engines unchanged), then pivots. IdRef is only included in `search` mode (Qualinka engine
   * simple) — l'outil « Vérifier les identifiants liés » reste hors scope (plan §5).
   */
  computeUnifiedAlignDiff: async (
    sources: UnifiedAlignSource[] = UNIFIED_ALIGN_SOURCES,
    mode: AlignMode = 'search',
  ): Promise<UnifiedAlignDiff> => {
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error('Erreur Grist (Annuaire)');
    const { records } = await resp.json();

    const perSource: Partial<Record<UnifiedAlignSource, AlignDiff | IdrefDiff>> = {};
    await Promise.all(sources.map(async (src) => {
      if (src === 'idref') {
        // search = missing IdRef: Qualinka engine (idref_align_qualinka_cache.json) where the instance
        // has it (HAS_QUALINKA, Nantes), otherwise the generic Solr pipeline (search entries of
        // idref_align_cache.json, scripts/sync_idref.cjs) — Centrale and the demo have no Qualinka
        // cache, their IdRef column stayed empty in search mode (fixed on 2026-09-24).
        // verify = « Mettre à jour les identifiants liés » (re-read records: enrichment, name
        // mismatches, replaced records) — postponed on 2026-09-21.
        perSource.idref = mode === 'verify'
          ? await GristService.computeIdrefDiff('verify', records)
          : hasCapability('HAS_QUALINKA')
            ? await GristService.computeIdrefAlignDiff(records)
            : await GristService.computeIdrefDiff('search', records);
        return;
      }
      perSource[src] = await GristService.computeAlignDiff(src, mode, records);
    }));

    return pivotUnifiedAlignDiffs(records, sources, mode, perSource);
  },

  /**
   * Writes to the Annuaire the grouped updates of the unified view (docs/plan-alignement-unifie.md,
   * lot 3) — ONE PATCH per record even when several authority sources contributed to it (unlike
   * applyIdrefUpdates/applyAlignUpdates, one per source, potentially several PATCHes for the
   * same record if called in sequence). Traceability (Data_source, `<Label>_derniere_maj`,
   * `<Label>_champs_modifies`, line in Commentaires) written for EACH contributing source
   * (`update.fieldsBySource`) — same convention as the 4 existing `apply*Updates`, just merged
   * into a single PATCH instead of repeated. OpenAlex_ids (multi-valued target): merged with the
   * CURRENT value of the record at write time (addition, never overwrite), same rule as
   * applyAlignUpdates — needed even though buildUnifiedUpdates already unioned the checked
   * candidates, because the record may have received other A-ids in the meantime (verify run, other
   * utilisateur).
   */
  applyUnifiedUpdates: async (updates: PersonAlignUpdate[]): Promise<{ updated: number }> => {
    const entries = updates.filter((u) => u.fields && Object.keys(u.fields).length > 0);
    if (entries.length === 0) return { updated: 0 };

    const cols = await fetchAnnuaireColumnsInternal();
    const hasDataSourceCol = cols.some((c) => c.id === 'Data_source');

    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error(t`Grist error (reading the Annuaire before writing)`);
    const { records } = await resp.json();
    const byId: Record<number, any> = {};
    records.forEach((r: any) => { byId[r.id] = r.fields; });

    const today = new Date().toISOString().slice(0, 10);
    const gidToId = new Map<number, string>();

    const patchRecords = entries.map((e) => {
      const gid = parseInt(e.id.replace('G-', ''));
      gidToId.set(gid, e.id);
      const cur = byId[gid] || {};
      const fields: Record<string, any> = {};
      const labels: string[] = [];
      const noteParts: string[] = [];

      for (const src of e.sources) {
        const label = src === 'idref' ? 'IdRef' : ALIGN_SOURCE_META[src].label;
        let srcFields = e.fieldsBySource[src] || {};
        if (src === 'openalex' && srcFields.OpenAlex_ids) {
          const target = ALIGN_SOURCE_META.openalex.targetField;
          const curIds = parseOpenalexIds(cur[target]);
          const wantIds = parseOpenalexIds(srcFields[target]);
          const add = wantIds.filter((id) => !curIds.includes(id));
          srcFields = add.length ? { ...srcFields, [target]: [...curIds, ...add].join('|') } : {};
        }
        if (!Object.keys(srcFields).length) continue;   // nothing new for this source (e.g. OpenAlex already up to date in the meantime)
        Object.assign(fields, srcFields);
        labels.push(label);
        noteParts.push(`${label}: ${Object.keys(srcFields).join(', ')}`);
        Object.assign(fields, traceColumnsFor(cols, label, today, Object.keys(srcFields)));
      }
      if (!labels.length) return null;

      if (hasDataSourceCol) {
        const curSrc = (cur['Data_source'] || '').toString();
        const curTags = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).filter(Boolean);
        const newTags = labels.filter((l) => !curTags.includes(l.toUpperCase()));
        fields['Data_source'] = newTags.length ? (curSrc ? `${curSrc}|${newTags.join('|')}` : newTags.join('|')) : curSrc;
      }
      const note = `[${today}] MAJ ${noteParts.join(' ; ')}`;
      const curCom = (cur['Commentaires'] || '').toString();
      fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;

      return { id: gid, fields: coerceNumericColumns(cols, fields) };
    }).filter((r): r is { id: number; fields: Record<string, any> } => r !== null);

    const groups = new Map<string, { id: number; fields: Record<string, any> }[]>();
    for (const rec of patchRecords) {
      const sig = Object.keys(rec.fields).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(rec);
    }

    try {
      const { updated } = await patchAnnuaireInChunks(groups, 'Erreur PATCH Annuaire (vue unifiée)');
      return { updated };
    } catch (err: any) {
      if (err.updatedRowIds) err.updatedIds = new Set([...err.updatedRowIds].map((gid: number) => gidToId.get(gid) ?? `G-${gid}`));
      throw err;
    }
  },

  /**
   * Applies to the Annuaire the ORCID / HAL writes decided by the UI. Writes only the provided
   * columns + traceability (Data_source += SOURCE, <SOURCE>_derniere_maj, <SOURCE>_champs_modifies,
   * dated line in Commentaires) — same convention as applyIdrefUpdates.
   */
  applyAlignUpdates: async (source: AlignSource, updates: IdrefUpdate[]): Promise<{ updated: number }> => {
    const label = ALIGN_SOURCE_META[source].label;
    const entries = updates.filter((u) => u.fields && Object.keys(u.fields).length > 0);
    if (entries.length === 0) return { updated: 0 };
    // Data_source (LDAP, Nantes) is missing from the Annuaire schema on instances without LDAP
    // (Centrale): including it without a guard makes Grist reject the whole PATCH ("Invalid column").
    const cols = await fetchAnnuaireColumnsInternal();
    const hasDataSourceCol = cols.some((c) => c.id === 'Data_source');
    const resp = await fetch(`${gristDocUrl()}/tables/Annuaire/records`);
    if (!resp.ok) throw new Error(t`Grist error (reading the Annuaire before writing)`);
    const { records } = await resp.json();
    const byId: Record<number, any> = {};
    records.forEach((r: any) => { byId[r.id] = r.fields; });
    const today = new Date().toISOString().slice(0, 10);
    const trace = (gid: number, fields: Record<string, any>, what: string) => {
      const cur = byId[gid] || {};
      const modified = Object.keys(fields);   // business columns, before the traceability columns are added
      if (hasDataSourceCol) {
        const curSrc = (cur['Data_source'] || '').toString();
        const has = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).includes(label.toUpperCase());
        fields['Data_source'] = has ? curSrc : (curSrc ? `${curSrc}|${label}` : label);
      }
      Object.assign(fields, traceColumnsFor(cols, label, today, modified));
      const note = `[${today}] MAJ ${label}: ${what}`;
      const curCom = (cur['Commentaires'] || '').toString();
      fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;
      return { id: gid, fields: coerceNumericColumns(cols, fields) };
    };
    // gid → original IdrefUpdate ids that contributed to this rowId (several in multi mode, where
    // `G-<row>#<A-id>` merges into a single write) — lets the caller know, even on a
    // partial failure, which ids of its queue were actually written (review lot 6a, finding 1).
    const gidToIds = new Map<number, string[]>();
    let patchRecords: { id: number; fields: Record<string, any> }[];
    if (ALIGN_SOURCE_META[source].multi) {
      // Multi-valued target (OpenAlex_ids): ADDED to the existing list, several rows of the same record
      // (`G-<row>#<A-id>`) merged into one write; nothing is removed, an already present profile is ignored.
      const target = ALIGN_SOURCE_META[source].targetField;
      const wanted = new Map<number, string[]>();
      for (const e of entries) {
        const gid = parseInt(e.id.replace('G-', ''));
        if (!gidToIds.has(gid)) gidToIds.set(gid, []);
        gidToIds.get(gid)!.push(e.id);
        const ids = parseOpenalexIds(Object.values(e.fields).join('|'));
        if (!wanted.has(gid)) wanted.set(gid, []);
        for (const id of ids) if (!wanted.get(gid)!.includes(id)) wanted.get(gid)!.push(id);
      }
      patchRecords = [];
      for (const [gid, ids] of wanted) {
        const cur = parseOpenalexIds((byId[gid] || {})[target]);
        const add = ids.filter((id) => !cur.includes(id));
        if (!add.length) continue;
        patchRecords.push(trace(gid, { [target]: [...cur, ...add].join('|') }, `${target} += ${add.join(', ')}`));
      }
    } else {
      patchRecords = entries.map((e) => {
        const gid = parseInt(e.id.replace('G-', ''));
        gidToIds.set(gid, [e.id]);
        return trace(gid, { ...e.fields }, Object.keys(e.fields).join(', '));
      });
    }
    const groups = new Map<string, { id: number; fields: Record<string, any> }[]>();
    for (const rec of patchRecords) {
      const sig = Object.keys(rec.fields).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(rec);
    }
    try {
      const { updated } = await patchAnnuaireInChunks(groups, `Erreur PATCH Annuaire (${label})`);
      return { updated };
    } catch (err: any) {
      if (err.updatedRowIds) {
        const ids = new Set<string>();
        for (const gid of err.updatedRowIds as Set<number>) for (const id of gidToIds.get(gid) || []) ids.add(id);
        err.updatedIds = ids;
      }
      throw err;
    }
  },

  /**
   * « Mauvais candidat » ORCID / HAL: « Rejeté » row in Alignement_<SOURCE> (blacklist re-read by
   * computeAlignDiff and by the script). The table is created by the script's first run (its columns and
   * formulas live in scripts/sync_<source>.cjs) — if it does not exist yet, we report it.
   */
  rejectAlignCandidates: async (
    source: AlignSource,
    items: { id: string; uid: string; displayName: string; labo?: string; candidateCount?: number; candidate: AlignCandidate }[],
    decision: ReviewDecision = 'Rejeté',
    note = '',
  ): Promise<{ rejected: number }> => {
    if (!items.length) return { rejected: 0 };
    const meta = ALIGN_SOURCE_META[source];
    const today = new Date().toISOString().slice(0, 10);
    const normId = source === 'orcid'
      ? (v: any) => String(v || '').match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i)?.[1]?.toUpperCase() || ''
      : source === 'openalex'
        ? (v: any) => parseOpenalexIds(v)[0] || ''
        : source === 'scopus'
          ? (v: any) => String(v || '').replace(/\D/g, '')
          : (v: any) => String(v || '').trim().replace(/\/+$/, '').split('/').pop()!.trim().toLowerCase();
    const revResp = await fetch(`${gristDocUrl()}/tables/${meta.table}/records`);
    if (!revResp.ok) throw new Error(t`Table ${meta.table} missing: run ${meta.label} first (the script creates it).`);
    const { records: revRecs } = await revResp.json();
    const existing = new Map<string, { id: number; decision: string }>();
    for (const rec of revRecs) existing.set(`${rec.fields['uid_dyna'] || ''}::${normId(rec.fields[meta.idColumn])}`, { id: rec.id, decision: String(rec.fields['Decision'] || '') });
    const toCreate: Record<string, any>[] = [];
    const toPatch: { id: number; fields: Record<string, any> }[] = [];
    for (const it of items) {
      const ex = existing.get(`${it.uid}::${normId(it.candidate.id)}`);
      if (ex) { if (ex.decision !== decision) toPatch.push({ id: ex.id, fields: { Decision: decision, Date_application: today, ...(note ? { Note: note } : {}) } }); continue; }
      const base: Record<string, any> = {
        uid_dyna: it.uid, Annuaire_id: parseInt(it.id.replace('G-', '')) || 0, Nom_annuaire: it.displayName, LABO: it.labo || '', Nb_candidats: it.candidateCount ?? 1,
        Nom_profil: it.candidate.fullName || '', Score: it.candidate.score || '', Preuves: (it.candidate.evidence || []).join(' ; '),
        Decision: decision, Applique: false, Date_application: today, Pousse_le: today, Note: note,
      };
      base[meta.idColumn] = it.candidate.id;
      if (source === 'hal') base['IdHAL_i_candidat'] = it.candidate.ids.idhalI || '';
      if (source === 'openalex') { base['ORCID_profil'] = it.candidate.ids.orcid || ''; base['Origine'] = 'Druid (mauvais candidat)'; }
      if (source === 'scopus') base['ORCID_candidat'] = it.candidate.ids.orcid || '';
      toCreate.push(base);
    }
    const headers = { 'Content-Type': 'application/json' };
    if (toCreate.length) {
      const r = await fetch(`${gristDocUrl()}/tables/${meta.table}/records`, { method: 'POST', headers, body: JSON.stringify({ records: toCreate.map((fields) => ({ fields })) }) });
      if (!r.ok) throw new Error(`Erreur POST ${meta.table}: ${await r.text()}`);
    }
    if (toPatch.length) {
      const r = await fetch(`${gristDocUrl()}/tables/${meta.table}/records`, { method: 'PATCH', headers, body: JSON.stringify({ records: toPatch }) });
      if (!r.ok) throw new Error(`Erreur PATCH ${meta.table}: ${await r.text()}`);
    }
    return { rejected: toCreate.length + toPatch.length };
  },

  rejectIdrefCandidates: async (
    items: { uid: string; displayName: string; labo?: string; candidateCount?: number; candidate: IdrefCandidate }[],
    decision: ReviewDecision = 'Rejeté',
    note = '',
  ): Promise<{ rejected: number; tableCreated: boolean }> => {
    if (!items.length) return { rejected: 0, tableCreated: false };
    const today = new Date().toISOString().slice(0, 10);
    const ppnDigits = (v: any) => String(v || '').match(/([0-9]{6,}[0-9X])/i)?.[1]?.toUpperCase() || '';
    const authHeaders = { 'Content-Type': 'application/json' };

    const tablesResp = await fetch(`${gristDocUrl()}/tables`);
    if (!tablesResp.ok) throw new Error(t`Grist error (table list)`);
    const { tables } = await tablesResp.json();
    const tableCreated = !tables.some((t: any) => t.id === IDREF_REVIEW_TABLE);
    if (tableCreated) {
      const r = await fetch(`${gristDocUrl()}/tables`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ tables: [{ id: IDREF_REVIEW_TABLE, columns: buildIdrefReviewColumns() }] }),
      });
      if (!r.ok) throw new Error(t`Error creating table ${IDREF_REVIEW_TABLE}: ${await r.text()}`);
    }

    const revResp = await fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/records`);
    if (!revResp.ok) throw new Error(`Erreur Grist (${IDREF_REVIEW_TABLE})`);
    const { records: revRecs } = await revResp.json();
    const existing = new Map<string, { id: number; decision: string }>();
    for (const rec of revRecs) {
      existing.set(`${rec.fields['uid_dyna'] || ''}::${ppnDigits(rec.fields['PPN_candidat'])}`,
        { id: rec.id, decision: String(rec.fields['Decision'] || '') });
    }

    const toCreate: Record<string, any>[] = [];
    const toPatch: { id: number; fields: Record<string, any> }[] = [];
    for (const it of items) {
      const c = it.candidate;
      const ex = existing.get(`${it.uid}::${ppnDigits(c.ppn)}`);
      if (ex) {
        if (ex.decision !== decision) toPatch.push({ id: ex.id, fields: { Decision: decision, Date_application: today, ...(note ? { Note: note } : {}) } });
      } else {
        toCreate.push({
          uid_dyna: it.uid,
          Nom_annuaire: it.displayName,
          LABO: it.labo || '',
          Nb_candidats: it.candidateCount ?? 1,
          PPN_candidat: c.ppn,
          Nom_notice: c.fullName || '',
          Profession: c.job || '',
          Naissance: [c.birth, c.death].filter(Boolean).join('–'),
          Description_notice: c.description || '',
          ORCID_candidat: c.orcid || '',
          IdHAL_candidat: c.idhal || '',
          Decision: decision, Applique: false, Date_application: today, Pousse_le: today, Note: note,
        });
      }
    }
    if (toCreate.length) {
      const r = await fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/records`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ records: toCreate.map((fields) => ({ fields })) }),
      });
      if (!r.ok) throw new Error(`Erreur POST ${IDREF_REVIEW_TABLE}: ${await r.text()}`);
    }
    if (toPatch.length) {
      const r = await fetch(`${gristDocUrl()}/tables/${IDREF_REVIEW_TABLE}/records`, {
        method: 'PATCH', headers: authHeaders,
        body: JSON.stringify({ records: toPatch }),
      });
      if (!r.ok) throw new Error(`Erreur PATCH ${IDREF_REVIEW_TABLE}: ${await r.text()}`);
    }
    return { rejected: toCreate.length + toPatch.length, tableCreated };
  },

  /**
   * READ ONLY: compares the LDAP structures cache (structures_ldap_cache.json,
   * key = supannCodeEntite) with the Grist Structures table (key local_id).
   * Classifies into: to update (type / name if empty / LDAP code), to create, orphans.
   */
  computeStructuresLdapDiff: async (): Promise<StructuresLdapDiff> => {
    let cache: Record<string, any> = {};
    try {
      const r = await fetch('/structures_ldap_cache.json', { cache: 'no-store' });
      if (r.ok) cache = await r.json();
    } catch (e) { console.warn('LDAP structures cache not found'); }

    const resp = await fetch(`${gristDocUrl()}/tables/Structures/records`);
    if (!resp.ok) throw new Error('Erreur Grist (Structures)');
    const { records } = await resp.json();
    const byLid: Record<string, any> = {};
    records.forEach((r: any) => { const l = r.fields['local_id']; if (l !== undefined && l !== null && String(l) !== '') byLid[String(l)] = r; });

    const today = new Date().toISOString().slice(0, 10);
    const parseOuLeaf = (leaf: string) => {
      const tk = (leaf || '').split(/\s+/).filter(Boolean);
      const last = tk[tk.length - 1] || '';
      return { acronym: /[A-Za-zÀ-ÿ]/.test(last) ? last : '', name: leaf || '' };
    };

    // Index by supannCodeEntite to resolve the direct hierarchical parent (supannCodeEntiteParent).
    // In LDAP: team (ER) → lab (UMR/UR) → faculty (UFR). Poles are standalone.
    // Only resolved when the parent is within scope (administrative parents — DGS… — are ignored).
    const byCode: Record<string, any> = {};
    for (const e of Object.values(cache)) { const c = (e as any).code; if (c) byCode[String(c)] = e; }
    const resolveParentRef = (e: any): string => {
      if (!e.parent) return '';
      const p = byCode[String(e.parent)];
      if (!p) return '';
      const { acronym, name } = parseOuLeaf(p.ouLeaf);
      return acronym || name || '';
    };

    const aMettreAJour: StructuresLdapDiff['aMettreAJour'] = [];
    const aCreer: StructuresLdapDiff['aCreer'] = [];
    const orphelins: StructuresLdapDiff['orphelins'] = [];
    const seen = new Set<string>();

    for (const entry of Object.values(cache)) {
      const e: any = entry;
      const lid = String(e.code || ''); // local_id Grist = supannCodeEntite
      if (!lid) continue;
      const rec = byLid[lid];
      const { acronym, name } = parseOuLeaf(e.ouLeaf);
      const parentLab = resolveParentRef(e); // direct parent (acronym): ER→lab, UMR/UR→UFR
      if (rec) {
        seen.add(lid);
        const f = rec.fields;
        const changes: LdapFieldChange[] = [];
        if (e.type && String(f['type'] || '') !== e.type) changes.push({ field: 'type', label: 'Type', before: String(f['type'] || ''), after: e.type });
        if (e.code && !String(f['supann_code_entite'] || '').trim()) changes.push({ field: 'supann_code_entite', label: 'Code entité LDAP', before: '', after: e.code });
        // Name: only when the Grist label is empty (the bridge labels are better)
        if (acronym && !String(f['short_labels'] || '').trim()) changes.push({ field: 'short_labels', label: 'Sigle', before: '', after: `${acronym}[fr]` });
        if (name && !String(f['long_labels'] || '').trim()) changes.push({ field: 'long_labels', label: 'Nom', before: '', after: `${name}[fr]` });
        // Hierarchical parent (direct LDAP parent): filled / fixed when different
        if (parentLab && String(f['parent_structure'] || '').trim() !== parentLab) changes.push({ field: 'parent_structure', label: 'Rattachement (parent)', before: String(f['parent_structure'] || ''), after: parentLab });
        if (changes.length) aMettreAJour.push({ id: `S-${rec.id}`, local_id: lid, displayName: parseMultiLabel(f['short_labels']) || name || lid, rattachement: parentLab, changes });
      } else {
        // Creation: always set the same keys (uniform POST batch)
        const fields: Record<string, any> = {
          local_id: lid,
          supann_code_entite: lid,
          generic_type: 'unit',
          type: e.type || '',
          short_labels: acronym ? `${acronym}[fr]` : '',
          long_labels: name ? `${name}[fr]` : '',
          parent_structure: parentLab,
          LDAP_derniere_maj: today,
          LDAP_champs_modifies: 'création',
        };
        aCreer.push({ local_id: lid, displayName: acronym || name || lid, type: e.type || '', rattachement: parentLab, fields });
      }
    }

    for (const [lid, rec] of Object.entries(byLid)) {
      if (!seen.has(lid)) orphelins.push({ id: `S-${rec.id}`, local_id: lid, displayName: parseMultiLabel(rec.fields['short_labels']) || lid });
    }

    return {
      generatedAt: new Date().toISOString(),
      stats: { ldapTotal: Object.keys(cache).length, gristTotal: records.length, aMettreAJour: aMettreAJour.length, aCreer: aCreer.length, orphelins: orphelins.length },
      aMettreAJour, aCreer, orphelins,
    };
  },

  /**
   * Applies to the Grist Structures table the selected LDAP updates and creations.
   * Updates: PATCH grouped by field signature. Creations: POST in batches (uniform keys).
   */
  applyStructuresLdapUpdates: async (
    diff: StructuresLdapDiff,
    updateIds: string[],
    createKeys: string[],
  ): Promise<{ updated: number; created: number }> => {
    const today = new Date().toISOString().slice(0, 10);
    const upSel = new Set(updateIds);
    const crSel = new Set(createKeys);
    const URL = `${gristDocUrl()}/tables/Structures/records`;
    const headers = { 'Content-Type': 'application/json' };

    // --- MAJ (PATCH) ---
    const ups = diff.aMettreAJour.filter((r) => upSel.has(r.id)).map((r) => {
      const fields: Record<string, any> = {};
      for (const c of r.changes) fields[c.field] = c.after;
      fields['LDAP_derniere_maj'] = today;
      fields['LDAP_champs_modifies'] = r.changes.map((c) => c.field).join('|');
      return { id: parseInt(r.id.replace('S-', '')), fields };
    });
    const groups = new Map<string, { id: number; fields: Record<string, any> }[]>();
    for (const rec of ups) {
      const sig = Object.keys(rec.fields).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(rec);
    }
    let updated = 0;
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += 100) {
        const chunk = group.slice(i, i + 100);
        const r = await fetch(URL, { method: 'PATCH', headers, body: JSON.stringify({ records: chunk }) });
        if (!r.ok) throw new Error(`Erreur PATCH Structures: ${await r.text()}`);
        updated += chunk.length;
      }
    }

    // --- Creations (POST) ---
    const crs = diff.aCreer.filter((c) => crSel.has(c.local_id)).map((c) => ({ fields: { ...c.fields, LDAP_derniere_maj: today } }));
    let created = 0;
    for (let i = 0; i < crs.length; i += 100) {
      const chunk = crs.slice(i, i + 100);
      const r = await fetch(URL, { method: 'POST', headers, body: JSON.stringify({ records: chunk }) });
      if (!r.ok) throw new Error(`Erreur POST Structures: ${await r.text()}`);
      created += chunk.length;
    }

    return { updated, created };
  }
};

/** Grist date conversion (epoch s) → ISO, exposed for display outside the service (merge assistant). */
export const gristDateToIso = fromGristDate;
