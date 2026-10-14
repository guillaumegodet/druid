// Seed of the demo loaded into PostgreSQL (lot 10 b) and read back by the PostgreSQL repository, rolled back at the
// end. Needs DATABASE_URL (druid_owner: the load empties the tables); run by the « database » CI job and `npm run test:db`.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, type Transaction } from 'kysely';
import { createDb, type DB } from '../db/client';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { demoDirectoryInput, emptyWorkInput, type DemoData } from '../migration/demoSeed';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';
import { loadDirectory, loadWork } from '../migration/loadPg';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}

describe.skipIf(!url)('demo seed on PostgreSQL', () => {
  it('loads the demo and serves it through the repository', async () => {
    const data = (await import('../../instances/demo/demo-data.mjs')) as DemoData;
    const directory = transformDirectory(demoDirectoryInput(data));
    const work = transformWork(emptyWorkInput(), directory.rows);
    let seen: { people: number; structures: number; institutions: number; withOrcid: number } | null = null;
    await expect(db!.transaction().execute(async (trx: Transaction<DB>) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      const loaded = { ...await loadDirectory(trx, directory.rows, directory.report), ...await loadWork(trx, work.rows) };
      expect(loaded.person).toBe(data.buildResearchers().length);
      const repository = createPgDirectoryRepository({ db: trx as any });
      const [people, structures, institutions] = await Promise.all([
        repository.people({ all: true, labAnchors: [] }), repository.structures(), repository.institutions(),
      ]);
      seen = {
        people: people.items.length, structures: structures.items.length, institutions: institutions.items.length,
        withOrcid: people.items.filter((p) => p.identifiers?.orcid).length,
      };
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);
    expect(seen).toEqual({
      people: data.buildResearchers().length, structures: data.STRUCTURES.length, institutions: data.ETABLISSEMENTS.length,
      withOrcid: data.buildResearchers().filter((r) => r.ORCID).length,
    });
  });
});
