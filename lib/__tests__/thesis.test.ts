import { describe, expect, it } from 'vitest';
import { parseThesesPerson, phdOf, thesisDate, thesisPageUrl, yearOf } from '../thesis';

// Shaped like the answer of theses.fr (2026-10-16) for a person: roles, theses by role.
const person = (authored: Record<string, unknown>[], extraRoles: Record<string, unknown[]> = {}) => ({
  id: '000000001', nom: 'Martin', prenom: 'Claire', has_idref: true,
  roles: { 'Auteur / Autrice': authored.length },
  theses: { 'Auteur / Autrice': authored, ...extraRoles },
});
const thesis = (id: string, date: string | null, status = 'soutenue') => ({
  id, role: 'Auteur / Autrice', titre: `Titre ${id}`, discipline: 'Neurosciences', date_soutenance: date, status,
  etablissement_soutenance: { ppn: '131056549', nom: 'Strasbourg', type: null },
});

describe('thesisDate', () => {
  it('keeps the day, the year alone for the 1 January theses.fr gives to a date it does not know', () => {
    expect(thesisDate('2020-09-25')).toBe('2020-09-25');
    expect(thesisDate('2007-01-01')).toBe('2007');
    expect(thesisDate('2007')).toBe('2007');
    expect(thesisDate('')).toBeNull();
    expect(thesisDate(null)).toBeNull();
  });
});

describe('parseThesesPerson', () => {
  it('reads the theses authored, not those supervised or reviewed', () => {
    const theses = parseThesesPerson(person([thesis('2020STRAJ038', '2020-09-25')], { 'Directeur / Directrice': [thesis('2025NANT1001', '2025-06-01')] }));
    expect(theses).toEqual([{ nnt: '2020STRAJ038', title: 'Titre 2020STRAJ038', defendedOn: '2020-09-25', status: 'defended', institution: 'Strasbourg', discipline: 'Neurosciences' }]);
  });
  it('drops the invisible marks of a name', () => {
    const t = { ...thesis('2020CLFA0001', '2020-10-06'), etablissement_soutenance: { nom: 'Université Clermont Auvergne\u200e (2017-2020)' } };
    expect(parseThesesPerson(person([t]))![0].institution).toBe('Université Clermont Auvergne (2017-2020)');
  });
  it('reads a thesis in progress without date, skips an unknown status', () => {
    const theses = parseThesesPerson(person([thesis('s123456', null, 'enCours'), thesis('X1', '2010-01-01', 'abandonnée')]));
    expect(theses).toEqual([{ nnt: 's123456', title: 'Titre s123456', defendedOn: null, status: 'in_progress', institution: 'Strasbourg', discipline: 'Neurosciences' }]);
  });
  it('is null for a person unknown to theses.fr, empty for a person without authored thesis', () => {
    expect(parseThesesPerson({ status: 'BAD_REQUEST', message: 'Person not found' })).toBeNull();
    expect(parseThesesPerson({ id: '1', theses: { 'Rapporteur / Rapporteuse': [thesis('A', '2019-03-02')] } })).toEqual([]);
  });
});

describe('phdOf', () => {
  it('is the first defended thesis', () => {
    const theses = parseThesesPerson(person([thesis('B', '2012-05-10'), thesis('A', '2008'), thesis('C', null, 'enCours')]))!;
    expect(phdOf(theses)?.nnt).toBe('A');
    expect(yearOf(phdOf(theses)?.defendedOn)).toBe(2008);
    expect(phdOf(theses.filter((t) => t.status === 'in_progress'))).toBeNull();
  });
  it('links the page of a thesis', () => {
    expect(thesisPageUrl('2016MONTD064')).toBe('https://theses.fr/2016MONTD064');
  });
});
