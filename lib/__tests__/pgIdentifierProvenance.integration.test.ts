// Provenance of the identifiers (lot 4 b of druid-internal `docs/plan-maj-chercheurs.md`): each write records the
// source of its values, a removal typed in the record is « Rejeté » for the alignments, an import or a batch of
// alignment proposals never is. Needs DATABASE_URL_APP (role druid_app): `npm run test:db`; rolled back at the end.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, type Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';
import type { CommandContext } from '../directory/commands';
import { createPgDirectoryCommands } from '../directory/pg/commands';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { writeRecordFields } from '../directory/pg/recordFields';
import { createFieldConflictsStore } from '../directory/pg/fieldConflicts';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 2 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>, actor = 'test.user') => {
  await expect(withActor(db!, actor, async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};
const ALL = { all: true, labAnchors: [] };
const ctx: CommandContext = { scope: ALL, actor: 'test.user', audit: () => {} };

describe.skipIf(!url)('identifier provenance', () => {
  it('record, import and alignment writes carry their source; a removal in the record is « Rejeté », not an import\'s', async () => {
    await inRollback(async (trx) => {
      const id = (await trx.insertInto('person').values({ last_name: 'Wu', first_name: 'Chien-Shiung', uid: 'test-wu-c' } as any)
        .returning('id').executeTakeFirstOrThrow()).id;
      const recordId = Number((await trx.insertInto('membership').values({ person_id: id, lab_label: 'LABX' } as any)
        .returning('id').executeTakeFirstOrThrow()).id);
      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-27' });
      const read = async () => { repository.invalidate(); return (await repository.people(ALL)).items.find((p) => p.uid === 'test-wu-c')!; };
      const rows = async () => (await trx.selectFrom('person_identifier_source').select(['scheme', 'value', 'source', 'asserted_by'])
        .where('person_id', '=', id).orderBy('scheme').orderBy('value').orderBy('source').execute());
      const rejected = async () => (await trx.selectFrom('alignment_candidate').select(['source', 'candidate_id', 'decision', 'decided_by'])
        .where('person_id', '=', id).orderBy('candidate_id').execute());

      // An import completes the IdRef: its source, no decision.
      const r0 = await read();
      await commands.updatePerson(recordId, { ...r0, identifiers: { ...r0.identifiers, idref: '000000019' } }, { ...ctx, identifierSource: 'lab_file' });
      // The record gets an ORCID, then a corrected one: the first is « Rejeté » for the ORCID alignment.
      const r1 = await read();
      await commands.updatePerson(recordId, { ...r1, identifiers: { ...r1.identifiers, orcid: '0000-0002-0000-0001' } }, ctx);
      const r2 = await read();
      await commands.updatePerson(recordId, { ...r2, identifiers: { ...r2.identifiers, orcid: '0000-0002-0000-0002' } }, ctx);
      // An import that would clear the IdRef (it never does in practice) leaves no decision.
      const r3 = await read();
      await commands.updatePerson(recordId, { ...r3, identifiers: { ...r3.identifiers, idref: '' } }, { ...ctx, identifierSource: 'site' });

      expect(await rows()).toEqual([
        { scheme: 'idref', value: '000000019', source: 'lab_file', asserted_by: 'test.user' },
        { scheme: 'orcid', value: '0000-0002-0000-0001', source: 'manual', asserted_by: 'test.user' },
        { scheme: 'orcid', value: '0000-0002-0000-0002', source: 'manual', asserted_by: 'test.user' },
      ]);
      expect(await rejected()).toEqual([{ source: 'orcid', candidate_id: '0000-0002-0000-0001', decision: 'Rejeté', decided_by: 'test.user' }]);

      // A job applying an OpenAlex alignment (its trace in the patch): `align:openalex`, and no decision for what it drops.
      await sql`SELECT set_config('druid.actor', 'job:test', true)`.execute(trx);
      await writeRecordFields(trx, id, String(recordId), { OpenAlex_ids: 'A5000000001|A5000000002', OpenAlex_derniere_maj: '2026-11-27' });
      await writeRecordFields(trx, id, String(recordId), { OpenAlex_ids: 'A5000000002', OpenAlex_derniere_maj: '2026-11-27' });
      expect((await rows()).filter((r) => r.scheme === 'openalex').map((r) => [r.value, r.source])).toEqual([
        ['A5000000001', 'align:openalex'], ['A5000000002', 'align:openalex'],
      ]);
      expect((await rejected()).length).toBe(1);

      // The panel: shown values first, the rejected ORCID kept with its source and set aside.
      await sql`SELECT set_config('druid.actor', 'test.user', true)`.execute(trx);
      const panel = await commands.identifierSources!(recordId, ctx);
      expect(panel.orcid.map((v) => [v.value, v.shown, v.primary, v.sources.map((s) => s.source), v.setAside?.decision ?? null])).toEqual([
        ['0000-0002-0000-0002', true, true, ['manual'], null],
        ['0000-0002-0000-0001', false, false, ['manual'], 'Rejeté'],
      ]);
      expect(panel.idref.map((v) => [v.value, v.shown])).toEqual([['000000019', false]]);

      // Typed again in the record: the person changed their mind, the rejection is lifted.
      const r4 = await read();
      await commands.updatePerson(recordId, { ...r4, identifiers: { ...r4.identifiers, orcid: '0000-0002-0000-0001' } }, ctx);
      expect((await rejected()).map((r) => r.candidate_id)).toEqual(['0000-0002-0000-0002']);
    });
  });

  it('an import never writes back a value set aside: a conflict to keep or accept', async () => {
    await inRollback(async (trx) => {
      const id = (await trx.insertInto('person').values({ last_name: 'Lovelace', first_name: 'Ada', uid: 'test-lovelace-a' } as any)
        .returning('id').executeTakeFirstOrThrow()).id;
      const recordId = Number((await trx.insertInto('membership').values({ person_id: id, lab_label: 'LABX' } as any)
        .returning('id').executeTakeFirstOrThrow()).id);
      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-27' });
      const store = createFieldConflictsStore(trx as any);
      const read = async () => { repository.invalidate(); return (await repository.people(ALL)).items.find((p) => p.uid === 'test-lovelace-a')!; };
      const orcid = async () => (await trx.selectFrom('person_identifier').select('value').where('person_id', '=', id).where('scheme', '=', 'orcid').execute())
        .map((r) => r.value);
      const mine = async () => (await store.identifierConflicts()).filter((c) => c.personId === id);

      // Typed, then removed in the record: « Rejeté ».
      const r0 = await read();
      await commands.updatePerson(recordId, { ...r0, identifiers: { ...r0.identifiers, orcid: '0000-0003-0000-0001' } }, ctx);
      const r1 = await read();
      await commands.updatePerson(recordId, { ...r1, identifiers: { ...r1.identifiers, orcid: '' } }, ctx);
      // The decision dates from before the import (a transaction has a single now()).
      await trx.updateTable('alignment_candidate').set({ decided_at: '2026-01-01T00:00:00Z' } as any).where('person_id', '=', id).execute();
      // A lab file brings it back: not written, a conflict.
      const r2 = await read();
      await commands.updatePerson(recordId, { ...r2, identifiers: { ...r2.identifiers, orcid: '0000-0003-0000-0001' } }, { ...ctx, identifierSource: 'lab_file' });
      expect(await orcid()).toEqual([]);
      expect((await mine()).map((c) => [c.scheme, c.value, c.kind, c.sources.map((s) => s.source)])).toEqual([['orcid', '0000-0003-0000-0001', 'brought_again', ['lab_file']]]);

      // Kept set aside: no conflict, and the same file imported again raises none.
      await store.resolveIdentifier({ personId: id, scheme: 'orcid', value: '0000-0003-0000-0001', action: 'keep' }, 'test.user');
      expect(await mine()).toEqual([]);
      const r3 = await read();
      await commands.updatePerson(recordId, { ...r3, identifiers: { ...r3.identifiers, orcid: '0000-0003-0000-0001' } }, { ...ctx, identifierSource: 'lab_file' });
      expect([await orcid(), await mine()]).toEqual([[], []]);

      // Accepted after all: written as primary, rejection lifted.
      await trx.updateTable('alignment_candidate').set({ decided_at: '2026-01-01T00:00:00Z' } as any).where('person_id', '=', id).execute();
      await trx.updateTable('person_identifier_source').set({ asserted_at: '2026-02-01T00:00:00Z' } as any).where('person_id', '=', id).where('source', '=', 'lab_file').execute();
      expect((await mine()).length).toBe(1);
      await store.resolveIdentifier({ personId: id, scheme: 'orcid', value: '0000-0003-0000-0001', action: 'accept' }, 'test.user');
      expect([await orcid(), await mine()]).toEqual([['0000-0003-0000-0001'], []]);
      expect(await trx.selectFrom('alignment_candidate').select('id').where('person_id', '=', id).execute()).toEqual([]);
    });
  });

  it('promoting a secondary IdHAL_i to primary in the record is not a removal', async () => {
    await inRollback(async (trx) => {
      const id = (await trx.insertInto('person').values({ last_name: 'Franklin', first_name: 'Ursula', uid: 'test-franklin-u' } as any)
        .returning('id').executeTakeFirstOrThrow()).id;
      const recordId = Number((await trx.insertInto('membership').values({ person_id: id, lab_label: 'LABX' } as any)
        .returning('id').executeTakeFirstOrThrow()).id);
      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-27' });
      const read = async () => { repository.invalidate(); return (await repository.people(ALL)).items.find((p) => p.uid === 'test-franklin-u')!; };
      const r0 = await read();
      await commands.updatePerson(recordId, { ...r0, identifiers: { ...r0.identifiers, halIdNum: '111', halIdNumSecondary: '222' } }, ctx);
      const r1 = await read();
      await commands.updatePerson(recordId, { ...r1, identifiers: { ...r1.identifiers, halIdNum: '222', halIdNumSecondary: '111' } }, ctx);
      expect(await trx.selectFrom('alignment_candidate').select('candidate_id').where('person_id', '=', id).execute()).toEqual([]);
      const shown = await trx.selectFrom('person_identifier').select(['value', 'is_primary']).where('person_id', '=', id).where('scheme', '=', 'idhal_i')
        .orderBy('value').execute();
      expect(shown).toEqual([{ value: '111', is_primary: false }, { value: '222', is_primary: true }]);
    });
  });
});
