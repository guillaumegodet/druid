// Record side of the fields merged by source (druid-internal `docs/plan-maj-chercheurs.md`, end of lot 2): the
// « sources » panel, « back to the sources », and D7 — a record saved with a value read before a concurrent change
// never reverts it, and a correction typed over a concurrent change is refused. Needs DATABASE_URL_APP (role
// druid_app): run by `npm run test:db`; skipped otherwise. Each case runs in a transaction rolled back at the end.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, type Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';
import type { CommandContext } from '../directory/commands';
import { createPgDirectoryCommands } from '../directory/pg/commands';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { correctFieldValue, observeFieldValue } from '../directory/pg/fieldValues';
import { createFieldConflictsStore } from '../directory/pg/fieldConflicts';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 2 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(withActor(db!, 'test.user', async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};
const ALL = { all: true, labAnchors: [] };
const ctx: CommandContext = { scope: ALL, actor: 'test.user', audit: () => {} };

describe.skipIf(!url)('record and fields merged by source', () => {
  it('sources panel, concurrent change kept or refused (D7), back to the sources', async () => {
    await inRollback(async (trx) => {
      const id = (await trx.insertInto('person').values({ last_name: 'Lamarr', first_name: 'Hedy', uid: 'test-lamarr-h' } as any)
        .returning('id').executeTakeFirstOrThrow()).id;
      const recordId = Number((await trx.insertInto('membership').values({ person_id: id, lab_label: 'LABX' } as any)
        .returning('id').executeTakeFirstOrThrow()).id);
      await observeFieldValue(trx, { personId: id, field: 'birth_date', source: 'ldap', value: '19141109' });
      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-25' });
      const read = async () => (await repository.people(ALL)).items.find((p) => p.uid === 'test-lamarr-h')!;
      const column = async () => (await trx.selectFrom('person').select('birth_date').where('id', '=', id).executeTakeFirstOrThrow()).birth_date;
      const manualRows = async () => (await trx.selectFrom('person_field_value').select('source').where('person_id', '=', id)
        .where('source', '=', 'manual').execute()).length;

      // The record says where the value comes from, and the panel lists the sources.
      const loaded = await read();
      expect(loaded.fieldProvenance?.birthDate).toMatchObject({ source: 'ldap', value: '1914-11-09' });
      const panel = await commands.fieldSources!(recordId, ctx);
      expect(panel.birth_date).toMatchObject({ value: '1914-11-09', source: 'ldap', sources: [{ source: 'ldap', value: '1914-11-09', kind: '' }] });

      // The LDAP changes while the record is open; saving it untouched keeps the new value (no « correction »).
      await observeFieldValue(trx, { personId: id, field: 'birth_date', source: 'ldap', value: '19141110' });
      repository.invalidate();
      await commands.updatePerson(recordId, loaded, ctx);
      expect(await column()).toBe('1914-11-10');
      expect(await manualRows()).toBe(0);

      // Typed over the concurrent change: refused.
      await expect(commands.updatePerson(recordId, { ...loaded, birthDate: '1914-12-01' }, ctx)).rejects.toMatchObject({ status: 409 });
      expect(await column()).toBe('1914-11-10');

      // Read again, then corrected: a manual correction, shown as such.
      const fresh = await read();
      await commands.updatePerson(recordId, { ...fresh, birthDate: '1914-11-09' }, ctx);
      expect(await column()).toBe('1914-11-09');
      repository.invalidate();
      expect((await read()).fieldProvenance?.birthDate).toMatchObject({ source: 'manual', correctedBy: 'test.user' });
      expect((await commands.fieldSources!(recordId, ctx)).birth_date.sources.map((s) => [s.source, s.kind]))
        .toEqual([['manual', ''], ['ldap', 'acknowledged']]);

      // Back to the sources: the LDAP value again.
      const back = await commands.dropFieldCorrection!(recordId, 'birth_date', ctx);
      expect(back).toMatchObject({ value: '1914-11-10', provenance: { source: 'ldap', value: '1914-11-10' } });
      expect(await column()).toBe('1914-11-10');
      await expect(commands.dropFieldCorrection!(recordId, 'email', ctx)).rejects.toMatchObject({ status: 400 });
    });
  });

  it('civility and employment type: LDAP values, a correction typed in the record, the provenance shown', async () => {
    await inRollback(async (trx) => {
      const id = (await trx.insertInto('person').values({ last_name: 'Meitner', first_name: 'Lise', uid: 'test-meitner-l' } as any)
        .returning('id').executeTakeFirstOrThrow()).id;
      const recordId = Number((await trx.insertInto('membership').values({ person_id: id, lab_label: 'LABX' } as any)
        .returning('id').executeTakeFirstOrThrow()).id);
      await observeFieldValue(trx, { personId: id, field: 'civility', source: 'ldap', value: 'Madame' });
      await observeFieldValue(trx, { personId: id, field: 'employment_type', source: 'ldap', value: 'CDD UNIVERSITE' });
      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-26' });
      const loaded = (await repository.people(ALL)).items.find((p) => p.uid === 'test-meitner-l')!;
      expect([loaded.civility, loaded.employment.contractType, loaded.employment.ldapFields]).toEqual(['F', 'CDD UNIVERSITE', []]);
      expect(loaded.fieldProvenance).toMatchObject({ civility: { source: 'ldap' }, contractType: { source: 'ldap' } });
      // Saved untouched: no correction. Type corrected: a manual correction that wins over the LDAP.
      await commands.updatePerson(recordId, loaded, ctx);
      expect(await trx.selectFrom('person_field_value').select('source').where('person_id', '=', id).where('source', '=', 'manual').execute()).toEqual([]);
      await commands.updatePerson(recordId, { ...loaded, employment: { ...loaded.employment, contractType: 'TITULAIRE' } }, ctx);
      repository.invalidate();
      const after = (await repository.people(ALL)).items.find((p) => p.uid === 'test-meitner-l')!;
      expect([after.employment.contractType, after.fieldProvenance?.contractType?.source, after.fieldProvenance?.civility?.source])
        .toEqual(['TITULAIRE', 'manual', 'ldap']);
    });
  });

  it('merging duplicates moves the values by source of the absorbed person; two corrections that differ are a conflict', async () => {
    await inRollback(async (trx) => {
      const person = async (uid: string, last: string) => {
        const id = (await trx.insertInto('person').values({ last_name: last, first_name: 'Test', uid } as any).returning('id').executeTakeFirstOrThrow()).id;
        const row = Number((await trx.insertInto('membership').values({ person_id: id, lab_label: 'LABX' } as any).returning('id').executeTakeFirstOrThrow()).id);
        return { id, row };
      };
      const kept = await person('test-kept-k', 'Keep');
      const dropped = await person('test-dropped-d', 'Drop');
      await observeFieldValue(trx, { personId: kept.id, field: 'birth_date', source: 'ldap', value: '19800512' });
      await correctFieldValue(trx, kept.id, 'corps_grade', 'PR', 'alice');
      await correctFieldValue(trx, dropped.id, 'birth_date', '1981-02-03', 'bob');
      await observeFieldValue(trx, { personId: dropped.id, field: 'corps_grade', source: 'lab_file', value: 'MCF' });
      await correctFieldValue(trx, dropped.id, 'corps_grade', 'DR', 'bob');

      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-25' });
      await commands.mergeRows({ keepRowId: kept.row, dropRowId: dropped.row, fields: {}, author: 'test.user' }, ctx);

      expect(await trx.selectFrom('person').select('id').where('id', '=', dropped.id).executeTakeFirst()).toBeUndefined();
      const rows = await trx.selectFrom('person_field_value').select(['field', 'source', 'value']).where('person_id', '=', kept.id)
        .orderBy('field').orderBy('source').execute();
      expect(rows).toEqual([
        { field: 'birth_date', source: 'ldap', value: '1980-05-12' },
        { field: 'birth_date', source: 'merged_record', value: '1981-02-03' },
        { field: 'corps_grade', source: 'lab_file', value: 'MCF' },
        { field: 'corps_grade', source: 'manual', value: 'PR' },
        { field: 'corps_grade', source: 'merged_record', value: 'DR' },
      ]);
      const shown = await trx.selectFrom('person').select(['birth_date', 'corps_grade']).where('id', '=', kept.id).executeTakeFirstOrThrow();
      expect(shown).toEqual({ birth_date: '1980-05-12', corps_grade: 'PR' });
      const conflicts = (await createFieldConflictsStore(trx as any).list()).filter((c) => c.personId === kept.id);
      expect(conflicts.map((c) => [c.field, c.conflicts.map((k) => `${k.source}:${k.kind}`)])).toEqual([
        ['corps_grade', ['lab_file:new_since_manual', 'merged_record:new_since_manual']],
      ]);
    });
  });
});
