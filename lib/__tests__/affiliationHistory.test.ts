import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// Researcher career path (scripts/lib/affiliation_history.cjs, docs/plan-parcours-affiliations.md lot 1).
const AH = createRequire(import.meta.url)('../../scripts/lib/affiliation_history.cjs');
const { makeOrg, createMatcher, emptyHierarchy, classifyOrg, mergePublications, aggregate, classifyPeriods, computeSignals, normDoi } = AH;

// Fictitious instance: « Université Alpha » (OpenAlex I100, ROR 0alpha), former name « Université d'Alpha »,
// a site hospital counted as local, lab LAB-A (RNSR 200000000A) in the Druid Structures table.
const CONFIG = {
  local: { ids: { openalex: ['I100', 'I101'], ror: ['0alpha'], scopus: ['6000001'] }, names: ['Université Alpha', "Université d'Alpha"] },
  site: { names: ['CHU Alpha'] },
  area: { cities: ['Alphaville'] },
};
const STRUCTURES = [{ ids: { rnsr: ['200000000A'] }, names: ['Laboratoire A', 'LAB-A'] }];
const H = emptyHierarchy();
Object.assign(H.openalex, {
  I100: { name: 'Université Alpha', country: 'FR', type: 'education', ror: '0alpha', lineage: ['I100'] },
  I110: { name: 'Laboratoire A', country: 'FR', type: 'facility', ror: '', lineage: ['I110', 'I100', 'I900'] },
  I200: { name: 'Université Beta', country: 'FR', type: 'education', ror: '0beta', lineage: ['I200'] },
  I210: { name: 'Institut Beta de chimie', country: 'FR', type: 'facility', ror: '', lineage: ['I210', 'I200', 'I1294671590'] },
  I1294671590: { name: 'Centre National de la Recherche Scientifique', country: 'FR', type: 'government', ror: '02feahw73', lineage: ['I1294671590'] },
  I900: { name: 'Centre National de la Recherche Scientifique', country: 'FR', type: 'government', ror: '', lineage: ['I900'] },
});
H.rorToOpenalex['0beta'] = 'I200';
Object.assign(H.hal, {
  '5001': { name: 'Équipe Gamma', type: 'researchteam', country: 'fr', parents: ['5002'] },
  '5002': { name: 'Université Gamma', type: 'institution', country: 'fr', parents: [] },
});
Object.assign(H.scopus, {
  '6000001': { name: 'Université Alpha', city: 'Alphaville', country: 'France', parent: null },
  '1000002': { name: 'Université Beta, Dept of Physics', city: 'Betaville', country: 'France', parent: '6000002' },
  '6000002': { name: 'Université Beta', city: 'Betaville', country: 'France', parent: null },
});
const M = createMatcher(CONFIG, STRUCTURES);

const ALPHA_LAB = makeOrg({ ids: { openalex: 'https://openalex.org/I110' } });
const BETA_LAB = makeOrg({ ids: { openalex: 'I210' } });
const BETA = makeOrg({ ids: { ror: 'https://ror.org/0beta' } });
const CNRS = makeOrg({ names: ['CNRS Délégation Ouest'] });
const pub = (year: number, orgs: unknown[], doi = '', extra = {}) => ({ doi, sourceIds: [], year, title: `p${year}`, sources: ['graph'], orgs, ...extra });

describe('classifyOrg', () => {
  it('climbs the OpenAlex lineage to the local establishment', () => {
    const c = classifyOrg(ALPHA_LAB, M, H);
    expect(c.cls).toBe('local');
    expect(c.establishment.name).toBe('Université Alpha');
    expect(c.lab.name).toBe('Laboratoire A');
  });
  it('a lab of another university (with a neutral tutelle) is « other », establishment = the university', () => {
    const c = classifyOrg(BETA_LAB, M, H);
    expect(c.cls).toBe('other');
    expect(c.establishment.name).toBe('Université Beta');
  });
  it('resolves a ROR through the OpenAlex table', () => {
    expect(classifyOrg(BETA, M, H).establishment.name).toBe('Université Beta');
  });
  it('neutral organisms (CNRS delegation…) are neutral', () => {
    expect(classifyOrg(CNRS, M, H).cls).toBe('neutral');
  });
  it('former name, site establishment and Druid structures count as local (variant D)', () => {
    expect(classifyOrg(makeOrg({ names: ["Université d'Alpha"] }), M, H).cls).toBe('local');
    expect(classifyOrg(makeOrg({ names: ['CHU Alpha'] }), M, H).cls).toBe('local');
    expect(classifyOrg(makeOrg({ ids: { nns: '200000000A' } }), M, H).cls).toBe('local');
    expect(classifyOrg(makeOrg({ names: ['LAB-A'] }), M, H).cls).toBe('local');
  });
  it('HAL parents give the establishment of a team', () => {
    const c = classifyOrg(makeOrg({ ids: { hal: '5001' }, names: ['Équipe Gamma'] }), M, H);
    expect(c.cls).toBe('other');
    expect(c.establishment.name).toBe('Université Gamma');
  });
  it('Scopus department → parent institution', () => {
    const c = classifyOrg(makeOrg({ ids: { scopus: '1000002' }, names: ['Université Beta, Dept of Physics'] }), M, H);
    expect(c.cls).toBe('other');
    expect(c.establishment.name).toBe('Université Beta');
    expect(classifyOrg(makeOrg({ ids: { scopus: '6000001' } }), M, H).cls).toBe('local');
  });
  it('a lab in the area without identified establishment is local; nothing at all is unknown', () => {
    expect(classifyOrg(makeOrg({ names: ['Institut Delta'], city: 'Alphaville' }), M, H).cls).toBe('local');
    expect(classifyOrg(makeOrg({ names: ['Institut Delta'], city: 'Elsewhere' }), M, H).cls).toBe('other');
    expect(classifyOrg(makeOrg({}), M, H).cls).toBe('unknown');
  });
});

describe('establishment choice', () => {
  it('a government umbrella at the top of the lineage is never the establishment', () => {
    const H2 = emptyHierarchy();
    Object.assign(H2.openalex, {
      I300: { name: 'Bibliothèque Delta', country: 'FR', type: 'archive', ror: '', lineage: ['I300', 'I301'] },
      I301: { name: 'Gouvernement de la République française', country: 'FR', type: 'government', ror: '', lineage: ['I301'] },
    });
    expect(classifyOrg(makeOrg({ ids: { openalex: 'I300' } }), M, H2).establishment.name).toBe('Bibliothèque Delta');
  });
  it('the same establishment met with two keys (ROR, name) is one row', () => {
    const agg = aggregate([pub(2020, [BETA]), pub(2021, [makeOrg({ names: ['Université Beta'], city: 'Betaville' })])], M, H);
    expect(agg.establishments.filter((e: { name: string }) => e.name === 'Université Beta')).toHaveLength(1);
    expect(agg.establishments[0].count).toBe(2);
  });
});

describe('mergePublications', () => {
  it('merges by DOI (case, doi.org prefix) then by source id, unions the orgs', () => {
    const merged = mergePublications(
      [pub(2020, [ALPHA_LAB], 'https://doi.org/10.1/ABC'), pub(2021, [BETA], '', { sourceIds: ['openalex:W1'] })],
      [{ ...pub(0, [BETA], '10.1/abc'), year: null, sources: ['openalex'] }, { ...pub(2021, [CNRS], '10.1/xyz'), sourceIds: ['openalex:W1'], sources: ['openalex'] }],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].year).toBe(2020);
    expect(merged[0].sources).toEqual(['graph', 'openalex']);
    expect(merged[0].orgs).toHaveLength(2);
    expect(merged[1].doi).toBe('10.1/xyz');
    expect(normDoi('doi:10.5/X')).toBe('10.5/x');
  });
});

describe('merge by title', () => {
  it('the same work without DOI seen by two sources is one publication (tags and punctuation ignored)', () => {
    const merged = mergePublications(
      [{ ...pub(2024, [BETA]), title: 'La figure de l’aidant : contributions à l’évolution des pratiques' }],
      [{ ...pub(2024, [BETA_LAB]), title: 'La figure de l’<i>aidant</i>. Contributions à l’évolution des pratiques', sources: ['openalex'] }],
      [{ ...pub(2024, [BETA]), title: 'Introduction' }, { ...pub(2024, [BETA]), title: 'Introduction' }],
    );
    expect(merged).toHaveLength(3);
    expect(merged[0].sources).toEqual(['graph', 'openalex']);
  });
});

describe('aggregate', () => {
  it('counts publications per establishment and year; a local + other publication is local for the signals', () => {
    const agg = aggregate([pub(2020, [ALPHA_LAB, BETA]), pub(2021, [ALPHA_LAB]), pub(2022, [BETA_LAB]), pub(2022, [])], M, H);
    const alpha = agg.establishments.find((e: { name: string }) => e.name === 'Université Alpha');
    const beta = agg.establishments.find((e: { name: string }) => e.name === 'Université Beta');
    expect(alpha.byYear).toEqual({ 2020: 1, 2021: 1 });
    expect(alpha.labs).toEqual([{ name: 'Laboratoire A', count: 2 }]);
    expect(beta.count).toBe(2);
    expect(agg.pubs[0].classes).toEqual(['local']);
    expect(agg.totals).toEqual({ pubs: 4, withAffiliation: 3, undated: 0 });
  });
});

const TODAY = '2026-09-30';
const signalsOf = (pubs: unknown[], extra: Record<string, unknown> = {}) =>
  computeSignals({ agg: aggregate(pubs, M, H), today: TODAY, record: { employmentStart: '2010' }, ...extra }).signals;
const types = (s: { type: string }[]) => s.map((x) => x.type);

describe('computeSignals — observed departure', () => {
  const moved = [pub(2019, [ALPHA_LAB]), pub(2020, [ALPHA_LAB]), pub(2021, [BETA_LAB]), pub(2022, [BETA_LAB]), pub(2023, [BETA])];
  it('rule 1: last local year ≤ N−2 and ≥ 3 publications on ≥ 2 years elsewhere', () => {
    const s = signalsOf(moved);
    expect(types(s)).toEqual(['depart_observe']);
    expect(s[0]).toMatchObject({ date: '2020', rule: 'last_local', count: 3, destination: 'Université Beta' });
  });
  it('rule 2: elsewhere dominant over the last three complete years despite a residual local paper', () => {
    const s = signalsOf([pub(2020, [ALPHA_LAB]), pub(2023, [BETA]), pub(2024, [BETA]), pub(2024, [ALPHA_LAB]), pub(2025, [BETA])]);
    expect(s[0]).toMatchObject({ type: 'depart_observe', rule: 'dominant' });
  });
  it('rule 2 never fires while the person still publishes locally in the last two years (double affiliation)', () => {
    // 2023-2025 mostly elsewhere, yet local papers in 2026 (review of 2026-09-30).
    const pubs = [pub(2019, [ALPHA_LAB]), pub(2023, [BETA]), pub(2023, [BETA_LAB]), pub(2024, [BETA]), pub(2025, [BETA_LAB]), pub(2023, [ALPHA_LAB]), pub(2026, [ALPHA_LAB])];
    expect(signalsOf(pubs)).toEqual([]);
  });
  it('rule 2 reports the first year mostly elsewhere and the last local year', () => {
    const s = signalsOf([pub(2020, [ALPHA_LAB]), pub(2023, [BETA]), pub(2024, [BETA]), pub(2024, [ALPHA_LAB]), pub(2025, [BETA])]);
    expect(s[0]).toMatchObject({ type: 'depart_observe', rule: 'dominant', date: '2024', since: 2023, count: 3, local: 1 });
  });
  it('neutral organisms and joint local papers are not a departure', () => {
    expect(signalsOf([pub(2019, [ALPHA_LAB]), pub(2021, [CNRS]), pub(2022, [CNRS]), pub(2023, [CNRS])])).toEqual([]);
    expect(signalsOf([pub(2019, [ALPHA_LAB]), pub(2021, [ALPHA_LAB, BETA]), pub(2022, [ALPHA_LAB, BETA]), pub(2023, [ALPHA_LAB, BETA])])).toEqual([]);
  });
  it('no signal when the record already has an end date; an invited position neutralizes it', () => {
    expect(signalsOf(moved, { record: { employmentStart: '2010', employmentEnd: '2021-08' } }).map((x: { type: string }) => x.type)).not.toContain('depart_observe');
    const periods = classifyPeriods([{ kind: 'invited', org: BETA, start: '2021', end: '' }], M, H);
    expect(signalsOf(moved, { periods })).toEqual([]);
  });
});

describe('computeSignals — ORCID and Scopus', () => {
  const emp = (org: unknown, start: string, end: string, role = '') => ({ kind: 'employment', org, start, end, role });
  it('declared departure + new post, confirmed by the publications (ORCID date wins, D7)', () => {
    const periods = classifyPeriods([emp(makeOrg({ names: ['Université Alpha'] }), '2012-09', '2021-08'), emp(BETA, '2021-09', '')], M, H);
    const s = signalsOf([pub(2019, [ALPHA_LAB]), pub(2020, [ALPHA_LAB]), pub(2021, [BETA]), pub(2022, [BETA]), pub(2023, [BETA])], { periods });
    expect(types(s)).toEqual(['depart_confirme', 'depart_declare', 'depart_observe']);
    expect(s[0]).toMatchObject({ date: '2021-08', destination: 'Université Beta', sources: ['orcid', 'publications'] });
  });
  it('renaming (former name ended, new name open) is continuity, not a departure', () => {
    const periods = classifyPeriods([emp(makeOrg({ names: ["Université d'Alpha"] }), '2012', '2021-12'), emp(makeOrg({ names: ['Université Alpha'] }), '2022-01', '')], M, H);
    expect(signalsOf([], { periods })).toEqual([]);
  });
  it('an ended PhD at the establishment is not a departure of a permanent researcher', () => {
    const periods = classifyPeriods([emp(makeOrg({ names: ['Université Alpha'] }), '2008', '2011', 'PhD student')], M, H);
    expect(signalsOf([], { periods })).toEqual([]);
  });
  it('current Scopus affiliation elsewhere while the history was local', () => {
    const profile = { current: classifyPeriods([{ org: makeOrg({ ids: { scopus: '1000002' } }) }], M, H), history: classifyPeriods([{ org: makeOrg({ ids: { scopus: '6000001' } }) }], M, H), range: { start: 2010, end: 2025 } };
    const s = signalsOf([], { profile });
    expect(s[0]).toMatchObject({ type: 'scopus_courante_non_locale', destination: 'Université Beta' });
  });
});

describe('computeSignals — control signals', () => {
  it('arrival suggestion when the start date is missing (ORCID first)', () => {
    const periods = classifyPeriods([{ kind: 'employment', org: makeOrg({ names: ['Université Alpha'] }), start: '2015-09', end: '' }], M, H);
    const s = computeSignals({ agg: aggregate([pub(2016, [ALPHA_LAB])], M, H), periods, today: TODAY, record: {} }).signals;
    expect(s).toEqual([{ type: 'arrivee', strength: 'suggestion', date: '2015-09', source: 'orcid' }]);
  });
  it('suspect identifier: ≥ 5 affiliated publications, never local', () => {
    expect(types(signalsOf([2019, 2020, 2021, 2022, 2023].map((y) => pub(y, [makeOrg({ names: ['Université Beta'], city: 'Betaville' })]))))).toEqual(['identifiant_suspect']);
  });
  it('inconsistent status (D10): ended record still publishing locally two years later', () => {
    const s = signalsOf([pub(2019, [ALPHA_LAB]), pub(2023, [ALPHA_LAB])], { record: { employmentStart: '2010', employmentEnd: '2020-12-31' } });
    expect(s).toEqual([{ type: 'statut_incoherent', strength: 'control', endYear: 2020, lastLocal: 2023 }]);
  });
});
