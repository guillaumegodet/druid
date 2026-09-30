import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const ic = createRequire(import.meta.url)('../../scripts/lib/import_conflicts.cjs');
const C = ic.COL;

const colTypes = new Map<string, string>([
  ['Corps_grade', 'Choice'], ['DATE_DE_NAISSANCE_JJ_MM_AAAA', 'Date'], ['ID_SCOPUS', 'Numeric'],
  ['Employeur', 'Ref:Etablissements'], ['Email', 'Text'],
]);
const refLabels = new Map([['Employeur', new Map([[1, 'ECOLE A'], [2, 'ORGANISME B']])]]);
const refIds = new Map([['Employeur', new Map([['ECOLE A', 1], ['ORGANISME B', 2]])]]);

const row = (id: number, record: number, field: string, current: string, imported: string, importedJson: unknown, extra = {}) => ({
  id,
  fields: {
    [C.record]: record, [C.person]: 'Ada Example', [C.lab]: 'LAB', [C.family]: 'RH', [C.field]: field,
    [C.current]: current, [C.imported]: imported, [C.importedJson]: JSON.stringify(importedJson),
    [C.remark]: '', [C.choice]: '', [C.other]: '', [C.resolvedAt]: '', [C.resolvedBy]: '', ...extra,
  },
});

describe('import_conflicts', () => {
  it('recognises arbitration tables and derives the source label', () => {
    expect(ic.isConflictTable('Arbitrage_Ecole_2026_09')).toBe(true);
    expect(ic.isConflictTable('Arbitrage_')).toBe(false);
    expect(ic.isConflictTable('Annuaire')).toBe(false);
    expect(ic.sourceLabel('Arbitrage_Ecole_2026_09')).toBe('Ecole');
    expect(ic.sourceLabel('Arbitrage_Ecole_X_2026')).toBe('Ecole X');
    expect(ic.sourceLabel('Arbitrage_Ecole')).toBe('Ecole');
  });

  it('parses dd/mm/yyyy and ISO dates, rejects impossible ones', () => {
    expect(ic.parseDate('25/02/1972')).toBe(Date.UTC(1972, 1, 25) / 1000);
    expect(ic.parseDate('1972-02-25')).toBe(Date.UTC(1972, 1, 25) / 1000);
    expect(() => ic.parseDate('31/02/1972')).toThrow(ic.ConflictInputError);
    expect(() => ic.parseDate('1972')).toThrow(ic.ConflictInputError);
  });

  it('displays Annuaire cells like the import snapshot', () => {
    expect(ic.displayValue(Date.UTC(1972, 1, 25) / 1000, 'Date')).toBe('25/02/1972');
    expect(ic.displayValue(2, 'Ref:Etablissements', refLabels.get('Employeur'))).toBe('ORGANISME B');
    expect(ic.displayValue(0, 'Numeric')).toBe('');
    expect(ic.displayValue(null, 'Text')).toBe('');
  });

  it('lists only open rows whose live value still differs, with the live value', () => {
    const rows = [
      row(1, 10, 'Corps_grade', 'MCF', 'PR', 'PR'),
      row(2, 10, 'Email', 'a@example.org', 'b@example.org', 'b@example.org'), // fixed in Grist since
      row(3, 11, 'Corps_grade', 'MCF', 'PR', 'PR', { [C.resolvedAt]: '2026-09-29T10:00:00Z' }),
      row(4, 11, 'Employeur', 'ECOLE A', 'ORGANISME B', 2),
    ];
    const annuaire = new Map<number, Record<string, unknown>>([
      [10, { Corps_grade: 'MCF', Email: 'B@example.org', uid_dyna: 'ada-e', LABO: 'LAB' }],
      [11, { Corps_grade: 'MCF', Employeur: 1, uid_dyna: '' }],
    ]);
    const out = ic.openConflicts(rows, { colTypes, refLabels, annuaire });
    expect(out.map((c: { id: number }) => c.id)).toEqual([1, 4]);
    expect(out[0]).toMatchObject({ record: 10, uid: 'ada-e', current: 'MCF', imported: 'PR', changedSinceImport: false });
    expect(out[1]).toMatchObject({ current: 'ECOLE A', imported: 'ORGANISME B' });
  });

  it('builds typed Annuaire patches, a comment line and the resolved rows', () => {
    const rows = [
      row(1, 10, 'Corps_grade', 'MCF', 'PR', 'PR'),
      row(2, 10, 'DATE_DE_NAISSANCE_JJ_MM_AAAA', '01/01/1970', '25/02/1972', Date.UTC(1972, 1, 25) / 1000),
      row(3, 11, 'ID_SCOPUS', '1', '2', 2),
      row(4, 11, 'Employeur', 'ECOLE A', 'ORGANISME B', 2),
    ];
    const annuaire = new Map<number, Record<string, unknown>>([[10, { Commentaires: 'old line' }], [11, { Commentaires: '' }]]);
    const { annuairePatches, rowPatches } = ic.buildWrites(rows, [
      { id: 1, choice: 'import' },
      { id: 2, choice: 'other', value: '26/02/1972' },
      { id: 3, choice: 'current' },
      { id: 4, choice: 'other', value: 'ecole a' },
    ], { colTypes, refIds, annuaire, source: 'Ecole', author: 'admin-a', nowIso: '2026-09-29T10:00:00.000Z' });
    expect(annuairePatches).toEqual([
      { id: 10, fields: { Corps_grade: 'PR', DATE_DE_NAISSANCE_JJ_MM_AAAA: Date.UTC(1972, 1, 26) / 1000, Commentaires: 'old line\n[2026-09-29] Arbitrage Ecole (admin-a): Corps_grade, DATE_DE_NAISSANCE_JJ_MM_AAAA' } },
      { id: 11, fields: { Employeur: 1, Commentaires: '[2026-09-29] Arbitrage Ecole (admin-a): Employeur' } },
    ]);
    expect(rowPatches.map((p: { fields: Record<string, string> }) => p.fields[C.choice])).toEqual(['Import', 'Autre', 'Actuelle', 'Autre']);
    expect(rowPatches[2].fields).toMatchObject({ [C.resolvedAt]: '2026-09-29T10:00:00.000Z', [C.resolvedBy]: 'admin-a', [C.other]: '' });
  });

  it('rejects unknown, duplicate or already resolved conflicts and invalid values', () => {
    const rows = [row(1, 10, 'ID_SCOPUS', '1', '2', 2)];
    const ctx = { colTypes, refIds, annuaire: new Map([[10, {}]]), source: 'Ecole', author: 'a', nowIso: '2026-09-29T00:00:00Z' };
    expect(() => ic.buildWrites(rows, [{ id: 9, choice: 'import' }], ctx)).toThrow(ic.ConflictInputError);
    expect(() => ic.buildWrites(rows, [{ id: 1, choice: 'import' }, { id: 1, choice: 'current' }], ctx)).toThrow(ic.ConflictInputError);
    expect(() => ic.buildWrites(rows, [{ id: 1, choice: 'maybe' }], ctx)).toThrow(ic.ConflictInputError);
    expect(() => ic.buildWrites(rows, [{ id: 1, choice: 'other', value: 'abc' }], ctx)).toThrow(ic.ConflictInputError);
  });

  it('groups PATCH records by identical column sets', () => {
    const groups = ic.groupBySameFields([
      { id: 1, fields: { a: 1, b: 2 } }, { id: 2, fields: { b: 3, a: 4 } }, { id: 3, fields: { a: 5 } },
    ]);
    expect(groups.map((g: { id: number }[]) => g.map((r) => r.id))).toEqual([[1, 2], [3]]);
  });
});
