/**
 * @file alignRun.ts
 * @description One run of the structure alignment on a PostgreSQL directory (druid-internal docs/plan-druid-saas.md,
 * lot 4 e): the structures of the scope become `StructureFacts`, the engine (alignEngine.ts) queries the registries,
 * and what it finds is written back — candidates (pending, the refused ones left alone), verification of the
 * confirmed identifiers, search bookkeeping. Used by the job of a single instance (scripts/align_structures.ts, run by
 * server.cjs or a cron) and by the runner of a multi-tenant deployment.
 */
import { sql } from 'kysely';
import { StructureLevel, type Structure } from '../../types';
import type { Db } from '../db/core';
import { mapStructureRecords } from '../directory/gristMapping';
import { ALIGNED_STRUCTURE_ID_TYPES, type StructureIdType } from './identifiers';
import { alignStructure, type AlignMode, type StructureAlignResult, type StructureFacts } from './alignEngine';
import { levelOf } from './pg/alignCommands';
import { readStructureIdentifiers } from './pg/identifiers';
import type { Registry } from './registryClient';

export interface AlignRunOptions {
  mode: AlignMode;
  types?: StructureIdType[];
  /** Only these structures (row ids or acronyms); default: every lab and team, institutions excluded. */
  only?: string[];
  /** Search again the structures already searched for a type (default: only the never-searched pairs). */
  force?: boolean;
  limit?: number;
  /** Two structures at a time: the registries are shared public services. */
  concurrency?: number;
  countryCode?: string | null;
  log?: (line: string) => void;
  onProgress?: (p: { total: number; done: number }) => void;
  /** Checked between two structures: a stop request ends the run after the structures in progress. */
  shouldStop?: () => boolean;
}

export interface AlignRunReport {
  total: number;
  done: number;
  candidates: number;
  conflicts: number;
  verificationIssues: number;
  errors: number;
  stopped: boolean;
}

/** Facts of a structure as the engine wants them, from the record and its confirmed identifiers. */
export const factsOf = (s: Structure, ids: Partial<Record<StructureIdType, string[]>>, countryCode?: string | null): StructureFacts => ({
  id: Number(String(s.id).replace(/^S-/, '')) || 0,
  acronym: s.acronym,
  name: s.officialName || s.acronym,
  level: levelOf(s),
  unitLabel: s.type && s.code && /^[A-Z]/i.test(s.type) ? `${s.type} ${s.code}` : null,
  city: s.city || null,
  countryCode: countryCode ?? (s.country || 'FR'),
  tutelles: s.supervisors || [],
  ids,
});

export const runStructureAlignment = async (db: Db, registry: Registry, options: AlignRunOptions): Promise<AlignRunReport> => {
  const log = options.log ?? (() => {});
  const types = options.types ?? ALIGNED_STRUCTURE_ID_TYPES;
  const rows = await db.selectFrom('structure').select(['id', 'local_id', 'extra']).orderBy('id').execute();
  const structures = mapStructureRecords(rows.map((s) => ({ id: Number(s.id), fields: { ...(s.extra as object), local_id: s.local_id } })));
  const identifiers = await readStructureIdentifiers(db);
  // A pair searched with an error (registry down, quota) is searched again.
  const searched = new Set((await db.selectFrom('structure_alignment_search').select(['structure_id', 'type']).where('error', 'is', null).execute()).map((r) => `${r.structure_id}:${r.type}`));

  const only = options.only?.map((v) => v.trim().toUpperCase()).filter(Boolean);
  let targets = structures.filter((s) => {
    const rowId = Number(String(s.id).replace(/^S-/, ''));
    if (only?.length) return only.includes(String(rowId)) || only.includes(s.acronym.toUpperCase()) || only.includes(String(s.localId || '').toUpperCase());
    return String(s.level) !== StructureLevel.ETABLISSEMENT;
  });
  if (!options.force && !only?.length) {
    // Incremental: a structure with every type already looked at (or filled) has nothing new to search.
    targets = targets.filter((s) => {
      const rowId = Number(String(s.id).replace(/^S-/, ''));
      const ids = identifiers.get(rowId) ?? [];
      return types.some((t) => !searched.has(`${rowId}:${t}`) && (options.mode === 'verify' ? ids.some((i) => i.type === t && i.status === 'confirmed') : !ids.some((i) => i.type === t && i.status === 'confirmed')));
    });
  }
  if (options.limit && options.limit > 0) targets = targets.slice(0, options.limit);

  const report: AlignRunReport = { total: targets.length, done: 0, candidates: 0, conflicts: 0, verificationIssues: 0, errors: 0, stopped: false };
  options.onProgress?.({ total: report.total, done: 0 });
  const queue = [...targets];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      if (options.shouldStop?.()) { report.stopped = true; return; }
      const rowId = Number(String(s.id).replace(/^S-/, ''));
      const ids = identifiers.get(rowId) ?? [];
      const confirmed: Partial<Record<StructureIdType, string[]>> = {};
      const rejected = new Set<string>();
      for (const i of [...ids].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))) {
        if (i.status === 'confirmed') (confirmed[i.type] ??= []).push(i.value);
        else rejected.add(`${i.type}:${i.value}`);
      }
      for (const c of await db.selectFrom('structure_alignment_candidate').select(['type', 'candidate_id']).where('structure_id', '=', String(rowId)).where('decision', '=', 'rejected').execute()) {
        rejected.add(`${c.type}:${c.candidate_id}`);
      }
      try {
        const result = await alignStructure(factsOf(s, confirmed, options.countryCode), registry, { mode: options.mode, types, rejected, log });
        await persist(db, result, options.mode);
        report.candidates += result.candidates.length;
        report.conflicts += result.candidates.filter((c) => c.strength === 'conflict').length;
        report.verificationIssues += result.verifications.filter((v) => !v.ok).length;
        if (result.searched.some((x) => x.error)) report.errors++;
      } catch (err) {
        report.errors++;
        log(`structure ${rowId} (${s.acronym}) failed: ${err instanceof Error ? err.message : err}`);
        await db.insertInto('structure_alignment_search').values(types.map((t) => ({ structure_id: String(rowId), type: t, mode: options.mode, candidates: 0, error: String(err instanceof Error ? err.message : err).slice(0, 300) })))
          .onConflict((oc) => oc.columns(['structure_id', 'type']).doUpdateSet({ error: (eb) => eb.ref('excluded.error'), searched_at: sql`now()` as any, mode: options.mode })).execute().catch(() => {});
      }
      report.done++;
      options.onProgress?.({ total: report.total, done: report.done });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, queue.length)) }, worker));
  return report;
};

/** Writes the result of one structure: candidates upserted (pending ones refreshed, decided ones kept), verifications
 * stamped on the identifiers, search bookkeeping. Candidates of the run's types that the run no longer proposes are
 * dropped when still pending (a record corrected, a value confirmed meanwhile), unless the type's registry failed. */
export const persist = async (db: Db, result: StructureAlignResult, mode: AlignMode): Promise<void> => {
  const sid = String(result.structureId);
  // Given a transaction (the tests), the writes join it instead of opening one.
  const inTransaction = async (fn: (trx: Db) => Promise<void>) => (db.isTransaction ? fn(db) : db.transaction().execute(fn));
  await inTransaction(async (trx) => {
    await sql`SELECT set_config('druid.actor', 'job:align_structures', true)`.execute(trx);
    // Pending candidates of the types the run looked at again are replaced — except when a registry failed on the
    // type: what the previous run found is worth more than nothing.
    const types = [...new Set(result.searched.filter((s) => !s.error).map((s) => s.type))];
    if (types.length) {
      const keep = result.candidates.map((c) => `${c.type}:${c.candidateId}`);
      const stale = await trx.selectFrom('structure_alignment_candidate').select(['id', 'type', 'candidate_id']).where('structure_id', '=', sid).where('type', 'in', types).where('decision', '=', 'pending').execute();
      const drop = stale.filter((c) => !keep.includes(`${c.type}:${c.candidate_id}`)).map((c) => c.id);
      if (drop.length) await trx.deleteFrom('structure_alignment_candidate').where('id', 'in', drop).execute();
    }
    for (const c of result.candidates) {
      await trx.insertInto('structure_alignment_candidate')
        .values({ structure_id: sid, type: c.type, candidate_id: c.candidateId, score: String(c.score), strength: c.strength, evidence: JSON.stringify(c.evidence) as any, mode })
        .onConflict((oc) => oc.columns(['structure_id', 'type', 'candidate_id']).doUpdateSet({
          score: String(c.score), strength: c.strength, evidence: JSON.stringify(c.evidence) as any, mode, seen_at: sql`now()` as any,
        }).where('structure_alignment_candidate.decision', '=', 'pending'))
        .execute();
    }
    for (const v of result.verifications) {
      await trx.updateTable('structure_identifier').set({ checked_at: sql`now()` as any, check_result: JSON.stringify({ ok: v.ok, ...v.result }) as any })
        .where('structure_id', '=', sid).where('type', '=', v.type).where('value', '=', v.value).execute();
    }
    for (const s of result.searched) {
      await trx.insertInto('structure_alignment_search').values({ structure_id: sid, type: s.type, mode: s.mode, candidates: s.candidates, error: s.error ?? null })
        .onConflict((oc) => oc.columns(['structure_id', 'type']).doUpdateSet({ mode: s.mode, candidates: s.candidates, error: s.error ?? null, searched_at: sql`now()` as any }))
        .execute();
    }
  });
};
