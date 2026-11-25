// « Cancel an import » (case 19 of druid-internal `docs/plan-maj-chercheurs.md`, lot 3): a file or site import opens a
// batch, the values it observes carry its id, and cancelling the import removes them and recomputes the records. Needs
// DATABASE_URL_APP (role druid_app): run by `npm run test:db`; skipped otherwise. Rolled back at the end.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, type Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';
import type { CommandContext } from '../directory/commands';
import { createPgDirectoryCommands } from '../directory/pg/commands';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { createFieldConflictsStore } from '../directory/pg/fieldConflicts';
import { observeFieldValue } from '../directory/pg/fieldValues';
import { createPgWorkPorts } from '../work/pg/workPorts';

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
const ctx: CommandContext = { scope: { all: true, labAnchors: [] }, actor: 'test.user', audit: () => {} };

describe.skipIf(!url)('cancel an import', () => {
  it('removes the values the import brought and recomputes the records; the batch is not an arbitration table', async () => {
    await inRollback(async (trx) => {
      const id = (await trx.insertInto('person').values({ last_name: 'Franklin', first_name: 'Rosalind', uid: 'test-franklin-r' } as any)
        .returning('id').executeTakeFirstOrThrow()).id;
      const recordId = Number((await trx.insertInto('membership').values({ person_id: id, lab_label: 'LABX' } as any)
        .returning('id').executeTakeFirstOrThrow()).id);
      await observeFieldValue(trx, { personId: id, field: 'corps_grade', source: 'legacy', value: 'IE' });
      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-25' });
      const grade = async () => (await trx.selectFrom('person').select('corps_grade').where('id', '=', id).executeTakeFirstOrThrow()).corps_grade;

      // An import of a lab file: its grade wins over `legacy` and carries the batch.
      const batch = await commands.openImportBatch!('lab_file', 'Liste LABX test', ctx);
      const researcher = (await repository.people(ctx.scope)).items.find((p) => p.uid === 'test-franklin-r')!;
      await commands.updatePerson(recordId, researcher, { ...ctx, fieldObservation: { source: 'lab_file', values: { corps_grade: 'MCF' }, importBatchId: batch } });
      expect(await grade()).toBe('MCF');

      const store = createFieldConflictsStore(trx as any);
      expect((await store.imports()).find((i) => i.id === batch)).toMatchObject({
        source: 'lab_file', label: 'Liste LABX test', createdBy: 'test.user', values: 1, persons: 1, undoneAt: null,
      });
      expect((await createPgWorkPorts({ db: trx as any }).conflicts.tables()).some((t) => t.includes('lab_file'))).toBe(false);

      expect(await store.undoImport(batch, 'test.user')).toEqual({ values: 1, persons: 1 });
      expect(await grade()).toBe('IE');
      expect((await store.imports()).find((i) => i.id === batch)).toMatchObject({ values: 0, undoneBy: 'test.user' });
      await expect(store.undoImport(batch, 'test.user')).rejects.toMatchObject({ status: 409 });
      await expect(store.undoImport('abc', 'test.user')).rejects.toMatchObject({ status: 400 });
    });
  });
});
