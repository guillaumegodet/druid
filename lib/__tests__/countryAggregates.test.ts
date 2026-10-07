import { describe, expect, it } from 'vitest';
import {
  aggregateCountryFocus,
  countryBounds,
  countryOptions,
  hasCountry,
  publicationCountries,
} from '../../components/dashboard/countryAggregates';
import { buildFilterContext, matchesFilters } from '../../components/dashboard/publicationFilters';
import type { DashboardDataset, DashboardPublication } from '../../components/dashboard/types';

// « Pays » sub-tab of the Collaborations tab (docs/plan-collaboration-pays.md, lot 1). Fictitious
// institution export (labs carried by the authors): country CA with two universities and a hospital
// affiliated with the first one, third countries DE and US, the cases found by the lot 0 audit.
const UNIV_A = { name: 'Univ Alpha', cc: 'CA', city: 'Montréal', region: 'Quebec', lat: 45.5, lon: -73.6, ror: '0aaaaaaa1' };
const HOSP_A = {
  name: 'Alpha Hospital', cc: 'CA', city: 'Montréal', region: 'Quebec', lat: 45.5, lon: -73.5, ror: '0aaaaaaa2',
  parent: { ror: '0aaaaaaa1', name: 'Univ Alpha' },
};
const UNIV_B = { name: 'Univ Beta', cc: 'CA', city: 'Vancouver', region: 'British Columbia', lat: 49.2, lon: -123.1, ror: '0bbbbbbb1' };
const DE = { name: 'TU Somewhere', cc: 'DE', city: null, lat: null, lon: null, ror: '0ddddddd1' };
const US = { name: 'US College', cc: 'US', city: null, lat: null, lon: null, ror: '0uuuuuuu1' };

const pub = (over: Partial<DashboardPublication>): DashboardPublication => ({
  year: 2022, title: 'T', doi: null, journal: 'J', pubType: 'Article de revue', teams: [], sousStructures: [],
  authorIds: [1], countries: ['CA'], partnerInstitutions: [], nationalPartners: [], isInternational: true,
  domains: ['Health Sciences'], subfields: ['Cardiology'], topics: [], collabTypes: [], nantesPartners: [],
  hasPhd: false, oaStatus: 'gold', fwci: 2, isTop10Percent: false, authorCount: 5, language: 'en', funders: [],
  ...over,
} as unknown as DashboardPublication);

const PUBS = [
  // 1. Bilateral, two funders (Canadian and French).
  pub({ year: 2021, title: 'P1', partnerInstitutions: [UNIV_A],
    funders: [{ id: 'F1', name: 'Canadian council', ror: null, cc: 'CA' }, { id: null, name: 'ANR', ror: null, cc: 'FR' }] }),
  // 2. Multilateral with DE, a university and its hospital, a funder of unknown country.
  pub({ year: 2022, title: 'P2', partnerInstitutions: [UNIV_A, HOSP_A, DE], countries: ['CA', 'DE'], authorIds: [1, 2], fwci: 3,
    funders: [{ id: 'F9', name: 'Mystery fund', ror: null }] }),
  // 3. US institution missing from `countries`: still a third country.
  pub({ year: 2023, title: 'P3', partnerInstitutions: [UNIV_B, US], subfields: ['Urban Studies'], fwci: 4 }),
  // 4. Canada known only through its institution, flagged national by an old export.
  pub({ year: 2024, title: 'P4', partnerInstitutions: [HOSP_A], countries: ['FR'], isInternational: false }),
  // 5. Canada known only through `countries` (no Canadian institution), in French, no lab.
  pub({ year: 2024, title: 'P5', authorIds: [], language: 'fr' }),
  // 6. Large collaboration.
  pub({ year: 2023, title: 'P6', partnerInstitutions: [UNIV_B], authorCount: 400, fwci: 40 }),
  // Out of the period.
  pub({ year: 2020, title: 'P0', partnerInstitutions: [UNIV_A] }),
  // Reference: international co-publications with DE only, cardiology.
  ...[1, 1, 1, 1, 2, 1].map((fwci, i) => pub({ year: 2022, title: `R${i}`, partnerInstitutions: [DE], countries: ['DE'], fwci })),
];
const DS = {
  lab: 'UNIV', name: 'University', slug: 'univ', teamLabel: 'laboratoire', strategicAxes: [], publications: PUBS,
  authors: [{ id: 1, label: 'Researcher One', teams: ['LAB-A'] }, { id: 2, label: 'Researcher Two', teams: ['LAB-B'] }],
  members: [], effectifsAuthorIds: [], countryNames: { CA: { fr: 'Canada', echarts: 'Canada', eu: false } },
} as unknown as DashboardDataset;
const RANGE = { start: 2021, end: 2024 };
const titles = (ps: DashboardPublication[]) => ps.map((p) => p.title).sort();

describe('countries of a publication', () => {
  it('adds the countries of the partner institutions', () => {
    expect(publicationCountries(PUBS[2]).sort()).toEqual(['CA', 'US']);
    expect(hasCountry(PUBS[3], 'CA')).toBe(true);
    expect(hasCountry(PUBS[3], 'DE')).toBe(false);
  });

  it('the country filter of the publication list follows the same rule', () => {
    const ctx = buildFilterContext(DS);
    expect(titles(PUBS.filter((p) => matchesFilters(p, { country: 'CA' }, ctx)))).toEqual(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  });

  it('lists the partner countries of the period, most frequent first', () => {
    expect(countryOptions(PUBS, RANGE, DS.countryNames).map((o) => `${o.cc}:${o.count}`)).toEqual(['DE:7', 'CA:6', 'US:1']);
  });
});

describe('aggregateCountryFocus', () => {
  const f = aggregateCountryFocus(DS, RANGE, 'CA');

  it('counts the co-publications of the period, large collaborations included', () => {
    expect(titles(f.pubs)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    expect(f.total).toBe(6);
    expect(f.international).toBe(12);
    expect(f.shareOfInternational).toBe(50);
    expect(f.rank).toEqual({ rank: 2, of: 3 });
    expect(f.label).toBe('Canada');
    expect(f.large).toBe(1);
    expect(f.openAccess).toBe(6);
  });

  it('gives every year of the range with the share of the international co-publications', () => {
    expect(f.byYear).toEqual([
      { year: 2021, count: 1, international: 1, share: 100 },
      { year: 2022, count: 1, international: 7, share: 14.3 },
      { year: 2023, count: 2, international: 2, share: 100 },
      { year: 2024, count: 2, international: 2, share: 100 },
    ]);
    expect(f.trend).toMatchObject({ a: 2, b: 4, change: 100 });
  });

  it('highlights the country among the partner countries', () => {
    expect(f.topCountries.map((c) => `${c.cc}:${c.selected}`)).toEqual(['DE:false', 'CA:true', 'US:false']);
    expect(aggregateCountryFocus(DS, RANGE, 'US', { topCountries: 1 }).topCountries.map((c) => c.cc)).toEqual(['DE', 'US']);
  });

  it('splits bilateral and multilateral co-publications', () => {
    expect([f.bilateral, f.multilateral]).toEqual([4, 2]);
    expect(f.thirdCountries.map((c) => `${c.cc}:${c.count}`)).toEqual(['DE:1', 'US:1']);
  });

  it('lists the institutions of the country only', () => {
    expect(f.institutions.map((i) => `${i.name}:${i.count}`)).toEqual(['Alpha Hospital:2', 'Univ Alpha:2', 'Univ Beta:2']);
    expect(f.institutions.every((i) => i.affiliates.length === 0)).toBe(true);
  });

  it('folds hospitals under their university on demand, once per publication', () => {
    const g = aggregateCountryFocus(DS, RANGE, 'CA', { groupAffiliates: true });
    expect(g.institutions.map((i) => `${i.name}:${i.count}`)).toEqual(['Univ Alpha:3', 'Univ Beta:2']);
    expect(g.institutions[0]).toMatchObject({ key: '0aaaaaaa1', affiliates: ['Alpha Hospital'], city: 'Montréal' });
    expect(g.institutions[0].partnerKeys.sort()).toEqual(['0aaaaaaa1', '0aaaaaaa2']);
    // The keys open the same publications in the list.
    const ctx = buildFilterContext(DS);
    const listed = PUBS.filter((p) => matchesFilters(p, { country: 'CA', partnerKeys: g.institutions[0].partnerKeys }, ctx));
    expect(titles(listed.filter((p) => (p.year as number) >= 2021))).toEqual(['P1', 'P2', 'P4']);
  });

  it('counts the regions and maps the institutions', () => {
    expect(f.regions).toEqual([{ key: 'Quebec', count: 3 }, { key: 'British Columbia', count: 2 }]);
    expect(f.withRegion).toBe(5);
    expect(f.mapPoints.map((p) => `${p.name}:${p.value}`).sort()).toEqual(['Alpha Hospital:2', 'Univ Alpha:2', 'Univ Beta:2']);
    const [[west, north], [east, south]] = f.bounds!;
    expect(west).toBeCloseTo(-123.1 - 49.6 * 0.15);
    expect(east).toBeCloseTo(-73.5 + 49.6 * 0.15);
    expect(north).toBeCloseTo(49.2 + 0.65);
    expect(south).toBeCloseTo(45.5 - 0.65);
  });

  it('gives the internal labs, researchers and the lab × institution matrix', () => {
    expect(f.units).toEqual({ kind: 'labs', top: [{ key: 'LAB-A', count: 5 }, { key: 'LAB-B', count: 1 }], count: 2, without: 1 });
    expect(f.researchers.count).toBe(2);
    expect(f.researchers.top[0]).toMatchObject({ id: 1, label: 'Researcher One (LAB-A)', count: 5 });
    expect(f.matrix.units).toEqual(['LAB-A', 'LAB-B']);
    expect(f.matrix.institutions).toEqual(['Alpha Hospital', 'Univ Alpha', 'Univ Beta']);
    const cell = (u: string, i: string) =>
      f.matrix.cells.find((c) => f.matrix.units[c.y] === u && f.matrix.institutions[c.x] === i)?.v ?? 0;
    expect([cell('LAB-A', 'Univ Alpha'), cell('LAB-A', 'Alpha Hospital'), cell('LAB-B', 'Univ Alpha'), cell('LAB-B', 'Univ Beta')])
      .toEqual([2, 2, 1, 0]);
  });

  it('measures the specialization against all the international co-publications', () => {
    expect(f.specializationMin).toBe(5);
    expect(f.specialization).toEqual([{ key: 'Cardiology', count: 5, share: 5 / 6, refShare: 11 / 12, index: 0.91 }]);
    expect(f.topSubfields).toEqual([{ key: 'Cardiology', count: 5 }, { key: 'Urban Studies', count: 1 }]);
    expect(f.languages).toEqual([{ key: 'en', count: 5 }, { key: 'fr', count: 1 }]);
  });

  it('classifies the funders by country', () => {
    expect(f.funded).toBe(2);
    expect(f.funderOrigins).toEqual({ country: 1, france: 1, other: 0, unknown: 1 });
    expect(f.funders.map((x) => `${x.name}:${x.origin}`)).toEqual(['ANR:france', 'Canadian council:country', 'Mystery fund:unknown']);
  });

  it('compares the impact with the other international co-publications, large ones left out', () => {
    expect(f.impact).toMatchObject({ fwciMedian: 2, withFwci: 5, refFwciMedian: 1, coverage: 0.8 });
  });

  it('can leave the large collaborations out everywhere', () => {
    const g = aggregateCountryFocus(DS, RANGE, 'CA', { maxAuthors: 50 });
    expect(g.total).toBe(5);
    expect(g.large).toBe(0);
    expect(g.international).toBe(11);
  });

  it('returns an empty focus for a country without co-publication', () => {
    const g = aggregateCountryFocus(DS, RANGE, 'JP');
    expect([g.total, g.rank, g.bounds, g.shareOfInternational]).toEqual([0, null, null, 0]);
    expect(g.specialization).toEqual([]);
  });
});

describe('countryBounds', () => {
  it('trims outliers from 50 signatures on and keeps a minimal extent', () => {
    const b = countryBounds([
      { name: 'Main', city: null, lat: 45, lon: -75, value: 60 },
      { name: 'Far away', city: null, lat: 21, lon: -158, value: 1 },
    ])!;
    expect(b[0][0]).toBeCloseTo(-79);
    expect(b[1][0]).toBeCloseTo(-71);
    expect(b[0][1]).toBeCloseTo(47.5);
    expect(b[1][1]).toBeCloseTo(42.5);
  });

  it('is null without any point', () => {
    expect(countryBounds([])).toBeNull();
  });
});
