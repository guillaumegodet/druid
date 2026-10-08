// Alignment commands on PostgreSQL (druid-internal docs/plan-migration-postgresql.md, lot 6 d): the same diffs and
// writes as the Grist ones (lib/directory/alignCommands.ts) — the pure functions of lib/directory/alignments.ts run on
// the directory rows read as record fields (lib/directory/pg/recordFields.ts) and on the reviews of
// alignment_candidate (lib/directory/pg/review.ts); their patches are written back by writeRecordFields, in one
// transaction. Institution tools: every route requires the institution right.
import { sql, Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import type { Db } from '../../db/client';
import { ApiError } from '../errors';
import type { CommandContext } from '../commands';
import type { DirectoryRepository } from '../repository';
import type { AlignCacheSource, AlignCommands } from '../alignCommands';
import type { AlignTexts } from '../alignTexts';
import type { GristRecord } from '../gristMapping';
import {
  AlignCandidate, AlignMode, AlignSource, IdrefCandidate, PersonAlignUpdate, UNIFIED_ALIGN_SOURCES, UnifiedAlignDiff, UnifiedAlignSource,
  alignRejectWrites, buildUnifiedUpdates, computeUnifiedAlignDiffFrom, idrefRejectWrites, unifiedUpdatePatches,
} from '../alignments';
import { RECORD_FIELDS } from './commands';
import { readRecords, writeRecordFields } from './recordFields';
import { readReviewRecords, writeReview } from './review';

export interface PgAlignCommandsOptions {
  db: Db;
  repository: DirectoryRepository;
  caches: AlignCacheSource;
  texts: AlignTexts;
  hasQualinka: boolean;
  today?: () => string;
}

/** Runs `fn` in a transaction (a savepoint when given one), audited under the author of the context. */
export const pgWriting = async <T>(db: Db, ctx: CommandContext, fn: (trx: Transaction<DB>) => Promise<T>, after: () => void): Promise<T> => {
  const run = async (trx: Transaction<DB>) => {
    await sql`SELECT set_config('druid.actor', ${ctx.actor ?? ''}, true)`.execute(trx);
    return fn(trx);
  };
  try {
    if (!db.isTransaction) return await db.transaction().execute(run);
    const trx = db as Transaction<DB>;
    const name = sql.raw(`druid_write_${Math.random().toString(36).slice(2, 10)}`);
    await sql`SAVEPOINT ${name}`.execute(trx);
    try {
      const out = await run(trx);
      await sql`RELEASE SAVEPOINT ${name}`.execute(trx);
      return out;
    } catch (err) {
      await sql`ROLLBACK TO SAVEPOINT ${name}`.execute(trx);
      throw err;
    }
  } finally {
    after();
  }
};

/** Writes record patches ({ id: record id, fields }) onto the people and memberships they name. */
export const writeRecordPatches = async (trx: Transaction<DB>, patches: { id: number; fields: Record<string, any> }[]): Promise<number> => {
  for (const p of patches) {
    const m = await trx.selectFrom('membership').select(['id', 'person_id']).where('id', '=', String(p.id)).executeTakeFirst();
    if (!m) throw new ApiError(404, `Record not found in Grist: uid ${p.id}`);
    await writeRecordFields(trx, m.person_id, m.id, p.fields);
  }
  return patches.length;
};

export const createPgAlignCommands = ({ db, repository, caches, texts, hasQualinka, today }: PgAlignCommandsOptions): AlignCommands => {
  const todayIso = today ?? (() => new Date().toISOString().slice(0, 10));
  const institutionOnly = (ctx: CommandContext) => {
    if (!ctx.scope.all) throw new ApiError(403, 'Forbidden');
  };

  /** The diff, and the directory rows it was computed from (reused by the writes that follow). */
  const unifiedDiff = async (conn: any, sources: UnifiedAlignSource[], mode: AlignMode): Promise<{ diff: UnifiedAlignDiff; records: GristRecord[] }> => {
    const needsQualinka = sources.includes('idref') && mode === 'search' && hasQualinka;
    const records = await readRecords(conn);
    const cacheEntries = await Promise.all(sources.map(async (src) => [src, await caches.read(`${src}_align_cache`)] as const));
    const reviewEntries = await Promise.all(sources.map(async (src) => [src, await readReviewRecords(conn, src)] as const));
    const qualinka = needsQualinka ? await caches.read('idref_align_qualinka_cache') : null;
    const diff = computeUnifiedAlignDiffFrom(sources, mode, {
      records,
      caches: { ...Object.fromEntries(cacheEntries), idrefQualinka: qualinka },
      reviewRecords: Object.fromEntries(reviewEntries),
      hasQualinka,
    }, texts);
    return { diff, records };
  };

  const applyUpdates = async (trx: Transaction<DB>, updates: PersonAlignUpdate[], records: GristRecord[], ctx: CommandContext): Promise<{ updated: number }> => {
    if (!updates.some((u) => u.fields && Object.keys(u.fields).length > 0)) return { updated: 0 };
    const byId: Record<number, any> = {};
    records.forEach((r) => { byId[r.id] = r.fields; });
    const patches = unifiedUpdatePatches(updates, byId, RECORD_FIELDS, todayIso());
    const updated = await writeRecordPatches(trx, patches);
    if (updated) ctx.audit({ table: 'Annuaire', kind: 'update', rows: patches.map((p) => p.id), fields: [...new Set(patches.flatMap((p) => Object.keys(p.fields)))], count: updated });
    return { updated };
  };
  const writing = <T>(ctx: CommandContext, fn: (trx: Transaction<DB>) => Promise<T>) => pgWriting(db, ctx, fn, () => repository.invalidate());

  return {
    unifiedDiff: async (sources, mode, ctx) => {
      institutionOnly(ctx);
      return (await unifiedDiff(db, sources, mode)).diff;
    },

    applySelection: async ({ mode, selected, chosen, decisions }, ctx) => {
      institutionOnly(ctx);
      return writing(ctx, async (trx) => {
        const { diff, records } = await unifiedDiff(trx, UNIFIED_ALIGN_SOURCES, mode);
        return applyUpdates(trx, buildUnifiedUpdates(diff, new Set(selected), chosen, decisions), records, ctx);
      });
    },

    applyRedirection: async (rowId, ppn, ctx) => {
      institutionOnly(ctx);
      return writing(ctx, async (trx) => {
        const { diff, records } = await unifiedDiff(trx, ['idref'], 'verify');
        const row = diff.rows.find((r) => r.id === rowId);
        const r = row?.sources.idref?.redirection;
        if (!row || !r || r.ppn !== ppn) throw new ApiError(404, `Replaced IdRef record not found: ${ppn}`);
        // Same cells as the page: the new PPN, and the name-mismatch validation carried over when it concerned the
        // old PPN and the name still matches.
        const fields: Record<string, string> = { IdRef: r.newPpn };
        if (r.confirmedOld && !r.nameMismatch) fields.IdRef_nom_valide = r.newPpn;
        return applyUpdates(trx, [{ id: row.id, uid: row.uid, displayName: row.displayName, fields, fieldsBySource: { idref: fields }, sources: ['idref'] }], records, ctx);
      });
    },

    reject: async ({ source, row, candidate, candidateCount = 1, decision, note }, ctx) => {
      institutionOnly(ctx);
      return writing(ctx, async (trx) => {
        const today = todayIso();
        const revRecs = await readReviewRecords(trx, source);
        const writes = source === 'idref'
          ? idrefRejectWrites([{ uid: row.uid, displayName: row.displayName, labo: row.labo, candidateCount, candidate: candidate as IdrefCandidate }], decision, note, revRecs, today)
          : alignRejectWrites(source as AlignSource, [{ id: row.id, uid: row.uid, displayName: row.displayName, labo: row.labo, candidateCount, candidate: candidate as AlignCandidate }], decision, note, revRecs, today);
        const { created, patched } = await writeReview(trx, source, writes);
        const table = `Alignement_${{ idref: 'IdRef', orcid: 'ORCID', hal: 'HAL', openalex: 'OpenAlex', scopus: 'Scopus' }[source]}`;
        if (created.length) ctx.audit({ table, kind: 'create', rows: created, count: created.length });
        if (patched.length) ctx.audit({ table, kind: 'update', rows: patched, count: patched.length });
        // The review table always exists on PostgreSQL (alignment_candidate): never created on the fly.
        return { rejected: created.length + patched.length, tableCreated: false };
      });
    },
  };
};
