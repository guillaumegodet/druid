// Grist → PostgreSQL import, transformation (druid-internal docs/plan-migration-postgresql.md, lot 5): fictitious
// directory exercising each case of the lot 0 mapping and of the migration report.
import { describe, expect, it } from 'vitest';
import { ISSUE_EXPLANATIONS, keptRow, personKey, personUuid, reportMarkdown, transformDirectory } from '../migration/gristToPg';
import { gristDirectoryFixture as fixture, row } from './fixtures/gristDirectory';

describe('Grist → PostgreSQL transformation', () => {
  const { rows, report } = transformDirectory(fixture(), () => '2026-10-09T00:00:00.000Z');
  const codes = (code: string) => report.issues.filter((i) => i.code === code);
  const person = (uid: string | null, legacy?: number) => rows.person.find((p) => (uid ? p.uid === uid : p.legacy_grist_id === legacy))!;

  it('establishments: duplicates resolved, the first row kept', () => {
    expect(rows.establishment.map((e) => [e.legacy_grist_id, e.name, e.uai])).toEqual([[1, 'NANTES UNIVERSITE', '0442953W'], [2, 'CNRS', '0753639Y'], [4, 'INSERM', null]]);
    expect(rows.establishment[1].extra).toEqual({ commentaire: 'national' });
    expect(rows.establishment[2].extra).toEqual({ UAI: '0753639Y' });
    expect([codes('establishment_duplicate_name').length, codes('establishment_duplicate_uai').length, codes('establishment_without_name').length]).toEqual([1, 1, 1]);
  });

  it('corps reference: code, label, raw row', () => {
    expect(rows.ref_corps_grade).toEqual([{ code: 'PR', label: 'Professeur', category: 'A', extra: { A: 'PR', B: 'Professeur', C: 'A', D: null } }]);
    expect([codes('corps_duplicate_code').length, codes('corps_without_code').length]).toEqual([1, 1]);
  });

  it('structures: labels, parent, blank idref, raw row in extra', () => {
    expect(rows.structure.map((s) => [s.legacy_grist_id, s.local_id, s.acronym, s.$parent])).toEqual([
      [10, 'U-LAB1', 'LAB1', null], [11, 'U-TEAM1', 'TEAMA', 10], [12, 'U-ORPHAN', 'ORPH', null], [15, 'U-LAB2', 'LAB2', null], [16, 'U-LAB2-TEAMA', 'TEAMA', 15],
    ]);
    expect(codes('structure_acronym_ambiguous').map((i) => i.rows)).toEqual([[16, 11]]);
    const lab = rows.structure[0];
    expect([lab.name, lab.rnsr, lab.idref, lab.url, lab.extra.short_labels, 'local_id' in lab.extra]).toEqual(['Laboratoire Un', '200012345A', null, 'https://lab1.example.org', 'LAB1[fr]|LAB1[en]', false]);
    expect(codes('structure_parent_unresolved').map((i) => i.rows)).toEqual([[12]]);
    expect([codes('structure_idref_blank').length, codes('structure_duplicate_local_id').length, codes('structure_without_local_id').length]).toEqual([1, 1, 1]);
  });

  it('people: grouped by lower-case uid, personal fields from the kept row, stable ids', () => {
    expect(rows.person.length).toBe(4);
    const a = person('dupont-a');
    expect(a.id).toBe(personUuid('u:dupont-a'));
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([a.legacy_grist_id, a.last_name, a.civility, a.birth_date, a.employment_start, a.employment_end, a.hdr_year, a.hr_id]).toEqual([101, 'Dupont', 'F', '1980-05-04', '2015', '2030-06', 2012, '12345']);
    expect([a.presence_validated, a.presence_status, a.presence_validated_on, a.presence_validation_scope]).toEqual([true, 'PRESENT', '2026-09-01', ['statut', 'rattachement']]);
    expect([a.fte_ratio, a.fte_research, a.$employer, a.sources]).toEqual([1, 0.5, 1, ['LDAP', 'IDREF', 'HAL']]);
    expect(a.note).toBe('[G-101]\n[2026-09-01] MAJ LDAP\n\n[G-102]\nNote manuelle');
    expect(a.extra).toEqual({ Personnel_heberge_dans_les_locaux_de_Nantes_Universite: 'Oui', Mystery_column: 'x', 'affiliation_end_date@G-102': '2024-13' });
    expect(codes('multi_row_divergence')[0]).toMatchObject({ rows: [101, 102], columns: ['Nom', 'Employeur'] });
    expect(codes('column_unmapped')).toEqual([{ code: 'column_unmapped', table: 'Annuaire', rows: [101], columns: ['Mystery_column'] }]);
  });

  it('uid: grouped regardless of case, kept with the case of the kept row', () => {
    expect(rows.person.filter((p) => p.uid).map((p) => p.uid).sort()).toEqual(['Petit-D', 'dupont-a', 'ext_durand-c']);
    const cased = transformDirectory({ Annuaire: [row(1, { uid_dyna: 'Ab-C', Nom: 'X', rattachement: 'PRINCIPAL' }), row(2, { uid_dyna: 'ab-c', Nom: 'X' })],
      Structures: [], Etablissements: [], Corps_Categorie: [] });
    expect(cased.rows.person.map((p) => p.uid)).toEqual(['Ab-C']);
    expect(cased.rows.membership.map((m) => m.legacy_grist_id)).toEqual([1, 2]);
  });

  it('kept row: PRINCIPAL, then latest validation, then latest LDAP update, then oldest', () => {
    expect(keptRow([row(2, { validated: true, validation_date: 10 }), row(1, { rattachement: 'PRINCIPAL' })]).id).toBe(1);
    expect(keptRow([row(1, { validated: true, validation_date: 10 }), row(2, { validated: true, validation_date: 20 })]).id).toBe(2);
    expect(keptRow([row(1, { LDAP_derniere_maj: '2026-01-01' }), row(2, { LDAP_derniere_maj: '2026-02-01' })]).id).toBe(2);
    expect(keptRow([row(3, {}), row(2, {})]).id).toBe(2);
    expect([personKey(row(9, { uid_dyna: ' X-Y ' })), personKey(row(9, {}))]).toEqual(['u:x-y', 'r:9']);
  });

  it('sentinels, typed text and unknown values: kept in extra, reported', () => {
    const b = person(null, 103);
    expect([b.civility, b.$employer, b.hr_id, b.hdr_year, b.employment_end, b.presence_status]).toEqual(['M', 2, null, null, null, 'PARTI']);
    expect(b.extra).toEqual({ Employeur: 'cnrs', N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: '#N/A', ANNEE_HDR: 'N/A', employment_end_date: '2026-02-30' });
    const c = person('ext_durand-c');
    expect([c.civility, c.$employer, c.presence_status, c.hr_id]).toEqual([null, null, null, null]);
    expect(c.extra).toEqual({ Civilite: 'Dr', Employeur: 999, validated_status: 'NOPE' });
    expect(codes('employer_resolved_by_label').map((i) => i.rows)).toEqual([[103]]);
    expect(codes('employer_duplicate_row').length).toBe(0); // 102 is not the kept row of its person
    expect(codes('employer_unresolved').map((i) => i.rows)).toEqual([[104]]);
    expect(codes('presence_status_legacy').map((i) => i.rows)).toEqual([[101]]);
    expect(codes('civility_normalized').map((i) => i.rows)).toEqual([[101, 103]]);
    expect(codes('sentinel_zero').map((i) => [i.columns, i.rows])).toEqual([[['N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_'], [104]], [['DATE_DE_NAISSANCE_JJ_MM_AAAA'], [104]]]);
    expect(codes('date_invalid')).toEqual([]);
  });

  it('identifiers: union of the rows, kept row primary, absence checks, shared values', () => {
    const a = person('dupont-a');
    expect(rows.person_identifier.filter((i) => i.person_id === a.id).map((i) => [i.scheme, i.value, i.is_primary])).toEqual([
      ['idref', '000000019', true], ['orcid', '0000-0001-0000-0001', true], ['scopus', '57193706000', true],
      ['openalex', 'A1', true], ['openalex', 'A2', false], ['idref', '000000027', false],
    ]);
    expect(codes('identifier_from_other_row').map((i) => i.columns)).toEqual([['IdRef']]);
    expect(rows.person_identifier_check).toEqual([{ person_id: person(null, 103).id, scheme: 'scopus', result: 'absent' }]);
    expect(codes('identifier_shared')).toEqual([{ code: 'identifier_shared', table: 'Annuaire', rows: [101, 103], columns: ['idref'] }]);
  });

  it('memberships: one per row, labs and teams resolved, labels kept', () => {
    expect(rows.membership.map((m) => [m.legacy_grist_id, m.lab_label, m.$structure, m.role, m.team_labels, m.$teams, m.start_date, m.end_date])).toEqual([
      [101, 'LAB1', 10, 'PRINCIPAL', ['TEAMA', 'Free team'], [11], '2015-09', null],
      [102, 'zzz', null, 'SECONDAIRE', [], [], null, null],
      [103, 'UNKNOWN', null, null, [], [], null, null],
      [104, null, null, null, [], [], null, null],
      [105, 'LAB2', 15, null, ['TEAMA'], [16], null, null], // TEAMA of LAB2, not the one of LAB1
    ]);
    expect([codes('lab_parking').length, codes('lab_unresolved').length, codes('team_unresolved').length, codes('fuzzy_date_invalid').length]).toEqual([2, 1, 1, 2]);
  });

  it('links and sync traces', () => {
    const a = person('dupont-a');
    expect(rows.person_link).toEqual([
      { person_id: a.id, kind: 'linkedin', url: 'https://linkedin.com/in/a' },
      { person_id: a.id, kind: 'linkedin', url: 'https://linkedin.com/in/a2' },
    ]);
    expect(rows.sync_state).toEqual([{ person_id: a.id, source: 'ldap', last_run: '2026-10-01', changed_fields: ['Corps_grade', 'TYPE_EMPLOI'] }]);
  });

  it('report: every case explained, counts, no personal value', () => {
    expect(report.issues.every((i) => i.code in ISSUE_EXPLANATIONS)).toBe(true);
    expect(report.counts).toMatchObject({ person: 4, membership: 5, structure: 5, establishment: 3 });
    expect(report.source).toEqual({ Etablissements: 5, Corps_Categorie: 3, Structures: 7, Annuaire: 5 });
    const text = JSON.stringify(report) + reportMarkdown(report);
    for (const value of ['Dupont', 'Alice', 'Martin', 'Durand', 'Petit', '000000019', 'linkedin.com', 'Note manuelle', '#N/A']) expect(text).not.toContain(value);
  });

  it('missing tables are reported, not fatal', () => {
    const { rows: r, report: rep } = transformDirectory({ Annuaire: [], Structures: null, Etablissements: null, Corps_Categorie: null });
    expect(r.person).toEqual([]);
    expect(rep.issues.filter((i) => i.code === 'table_missing').map((i) => i.table)).toEqual(['Structures', 'Etablissements', 'Corps_Categorie']);
  });
});
