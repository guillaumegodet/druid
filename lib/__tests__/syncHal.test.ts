import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const { groupByPerson, scoreCandidate, pickPrimary, isDirect, planSearchWrite } = createRequire(import.meta.url)('../../scripts/sync_hal.cjs');

// AureHAL author forms (fictitious identifiers).
const form = (person: number, formId: number, fullName: string, extra: Record<string, unknown> = {}) =>
  ({ person_i: person, form_i: formId, fullName_s: fullName, valid_s: 'OLD', ...extra });
// A record as align_common.fetchAnnuaire() shapes it.
const record = (extra: Record<string, unknown> = {}) => ({ key: 'durand-c', recId: 7, first: 'Claire', last: 'Durand', labo: 'LAB1', orcid: '', idref: '', idhal: '', idhalI: '', idhalISecondary: '', ...extra });

describe('scripts/sync_hal.cjs — HAL persons with or without an IdHAL (docs/plan-alignement-idhal-i.md, lot 2)', () => {
  it('groups the forms by person, IdHAL or not, and ignores the forms without a person', () => {
    const groups = groupByPerson([
      form(100001, 11, 'Claire Durand', { valid_s: 'PREFERRED', orcidId_s: ['https://orcid.org/0000-0002-0000-0001'] }),
      form(100001, 12, 'C. Durand'),
      form(200003, 21, 'Claire Durand', { idHal_s: 'claire-durand', idHal_i: 200003 }),
      form(0, 31, 'Claire Durand', { valid_s: 'INCOMING' }),
    ]);
    expect(groups.map((g: any) => [g.idhalI, g.idhal, g.fullName, g.forms, g.formIds, g.orcids])).toEqual([
      ['100001', '', 'Claire Durand', ['Claire Durand', 'C. Durand'], ['11', '12'], ['0000-0002-0000-0001']],
      ['200003', 'claire-durand', 'Claire Durand', ['Claire Durand'], ['21'], []],
    ]);
  });

  it('scores a person without IdHAL carrying the record ORCID as strong', () => {
    const [cand] = groupByPerson([form(100001, 11, 'Claire Durand', { orcidId_s: ['https://orcid.org/0000-0002-0000-0001'] })]);
    const s = scoreCandidate(record({ orcid: '0000-0002-0000-0001' }), cand, { nbDocs: 4, siteDocs: 3, labs: [], structs: [], structNames: [] });
    expect(s.score).toBe('fort');
    expect(s.matchedIds).toEqual(['ORCID']);
    expect(s.evidence).toEqual(expect.arrayContaining(['sans IdHAL', '4 docs HAL dont 3 sur le site']));
  });

  it('suspects a person whose form matching the record also belongs to another person', () => {
    // The IdHAL of a colleague holds a form « Claire Durand » that is also the form of another person.
    const [cand] = groupByPerson([
      form(300002, 41, 'Claire Durand', { idHal_s: 'paul-martin', idrefId_s: ['https://www.idref.fr/000000019'] }),
      form(300002, 42, 'Paul Martin', { idHal_s: 'paul-martin', valid_s: 'PREFERRED' }),
    ]);
    const shared = [{ form: 'Claire Durand', person: '100001' }];
    const s = scoreCandidate(record({ idref: '000000019' }), cand, null, shared);
    expect(s.score).toBe('moyen');
    expect(s.suspect).toEqual(['forme « Claire Durand » rattachée aussi à la personne HAL 100001']);
    // The same name on both persons: one researcher with two HAL persons, not a mixed identity.
    const [twin] = groupByPerson([form(100001, 11, 'Claire Durand', { valid_s: 'PREFERRED', idrefId_s: ['https://www.idref.fr/000000019'] })]);
    expect(scoreCandidate(record({ idref: '000000019' }), twin, null, [{ form: 'Claire Durand', person: '400004' }]).suspect).toEqual([]);
    // For Paul Martin, the shared form is not his name: not that suspicion (the foreign first name is flagged anyway).
    expect(scoreCandidate(record({ first: 'Paul', last: 'Martin', idref: '000000019' }), cand, null, shared).suspect.some((x: string) => x.includes('rattachée aussi'))).toBe(false);
  });

  it('picks the primary person: the one with an IdHAL, else the most documents on the site, else the most documents (D1)', () => {
    const c = (idhalI: string, idhal: string, siteDocs: number, nbDocs: number) => ({ idhalI, idhal, siteDocs, nbDocs });
    expect(pickPrimary([c('1', '', 9, 9), c('2', 'claire-durand', 0, 1)]).map((x: any) => x.idhalI)).toEqual(['2', '1']);
    expect(pickPrimary([c('1', '', 1, 50), c('2', '', 4, 5), c('3', '', 4, 8)]).map((x: any) => x.idhalI)).toEqual(['3', '2', '1']);
  });

  it('writes directly only a strong person matched by ORCID or IdRef, with the name, nothing suspect (D2)', () => {
    const base = { score: 'fort', matchedIds: ['ORCID'], nameMatch: 'exact', suspect: [] };
    expect(isDirect(base)).toBe(true);
    expect(isDirect({ ...base, matchedIds: ['IdHAL_selon_IdRef'] })).toBe(false);
    expect(isDirect({ ...base, nameMatch: null })).toBe(false);
    expect(isDirect({ ...base, suspect: ['x'] })).toBe(false);
    expect(isDirect({ ...base, score: 'moyen' })).toBe(false);
  });

  it('plans the direct write: primary IdHAL_i, the others as secondaries, the IdHAL of the primary person', () => {
    const entry = {
      mode: 'search', status: 'found', best: '200003', direct: ['200003', '100001'],
      candidates: [{ idhalI: '200003', idhal: 'claire-durand' }, { idhalI: '100001', idhal: '' }],
    };
    expect(planSearchWrite(record({ idhalISecondary: '400004' }), entry))
      .toEqual({ IdHAL_i: '200003', IdHAL_i_secondaires: '400004|100001', IdHAL: 'claire-durand' });
    expect(planSearchWrite(record({ idhal: 'autre-slug' }), { ...entry, direct: ['200003'] })).toEqual({ IdHAL_i: '200003' });
    expect(planSearchWrite(record({ idhalI: '999999' }), entry)).toBeNull();   // filled in the meantime
    expect(planSearchWrite(record(), { ...entry, written: ['IdHAL_i'] })).toBeNull();
    expect(planSearchWrite(record(), { ...entry, direct: [] })).toBeNull();
  });
});
