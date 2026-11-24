// Per-field provenance on PostgreSQL (migration 20261121150000, lib/directory/pg/fieldValues.ts), against a migrated
// database. Needs DATABASE_URL_APP (role druid_app): run by `npm run test:db`; skipped otherwise. Each case runs in a
// transaction rolled back at the end.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';
import {
  correctFieldValue, dropFieldCorrection, keepFieldCorrection, listFieldConflicts, observeFieldValue,
} from '../directory/pg/fieldValues';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 2 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>, actor = 'test:db') => {
  await expect(withActor(db!, actor, async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};
const person = async (trx: Transaction<DB>) =>
  (await trx.insertInto('person').values({ last_name: 'Lovelace', first_name: 'Ada' } as any).returning('id').executeTakeFirstOrThrow()).id;
const column = async (trx: Transaction<DB>, id: string) =>
  trx.selectFrom('person').select(['birth_date', 'corps_grade']).where('id', '=', id).executeTakeFirstOrThrow();

describe.skipIf(!url)('person_field_value', () => {
  it('a manual correction is not overwritten by a later import; the column is the projection', async () => {
    await inRollback(async (trx) => {
      const id = await person(trx);
      await observeFieldValue(trx, { personId: id, field: 'birth_date', source: 'lab_file', value: '13/05/1980', now: '2026-01-01T00:00:00Z' });
      expect((await column(trx, id)).birth_date).toBe('1980-05-13');

      await correctFieldValue(trx, id, 'birth_date', '1980-05-12', 'marie.dupont', '2026-02-01T00:00:00Z');
      expect((await column(trx, id)).birth_date).toBe('1980-05-12');

      // The same file imported again by someone else.
      const again = await observeFieldValue(trx, { personId: id, field: 'birth_date', source: 'lab_file', value: '13/05/1980', now: '2026-03-01T00:00:00Z' });
      expect(again).toMatchObject({ changed: false, value: '1980-05-12', source: 'manual', conflicts: [] });
      expect((await column(trx, id)).birth_date).toBe('1980-05-12');

      // LDAP gives another value later: a conflict to review, the column does not move.
      await observeFieldValue(trx, { personId: id, field: 'birth_date', source: 'ldap', value: '19810512', now: '2026-04-01T00:00:00Z' });
      expect((await column(trx, id)).birth_date).toBe('1980-05-12');
      const conflicts = await listFieldConflicts(trx, 'birth_date');
      expect(conflicts.find((c) => c.personId === id)?.resolution.conflicts.map((c) => c.source)).toEqual(['ldap']);

      await keepFieldCorrection(trx, id, 'birth_date', 'marie.dupont');
      expect((await listFieldConflicts(trx, 'birth_date')).find((c) => c.personId === id)).toBeUndefined();

      // Back to the sources: LDAP is the most trusted one.
      await dropFieldCorrection(trx, id, 'birth_date');
      expect((await column(trx, id)).birth_date).toBe('1981-05-12');
    });
  });

  it('source ranks come from field_source_priority; every write is audited with its actor', async () => {
    await inRollback(async (trx) => {
      const id = await person(trx);
      await observeFieldValue(trx, { personId: id, field: 'corps_grade', source: 'lab_file', value: 'pr' });
      await observeFieldValue(trx, { personId: id, field: 'corps_grade', source: 'ldap', value: 'MCF' });
      await observeFieldValue(trx, { personId: id, field: 'corps_grade', source: 'lab_file', value: 'PRCE' });
      expect((await column(trx, id)).corps_grade).toBe('MCF');
      const audit = await trx.selectFrom('audit_log').select(['actor']).where('table_name', '=', 'person_field_value').execute();
      expect(audit.length).toBeGreaterThanOrEqual(3);
      expect(new Set(audit.map((a) => a.actor))).toEqual(new Set(['test:fields']));
    }, 'test:fields');
  });

  it('the seed takes the provenance of the last write from the audit log', async () => {
    await inRollback(async (trx) => {
      const as = (actor: string) => sql`SELECT set_config('druid.actor', ${actor}, true)`.execute(trx);
      const create = async (values: Record<string, unknown>) =>
        (await trx.insertInto('person').values({ last_name: 'Lovelace', first_name: 'Ada', ...values } as any).returning('id').executeTakeFirstOrThrow()).id;

      await as('seed.typist');
      const typed = await create({ birth_date: '1980' });
      await as('seed.importer');
      const imported = [await create({ corps_grade: 'MCF' }), await create({ corps_grade: 'PR' })];
      await as('seed.reviewer');
      const reviewed = await create({ note: '[2026-06-02] MAJ Site : Email' });
      await trx.updateTable('person').set({ birth_date: '1980-05-12', note: '[2026-06-02] MAJ Site : Email\n[2026-10-09] MAJ LDAP: Date naissance' } as any)
        .where('id', '=', reviewed).execute();
      await as('job:seed');
      const arbitrated = await create({});
      const byJob = await create({ corps_grade: 'IE' });
      await as('seed.arbiter');
      await trx.updateTable('person').set({ corps_grade: 'DR', note: '[2026-10-13] Arbitrage DRPI (seed.arbiter): Corps_grade' } as any)
        .where('id', '=', arbitrated).execute();

      expect(await sql<{ n: number }>`SELECT seed_person_field_value('seed test') AS n`.execute(trx).then((r) => r.rows[0].n)).toBeGreaterThanOrEqual(6);
      const rows = await trx.selectFrom('person_field_value').select(['person_id', 'field', 'source', 'value', 'asserted_by'])
        .where('note', '=', 'seed test').execute();
      const of = (id: string) => rows.filter((r) => r.person_id === id).map(({ field, source, value }) => ({ field, source, value }));
      expect(of(typed)).toEqual([{ field: 'birth_date', source: 'manual', value: '1980' }]);
      expect(imported.flatMap(of).map((r) => r.source)).toEqual(['legacy', 'legacy']);
      expect(of(reviewed)).toEqual([{ field: 'birth_date', source: 'ldap', value: '1980-05-12' }]);
      expect(of(arbitrated)).toEqual([{ field: 'corps_grade', source: 'hr_file', value: 'DR' }]);
      expect(of(byJob)).toEqual([{ field: 'corps_grade', source: 'legacy', value: 'IE' }]);

      // Run again: pairs that already have a row are left alone.
      expect(await sql<{ n: number }>`SELECT seed_person_field_value('seed test') AS n`.execute(trx).then((r) => r.rows[0].n)).toBe(0);
    });
  });

  it('two sources cannot share a rank for the same field', async () => {
    await inRollback(async (trx) => {
      await sql`SAVEPOINT s`.execute(trx);
      await expect(trx.insertInto('field_source_priority').values({ field: 'birth_date', source: 'other_file', rank: 10 } as any).execute())
        .rejects.toThrow(/unique|duplicate/);
      await sql`ROLLBACK TO SAVEPOINT s`.execute(trx);
    });
  });

  it('only the application writes rows: a manual row cannot hide acknowledged values on a source row', async () => {
    await inRollback(async (trx) => {
      const id = await person(trx);
      await sql`SAVEPOINT s`.execute(trx);
      await expect(trx.insertInto('person_field_value')
        .values({ person_id: id, field: 'birth_date', source: 'ldap', value: '1980', acknowledged: JSON.stringify({ x: '1' }) } as any)
        .execute()).rejects.toThrow(/check constraint/);
      await sql`ROLLBACK TO SAVEPOINT s`.execute(trx);
    });
  });
});
