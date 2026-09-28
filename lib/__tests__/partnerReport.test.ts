import { describe, expect, it } from 'vitest';
import { buildPartnerCatalog, aggregatePartnerBreakdown } from '../../components/dashboard/collabAggregates';
import { KPI_SETS } from '../../components/dashboard/kpiItems';
import { compareImpact, halfTrend, median, partnerRank } from '../../components/dashboard/partnerKpis';
import { buildFilterContext, matchesFilters } from '../../components/dashboard/publicationFilters';
import { parseReportDefinition } from '../../components/dashboard/report/definition';
import { REPORT_TABLES } from '../../components/dashboard/report/reportTables';
import { resolveReport } from '../../components/dashboard/report/resolveReport';
import { affiliatedPartners, rorOf } from '../../components/dashboard/report/rorAffiliates';
import { DEFAULT_PERIOD, templateById } from '../../components/dashboard/report/templates';
import type { DashboardDataset, DashboardPublication } from '../../components/dashboard/types';

// « Collaboration avec une université » template (docs/plan-mes-rapports.md, lot 7). Fictitious
// composite structure: labs A and B; partners Ottawa (+ its hospital) and Laval; FWCI chosen so
// that the comparable reference is easy to check by hand.
const OTTAWA = { name: 'University of Ottawa', cc: 'CA', city: null, lat: null, lon: null, ror: '03c4mmv16' };
const HOSPITAL = { name: 'Ottawa Hospital', cc: 'CA', city: null, lat: null, lon: null, ror: '03c62dg59' };
const LAVAL = { name: 'Université Laval', cc: 'CA', city: null, lat: null, lon: null, ror: '04sjchr03' };
const NO_ROR = { name: 'Some Clinic', cc: 'CA', city: null, lat: null, lon: null, ror: null };
const DE = { name: 'TU Berlin', cc: 'DE', city: null, lat: null, lon: null, ror: '03v4gjf40' };

const pub = (over: Partial<DashboardPublication>): DashboardPublication => ({
  year: 2023, title: 'T', doi: null, journal: 'J', pubType: 'Article de revue', teams: [], sousStructures: ['LAB-A'],
  authorIds: [1], countries: ['CA'], partnerInstitutions: [], nationalPartners: [], isInternational: true,
  domains: [], subfields: ['Cardiology'], topics: [], collabTypes: [], nantesPartners: [], hasPhd: false,
  oaStatus: 'gold', fwci: 1, isTop10Percent: false, authorCount: 5,
  ...over,
} as unknown as DashboardPublication);

const PUBS = [
  // Co-publications with Ottawa (FWCI 2, 3, 4 in cardiology; one large consortium).
  pub({ year: 2021, partnerInstitutions: [OTTAWA], fwci: 2, authorIds: [1, 2], title: 'A' }),
  pub({ year: 2022, partnerInstitutions: [OTTAWA, HOSPITAL], fwci: 3, isTop10Percent: true, authorIds: [2], title: 'B' }),
  pub({ year: 2024, partnerInstitutions: [OTTAWA], fwci: 4, sousStructures: ['LAB-B'], title: 'C', doi: '10.1/c' }),
  pub({ year: 2025, partnerInstitutions: [OTTAWA], fwci: 40, authorCount: 400, sousStructures: [], title: 'D' }),
  pub({ year: 2025, partnerInstitutions: [LAVAL], fwci: 1, title: 'E' }),
  pub({ year: 2024, partnerInstitutions: [NO_ROR], title: 'F' }),
  // Other international co-publications of the structure in cardiology: the reference.
  ...[1, 1, 1, 1, 2].map((fwci, i) => pub({ year: 2023, partnerInstitutions: [DE], countries: ['DE'], fwci, title: `R${i}` })),
  pub({ year: 2023, partnerInstitutions: [DE], countries: ['DE'], fwci: 1, isTop10Percent: true, title: 'R5' }),
];
const DS = {
  lab: 'UNIV', name: 'University', slug: 'univ', teamLabel: 'Team', strategicAxes: [], publications: PUBS,
  authors: [{ id: 1, label: 'A1', teams: ['LAB-A'] }, { id: 2, label: 'A2', teams: ['LAB-A'] }],
  members: [], effectifsAuthorIds: [], countryNames: {},
} as unknown as DashboardDataset;
const RANGE = { start: 2021, end: 2025 };
const copubs = PUBS.filter((p) => p.partnerInstitutions.some((o) => o.ror === '03c4mmv16'));
const at = new Date('2026-09-28T12:00:00Z');

describe('partner keys', () => {
  it('matches institutions without a ROR by their catalog key', () => {
    const catalog = buildPartnerCatalog(PUBS);
    const noRor = catalog.find((c) => c.name === 'Some Clinic')!;
    expect(noRor.key).toBe('international:Some Clinic');
    const ctx = buildFilterContext(DS);
    expect(PUBS.filter((p) => matchesFilters(p, { partnerKeys: [noRor.key] }, ctx)).map((p) => p.title)).toEqual(['F']);
    const b = aggregatePartnerBreakdown(PUBS, RANGE, [noRor.key, '03c4mmv16'], [], catalog);
    expect(b.entries.map((e) => `${e.name}:${e.total}`)).toEqual(['University of Ottawa:4', 'Some Clinic:1']);
  });
});

describe('partner key figures', () => {
  it('computes the half-period trend', () => {
    expect(halfTrend(copubs, RANGE)).toMatchObject({ a: 2, b: 2, change: 0, first: { start: 2021, end: 2022 }, second: { start: 2024, end: 2025 } });
  });

  it('ranks the partner globally and in its country', () => {
    expect(partnerRank(PUBS, '03c4mmv16')).toMatchObject({ rank: 2, of: 5, countryCode: 'CA', countryRank: 1 });
    expect(partnerRank(PUBS, 'nope')).toBeNull();
  });

  it('compares impact with the international co-publications of the same subfields', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    const c = compareImpact(copubs, PUBS, RANGE, 50);
    // Large consortium (FWCI 40) left out: median of 2, 3, 4.
    expect(c.fwciMedian).toBe(3);
    expect(c.top10Share).toBeCloseTo(1 / 3);
    // Reference: international cardiology publications of the structure (large consortium excluded).
    expect(c.refFwciMedian).toBe(1);
    expect(c.coverage).toBe(1);
  });

  it('exposes the collaboration sets with the whole corpus as context', () => {
    const ds = { ...DS, publications: copubs };
    const items = KPI_SETS.partner.items(ds, RANGE, { source: DS, filters: { partnerKeys: ['03c4mmv16'] } });
    expect(Object.fromEntries(items.map((i) => [i.key, i.value]))).toMatchObject({
      copubs: '4', rank: '2', researchers: '2', labs: '2', open: '100 %', large: '25 %',
    });
    expect(items.find((i) => i.key === 'labs')?.hint).toMatch(/1/);
  });
});

describe('ROR affiliated institutions', () => {
  it('suggests the children and related organizations that co-signed with the structure', async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toBe('https://api.ror.org/v2/organizations/03c4mmv16');
      return new Response(JSON.stringify({
        relationships: [
          { type: 'related', id: 'https://ror.org/03c62dg59', label: 'Ottawa Hospital' },
          { type: 'child', id: 'https://ror.org/05jtef216', label: 'Research Institute (no co-publication)' },
          { type: 'parent', id: 'https://ror.org/0xxxxxxx1', label: 'Parent' },
        ],
      }));
    }) as unknown as typeof fetch;
    const catalog = buildPartnerCatalog(PUBS);
    const a = await affiliatedPartners(['03c4mmv16'], catalog, fetchImpl);
    expect(a.map((e) => e.key)).toEqual(['03c62dg59']);
    expect(await affiliatedPartners(['03c4mmv16', '03c62dg59'], catalog, fetchImpl)).toEqual([]);
    expect(rorOf('international:Some Clinic')).toBeNull();
  });
});

describe('collaboration template', () => {
  const template = templateById('partner')!;
  const input = { name: 'UNIV × Ottawa', slug: 'univ', period: DEFAULT_PERIOD, perimetre: 'affiliation' as const, lang: 'en' as const };

  it('builds a valid report restricted to the partner group', () => {
    const def = template.build({ ...input, partners: ['03c4mmv16', '03c62dg59'] }, { dataset: DS, hiddenTabs: [] });
    expect(parseReportDefinition(def).ok).toBe(true);
    expect(def.context.filters).toEqual({ partnerKeys: ['03c4mmv16', '03c62dg59'] });
    expect(def.footerNote).toBeTruthy();
    expect(def.description).toContain('University of Ottawa');
    const charts = def.blocks.flatMap((b) => (b.kind === 'chart' ? [b.chartId] : []));
    expect(charts).toContain('partner-breakdown-top'); // ≥ 2 institutions
    expect(charts).toContain('labos-classement'); // composite structure
    expect(charts).not.toContain('pourcentage-international'); // degenerate under the partner filter
    // Impact blocks leave large collaborations out; the annex lists the co-publications.
    const fwci = def.blocks.find((b) => b.kind === 'chart' && b.chartId === 'distribution-fwci')!;
    expect(fwci).toMatchObject({ override: { filters: { maxAuthors: 50 } } });
    expect(def.blocks.at(-1)).toMatchObject({ kind: 'table', tableId: 'publications' });
  });

  it('drops the per-university section for a single partner, and resolves on the co-publications', () => {
    const def = template.build({ ...input, partners: ['03c4mmv16'] }, { dataset: DS, hiddenTabs: [] });
    expect(def.blocks.some((b) => b.kind === 'chart' && b.chartId.startsWith('partner-breakdown'))).toBe(false);
    const r = resolveReport(def, { univ: DS }, at);
    expect(r.publicationCount).toBe(4);
    const impact = r.blocks.find((b) => b.block.kind === 'kpis' && b.block.setId === 'partner-impact')!;
    expect(impact.dataset?.publications.map((p) => p.title)).toEqual(['A', 'B', 'C']);
    expect(impact.source?.publications).toHaveLength(PUBS.length);
  });

  it('needs a partner group for the per-university charts', () => {
    const def = template.build({ ...input, partners: ['03c4mmv16', '04sjchr03'] }, { dataset: DS, hiddenTabs: [] });
    const single = { ...def, context: { ...def.context, filters: { partnerKeys: ['03c4mmv16'] } } };
    const r = resolveReport(single, { univ: DS }, at);
    const top = r.blocks.find((b) => b.block.kind === 'chart' && b.block.chartId === 'partner-breakdown-top')!;
    expect(top).toMatchObject({ status: 'missing-feature', missing: ['partnerGroup'] });
  });
});

describe('publication list table', () => {
  it('lists the publications of the period, most recent first, with labs and DOI links', () => {
    const t = REPORT_TABLES.publications.build({ ...DS, publications: copubs }, RANGE, 2);
    expect(t.rows.map((r) => r[1])).toEqual(['D', 'C']);
    expect(t.rows[1]).toEqual(['2024', 'C', 'J', 'LAB-B']);
    expect(t.links).toEqual([null, 'https://doi.org/10.1/c']);
    expect(t.omitted).toBe(2);
  });
});
