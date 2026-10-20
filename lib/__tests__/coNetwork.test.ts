import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// Inter-lab co-authorship graph (scripts/lib/co_network.cjs, docs/archive/plan-reseau-inter-labos.md lots 2 and 4).
const { buildInterLabNetwork, commonPublications, rankPairs, suggestPairs, OTHER_LABS_CATEGORY } = createRequire(import.meta.url)(
  '../../scripts/lib/co_network.cjs',
);

// Fictitious authors: 1-2 in LAB-A, 3 in LAB-B, 4 in both, 5 in LAB-C.
const NET = {
  authors: [
    { id: 1, label: 'Alice A', labs: ['LAB-A'], pubs: { '2021': 3, '2022': 2 } },
    { id: 2, label: 'Bruno A', labs: ['LAB-A'], pubs: { '2022': 1 } },
    { id: 3, label: 'Chloé B', labs: ['LAB-B'], pubs: { '2021': 2 } },
    { id: 4, label: 'Denis AB', labs: ['LAB-A', 'LAB-B'], pubs: { '2022': 2 } },
    { id: 5, label: 'Emma C', labs: ['LAB-C'], pubs: { '2020': 1, '2022': 2 } },
  ],
  pubs: [
    { y: 2021, n: 4, a: [1, 3], doi: '10.1/ab', title: 'A with B' },
    { y: 2022, n: 3, a: [1, 2], doi: null, title: 'Inside A' },
    { y: 2022, n: 200, a: [1, 3], doi: null, title: 'Huge collaboration' },
    { y: 2022, n: 5, a: [1, 5], doi: '10.1/ac', title: 'A with C' },
    { y: 2020, n: 2, a: [2, 5], doi: null, title: 'Old A with C' },
    { y: 2022, n: 2, a: [3, 4], doi: null, title: 'B with AB' },
  ],
};

const base = { labs: ['LAB-A', 'LAB-B'], from: 2021, to: 2022, minPubs: 1, maxAuthors: null };
const ids = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id).sort();
const link = (g: { links: { source: string; target: string; value: number; cross: boolean }[] }, x: string, y: string) =>
  g.links.find((l) => (l.source === x && l.target === y) || (l.source === y && l.target === x));

describe('buildInterLabNetwork', () => {
  it('keeps the authors of the expanded labs and counts co-publications in the period', () => {
    const g = buildInterLabNetwork(NET, base);
    expect(ids(g)).toEqual(['a:1', 'a:2', 'a:3', 'a:4']);
    expect(link(g, 'a:1', 'a:3')).toMatchObject({ value: 2, cross: true });
    expect(link(g, 'a:1', 'a:2')).toMatchObject({ value: 1, cross: false });
    // Denis shares LAB-B with Chloé: not a cross-lab link.
    expect(link(g, 'a:3', 'a:4')).toMatchObject({ cross: false });
    expect(g.categories.map((c: { name: string }) => c.name)).toEqual(['LAB-A', 'LAB-B']);
  });

  it('ignores publications above maxAuthors', () => {
    const g = buildInterLabNetwork(NET, { ...base, maxAuthors: 50 });
    expect(link(g, 'a:1', 'a:3')?.value).toBe(1);
  });

  it('applies minPubs on the publications of the period', () => {
    const g = buildInterLabNetwork(NET, { ...base, minPubs: 2 });
    expect(ids(g)).toEqual(['a:1', 'a:3', 'a:4']);
  });

  it('crossOnly keeps only cross-lab links and their authors', () => {
    const g = buildInterLabNetwork(NET, { ...base, crossOnly: true });
    expect(ids(g)).toEqual(['a:1', 'a:3']);
    expect(g.links).toHaveLength(1);
  });

  it('aggregates the labs not expanded into one node each', () => {
    const g = buildInterLabNetwork(NET, { ...base, labs: ['LAB-A'], aggregateOthers: true });
    // LAB-B is not expanded: Chloé becomes part of the LAB-B node; Denis (LAB-A too) stays an author.
    expect(ids(g)).toEqual(['a:1', 'a:2', 'a:4', 'lab:LAB-B', 'lab:LAB-C']);
    expect(link(g, 'a:1', 'lab:LAB-B')).toMatchObject({ value: 2, cross: true });
    const labNode = g.nodes.find((n: { id: string }) => n.id === 'lab:LAB-C');
    expect(labNode).toMatchObject({ kind: 'lab', value: 1 });
    expect(g.categories.at(-1).name).toBe(OTHER_LABS_CATEGORY);
  });

  it('restricted access: other labs only through co-signatures with the visible labs', () => {
    const g = buildInterLabNetwork(NET, { ...base, labs: ['LAB-A', 'LAB-C'], from: 2020, visibleLabs: ['LAB-A'] });
    // Emma (LAB-C) co-signed with Alice and Bruno: shown.
    expect(ids(g)).toContain('a:5');
    const g2 = buildInterLabNetwork(NET, { ...base, labs: ['LAB-B', 'LAB-C'], visibleLabs: ['LAB-A'] });
    // Denis is LAB-A (visible); Chloé co-signed with him; Emma did not co-sign with a LAB-A author in LAB-B/C scope.
    expect(ids(g2)).toEqual(['a:3', 'a:4']);
  });

  it('caps the author nodes, most prolific first', () => {
    const g = buildInterLabNetwork(NET, { ...base, maxNodes: 2 });
    expect(ids(g)).toEqual(['a:1', 'a:3']);
    expect(g.truncated).toBe(2);
    expect(g.links.every((l: { source: string; target: string }) => ['a:1', 'a:3'].includes(l.source) && ['a:1', 'a:3'].includes(l.target))).toBe(true);
  });
});

describe('commonPublications', () => {
  it('lists the publications behind an author link, most recent first', () => {
    const pubs = commonPublications(NET, { a: 'a:1', b: 'a:3', from: 2021, to: 2022 });
    expect(pubs.map((p: { title: string }) => p.title)).toEqual(['Huge collaboration', 'A with B']);
  });

  it('supports lab nodes, maxAuthors and required labs', () => {
    expect(commonPublications(NET, { a: 'a:1', b: 'lab:LAB-B', maxAuthors: 50 }).map((p: { title: string }) => p.title))
      .toEqual(['A with B']);
    expect(commonPublications(NET, { a: 'a:3', b: 'a:4', requireLabs: ['LAB-C'] })).toEqual([]);
  });
});

// Researcher pairs (druid-internal `docs/plan-binomes-chercheurs.md`, lot 1): network.json v3, two poles.
// Fields: 0 = Computer Science, 1 = Medicine. LAB-A (pole P1) × LAB-B (pole P2), LAB-C without pole.
const PAIRS_NET = {
  poles: [{ acronym: 'P1', name: 'Pole 1' }, { acronym: 'P2', name: 'Pole 2' }],
  labs: [
    { acronym: 'LAB-A', slug: 'lab-a', pole: 'P1', authors: 2 },
    { acronym: 'LAB-B', slug: 'lab-b', pole: 'P2', authors: 2 },
    { acronym: 'LAB-C', slug: 'lab-c', pole: null, authors: 1 },
  ],
  subfields: [
    { name: 'Artificial Intelligence', field: 'Computer Science' },
    { name: 'Oncology', field: 'Medicine' },
  ],
  fields: [{ name: 'Computer Science' }, { name: 'Medicine' }],
  authors: [
    { id: 1, label: 'Alice A', labs: ['LAB-A'], m: { 'LAB-A': 'stat' }, uid: 'alice', pubs: { '2020': 1, '2024': 6 }, f: { '0': 6, '1': 2 } },
    { id: 2, label: 'Bruno A', labs: ['LAB-A'], phd: true, m: { 'LAB-A': 'stat' }, pubs: { '2024': 4 }, f: { '0': 2, '1': 2 } },
    { id: 3, label: 'Chloé B', labs: ['LAB-B'], m: { 'LAB-B': 'assoc' }, pubs: { '2020': 1, '2024': 4 }, f: { '0': 3, '1': 2 } },
    { id: 4, label: 'Denis B', labs: ['LAB-B'], m: { 'LAB-B': 'pubs' }, pubs: { '2024': 4 }, f: { '1': 4 } },
    { id: 5, label: 'Emma C', labs: ['LAB-C'], pubs: { '2024': 4 }, f: { '1': 4 } },
  ],
  pubs: [
    // Alice × Chloé: computer science together, once in 2020, twice in 2024.
    { y: 2020, n: 3, a: [1, 3], s: [0] },
    { y: 2024, n: 3, a: [1, 3], s: [0] },
    { y: 2024, n: 3, a: [1, 3], s: [0] },
    // Alice × Denis: new in 2024, medicine for Denis.
    { y: 2024, n: 4, a: [1, 4], s: [0, 1] },
    { y: 2024, n: 4, a: [1, 4], s: [1] },
    // Bruno × Alice: same lab.
    { y: 2024, n: 2, a: [1, 2], s: [0] },
    { y: 2024, n: 2, a: [1, 2], s: [0] },
    // Bruno × Emma (lab without pole), one of them a large collaboration.
    { y: 2024, n: 3, a: [2, 5], s: [1] },
    { y: 2024, n: 300, a: [2, 5], s: [1] },
  ],
};
const pairKeys = (r: { pairs: { a: { id: number }; b: { id: number } }[] }) =>
  r.pairs.map((p) => `${p.a.id}-${p.b.id}`).sort();

describe('rankPairs', () => {
  it('keeps the cross-lab pairs with at least two joint publications', () => {
    const r = rankPairs(PAIRS_NET, {});
    expect(pairKeys(r)).toEqual(['1-3', '1-4', '2-5']);
    expect(r.total).toBe(3);
    expect(r.pairs[0]).toMatchObject({ shared: 3, first: 2020, last: 2024, crossPole: true });
    expect(r.pairs[0].a).toMatchObject({ label: 'Alice A', uid: 'alice', poles: ['P1'], m: { 'LAB-A': 'stat' } });
  });

  it('applies the period, maxAuthors and minShared', () => {
    expect(pairKeys(rankPairs(PAIRS_NET, { from: 2020, to: 2020, minShared: 1 }))).toEqual(['1-3']);
    expect(pairKeys(rankPairs(PAIRS_NET, { from: 2020, to: 2020 }))).toEqual([]);
    expect(pairKeys(rankPairs(PAIRS_NET, { maxAuthors: 50 }))).toEqual(['1-3', '1-4']);
    expect(pairKeys(rankPairs(PAIRS_NET, { crossLab: false }))).toEqual(['1-2', '1-3', '1-4', '2-5']);
  });

  it('filters on poles: different poles, or a pole couple in either order', () => {
    expect(pairKeys(rankPairs(PAIRS_NET, { crossPole: true }))).toEqual(['1-3', '1-4']);
    expect(pairKeys(rankPairs(PAIRS_NET, { poles: ['P2', 'P1'] }))).toEqual(['1-3', '1-4']);
    expect(pairKeys(rankPairs(PAIRS_NET, { poles: ['P1', 'P1'] }))).toEqual([]);
  });

  it('computes the disciplinary distance outside the joint publications', () => {
    const r = rankPairs(PAIRS_NET, {});
    const byKey = new Map(r.pairs.map((p: { a: { id: number }; b: { id: number }; distance: number | null }) => [`${p.a.id}-${p.b.id}`, p.distance]));
    // Without their 3 joint publications: Alice {CS 3, Medicine 2}, Chloé {Medicine 2} => 1 - 2/√13.
    expect(byKey.get('1-3')).toBe(0.45);
    // Alice {CS 5} × Denis {Medicine 2}, Bruno {CS 2} × Emma {Medicine 2}: orthogonal.
    expect(byKey.get('1-4')).toBe(1);
    expect(pairKeys(rankPairs(PAIRS_NET, { minDistance: 0.5 }))).toEqual(['1-4', '2-5']);
  });

  it('reduces the labs of each author with the membership filter', () => {
    expect(pairKeys(rankPairs(PAIRS_NET, { membership: 'associates' }))).toEqual(['1-3', '2-5']);
    // Emma has no memberships (version 2 file): her labs are kept whatever the filter.
    expect(pairKeys(rankPairs(PAIRS_NET, { membership: 'members' }))).toEqual(['2-5']);
  });

  it('excludes the PhD students on demand', () => {
    expect(pairKeys(rankPairs(PAIRS_NET, { includePhd: false }))).toEqual(['1-3', '1-4']);
  });

  it('scopes the pairs to the structure and to the visible labs', () => {
    expect(pairKeys(rankPairs(PAIRS_NET, { structureLabs: ['LAB-C'] }))).toEqual(['2-5']);
    expect(pairKeys(rankPairs(PAIRS_NET, { structureLabs: ['LAB-A', 'LAB-B'], scope: 'structure' }))).toEqual(['1-3', '1-4']);
    expect(pairKeys(rankPairs(PAIRS_NET, { visibleLabs: ['LAB-B'] }))).toEqual(['1-3', '1-4']);
  });

  it('gives a trend relative to the end of the period and counts the pairs', () => {
    const r = rankPairs(PAIRS_NET, { to: 2026 });
    const trend = new Map(r.pairs.map((p: { a: { id: number }; b: { id: number }; trend: string }) => [`${p.a.id}-${p.b.id}`, p.trend]));
    expect(trend.get('1-4')).toBe('new');
    expect(trend.get('1-3')).toBe('rising');
    expect(r.counts).toMatchObject({ new: 2, rising: 1, crossPole: 2, authors: 5 });
    // The reference year never goes past the last year of the corpus.
    expect(r.refYear).toBe(2024);
    const dormant = {
      ...PAIRS_NET,
      pubs: [{ y: 2019, n: 2, a: [1, 3], s: [] }, { y: 2020, n: 2, a: [1, 3], s: [] }, { y: 2024, n: 1, a: [4], s: [] }],
    };
    expect(rankPairs(dormant, {}).pairs[0]).toMatchObject({ trend: 'dormant', first: 2019, last: 2020 });
  });

  it('shares of production and top subfields of the joint publications', () => {
    const p = rankPairs(PAIRS_NET, {}).pairs.find((x: { a: { id: number }; b: { id: number } }) => x.a.id === 1 && x.b.id === 4);
    expect(p.share).toEqual([2 / 7, 2 / 4]);
    expect(p.subfields).toEqual(['Oncology', 'Artificial Intelligence']);
  });

  it('aggregates the kept pairs per couple of labs and of poles, and filters on a couple of labs', () => {
    const r = rankPairs(PAIRS_NET, {});
    expect(r.labMatrix).toEqual([
      { a: 'LAB-A', b: 'LAB-B', pairs: 2, new: 1, dormant: 0 },
      { a: 'LAB-A', b: 'LAB-C', pairs: 1, new: 1, dormant: 0 },
    ]);
    // Emma's lab has no pole: her pair is in no pole cell.
    expect(r.poleMatrix).toEqual([{ a: 'P1', b: 'P2', pairs: 2, new: 1, dormant: 0 }]);
    expect(pairKeys(rankPairs(PAIRS_NET, { labPair: ['LAB-C', 'LAB-A'] }))).toEqual(['2-5']);
  });

  it('counts the researchers of the structure engaged in pairs', () => {
    const r = rankPairs(PAIRS_NET, { structureLabs: ['LAB-A'] });
    expect(r.counts).toMatchObject({ perimeter: 2, perimeterEngaged: 2, perimeterCrossPole: 1 });
  });
});

// Suggested connections (druid-internal `docs/plan-binomes-chercheurs.md`, lot 3). Fictitious researchers.
// L1, L3 in pole P1; L2, L4 in pole P2. Subfields: 0 = Artificial Intelligence, 1 = Oncology.
const pubsOf = (n: number) => ({ '2021': Math.ceil(n / 2), '2022': Math.floor(n / 2) });
const SUGGEST_NET = {
  poles: [{ acronym: 'P1', name: 'Pole 1' }, { acronym: 'P2', name: 'Pole 2' }],
  labs: [
    { acronym: 'L1', pole: 'P1' }, { acronym: 'L2', pole: 'P2' }, { acronym: 'L3', pole: 'P1' }, { acronym: 'L4', pole: 'P2' },
  ],
  subfields: [{ name: 'Artificial Intelligence', field: 'Computer Science' }, { name: 'Oncology', field: 'Medicine' }],
  authors: [
    { id: 1, label: 'Ana Rivet', labs: ['L1'], pubs: pubsOf(5), uid: 'rivet-a' },
    { id: 2, label: 'Ben Losier', labs: ['L2'], pubs: pubsOf(2) },
    { id: 3, label: 'Cléo Vannier', labs: ['L3'], pubs: pubsOf(6) },
    { id: 4, label: 'Dan Moreau', labs: ['L4'], pubs: pubsOf(3) },
    { id: 5, label: 'Eva Thibaud', labs: ['L2'], phd: true, pubs: pubsOf(2) },
    { id: 6, label: 'Fred Garnier', labs: ['L1'], pubs: pubsOf(3) },
    { id: 7, label: 'Gil Pasquier', labs: ['L3'], pubs: pubsOf(3) },
  ],
  pubs: [
    // 3 co-signs with 1, 2 and 5: researchers 1 and 2 (labs and poles apart) share one co-author.
    { y: 2021, n: 3, a: [1, 3], s: [0] }, { y: 2022, n: 3, a: [1, 3], s: [0] },
    { y: 2021, n: 3, a: [2, 3], s: [0] }, { y: 2022, n: 3, a: [2, 3], s: [0] },
    { y: 2021, n: 3, a: [3, 5], s: [0] }, { y: 2022, n: 3, a: [3, 5], s: [0] },
    // 6 co-signs oncology with 1 (same lab), 4 with 7: researchers 4 and 6 only share their subfield.
    { y: 2021, n: 2, a: [1, 6], s: [1] }, { y: 2021, n: 2, a: [1, 6], s: [1] }, { y: 2022, n: 2, a: [1, 6], s: [1] },
    { y: 2021, n: 2, a: [4, 7], s: [1] }, { y: 2021, n: 2, a: [4, 7], s: [1] }, { y: 2022, n: 2, a: [4, 7], s: [1] },
    // 1 × 4 in a large collaboration only: not a link.
    { y: 2022, n: 300, a: [1, 4], s: [1] },
    // 1 × 2 after the period.
    { y: 2024, n: 3, a: [1, 2], s: [0] },
  ],
};
const PERIOD = { from: 2021, to: 2022, maxAuthors: 50 };
const sugKeys = (r: { suggestions: { a: { id: number }; b: { id: number } }[] }) => r.suggestions.map((x) => `${x.a.id}-${x.b.id}`);

describe('suggestPairs', () => {
  it('suggests researchers of different labs who share co-authors, never linked or same-lab pairs', () => {
    const r = suggestPairs(SUGGEST_NET, PERIOD);
    const keys = sugKeys(r);
    expect(keys.slice(0, 2)).toEqual(['3-6', '1-2']);
    expect(keys).not.toContain('1-3'); // already co-signed
    expect(keys).not.toContain('1-6'); // same lab
    const anaBen = r.suggestions.find((x: { a: { id: number }; b: { id: number } }) => x.a.id === 1 && x.b.id === 2);
    expect(anaBen).toMatchObject({ common: 1, crossPole: true, via: [{ id: 3, label: 'Cléo Vannier', labs: ['L3'] }] });
    expect(anaBen.a.uid).toBe('rivet-a');
  });

  it('suggests researchers close by their subfields without any common co-author', () => {
    const r = suggestPairs(SUGGEST_NET, PERIOD);
    expect(r.level).toBe('subfield');
    const fredDan = r.suggestions.find((x: { a: { id: number }; b: { id: number } }) => x.a.id === 4 && x.b.id === 6);
    expect(fredDan).toMatchObject({ common: 0, themes: ['Oncology'] });
    // Identical profiles of 3 publications, damped by 3 / (3 + 5).
    expect(fredDan.similarity).toBeCloseTo(0.38, 2);
    expect(suggestPairs(SUGGEST_NET, { ...PERIOD, signal: 'triadic' }).suggestions.some((x: { common: number }) => x.common === 0)).toBe(false);
  });

  it('leaves the PhD students out by default and ignores large collaborations as links', () => {
    expect(sugKeys(suggestPairs(SUGGEST_NET, PERIOD)).some((k) => k.split('-').includes('5'))).toBe(false);
    expect(sugKeys(suggestPairs(SUGGEST_NET, { ...PERIOD, includePhd: true }))).toContain('1-5');
    // 1 and 4 only signed a 300-author paper together: still suggested (shared subfield).
    expect(sugKeys(suggestPairs(SUGGEST_NET, PERIOD))).toContain('1-4');
  });

  it('compares the topics instead of the subfields when the network has them (version 4)', () => {
    // Oncology publications: 1 × 6 on topic 0; 4 × 7 on topic 0 (same research) or topic 1 (another one).
    const withTopics = (dan: number) => ({
      ...SUGGEST_NET,
      topics: [{ name: 'Immunotherapy Research' }, { name: 'Leukemia Treatment' }],
      pubs: SUGGEST_NET.pubs.map((p) => ({ ...p, t: p.s[0] !== 1 ? [] : p.a.includes(4) ? [dan] : [0] })),
    });
    const same = suggestPairs(withTopics(0), PERIOD);
    expect(same.level).toBe('topic');
    const fredDan = same.suggestions.find((x: { a: { id: number }; b: { id: number } }) => x.a.id === 4 && x.b.id === 6);
    expect(fredDan).toMatchObject({ common: 0, themes: ['Immunotherapy Research'] });
    // Same subfield, different topics: no longer close.
    expect(sugKeys(suggestPairs(withTopics(1), PERIOD))).not.toContain('4-6');
  });

  it('only excludes the pairs linked up to the end of the period', () => {
    expect(sugKeys(suggestPairs(SUGGEST_NET, { ...PERIOD, to: 2024 }))).not.toContain('1-2');
  });

  it('caps the suggestions per researcher and applies the access and pole filters', () => {
    expect(sugKeys(suggestPairs(SUGGEST_NET, { ...PERIOD, quota: 1 }))).toEqual(['3-6', '1-2']);
    const crossPole = sugKeys(suggestPairs(SUGGEST_NET, { ...PERIOD, crossPole: true }));
    expect(crossPole).toContain('1-2');
    expect(crossPole).not.toContain('3-6');
    const visible = sugKeys(suggestPairs(SUGGEST_NET, { ...PERIOD, visibleLabs: ['L4'] }));
    expect(visible.every((k) => k.split('-').includes('4'))).toBe(true);
    expect(visible.length).toBeGreaterThan(0);
  });
});
