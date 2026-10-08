// Contract of the work tables (druid-internal docs/plan-migration-postgresql.md, lot 6 e): the services of the
// « À traiter » routes (scripts/lib/work_services.cjs) and the reports store (scripts/lib/reports_store.cjs), run on
// their Grist ports (scripts/lib/work_grist.cjs, in-memory Grist) and on their PostgreSQL ports (lib/work/pg, the same
// fixture imported), give the same answers and leave the same tasks, arbitrations, records, peer lists and reports.
// Needs DATABASE_URL (druid_owner: the import empties tables); run by the « database » CI job and `npm run test:db`.
// Rolled back: nothing is left in the database.
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../db/client';
import { createGristDirectoryRepository, type DirectoryRepository } from '../directory/repository';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { createPgWorkPorts } from '../work/pg/workPorts';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';
import { loadDirectory, loadWork } from '../migration/loadPg';
import { gristDirectoryFixture, row } from './fixtures/gristDirectory';
import { gristWorkFixture } from './fixtures/gristWork';
import { memoryGrist } from './fixtures/memoryGrist';

const require = createRequire(import.meta.url);
const { createTasksService, createConflictsService } = require('../../scripts/lib/work_services.cjs');
const { gristWorkPorts } = require('../../scripts/lib/work_grist.cjs');
const { createReportsStore, routeReports } = require('../../scripts/lib/reports_store.cjs');

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
/**
 * The representations that differ by nature are brought to the same form: an empty cell ('' / null / absent) and the
 * key order of a JSON value (PostgreSQL jsonb orders the keys).
 */
const normalized = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(normalized);
  if (v instanceof Map) return normalized(Object.fromEntries(v));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== null && x !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalized(x)]));
  }
  return v;
};
/** Record fields compared between the stores (same rules as the commands contract). */
const recordView = (rows: { rowId: number; fields: Record<string, any> }[]) => rows.map((r) => ({
  rowId: r.rowId,
  fields: Object.fromEntries(Object.entries(r.fields)
    .filter(([k]) => !['institution_identifier', 'Alignement_annuaire'].includes(k))
    .map(([k, v]) => [k, k === 'Civilite' ? ({ MME: 'F', 'M.': 'M' } as Record<string, string>)[String(v).toUpperCase()] ?? v
      : k === 'validated_status' && ['INTERNE', 'EXTERNE'].includes(String(v)) ? 'PRESENT' : typeof v === 'string' ? v.trim() : v ?? ''])
    .filter(([, v]) => v !== '' && v !== null && v !== 0 && v !== false)
    .sort(([a], [b]) => a.localeCompare(b))),
}));

/** A clock that moves one second per reading, the same on both stores (they read it as many times). */
const clock = () => {
  let t = Date.parse('2026-10-09T08:00:00.000Z');
  return () => new Date((t += 1000));
};
const epoch = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

// Work tables of this test, clean (the import cases of the shared fixture are tested by gristToPgWork), naming the
// single-row people of the directory fixture (103: no uid, 104: ext_durand-c, 105: Petit-D).
const WORK = () => ({
  ...gristWorkFixture(),
  Taches: [
    row(1, { cle: 'idref_ajouter_orcid:ext_durand-c', type: 'idref_ajouter_orcid', base: 'IdRef', canal: 'lot_abes', titre: 'Ajouter l’ORCID',
      chercheur: 104, uid_dyna: 'ext_durand-c', nom: 'DURAND Chloé', statut: 'a_faire', priorite: 'normale', origine: 'regle:idref_ajouter_orcid',
      cree_par: 'job', cree_le: '2026-10-01T05:00:00.000Z' }),
    row(2, { cle: '', type: 'autre', titre: 'Tâche manuelle', chercheur: 105, uid_dyna: 'Petit-D', statut: 'en_cours', priorite: 'haute',
      origine: 'manuel', cree_par: 'alice', cree_le: '2026-10-02T09:00:00.000Z', pris_par: 'alice', pris_le: '2026-10-02T10:00:00.000Z',
      description: 'À voir' }),
    row(3, { cle: '', type: 'orcid_absent', base: 'ORCID', canal: 'email_chercheur', titre: 'Sans fiche', chercheur: 0, statut: 'fait',
      priorite: 'basse', origine: 'manuel', cree_par: 'bob', cree_le: '2026-10-03T09:00:00.000Z', fait_par: 'bob', fait_le: '2026-10-04T09:00:00.000Z',
      resolution: 'Réglé' }),
  ],
  Taches_evenements: [
    row(10, { tache: 1, date: '2026-10-01T05:00:00.000Z', auteur: 'job', action: 'creation', detail: 'Détectée' }),
    row(11, { tache: 2, date: '2026-10-02T09:00:00.000Z', auteur: 'alice', action: 'creation', detail: 'Tâche manuelle' }),
    row(12, { tache: 2, date: '2026-10-02T10:00:00.000Z', auteur: 'alice', action: 'prise_en_charge', detail: '' }),
  ],
  Rapports: [
    row(60, { owner: 'alice', name: 'Mon rapport', description: '', template_id: '', visibility: 'private', deleted_at: '', published_template: false,
      definition: JSON.stringify({ schemaVersion: 1, name: 'Mon rapport', description: '', context: { slug: 'lab1' }, blocks: [{ id: 'b1', kind: 'kpi' }] }),
      created_at: '2026-09-28T10:00:00.000Z', updated_at: '2026-09-28T11:00:00.000Z' }),
    row(61, { owner: 'bob', name: 'Pour tous', description: 'Partagé', template_id: 'collab', visibility: 'instance', deleted_at: '', published_template: false,
      definition: JSON.stringify({ schemaVersion: 1, name: 'Pour tous', description: 'Partagé', context: { slug: 'lab2' }, blocks: [] }),
      created_at: '2026-09-29T10:00:00.000Z', updated_at: '2026-09-29T10:00:00.000Z' }),
  ],
  Rapports_partages: [row(70, { report: 60, grantee: 'bob', role: 'editor', granted_by: 'alice', granted_at: '2026-09-28T12:00:00.000Z' })],
  Rapports_generations: [
    row(80, { report: 60, generated_at: '2026-09-28T12:00:00.000Z', generated_by: 'alice', definition_snapshot: '{"schemaVersion":1,"blocks":[]}',
      publication_count: 42, data_date: '2026-09-27', ai_texts: '{"b1":"Texte"}', pdf_ref: '', shared_frozen: true }),
  ],
  BenchmarkPeerGroups: [row(90, { owner: 'alice', name: 'Pairs', rors: '["https://ror.org/a","https://ror.org/b"]', updated_at: '2026-09-01T00:00:00.000Z' })],
  arbitrations: {
    Arbitrage_Centrale_2026_09: [
      row(1, { Fiche: 104, Personne: 'DURAND Chloé', Labo: '', Famille: 'RH', Champ: 'Email', Valeur_actuelle: '', Valeur_importee: 'c@example.org',
        Valeur_importee_json: '"c@example.org"', Remarque: '' }),
      row(2, { Fiche: 104, Personne: 'DURAND Chloé', Famille: 'RH', Champ: 'Employeur', Valeur_actuelle: '', Valeur_importee: 'CNRS', Valeur_importee_json: '2' }),
      row(3, { Fiche: 105, Personne: 'PETIT', Famille: 'RH', Champ: 'DATE_DE_NAISSANCE_JJ_MM_AAAA', Valeur_actuelle: '', Valeur_importee: '01/02/1970',
        Valeur_importee_json: String(epoch('1970-02-01')) }),
      row(4, { Fiche: 105, Personne: 'PETIT', Famille: 'Identifiant', Champ: 'ORCID', Valeur_actuelle: '', Valeur_importee: '0000-0003-0000-0001',
        Valeur_importee_json: '"0000-0003-0000-0001"' }),
      row(5, { Fiche: 103, Personne: 'MARTIN Bob', Famille: 'Lien', Champ: 'Site_web', Valeur_actuelle: '', Valeur_importee: 'https://bob.example.org',
        Valeur_importee_json: '"https://bob.example.org"' }),
      row(6, { Fiche: 103, Personne: 'MARTIN Bob', Famille: 'RH', Champ: 'Nom', Valeur_actuelle: 'Martin', Valeur_importee: 'MARTIN',
        Valeur_importee_json: '"MARTIN"' }), // live value equal to the imported one: nothing to decide
      row(7, { Fiche: 104, Personne: 'DURAND Chloé', Famille: 'RH', Champ: 'Nationalite', Valeur_actuelle: '', Valeur_importee: 'FR',
        Valeur_importee_json: '"FR"', Choix: 'Import', Resolu_le: '2026-09-30T10:00:00.000Z', Resolu_par: 'alice' }),
    ],
  },
});

interface Store {
  tasks: any; conflicts: any; peerGroups: any; reports: any; repo: DirectoryRepository;
}
const alice = { id: 'alice', isSuperAdmin: false };
const bob = { id: 'bob', isSuperAdmin: false };
const admin = { id: 'root', isSuperAdmin: true };
const attempt = (p: Promise<unknown>) => p.catch((e: any) => `${e.status ?? ''} ${e.message}`);
const route = (s: Store, user: unknown, method: string, path: string, body?: unknown) =>
  routeReports(s.reports, user, { method, segments: path.split('/'), body }).then((x: any) => [x.status, x.body]);
const definition = (name: string, slug = 'lab1') => ({ schemaVersion: 1, name, description: '', context: { slug }, blocks: [{ id: 'b1', kind: 'kpi' }] });

type Step = (s: Store) => Promise<unknown>;
const STEPS: [string, Step][] = [
  ['tasks: create, edit, reassign, refusals', async (s) => [
    await s.tasks.create({ type: 'orcid_absent', chercheurRowId: 104, uid_dyna: 'ext_durand-c', nom: 'DURAND Chloé', labo: '', description: 'Écrire' }, 'alice'),
    await s.tasks.patch(2, { assignee: 'bob' }, 'alice'),
    await s.tasks.patch(2, { priorite: 'basse', titre: 'Renommée', lien: 'https://x.example.org' }, 'alice'),
    await attempt(s.tasks.create({ type: 'nope' }, 'alice')),
    await attempt(s.tasks.patch(999, { assignee: 'x' }, 'alice')),
    await attempt(s.tasks.patch(2, {}, 'alice')),
  ]],
  ['tasks: workflow (take, wait, done, reopen) and refusals', async (s) => [
    await s.tasks.transition(1, { statut: 'en_cours' }, 'bob'),
    await s.tasks.transition(1, { statut: 'en_attente', motif: 'Réponse ABES' }, 'bob'),
    await s.tasks.transition(2, { statut: 'fait', resolution: 'OK' }, 'alice'),
    await s.tasks.transition(3, { statut: 'a_faire', motif: 'Rouverte' }, 'alice'),
    await attempt(s.tasks.transition(2, { statut: 'en_cours' }, 'alice')),
    await attempt(s.tasks.transition(1, { statut: 'nowhere' }, 'alice')),
  ]],
  ['tasks: events (comment, email), refusals, ABES export sent', async (s) => [
    await s.tasks.addEvent(1, { action: 'commentaire', detail: '  Relancé  ' }, 'bob'),
    await s.tasks.addEvent(3, { action: 'email_prepare', detail: '' }, 'alice'),
    await attempt(s.tasks.addEvent(1, { action: 'commentaire', detail: ' ' }, 'bob')),
    await attempt(s.tasks.addEvent(1, { action: 'supprimer' }, 'bob')),
    await attempt(s.tasks.addEvent(999, { action: 'commentaire', detail: 'x' }, 'bob')),
    await s.tasks.abesSent({ date: '2026-10-09', items: [{ rowId: 104, uid: 'ext_durand-c', types: ['idref_ajouter_orcid'] }] }, 'alice'),
    await s.tasks.abesSent({ items: [{ rowId: 104, types: ['idref_ajouter_orcid'] }] }, 'alice'),
  ]],
  ['tasks: suggestion of a record (created, dismissed), tasks of a uid', async (s) => [
    await s.tasks.insert({ cle: 'suggestion:orcid_ajouter_poste:Petit-D', type: 'orcid_ajouter_poste', base: 'ORCID', canal: 'email_chercheur', titre: 'Poste',
      chercheur: 105, uid_dyna: 'Petit-D', nom: 'PETIT', statut: 'abandonnee', priorite: 'normale', origine: 'suggestion:orcid_ajouter_poste',
      cree_par: 'alice', cree_le: '2026-10-09T09:00:00.000Z', fait_par: 'alice', fait_le: '2026-10-09T09:00:00.000Z', resolution: 'Masquée' },
    [{ date: '2026-10-09T09:00:00.000Z', auteur: 'alice', action: 'creation', detail: 'Suggestion' },
      { date: '2026-10-09T09:00:00.000Z', auteur: 'alice', action: 'abandon', detail: 'Masquée' }]),
    await s.tasks.ofUid('Petit-D'),
    await s.tasks.ofUid('nobody'),
  ]],
  ['import conflicts: list, resolve (import, current, other: employer, date, link), refusals', async (s) => [
    await s.conflicts.tables(),
    await s.conflicts.conflicts('Arbitrage_Centrale_2026_09'),
    await attempt(s.conflicts.conflicts('Arbitrage_Inconnu')),
    await attempt(s.conflicts.conflicts('Annuaire')),
    await attempt(s.conflicts.resolve('Arbitrage_Centrale_2026_09', [{ id: 2, choice: 'other', value: 'Nulle part' }], 'alice')),
    await attempt(s.conflicts.resolve('Arbitrage_Centrale_2026_09', [{ id: 3, choice: 'other', value: '31/02/1970' }], 'alice')),
    await attempt(s.conflicts.resolve('Arbitrage_Centrale_2026_09', [{ id: 7, choice: 'import' }], 'alice')),
    await attempt(s.conflicts.resolve('Arbitrage_Centrale_2026_09', [], 'alice')),
    await s.conflicts.resolve('Arbitrage_Centrale_2026_09', [
      { id: 1, choice: 'import' }, { id: 2, choice: 'other', value: 'inserm' }, { id: 3, choice: 'other', value: '1970-03-04' },
      { id: 4, choice: 'current' }, { id: 5, choice: 'import' },
    ], 'alice'),
    await s.conflicts.tables(),
  ]],
  ['peer lists: save, save again under the same name, remove (another owner refused)', async (s) => [
    await s.peerGroups.save('alice', 'Grandes écoles', ['https://ror.org/c']),
    await s.peerGroups.save('alice', 'Pairs', ['https://ror.org/d']),
    await s.peerGroups.save('bob', 'Pairs', ['https://ror.org/e']),
    await s.peerGroups.remove('bob', 90),
    await s.peerGroups.remove('alice', 90),
    await s.peerGroups.remove('alice', 90),
  ]],
  ['reports: create, update (and a stale one), share, generations, duplicate, delete, refusals', async (s) => {
    const out: unknown[] = [];
    const [, created] = await route(s, alice, 'POST', '', { definition: definition('Nouveau'), visibility: 'private' }) as [number, any];
    const id = created.report.id;
    out.push(created);
    const [, got] = await route(s, alice, 'GET', String(id)) as [number, any];
    out.push(await route(s, alice, 'PATCH', String(id), { definition: definition('Renommé'), expectedUpdatedAt: got.report.updatedAt }));
    out.push(await route(s, alice, 'PATCH', String(id), { definition: definition('Trop tard'), expectedUpdatedAt: got.report.updatedAt }));
    out.push(await route(s, alice, 'POST', `${id}/shares`, { shares: [{ grantee: 'Bob', role: 'viewer' }, { grantee: 'carol', role: 'editor' }] }));
    out.push(await route(s, alice, 'POST', '60/shares', { shares: [{ grantee: 'bob', role: 'viewer' }] }));
    out.push(await route(s, bob, 'GET', String(id)));
    out.push(await route(s, bob, 'PATCH', String(id), { definition: definition('Par Bob') }));
    out.push(await route(s, bob, 'POST', `${id}/generations`, { definitionSnapshot: { b: 1, a: [2] }, publicationCount: 7, dataDate: '2026-10-08', aiTexts: null }));
    out.push(await route(s, alice, 'GET', `${id}/generations`));
    out.push(await route(s, alice, 'PATCH', '60/generations/80', { sharedFrozen: false }));
    out.push(await route(s, bob, 'GET', '60/generations'));
    out.push(await route(s, bob, 'POST', '61/duplicate', { name: 'Copie' }));
    out.push(await route(s, admin, 'PATCH', '61', { visibility: 'private', publishedTemplate: true }));
    out.push(await route(s, bob, 'POST', '60/delete'));
    out.push(await route(s, alice, 'POST', '60/delete'));
    out.push(await route(s, alice, 'GET', '60'));
    out.push(await route(s, bob, 'GET', '999'));
    return out;
  }],
];

describe.skipIf(!url)('Work tables contract: Grist = PostgreSQL', () => {
  it('the same services leave the same tasks, arbitrations, records, peer lists and reports', async () => {
    const dir = gristDirectoryFixture();
    const work = WORK();
    const tables = {
      Annuaire: dir.Annuaire!, Etablissements: dir.Etablissements!, Structures: dir.Structures!,
      Taches: work.Taches!, Taches_evenements: work.Taches_evenements!, Rapports: work.Rapports!, Rapports_partages: work.Rapports_partages!,
      Rapports_generations: work.Rapports_generations!, BenchmarkPeerGroups: work.BenchmarkPeerGroups!, ...work.arbitrations,
    };
    const gristClient = memoryGrist(tables);
    const store = (ports: any, repo: DirectoryRepository): Store => {
      const now = clock();
      return {
        tasks: createTasksService(ports.tasks, { now }), conflicts: createConflictsService(ports.conflicts, { now }),
        peerGroups: ports.peerGroups, reports: createReportsStore(ports.reports, { now }), repo,
      };
    };
    const grist = store(gristWorkPorts(gristClient, { key: 'contract', now: clock() }), createGristDirectoryRepository({ grist: gristClient }));
    const read = async (s: Store) => {
      const tasks = await s.tasks.list();
      const events: Record<number, unknown> = {};
      for (const t of tasks) events[t.id] = await s.tasks.events(t.id);
      const reports: Record<string, unknown> = {};
      for (const user of [alice, bob, admin]) {
        const [, list] = await route(s, user, 'GET', '') as [number, any];
        reports[user.id] = list;
        for (const r of [...list.mine, ...list.shared, ...list.instance]) {
          reports[`${user.id}:${r.id}`] = [await route(s, user, 'GET', String(r.id)), await route(s, user, 'GET', `${r.id}/generations`)];
        }
      }
      return normalized({
        tasks, events, reports,
        conflicts: await Promise.all((await s.conflicts.tables()).map(async (t: any) => [t, await s.conflicts.conflicts(t.id)])),
        peers: { alice: await s.peerGroups.list('alice'), bob: await s.peerGroups.list('bob') },
        records: recordView(await s.repo.recordRows([103, 104, 105], { all: true, labAnchors: [] })),
      });
    };
    const directory = transformDirectory(dir);
    const results: { step: string; grist: unknown; pg: unknown; differences: string[] }[] = [];
    await expect(db!.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      const imported = transformWork(work, directory.rows);
      await loadWork(trx, imported.rows);
      // Given the test transaction, each write runs in a savepoint of it.
      const pg = store(createPgWorkPorts({ db: trx, actor: 'contract', now: clock() }), createPgDirectoryRepository({ db: trx }));
      // The work tables of this test import without any issue (the other tables of the shared fixture have theirs).
      const ours = (t: string) => /^(Taches|Rapports|BenchmarkPeerGroups|Arbitrage_)/.test(t);
      results.push({ step: 'import', grist: imported.issues.filter((i) => ours(i.table)), pg: [], differences: differences(await read(grist), await read(pg)) });
      for (const [name, step] of STEPS) {
        const run = (s: Store) => step(s).catch((e: any) => `${e.status ?? ''} ${e.message}`);
        const [g, p] = [normalized(await run(grist)), normalized(await run(pg))];
        results.push({ step: name, grist: g, pg: p, differences: differences(await read(grist), await read(pg)) });
      }
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    if (process.env.CONTRACT_DEBUG) for (const r of results) console.log(JSON.stringify({ step: r.step, result: differences(r.grist, r.pg), differences: r.differences }));
    for (const r of results) expect({ step: r.step, result: r.pg, differences: r.differences }).toEqual({ step: r.step, result: r.grist, differences: [] });
  });
});
