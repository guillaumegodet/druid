import { describe, it, expect } from 'vitest';
import { hostingToolsOf, inferLdapEmployer } from '../ldapEmployer';

describe('hostingToolsOf', () => {
  it('keeps the {TOOL} codes without their number', () => {
    expect(hostingToolsOf(['{HARPEGE}12345', '{TOOL}CNRS255', '{TOOL}HBRG12', '{DYNA2}P_1', '{TOOL}TITH3'])).toEqual(['CNRS', 'HBRG', 'TITH']);
    expect(hostingToolsOf([])).toEqual([]);
  });
});

describe('inferLdapEmployer', () => {
  const s = (categorie: string, empCorps: string, tools: string[] = []) => ({ categorie, empCorps, tools });

  it('home staff: home category with an HR corps, no hosting tool (honorary tenured tool allowed)', () => {
    expect(inferLdapEmployer(s('TITULAIRE', '301'))).toBe('home');
    expect(inferLdapEmployer(s('DOCTORANT', 'CN322'))).toBe('home');
    expect(inferLdapEmployer(s('CDD UNIVERSITE', 'ATER'))).toBe('home');
    expect(inferLdapEmployer(s('RETRAITE', '300', ['TITH']))).toBe('home');
  });

  it('CNRS: CNRS hosting tool on a CNRS-INSERM category', () => {
    expect(inferLdapEmployer(s('CNRS-INSERM', '275', ['CNRS']))).toBe('CNRS');
    expect(inferLdapEmployer(s('CNRS-INSERM', '', ['CNRSA']))).toBe('CNRS');
  });

  it('undecided: hosted accounts, missing corps, ambiguous corps, other categories', () => {
    expect(inferLdapEmployer(s('TITULAIRE', '301', ['HBRG']))).toBeNull();
    expect(inferLdapEmployer(s('CNRS-INSERM', '', ['HBRG']))).toBeNull();
    expect(inferLdapEmployer(s('VACATAIRE', 'CN322', ['CNRS']))).toBeNull();
    expect(inferLdapEmployer(s('TITULAIRE', ''))).toBeNull();
    expect(inferLdapEmployer(s('TITULAIRE', '324'))).toBeNull();
    expect(inferLdapEmployer(s('CDD UNIVERSITE', 'H05'))).toBeNull();
    expect(inferLdapEmployer(s('VACATAIRE', 'VN'))).toBeNull();
    expect(inferLdapEmployer(s('PERSONNEL STRUCTURE PARTENAIRE', '301'))).toBeNull();
    expect(inferLdapEmployer(s('CNRS-INSERM', ''))).toBeNull();
  });
});
