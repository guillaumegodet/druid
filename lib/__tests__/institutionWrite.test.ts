// Employing institutions written from Administration › Institutions (lib/directory/institutionWrite.ts): checks,
// normalization and duplicates. Fictitious data.
import { describe, expect, it } from 'vitest';
import { assertInstitutionUnique, institutionGristFields, institutionNameKey, normalizeInstitutionInput, prepareInstitutionWrite } from '../directory/institutionWrite';
import type { Institution } from '../directory/gristMapping';

const existing: Institution[] = [
  { id: 1, name: 'UNIVERSITE EXEMPLE', label: 'Université Exemple', uai: '0000000A', ror: '', idref: '' },
  { id: 2, name: 'CNRS', label: 'CNRS', uai: '0753639Y', ror: '02feahw73', idref: '' },
];

describe('normalizeInstitutionInput', () => {
  it('trims, capitalizes the UAI, strips the ROR and IdRef URLs, drops a long form equal to the name', () => {
    expect(normalizeInstitutionInput({ name: ' U PARIS NANTERRE ', label: 'Université Paris Nanterre', uai: ' 0921204j', ror: 'https://ror.org/013BKHK48', idref: 'https://www.idref.fr/026403587.json' }))
      .toEqual({ name: 'U PARIS NANTERRE', label: 'Université Paris Nanterre', uai: '0921204J', ror: '013bkhk48', idref: '026403587' });
    expect(normalizeInstitutionInput({ name: 'CNRS', label: ' CNRS ' })).toEqual({ name: 'CNRS', label: '', uai: '', ror: '', idref: '' });
    expect(normalizeInstitutionInput({ name: 'X', idref: '02640358x' }).idref).toBe('02640358X');
  });

  it('refuses a missing name and malformed identifiers', () => {
    expect(() => normalizeInstitutionInput({ name: '  ' })).toThrow(expect.objectContaining({ status: 400, message: 'The institution name is required' }));
    expect(() => normalizeInstitutionInput({ name: 'X', uai: '12345' })).toThrow(expect.objectContaining({ status: 400, message: 'Invalid UAI code: 12345' }));
    expect(() => normalizeInstitutionInput({ name: 'X', ror: 'ror-123' })).toThrow(expect.objectContaining({ status: 400, message: 'Invalid ROR identifier: ror-123' }));
    expect(() => normalizeInstitutionInput({ name: 'X', idref: '1234' })).toThrow(expect.objectContaining({ status: 400, message: 'Invalid IdRef PPN: 1234' }));
    expect(() => normalizeInstitutionInput({ name: 'x'.repeat(201) })).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('assertInstitutionUnique', () => {
  it('compares the names without case, accents or punctuation, and the UAI codes', () => {
    expect(institutionNameKey('Université-Exemple ')).toBe('universite exemple');
    expect(() => assertInstitutionUnique(normalizeInstitutionInput({ name: 'Université exemple' }), existing))
      .toThrow(expect.objectContaining({ status: 409, message: 'An institution with this name already exists: UNIVERSITE EXEMPLE' }));
    expect(() => assertInstitutionUnique(normalizeInstitutionInput({ name: 'INSERM', uai: '0753639y' }), existing))
      .toThrow(expect.objectContaining({ status: 409, message: 'An institution with this UAI already exists: CNRS' }));
    expect(() => assertInstitutionUnique(normalizeInstitutionInput({ name: 'INSERM', uai: '0755364Y' }), existing)).not.toThrow();
  });

  it('ignores the row being updated', () => {
    expect(() => assertInstitutionUnique(normalizeInstitutionInput({ name: 'cnrs', uai: '0753639Y' }), existing, 2)).not.toThrow();
    expect(() => assertInstitutionUnique(normalizeInstitutionInput({ name: 'cnrs' }), existing, 1)).toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe('prepareInstitutionWrite / institutionGristFields', () => {
  it('gives the Grist row of the Etablissements table', () => {
    const fields = prepareInstitutionWrite({ name: 'U PARIS NANTERRE', label: 'Université Paris Nanterre', uai: '0921204J', ror: '013bkhk48', idref: '026403587' }, existing);
    expect(institutionGristFields(fields)).toEqual({ Employeur: 'U PARIS NANTERRE', Libelle: 'Université Paris Nanterre', UAI: '0921204J', ROR: '013bkhk48', idref: '026403587' });
  });
});
