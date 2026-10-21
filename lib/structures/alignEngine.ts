/**
 * @file alignEngine.ts
 * @description Alignment of the identifiers of one structure (druid-internal docs/plan-druid-saas.md, § 4.4): bridges
 * first (from every confirmed identifier, read its record and derive the others through the links the registries
 * carry; a value reached by two independent paths is strong), then a search by name, acronym, unit label, city and
 * supervising institutions for the types still empty, with a score; `verify` re-reads the confirmed identifiers and
 * reports the records that disappeared, closed or contradict another identifier. Pure given a `Registry`
 * (registryClient.ts, or a fake in the tests); the database side is lib/structures/pg.
 */
import {
  ALIGNED_STRUCTURE_ID_TYPES, nameSimilarity, nameTokens, normalizeAcronymKey, parseUnitLabel, significantTokens, structureIdUrl, type StructureIdType,
} from './identifiers';
import type { Registry } from './registryClient';
import type { RegistryRecord } from './registries';

export type AlignMode = 'search' | 'verify';
export type CandidateStrength = 'strong' | 'medium' | 'weak' | 'conflict';

/** What the engine knows of the structure to align (the directory record plus its confirmed identifiers). */
export interface StructureFacts {
  id: number;
  acronym: string;
  name: string;
  level: 'lab' | 'team' | 'institution' | 'other';
  /** `UMR 6004`, from the unit type and code of the record. */
  unitLabel?: string | null;
  city?: string | null;
  countryCode?: string | null;
  /** Names of the supervising institutions. */
  tutelles?: string[];
  /** Confirmed identifiers, primary first. */
  ids: Partial<Record<StructureIdType, string[]>>;
}

export interface CandidateEvidence {
  label: string;
  acronym: string | null;
  city: string | null;
  kind: string | null;
  unitLabel: string | null;
  tutelles: string[];
  worksCount: number | null;
  closed: boolean;
  url: string;
  /** Bridges that reached the value: `rnsr:201722241F → hal_struct` ... */
  paths: string[];
  nameScore: number;
  reasons: string[];
  /** The confirmed value this candidate contradicts (strength `conflict`). */
  conflictWith?: string;
}

export interface StructureCandidate {
  type: StructureIdType;
  candidateId: string;
  score: number;
  strength: CandidateStrength;
  evidence: CandidateEvidence;
}

export interface IdentifierVerification {
  type: StructureIdType;
  value: string;
  /** Record found and consistent with the structure. */
  ok: boolean;
  result: { exists: boolean; label?: string; closed?: boolean; nameScore?: number; acronymMatch?: boolean; error?: string };
}

export interface StructureAlignResult {
  structureId: number;
  candidates: StructureCandidate[];
  verifications: IdentifierVerification[];
  /** Types the run looked at, with the count of candidates kept (0 = searched, nothing found). */
  searched: { type: StructureIdType; mode: AlignMode; candidates: number; error?: string }[];
}

export interface AlignOptions {
  mode: AlignMode;
  /** Types to work on (default: the aligned types). */
  types?: StructureIdType[];
  /** `type:value` pairs refused by a user: never proposed again. */
  rejected?: ReadonlySet<string>;
  log?: (line: string) => void;
}

/** Types whose registry the engine can read. */
const REGISTRY_TYPES: StructureIdType[] = ['rnsr', 'ror', 'hal_struct', 'openalex', 'idref', 'wikidata'];
const STRONG = 0.75;
const MEDIUM = 0.45;
const KEEP = 0.25;

const keyOf = (type: StructureIdType, value: string) => `${type}:${value}`;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Reads a record of `type` from the registry (null when unknown, undefined when the registry failed). */
const read = async (registry: Registry, type: StructureIdType, id: string): Promise<RegistryRecord | null | undefined> => {
  const lookup = type === 'hal_struct' ? registry.hal : type === 'hal_collection' ? null : (registry as any)[type];
  if (!lookup) return null;
  try { return await lookup.get(id); } catch { return undefined; }
};

/** How well a record names the structure: acronym equality, unit label equality, token similarity. */
const nameEvidence = (facts: StructureFacts, rec: RegistryRecord) => {
  const acr = normalizeAcronymKey(facts.acronym);
  const recAcronyms = [rec.acronym, ...rec.altNames].map(normalizeAcronymKey).filter(Boolean);
  // The record's own acronym, or a label reduced to the acronym (`LS2N`): a sure match in a registry of research
  // organizations, a coincidence in a general one (a team called « Sourire » is not the film) — see GENERAL_REGISTRIES.
  const acronymField = !!acr && acr.length >= 2 && recAcronyms.includes(acr);
  const acronymMatch = acronymField || (!!acr && acr.length >= 2 && normalizeAcronymKey(rec.label) === acr);
  // `PSYCHOLOGIE` within « Faculté de Psychologie (Nantes) »: enough to recognize a record, not to pick one.
  const acronymInLabel = !!acr && acr.length >= 4 && [rec.label, ...rec.altNames].some((n) => nameTokens(n).includes(acr));
  const names = [rec.label, ...rec.altNames];
  const nameScore = Math.max(...names.map((n) => nameSimilarity(facts.name, n)), facts.acronym ? Math.max(...names.map((n) => nameSimilarity(facts.acronym, n))) * 0.8 : 0);
  const unit = facts.unitLabel ? parseUnitLabel(facts.unitLabel) : null;
  const recUnit = rec.unitLabel ? parseUnitLabel(rec.unitLabel) : null;
  const unitMatch = !!unit && !!recUnit && unit.code === recUnit.code;
  const unitClash = !!unit && !!recUnit && unit.code !== recUnit.code;
  return { acronymMatch, acronymField, acronymInLabel, nameScore, unitMatch, unitClash };
};

const cityMatch = (facts: StructureFacts, rec: RegistryRecord): boolean => {
  const city = significantTokens(facts.city).join(' ');
  if (!city) return false;
  const hay = [rec.city, rec.address].map((s) => significantTokens(s).join(' ')).filter(Boolean);
  return hay.some((h) => h === city || h.includes(city));
};

const tutelleMatch = (facts: StructureFacts, rec: RegistryRecord): boolean => {
  const mine = (facts.tutelles || []).map((t) => new Set(significantTokens(t))).filter((s) => s.size);
  if (!mine.length || !rec.tutelles.length) return false;
  return rec.tutelles.some((t) => { const s = new Set(significantTokens(t)); return mine.some((m) => [...m].filter((w) => s.has(w)).length >= Math.min(2, m.size)); });
};

/** The registry's own typing against the structure's level: a team is not a university. */
const kindPenalty = (facts: StructureFacts, rec: RegistryRecord): number => {
  const k = (rec.kind || '').toLowerCase();
  if (!k) return 0;
  const institutionKinds = ['education', 'university', 'institution', 'government', 'company', 'healthcare', 'funder', 'nonprofit', 'regroupinstitution', 'établissement'];
  const teamKinds = ['researchteam', 'department', 'équipe'];
  if (facts.level === 'team') return institutionKinds.some((x) => k.includes(x)) ? -0.35 : 0;
  if (facts.level === 'lab') {
    if (teamKinds.some((x) => k.includes(x))) return -0.2;
    if (institutionKinds.some((x) => k.includes(x)) && rec.type !== 'rnsr') return -0.3;
  }
  return 0;
};

const evidenceOf = (facts: StructureFacts, rec: RegistryRecord, paths: string[], reasons: string[], nameScore: number): CandidateEvidence => ({
  label: rec.label, acronym: rec.acronym, city: rec.city, kind: rec.kind, unitLabel: rec.unitLabel, tutelles: rec.tutelles.slice(0, 6),
  worksCount: rec.worksCount, closed: rec.closed, url: rec.url, paths, nameScore: round(nameScore), reasons,
});

/** Score of a searched record (0..1) and why. */
/** Registries of everything (not only research organizations): a name alone never makes a strong candidate there. */
const GENERAL_REGISTRIES: StructureIdType[] = ['wikidata', 'idref'];

const scoreRecord = (facts: StructureFacts, rec: RegistryRecord): { score: number; reasons: string[]; nameScore: number } => {
  const { acronymMatch, acronymField, nameScore, unitMatch, unitClash } = nameEvidence(facts, rec);
  const general = GENERAL_REGISTRIES.includes(rec.type);
  const reasons: string[] = [];
  let score = nameScore * 0.45;
  if (acronymField || (acronymMatch && !general)) { score += 0.4; reasons.push('acronym'); }
  else if (acronymMatch) { score += 0.1; reasons.push('acronym'); }
  if (nameScore >= 0.6) reasons.push('name');
  if (unitMatch) { score += 0.25; reasons.push('unit_label'); }
  if (unitClash) { score -= 0.25; reasons.push('other_unit_label'); }
  if (cityMatch(facts, rec)) { score += 0.1; reasons.push('city'); }
  if (tutelleMatch(facts, rec)) { score += 0.1; reasons.push('supervisor'); }
  const kp = kindPenalty(facts, rec);
  if (kp) { score += kp; reasons.push('other_kind'); }
  if (rec.closed) { score -= 0.2; reasons.push('closed'); }
  if (rec.type === 'openalex' && rec.worksCount === 0) { score -= 0.1; reasons.push('no_works'); }
  if (facts.countryCode && rec.countryCode && rec.countryCode.toUpperCase() !== facts.countryCode.toUpperCase()) { score -= 0.4; reasons.push('other_country'); }
  // A general registry: strong only when the record links back to an identifier the structure already has, or
  // carries the unit number; otherwise at most medium, for a human to read.
  const linksBack = (Object.entries(rec.links) as [StructureIdType, string[]][]).some(([t, vs]) => vs.some((v) => (facts.ids[t] || []).includes(v)));
  if (general && !linksBack && !unitMatch) score = Math.min(score, STRONG - 0.01);
  if (linksBack) { score = Math.max(score, STRONG); reasons.push('links_back'); }
  return { score: Math.max(0, Math.min(1, score)), reasons, nameScore };
};

const strengthOf = (score: number): CandidateStrength => (score >= STRONG ? 'strong' : score >= MEDIUM ? 'medium' : 'weak');

export async function alignStructure(facts: StructureFacts, registry: Registry, options: AlignOptions): Promise<StructureAlignResult> {
  const types = options.types ?? ALIGNED_STRUCTURE_ID_TYPES;
  const rejected = options.rejected ?? new Set<string>();
  const log = options.log ?? (() => {});
  const confirmed = (type: StructureIdType): string[] => facts.ids[type] || [];
  const isKnown = (type: StructureIdType, value: string) => confirmed(type).includes(value) || rejected.has(keyOf(type, value));

  const candidates = new Map<string, StructureCandidate>();
  const verifications: IdentifierVerification[] = [];
  const searched = new Map<StructureIdType, { type: StructureIdType; mode: AlignMode; candidates: number; error?: string }>();
  const touch = (type: StructureIdType, error?: string) => {
    const s = searched.get(type) ?? { type, mode: options.mode, candidates: 0 };
    if (error) s.error = s.error ? `${s.error}; ${error}` : error;
    searched.set(type, s);
  };

  // Records already read: `type:id` → record (or null when the registry does not know it).
  const records = new Map<string, RegistryRecord | null>();
  const fetchRecord = async (type: StructureIdType, id: string): Promise<RegistryRecord | null> => {
    const k = keyOf(type, id);
    if (!records.has(k)) {
      const rec = await read(registry, type, id);
      if (rec === undefined) { touch(type, `read failed: ${id}`); records.set(k, null); } else records.set(k, rec);
    }
    return records.get(k) ?? null;
  };

  /** Values reached through the bridges: `type:value` → the paths that reached it; the queue of the walk. */
  const bridged: Map<string, { type: StructureIdType; value: string; paths: Set<string> }> = new Map();
  const queue: { type: StructureIdType; value: string; depth: number }[] = [];
  const reach = (type: StructureIdType, value: string, path: string, depth: number) => {
    if (!types.includes(type) && !REGISTRY_TYPES.includes(type)) return;
    const k = keyOf(type, value);
    const b = bridged.get(k) ?? { type, value, paths: new Set<string>() };
    b.paths.add(path);
    bridged.set(k, b);
    queue.push({ type, value, depth });
  };
  /** Follows the links of a record: its other identifiers become reached values. */
  const follow = (rec: RegistryRecord, from: string, depth: number) => {
    for (const [t, values] of Object.entries(rec.links) as [StructureIdType, string[]][]) for (const v of values) reach(t, v, `${from} → ${t}`, depth);
  };
  /** Registries that index a record by another identifier (HAL by RNSR/ROR/IdRef, OpenAlex by ROR, Wikidata by ROR/ISNI/GRID/IdRef/OpenAlex). */
  const reverse = async (type: StructureIdType, value: string, from: string, depth: number) => {
    const tasks: Promise<void>[] = [];
    const keep = (t: StructureIdType) => (recs: RegistryRecord[]) => { for (const r of recs) { records.set(keyOf(t, r.id), r); reach(t, r.id, `${from} → ${t}`, depth); } };
    if ((type === 'rnsr' || type === 'ror' || type === 'idref') && (types.includes('hal_struct') || types.includes('hal_collection'))) {
      tasks.push(registry.hal.byLink(type, value).then(keep('hal_struct'), (e) => touch('hal_struct', `HAL by ${type}: ${e instanceof Error ? e.message : e}`)));
    }
    if (type === 'ror' && types.includes('openalex')) {
      tasks.push(registry.openalex.byRor(value).then(keep('openalex'), (e) => touch('openalex', `OpenAlex by ROR: ${e instanceof Error ? e.message : e}`)));
    }
    if (['ror', 'isni', 'grid', 'idref', 'openalex'].includes(type) && types.includes('wikidata')) {
      tasks.push(registry.wikidata.byLink(type, value).then(keep('wikidata'), (e) => touch('wikidata', `Wikidata by ${type}: ${e instanceof Error ? e.message : e}`)));
    }
    await Promise.all(tasks);
  };

  // 1. Walk of the bridges from the confirmed identifiers (depth 0): read the record (verification), follow its links
  // and the registries that index it (depth + 1), up to three hops — RNSR → HAL → ROR → OpenAlex / Wikidata. A reached
  // record that does not name the structure (a lab linked to its university) is kept as a value but not expanded.
  const MAX_DEPTH = 3;
  const expanded = new Set<string>();
  for (const [t, vs] of Object.entries(facts.ids) as [StructureIdType, string[]][]) for (const v of vs) queue.push({ type: t, value: v, depth: 0 });
  while (queue.length) {
    const { type, value, depth } = queue.shift()!;
    const k = keyOf(type, value);
    if (expanded.has(k)) continue;
    expanded.add(k);
    const confirmedValue = confirmed(type).includes(value);
    if (depth > 0 && (rejected.has(k) || confirmedValue)) continue;
    const rec = REGISTRY_TYPES.includes(type) ? await fetchRecord(type, value) : null;
    if (depth === 0 && REGISTRY_TYPES.includes(type) && (options.mode === 'verify' || types.includes(type))) {
      if (!rec) {
        const failed = searched.get(type)?.error?.includes(value);
        verifications.push({ type, value, ok: false, result: failed ? { exists: false, error: 'unreadable' } : { exists: false } });
      } else {
        const { acronymMatch, acronymInLabel, nameScore } = nameEvidence(facts, rec);
        verifications.push({ type, value, ok: !rec.closed && (acronymMatch || acronymInLabel || nameScore >= 0.3), result: { exists: true, label: rec.label, closed: rec.closed, nameScore: round(nameScore), acronymMatch: acronymMatch || acronymInLabel } });
      }
    }
    if (depth >= MAX_DEPTH) continue;
    if (depth > 0) {
      if (!rec && REGISTRY_TYPES.includes(type)) continue;
      if (rec) { const { acronymMatch, nameScore } = nameEvidence(facts, rec); if (!acronymMatch && nameScore < 0.3) continue; }
    }
    if (rec) follow(rec, k, depth + 1);
    await reverse(type, value, k, depth + 1);
  }

  // 3. Bridged values → candidates (or conflicts when the type already has a confirmed primary).
  for (const b of bridged.values()) {
    if (!types.includes(b.type) || rejected.has(keyOf(b.type, b.value)) || confirmed(b.type).includes(b.value)) continue;
    const rec = REGISTRY_TYPES.includes(b.type) ? await fetchRecord(b.type, b.value) : null;
    const paths = [...b.paths];
    const primary = confirmed(b.type)[0];
    const names = rec ? nameEvidence(facts, rec) : { acronymMatch: false, nameScore: 0, unitMatch: false, unitClash: false };
    const sameName = names.acronymMatch || names.nameScore >= 0.4;
    const reasons = ['bridge', ...(names.acronymMatch ? ['acronym'] : []), ...(names.nameScore >= 0.6 ? ['name'] : []), ...(rec?.closed ? ['closed'] : [])];
    const evidence: CandidateEvidence = rec
      ? evidenceOf(facts, rec, paths, reasons, names.nameScore)
      : { label: b.value, acronym: null, city: null, kind: null, unitLabel: null, tutelles: [], worksCount: null, closed: false, url: structureIdUrl(b.type, b.value), paths, nameScore: 0, reasons };
    // Distinct sources behind the paths (two links from the same record are one path).
    const sources = new Set(paths.map((p) => p.split(' → ')[0]));
    let score = Math.min(1, 0.55 + 0.2 * (sources.size - 1) + (sameName ? 0.2 : 0) + (names.unitMatch ? 0.1 : 0));
    if (rec && !sameName && names.nameScore < 0.2 && REGISTRY_TYPES.includes(b.type)) score = Math.min(score, 0.5);
    if (rec?.closed) score -= 0.15;
    score = Math.max(KEEP, round(score));
    const strength: CandidateStrength = primary && !['hal_struct', 'openalex'].includes(b.type) ? 'conflict' : strengthOf(score);
    if (strength === 'conflict') evidence.conflictWith = primary;
    candidates.set(keyOf(b.type, b.value), { type: b.type, candidateId: b.value, score, strength, evidence });
    touch(b.type);
  }

  // 4. Search, for the types still without a confirmed value nor a strong candidate.
  if (options.mode === 'search') {
    const hasStrong = (type: StructureIdType) => [...candidates.values()].some((c) => c.type === type && c.strength === 'strong');
    const query = { name: facts.name, acronym: facts.acronym, city: facts.city, countryCode: facts.countryCode };
    for (const type of types) {
      if (!REGISTRY_TYPES.includes(type) || confirmed(type).length || hasStrong(type)) continue;
      // A team has a HAL record at most; the other registries know the lab, not its teams: bridges only.
      if (facts.level === 'team' && type !== 'hal_struct') continue;
      const lookup = type === 'hal_struct' ? registry.hal : (registry as any)[type];
      let recs: RegistryRecord[] = [];
      try { recs = await lookup.search(query); touch(type); } catch (e) { touch(type, `search: ${e instanceof Error ? e.message : e}`); continue; }
      const seen = new Set<string>();
      const scored = recs.filter((r) => r.type === type && !seen.has(r.id) && seen.add(r.id) && !isKnown(type, r.id))
        .map((r) => ({ r, ...scoreRecord(facts, r) })).filter((x) => x.score >= KEEP).sort((a, b) => b.score - a.score).slice(0, 6);
      for (const { r, score, reasons, nameScore } of scored) {
        const k = keyOf(type, r.id);
        const existing = candidates.get(k);
        if (existing) { existing.score = round(Math.min(1, existing.score + 0.1)); existing.evidence.reasons.push(...reasons.filter((x) => !existing.evidence.reasons.includes(x))); existing.strength = existing.strength === 'conflict' ? 'conflict' : strengthOf(existing.score); continue; }
        records.set(k, r);
        candidates.set(k, { type, candidateId: r.id, score: round(score), strength: strengthOf(score), evidence: evidenceOf(facts, r, [], reasons, nameScore) });
      }
    }
  }

  // 5. HAL collection: the codes of the documents of the lab's HAL record (confirmed, else the strong candidate).
  if (types.includes('hal_collection') && !confirmed('hal_collection').length) {
    const docids = confirmed('hal_struct').length ? confirmed('hal_struct') : [...candidates.values()].filter((c) => c.type === 'hal_struct' && c.strength === 'strong' && !c.evidence.closed).map((c) => c.candidateId);
    const acr = normalizeAcronymKey(facts.acronym);
    const tutelleKeys = new Set((facts.tutelles || []).map(normalizeAcronymKey).filter(Boolean));
    for (const docid of docids.slice(0, 3)) {
      let facet: { total: number; codes: { code: string; count: number }[] };
      try { facet = await registry.hal.collections(docid); touch('hal_collection'); } catch (e) { touch('hal_collection', `collections of ${docid}: ${e instanceof Error ? e.message : e}`); continue; }
      if (!facet.total) continue;
      // The lab's own collection carries the acronym and most of its documents; `<ACRONYM>-<TEAM>` collections are the
      // teams' (a few per cent each); the supervising institutions' collections carry every document of the lab.
      const shared = facet.codes.filter(({ code, count }) => !isKnown('hal_collection', code) && count / facet.total >= 0.2)
        .sort((a, b) => b.count - a.count).slice(0, 6);
      for (const { code, count } of shared) {
        const codeKey = normalizeAcronymKey(code);
        const share = count / facet.total;
        const exact = !!acr && codeKey === acr;
        if (!exact && (share >= 0.95 || tutelleKeys.has(codeKey))) continue;
        const teamLike = !exact && !!acr && codeKey.startsWith(acr);
        const score = exact ? (share >= 0.5 ? 0.95 : 0.85) : teamLike ? 0.3 : share >= 0.5 ? 0.5 : 0.35;
        const k = keyOf('hal_collection', code);
        const prev = candidates.get(k);
        if (prev && prev.score >= score) continue;
        candidates.set(k, {
          type: 'hal_collection', candidateId: code, score: round(score), strength: strengthOf(score),
          evidence: { label: code, acronym: null, city: null, kind: 'collection', unitLabel: null, tutelles: [], worksCount: count, closed: false, url: structureIdUrl('hal_collection', code), paths: [`hal_struct:${docid} → hal_collection`], nameScore: exact ? 1 : 0, reasons: [exact ? 'acronym' : teamLike ? 'team_collection' : 'share', `${Math.round(share * 100)}%`] },
        });
      }
    }
  }

  // Every type the run was asked for counts as looked at: searched (nothing confirmed) or verified (something confirmed),
  // even when no registry had anything to say — « absent » rather than « never searched ».
  for (const type of types) if (options.mode === 'search' ? !confirmed(type).length : confirmed(type).length > 0) touch(type);

  const list = [...candidates.values()].filter((c) => types.includes(c.type));
  for (const c of list) { const s = searched.get(c.type) ?? { type: c.type, mode: options.mode, candidates: 0 }; s.candidates++; searched.set(c.type, s); }
  log(`structure ${facts.id} (${facts.acronym}): ${list.length} candidate(s), ${verifications.filter((v) => !v.ok).length} verification issue(s)`);
  return { structureId: facts.id, candidates: list, verifications, searched: [...searched.values()] };
}
