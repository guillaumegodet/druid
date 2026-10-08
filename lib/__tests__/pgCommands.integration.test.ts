// Contract of the directory commands (druid-internal docs/plan-migration-postgresql.md, lot 6 b): the same commands,
// run on the Grist implementation (in-memory Grist) and on the PostgreSQL one (the same fixture imported), leave the
// same directory behind — records, structures, merge log, ABES marks read back by the repositories — and refuse the
// same things. Needs DATABASE_URL (druid_owner: the import empties tables); run by the « database » CI job and
// `npm run test:db`. Rolled back: nothing is left in the database.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import type { Researcher } from '../../types';
import { createDb } from '../db/client';
import { createGristDirectoryCommands, type CommandContext, type DirectoryCommands } from '../directory/commands';
import { createGristDirectoryRepository, type DirectoryRepository, type DirectoryScope } from '../directory/repository';
import { createPgDirectoryCommands } from '../directory/pg/commands';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';
import { loadDirectory, loadWork } from '../migration/loadPg';
import { gristDirectoryFixture } from './fixtures/gristDirectory';
import { gristWorkFixture } from './fixtures/gristWork';
import { memoryGrist } from './fixtures/memoryGrist';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 60000 });
class Rollback extends Error {}

/** Paths where two JSON values differ, to read a failed contract. */
const differences = (a: unknown, b: unknown, path = ''): string[] => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])];
    return keys.flatMap((k) => differences((a as any)[k], (b as any)[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`));
  }
  return [`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
};

const ALL: DirectoryScope = { all: true, labAnchors: [] };
const ctxOf = (scope: DirectoryScope = ALL): CommandContext => ({ scope, actor: 'contract', audit: () => {} });
const TODAY = () => '2026-10-09';
interface Store { repo: DirectoryRepository; commands: DirectoryCommands }

/** One step of the scenario, run on both stores: its result (or error), then what the directory reads. */
type Step = (s: Store, people: Researcher[]) => Promise<unknown>;
const STEPS: [string, Step][] = [
  ['create a record (LDAP prefill, employer, identifiers, several LinkedIn URLs, validation)', (s) => s.commands.createPerson({
    id: '', uid: 'nouveau-x', civility: 'M', lastName: 'Nouveau', firstName: 'Xavier', displayName: '', email: 'x@example.org', nationality: 'FR',
    birthDate: '1990-01-02', hrId: '4321', photoUrl: ' https://photo.example.org/x.png ',
    employment: { employer: 'CNRS', contractType: 'TITULAIRE', grade: 'CR', startDate: '2024-09', endDate: '', fte: 0.8, researchFte: 0.5 } as any,
    affiliations: [{ structureName: 'LAB2', team: 'TEAMA', startDate: '2024', endDate: '', isPrimary: true }] as any,
    identifiers: { orcid: '0000-0003-0000-0005', idref: '', halId: 'xavier-nouveau', halIdNum: '12-34', scopusId: '', openalexId: '', openalexIds: '' },
    socials: { bluesky: '@x.bsky.social', mastodon: '', youtube: '', podcast: '', blog: '', linkedin: 'https://linkedin.com/in/x1, https://linkedin.com/in/x2' },
    profiles: { cvHal: 'https://cv.hal.science/x' },
    validation: { validated: true, validatedStatus: 'PRESENT', validationDate: '2026-10-01', validationSource: 'contrat', validationScope: ['statut'], validatedBy: 'alice' },
    ldapPrefill: { etat: 'N', date: '2026-10-08' },
  } as any, ctxOf())],
  ['update a single-row record (identity, identifiers, links, employment, validation)', (s, people) => {
    const r = people.find((p) => p.gristRowId === 105)!;
    return s.commands.updatePerson(105, {
      ...r, lastName: 'Petit-Grand', firstName: 'Denis', civility: 'M', email: 'd@example.org', birthDate: '1975-03-04',
      identifiers: { ...r.identifiers, orcid: ' 0000-0004-0000-0004 ', scopusId: 'absent' },
      socials: { ...r.socials, linkedin: 'https://linkedin.com/in/d' }, profiles: { ...r.profiles, website: 'https://d.example.org' },
      employment: { ...r.employment, employer: 'NANTES UNIVERSITE', grade: 'MCF', startDate: '2010', endDate: '2031-08', fte: 1, researchFte: null },
      validation: { validated: false, validationScope: [] },
    } as any, ctxOf());
  }],
  ['add a secondary membership to the qualified record (reuses its SECONDAIRE row, creates another)', (s, people) => {
    const r = people.find((p) => p.gristRowId === 101)!;
    return s.commands.updatePerson(101, {
      ...r, affiliations: [
        { ...r.affiliations[0], isPrimary: true },
        { structureName: 'LAB2', team: 'TEAMA', startDate: '2023', endDate: '', isPrimary: false, gristRowId: 102 },
        { structureName: 'LAB1', team: '', startDate: '2001', endDate: '2005', isPrimary: false },
      ],
    } as any, ctxOf());
  }],
  ['remove a membership (deleted, snapshot in the merge log)', (s, people) => {
    const r = people.find((p) => p.gristRowId === 101)!;
    return s.commands.updatePerson(101, { ...r, affiliations: r.affiliations.filter((a) => a.structureName !== 'LAB1' || a.isPrimary) } as any, ctxOf());
  }],
  ['groups, OpenAlex author id, validations, ABES marks', async (s) => [
    await s.commands.setGroups([{ recordId: 101, groups: ['g1', 'g2'] }, { recordId: 104, groups: [] }], ctxOf()),
    await s.commands.setOpenalexId(104, 'A777', ctxOf()),
    await s.commands.applyValidations([{ recordId: 104, validation: { validated: true, validatedStatus: 'PARTI' as any, validationDate: '2026-10-02', validationScope: ['statut', 'rattachement'] } as any }], ctxOf()),
    await s.commands.markAbesSent([{ recordId: 105, hash: 'abc123' }], '2026-10-09', ctxOf()),
  ]],
  ['create a structure, then update it', async (s) => {
    const { id } = await s.commands.createStructure({ acronym: 'NEWLAB', officialName: 'Nouveau laboratoire', level: '4', type: 'UMR', nature: 'PUBLIC',
      parentStructure: 'LAB1', localId: 'U-NEWLAB' } as any, ctxOf());
    const created = (await s.repo.structures()).items.find((x) => x.id === id)!;
    await s.commands.updateStructure(Number(id.slice(2)), { ...created, type: 'EA', officialName: 'Laboratoire renommé', rorId: '05abcde67' } as any, ctxOf());
    return id;
  }],
  ['lab right: write inside its lab, refused outside', async (s, people) => {
    const r = people.find((p) => p.gristRowId === 105)!;
    const attempt = (p: Promise<unknown>) => p.then<string, string>(() => 'ok', (e) => `${e.status} ${e.message}`);
    const lab = (anchor: string) => ctxOf({ all: false, labAnchors: [anchor] });
    return [
      await attempt(s.commands.updatePerson(105, { ...r, email: 'lab2@example.org' } as any, lab('lab2'))),
      await attempt(s.commands.updatePerson(105, { ...r, email: 'nope@example.org' } as any, lab('lab1'))),
      await attempt(s.commands.createPerson({ ...r, uid: 'other-y', affiliations: [{ structureName: 'LAB1', isPrimary: true }] } as any, lab('lab2'))),
      await attempt(s.commands.setGroups([{ recordId: 101, groups: ['x'] }], lab('lab2'))),
    ];
  }],
];

describe.skipIf(!url)('DirectoryCommands contract: Grist = PostgreSQL', () => {
  it('the same commands leave the same directory', async () => {
    const dir = gristDirectoryFixture();
    const work = gristWorkFixture();
    const gristClient = memoryGrist({ Annuaire: dir.Annuaire!, Etablissements: dir.Etablissements!, Structures: dir.Structures!, Fusions_log: work.Fusions_log! });
    const gristRepo = createGristDirectoryRepository({ grist: gristClient });
    const grist: Store = { repo: gristRepo, commands: createGristDirectoryCommands({ grist: gristClient, repository: gristRepo, today: TODAY }) };
    const read = async (s: Store) => ({
      people: (await s.repo.people(ALL)).items.map((p) => ({ ...p, lastSync: '' })),
      structures: (await s.repo.structures()).items.filter((x) => !['S-13', 'S-14'].includes(x.id)), // rows the import leaves out
      merges: (await s.repo.merges(50)).items.map((m) => ({ ...m, date: m.date ? 'set' : '' })),
      abes: (await s.repo.abesExports(ALL)).items,
    });
    const directory = transformDirectory(dir);
    const results: { step: string; grist: unknown; pg: unknown; differences: string[] }[] = [];
    await expect(db!.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      await loadWork(trx, transformWork(work, directory.rows).rows);
      const pgRepo = createPgDirectoryRepository({ db: trx });
      // Given the test transaction, each command runs in a savepoint of it.
      const pg: Store = { repo: pgRepo, commands: createPgDirectoryCommands({ db: trx, repository: pgRepo, today: TODAY }) };
      for (const [name, step] of STEPS) {
        const [gristPeople, pgPeople] = [(await grist.repo.people(ALL)).items, (await pg.repo.people(ALL)).items];
        const run = (s: Store, people: Researcher[]) => step(s, people).catch((e) => `${e.status ?? ''} ${e.message}`);
        const [g, p] = [await run(grist, gristPeople), await run(pg, pgPeople)];
        // Accepted difference: PostgreSQL stores an identifier without the spaces typed around it (as the import does).
        const accepted = (d: string) => { const m = /\.identifiers\.\w+: "(.*)" ≠ "(.*)"$/.exec(d); return !!m && m[1].trim() === m[2]; };
        results.push({ step: name, grist: g, pg: p, differences: differences(await read(grist), await read(pg)).filter((d) => !accepted(d)) });
      }
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    if (process.env.CONTRACT_DEBUG) for (const r of results) console.log(JSON.stringify({ step: r.step, grist: r.grist, pg: r.pg, differences: r.differences.length }));
    for (const r of results) expect({ step: r.step, result: r.pg, differences: r.differences }).toEqual({ step: r.step, result: r.grist, differences: [] });
  });
});
