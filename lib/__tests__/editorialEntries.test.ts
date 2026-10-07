import { describe, expect, it } from 'vitest';
import { aggregateCountryFocus } from '../../components/dashboard/countryAggregates';
import { countsForResearchers, neutralizeEditorialEntries } from '../../components/dashboard/editorialEntries';
import { aggregateNetwork } from '../../components/dashboard/networkAggregates';
import { aggregateResearchers } from '../../components/dashboard/structureAggregates';
import type { DashboardDataset, DashboardPublication } from '../../components/dashboard/types';

// Encyclopedia entries signed by the editors of the work (docs/plan-collaboration-pays.md,
// lot 1 b). Fictitious structure: author 1 is one of the editors of a reference work whose
// three entries carry editors from JP and US; one real co-publication with Canada.
const JP = { name: 'Tokyo Institute', cc: 'JP', city: null, lat: null, lon: null, ror: '0jp' };
const US = { name: 'Some US University', cc: 'US', city: null, lat: null, lon: null, ror: '0us' };
const CA = { name: 'Some Canadian University', cc: 'CA', city: null, lat: null, lon: null, ror: '0ca' };

const pub = (over: Partial<DashboardPublication>): DashboardPublication => ({
  year: 2023, title: 'T', doi: null, journal: 'J', pubType: 'Article de revue', teams: ['LAB'], sousStructures: [],
  authorIds: [1], countries: ['FR'], partnerInstitutions: [], nationalPartners: [], isInternational: false,
  domains: [], subfields: ['History'], topics: [], collabTypes: ['Pas de collaboration'], nantesPartners: [],
  hasPhd: false, oaStatus: 'closed', fwci: 1, isTop10Percent: false, authorCount: 1, language: 'en',
  funders: [],
  ...over,
} as unknown as DashboardPublication);

const entry = (title: string) => pub({
  title, journal: 'Encyclopedia of Things', pubType: "Notice d'encyclopédie", isEditorialEntry: true,
  countries: ['FR', 'JP', 'US'], partnerInstitutions: [JP, US], isInternational: true,
  collabTypes: ['Internationales'], nantesPartners: ['LAB2'], nantesPartnersSource: ['openalex'], authorCount: 10,
});

const PUBS = [
  entry('Entry 1'), entry('Entry 2'), entry('Entry 3'),
  pub({ title: 'With Canada', authorIds: [2], countries: ['CA', 'FR'], partnerInstitutions: [CA], isInternational: true,
    collabTypes: ['Internationales'], authorCount: 3 }),
  pub({ title: 'Own work', authorIds: [1, 2] }),
];
const RAW = {
  lab: 'LAB', name: 'Lab', slug: 'lab', teamLabel: 'Team', strategicAxes: [], publications: PUBS,
  authors: [{ id: 1, label: 'Editor', teams: ['LAB'] }, { id: 2, label: 'Author', teams: ['LAB'] }],
  members: [], effectifsAuthorIds: [], countryNames: {},
} as unknown as DashboardDataset;
const RANGE = { start: 2020, end: 2025 };

describe('editor-signed encyclopedia entries', () => {
  const ds = neutralizeEditorialEntries(RAW);

  it('loses its collaboration fields but stays in the dataset', () => {
    expect(ds.publications).toHaveLength(5);
    const e = ds.publications[0];
    expect(e).toMatchObject({
      isInternational: false, countries: ['FR'], partnerInstitutions: [], nationalPartners: [], nantesPartners: [],
      collabTypes: ['Pas de collaboration'], pubType: "Notice d'encyclopédie", authorIds: [1],
    });
    expect(e.nantesPartnersSource).toBeUndefined();
    expect(ds.publications[3]).toBe(PUBS[3]);
  });

  it('returns the same dataset when nothing is flagged', () => {
    const plain = { ...RAW, publications: PUBS.slice(3) };
    expect(neutralizeEditorialEntries(plain)).toBe(plain);
  });

  it('does not make the partner countries of the editors', () => {
    const focus = aggregateCountryFocus(ds, RANGE, 'CA');
    expect(focus.total).toBe(1);
    expect(focus.rank).toEqual({ rank: 1, of: 1 });
    expect(aggregateCountryFocus(ds, RANGE, 'JP').total).toBe(0);
  });

  it('is left out of the researcher rankings and of the co-author network', () => {
    expect(ds.publications.filter(countsForResearchers)).toHaveLength(2);
    expect(aggregateResearchers(ds.publications, ds.authors, RANGE).map((r) => `${r.label}:${r.count}`))
      .toEqual(['Author:2', 'Editor:1']);
    const net = aggregateNetwork(ds.publications, ds.authors, RANGE, 1);
    expect(net.nodes.map((n) => `${n.name}:${n.value}`).sort()).toEqual(['Author:2', 'Editor:1']);
  });
});
