import { describe, expect, it } from 'vitest';
import {
  correct, FieldValueError, keepCorrection, normalizeFieldValue, observe, resolveField,
  type FieldValue,
} from '../directory/fieldMerge';

const ranks = new Map([['ldap', 10], ['hr_file', 20], ['lab_file', 40], ['legacy', 90]]);
const T1 = '2026-01-01T00:00:00Z', T2 = '2026-02-01T00:00:00Z', T3 = '2026-03-01T00:00:00Z', T4 = '2026-04-01T00:00:00Z';
const src = (source: string, value: string | null, at = T1): FieldValue => ({ source, value, assertedAt: at, observedAt: at });

/** Replaces (or adds) the row of `row.source`. */
const put = (rows: FieldValue[], row: FieldValue): FieldValue[] => [...rows.filter((r) => r.source !== row.source), row];

describe('fieldMerge — resolveField', () => {
  it('no value at all', () => {
    expect(resolveField('birth_date', [], ranks)).toMatchObject({ value: null, source: null, divergences: [], conflicts: [] });
  });

  it('the most trusted source wins; the others are overridden, not conflicts', () => {
    const r = resolveField('birth_date', [src('lab_file', '1980-05-13', T3), src('ldap', '1980-05-12')], ranks);
    expect(r).toMatchObject({ value: '1980-05-12', source: 'ldap', conflicts: [] });
    expect(r.divergences).toEqual([{ source: 'lab_file', value: '1980-05-13', rank: 40, kind: 'overridden', observedAt: T3 }]);
  });

  it('same rank: the most recent observation wins; an unlisted source ranks last', () => {
    expect(resolveField('corps_grade', [src('x', 'PR', T1), src('y', 'MCF', T2)], new Map()).value).toBe('MCF');
    expect(resolveField('corps_grade', [src('unknown', 'PR', T4), src('legacy', 'MCF', T1)], ranks).value).toBe('MCF');
  });

  it('a compatible, more precise value refines the winner', () => {
    const r = resolveField('birth_date', [src('ldap', '1980'), src('lab_file', '1980-05-12')], ranks);
    expect(r).toMatchObject({ value: '1980-05-12', source: 'ldap', refinedBy: 'lab_file', divergences: [] });
  });

  it('compares grades without case', () => {
    expect(resolveField('corps_grade', [src('ldap', 'MCF'), src('lab_file', 'mcf')], ranks).divergences).toEqual([]);
  });

  it('a source without value neither wins nor diverges', () => {
    expect(resolveField('birth_date', [src('ldap', null), src('lab_file', '1980')], ranks)).toMatchObject({ value: '1980', source: 'lab_file', divergences: [] });
  });
});

describe('fieldMerge — the scenario that motivated it', () => {
  it('a manual correction survives a later file import that brings the old value back', () => {
    // 1. The lab file says 1980-05-13 (a typo); LDAP has nothing.
    let rows = [observe(null, { field: 'birth_date', source: 'lab_file', value: '13/05/1980', now: T1 }).row];
    expect(resolveField('birth_date', rows, ranks).value).toBe('1980-05-13');

    // 2. A manager corrects it to 1980-05-12.
    rows = put(rows, correct(rows, 'birth_date', '12/05/1980', 'marie.dupont', T2));
    expect(resolveField('birth_date', rows, ranks)).toMatchObject({ value: '1980-05-12', source: 'manual', conflicts: [] });

    // 3. Another manager re-imports the same lab file: the typo comes back from the file…
    const again = observe(rows.find((r) => r.source === 'lab_file')!, { field: 'birth_date', source: 'lab_file', value: '1980-05-13', now: T3 });
    expect(again.changed).toBe(false);
    rows = put(rows, again.row);
    // …but the correction stays, and nobody is asked again: the user already overrode that value.
    const r = resolveField('birth_date', rows, ranks);
    expect(r).toMatchObject({ value: '1980-05-12', source: 'manual', conflicts: [] });
    expect(r.divergences.map((d) => d.kind)).toEqual(['acknowledged']);
  });

  it('a source that changes after the correction raises a conflict, never an overwrite', () => {
    let rows = [src('lab_file', '1980-05-13')];
    rows = put(rows, correct(rows, 'birth_date', '1980-05-12', 'marie.dupont', T2));
    // A new lab file says something else again, and LDAP starts to give a value.
    rows = put(rows, observe(rows[0], { field: 'birth_date', source: 'lab_file', value: '1980-06-13', now: T3 }).row);
    rows = put(rows, observe(null, { field: 'birth_date', source: 'ldap', value: '1981-05-12', now: T3 }).row);
    const r = resolveField('birth_date', rows, ranks);
    expect(r.value).toBe('1980-05-12');
    expect(r.conflicts.map((c) => [c.source, c.kind])).toEqual([['ldap', 'new_since_manual'], ['lab_file', 'changed_since_manual']]);

    // « Keep my correction »: the conflicts are closed until a source changes again.
    rows = put(rows, keepCorrection(rows, 'marie.dupont', T4));
    expect(resolveField('birth_date', rows, ranks).conflicts).toEqual([]);
  });

  it('« back to the sources » = drop the manual row', () => {
    let rows = [src('ldap', '1980-05-12')];
    rows = put(rows, correct(rows, 'birth_date', '1980-05-11', 'u', T2));
    expect(resolveField('birth_date', rows, ranks).value).toBe('1980-05-11');
    expect(resolveField('birth_date', rows.filter((r) => r.source !== 'manual'), ranks).value).toBe('1980-05-12');
  });

  it('a manual year-only date is not refined by a precise value it already saw', () => {
    let rows = [src('lab_file', '1980-05-13')];
    rows = put(rows, correct(rows, 'birth_date', '1980', 'u', T2));
    expect(resolveField('birth_date', rows, ranks)).toMatchObject({ value: '1980', refinedBy: null, conflicts: [] });
    // A precise value seen later does refine it.
    rows = put(rows, observe(null, { field: 'birth_date', source: 'ldap', value: '19800512', now: T3 }).row);
    expect(resolveField('birth_date', rows, ranks)).toMatchObject({ value: '1980-05-12', source: 'manual', refinedBy: 'ldap', conflicts: [] });
  });

  it('a manual clear wins too, and the sources that still have a value are to review', () => {
    let rows = [src('lab_file', 'PR')];
    rows = put(rows, correct(rows, 'corps_grade', '', 'u', T2));
    rows = put(rows, observe(null, { field: 'corps_grade', source: 'ldap', value: 'MCF', now: T3 }).row);
    const r = resolveField('corps_grade', rows, ranks);
    expect(r).toMatchObject({ value: null, source: 'manual' });
    expect(r.conflicts.map((c) => c.source)).toEqual(['ldap']);
  });
});

describe('fieldMerge — writes', () => {
  it('normalizes values, rejects invalid ones', () => {
    expect(normalizeFieldValue('birth_date', '12/05/1980')).toBe('1980-05-12');
    expect(normalizeFieldValue('birth_date', '')).toBeNull();
    expect(normalizeFieldValue('corps_grade', ' mcf ')).toBe('MCF');
    expect(() => normalizeFieldValue('birth_date', '31/02/1980')).toThrow(FieldValueError);
  });

  it('a re-import of the same value only moves observedAt', () => {
    const first = observe(null, { field: 'corps_grade', source: 'ldap', value: 'MCF', now: T1 });
    expect(first.changed).toBe(true);
    const again = observe(first.row, { field: 'corps_grade', source: 'ldap', value: 'mcf', now: T2 });
    expect(again).toEqual({ changed: false, row: { ...first.row, observedAt: T2 } });
    const changed = observe(again.row, { field: 'corps_grade', source: 'ldap', value: 'PR', now: T3 });
    expect(changed.row).toMatchObject({ value: 'PR', assertedAt: T3, observedAt: T3 });
  });

  it('a more precise date from the same source is a new value', () => {
    expect(observe(src('ldap', '1980'), { field: 'birth_date', source: 'ldap', value: '1980-05-12', now: T2 }).changed).toBe(true);
  });

  it('a source cannot write the manual row; keepCorrection needs one', () => {
    expect(() => observe(null, { field: 'birth_date', source: 'manual', value: '1980', now: T1 })).toThrow(FieldValueError);
    expect(() => keepCorrection([src('ldap', '1980')], 'u', T1)).toThrow(FieldValueError);
  });

  it('a correction records what each source said', () => {
    expect(correct([src('ldap', '1980'), src('lab_file', null)], 'birth_date', '1981', 'u', T2))
      .toEqual({ source: 'manual', value: '1981', assertedAt: T2, observedAt: T2, assertedBy: 'u', acknowledged: { ldap: '1980', lab_file: null } });
  });
});
