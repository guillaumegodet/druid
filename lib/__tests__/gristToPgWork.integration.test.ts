// Grist → PostgreSQL import of the work tables (druid-internal docs/plan-migration-postgresql.md, lot 5 b), loaded with
// the directory in one transaction as the owner (DATABASE_URL = druid_owner). Run by the « database » CI job and
// `npm run test:db`; skipped otherwise. Rolled back: nothing is left in the database.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../db/client';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';
import { WORK_TABLES_PG, loadDirectory, loadWork } from '../migration/loadPg';
import { gristDirectoryFixture } from './fixtures/gristDirectory';
import { gristWorkFixture } from './fixtures/gristWork';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
// A test may wait for the lock of another file (see pg_advisory_xact_lock below), and the import takes a few seconds.
vi.setConfig({ testTimeout: 30000 });
class Rollback extends Error {}

describe.skipIf(!url)('Grist → PostgreSQL load of the work tables', () => {
  it('loads the work tables after the directory, with their references and JSON values', async () => {
    const directory = transformDirectory(gristDirectoryFixture());
    const work = transformWork(gristWorkFixture(), directory.rows);
    const got: Record<string, unknown> = {};
    await expect(db!.transaction().execute(async (trx) => {
      // Integration test files may run in parallel: one database transaction at a time (the import empties tables).
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      await loadWork(trx, work.rows);
      got.counts = await loadWork(trx, work.rows); // replayable
      got.events = await trx.selectFrom('task_event as e').innerJoin('task as t', 't.id', 'e.task_id')
        .select(['e.legacy_grist_id', 't.legacy_grist_id as task']).orderBy('e.legacy_grist_id').execute();
      got.taskPeople = await trx.selectFrom('task as t').leftJoin('person as p', 'p.id', 't.person_id')
        .select(['t.legacy_grist_id', 'p.uid', 't.status', 't.extra']).orderBy('t.legacy_grist_id').execute();
      got.merge = await trx.selectFrom('merge_log').select(['legacy_grist_id', 'dropped_snapshot', 'kept_patch', 'merged_at', 'extra']).orderBy('legacy_grist_id').execute();
      got.reviews = await trx.selectFrom('alignment_candidate').select(['source', 'candidate_id', 'payload', 'pushed_on']).orderBy('legacy_grist_id').execute();
      got.importRows = await trx.selectFrom('import_row as r').innerJoin('import_batch as b', 'b.id', 'r.batch_id')
        .select(['b.legacy_table', 'r.field', 'r.imported_json']).orderBy('r.legacy_grist_id').execute();
      got.shares = await trx.selectFrom('report_share as s').innerJoin('report as r', 'r.id', 's.report_id').select(['r.legacy_grist_id', 's.grantee']).execute();
      got.generations = await trx.selectFrom('report_generation as g').innerJoin('report as r', 'r.id', 'g.report_id')
        .select(['r.legacy_grist_id', 'g.ai_texts', 'g.definition_snapshot']).execute();
      // Stable ids: a row from ONE Grist table keeps its Grist row id; the sequences continue after them.
      got.stable = (await sql<{ t: string; ok: boolean }>`
        SELECT 'membership' AS t, bool_and(id = legacy_grist_id) AS ok FROM membership UNION ALL
        SELECT 'structure', bool_and(id = legacy_grist_id) FROM structure UNION ALL
        SELECT 'task', bool_and(id = legacy_grist_id) FROM task UNION ALL
        SELECT 'report', bool_and(id = legacy_grist_id) FROM report UNION ALL
        SELECT 'merge_log', bool_and(id = legacy_grist_id) FROM merge_log`.execute(trx)).rows;
      got.next = (await trx.insertInto('task').values({ type: 'autre', title: 'new' } as any).returning('id').executeTakeFirstOrThrow()).id;
      got.disabled = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND t.tgenabled = 'D' AND c.relname = ANY(${[...WORK_TABLES_PG]})`.execute(trx)).rows[0].n;
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    expect(got.counts).toEqual({ task: 4, task_event: 2, merge_log: 2, alignment_candidate: 4, import_batch: 1, import_row: 2, report: 2,
      report_share: 1, report_generation: 1, benchmark_peer_group: 1 });
    expect(got.events).toEqual([{ legacy_grist_id: 10, task: 1 }, { legacy_grist_id: 11, task: 2 }]);
    expect((got.taskPeople as any[]).map((t) => [t.legacy_grist_id, t.uid, t.status])).toEqual([[1, 'dupont-a', 'a_faire'], [2, null, 'a_faire'], [3, null, 'a_faire'], [4, null, 'fait']]);
    expect((got.taskPeople as any[])[2].extra).toEqual({ cle: 'annuaire_ids_partages:dupont-a', chercheur: 999, statut: 'bizarre', priorite: 'urgente' });
    expect((got.merge as any[]).map((m) => [m.dropped_snapshot, m.kept_patch, m.merged_at === null, m.extra])).toEqual([
      [{ Nom: 'Dupont', LABO: 'LAB1' }, { Email: 'a@x' }, false, { Nom: 'Dupont' }], [{}, {}, true, { dropped_json: '{oops', date: 'not a date' }],
    ]);
    expect((got.reviews as any[]).map((r) => [r.source, r.payload, r.pushed_on])[0]).toEqual(['idref', { Nom_notice: 'Dupont, A.' }, '2026-09-11']);
    expect(got.importRows).toEqual([{ legacy_table: 'Arbitrage_Centrale_2026_09', field: 'Email', imported_json: 'b@x' },
      { legacy_table: 'Arbitrage_Centrale_2026_09', field: 'ORCID', imported_json: null }]);
    expect(got.shares).toEqual([{ legacy_grist_id: 60, grantee: 'bob' }]);
    expect(got.generations).toEqual([{ legacy_grist_id: 60, ai_texts: null, definition_snapshot: { schemaVersion: 1 } }]);
    expect(got.disabled).toBe('0');
    expect(got.stable).toEqual(['membership', 'structure', 'task', 'report', 'merge_log'].map((t) => ({ t, ok: true })));
    expect(got.next).toBe('5'); // after the imported tasks 1-4
  });
});
