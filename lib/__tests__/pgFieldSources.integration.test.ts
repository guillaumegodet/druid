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
import { observeFieldValue } from '../directory/pg/fieldValues';

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
});
