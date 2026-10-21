/**
 * @file alignEstimate.ts
 * @description Estimate of a people alignment run on a tenant (druid-internal docs/plan-druid-saas.md, lot 3 a): what
 * the launch window of the unified page shows (GET /api/align/estimate, lib/unifiedAlignRuns.ts AlignEstimate). A pure
 * port of scripts/lib/align_targets.cjs (selectTargets) and align_common.cjs (fetchAnnuaire, applyTargetFilters) on the
 * directory rows read as Grist records (lib/directory/pg/tableClient.ts) and on the caches of lib/saas/alignCache.ts:
 * the window counts exactly what the scripts will process. Scopus has no quota tracking here: a run is allowed when the
 * tenant holds a key, its budget is unknown.
 */
import type { PeopleAlignSource } from './jobs';

export interface AlignTarget {
  recId: number;
  key: string;
  first: string;
  last: string;
  idref: string;
  orcid: string;
  idhal: string;
  idhalI: string;
  openalexIds: string;
  scopus: string;
  labo: string;
  typeEmploi: string;
  libTypeEmploi: string;
  statut: string;
}

/** Same projection as scripts/lib/align_common.cjs fetchAnnuaire. */
export const alignTargetOf = (rec: { id: number; fields: Record<string, any> }): AlignTarget => {
  const f = rec.fields || {};
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    recId: rec.id, key: s(f.uid_dyna) || `g${rec.id}`, first: s(f.Prenom), last: s(f.Nom), idref: s(f.IdRef), orcid: s(f.ORCID),
    idhal: s(f.IdHAL), idhalI: s(f.IdHAL_i), openalexIds: s(f.OpenAlex_ids), scopus: s(f.ID_SCOPUS), labo: s(f.LABO),
    typeEmploi: s(f.TYPE_EMPLOI), libTypeEmploi: s(f.LIB_TYPE_EMPLOI), statut: s(f.statut_dyna),
  };
};

const extractPpn = (raw: string): string => { const m = raw.match(/([0-9]{6,}[0-9X])/i); return m ? m[1].toUpperCase() : ''; };
const parseAIds = (raw: string): string[] => {
  const out: string[] = [];
  for (const x of raw.split(/[|,;\s]+/)) { const m = x.match(/(A\d{4,})/i); if (m && !out.includes(m[1].toUpperCase())) out.push(m[1].toUpperCase()); }
  return out;
};
const digits = (v: string) => v.replace(/\D/g, '');
const scopusIdOf = (p: AlignTarget): string => (/^\d{6,12}$/.test(digits(p.scopus)) && p.scopus.trim() !== '0' ? digits(p.scopus) : '');
const scopusMarkedAbsent = (p: AlignTarget): boolean => !scopusIdOf(p) && p.scopus.trim() !== '' && p.scopus.trim() !== '0';
const doneInMode = (entry: any, mode: string): boolean => !!entry && entry.mode === mode && entry.status !== 'error';

export type AlignRunMode = 'search' | 'verify';
interface SourceSpec { cache: string; modes: AlignRunMode[]; eligible: (p: AlignTarget, mode: AlignRunMode) => boolean; done: (entry: any, mode: AlignRunMode) => boolean }
/** Same rules as scripts/lib/align_targets.cjs TARGET_SOURCES. */
export const TARGET_SOURCES: Record<PeopleAlignSource, SourceSpec> = {
  idref: { cache: 'idref_align_qualinka_cache', modes: ['search'], eligible: (p) => !extractPpn(p.idref), done: (entry) => !!(entry && entry.status) },
  orcid: { cache: 'orcid_align_cache', modes: ['search', 'verify'], eligible: (p, mode) => (mode === 'verify' ? !!p.orcid.trim() : !p.orcid.trim()), done: doneInMode },
  hal: {
    cache: 'hal_align_cache', modes: ['search', 'verify'],
    eligible: (p, mode) => { const known = !!p.idhal.trim() || !!p.idhalI.trim(); return mode === 'verify' ? known : !known; },
    done: doneInMode,
  },
  openalex: {
    cache: 'openalex_align_cache', modes: ['search', 'verify'],
    eligible: (p, mode) => (mode === 'verify' ? parseAIds(p.openalexIds).length > 0 : !parseAIds(p.openalexIds).length && p.statut.trim().toUpperCase() !== 'DEPART'),
    done: doneInMode,
  },
  scopus: {
    cache: 'scopus_align_cache', modes: ['search', 'verify'],
    eligible: (p, mode) => (mode === 'verify' ? !!scopusIdOf(p) : !scopusIdOf(p) && !scopusMarkedAbsent(p)),
    done: doneInMode,
  },
};

/** API calls per record (scripts/lib/align_estimate.cjs ALIGN_COST). */
export const ALIGN_COST: Record<PeopleAlignSource, Partial<Record<AlignRunMode, Record<string, number>>>> = {
  idref: { search: { requests: 10 } },
  orcid: { search: { requests: 3 }, verify: { requests: 1 } },
  hal: { search: { requests: 3 }, verify: { requests: 1 } },
  openalex: { search: { requests: 3 }, verify: { requests: 1 } },
  scopus: { search: { search: 1.7, author: 1.8 }, verify: { author: 0.04 } },
};

const isDoctorant = (p: AlignTarget) => p.typeEmploi.trim().toUpperCase() === 'DOCTORANT';
const isHorsRecherche = (p: AlignTarget) => /n'ayant pas d'obligation statutaire de recherche/i.test(p.libTypeEmploi.replace(/[’‘]/g, "'"));
export const alignGroupOf = (p: AlignTarget): 'personnel' | 'doctorants' | 'hors_recherche' => (isDoctorant(p) ? 'doctorants' : isHorsRecherche(p) ? 'hors_recherche' : 'personnel');

export interface EstimateScope { mode: AlignRunMode; labo?: string; group?: string }
export interface SourceEstimate { eligible: number; pending: number; unit: Record<string, number> }

/** Per source supporting `mode`: the records of the scope to process, those never processed, the cost per record. */
export const estimateAlignment = (
  records: { id: number; fields: Record<string, any> }[],
  caches: Partial<Record<string, Record<string, any> | null>>,
  { mode, labo = '', group = '' }: EstimateScope,
  sources: PeopleAlignSource[] = Object.keys(TARGET_SOURCES) as PeopleAlignSource[],
): Partial<Record<PeopleAlignSource, SourceEstimate>> => {
  const all = records.map(alignTargetOf);
  const out: Partial<Record<PeopleAlignSource, SourceEstimate>> = {};
  const laboKey = labo.trim().toUpperCase();
  for (const src of sources) {
    const spec = TARGET_SOURCES[src];
    if (!spec.modes.includes(mode)) continue;
    let scoped = all.filter((p) => (p.first || p.last) && spec.eligible(p, mode));
    if (laboKey) scoped = scoped.filter((p) => p.labo.trim().toUpperCase() === laboKey);
    if (group) scoped = scoped.filter((p) => alignGroupOf(p) === group);
    const cache = caches[spec.cache] || {};
    const pending = scoped.filter((p) => !spec.done(cache[p.key], mode));
    out[src] = { eligible: scoped.length, pending: pending.length, unit: ALIGN_COST[src][mode] || {} };
  }
  return out;
};
