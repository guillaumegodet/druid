// Contract of the directory repository (druid-internal docs/plan-migration-postgresql.md, lot 6 a): the Grist and the
// PostgreSQL implementations answer the same on the same data — the fictitious directory of fixtures/, served by a
// fake Grist on one side, imported into PostgreSQL (lib/migration) on the other. The only differences allowed are the
// ones the import documents (Grist rows it does not import). Needs DATABASE_URL (druid_owner: the import empties
// tables); run by the « database » CI job and `npm run test:db`. Rolled back: nothing is left in the database.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../db/client';
import { createGristDirectoryRepository, type DirectoryRepository, type GristClient } from '../directory/repository';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import type { GristRecord } from '../directory/gristMapping';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';
import { loadDirectory, loadWork } from '../migration/loadPg';
import { gristDirectoryFixture } from './fixtures/gristDirectory';
import { gristWorkFixture } from './fixtures/gristWork';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });
class Rollback extends Error {}

/** Read-only fake Grist serving the fixture tables. */
const fakeGrist = (tables: Record<string, GristRecord[]>): GristClient => {
  const no = async () => { throw new Error('read-only fake'); };
  return {
    docUpdatedAt: async () => 'v1',
    tableIds: async () => Object.keys(tables),
    records: async (table, filter) => (tables[table] || []).filter((r) =>
      !filter || Object.entries(filter).every(([col, values]) => values.includes(col === 'id' ? r.id : r.fields[col]))),
    columns: async () => [], sql: no, addColumns: no, updateColumns: no, addTables: no, addRecords: no, updateRecords: no, deleteRecords: no,
  } as GristClient;
};

/** Paths where two JSON values differ (`people[1].identifiers.orcid: "x" ≠ "y"`), to read a failed contract. */
const differences = (a: unknown, b: unknown, path = ''): string[] => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])];
    return keys.flatMap((k) => differences((a as any)[k], (b as any)[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`));
  }
  return [`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
};

const LDAP = { 'dupont-a': { etat: 'ACTIF', civilite: 'Madame', categorie: 'ENSEIGNANT-CHERCHEUR', empCorps: '300', birthDate: '19800504' }, 'Petit-D': 'DEPART' };
const ALL = { all: true, labAnchors: [] };
const LAB1 = { all: false, labAnchors: ['lab1'] };
const LAB2 = { all: false, labAnchors: ['lab2'] };

describe.skipIf(!url)('DirectoryRepository contract: Grist = PostgreSQL', () => {
  it('people, structures, institutions, merges, ABES marks and labs of a uid', async () => {
    const dir = gristDirectoryFixture();
    const work = gristWorkFixture();
    const grist = createGristDirectoryRepository({
      grist: fakeGrist({ Annuaire: dir.Annuaire!, Etablissements: dir.Etablissements!, Structures: dir.Structures!, Fusions_log: work.Fusions_log! }),
      loadLdapCache: async () => ({ data: LDAP, version: 'l1' }),
    });
    const directory = transformDirectory(dir);
    const got: Record<string, [unknown, unknown]> = {};
    const both = async (name: string, read: (r: DirectoryRepository) => Promise<unknown>, pg: DirectoryRepository) => {
      got[name] = [await read(grist), await read(pg)];
    };
    await expect(db!.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      await loadWork(trx, transformWork(work, directory.rows).rows);
      const pg = createPgDirectoryRepository({ db: trx, loadLdapCache: async () => ({ data: LDAP, version: 'l1' }) });
      await both('people', async (r) => (await r.people(ALL)).items, pg);
      await both('people LAB1', async (r) => (await r.people(LAB1)).items, pg);
      await both('people LAB2', async (r) => (await r.people(LAB2)).items, pg);
      await both('people without LDAP', async (r) => r.people(ALL).then((x) => x.items.length), pg);
      await both('structures', async (r) => (await r.structures()).items, pg);
      await both('institutions', async (r) => (await r.institutions()).items, pg);
      await both('merges', async (r) => (await r.merges(10)).items, pg);
      await both('abes', async (r) => (await r.abesExports(ALL)).items, pg);
      await both('labs of Petit-D', (r) => r.labsOfUid('Petit-D', ALL), pg);
      await both('labs of ext_durand-c in LAB1', (r) => r.labsOfUid('ext_durand-c', LAB1), pg);
      await both('labs of dupont-a', (r) => r.labsOfUid('dupont-a', ALL), pg);
      got.pgUpdatedAt = [null, (await pg.people(ALL)).updatedAt];
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    for (const name of ['people', 'people LAB1', 'people LAB2', 'people without LDAP', 'institutions', 'merges', 'abes', 'labs of Petit-D',
      'labs of ext_durand-c in LAB1', 'labs of dupont-a']) {
      expect(differences(got[name][0], got[name][1], name)).toEqual([]);
    }
    const people = got.people[1] as any[];
    expect(people.map((p) => [p.id, p.gristRowId, p.affiliations.length])).toEqual([
      ['dupont-a', 101, 2], [expect.stringMatching(/^ext_martin-b/), 103, 1], ['ext_durand-c', 104, 1], ['Petit-D', 105, 1],
    ]);
    // Structures: the Grist rows the import leaves out (duplicated local_id, no local_id) are the only difference.
    const gristStructures = (got.structures[0] as any[]).filter((s) => !['S-13', 'S-14'].includes(s.id));
    expect(differences(gristStructures, got.structures[1], 'structures')).toEqual([]);
    expect(got.pgUpdatedAt[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
