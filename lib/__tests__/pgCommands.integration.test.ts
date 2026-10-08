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
import { gristDirectoryFixture, row } from './fixtures/gristDirectory';
import { gristWorkFixture } from './fixtures/gristWork';
import { memoryGrist } from './fixtures/memoryGrist';
import { buildMergeProposal, pickDefaultKeep, resolveMergeFields } from '../mergeProposal';

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

/**
 * Record fields compared between the stores: the representations PostgreSQL normalizes are brought to the same form
 * (an empty text cell '' or null, a civility « Mme » / « M. », a legacy validated status, the Grist formula columns).
 */
const normalizedRows = (rows: { rowId: number; fields: Record<string, any> }[]) => rows.map((r) => ({
  rowId: r.rowId,
  fields: Object.fromEntries(Object.entries(r.fields)
    .filter(([k]) => !['institution_identifier', 'Alignement_annuaire'].includes(k))
    .map(([k, v]) => [k, k === 'Civilite' ? ({ MME: 'F', 'M.': 'M' } as Record<string, string>)[String(v).toUpperCase()] ?? v
      : k === 'validated_status' && ['INTERNE', 'EXTERNE'].includes(String(v)) ? 'PRESENT'
        : typeof v === 'string' ? v.trim() : v ?? ''])
    .filter(([, v]) => v !== '' && v !== null && v !== 0 && v !== false)
    .sort(([a], [b]) => a.localeCompare(b))),
}));
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
  // ── Duplicates and merges (lot 6 c) ──
  ['qualify concomitant, unqualify, qualify successive with an end, then « à revoir »', async (s) => [
    await s.commands.qualifyDuplicates({ rowIds: [110, 111], principalRowId: 110, mode: 'concomitant', author: 'alice' }, ctxOf()),
    await s.commands.unqualifyDuplicates([110, 111], ctxOf()),
    await s.commands.qualifyDuplicates({ rowIds: [110, 111], principalRowId: 110, mode: 'successif', endDate: '2025-06', author: 'alice' }, ctxOf()),
    await s.commands.qualifyDuplicates({ rowIds: [110, 111], mode: 'a_revoir', author: 'bob' }, ctxOf()),
    await s.commands.qualifyDuplicates({ rowIds: [110, 111], mode: 'concomitant', author: 'bob' }, ctxOf()).catch((e) => `${e.status} ${e.message}`),
  ]],
  ['uid switch: refused onto a uid in use, then done', async (s) => [
    await s.commands.switchUid({ fromUid: 'ext_durand-c', toUid: 'dupont-a', author: 'alice' }, ctxOf()).catch((e) => `${e.status} ${e.message}`),
    await s.commands.switchUid({ fromUid: 'ext_durand-c', toUid: 'durand-c', author: 'alice' }, ctxOf()),
    await s.commands.switchUid({ fromUid: 'nobody', toUid: 'nobody-2', author: 'alice' }, ctxOf()).catch((e) => `${e.status} ${e.message}`),
  ]],
  ['merge the duplicate row as the assistant does (proposal → patch), then restore it', async (s) => {
    await s.commands.unqualifyDuplicates([110, 111], ctxOf());
    const rows = await s.repo.recordRows([110, 111], ALL);
    const columns = await s.commands.annuaireColumns();
    const { keep, drop } = pickDefaultKeep(rows[0], rows[1]);
    const fields = resolveMergeFields(buildMergeProposal(keep, drop, columns as any), '2026-10-09');
    const { logId } = await s.commands.mergeRows({ keepRowId: keep.rowId, dropRowId: drop.rowId, fields, author: 'alice', note: 'contrat' }, ctxOf());
    const restored = await s.commands.restoreMerge(logId, ctxOf());
    const again = await s.commands.restoreMerge(logId, ctxOf()).catch((e) => `${e.status} ${e.message}`);
    return { keep: keep.rowId, drop: drop.rowId, patch: Object.keys(fields).sort(), logId, restored, again };
  }],
  ['merge two different people (the absorbed person goes), refusals', async (s) => [
    await s.commands.mergeRows({ keepRowId: 104, dropRowId: 103, fields: { Email: 'merged@example.org' }, author: 'alice' }, ctxOf()),
    await s.commands.mergeRows({ keepRowId: 104, dropRowId: 104, fields: {}, author: 'alice' }, ctxOf()).catch((e) => `${e.status} ${e.message}`),
    await s.commands.mergeRows({ keepRowId: 104, dropRowId: 9999, fields: {}, author: 'alice' }, ctxOf()).catch((e) => `${e.status} ${e.message}`),
    await s.commands.restoreMerge(9999, ctxOf()).catch((e) => `${e.status} ${e.message}`),
  ]],
  ['merge where the kept row takes the uid and the ORCID of the absorbed person', async (s) => [
    await s.commands.mergeRows({ keepRowId: 105, dropRowId: 104, fields: { uid_dyna: 'durand-c', ORCID: '0000-0003-0000-0001' }, author: 'alice' }, ctxOf()),
  ]],
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
    // A duplicate group of this test only: two rows of « twin-t » with the same personal fields (the realistic
    // duplicate; rows whose personal fields diverge are one person in PostgreSQL — documented, not a contract case).
    const twin = { uid_dyna: 'twin-t', Nom: 'Jumeau', Prenom: 'Tom', Civilite: 'M', Email: 't@example.org', Employeur: 1, Data_source: 'LDAP',
      Commentaires: 'Ligne jumelle', ORCID: '0000-0005-0000-0009', employment_start_date: '2020', ANNEE_HDR: '' };
    dir.Annuaire!.push(row(110, { ...twin, LABO: 'LAB1', team: '' }), row(111, { ...twin, LABO: 'zzz', team: '' }));
    const work = gristWorkFixture();
    const gristClient = memoryGrist({ Annuaire: dir.Annuaire!, Etablissements: dir.Etablissements!, Structures: dir.Structures!, Fusions_log: work.Fusions_log! });
    const gristRepo = createGristDirectoryRepository({ grist: gristClient });
    const grist: Store = { repo: gristRepo, commands: createGristDirectoryCommands({ grist: gristClient, repository: gristRepo, today: TODAY }) };
    const read = async (s: Store) => ({
      people: (await s.repo.people(ALL)).items.map((p) => ({ ...p, lastSync: '' })),
      structures: (await s.repo.structures()).items.filter((x) => !['S-13', 'S-14'].includes(x.id)), // rows the import leaves out
      merges: (await s.repo.merges(50)).items.map((m) => ({ ...m, date: m.date ? 'set' : '' })),
      abes: (await s.repo.abesExports(ALL)).items,
      // The 101 / 102 group of the fixture has personal fields that diverge on purpose (one person in PostgreSQL).
      duplicates: (await s.repo.duplicates(ALL)).doublonsUid.filter((g) => g.uid !== 'dupont-a'),
      // Row 107 (a membership added to that group) is a second Grist row carrying a partial identity.
      rows: normalizedRows(await s.repo.recordRows([103, 104, 105, 106, 110, 111, 112], ALL)),
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

describe.skipIf(!url)('PostgreSQL commands: what differs from Grist by design', () => {
  it('a record created with a uid already in the directory is a new membership of that person', async () => {
    const dir = gristDirectoryFixture();
    const directory = transformDirectory(dir);
    const got: Record<string, unknown> = {};
    await expect(db!.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      const repo = createPgDirectoryRepository({ db: trx });
      const commands = createPgDirectoryCommands({ db: trx, repository: repo, today: TODAY });
      const { recordId } = await commands.createPerson({
        uid: 'petit-d', lastName: 'Autre', firstName: 'Saisie', affiliations: [{ structureName: 'zzz', isPrimary: true }],
        employment: {}, identifiers: {}, socials: {}, profiles: {}, validation: { validated: false, validationScope: [] },
      } as any, ctxOf());
      got.people = (await sql<{ uid: string; last_name: string; n: string }>`SELECT p.uid, p.last_name, count(m.id)::text AS n FROM person p
        JOIN membership m ON m.person_id = p.id WHERE lower(p.uid) = 'petit-d' GROUP BY p.uid, p.last_name`.execute(trx)).rows;
      got.group = (await repo.duplicates(ALL)).doublonsUid.find((g) => g.uid === 'Petit-D')?.rows.map((r) => [r.gristRowId, r.labo]);
      got.recordId = recordId;
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);
    // One person (its fields unchanged), two memberships: a duplicate group to qualify or merge on the Doublons page.
    expect(got.people).toEqual([{ uid: 'Petit-D', last_name: 'Petit', n: '2' }]);
    expect(got.group).toEqual([[105, 'LAB2'], [got.recordId, 'zzz']]);
  });
});
