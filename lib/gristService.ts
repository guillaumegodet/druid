import { t } from '@lingui/core/macro';
import { Researcher, ResearcherStatus, Structure, StructureLevel } from '../types';
import { hasCapability } from './auth';
import { purgeStoredDirectory } from './directoryStorage';
import { getGradeFromNcorps } from './gradeTypology';

import { ValidationInfo } from './validation';

// --- LDAP sync: diff structures (Phase 1, read only) ---

import { PARKING_LABOS, LdapDuplicateKind } from './mergeProposal';
import { gristDocUrl } from './instanceRuntime';
import { statusFromEtat } from './ldapPerson';

import { DirectoryApi } from './directoryApi';
import { computeDuplicateGroups, DuplicateGroup, DuplicatesDiff } from './directory/duplicates';
import type { LdapDiff, LdapCandidatesDiff, LdapResolved, StructuresLdapDiff } from './directory/ldap';
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
import { toGristEpoch, AnnuaireColumnMeta, planAffiliationRows } from './directory/annuaireWrite';
import { makeLocalId } from './directory/structureWrite';
// Moved to lib/directory/annuaireWrite.ts / structureWrite.ts (migration plan, lots 2 a-b), re-exported for the
// existing importers.
export { resolveNewStructureLocalId } from './directory/structureWrite';
export { planAffiliationRows };
export type { AnnuaireColumnMeta, AffiliationRowPlan } from './directory/annuaireWrite';
export { PARKING_LABOS };
export type { LdapDuplicateKind };

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

/** Qualification columns for multi-affiliations (duplicate merge plan, lot 1): lib/directory/gristMapping.ts. */
export { DUPLICATE_DECISION_COL };

/** Cache of the Annuaire columns (rarely changes). */
let _annuaireColumnsCache: AnnuaireColumnMeta[] | null = null;
async function fetchAnnuaireColumnsInternal(): Promise<AnnuaireColumnMeta[]> {
  if (_annuaireColumnsCache) return _annuaireColumnsCache;
  _annuaireColumnsCache = await DirectoryApi.annuaireColumns();
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
  computeStructuresLdapDiff: (): Promise<StructuresLdapDiff> => DirectoryApi.ldapStructures(),

  /** Applies the checked LDAP structure updates and creations (recomputed by the server from its diff). */
  applyStructuresLdapUpdates: (_diff: StructuresLdapDiff, updateIds: string[], createKeys: string[]): Promise<{ updated: number; created: number }> =>
    DirectoryApi.applyStructuresLdap(updateIds, createKeys),
};

/** Grist date conversion (epoch s) → ISO, exposed for display outside the service (merge assistant). */
export const gristDateToIso = fromGristDate;
