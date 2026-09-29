import { describe, expect, it } from 'vitest';
import { partnerLabProvenance } from '../../components/dashboard/collabAggregates';
import type { DashboardPublication } from '../../components/dashboard/types';

const pub = (year: number, partners: string[], source?: DashboardPublication['nantesPartnersSource']) =>
  ({ year, nantesPartners: partners, nantesPartnersSource: source }) as unknown as DashboardPublication;

describe('partnerLabProvenance', () => {
  it('counts publications found only through the graph memberships', () => {
    const pubs = [
      pub(2022, ['IETR'], ['crisalid']),
      pub(2022, ['IETR', 'GeM'], ['openalex', 'crisalid']),
      pub(2023, ['LS2N'], ['both']),
      pub(2023, []),
      pub(2023, ['CR2TI']), // export without provenance: OpenAlex
      pub(2019, ['ITX'], ['crisalid']), // out of range
    ];
    expect(partnerLabProvenance(pubs, { start: 2020, end: 2025 })).toEqual({ total: 4, graphOnly: 1 });
  });
});
