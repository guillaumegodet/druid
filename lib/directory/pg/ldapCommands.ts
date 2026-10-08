// LDAP review commands on PostgreSQL (Nantes, capability HAS_LDAP — druid-internal docs/plan-migration-postgresql.md,
// lot 6 d): the same diffs and writes as the Grist ones (lib/directory/ldapCommands.ts). The pure functions of
// lib/directory/ldap.ts run on the directory rows read as record fields, the employers and the structures' V2 fields;
// their patches are written back by writeRecordFields / the structure helpers, in one transaction (the Grist version
// wrote batch by batch and could stop half-way: here a failure writes nothing).
import type { Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import type { Db } from '../../db/client';
import { ApiError } from '../errors';
import type { CommandContext } from '../commands';
import { fuzzyDateEncoderFor } from '../annuaireWrite';
import type { DirectoryRepository } from '../repository';
import type { GristRecord } from '../gristMapping';
import type { LdapCommands, LdapSource } from '../ldapCommands';
import {
  LdapResolved, RecordPatch, computeLdapCandidatesDiffFrom, computeLdapDiffFrom, computeStructuresLdapDiffFrom, ldapCandidatePatches,
  ldapUpdatePatches, markDepartedPatches, structuresLdapWrites,
} from '../ldap';
import { RECORD_FIELDS } from './commands';
import { readRecords } from './recordFields';
import { insertStructure, patchStructure, readStructureRecords } from './structures';
import { pgWriting, writeRecordPatches } from './alignCommands';

export interface PgLdapCommandsOptions {
  db: Db;
  repository: DirectoryRepository;
  ldap: LdapSource;
  today?: () => string;
}

/** Employers as the LDAP diff reads them (name and UAI by id). */
const employerRecords = async (db: any): Promise<GristRecord[]> =>
  (await db.selectFrom('establishment').select(['id', 'name', 'uai', 'ror', 'label', 'idref', 'extra']).orderBy('id').execute())
    .map((e: any) => ({ id: Number(e.id), fields: { Employeur: e.name, UAI: e.uai ?? e.extra?.UAI ?? '', ROR: e.ror ?? '', Libelle: e.label ?? '', idref: e.idref ?? '' } }));

export const createPgLdapCommands = ({ db, repository, ldap, today }: PgLdapCommandsOptions): LdapCommands => {
  const todayIso = today ?? (() => new Date().toISOString().slice(0, 10));
  const encodeDate = fuzzyDateEncoderFor(RECORD_FIELDS);
  const institutionOnly = (ctx: CommandContext) => {
    if (!ctx.scope.all) throw new ApiError(403, 'Forbidden');
  };
  const writing = <T>(ctx: CommandContext, fn: (trx: Transaction<DB>) => Promise<T>) => pgWriting(db, ctx, fn, () => repository.invalidate());
  const audited = (ctx: CommandContext, table: string, patches: RecordPatch[]) => {
    if (patches.length) ctx.audit({ table, kind: 'update', rows: patches.map((p) => p.id), fields: [...new Set(patches.flatMap((p) => Object.keys(p.fields)))], count: patches.length });
    return patches.length;
  };

  const diff = async (conn: any = db) => {
    const [records, etablissements, status] = await Promise.all([readRecords(conn), employerRecords(conn), ldap.status()]);
    return computeLdapDiffFrom(records, etablissements, status.data);
  };
  const structuresDiff = async (conn: any = db) => computeStructuresLdapDiffFrom(await readStructureRecords(conn), await ldap.structures(), todayIso());

  return {
    diff: () => diff(),

    applyUpdates: async (ids, ctx) => {
      institutionOnly(ctx);
      return writing(ctx, async (trx) => {
        const selected = new Set(ids);
        const entries = (await diff(trx)).aMettreAJour.filter((r) => selected.has(r.id));
        if (entries.length === 0) return { updated: 0 };
        const byId: Record<number, any> = {};
        (await readRecords(trx)).forEach((r) => { byId[r.id] = r.fields; });
        const patches = ldapUpdatePatches(entries, byId, todayIso(), encodeDate);
        await writeRecordPatches(trx, patches);
        return { updated: audited(ctx, 'Annuaire', patches) };
      });
    },

    markDeparted: async (uid, date, accountLabel, ctx) => {
      institutionOnly(ctx);
      return writing(ctx, async (trx) => {
        const memberships = await trx.selectFrom('membership as m').innerJoin('person as p', 'p.id', 'm.person_id')
          .selectAll('m').where('p.uid', '=', uid).orderBy('m.id').execute();
        if (memberships.length === 0) return { updated: 0 };
        const rows = (await readRecords(trx, memberships)).map((r) => ({ rowId: r.id, fields: r.fields }));
        const patches = markDepartedPatches(rows, date, accountLabel, todayIso(), encodeDate);
        await writeRecordPatches(trx, patches);
        return { updated: audited(ctx, 'Annuaire', patches) };
      });
    },

    candidatesDiff: async () => computeLdapCandidatesDiffFrom(await ldap.candidates(), await readRecords(db)),

    applyCandidates: async (entries, ctx) => {
      institutionOnly(ctx);
      return writing(ctx, async (trx) => {
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
        const { patches, skippedDuplicates } = ldapCandidatePatches(resolved, await readRecords(trx), todayIso());
        await writeRecordPatches(trx, patches);
        return { updated: audited(ctx, 'Annuaire', patches), skippedDuplicates, unknown };
      });
    },

    structuresDiff: () => structuresDiff(),

    applyStructures: async (updateIds, createKeys, ctx) => {
      institutionOnly(ctx);
      return writing(ctx, async (trx) => {
        const { updates, creates } = structuresLdapWrites(await structuresDiff(trx), updateIds, createKeys, todayIso());
        for (const u of updates) {
          if (!(await patchStructure(trx, u.id, u.fields))) throw new ApiError(404, `Structure not found: S-${u.id}`);
        }
        audited(ctx, 'Structures', updates);
        const created: number[] = [];
        for (const c of creates) created.push(await insertStructure(trx, c.fields));
        if (created.length) ctx.audit({ table: 'Structures', kind: 'create', rows: created, fields: [...new Set(creates.flatMap((c) => Object.keys(c.fields)))], count: created.length });
        return { updated: updates.length, created: created.length };
      });
    },
  };
};
