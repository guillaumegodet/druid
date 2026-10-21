// Structure alignment commands on PostgreSQL (druid-internal docs/plan-druid-saas.md, lot 4 a and d): the overview of
// the « Structures » tab, the identifiers of one structure, the decisions (accept candidates, reject, add, remove,
// primary) and the feed of the bibliometric ETL. Institution tools: the overview and the decisions on candidates
// require the institution right; the identifiers of a structure follow the structure's rights (a lab manager edits
// those of their lab).
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import type { Db } from '../../db/client';
import { ApiError } from '../../directory/errors';
import type { CommandContext } from '../../directory/commands';
import type { DirectoryRepository } from '../../directory/repository';
import { pgWriting } from '../../directory/pg/alignCommands';
import { normalizeAcronym } from '../../normalize';
import { StructureLevel, type Structure } from '../../../types';
import {
  ALIGNED_STRUCTURE_ID_TYPES, STRUCTURE_ID_META, isStructureIdType, normalizeStructureId, type StructureIdType, type StructureIdentifier,
} from '../identifiers';
import { cellStatus, isActionable, type StructureAlignCell, type StructureAlignOverview, type StructureAlignRow, type StructureCandidateView } from '../alignView';
import { confirmIdentifier, projectIdentifiers, readStructureIdentifiers, rejectIdentifier, setPrimaryIdentifier } from './identifiers';

export interface CandidateRef { structureId: number; type: StructureIdType; candidateId: string }

/** Identifiers of every structure, for the ETL (druid-biblio reads them instead of its hand-typed config). */
export interface StructureIdentifiersFeedRow {
  id: string;
  structureId: number;
  localId: string;
  acronym: string;
  name: string;
  level: string;
  parentAcronym: string | null;
  /** Confirmed values by type, primary first. */
  identifiers: Partial<Record<StructureIdType, string[]>>;
}

export interface StructureAlignCommands {
  overview(ctx: CommandContext): Promise<StructureAlignOverview>;
  identifiers(structureId: number, ctx: CommandContext): Promise<StructureIdentifier[]>;
  feed(ctx: CommandContext): Promise<StructureIdentifiersFeedRow[]>;
  /** Accepts pending candidates: each becomes a confirmed identifier (primary when the type has none). */
  accept(items: CandidateRef[], ctx: CommandContext): Promise<{ accepted: number }>;
  /** Refuses a candidate: never proposed again. */
  reject(item: CandidateRef & { note?: string | null }, ctx: CommandContext): Promise<{ rejected: number }>;
  add(structureId: number, type: StructureIdType, value: string, primary: boolean | undefined, ctx: CommandContext): Promise<StructureIdentifier[]>;
  /** Removes a confirmed value (kept as rejected so that the alignment does not propose it again). */
  remove(structureId: number, type: StructureIdType, value: string, note: string | null, ctx: CommandContext): Promise<StructureIdentifier[]>;
  setPrimary(structureId: number, type: StructureIdType, value: string, ctx: CommandContext): Promise<StructureIdentifier[]>;
}

export const levelOf = (s: Structure): StructureAlignRow['level'] => {
  const level = String(s.level);
  return level === StructureLevel.ENTITE ? 'lab' : level === StructureLevel.EQUIPE ? 'team' : level === StructureLevel.ETABLISSEMENT ? 'institution' : 'other';
};

const structureRowId = (s: Structure): number => Number(String(s.id).replace(/^S-/, '')) || 0;

export const createPgStructureAlignCommands = ({ db, repository }: { db: Db; repository: DirectoryRepository }): StructureAlignCommands => {
  const writing = <T>(ctx: CommandContext, fn: (trx: Transaction<DB>) => Promise<T>) => pgWriting(db, ctx, fn, () => repository.invalidate());
  const institutionOnly = (ctx: CommandContext) => { if (!ctx.scope.all) throw new ApiError(403, 'Forbidden'); };

  /** The structure, when the context may act on it (institution right, or its acronym among the user's labs). */
  const structureInScope = async (conn: any, structureId: number, ctx: CommandContext) => {
    const row = await conn.selectFrom('structure').select(['id', 'acronym', 'extra']).where('id', '=', String(structureId)).executeTakeFirst();
    if (!row) throw new ApiError(404, `Structure not found: S-${structureId}`);
    if (!ctx.scope.all) {
      const anchors = new Set(ctx.scope.labAnchors);
      const acronym = normalizeAcronym(String(row.acronym || ''));
      const parent = normalizeAcronym(String((row.extra as any)?.parent_structure || ''));
      if (!anchors.has(acronym) && !(parent && anchors.has(parent))) throw new ApiError(403, 'Rows outside scope or unknown: Structures');
    }
    return row;
  };

  const identifiersOf = async (conn: any, structureId: number): Promise<StructureIdentifier[]> => (await readStructureIdentifiers(conn, [structureId])).get(structureId) ?? [];

  const typeOf = (raw: unknown): StructureIdType => {
    if (!isStructureIdType(raw)) throw new ApiError(400, `Unknown identifier type: ${String(raw)}`);
    return raw;
  };
  const valueOf = (type: StructureIdType, raw: unknown): string => {
    const v = normalizeStructureId(type, raw);
    if (!v) throw new ApiError(400, `Invalid identifier: ${STRUCTURE_ID_META[type].label} ${String(raw)}`);
    return v;
  };

  return {
    overview: async (ctx) => {
      institutionOnly(ctx);
      const [{ items: structures }, identifiers, candidateRows, searchRows] = await Promise.all([
        repository.structures(),
        readStructureIdentifiers(db),
        db.selectFrom('structure_alignment_candidate').selectAll().where('decision', '=', 'pending').orderBy('score', 'desc').orderBy('id').execute(),
        db.selectFrom('structure_alignment_search').selectAll().execute(),
      ]);
      const candidates = new Map<string, StructureCandidateView[]>();
      for (const c of candidateRows) {
        const k = `${c.structure_id}:${c.type}`;
        if (!candidates.has(k)) candidates.set(k, []);
        candidates.get(k)!.push({ candidateId: c.candidate_id, score: Number(c.score ?? 0), strength: c.strength as any, evidence: c.evidence as any, mode: c.mode as any, seenAt: new Date(c.seen_at as any).toISOString() });
      }
      const searches = new Map<string, { at: string; error: string | null }>();
      for (const s of searchRows) searches.set(`${s.structure_id}:${s.type}`, { at: new Date(s.searched_at as any).toISOString(), error: s.error ?? null });
      let generatedAt = '';
      for (const s of searchRows) { const at = new Date(s.searched_at as any).toISOString(); if (at > generatedAt) generatedAt = at; }
      const stats = { structures: 0, actionable: 0, strong: 0, ambiguous: 0, arbitrate: 0, conflicts: 0 };
      const rank = (s: Structure) => (levelOf(s) === 'institution' ? 0 : levelOf(s) === 'lab' ? 1 : levelOf(s) === 'team' ? 2 : 3);
      const rows: StructureAlignRow[] = [...structures].sort((a, b) => rank(a) - rank(b) || a.acronym.localeCompare(b.acronym)).map((s) => {
        const structureId = structureRowId(s);
        const ids = identifiers.get(structureId) ?? [];
        const cells: StructureAlignRow['cells'] = {};
        let actionable = false;
        for (const type of ALIGNED_STRUCTURE_ID_TYPES) {
          const existing = ids.filter((i) => i.type === type && i.status === 'confirmed');
          const pending = candidates.get(`${structureId}:${type}`) ?? [];
          const search = searches.get(`${structureId}:${type}`);
          const cell: StructureAlignCell = { status: cellStatus(existing, pending, !!search, STRUCTURE_ID_META[type].multi), existing, candidates: pending, searchedAt: search?.at ?? null };
          if (search?.error) cell.error = search.error;
          cells[type] = cell;
          if (isActionable(cell)) actionable = true;
          if (cell.status === 'strong') stats.strong++;
          else if (cell.status === 'ambiguous') stats.ambiguous++;
          else if (cell.status === 'arbitrate') stats.arbitrate++;
          else if (cell.status === 'conflict') stats.conflicts++;
        }
        stats.structures++;
        if (actionable) stats.actionable++;
        return { id: s.id, structureId, acronym: s.acronym, name: s.officialName, level: levelOf(s), parentAcronym: s.parentStructure || null, cluster: s.cluster || null, cells };
      });
      return { generatedAt: generatedAt || new Date(0).toISOString(), types: ALIGNED_STRUCTURE_ID_TYPES, rows, stats };
    },

    identifiers: async (structureId, ctx) => {
      // Any authenticated user (the host checked the session): identifiers are public data of the structure.
      void ctx;
      return identifiersOf(db, structureId);
    },

    feed: async (ctx) => {
      if (!ctx.scope.all) throw new ApiError(403, 'Forbidden');
      const [{ items: structures }, identifiers] = await Promise.all([repository.structures(), readStructureIdentifiers(db)]);
      return structures.map((s) => {
        const structureId = structureRowId(s);
        const out: StructureIdentifiersFeedRow = { id: s.id, structureId, localId: s.localId || '', acronym: s.acronym, name: s.officialName, level: levelOf(s), parentAcronym: s.parentStructure || null, identifiers: {} };
        for (const i of identifiers.get(structureId) ?? []) {
          if (i.status !== 'confirmed') continue;
          (out.identifiers[i.type] ??= []).push(i.value);
        }
        return out;
      });
    },

    accept: async (items, ctx) => {
      institutionOnly(ctx);
      if (!items.length) return { accepted: 0 };
      return writing(ctx, async (trx) => {
        let accepted = 0;
        const touched = new Set<number>();
        for (const item of items) {
          const type = typeOf(item.type);
          const cand = await trx.selectFrom('structure_alignment_candidate').select(['id', 'decision', 'strength'])
            .where('structure_id', '=', String(item.structureId)).where('type', '=', type).where('candidate_id', '=', String(item.candidateId)).executeTakeFirst();
          if (!cand) throw new ApiError(404, `Candidate not found: ${type} ${item.candidateId}`);
          if (cand.decision === 'accepted') continue;
          // A conflicting value accepted replaces the confirmed primary it contradicted (kept as a secondary value).
          if (!await confirmIdentifier(trx, item.structureId, type, item.candidateId, { source: 'alignment', decidedBy: ctx.actor ?? null, primary: cand.strength === 'conflict' ? true : undefined })) {
            throw new ApiError(400, `Invalid identifier: ${STRUCTURE_ID_META[type].label} ${item.candidateId}`);
          }
          await trx.updateTable('structure_alignment_candidate').set({ decision: 'accepted', decided_by: ctx.actor ?? null, decided_at: sql`now()` as any }).where('id', '=', cand.id).execute();
          touched.add(item.structureId);
          accepted++;
        }
        for (const id of touched) await projectIdentifiers(trx, id);
        if (accepted) ctx.audit({ table: 'Structures', kind: 'update', rows: [...touched], fields: ['identifiers'], count: accepted });
        return { accepted };
      });
    },

    reject: async (item, ctx) => {
      institutionOnly(ctx);
      const type = typeOf(item.type);
      return writing(ctx, async (trx) => {
        const cand = await trx.selectFrom('structure_alignment_candidate').select(['id'])
          .where('structure_id', '=', String(item.structureId)).where('type', '=', type).where('candidate_id', '=', String(item.candidateId)).executeTakeFirst();
        if (!cand) throw new ApiError(404, `Candidate not found: ${type} ${item.candidateId}`);
        await trx.updateTable('structure_alignment_candidate').set({ decision: 'rejected', note: item.note ?? null, decided_by: ctx.actor ?? null, decided_at: sql`now()` as any }).where('id', '=', cand.id).execute();
        await rejectIdentifier(trx, item.structureId, type, item.candidateId, { decidedBy: ctx.actor ?? null, note: item.note ?? null, source: 'alignment' });
        await projectIdentifiers(trx, item.structureId);
        ctx.audit({ table: 'Structures', kind: 'update', rows: [item.structureId], fields: ['identifiers'], count: 1 });
        return { rejected: 1 };
      });
    },

    add: async (structureId, rawType, rawValue, primary, ctx) => {
      const type = typeOf(rawType);
      const value = valueOf(type, rawValue);
      await structureInScope(db, structureId, ctx);
      return writing(ctx, async (trx) => {
        await confirmIdentifier(trx, structureId, type, value, { source: 'manual', decidedBy: ctx.actor ?? null, primary });
        await trx.updateTable('structure_alignment_candidate').set({ decision: 'accepted', decided_by: ctx.actor ?? null, decided_at: sql`now()` as any })
          .where('structure_id', '=', String(structureId)).where('type', '=', type).where('candidate_id', '=', value).where('decision', '=', 'pending').execute();
        await projectIdentifiers(trx, structureId);
        ctx.audit({ table: 'Structures', kind: 'update', rows: [structureId], fields: ['identifiers'], count: 1 });
        return identifiersOf(trx, structureId);
      });
    },

    remove: async (structureId, rawType, rawValue, note, ctx) => {
      const type = typeOf(rawType);
      const value = valueOf(type, rawValue);
      await structureInScope(db, structureId, ctx);
      return writing(ctx, async (trx) => {
        await rejectIdentifier(trx, structureId, type, value, { decidedBy: ctx.actor ?? null, note });
        await trx.updateTable('structure_alignment_candidate').set({ decision: 'rejected', note, decided_by: ctx.actor ?? null, decided_at: sql`now()` as any })
          .where('structure_id', '=', String(structureId)).where('type', '=', type).where('candidate_id', '=', value).where('decision', '<>', 'rejected').execute();
        await projectIdentifiers(trx, structureId);
        ctx.audit({ table: 'Structures', kind: 'update', rows: [structureId], fields: ['identifiers'], count: 1 });
        return identifiersOf(trx, structureId);
      });
    },

    setPrimary: async (structureId, rawType, rawValue, ctx) => {
      const type = typeOf(rawType);
      const value = valueOf(type, rawValue);
      await structureInScope(db, structureId, ctx);
      return writing(ctx, async (trx) => {
        if (!await setPrimaryIdentifier(trx, structureId, type, value)) throw new ApiError(404, `Identifier not found: ${type} ${value}`);
        await projectIdentifiers(trx, structureId);
        ctx.audit({ table: 'Structures', kind: 'update', rows: [structureId], fields: ['identifiers'], count: 1 });
        return identifiersOf(trx, structureId);
      });
    },
  };
};
