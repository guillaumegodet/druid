import { describe, expect, it } from 'vitest';
import { fuzzyDateEncoderFor, toGristEpoch } from '../directory/annuaireWrite';
import { BIRTH_DATE_COL, fromGristFuzzyDate } from '../directory/gristMapping';
import { ldapCandidatePatches } from '../directory/ldap';

// Birth date known to the year or the month only (lib/dates.ts): YYYY, YYYY-MM or YYYY-MM-DD.
describe('reduced-precision birth date', () => {
  const textColumn = [{ id: BIRTH_DATE_COL, label: BIRTH_DATE_COL, type: 'Text', isFormula: false }];
  const dateColumn = [{ id: BIRTH_DATE_COL, label: BIRTH_DATE_COL, type: 'Date', isFormula: false }];

  it('is written as typed in a Text column', () => {
    const encode = fuzzyDateEncoderFor(textColumn);
    expect(encode(BIRTH_DATE_COL, '1980')).toBe('1980');
    expect(encode(BIRTH_DATE_COL, '06/1980')).toBe('1980-06');
    expect(encode(BIRTH_DATE_COL, '15/06/1980')).toBe('1980-06-15');
    expect(encode(BIRTH_DATE_COL, '')).toBeNull();
  });

  it('keeps the first day of the year or month in a column still of type Date', () => {
    const encode = fuzzyDateEncoderFor(dateColumn);
    expect(encode(BIRTH_DATE_COL, '1980')).toBe(toGristEpoch('1980-01-01'));
    expect(encode(BIRTH_DATE_COL, '1980-06')).toBe(toGristEpoch('1980-06-01'));
  });

  it('is read from a Text cell or a Date (epoch) cell', () => {
    expect(fromGristFuzzyDate('1980')).toBe('1980');
    expect(fromGristFuzzyDate('1980-06')).toBe('1980-06');
    expect(fromGristFuzzyDate(toGristEpoch('1980-06-15'))).toBe('1980-06-15');
  });

  it('is filled from LDAP on attachment only when the record has none, in the column format', () => {
    const entries = [{ gristRowId: 1, email: '', ldap: { uid: 'dupont-a', birthDate: '19800615' } }] as any;
    const records = (birth: string) => [{ id: 1, fields: { uid_dyna: '', LABO: 'LAB1', [BIRTH_DATE_COL]: birth } }] as any;
    const encode = fuzzyDateEncoderFor(textColumn);
    expect(ldapCandidatePatches(entries, records(''), '2026-11-09', encode).patches[0].fields[BIRTH_DATE_COL]).toBe('1980-06-15');
    expect(ldapCandidatePatches(entries, records('1980'), '2026-11-09', encode).patches[0].fields).not.toHaveProperty(BIRTH_DATE_COL);
  });
});
