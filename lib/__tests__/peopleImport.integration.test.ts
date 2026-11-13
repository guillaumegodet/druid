// Import of a spreadsheet of researchers on the PostgreSQL store (druid-internal docs/plan-druid-saas.md, lot 5 a):
// a person without uid_dyna (an establishment without LDAP) listed in two labs is ONE record with two memberships,
// read back grouped; a later file adds a lab to a person created with one; teams and complements are written. Needs DATABASE_URL
// (druid_owner: the fixture load empties tables); rolled back: nothing is left in the database.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import type { Researcher } from '../../types';
import { createDb } from '../db/client';
import type { CommandContext } from '../directory/commands';
import type { DirectoryScope } from '../directory/repository';
import { createPgDirectoryCommands } from '../directory/pg/commands';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { applyPeopleImport, planPeopleImport, teamKey, type PeopleImportRow } from '../directory/peopleImport';
import { transformDirectory } from '../migration/gristToPg';
import { loadDirectory } from '../migration/loadPg';
import { gristDirectoryFixture } from './fixtures/gristDirectory';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 60000 });
class Rollback extends Error {}

const ALL: DirectoryScope = { all: true, labAnchors: [] };
const ctx: CommandContext = { scope: ALL, actor: 'import-test', audit: () => {} };
const row = (r: Partial<PeopleImportRow>): PeopleImportRow =>
  ({ lastName: '', firstName: '', lab: '', email: '', team: '', employer: '', position: '', grade: '', orcid: '', idref: '', halId: '', uid: '', ...r });

describe.skipIf(!url)('people import on PostgreSQL', () => {
  it('writes one record per person, its memberships grouped without uid', async () => {
    const directory = transformDirectory(gristDirectoryFixture());
    const seen: Record<string, unknown> = {};
    await expect(db!.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      const repository = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository, today: () => '2026-11-10' });
      const run = async (rows: PeopleImportRow[], pick: (p: ReturnType<typeof planPeopleImport>) => Parameters<typeof applyPeopleImport>[0]['selection']) => {
        const [people, institutions, structures] = await Promise.all([repository.people(ALL), repository.institutions(), repository.structures()]);
        const input = { source: 'Fichier test', rows };
        const plan = planPeopleImport(input, people.items, institutions.items, structures.items);
        return applyPeopleImport({ input, selection: pick(plan), people: people.items, institutions: institutions.items, structures: structures.items, commands, ctx, today: '2026-11-10', actor: 'import-test' });
      };
      const zoe = async (): Promise<Researcher[]> => (await repository.people(ALL)).items.filter((r) => r.lastName === 'Nouvelle');

      seen.first = await run([
        row({ lastName: 'Nouvelle', firstName: 'Zoé', lab: 'LAB1', team: 'TEAMA', email: 'zoe@example.org', orcid: '0000-0002-0000-0001', grade: 'MCF' }),
        row({ lastName: 'Nouvelle', firstName: 'Zoé', lab: 'LAB2', team: 'NEWT' }),
        row({ lastName: 'Petit', lab: 'LAB2', email: 'petit@example.org' }),
        row({ lastName: 'Solo', firstName: 'Sam', lab: 'LAB1', email: 'sam@example.org' }),
      ], (p) => ({
        teams: p.teams.map((t) => teamKey(t.lab, t.acronym)), creations: p.creations.map((c) => c.index), joins: [],
        fields: p.updates.flatMap((u) => u.complements.map((c) => ({ index: u.index, field: c.field }))), validateNew: false,
      }));
      seen.zoe = (await zoe()).map((r) => ({
        uid: r.uid, email: r.email, orcid: r.identifiers.orcid, grade: r.employment.grade,
        labs: r.affiliations.map((a) => [a.structureName, a.team, !!a.isPrimary]),
      }));
      seen.petit = (await repository.people(ALL)).items.find((r) => r.lastName === 'Petit')?.email;
      seen.newTeam = (await repository.structures()).items.some((s) => s.acronym === 'NEWT' && s.parentStructure === 'LAB2');

      // A later file: a person created with one lab, found again by email in another → a membership added to her record.
      seen.second = await run([row({ lastName: 'Solo', firstName: 'Sam', lab: 'LAB2', email: 'sam@example.org' })],
        (p) => ({ teams: [], creations: [], joins: p.joins.map((j) => j.index), fields: [], validateNew: false }));
      seen.samAfter = (await repository.people(ALL)).items.filter((r) => r.lastName === 'Solo').map((r) => r.affiliations.map((a) => a.structureName));
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    expect(seen.first).toEqual({ teamsCreated: 1, created: 2, joined: 1, updated: 1, stale: 0, errors: [] });
    expect(seen.zoe).toEqual([{
      uid: '', email: 'zoe@example.org', orcid: '0000-0002-0000-0001', grade: 'MCF',
      labs: [['LAB1', 'TEAMA', true], ['LAB2', 'NEWT', false]],
    }]);
    expect(seen.petit).toBe('petit@example.org');
    expect(seen.newTeam).toBe(true);
    expect(seen.second).toMatchObject({ joined: 1, errors: [] });
    expect(seen.samAfter).toEqual([['LAB1', 'LAB2']]);
  });
});
