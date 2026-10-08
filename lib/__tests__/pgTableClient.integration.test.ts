// Contract of the PostgreSQL table view (druid-internal docs/plan-migration-postgresql.md, lot 6 f): what the jobs and
// the remaining reads of server.cjs do with the Grist tables — records and filters, read-only SQL, a record written
// with its sync traces, a review pushed then decided then purged, a structure added and patched, a task and its
// events — gives the same answers and leaves the same tables on the Grist document (in-memory Grist) and on
// PostgreSQL (the same fixture imported). Needs DATABASE_URL; run by the « database » CI job and `npm run test:db`.
// Rolled back: nothing is left in the database.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../db/client';
import type { GristClient } from '../directory/repository';
import { createPgTableClient, parseGristSql } from '../directory/pg/tableClient';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';
import { loadDirectory, loadWork } from '../migration/loadPg';
import { gristDirectoryFixture, row } from './fixtures/gristDirectory';
import { gristWorkFixture } from './fixtures/gristWork';
import { memoryGrist } from './fixtures/memoryGrist';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 60000 });
class Rollback extends Error {}

const differences = (a: unknown, b: unknown, path = ''): string[] => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])];
    return keys.flatMap((k) => differences((a as any)[k], (b as any)[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`));
  }
  return [`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
};
/** Empty cells ('' / null / 0 / false / absent) alike, keys sorted, the representations PostgreSQL normalizes aligned. */
const normalized = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(normalized);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v)
      .filter(([k]) => !['institution_identifier', 'Alignement_annuaire', 'manualSort'].includes(k))
      .map(([k, x]) => [k, k === 'Civilite' ? ({ MME: 'F', 'M.': 'M' } as Record<string, string>)[String(x).toUpperCase()] ?? x
        : k === 'validated_status' && ['INTERNE', 'EXTERNE'].includes(String(x)) ? 'PRESENT' : x])
      .filter(([, x]) => x !== '' && x !== null && x !== undefined && x !== 0 && x !== false)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalized(x)]));
  }
  return v;
};

// Single-row people of the directory fixture: 103 (no uid), 104 (ext_durand-c), 105 (Petit-D).
const RECORDS = [103, 104, 105];
type Step = (t: GristClient) => Promise<unknown>;
const STEPS: [string, Step][] = [
  ['reads: filters on id and uid, the employers, the structures, the tasks', async (t) => [
    await t.records('Annuaire', { uid_dyna: ['ext_durand-c'] }),
    await t.records('Annuaire', { id: [104, 105, 999] }),
    // The employers the import keeps (rows 3 and 5 of the fixture: a duplicated name, an empty row).
    (await t.records('Etablissements')).filter((r) => [1, 2, 4].includes(r.id)).map((r) => [r.id, r.fields.Employeur, r.fields.UAI || '', r.fields.Libelle || '']),
    (await t.records('Structures')).filter((r) => ![13, 14].includes(r.id)),
    await t.records('Taches', { uid_dyna: ['Petit-D'] }),
    await t.records('Taches_evenements', { tache: [1] }),
  ]],
  ['read-only SQL of server.cjs and of the commands', async (t) => [
    await t.sql('SELECT "LABO" AS v FROM "Annuaire" WHERE id = ?', [105]),
    await t.sql('SELECT "LABO" AS v FROM "Annuaire" WHERE "uid_dyna" = ?', ['ext_durand-c']),
    (await t.sql('SELECT * FROM "Annuaire" WHERE "uid_dyna" = ?', ['Petit-D'])).map((r) => ({ id: r.id, Nom: r.Nom, LABO: r.LABO, uid_dyna: r.uid_dyna })),
    (await t.sql('SELECT id, "Employeur", "Libelle" FROM "Etablissements"', [])).filter((r) => [1, 2, 4].includes(r.id)).map((r) => [r.id, r.Employeur, r.Libelle || '']),
    (await t.sql('SELECT uid_dyna AS uid, LABO AS labo FROM Annuaire', [])).filter((r) => RECORDS.length && ['ext_durand-c', 'Petit-D'].includes(r.uid)),
    await t.sql('SELECT id, LABO AS v FROM Annuaire WHERE id IN (?,?)', [104, 105]),
    await t.sql('SELECT id, cle, type, statut FROM "Taches" WHERE "uid_dyna" = ?', ['ext_durand-c']),
  ]],
  ['a sync job writes a record with its traces', async (t) => {
    await t.updateRecords('Annuaire', [{ id: 105, fields: {
      ORCID: '0000-0003-0000-0001', Data_source: 'ORCID', ORCID_derniere_maj: '2026-10-09', ORCID_champs_modifies: 'ORCID',
      Commentaires: '[2026-10-09] MAJ ORCID: ORCID',
    } }, { id: 104, fields: { IdHAL: 'chloe-durand', HAL_derniere_maj: '2026-10-09', HAL_champs_modifies: 'IdHAL', Commentaires: '[2026-10-09] MAJ HAL: IdHAL' } }]);
    return t.records('Annuaire', { id: [104, 105] });
  }],
  ['a review pushed, decided, then purged', async (t) => {
    const ids = await t.addRecords('Alignement_ORCID', [
      { fields: { uid_dyna: 'Petit-D', Annuaire_id: 105, ORCID_candidat: '0000-0003-0000-0028', Nom_annuaire: 'PETIT', Score: 'fort', Decision: 'À traiter', Pousse_le: '2026-10-09' } },
      { fields: { uid_dyna: 'ext_durand-c', Annuaire_id: 104, ORCID_candidat: '0000-0003-0000-0036', Nom_annuaire: 'DURAND Chloé', Score: 'moyen', Decision: 'À traiter', Pousse_le: '2026-10-09' } },
    ]);
    await t.updateRecords('Alignement_ORCID', [{ id: ids[0], fields: { Decision: 'Validé', Applique: true, Date_application: '2026-10-09', Note: 'ok' } }]);
    await t.deleteRecords('Alignement_ORCID', [ids[1]]);
    return (await t.records('Alignement_ORCID')).map((r) => [r.fields.uid_dyna, r.fields.ORCID_candidat, r.fields.Decision, r.fields.Note || '', !!r.fields.Applique, r.fields.Score || '']);
  }],
  ['a structure added and patched (LDAP structures job)', async (t) => {
    const [id] = await t.addRecords('Structures', [{ fields: { local_id: 'U-NEW', short_labels: 'NEW[fr]', long_labels: 'Nouvelle équipe[fr]', type: 'ER', generic_type: 'research_team', parent_structure: 'LAB1' } }]);
    await t.updateRecords('Structures', [{ id, fields: { supann_code_entite: 'U-NEW', long_labels: 'Équipe renommée[fr]' } }, { id: 10, fields: { url: 'https://lab1.example.org/new' } }]);
    return (await t.records('Structures', { local_id: ['U-NEW', 'U-LAB1'] })).filter((r) => r.id !== 13).map((r) => r.fields);
  }],
  ['tasks created by the detection job, verified, with their events', async (t) => {
    const ids = await t.addRecords('Taches', [{ fields: { cle: 'orcid_absent:Petit-D', type: 'orcid_absent', base: 'ORCID', canal: 'email_chercheur', titre: 'ORCID absent',
      chercheur: 105, uid_dyna: 'Petit-D', nom: 'PETIT', labo: 'LAB2', statut: 'a_faire', priorite: 'normale', origine: 'regle:orcid_absent', cree_par: 'job',
      cree_le: '2026-10-09T05:00:00.000Z' } }]);
    await t.addRecords('Taches_evenements', ids.map((id) => ({ fields: { tache: id, date: '2026-10-09T05:00:00.000Z', auteur: 'job', action: 'creation', detail: 'Détectée' } })));
    await t.updateRecords('Taches', [{ id: 1, fields: { verifie_le: '2026-10-09T05:00:00.000Z' } }]);
    return [await t.records('Taches', { id: [1, ...ids] }), await t.records('Taches_evenements', { tache: ids })];
  }],
];

describe('read-only SQL of the table view', () => {
  it('parses the queries of server.cjs and refuses the others', () => {
    expect(parseGristSql('SELECT uid_dyna AS uid, LABO AS labo FROM Annuaire')).toEqual({
      columns: [{ col: 'uid_dyna', alias: 'uid' }, { col: 'LABO', alias: 'labo' }], table: 'Annuaire', where: null,
    });
    expect(parseGristSql('SELECT * FROM "Annuaire" WHERE "uid_dyna" = ?')).toEqual({ columns: null, table: 'Annuaire', where: { col: 'uid_dyna', op: '=' } });
    expect(parseGristSql('SELECT id, LABO AS v FROM Annuaire WHERE id IN (?,?, ?)').where).toEqual({ col: 'id', op: 'IN' });
    expect(() => parseGristSql('SELECT count(*) FROM Annuaire')).toThrow(/not supported/);
    expect(() => parseGristSql('DELETE FROM Annuaire')).toThrow(/not supported/);
  });
});

describe.skipIf(!url)('Table view contract: Grist document = PostgreSQL', () => {
  it('the same table operations give the same answers and leave the same tables', async () => {
    const dir = gristDirectoryFixture();
    const work = gristWorkFixture();
    // Clean work tables naming the single-row people (the import cases of the shared fixture are tested elsewhere).
    work.Taches = [row(1, { cle: 'idref_ajouter_orcid:ext_durand-c', type: 'idref_ajouter_orcid', base: 'IdRef', canal: 'lot_abes', titre: 'Ajouter l’ORCID',
      chercheur: 104, uid_dyna: 'ext_durand-c', statut: 'a_faire', priorite: 'normale', origine: 'regle:idref_ajouter_orcid', cree_par: 'job',
      cree_le: '2026-10-01T05:00:00.000Z' })];
    work.Taches_evenements = [row(10, { tache: 1, date: '2026-10-01T05:00:00.000Z', auteur: 'job', action: 'creation', detail: 'Détectée' })];
    work.Alignement_ORCID = [];
    const grist = memoryGrist({
      Annuaire: dir.Annuaire!, Etablissements: dir.Etablissements!, Structures: dir.Structures!, Taches: work.Taches, Taches_evenements: work.Taches_evenements,
      Alignement_ORCID: [],
    });
    const directory = transformDirectory(dir);
    const results: { step: string; grist: unknown; pg: unknown }[] = [];
    let refusals: unknown[] = [];
    await expect(db!.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      await loadWork(trx, transformWork(work, directory.rows).rows);
      const pg = createPgTableClient({ db: trx, actor: 'contract' });
      for (const [name, step] of STEPS) {
        const run = (t: GristClient) => step(t).catch((e: any) => `${e.status ?? ''} ${e.message}`);
        results.push({ step: name, grist: normalized(await run(grist)), pg: normalized(await run(pg)) });
      }
      // A table that is not migrated, or a write it does not take: refused, never lost.
      const attempt = (p: Promise<unknown>) => p.then(() => 'ok', (e: any) => `${e.status} ${e.message}`);
      refusals = [
        await attempt(pg.records('Newsletter')),
        await attempt(pg.addRecords('Annuaire', [{ fields: { Nom: 'X' } }])),
        await attempt(pg.deleteRecords('Annuaire', [105])),
        await attempt(pg.sql('SELECT count(*) FROM Annuaire', [])),
        await attempt(pg.addColumns('Annuaire', [{ id: 'Nouvelle', fields: {} }])),
      ];
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    expect(results.map((r) => ({ step: r.step, differences: differences(r.grist, r.pg) })))
      .toEqual(results.map((r) => ({ step: r.step, differences: [] })));
    expect(refusals).toEqual([
      '404 Table not found on PostgreSQL: Newsletter',
      '501 Adding rows not supported on PostgreSQL for Annuaire',
      '501 Deleting rows not supported on PostgreSQL for Annuaire',
      expect.stringMatching(/^501 Query not supported/),
      'ok',
    ]);
  });
});
