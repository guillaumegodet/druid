import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const { selectTargets, parseIds, scopusIdOf, scopusMarkedAbsent } = createRequire(import.meta.url)('../../scripts/lib/align_targets.cjs');

// Records as align_common.fetchAnnuaire() shapes them.
const person = (key: string, extra: Record<string, unknown> = {}) => ({ key, uid: key, first: 'Jean', last: key.toUpperCase(), labo: 'LS2N', typeEmploi: '', libTypeEmploi: '', statut: '', ...extra });
const keys = (list: { key: string }[]) => list.map((p) => p.key);

describe('scripts/lib/align_targets.cjs — records an alignment run processes', () => {
  const all = [
    person('a'),                                          // nothing yet
    person('b', { orcid: '0000-0001-0000-0001' }),        // ORCID known
    person('c', { labo: 'CEISAM' }),
    person('d', { typeEmploi: 'DOCTORANT' }),
    person('e', { first: '', last: '' }),                 // no name: never searched
    person('f', { statut: 'DEPART', scopus: 'absent' }),  // OpenAlex skips departures; Scopus marked absent by hand
  ];

  it('search: records lacking the identifier, scoped, incremental (never processed in the mode, or in error)', () => {
    const cache = { a: { mode: 'search', status: 'not_found' }, c: { mode: 'verify', status: 'found' }, d: { mode: 'search', status: 'error' } };
    const sel = selectTargets('orcid', all, cache, { mode: 'search' });
    expect(keys(sel.eligible)).toEqual(['a', 'c', 'd', 'f']);
    expect(keys(sel.pending)).toEqual(['c', 'd', 'f']);
    expect(keys(sel.targets)).toEqual(['c', 'd', 'f']);
    expect(keys(selectTargets('orcid', all, cache, { mode: 'search', force: true }).targets)).toEqual(['a', 'c', 'd', 'f']);
    expect(keys(selectTargets('orcid', all, cache, { mode: 'search', limit: 2 }).targets)).toEqual(['c', 'd']);
    expect(keys(selectTargets('orcid', all, cache, { mode: 'search', labo: 'CEISAM' }).targets)).toEqual(['c']);
    expect(keys(selectTargets('orcid', all, cache, { mode: 'search', group: 'doctorants' }).targets)).toEqual(['d']);
    expect(keys(selectTargets('orcid', all, {}, { mode: 'verify' }).targets)).toEqual(['b']);
  });

  it('per-source rules: OpenAlex skips departures, Scopus skips « absent », IdRef cache has no mode', () => {
    expect(keys(selectTargets('openalex', all, {}, {}).targets)).toEqual(['a', 'b', 'c', 'd']);
    expect(keys(selectTargets('scopus', all, {}, {}).targets)).toEqual(['a', 'b', 'c', 'd']);
    expect(keys(selectTargets('scopus', all, {}, { mode: 'verify' }).targets)).toEqual([]);
    const idref = selectTargets('idref', [...all, person('g', { idref: 'https://www.idref.fr/123456789' })], { a: { status: 'ambiguous' }, b: {} }, {});
    expect(keys(idref.eligible)).toEqual(['a', 'b', 'c', 'd', 'f']);
    expect(keys(idref.pending)).toEqual(['b', 'c', 'd', 'f']);
    expect(() => selectTargets('wos', all, {}, {})).toThrow(/Unknown alignment source/);
  });

  it('identifier helpers moved from the scripts keep their behaviour', () => {
    expect(parseIds('https://openalex.org/A5012345678 | a5012345678 ;A5099999999')).toEqual(['A5012345678', 'A5099999999']);
    expect(scopusIdOf({ scopus: 12345678901 })).toBe('12345678901');
    expect(scopusIdOf({ scopus: 0 })).toBe('');
    expect(scopusMarkedAbsent({ scopus: 'absent' })).toBe(true);
    expect(scopusMarkedAbsent({ scopus: '' })).toBe(false);
  });
});
