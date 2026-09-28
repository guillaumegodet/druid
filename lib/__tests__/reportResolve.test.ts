import { describe, expect, it } from 'vitest';
import type { ReportDefinition } from '../../components/dashboard/report/definition';
import { parseInline, parseMarkdownLite, plainText } from '../../components/dashboard/report/markdownLite';
import { reportSlugs, resolveReport } from '../../components/dashboard/report/resolveReport';
import type { DashboardDataset, DashboardPublication } from '../../components/dashboard/types';

// Resolution of a report against loaded datasets, and the Markdown subset of text blocks
// (docs/plan-mes-rapports.md, lot 3). Fictitious corpus.

const pub = (over: Partial<DashboardPublication>): DashboardPublication => ({
  year: 2023, title: 'T', doi: null, journal: null, pubType: 'Article de revue', teams: [], sousStructures: [],
  authorIds: [], countries: [], partnerInstitutions: [], nationalPartners: [], isInternational: false,
  domains: [], subfields: [], topics: [], collabTypes: [], nantesPartners: [], authorCount: 3,
  ...over,
} as unknown as DashboardPublication);
const OTTAWA = { name: 'University of Ottawa', cc: 'CA', city: null, lat: null, lon: null, ror: '03c4mmv16' };
const dataset = (slug: string, publications: DashboardPublication[]): DashboardDataset => ({
  lab: slug.toUpperCase(), name: slug, slug, teamLabel: 'Team', strategicAxes: [], publications,
  authors: [], members: [], effectifsAuthorIds: [], countryNames: {},
} as unknown as DashboardDataset);

const LAB = dataset('lab', [
  pub({ year: 2022, partnerInstitutions: [OTTAWA], isInternational: true }),
  pub({ year: 2023, partnerInstitutions: [OTTAWA], isInternational: true, authorCount: 300 }),
  pub({ year: 2024 }),
  pub({ year: 2019, partnerInstitutions: [OTTAWA] }),
]);
const OTHER = dataset('other', [pub({ year: 2023, sousStructures: ['A'] })]);

const def: ReportDefinition = {
  schemaVersion: 1,
  name: 'Lab × Ottawa',
  description: '',
  context: { slug: 'lab', perimetre: 'affiliation', period: { kind: 'fixed', start: 2020, end: 2025 }, filters: { partnerKeys: ['03c4mmv16'] } },
  blocks: [
    { id: 's1', kind: 'section', title: 'Overview' },
    { id: 'c1', kind: 'chart', chartId: 'publications-par-annee' },
    { id: 'c2', kind: 'chart', chartId: 'distribution-fwci', override: { filters: { maxAuthors: 50 } } },
    { id: 'c3', kind: 'chart', chartId: 'funders-par-labo' },
    { id: 'c4', kind: 'chart', chartId: 'collab-structure-top', override: { slug: 'other', filters: { partnerKeys: [] } } },
    { id: 'c5', kind: 'chart', chartId: 'pourcentage-international', params: { n: 3 } },
    { id: 'k1', kind: 'kpis', setId: 'overview' },
  ],
  lang: 'fr',
};
const at = new Date('2026-09-28T12:00:00Z');

describe('resolveReport', () => {
  it('lists every structure the report reads, global first', () => {
    expect(reportSlugs(def)).toEqual(['lab', 'other']);
  });

  it('marks blocks as loading until their dataset arrives, then resolves the scopes', () => {
    const loading = resolveReport(def, { lab: LAB }, at);
    expect(loading.blocks.find((b) => b.block.id === 'c4')?.status).toBe('loading');
    expect(loading.publicationCount).toBe(2);

    const r = resolveReport(def, { lab: LAB, other: OTHER }, at);
    const byId = Object.fromEntries(r.blocks.map((b) => [b.block.id, b]));
    expect(byId.s1.status).toBe('ok');
    expect(byId.c1.dataset?.publications).toHaveLength(3);
    // Block filters are merged over the report filters.
    expect(byId.c2.scope?.filters).toEqual({ partnerKeys: ['03c4mmv16'], maxAuthors: 50 });
    expect(byId.c2.dataset?.publications).toHaveLength(2);
    expect(byId.c2.scope?.overridden).toBe(true);
    expect(byId.c1.scope?.overridden).toBe(false);
    // Blocks sharing a scope share the restricted dataset (memoized aggregates computed once).
    expect(byId.c1.dataset).toBe(byId.k1.dataset);
    // A chart the structure cannot show.
    expect(byId.c3).toMatchObject({ status: 'missing-feature', missing: ['composite'], dataset: null });
    // Override of the structure (composite): available there, with an emptied partner filter.
    expect(byId.c4.status).toBe('ok');
    expect(byId.c4.dataset?.publications).toHaveLength(1);
    // Degenerate chart signalled, unknown parameter dropped.
    expect(byId.c5.trivial).toEqual(['partnerKeys']);
    expect(byId.c5.params).toEqual({});
  });

  it('says so when a structure has no data (or is not readable)', () => {
    const r = resolveReport(def, { lab: null, other: OTHER }, at);
    expect(r.blocks.find((b) => b.block.id === 'c1')?.status).toBe('no-data');
    expect(r.publicationCount).toBeNull();
  });

  it('resolves relative periods against the current date', () => {
    const rel = { ...def, context: { ...def.context, period: { kind: 'relative' as const, lastYears: 3, includeCurrent: false } } };
    expect(resolveReport(rel, { lab: LAB }, at).scope.range).toEqual({ start: 2023, end: 2025 });
  });
});

describe('markdownLite', () => {
  it('parses headings, bullets and paragraphs', () => {
    const nodes = parseMarkdownLite('# Title\n\nFirst line\nsame paragraph.\n\n- one\n- **two**\n\n## Sub');
    expect(nodes.map((n) => n.kind)).toEqual(['heading', 'paragraph', 'bullets', 'heading']);
    expect(nodes[1]).toEqual({ kind: 'paragraph', inline: [{ text: 'First line same paragraph.' }] });
    expect(nodes[2]).toMatchObject({ kind: 'bullets', items: [[{ text: 'one' }], [{ text: 'two', bold: true }]] });
    expect(nodes[3]).toMatchObject({ kind: 'heading', level: 2 });
  });

  it('flattens inline marks and keeps link targets for the PDF', () => {
    const runs = parseInline('See *this* and [the site](https://example.org).');
    expect(runs).toEqual([
      { text: 'See ' }, { text: 'this', italic: true }, { text: ' and ' },
      { text: 'the site', url: 'https://example.org' }, { text: '.' },
    ]);
    expect(plainText(runs)).toBe('See this and the site (https://example.org).');
    // Only http(s) links become links.
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ text: '[x](javascript:alert(1))' }]);
  });
});
