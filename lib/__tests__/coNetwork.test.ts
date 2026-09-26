import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// Inter-lab co-authorship graph (scripts/lib/co_network.cjs, docs/plan-reseau-inter-labos.md lots 2 and 4).
const { buildInterLabNetwork, commonPublications, OTHER_LABS_CATEGORY } = createRequire(import.meta.url)(
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
