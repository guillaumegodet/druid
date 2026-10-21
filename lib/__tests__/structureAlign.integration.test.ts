// Identifiers of the structures on PostgreSQL (druid-internal docs/plan-druid-saas.md, lot 4 a and d): the migration
// seeds structure_identifier from the columns and V2 fields, a V2 write confirms its values, the decisions (accept,
// reject, add, remove, primary) are projected back to the fields the exports read, the overview states the cells,
// and a run of the engine on a fake registry persists its candidates. Needs DATABASE_URL (druid_owner: the import
// empties tables); run by the « database » CI job and `npm run test:db`. Rolled back: nothing is left in the database.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import { createDb } from '../db/client';
import type { CommandContext } from '../directory/commands';
import { createPgDirectoryCommands } from '../directory/pg/commands';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { transformDirectory } from '../migration/gristToPg';
import { loadDirectory } from '../migration/loadPg';
import { gristDirectoryFixture } from './fixtures/gristDirectory';
import { createPgStructureAlignCommands } from '../structures/pg/alignCommands';
import { confirmIdentifier, readStructureIdentifiers } from '../structures/pg/identifiers';
import { persist, runStructureAlignment } from '../structures/alignRun';
import type { Registry } from '../structures/registryClient';
import type { RegistryRecord } from '../structures/registries';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 60000 });
class Rollback extends Error {}
const ctx = (all = true, labAnchors: string[] = []): CommandContext => ({ scope: { all, labAnchors }, actor: 'test', audit: () => {} });

/** The fixture loaded (triggers off during the load), then the seed of the migration replayed on it. */
const seeded = async (trx: Transaction<DB>) => {
  const directory = transformDirectory(gristDirectoryFixture());
  await loadDirectory(trx, directory.rows, directory.report);
  await sql`TRUNCATE structure_identifier, structure_alignment_candidate, structure_alignment_search`.execute(trx);
  // Same statement as db/migrations/20261021140000_structure_identifiers.sql (the load truncated the seeded rows).
  await sql`INSERT INTO structure_identifier (structure_id, type, value, source)
    SELECT s.id, v.type, v.value, 'migration' FROM structure s
    CROSS JOIN LATERAL (VALUES ('rnsr', upper(trim(s.rnsr))), ('ror', lower(regexp_replace(trim(s.ror), '^.*/', ''))), ('idref', upper(trim(s.idref))),
      ('hal_collection', upper(regexp_replace(regexp_replace(trim(s.extra->>'hal_collection'), '/+$', ''), '^.*/', ''))), ('uai', upper(trim(s.extra->>'uai'))),
      ('isni', regexp_replace(trim(s.extra->>'isni'), '[^0-9X]', '', 'g')), ('wikidata', upper(trim(s.extra->>'wikidata'))), ('scopus_affil', trim(s.extra->>'scopus'))) AS v (type, value)
    WHERE v.value IS NOT NULL AND v.value <> '' AND v.value <> 'null' ON CONFLICT DO NOTHING`.execute(trx);
  const lab1 = await trx.selectFrom('structure').select('id').where('local_id', '=', 'U-LAB1').orderBy('id').executeTakeFirstOrThrow();
  const lab2 = await trx.selectFrom('structure').select('id').where('local_id', '=', 'U-LAB2').executeTakeFirstOrThrow();
  return { lab1: Number(lab1.id), lab2: Number(lab2.id) };
};
const inTransaction = (fn: (trx: Transaction<DB>) => Promise<void>) =>
  expect(db!.transaction().execute(async (trx) => { await fn(trx); throw new Rollback(); })).rejects.toBeInstanceOf(Rollback);

describe.skipIf(!url)('structure identifiers on PostgreSQL', () => {
  it('seed of the migration, confirmation on a V2 write, decisions and projection', () => inTransaction(async (trx) => {
    const { lab1, lab2 } = await seeded(trx);
    const repository = createPgDirectoryRepository({ db: trx as any });
    const commands = createPgDirectoryCommands({ db: trx as any, repository });
    const align = createPgStructureAlignCommands({ db: trx as any, repository });

    // Seed: LAB1 had an RNSR and a ROR in the fixture (idref blank).
    let ids = (await readStructureIdentifiers(trx, [lab1])).get(lab1) ?? [];
    expect(ids.map((i) => [i.type, i.value, i.source])).toEqual(expect.arrayContaining([['rnsr', '200012345A', 'migration'], ['ror', '01abcde23', 'migration']]));
    expect(ids).toHaveLength(2);

    // A V2 write of the record form (updateStructure) confirms the identifiers it carries, as manual values.
    const [s1] = (await repository.structures()).items.filter((s) => s.localId === 'U-LAB1' && s.acronym === 'LAB1');
    await commands.updateStructure(lab1, { ...s1, identifiers: { ...s1.identifiers, wikidata: 'Q9999991', uai: '0000000a' } } as any, ctx());
    ids = (await readStructureIdentifiers(trx, [lab1])).get(lab1) ?? [];
    expect(ids.find((i) => i.type === 'wikidata')).toMatchObject({ value: 'Q9999991', source: 'manual', isPrimary: true });
    expect(ids.find((i) => i.type === 'uai')).toMatchObject({ value: '0000000A' });

    // Add through the API (a lab manager of LAB1), then the projection to the V2 fields.
    let list = await align.add(lab1, 'hal_struct', 'https://aurehal.archives-ouvertes.fr/structure/read/id/473973', undefined, ctx(false, ['lab1']));
    list = await align.add(lab1, 'hal_struct', '1088564', undefined, ctx(false, ['lab1']));
    list = await align.add(lab1, 'hal_collection', 'https://hal.science/LAB1', undefined, ctx(false, ['lab1']));
    expect(list.filter((i) => i.type === 'hal_struct').map((i) => [i.value, i.isPrimary])).toEqual([['473973', true], ['1088564', false]]);
    let row = await trx.selectFrom('structure').select(['ror', 'rnsr', 'extra']).where('id', '=', String(lab1)).executeTakeFirstOrThrow();
    expect((row.extra as any).hal_struct_ids).toBe('473973|1088564');
    expect((row.extra as any).hal_collection).toBe('https://hal.science/LAB1');
    expect((row.extra as any).wikidata).toBe('Q9999991');
    // The structure read by the repository shows them.
    const s1b = (await repository.structures()).items.find((s) => s.id === `S-${lab1}`)!;
    expect(s1b.identifiers.halStructIds).toEqual(['473973', '1088564']);
    expect(s1b.halCollectionUrl).toBe('https://hal.science/LAB1');

    // Primary and removal: the removed value is kept as rejected (never proposed again), the next one becomes primary.
    list = await align.setPrimary(lab1, 'hal_struct', '1088564', ctx());
    expect(list.filter((i) => i.type === 'hal_struct' && i.isPrimary).map((i) => i.value)).toEqual(['1088564']);
    list = await align.remove(lab1, 'hal_struct', '1088564', 'merged record', ctx());
    expect(list.find((i) => i.type === 'hal_struct' && i.value === '1088564')).toMatchObject({ status: 'rejected', note: 'merged record' });
    expect(list.filter((i) => i.type === 'hal_struct' && i.status === 'confirmed').map((i) => [i.value, i.isPrimary])).toEqual([['473973', true]]);
    const row2 = await trx.selectFrom('structure').select(['extra']).where('id', '=', String(lab1)).executeTakeFirstOrThrow();
    expect((row2.extra as any).hal_struct_ids).toBe('473973');

    // Rights: another lab's manager may not touch LAB1; the institution right may; bad values are refused.
    await expect(align.add(lab1, 'ror', '01abcde23', undefined, ctx(false, ['lab2']))).rejects.toMatchObject({ status: 403 });
    await expect(align.add(lab1, 'ror', 'not-a-ror', undefined, ctx())).rejects.toMatchObject({ status: 400 });
    await expect(align.add(lab1, 'nope' as any, 'x', undefined, ctx())).rejects.toMatchObject({ status: 400 });
    await expect(align.overview(ctx(false, ['lab1']))).rejects.toMatchObject({ status: 403 });

    // Candidates persisted by a run, then the overview and the decisions on them.
    await persist(trx as any, {
      structureId: lab2,
      candidates: [
        { type: 'rnsr', candidateId: '200099999B', score: 0.9, strength: 'strong', evidence: { label: 'Laboratoire Deux', acronym: 'LAB2', city: null, kind: null, unitLabel: null, tutelles: [], worksCount: null, closed: false, url: 'u', paths: [], nameScore: 1, reasons: ['acronym'] } },
        { type: 'ror', candidateId: '02aaaaa11', score: 0.8, strength: 'strong', evidence: { label: 'Laboratoire Deux', acronym: 'LAB2', city: null, kind: null, unitLabel: null, tutelles: [], worksCount: null, closed: false, url: 'u', paths: ['rnsr:200099999B → ror'], nameScore: 1, reasons: ['bridge'] } },
        { type: 'ror', candidateId: '02bbbbb22', score: 0.78, strength: 'strong', evidence: { label: 'Laboratoire Deux bis', acronym: 'LAB2', city: null, kind: null, unitLabel: null, tutelles: [], worksCount: null, closed: false, url: 'u', paths: [], nameScore: 0.6, reasons: ['acronym'] } },
        { type: 'openalex', candidateId: 'I4210000002', score: 0.5, strength: 'medium', evidence: { label: 'Lab 2', acronym: null, city: null, kind: 'facility', unitLabel: null, tutelles: [], worksCount: 12, closed: false, url: 'u', paths: [], nameScore: 0.5, reasons: ['name'] } },
      ],
      verifications: [],
      searched: [{ type: 'rnsr', mode: 'search', candidates: 1 }, { type: 'ror', mode: 'search', candidates: 2 }, { type: 'openalex', mode: 'search', candidates: 1 }, { type: 'idref', mode: 'search', candidates: 0 }],
    }, 'search');
    let overview = await align.overview(ctx());
    const lab2Row = overview.rows.find((r) => r.structureId === lab2)!;
    expect(lab2Row.cells.rnsr?.status).toBe('strong');
    expect(lab2Row.cells.ror?.status).toBe('ambiguous');
    expect(lab2Row.cells.openalex?.status).toBe('arbitrate');
    expect(lab2Row.cells.idref?.status).toBe('absent');
    expect(lab2Row.cells.wikidata?.status).toBe('none');
    const lab1Row = overview.rows.find((r) => r.structureId === lab1)!;
    expect(lab1Row.cells.ror?.status).toBe('present');
    expect(lab1Row.cells.hal_struct?.existing.map((i) => i.value)).toEqual(['473973']);
    expect(overview.rows[0].level).not.toBe('team');
    expect(overview.stats.strong).toBeGreaterThanOrEqual(1);

    // Accept the strong RNSR and one ROR, refuse the other ROR: identifiers confirmed, projected, candidates decided.
    expect(await align.accept([{ structureId: lab2, type: 'rnsr', candidateId: '200099999B' }, { structureId: lab2, type: 'ror', candidateId: '02aaaaa11' }], ctx())).toEqual({ accepted: 2 });
    expect(await align.reject({ structureId: lab2, type: 'ror', candidateId: '02bbbbb22', note: 'other lab' }, ctx())).toEqual({ rejected: 1 });
    row = await trx.selectFrom('structure').select(['ror', 'rnsr', 'extra']).where('id', '=', String(lab2)).executeTakeFirstOrThrow();
    expect([row.rnsr, row.ror, (row.extra as any).nns, (row.extra as any).ror]).toEqual(['200099999B', '02aaaaa11', '200099999B', '02aaaaa11']);
    ids = (await readStructureIdentifiers(trx, [lab2])).get(lab2) ?? [];
    expect(ids.find((i) => i.type === 'ror' && i.value === '02aaaaa11')).toMatchObject({ status: 'confirmed', source: 'alignment', decidedBy: 'test' });
    expect(ids.find((i) => i.type === 'ror' && i.value === '02bbbbb22')).toMatchObject({ status: 'rejected' });
    overview = await align.overview(ctx());
    expect(overview.rows.find((r) => r.structureId === lab2)!.cells.ror?.status).toBe('present');
    await expect(align.accept([{ structureId: lab2, type: 'ror', candidateId: '02bbbbb22' }], ctx())).resolves.toEqual({ accepted: 1 });
    // Accepting a candidate twice is a no-op; an unknown one is a 404.
    expect(await align.accept([{ structureId: lab2, type: 'rnsr', candidateId: '200099999B' }], ctx())).toEqual({ accepted: 0 });
    await expect(align.accept([{ structureId: lab2, type: 'rnsr', candidateId: 'nope' }], ctx())).rejects.toMatchObject({ status: 404 });

    // The feed of the ETL.
    const feed = await align.feed(ctx());
    expect(feed.find((f) => f.structureId === lab1)?.identifiers).toMatchObject({ rnsr: ['200012345A'], ror: ['01abcde23'], hal_struct: ['473973'], hal_collection: ['LAB1'], wikidata: ['Q9999991'] });
    await expect(align.feed(ctx(false, ['lab1']))).rejects.toMatchObject({ status: 403 });

    // A conflict accepted replaces the primary: the old value stays as a secondary confirmed value.
    await confirmIdentifier(trx, lab2, 'idref', '000000001', { source: 'manual' });
    await persist(trx as any, { structureId: lab2, candidates: [{ type: 'idref', candidateId: '000000002', score: 0.7, strength: 'conflict', evidence: { label: 'Laboratoire Deux', acronym: null, city: null, kind: null, unitLabel: null, tutelles: [], worksCount: null, closed: false, url: 'u', paths: ['hal_struct:1 → idref'], nameScore: 1, reasons: ['bridge'], conflictWith: '000000001' } }], verifications: [{ type: 'idref', value: '000000001', ok: false, result: { exists: false } }], searched: [{ type: 'idref', mode: 'verify', candidates: 1 }] }, 'verify');
    overview = await align.overview(ctx());
    expect(overview.rows.find((r) => r.structureId === lab2)!.cells.idref?.status).toBe('conflict');
    expect(overview.rows.find((r) => r.structureId === lab2)!.cells.idref?.existing[0].checkResult).toMatchObject({ ok: false, exists: false });
    await align.accept([{ structureId: lab2, type: 'idref', candidateId: '000000002' }], ctx());
    ids = (await readStructureIdentifiers(trx, [lab2])).get(lab2) ?? [];
    expect(ids.filter((i) => i.type === 'idref' && i.status === 'confirmed').map((i) => [i.value, i.isPrimary])).toEqual(expect.arrayContaining([['000000002', true], ['000000001', false]]));
    const row3 = await trx.selectFrom('structure').select(['idref']).where('id', '=', String(lab2)).executeTakeFirstOrThrow();
    expect(row3.idref).toBe('000000002');
  }));

  it('a run of the engine on a fake registry persists candidates and bookkeeping, incrementally', () => inTransaction(async (trx) => {
    const { lab1, lab2 } = await seeded(trx);
    const rec = (p: Partial<RegistryRecord> & Pick<RegistryRecord, 'type' | 'id' | 'label'>): RegistryRecord => ({ acronym: null, altNames: [], city: null, countryCode: 'FR', kind: null, unitLabel: null, closed: false, worksCount: null, tutelles: [], parentIds: {}, links: {}, url: 'u', address: null, ...p });
    const hal = rec({ type: 'hal_struct', id: '473973', label: 'Laboratoire Un', acronym: 'LAB1', kind: 'laboratory', links: { rnsr: ['200012345A'], ror: ['01abcde23'] } });
    const rnsr1 = rec({ type: 'rnsr', id: '200012345A', label: 'Laboratoire Un', acronym: 'LAB1' });
    const ror1 = rec({ type: 'ror', id: '01abcde23', label: 'Laboratoire Un', acronym: 'LAB1' });
    const none = { get: async () => null, search: async () => [] };
    const registry: Registry = {
      rnsr: { get: async (id) => (id === '200012345A' ? rnsr1 : null), search: async () => [] },
      ror: { get: async (id) => (id === '01abcde23' ? ror1 : null), search: async () => [] },
      hal: { get: async (id) => (id === '473973' ? hal : null), search: async () => [], byLink: async (t, v) => (t === 'rnsr' && v === '200012345A' ? [hal] : []), collections: async () => ({ total: 100, codes: [{ code: 'LAB1', count: 99 }] }), collectionSize: async () => 0 },
      openalex: { ...none, byRor: async () => [] },
      idref: none,
      wikidata: { ...none, byLink: async () => [] },
    };
    const progress: number[] = [];
    const report = await runStructureAlignment(trx as any, registry, { mode: 'search', concurrency: 1, onProgress: (p) => progress.push(p.done) });
    // Every lab of the fixture (level 2 — the duplicated-local-id and no-id rows derive it too); teams and institutions are not aligned.
    expect(report.total).toBeGreaterThanOrEqual(2);
    expect(report.done).toBe(report.total);
    expect(progress.at(-1)).toBe(report.total);
    const cands = await trx.selectFrom('structure_alignment_candidate').selectAll().where('structure_id', '=', String(lab1)).execute();
    expect(cands.map((c) => [c.type, c.candidate_id, c.strength])).toEqual(expect.arrayContaining([['hal_struct', '473973', 'strong'], ['hal_collection', 'LAB1', 'strong']]));
    const searched = await trx.selectFrom('structure_alignment_search').selectAll().where('structure_id', '=', String(lab2)).execute();
    expect(searched.length).toBeGreaterThan(0);
    // Second run without --force: nothing left to do.
    const again = await runStructureAlignment(trx as any, registry, { mode: 'search', concurrency: 1 });
    expect(again.total).toBe(0);
    // Forced on one structure: the pending candidates are refreshed, a decided one is kept.
    await trx.updateTable('structure_alignment_candidate').set({ decision: 'rejected' }).where('structure_id', '=', String(lab1)).where('type', '=', 'hal_collection').execute();
    const forced = await runStructureAlignment(trx as any, registry, { mode: 'search', concurrency: 1, only: ['LAB1'] });
    expect(forced.total).toBe(1);
    const after = await trx.selectFrom('structure_alignment_candidate').selectAll().where('structure_id', '=', String(lab1)).execute();
    expect(after.find((c) => c.type === 'hal_collection')?.decision).toBe('rejected');
    expect(after.find((c) => c.type === 'hal_struct')?.decision).toBe('pending');
    // A registry down on a forced rerun: the pending candidates of its type survive, the error is recorded and the
    // pair is due again on the next incremental run.
    const halDown: Registry = { ...registry, hal: { ...registry.hal, byLink: async () => { throw new Error('HAL down'); }, collections: async () => { throw new Error('HAL down'); } } };
    await runStructureAlignment(trx as any, halDown, { mode: 'search', concurrency: 1, only: ['LAB1'] });
    const kept = await trx.selectFrom('structure_alignment_candidate').selectAll().where('structure_id', '=', String(lab1)).execute();
    expect(kept.find((c) => c.type === 'hal_struct')?.decision).toBe('pending');
    expect((await trx.selectFrom('structure_alignment_search').select('error').where('structure_id', '=', String(lab1)).where('type', '=', 'hal_struct').executeTakeFirstOrThrow()).error).toMatch(/HAL down/);
    expect((await runStructureAlignment(trx as any, registry, { mode: 'search', concurrency: 1 })).total).toBe(1);
    // verify stamps the confirmed identifiers.
    await runStructureAlignment(trx as any, registry, { mode: 'verify', concurrency: 1, only: ['LAB1'] });
    const ids = (await readStructureIdentifiers(trx, [lab1])).get(lab1) ?? [];
    expect(ids.find((i) => i.type === 'rnsr')?.checkResult).toMatchObject({ ok: true, exists: true });
    expect(ids.find((i) => i.type === 'rnsr')?.checkedAt).toBeTruthy();
  }));
});
