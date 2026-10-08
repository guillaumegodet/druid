// Schema v1 of the PostgreSQL database (druid-internal docs/plan-migration-postgresql.md, lot 4), against a migrated
// database: reduced-precision dates, triggers, audit log, rights of the application role, conflict view. Needs
// DATABASE_URL_APP (role druid_app, db/roles.sql): run by the « database » CI job and `npm run test:db`; skipped
// otherwise. Each case runs in a transaction rolled back at the end: nothing is left in the database.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 2 }) : null;
afterAll(async () => { await db?.destroy(); });
// A test may wait for the lock of another file (see pg_advisory_xact_lock below), and the import takes a few seconds.
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
/** Runs `fn` as `actor` and rolls everything back (rows and audit entries). */
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>, actor = 'test:db') => {
  await expect(withActor(db!, actor, async (trx) => {
    // Integration test files may run in parallel: one database transaction at a time (the import empties tables).
    await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};
/** Expects the statement to fail with a PostgreSQL error matching `pattern`, inside a savepoint. */
const fails = async (trx: Transaction<DB>, pattern: RegExp, fn: () => Promise<unknown>) => {
  await sql`SAVEPOINT expect_failure`.execute(trx);
  await expect(fn()).rejects.toThrow(pattern);
  await sql`ROLLBACK TO SAVEPOINT expect_failure`.execute(trx);
};
const person = (trx: Transaction<DB>, values: Record<string, unknown> = {}) =>
  trx.insertInto('person').values({ last_name: 'Lovelace', first_name: 'Ada', ...values } as any).returningAll().executeTakeFirstOrThrow();

describe.skipIf(!url)('PostgreSQL schema v1', () => {
  it('reduced-precision dates: valid forms, bounds of the period, invalid days refused', async () => {
    await inRollback(async (trx) => {
      const p = await person(trx, { employment_start: '2026', employment_end: '2028-02', birth_date: '1815-12-10' });
      expect([p.employment_start_lower, p.employment_end_upper, p.birth_date]).toEqual(['2026-01-01', '2028-02-29', '1815-12-10']);
      const m = await trx.insertInto('membership').values({ person_id: p.id, lab_label: 'zzz', start_date: '2024-09-01', end_date: '2025' })
        .returning(['start_lower', 'end_upper']).executeTakeFirstOrThrow();
      expect(m).toEqual({ start_lower: '2024-09-01', end_upper: '2025-12-31' });
      for (const bad of ['2026-02-30', '2026-13', '26', '2026-1', '2026/01']) {
        await fails(trx, /fuzzy_date_check|violates check constraint/, () => person(trx, { employment_end: bad }));
      }
    });
  });

  it('checks: uid unique regardless of case, civility F/M, presence status', async () => {
    await inRollback(async (trx) => {
      await fails(trx, /check constraint/, () => person(trx, { civility: 'Mme' }));
      await fails(trx, /check constraint/, () => person(trx, { presence_status: 'INTERNE' }));
      await person(trx, { uid: 'Lovelace-A', civility: 'F', presence_status: 'PRESENT' });
      await fails(trx, /duplicate key/, () => person(trx, { uid: 'lovelace-a' }));
    });
  });

  it('updated_at follows every update', async () => {
    await inRollback(async (trx) => {
      const p = await person(trx, { updated_at: '2000-01-01T00:00:00Z' });
      const after = await trx.updateTable('person').set({ email: 'ada@example.org' }).where('id', '=', p.id).returning('updated_at').executeTakeFirstOrThrow();
      expect(new Date(after.updated_at as any).getFullYear()).toBeGreaterThan(2000);
    });
  });

  it('audit log: before/after images and actor of the transaction, append-only for the application', async () => {
    await inRollback(async (trx) => {
      const p = await person(trx, { uid: 'audit-test' });
      await trx.updateTable('person').set({ email: 'ada@example.org' }).where('id', '=', p.id).execute();
      await trx.deleteFrom('person').where('id', '=', p.id).execute();
      const log = await trx.selectFrom('audit_log').select(['action', 'actor', 'before', 'after'])
        .where('table_name', '=', 'person').where('row_id', '=', p.id).orderBy('id').execute();
      expect(log.map((l) => [l.action, l.actor])).toEqual([['insert', 'alice'], ['update', 'alice'], ['delete', 'alice']]);
      expect([(log[1].before as any).email, (log[1].after as any).email, log[2].after]).toEqual([null, 'ada@example.org', null]);
      await fails(trx, /permission denied/, () => trx.insertInto('audit_log').values({ table_name: 'x', action: 'insert' }).execute());
      await fails(trx, /permission denied/, () => trx.deleteFrom('audit_log').execute());
    }, 'alice');
  });

  it('the application role reads and writes rows, never the schema', async () => {
    await inRollback(async (trx) => {
      await fails(trx, /permission denied|must be owner/, () => sql`CREATE TABLE intruder (id int)`.execute(trx));
      await fails(trx, /must be owner/, () => sql`ALTER TABLE person DISABLE TRIGGER person_audit`.execute(trx));
      await fails(trx, /must be owner/, () => sql`DROP TABLE task_event`.execute(trx));
      await fails(trx, /permission denied/, () => sql`DELETE FROM schema_migrations`.execute(trx));
    });
  });

  it('identifier_conflict lists the values carried by several people', async () => {
    await inRollback(async (trx) => {
      const [a, b] = [await person(trx), await person(trx, { first_name: 'Augusta' })];
      for (const p of [a, b]) {
        await trx.insertInto('person_identifier').values({ person_id: p.id, scheme: 'orcid', value: '0000-0002-0000-000X' }).execute();
      }
      await trx.insertInto('person_identifier').values({ person_id: a.id, scheme: 'idref', value: '000000019' }).execute();
      const conflicts = await trx.selectFrom('identifier_conflict').selectAll().where('value', 'in', ['0000-0002-0000-000X', '000000019']).execute();
      expect(conflicts.map((c) => [c.scheme, Number(c.people), [...(c.person_ids || [])].sort()])).toEqual([['orcid', 2, [a.id, b.id].sort()]]);
      await fails(trx, /duplicate key/, () => trx.insertInto('person_identifier').values({ person_id: a.id, scheme: 'idref', value: '000000019' }).execute());
    });
  });

  it('memberships, teams and structures hold together', async () => {
    await inRollback(async (trx) => {
      const lab = await trx.insertInto('structure').values({ local_id: 'TEST-LAB', acronym: 'TLAB' }).returning('id').executeTakeFirstOrThrow();
      const team = await trx.insertInto('structure').values({ local_id: 'TEST-TEAM', acronym: 'TT', parent_id: lab.id }).returning('id').executeTakeFirstOrThrow();
      const p = await person(trx);
      const m = await trx.insertInto('membership').values({ person_id: p.id, structure_id: lab.id, role: 'PRINCIPAL' }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('membership_team').values({ membership_id: m.id, team_structure_id: team.id }).execute();
      await fails(trx, /violates foreign key/, () => trx.deleteFrom('structure').where('id', '=', lab.id).execute());
      await trx.deleteFrom('person').where('id', '=', p.id).execute();
      expect(await trx.selectFrom('membership_team').selectAll().where('membership_id', '=', m.id).execute()).toEqual([]);
    });
  });
});
