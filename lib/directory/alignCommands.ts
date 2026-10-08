// Alignment commands of the domain API (druid-internal docs/plan-migration-postgresql.md, lot 2 e): unified diff,
// application of the selection, update of a replaced IdRef record, rejection of a candidate. Institution tools: every
// route requires the institution right.
//
// The diff is computed by the server from the caches of the alignment scripts, the Annuaire and the review tables;
// when applying, the browser sends its selection (checked candidates, arbitrations, decisions) and the server rebuilds
// the updates with the same function as the page (buildUnifiedUpdates) from its own diff — the browser used to send
// the cells to write. A rejection only writes the review table of the source: the candidate sent by the browser is
// recorded there as it comes (blacklist key = uid + candidate id).
import { ApiError } from './errors';
import type { CommandContext } from './commands';
import type { AnnuaireColumnMeta } from './annuaireWrite';
import type { AlignTexts } from './alignTexts';
import type { DirectoryRepository, GristClient } from './repository';
import {
  ALIGN_SOURCE_META, AlignCandidate, AlignMode, AlignSource, IDREF_REVIEW_TABLE, IdrefCandidate, PersonAlignUpdate,
  ReviewDecision, UNIFIED_ALIGN_SOURCES, UnifiedAlignDiff, UnifiedAlignSource, UnifiedArbitrateDecision, alignRejectWrites,
  buildIdrefReviewColumns, buildUnifiedUpdates, computeUnifiedAlignDiffFrom, idrefRejectWrites, unifiedUpdatePatches,
} from './alignments';
import type { GristRecord } from './gristMapping';

/** Caches of the alignment scripts (`idref_align_cache`, `orcid_align_cache`…, `idref_align_qualinka_cache`). */
export interface AlignCacheSource {
  read(name: string): Promise<Record<string, any> | null>;
}

export interface AlignSelection {
  mode: AlignMode;
  selected: string[];
  chosen: Record<string, string>;
  decisions: Record<string, UnifiedArbitrateDecision>;
}

export interface AlignRejection {
  source: UnifiedAlignSource;
  row: { id: string; uid: string; displayName: string; labo?: string };
  candidate: AlignCandidate | IdrefCandidate;
  candidateCount?: number;
  decision: ReviewDecision;
  note: string;
}

export interface AlignCommands {
  unifiedDiff(sources: UnifiedAlignSource[], mode: AlignMode, ctx: CommandContext): Promise<UnifiedAlignDiff>;
  applySelection(selection: AlignSelection, ctx: CommandContext): Promise<{ updated: number }>;
  /** « Mettre à jour » of a replaced IdRef record (verify mode): writes the new PPN found by the run. */
  applyRedirection(rowId: string, ppn: string, ctx: CommandContext): Promise<{ updated: number }>;
  reject(rejection: AlignRejection, ctx: CommandContext): Promise<{ rejected: number; tableCreated: boolean }>;
}

export interface GristAlignCommandsOptions {
  grist: GristClient;
  repository: DirectoryRepository;
  caches: AlignCacheSource;
  /** Server-side texts of the diffs (tokens localized by the browser, lib/directory/alignTexts.ts). */
  texts: AlignTexts;
  /** Qualinka engine for the IdRef search (capability HAS_QUALINKA). */
  hasQualinka: boolean;
  annuaireColumns: () => Promise<AnnuaireColumnMeta[]>;
  today?: () => string;
}

const reviewTableOf = (src: UnifiedAlignSource) => (src === 'idref' ? IDREF_REVIEW_TABLE : ALIGN_SOURCE_META[src].table);

export const createGristAlignCommands = ({ grist, repository, caches, texts, hasQualinka, annuaireColumns, today }: GristAlignCommandsOptions): AlignCommands => {
  const todayIso = today ?? (() => new Date().toISOString().slice(0, 10));
  const institutionOnly = (ctx: CommandContext) => {
    if (!ctx.scope.all) throw new ApiError(403, 'Forbidden');
  };

  /** The diff, and the Annuaire rows it was computed from (reused by the writes that follow). */
  const unifiedDiff = async (sources: UnifiedAlignSource[], mode: AlignMode): Promise<{ diff: UnifiedAlignDiff; records: GristRecord[] }> => {
    const tableIds = await grist.tableIds();
    // A review table that does not exist yet (first run of the script) = no blacklist, as before.
    const review = async (src: UnifiedAlignSource): Promise<GristRecord[] | null> =>
      (tableIds.includes(reviewTableOf(src)) ? grist.records(reviewTableOf(src)).catch(() => null) : null);
    const needsQualinka = sources.includes('idref') && mode === 'search' && hasQualinka;
    const [records, cacheEntries, reviewEntries, qualinka] = await Promise.all([
      grist.records('Annuaire'),
      Promise.all(sources.map(async (src) => [src, await caches.read(`${src}_align_cache`)] as const)),
      Promise.all(sources.map(async (src) => [src, await review(src)] as const)),
      needsQualinka ? caches.read('idref_align_qualinka_cache') : Promise.resolve(null),
    ]);
    const diff = computeUnifiedAlignDiffFrom(sources, mode, {
      records,
      caches: { ...Object.fromEntries(cacheEntries), idrefQualinka: qualinka },
      reviewRecords: Object.fromEntries(reviewEntries),
      hasQualinka,
    }, texts);
    return { diff, records };
  };

  /** PATCH grouped by column signature, in batches of 100; a stopped batch answers with the rows already written. */
  const applyUpdates = async (updates: PersonAlignUpdate[], records: GristRecord[], ctx: CommandContext): Promise<{ updated: number }> => {
    if (!updates.some((u) => u.fields && Object.keys(u.fields).length > 0)) return { updated: 0 };
    const cols = await annuaireColumns();
    // Current values (OpenAlex_ids merge, Data_source, Commentaires): the rows the diff was just computed from.
    const byId: Record<number, any> = {};
    records.forEach((r) => { byId[r.id] = r.fields; });
    const patches = unifiedUpdatePatches(updates, byId, cols, todayIso());
    const groups = new Map<string, { id: number; fields: Record<string, any> }[]>();
    for (const rec of patches) {
      const sig = Object.keys(rec.fields).sort().join(',');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(rec);
    }
    let updated = 0;
    try {
      for (const group of groups.values()) {
        for (let i = 0; i < group.length; i += 100) {
          const chunk = group.slice(i, i + 100);
          await grist.updateRecords('Annuaire', chunk);
          ctx.audit({ table: 'Annuaire', kind: 'update', rows: chunk.map((r) => r.id), fields: [...new Set(chunk.flatMap((r) => Object.keys(r.fields)))], count: chunk.length });
          updated += chunk.length;
        }
      }
    } catch (err) {
      console.error('[api/v1] alignment write:', (err as Error).message);
      throw new ApiError(502, `Grist error (partial write): ${updated} records written`, { updated });
    } finally {
      repository.invalidate();
    }
    return { updated };
  };

  return {
    unifiedDiff: async (sources, mode, ctx) => {
      institutionOnly(ctx);
      return (await unifiedDiff(sources, mode)).diff;
    },

    applySelection: async ({ mode, selected, chosen, decisions }, ctx) => {
      institutionOnly(ctx);
      const { diff, records } = await unifiedDiff(UNIFIED_ALIGN_SOURCES, mode);
      return applyUpdates(buildUnifiedUpdates(diff, new Set(selected), chosen, decisions), records, ctx);
    },

    applyRedirection: async (rowId, ppn, ctx) => {
      institutionOnly(ctx);
      const { diff, records } = await unifiedDiff(['idref'], 'verify');
      const row = diff.rows.find((r) => r.id === rowId);
      const r = row?.sources.idref?.redirection;
      if (!row || !r || r.ppn !== ppn) throw new ApiError(404, `Replaced IdRef record not found: ${ppn}`);
      // Same cells as the page: the new PPN, and the name-mismatch validation carried over when it concerned the
      // old PPN and the name still matches.
      const fields: Record<string, string> = { IdRef: r.newPpn };
      if (r.confirmedOld && !r.nameMismatch) fields.IdRef_nom_valide = r.newPpn;
      return applyUpdates([{ id: row.id, uid: row.uid, displayName: row.displayName, fields, fieldsBySource: { idref: fields }, sources: ['idref'] }], records, ctx);
    },

    reject: async ({ source, row, candidate, candidateCount = 1, decision, note }, ctx) => {
      institutionOnly(ctx);
      const table = reviewTableOf(source);
      const today = todayIso();
      let tableCreated = false;
      if (!(await grist.tableIds()).includes(table)) {
        // The IdRef review table is created on the fly; the other ones by the first run of their script.
        if (source !== 'idref') throw new ApiError(409, `Review table missing, run the alignment script first: ${table}`);
        await grist.addTables([{ id: table, columns: buildIdrefReviewColumns() }]);
        ctx.audit({ table, kind: 'table', count: 1 });
        tableCreated = true;
      }
      const revRecs = await grist.records(table);
      const { toCreate, toPatch } = source === 'idref'
        ? idrefRejectWrites([{ uid: row.uid, displayName: row.displayName, labo: row.labo, candidateCount, candidate: candidate as IdrefCandidate }], decision, note, revRecs, today)
        : alignRejectWrites(source as AlignSource, [{ id: row.id, uid: row.uid, displayName: row.displayName, labo: row.labo, candidateCount, candidate: candidate as AlignCandidate }], decision, note, revRecs, today);
      if (toCreate.length) {
        const ids = await grist.addRecords(table, toCreate.map((fields) => ({ fields })));
        ctx.audit({ table, kind: 'create', rows: ids, fields: [...new Set(toCreate.flatMap((f) => Object.keys(f)))], count: ids.length });
      }
      if (toPatch.length) {
        await grist.updateRecords(table, toPatch);
        ctx.audit({ table, kind: 'update', rows: toPatch.map((r) => r.id), fields: [...new Set(toPatch.flatMap((r) => Object.keys(r.fields)))], count: toPatch.length });
      }
      return { rejected: toCreate.length + toPatch.length, tableCreated };
    },
  };
};
