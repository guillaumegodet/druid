// Grist → PostgreSQL import, loading part (druid-internal docs/plan-migration-postgresql.md, lot 5), against a migrated
// database as the owner (DATABASE_URL = druid_owner: the import empties the tables and suspends the triggers). Run by
// the « database » CI job and `npm run test:db`; skipped otherwise. Rolled back: nothing is left in the database.
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../db/client';
import { transformDirectory } from '../migration/gristToPg';
import { DIRECTORY_TABLES, loadDirectory } from '../migration/loadPg';
import { gristDirectoryFixture } from './fixtures/gristDirectory';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
class Rollback extends Error {}

describe.skipIf(!url)('Grist → PostgreSQL load', () => {
  it('loads every row with its references, twice in a row, then restores the triggers', async () => {
    const { rows, report } = transformDirectory(gristDirectoryFixture());
    const got: Record<string, unknown> = {};
    await expect(db!.transaction().execute(async (trx) => {
      // The audit log is not emptied by the import: only the rows written by this test are looked at.
      const since = Number((await sql<{ n: string | null }>`SELECT max(id)::text AS n FROM audit_log`.execute(trx)).rows[0].n || 0);
      await loadDirectory(trx, rows, report);
      got.counts = await loadDirectory(trx, rows, report); // replayable: the second run replaces the first
      got.parents = await trx.selectFrom('structure as s').innerJoin('structure as p', 'p.id', 's.parent_id')
        .select(['s.local_id', 'p.local_id as parent']).orderBy('s.local_id').execute();
      got.person = await trx.selectFrom('person as p').innerJoin('establishment as e', 'e.id', 'p.employer_id')
        .select(['p.uid', 'e.name', 'p.employment_start_lower', 'p.employment_end_upper']).where('p.uid', '=', 'dupont-a').executeTakeFirst();
      got.teams = await trx.selectFrom('membership_team as mt').innerJoin('membership as m', 'm.id', 'mt.membership_id')
        .innerJoin('structure as s', 's.id', 'mt.team_structure_id').select(['m.legacy_grist_id', 's.local_id']).orderBy('m.legacy_grist_id').execute();
      got.conflicts = (await trx.selectFrom('identifier_conflict').selectAll().execute()).map((c) => [c.scheme, c.value]);
      got.audit = await trx.selectFrom('audit_log').select(['table_name', 'actor']).where('id', '>', String(since)).orderBy('id').execute();
      got.disabled = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND t.tgenabled = 'D' AND c.relname = ANY(${[...DIRECTORY_TABLES]})`.execute(trx)).rows[0].n;
      await trx.updateTable('person').set({ email: 'x@example.org' }).where('uid', '=', 'dupont-a').execute();
      got.audited = (await trx.selectFrom('audit_log').select('action').where('table_name', '=', 'person').where('id', '>', String(since)).execute()).map((r) => r.action);
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    expect(got.counts).toEqual({ establishment: 3, ref_corps_grade: 1, structure: 5, person: 4, membership: 5, membership_team: 2,
      person_identifier: rows.person_identifier.length, person_identifier_check: 1, person_link: 2, sync_state: 1 });
    expect(got.parents).toEqual([{ local_id: 'U-LAB2-TEAMA', parent: 'U-LAB2' }, { local_id: 'U-TEAM1', parent: 'U-LAB1' }]);
    expect(got.person).toEqual({ uid: 'dupont-a', name: 'NANTES UNIVERSITE', employment_start_lower: '2015-01-01', employment_end_upper: '2030-06-30' });
    expect(got.teams).toEqual([{ legacy_grist_id: 101, local_id: 'U-TEAM1' }, { legacy_grist_id: 105, local_id: 'U-LAB2-TEAMA' }]);
    expect(got.conflicts).toEqual([['idref', '000000019']]);
    // One audit row per import, none per imported row; the triggers work again afterwards.
    expect(got.audit).toEqual([{ table_name: '*', actor: 'import:grist_to_pg' }, { table_name: '*', actor: 'import:grist_to_pg' }]);
    expect([got.disabled, got.audited]).toEqual(['0', ['update']]);
  });
});
