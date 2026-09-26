import { describe, it, expect } from 'vitest';
import { prefillFromLdap, normalizeCivility, statusFromEtat, LdapPerson } from '../ldapPerson';
import { Researcher, ResearcherStatus, Structure, StructureLevel } from '../../types';

const blank = (): Researcher => ({
  id: 'NEW-1',
  uid: '',
  lastName: '',
  firstName: '',
  displayName: 'Nouveau personnel',
  email: '',
  birthDate: '',
  status: ResearcherStatus.EXTERNE,
  employment: { employer: '', contractType: '', grade: '', internalTypology: '', startDate: '', endDate: '' },
  affiliations: [{ structureName: '', team: '', startDate: '', isPrimary: true }],
  groups: [],
  identifiers: {},
  civility: '',
});

const person = (over: Partial<LdapPerson> = {}): LdapPerson => ({
  uid: 'martin-c',
  lastName: 'Martin',
  firstName: 'Claire',
  email: 'Claire.Martin@example.fr',
  civilite: 'Mme',
  birthDate: '19800115',
  eppn: 'martin-c@example.fr',
  etat: 'N',
  categorie: 'TITULAIRE',
  empCorps: '301',
  dateFin: '',
  etablissementUai: '0442953W',
  population: 'PERSONNEL',
  affectationCodes: ['313', '318', '1162'],
  affectationPrincipale: '318',
  affectationLabels: ['UFR LETTRES', 'UFR LETTRES/ITALIEN', 'UFR LETTRES/UR 1162 LABLET'],
  affectationPrincipaleLabel: 'UFR LETTRES/ITALIEN',
  ...over,
});

const structure = (acronym: string, localId: string, level: StructureLevel): Structure =>
  ({ id: `S-${localId}`, acronym, officialName: acronym, localId, level } as unknown as Structure);

const structures = [
  structure('LETTRES', '313', StructureLevel.INTERMEDIAIRE),
  structure('LABLET', '1162', StructureLevel.ENTITE),
  structure('LABINFO', '6004', StructureLevel.ENTITE),
];
const employers = ['NON RENSEIGNE', 'CNRS', 'NANTES UNIVERSITE'];

describe('prefillFromLdap', () => {
  it('fills civil status, contact, employment and status from the entry', () => {
    const { researcher: r } = prefillFromLdap(blank(), person(), structures, employers, '2026-09-26');
    expect(r).toMatchObject({
      uid: 'martin-c',
      lastName: 'MARTIN',
      firstName: 'Claire',
      displayName: 'MARTIN Claire',
      civility: 'F',
      email: 'Claire.Martin@example.fr',
      eppn: 'martin-c@example.fr',
      birthDate: '1980-01-15',
      status: ResearcherStatus.INTERNE,
      ldapPrefill: { etat: 'N', date: '2026-09-26' },
    });
    expect(r.employment).toMatchObject({ employer: 'NANTES UNIVERSITE', grade: 'MCF', contractType: 'TITULAIRE', endDate: '' });
  });

  it('keeps only research units as labs, ignoring the faculty codes', () => {
    const { lab, otherLabs } = prefillFromLdap(blank(), person(), structures, employers);
    expect(lab).toBe('LABLET');
    expect(otherLabs).toEqual([]);
  });

  it('puts the principal affectation first when several labs match', () => {
    const p = person({ affectationCodes: ['1162', '6004'], affectationPrincipale: '6004' });
    expect(prefillFromLdap(blank(), p, structures, employers)).toMatchObject({ lab: 'LABINFO', otherLabs: ['LABLET'] });
  });

  it('returns no lab when no affectation code is a known research unit', () => {
    const p = person({ affectationCodes: ['313'], affectationPrincipale: '313' });
    expect(prefillFromLdap(blank(), p, structures, employers).lab).toBe('');
  });

  it('keeps typed values for the fields LDAP does not carry', () => {
    const typed = { ...blank(), nationality: 'Italienne', employment: { ...blank().employment, startDate: '2019-09' } };
    const p = person({ categorie: '', empCorps: '', dateFin: '2027-08-31' });
    const { researcher: r } = prefillFromLdap(typed, p, structures, employers);
    expect(r.nationality).toBe('Italienne');
    expect(r.employment).toMatchObject({ startDate: '2019-09', endDate: '2027-08-31', grade: '', contractType: '' });
  });

  it('marks an account hosted for another employer as external, without guessing the employer', () => {
    const { researcher: r } = prefillFromLdap(blank(), person({ etablissementUai: '0440100V' }), structures, employers);
    expect(r.status).toBe(ResearcherStatus.EXTERNE);
    expect(r.employment.employer).toBe('');
  });

  it('maps a departure state', () => {
    expect(prefillFromLdap(blank(), person({ etat: 'D' }), structures, employers).researcher.status).toBe(ResearcherStatus.DEPART);
  });
});

describe('LDAP value helpers', () => {
  it('normalizes civilities', () => {
    expect(['Mme', 'M.', 'Madame', 'Monsieur', ''].map(normalizeCivility)).toEqual(['F', 'M', 'F', 'M', '']);
  });
  it('derives the status from dynaEtat', () => {
    expect(['N', 'D', 'A', ''].map(statusFromEtat)).toEqual([
      ResearcherStatus.INTERNE, ResearcherStatus.DEPART, ResearcherStatus.EXTERNE, ResearcherStatus.EXTERNE,
    ]);
  });
});
