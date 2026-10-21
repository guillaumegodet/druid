// Pure rules of the onboarding (druid-internal docs/plan-druid-saas.md, lot 2): the open registries as the portal
// reads them, slugs, the payload. Records below follow the shapes of the ROR v2 API and of the ministry datasets,
// with fictitious values.
import { describe, expect, it } from 'vitest';
import { StructureLevel } from '../../types';
import {
  OnboardingPayload, esrEstablishmentFromRecord, mailDomainOf, proposeSlug, rnsrStructureFromRecord, rorIdOf,
  rorOrganizationFromRecord, structureOfLab, tenantHostOf,
} from '../saas/onboarding';

const ROR = {
  id: 'https://ror.org/05abcde12',
  names: [{ value: 'Université de Démonstration', types: ['ror_display', 'label'], lang: 'fr' }, { value: 'Demonstration University', types: ['label'], lang: 'en' }, { value: 'UDEMO', types: ['acronym'] }],
  locations: [{ geonames_details: { name: 'Démoville', country_code: 'FR', country_name: 'France' } }],
  links: [{ type: 'website', value: 'https://www.univ-demo.example.org/' }],
  external_ids: [{ type: 'wikidata', all: ['Q9999991'], preferred: null }, { type: 'grid', all: ['grid.000001.0'], preferred: 'grid.000001.0' }],
  types: ['education'],
};
const ESR = {
  uo_lib: 'Université de Démonstration', uo_lib_en: 'Demonstration University', uai: '0000000A', siret: ['00000000000001'],
  identifiant_idref: ['000000001'], identifiant_wikidata: ['Q9999991'], identifiant_ror: ['05abcde12'], type_d_etablissement: ['Université'],
  com_nom: 'Démoville', url: 'https://www.univ-demo.example.org/',
};
const RNSR = {
  numero_national_de_structure: '200000001X', sigle: 'LDEMO', libelle: 'Laboratoire de démonstration', label_numero: 'UMR 0001, UMR 0001',
  type_de_structure: 'Unité mixte', code_de_niveau_de_structure: 2, commune: 'DÉMOVILLE CEDEX 3', site_web: 'https://ldemo.example.org',
  tutelles: 'Université de Démonstration, Centre national de la recherche scientifique', uai_des_tutelles: '0000000A, 0753639Y',
  numero_de_structure_parent: null,
};

describe('onboarding registries', () => {
  it('ROR v2 organization', () => {
    expect(rorIdOf('https://ror.org/05abcde12')).toBe('05abcde12');
    expect(rorIdOf('nope')).toBeNull();
    const o = rorOrganizationFromRecord(ROR)!;
    expect(o).toMatchObject({ ror: '05abcde12', name: 'Université de Démonstration', nameEn: 'Demonstration University', acronym: 'UDEMO', countryCode: 'FR', city: 'Démoville', website: 'https://www.univ-demo.example.org/', wikidata: 'Q9999991', grid: 'grid.000001.0', isni: null, types: ['education'] });
    expect(rorOrganizationFromRecord({ id: 'x' })).toBeNull();
  });
  it('establishment of the ministry', () => {
    expect(esrEstablishmentFromRecord(ESR)).toMatchObject({ uai: '0000000A', siret: '00000000000001', idref: '000000001', wikidata: 'Q9999991', ror: '05abcde12', name: 'Université de Démonstration', nameEn: 'Demonstration University', type: 'Université', city: 'Démoville' });
    expect(esrEstablishmentFromRecord(null)).toBeNull();
  });
  it('RNSR structure', () => {
    const s = rnsrStructureFromRecord(RNSR)!;
    expect(s).toMatchObject({ rnsr: '200000001X', acronym: 'LDEMO', label: 'UMR 0001', labelType: 'UMR', code: '0001', type: 'Unité mixte', level: '2', city: 'DÉMOVILLE', website: 'https://ldemo.example.org' });
    expect(s.tutelles).toEqual(['Université de Démonstration', 'Centre national de la recherche scientifique']);
    expect(s.uaiTutelles).toEqual(['0000000A', '0753639Y']);
    expect(rnsrStructureFromRecord({ sigle: 'X' })).toBeNull();
  });
  it('slug, mail domain, host', () => {
    expect(proposeSlug('Université de Démonstration')).toBe('universite-demonstration');
    expect(proposeSlug('École Centrale de Nantes')).toBe('ecole-centrale-nantes');
    expect(proposeSlug('www')).toBe('www-1');
    expect(proposeSlug('')).toBe('etablissement');
    expect(mailDomainOf('https://www.univ-demo.example.org/')).toBe('univ-demo.example.org');
    expect(mailDomainOf('not a url')).toBeNull();
    expect(tenantHostOf('udemo', '.Example.org.')).toBe('udemo.example.org');
  });
  it('payload and structure of a lab', () => {
    const parsed = OnboardingPayload.safeParse({
      slug: 'udemo', label: 'Université de Démonstration', mailDomains: ['Univ-Demo.example.org'],
      establishment: { ror: '05abcde12', name: 'Université de Démonstration', uai: '0000000A', openalex: 'I123' },
      labs: [{ rnsr: '200000001X', acronym: 'LDEMO', name: 'Laboratoire de démonstration', label: 'UMR 0001', type: 'UMR', tutelles: ['Université de Démonstration'], uaiTutelles: ['0000000A'] }],
    });
    expect(parsed.success).toBe(true);
    const p = parsed.data!;
    expect(p.mailDomains).toEqual(['univ-demo.example.org']);
    expect(p.establishment.country).toBeNull();
    const st = structureOfLab(p.labs[0]);
    expect(st).toMatchObject({ level: StructureLevel.ENTITE, acronym: 'LDEMO', officialName: 'Laboratoire de démonstration', code: '0001', rnsrId: '200000001X', type: 'UMR', supervisors: ['Université de Démonstration'], institutionCodes: '0000000A' });
    expect(OnboardingPayload.safeParse({ slug: 'Bad slug', label: 'x', establishment: { name: 'x' } }).success).toBe(false);
  });
});
