// Grist → PostgreSQL import of the work tables (druid-internal docs/plan-migration-postgresql.md, lot 5 b), on the
// fictitious directory and work tables of fixtures/.
import { describe, expect, it } from 'vitest';
import { ISSUE_EXPLANATIONS, mergeReport, personUuid, transformDirectory } from '../migration/gristToPg';
import { isArbitrationTable, transformWork } from '../migration/gristToPgWork';
import { gristDirectoryFixture } from './fixtures/gristDirectory';
import { gristWorkFixture } from './fixtures/gristWork';

describe('Grist → PostgreSQL transformation of the work tables', () => {
  const directory = transformDirectory(gristDirectoryFixture(), () => '2026-10-09T00:00:00.000Z');
  const { rows, issues, source } = transformWork(gristWorkFixture(), directory.rows);
  const codes = (code: string) => issues.filter((i) => i.code === code);
  const alice = personUuid('u:dupont-a');
  const bob = directory.rows.person.find((p) => p.legacy_grist_id === 103)!.id;

  it('tasks: person by the chercheur reference only, defaults of an empty status, unknown values kept, duplicated keys', () => {
    expect(rows.task.map((t) => [t.legacy_grist_id, t.key, t.person_id, t.status, t.priority])).toEqual([
      [1, 'annuaire_ids_partages:dupont-a', alice, 'a_faire', 'normale'],
      [2, null, null, 'a_faire', 'normale'],
      [3, null, null, 'a_faire', 'normale'],
      [4, 'x:petit-d', null, 'fait', 'normale'], // uid only: no record, as in the application
    ]);
    expect(rows.task[1].extra).toEqual({ Champ_inconnu: 'x', fait_le: 'hier' });
    expect(rows.task[2].extra).toEqual({ cle: 'annuaire_ids_partages:dupont-a', chercheur: 999, statut: 'bizarre', priorite: 'urgente' });
    expect([rows.task[0].created_at, rows.task[0].verified_at, rows.task[1].done_at]).toEqual(['2026-10-01T05:00:00.000Z', '2026-10-08T05:00:00.000Z', null]);
    expect(codes('work_duplicate').map((i) => [i.table, i.rows])).toEqual([['Taches', [3]], ['Alignement_ORCID', [51]], ['BenchmarkPeerGroups', [91]]]);
    expect(codes('work_column_unmapped')).toEqual([{ code: 'work_column_unmapped', table: 'Taches', rows: [2], columns: ['Champ_inconnu'] }]);
  });

  it('task events follow their task, orphans are reported', () => {
    expect(rows.task_event.map((e) => [e.legacy_grist_id, e.$task, e.action])).toEqual([[10, 1, 'creation'], [11, 2, 'creation']]);
    expect(codes('work_orphan').map((i) => [i.table, i.rows])).toEqual([['Taches_evenements', [12]], ['Rapports_partages', [71]]]);
  });

  it('merge log: people of the kept and restored rows, parsed snapshots, unreadable values kept', () => {
    const [a, b] = rows.merge_log;
    expect([a.kept_person_id, a.dropped_snapshot, a.kept_patch, a.merged_at, a.extra]).toEqual([alice, { Nom: 'Dupont', LABO: 'LAB1' }, { Email: 'a@x' }, '2026-09-09T10:00:00.000Z', { Nom: 'Dupont' }]);
    expect([b.kept_person_id, b.dropped_snapshot, b.merged_at, b.restored, b.restored_person_id, b.legacy_restored_rowid])
      .toEqual([null, {}, null, true, personUuid('u:ext_durand-c'), 104]);
    expect(b.extra).toEqual({ dropped_json: '{oops', date: 'not a date' });
  });

  it('alignment reviews: person by Annuaire_id or uid (g<row> too), payload, dates', () => {
    expect(rows.alignment_candidate.map((a) => [a.legacy_grist_id, a.person_id, a.source, a.candidate_id, a.decision, a.pushed_on, a.applied, a.applied_on])).toEqual([
      [30, alice, 'idref', '000000035', 'Rejeté', '2026-09-11', false, null],
      [31, bob, 'idref', '000000043', 'Validé', null, true, '2026-09-12'],
      [40, alice, 'hal', 'alice-dupont', 'Identité mêlée', '2026-09-20', false, null],
      [50, alice, 'orcid', '0000-0002-0000-0002', 'Rejeté', null, false, null],
    ]);
    expect([rows.alignment_candidate[0].payload, rows.alignment_candidate[2].payload, rows.alignment_candidate[3].payload])
      .toEqual([{ Nom_notice: 'Dupont, A.' }, { Score: 'fort' }, { Pousse_le: 'n/a' }]);
    expect(codes('work_person_by_uid').map((i) => i.rows)).toEqual([[30], [31]]);
    expect(codes('work_person_unresolved').map((i) => [i.table, i.rows])).toEqual([
      ['Taches', [3]], ['Fusions_log', [21]], ['Alignement_IdRef', [32]], ['Arbitrage_Centrale_2026_09', [2]],
    ]);
  });

  it('arbitrations: one batch per table, rows with their person and typed value', () => {
    expect(rows.import_batch).toEqual([{ legacy_table: 'Arbitrage_Centrale_2026_09', source: 'Centrale', label: '2026-09' }]);
    expect(rows.import_row.map((r) => [r.legacy_grist_id, r.person_id, r.field, r.imported_json, r.choice, r.resolved_at])).toEqual([
      [1, alice, 'Email', 'b@x', 'Import', '2026-09-30T10:00:00.000Z'], [2, null, 'ORCID', null, null, null],
    ]);
    expect(rows.import_row[1].extra).toEqual({ Fiche: 555, Valeur_importee_json: '{bad' });
    expect([isArbitrationTable('Arbitrage_DRPI_2026_07'), isArbitrationTable('Arbitrage'), isArbitrationTable('Annuaire')]).toEqual([true, false, false]);
  });

  it('reports, shares, generations and peer lists', () => {
    expect(rows.report.map((r) => [r.legacy_grist_id, r.definition, r.deleted_at, r.extra])).toEqual([
      [60, { schemaVersion: 1, blocks: [] }, null, {}], [61, {}, '2026-09-30T10:00:00.000Z', { definition: 'not json' }],
    ]);
    expect(rows.report_share.map((s) => [s.$report, s.grantee, s.role])).toEqual([[60, 'bob', 'editor']]);
    expect(rows.report_generation.map((g) => [g.$report, g.definition_snapshot, g.ai_texts, g.publication_count, g.shared_frozen])).toEqual([[60, { schemaVersion: 1 }, null, 42, true]]);
    expect(rows.benchmark_peer_group.map((g) => [g.owner, g.name, g.rors])).toEqual([['alice', 'Pairs', ['https://ror.org/a', 'https://ror.org/b']]]);
  });

  it('report: sources, missing tables, every case explained', () => {
    expect(source).toMatchObject({ Taches: 4, Alignement_Scopus: 0, Arbitrage_Centrale_2026_09: 2 });
    expect(codes('table_missing').map((i) => i.table)).toEqual(['Alignement_Scopus']);
    const merged = mergeReport(directory.report, { issues, source, counts: { task: rows.task.length } });
    expect(merged.counts).toMatchObject({ person: 4, task: 4 });
    expect(merged.issues.every((i) => i.code in ISSUE_EXPLANATIONS)).toBe(true);
    expect(JSON.stringify(merged)).not.toMatch(/Dupont|DUPONT|alice-dupont|a@x|b@x/);
  });
});
