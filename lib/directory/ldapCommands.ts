// LDAP review commands of the domain API (Nantes, capability HAS_LDAP — druid-internal
// docs/plan-migration-postgresql.md, lot 2 d). Institution tools: every route requires the institution right.
//
// The diffs are computed by the server from the caches written by the sync scripts (ldap_status_cache.json,
// ldap_candidates_cache.json, structures_ldap_cache.json) and the current Grist tables. When applying, the browser
// only sends the ids it checked: the cells are recomputed here (the browser used to send the whole diff, values
// included, and the proxy wrote them as they came). The writes are those of lib/directory/ldap.ts, batched as before.
import { ApiError } from './errors';
import type { CommandContext } from './commands';
import type { AnnuaireColumnMeta } from './annuaireWrite';
import { fuzzyDateEncoderFor } from './annuaireWrite';
import type { DirectoryRepository, GristClient, LdapCacheSnapshot } from './repository';
import {
  LdapCandidatesDiff, LdapDiff, LdapResolved, RecordPatch, StructuresLdapDiff, computeLdapCandidatesDiffFrom,
  computeLdapDiffFrom, computeStructuresLdapDiffFrom, ldapCandidatePatches, ldapUpdatePatches, markDepartedPatches,
  structuresLdapWrites,
} from './ldap';

/** Caches written by the LDAP sync scripts (app root of the Nantes server). */
export interface LdapSource {
  status(): Promise<LdapCacheSnapshot>;
  candidates(): Promise<any>;
  structures(): Promise<Record<string, any>>;
}

export interface LdapCommands {
  diff(): Promise<LdapDiff>;
  applyUpdates(ids: string[], ctx: CommandContext): Promise<{ updated: number }>;
  markDeparted(uid: string, date: string, accountLabel: string, ctx: CommandContext): Promise<{ updated: number }>;
  candidatesDiff(): Promise<LdapCandidatesDiff>;
  /** Entries checked in the browser: record and LDAP uid; the LDAP data comes from the candidates cache. */
  applyCandidates(entries: { gristRowId: number; uid: string }[], ctx: CommandContext): Promise<{
    updated: number; skippedDuplicates: { gristRowId: number; uid: string; existingRowId: number }[]; unknown: number;
  }>;
  structuresDiff(): Promise<StructuresLdapDiff>;
  applyStructures(updateIds: string[], createKeys: string[], ctx: CommandContext): Promise<{ updated: number; created: number }>;
}

export interface GristLdapCommandsOptions {
  grist: GristClient;
  repository: DirectoryRepository;
  ldap: LdapSource;
  annuaireColumns: () => Promise<AnnuaireColumnMeta[]>;
  today?: () => string;
}

export const createGristLdapCommands = ({ grist, repository, ldap, annuaireColumns, today }: GristLdapCommandsOptions): LdapCommands => {
  const todayIso = today ?? (() => new Date().toISOString().slice(0, 10));
  const institutionOnly = (ctx: CommandContext) => {
    if (!ctx.scope.all) throw new ApiError(403, 'Forbidden');
  };
  const annuaire = () => grist.records('Annuaire');

  /**
   * PATCH grouped by column signature (the Grist API requires the same columns in one PATCH), in batches of 100.
   * A failed batch leaves the previous ones written: the answer says how many (`updated`).
   */
  const patchInChunks = async (table: string, patches: RecordPatch[], ctx: CommandContext): Promise<number> => {
    const groups = new Map<string, RecordPatch[]>();
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
          await grist.updateRecords(table, chunk);
          ctx.audit({ table, kind: 'update', rows: chunk.map((r) => r.id), fields: [...new Set(chunk.flatMap((r) => Object.keys(r.fields)))], count: chunk.length });
          updated += chunk.length;
        }
      }
    } catch (err) {
      console.error('[api/v1] LDAP write:', (err as Error).message);
      throw new ApiError(502, `Grist error (partial write): ${updated} records written`, { updated });
    }
    return updated;
  };
  const writing = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } finally { repository.invalidate(); }
  };

  const diff = async (): Promise<LdapDiff> => {
    const [records, etablissements, status] = await Promise.all([
      annuaire(), grist.records('Etablissements').catch(() => []), ldap.status(),
    ]);
    return computeLdapDiffFrom(records, etablissements, status.data);
  };
  const structuresDiff = async (): Promise<StructuresLdapDiff> =>
    computeStructuresLdapDiffFrom(await grist.records('Structures'), await ldap.structures(), todayIso());

  return {
    diff,

    applyUpdates: (ids, ctx) => writing(async () => {
      institutionOnly(ctx);
      const selected = new Set(ids);
      const entries = (await diff()).aMettreAJour.filter((r) => selected.has(r.id));
      if (entries.length === 0) return { updated: 0 };
      const byId: Record<number, any> = {};
      (await annuaire()).forEach((r) => { byId[r.id] = r.fields; });
      const encodeDate = fuzzyDateEncoderFor(await annuaireColumns().catch(() => null));
      return { updated: await patchInChunks('Annuaire', ldapUpdatePatches(entries, byId, todayIso(), encodeDate), ctx) };
    }),

    markDeparted: (uid, date, accountLabel, ctx) => writing(async () => {
      institutionOnly(ctx);
      const rows = (await grist.records('Annuaire', { uid_dyna: [uid] })).map((r) => ({ rowId: r.id, fields: r.fields }));
      if (rows.length === 0) return { updated: 0 };
      const encodeDate = fuzzyDateEncoderFor(await annuaireColumns().catch(() => null));
      return { updated: await patchInChunks('Annuaire', markDepartedPatches(rows, date, accountLabel, todayIso(), encodeDate), ctx) };
    }),

    candidatesDiff: async () => computeLdapCandidatesDiffFrom(await ldap.candidates(), await annuaire()),

    applyCandidates: (entries, ctx) => writing(async () => {
      institutionOnly(ctx);
      if (entries.length === 0) return { updated: 0, skippedDuplicates: [], unknown: 0 };
      // The LDAP identity of each checked record is taken from the candidates cache, never from the request.
      const cache = await ldap.candidates();
      const resolved: LdapResolved[] = [];
      let unknown = 0;
      for (const e of entries) {
        const proposal = (cache?.proposals || []).find((p: any) => p.gristRowId === e.gristRowId && p.ldap?.uid === e.uid);
        const ambiguous = proposal ? undefined : (cache?.ambiguous || []).find((a: any) => a.gristRowId === e.gristRowId);
        const match = proposal?.ldap ?? ambiguous?.candidates?.find((c: any) => c.uid === e.uid);
        if (!match) { unknown++; continue; }
        resolved.push({ gristRowId: e.gristRowId, email: (proposal ?? ambiguous).email, ldap: match });
      }
      const { patches, skippedDuplicates } = ldapCandidatePatches(resolved, await annuaire(), todayIso());
      const updated = patches.length ? await patchInChunks('Annuaire', patches, ctx) : 0;
      return { updated, skippedDuplicates, unknown };
    }),

    structuresDiff,

    applyStructures: (updateIds, createKeys, ctx) => writing(async () => {
      institutionOnly(ctx);
      const { updates, creates } = structuresLdapWrites(await structuresDiff(), updateIds, createKeys, todayIso());
      const updated = updates.length ? await patchInChunks('Structures', updates, ctx) : 0;
      let created = 0;
      try {
        for (let i = 0; i < creates.length; i += 100) {
          const chunk = creates.slice(i, i + 100);
          const ids = await grist.addRecords('Structures', chunk);
          ctx.audit({ table: 'Structures', kind: 'create', rows: ids, fields: [...new Set(chunk.flatMap((r) => Object.keys(r.fields)))], count: chunk.length });
          created += chunk.length;
        }
      } catch (err) {
        console.error('[api/v1] LDAP structures:', (err as Error).message);
        throw new ApiError(502, `Grist error (partial write): ${updated + created} records written`, { updated, created });
      }
      return { updated, created };
    }),
  };
};
