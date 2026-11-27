// Order of the sources per instance (lot 5 of druid-internal `docs/plan-maj-chercheurs.md`, D6): preview without
// writing, then setting it recomputes the records whose shown value changes, marks the ranks customized and is audited.
// Needs DATABASE_URL_APP (role druid_app): `npm run test:db`; rolled back at the end.
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
  await expect(withActor(db!, 'test.admin', async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
    await fn(trx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
};
const ctx: CommandContext = { scope: { all: true, labAnchors: [] }, actor: 'test.admin', audit: () => {} };

describe.skipIf(!url)('order of the sources', () => {
  it('preview, then set: the records are recomputed, the ranks customized and audited', async () => {
    await inRollback(async (trx) => {
      const id = (await trx.insertInto('person').values({ last_name: 'Bohr', first_name: 'Niels' } as any).returning('id').executeTakeFirstOrThrow()).id;
      await observeFieldValue(trx, { personId: id, field: 'corps_grade', source: 'ldap', value: 'PR' });
      await observeFieldValue(trx, { personId: id, field: 'corps_grade', source: 'hr_file', value: 'DR' });
      const grade = async () => (await trx.selectFrom('person').select('corps_grade').where('id', '=', id).executeTakeFirstOrThrow()).corps_grade;
      expect(await grade()).toBe('PR');
      const commands = createPgDirectoryCommands({ db: trx, repository: createPgDirectoryRepository({ db: trx }), today: () => '2026-11-28' });

      const orders = await commands.sourceOrders!(ctx);
      expect(orders.fields.find((f) => f.field === 'corps_grade')!.sources.map((s) => s.source).slice(0, 2)).toEqual(['ldap', 'hr_file']);
      expect(orders.profiles.no_ldap[0]).toBe('hr_file');

      const order = ['hr_file', 'ldap', 'partner_directory', 'site', 'lab_file', 'legacy'];
      const preview = await commands.previewSourceOrder!('corps_grade', order, ctx);
      expect(preview.changed).toBeGreaterThanOrEqual(1);
      expect(preview.examples).toContainEqual({ name: 'BOHR Niels', before: 'PR', after: 'DR' });
      expect(await grade()).toBe('PR');

      const done = await commands.setSourceOrder!('corps_grade', order, ctx);
      expect(done.changed).toBe(preview.changed);
      expect(await grade()).toBe('DR');
      const ranks = await trx.selectFrom('field_source_priority').select(['source', 'rank', 'customized']).where('field', '=', 'corps_grade').orderBy('rank').execute();
      expect(ranks.slice(0, 2)).toEqual([{ source: 'hr_file', rank: 10, customized: true }, { source: 'ldap', rank: 20, customized: true }]);
      const audited = await trx.selectFrom('audit_log').select('action').where('table_name', '=', 'field_source_priority').where('actor', '=', 'test.admin').execute();
      expect(audited.length).toBeGreaterThan(0);

      await expect(commands.previewSourceOrder!('corps_grade', ['manual', 'ldap'], ctx)).rejects.toMatchObject({ status: 400 });
      await expect(commands.previewSourceOrder!('corps_grade', ['ldap', 'ldap'], ctx)).rejects.toMatchObject({ status: 400 });
      await expect(commands.previewSourceOrder!('email', ['ldap'], ctx)).rejects.toMatchObject({ status: 400 });
      await expect(commands.sourceOrders!({ ...ctx, scope: { all: false, labAnchors: ['labx'] } })).rejects.toMatchObject({ status: 403 });
    });
  });
});
