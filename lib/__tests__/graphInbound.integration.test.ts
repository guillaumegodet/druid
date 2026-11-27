// Identifier actions coming back from SoVisu+ (lib/graph/inboundPg.ts, lot 3 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md), against a migrated database as the application role: effects on the
// record, rejection, tasks, known state of the graph, journal and idempotence, dry-run then replay, failures. Needs
// DATABASE_URL_APP: run by the « database » CI job and `npm run test:db`. Rolled back. Identifiers are fictitious.
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, Transaction } from 'kysely';
import { createDb, withActor, type DB } from '../db/client';
import type { CommandContext } from '../directory/commands';
import { createPgDirectoryCommands } from '../directory/pg/commands';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { planAndRecordGraphActions } from '../graph/pg';
import { MAX_INBOUND_ATTEMPTS, processInboundMessage, recordInboundFailure, replayPlannedMessages } from '../graph/inboundPg';

const url = process.env.DATABASE_URL_APP;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

const ORCID = '0000-0002-1825-0097';
const ORCID_2 = '0000-0001-0000-0001';   // wrong check digit on purpose: fictitious

class Rollback extends Error {}
const inRollback = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
  await expect(withActor(db!, 'test:inbound', async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726105)`.execute(trx);
    await trx.deleteFrom('inbound_graph_action').execute();
    await trx.deleteFrom('graph_action').execute();
    await trx.deleteFrom('graph_identifier_state').execute();
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};

const person = async (trx: Transaction<DB>, uid: string, ids: Record<string, string>) => {
  const p = await trx.insertInto('person').values({ uid, last_name: uid, first_name: 'Test' }).returning('id').executeTakeFirstOrThrow();
  for (const [scheme, value] of Object.entries(ids)) {
    await trx.insertInto('person_identifier').values({ person_id: p.id, scheme, value, is_primary: true }).execute();
    await trx.insertInto('person_identifier_source').values({ person_id: p.id, scheme, value, source: 'legacy' }).execute();
  }
  return p.id;
};
const message = (id: string, actionType: 'ADD' | 'REMOVE', uid: string, type: string, value: string, authenticated = false) => JSON.stringify({
  id, actionType, targetType: 'PERSON', targetUid: `local-${uid}`, path: 'identifiers',
  parameters: actionType === 'ADD' ? { identifier: { type, value, authenticated } } : { type, value },
  timestamp: '2026-11-28T10:00:00.000Z', personUid: `local-${uid}`, application: 'sovisuplus',
});
const identifiers = (trx: Transaction<DB>, personId: string) =>
  trx.selectFrom('person_identifier').select(['scheme', 'value', 'is_primary']).where('person_id', '=', personId).orderBy('scheme').orderBy('value').execute();
const journal = (trx: Transaction<DB>, id: string) =>
  trx.selectFrom('inbound_graph_action').select(['status', 'reason', 'uid', 'identifier_type', 'attempts']).where('id', '=', id).executeTakeFirst();
const graphState = (trx: Transaction<DB>, uid: string) =>
  trx.selectFrom('graph_identifier_state').select(['type', 'value', 'origin']).where('uid', '=', uid).orderBy('type').execute();
const tasks = (trx: Transaction<DB>, uid: string) =>
  trx.selectFrom('task').select(['type', 'origin', 'status', 'key']).where('uid', '=', uid).where('origin', '=', 'sovisuplus').orderBy('key').execute();

// people.csv as the export builds it (server.cjs).
const { buildPeopleCsv } = createRequire(import.meta.url)('../../server.cjs') as { buildPeopleCsv: (r: unknown[], s: unknown[]) => { csv: string } };
const csvCell = (csv: string, uid: string, column: string) => {
  const [header, ...rows] = csv.trim().split('\n');
  const row = rows.find((r) => r.split(',')[3] === uid);
  return row?.split(',')[header.split(',').indexOf(column)];
};
const ALL = { all: true, labAnchors: [] };
const ctx: CommandContext = { scope: ALL, actor: 'manager-a', audit: () => {} };

describe.skipIf(!url)('identifier actions from SoVisu+ (PostgreSQL)', () => {
  it('a removal is applied, set aside, journaled once, and leaves the known state of the graph', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', { orcid: ORCID, idref: '12345678X' });
      await trx.insertInto('graph_identifier_state').values([
        { uid: 'zz-ada-l', type: 'orcid', value: ORCID, origin: 'people_csv' }, { uid: 'zz-ada-l', type: 'idref', value: '12345678X', origin: 'people_csv' },
      ]).execute();
      const raw = message('a-1', 'REMOVE', 'zz-ada-l', 'orcid', ORCID);

      expect(await processInboundMessage(trx, raw, 'on')).toEqual({ id: 'a-1', status: 'applied', reason: undefined, label: 'zz-ada-l (orcid)' });
      expect(await identifiers(trx, ada)).toEqual([{ scheme: 'idref', value: '12345678X', is_primary: true }]);
      const rejected = await trx.selectFrom('alignment_candidate').select(['decision', 'note', 'decided_by'])
        .where('person_id', '=', ada).where('source', '=', 'orcid').where('candidate_id', '=', ORCID).executeTakeFirst();
      expect(rejected).toEqual({ decision: 'Rejeté', note: 'Retiré dans SoVisu+', decided_by: 'sovisuplus:local-zz-ada-l' });
      expect(await graphState(trx, 'zz-ada-l')).toEqual([{ type: 'idref', value: '12345678X', origin: 'people_csv' }]);
      expect(await journal(trx, 'a-1')).toEqual({ status: 'applied', reason: null, uid: 'zz-ada-l', identifier_type: 'orcid', attempts: 0 });
      // The audit log names SoVisu+ and the person.
      const audit = await trx.selectFrom('audit_log').select('actor').where('table_name', '=', 'person_identifier').where('action', '=', 'delete')
        .where(sql`before ->> 'person_id'`, '=', ada).executeTakeFirst();
      expect(audit?.actor).toBe('sovisuplus:local-zz-ada-l');

      // The same message again (redelivery): nothing done twice.
      expect((await processInboundMessage(trx, raw, 'on')).status).toBe('duplicate');
    });
  });

  it('an authenticated addition becomes primary, keeps the old value as secondary and opens a task', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', { orcid: ORCID });
      const r = await processInboundMessage(trx, message('a-2', 'ADD', 'zz-ada-l', 'orcid', ORCID_2, true), 'on');
      expect(r.status).toBe('task');
      expect(await identifiers(trx, ada)).toEqual([
        { scheme: 'orcid', value: ORCID_2, is_primary: true }, { scheme: 'orcid', value: ORCID, is_primary: false },
      ].sort((a, b) => a.value.localeCompare(b.value)));
      const src = await trx.selectFrom('person_identifier_source').select(['source', 'asserted_by']).where('person_id', '=', ada).where('value', '=', ORCID_2).execute();
      expect(src).toEqual([{ source: 'sovisuplus:auth', asserted_by: 'sovisuplus:local-zz-ada-l' }]);
      expect(await tasks(trx, 'zz-ada-l')).toEqual([{ type: 'sovisuplus_identifiant_remplace', origin: 'sovisuplus', status: 'a_faire', key: 'sovisuplus:a-2:0' }]);
      expect(await graphState(trx, 'zz-ada-l')).toEqual([{ type: 'orcid', value: ORCID_2, origin: 'sovisuplus' }]);
    });
  });

  it('a librarian\'s value different from the record is not written, and the publisher never removes it from the graph', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', { idref: '87654321X' });
      await trx.insertInto('graph_identifier_state').values({ uid: 'zz-ada-l', type: 'idref', value: '87654321X', origin: 'people_csv' }).execute();
      expect((await processInboundMessage(trx, message('a-3', 'ADD', 'zz-ada-l', 'idref', '12345678x'), 'on')).status).toBe('task');
      expect(await identifiers(trx, ada)).toEqual([{ scheme: 'idref', value: '87654321X', is_primary: true }]);
      expect((await tasks(trx, 'zz-ada-l')).map((t) => t.type)).toEqual(['sovisuplus_identifiant_different']);
      expect(await graphState(trx, 'zz-ada-l')).toEqual([{ type: 'idref', value: '12345678X', origin: 'sovisuplus' }]);
      // Graph holds the SoVisu+ value, the directory another one: no removal queued (lot 4).
      const recorded = await planAndRecordGraphActions(trx);
      expect(recorded.queued + recorded.blocked).toBe(0);
    });
  });

  it('a value another record carries is never written: task « identifier carried by two people »', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', {});
      await person(trx, 'zz-babbage-c', { orcid: ORCID });
      expect((await processInboundMessage(trx, message('a-4', 'ADD', 'zz-ada-l', 'orcid', ORCID), 'on')).status).toBe('task');
      expect(await identifiers(trx, ada)).toEqual([]);
      expect((await tasks(trx, 'zz-ada-l')).map((t) => t.type)).toEqual(['annuaire_identifiant_partage']);
    });
  });

  it('dry-run journals without writing; the messages are replayed when the mode turns on', async () => {
    await inRollback(async (trx) => {
      const ada = await person(trx, 'zz-ada-l', {});
      const raw = message('a-5', 'ADD', 'zz-ada-l', 'idref', '12345678X');
      expect((await processInboundMessage(trx, raw, 'dry-run')).status).toBe('planned');
      expect((await processInboundMessage(trx, raw, 'dry-run')).status).toBe('duplicate');
      expect(await identifiers(trx, ada)).toEqual([]);
      expect(await graphState(trx, 'zz-ada-l')).toEqual([]);

      const lines: string[] = [];
      expect(await replayPlannedMessages(trx, (l) => lines.push(l))).toBe(1);
      expect(lines).toEqual(['[graph_consume] applied: zz-ada-l (idref)']);
      expect(await identifiers(trx, ada)).toEqual([{ scheme: 'idref', value: '12345678X', is_primary: true }]);
      expect((await journal(trx, 'a-5'))?.status).toBe('applied');
    });
  });

  it('what Druid does not take over is journaled as ignored, with the reason', async () => {
    await inRollback(async (trx) => {
      expect(await processInboundMessage(trx, message('a-6', 'ADD', 'zz-nobody', 'orcid', ORCID), 'on')).toMatchObject({ status: 'ignored', reason: 'unknown_person' });
      const own = JSON.stringify({ ...JSON.parse(message('a-7', 'REMOVE', 'zz-ada-l', 'orcid', ORCID)), application: 'druid' });
      expect(await processInboundMessage(trx, own, 'dry-run')).toMatchObject({ status: 'ignored' });
      expect((await journal(trx, 'a-7'))?.reason).toBe('own_action');
      const r = await processInboundMessage(trx, '{not json', 'on');
      expect(r.id).toMatch(/^sha256:/);
      expect(r).toMatchObject({ status: 'ignored', reason: 'not_json' });
      // An action on a person without a record still updates the known state of the graph (the IKG applied it).
      expect(await graphState(trx, 'zz-nobody')).toEqual([{ type: 'orcid', value: ORCID, origin: 'sovisuplus' }]);
    });
  });

  it('failures are counted, so that the consumer sends the message to the dead-letter queue after the last one', async () => {
    await inRollback(async (trx) => {
      const raw = message('a-8', 'ADD', 'zz-ada-l', 'orcid', ORCID);
      for (let i = 1; i <= MAX_INBOUND_ATTEMPTS; i++) expect(await recordInboundFailure(trx, raw, new Error('database restarting'))).toBe(i);
      expect(await journal(trx, 'a-8')).toMatchObject({ status: 'failed', attempts: MAX_INBOUND_ATTEMPTS });
      // A failed message delivered again is handled normally.
      expect((await processInboundMessage(trx, raw, 'on')).status).toBe('ignored');
    });
  });
  describe('lot 4 — a SoVisu+ value is never written back by Druid', () => {
    const record = async (trx: Transaction<DB>, uid: string) => {
      const id = (await trx.insertInto('person').values({ uid, last_name: 'Lovelace', first_name: 'Ada' }).returning('id').executeTakeFirstOrThrow()).id;
      const recordId = Number((await trx.insertInto('membership').values({ person_id: id, lab_label: 'LABX' } as any).returning('id').executeTakeFirstOrThrow()).id);
      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-28' });
      const read = async () => { repository.invalidate(); return (await repository.people(ALL)).items.find((p) => p.uid === uid)!; };
      return { id, recordId, commands, read };
    };

    it('a record form opened before the SoVisu+ addition keeps it when saved, and people.csv carries it', async () => {
      await inRollback(async (trx) => {
        const { id, recordId, commands, read } = await record(trx, 'zz-ada-l');
        const form = await read();   // opened by a manager, no IdRef yet
        expect((await processInboundMessage(trx, message('b-1', 'ADD', 'zz-ada-l', 'idref', '12345678X'), 'on')).status).toBe('applied');
        // The manager saves the old form after changing another field.
        await commands.updatePerson(recordId, { ...form, firstName: 'Augusta Ada', baseIdentifiers: form.identifiers }, ctx);
        const after = await read();
        expect(after.firstName).toBe('Augusta Ada');
        expect(after.identifiers.idref).toBe('12345678X');
        const rejected = await trx.selectFrom('alignment_candidate').select('candidate_id').where('person_id', '=', id).execute();
        expect(rejected).toEqual([]);
        expect(csvCell(buildPeopleCsv([after], []).csv, 'zz-ada-l', 'idref')).toBe('12345678X');
      });
    });

    it('a value the manager changes in the form wins (explicit decision), and a removal by the researcher does not come back', async () => {
      await inRollback(async (trx) => {
        const { recordId, commands, read } = await record(trx, 'zz-ada-l');
        await processInboundMessage(trx, message('b-2', 'ADD', 'zz-ada-l', 'idref', '12345678X'), 'on');
        const form = await read();
        await commands.updatePerson(recordId, { ...form, identifiers: { ...form.identifiers, idref: '87654321X' }, baseIdentifiers: form.identifiers }, ctx);
        expect((await read()).identifiers.idref).toBe('87654321X');

        // The researcher removes it in SoVisu+ while a form with the value is open; the form saved later does not bring it back.
        const stale = await read();
        // Typed by the manager (source `manual`): removed anyway, with a task to review (D3).
        expect((await processInboundMessage(trx, message('b-3', 'REMOVE', 'zz-ada-l', 'idref', '87654321X'), 'on')).status).toBe('task');
        await commands.updatePerson(recordId, { ...stale, lastName: 'Byron', baseIdentifiers: stale.identifiers }, ctx);
        const after = await read();
        expect(after.identifiers.idref ?? '').toBe('');
        expect(csvCell(buildPeopleCsv([after], []).csv, 'zz-ada-l', 'idref')).toBe('');
      });
    });

    it('a save without the loaded identifiers (imports, older clients) writes the identifiers as before', async () => {
      await inRollback(async (trx) => {
        const { recordId, commands, read } = await record(trx, 'zz-ada-l');
        const form = await read();
        await processInboundMessage(trx, message('b-4', 'ADD', 'zz-ada-l', 'idref', '12345678X'), 'on');
        await commands.updatePerson(recordId, { ...form, firstName: 'Augusta Ada' }, ctx);
        expect((await read()).identifiers.idref ?? '').toBe('');
      });
    });
  });
});
