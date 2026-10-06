import { describe, it, expect } from 'vitest';
import {
  filterStaff, presenceByYear, ageBracketOf, mergedBracketLabel, mergeSmallBrackets, publicationRateByAge,
  agePyramid, publicationsPerMember, staffKpis, hasStaffAttributes, publicationsDistribution, publicationStepLabel,
  DEFAULT_STAFF_FILTER, StaffMember, StaffFilter,
} from '../../components/dashboard/staffAggregates';
import type { DashboardPublication, MemberMeta } from '../../components/dashboard/types';

const RANGE = { start: 2022, end: 2026 };
const AS_OF = '2026-10-06';

const member = (label: string, extra: Partial<MemberMeta>): MemberMeta => ({
  label, type: null, teams: [], isPhd: false, employer: null, authorId: null,
  membershipType: 'stat_mmb', category: 'permanent', fte: 1, researchFte: 0.5, researchFteEstimated: false,
  birthYear: null, startDate: null, endDate: null, ...extra,
});
const pub = (year: number, authorIds: number[]): DashboardPublication => ({ year, authorIds } as unknown as DashboardPublication);

// A: lecturer born 1980 (42-46 → 35-44 then 45-54), whole period.
// B: professor born 1960, arrived 2024-09-01.  C: PhD student without research FTE.
// D: researcher born 1990 (FTE 1, estimated), left on 2023-08-31.  E: former member without end date.
const dataset = {
  members: [
    member('A', { authorId: 1, birthYear: 1980 }),
    member('B', { authorId: 2, birthYear: 1960, startDate: '2024-09-01' }),
    member('C', { authorId: 3, category: 'doctorant', isPhd: true, researchFte: null, membershipType: null, birthYear: 1999 }),
    member('Assoc', { authorId: 5, membershipType: 'assoc_mmb', category: null, researchFte: null }),
  ],
  formerMembers: [
    member('D', { authorId: 4, birthYear: 1990, researchFte: 1, researchFteEstimated: true, endDate: '2023-08-31', departureReason: 'parti' }),
    member('E', { authorId: 6, birthYear: 1970, departureReason: 'ldap' }),
  ],
};
const filter = (f: Partial<StaffFilter>): StaffFilter => ({ ...DEFAULT_STAFF_FILTER, ...f });
const staffOf = (f: Partial<StaffFilter> = {}): StaffMember[] => filterStaff(dataset, filter(f), RANGE, AS_OF);

describe('filterStaff', () => {
  it('current members by default, former members only for « period »', () => {
    expect(staffOf().map((m) => m.label)).toEqual(['A', 'B', 'C', 'Assoc']);
    // E has no end date: cannot be placed in the period, left out.
    expect(staffOf({ presence: 'period' }).map((m) => m.label)).toEqual(['A', 'B', 'C', 'Assoc', 'D']);
  });

  it('membership and category filters, « none » for missing values', () => {
    const labo = staffOf({ memberships: ['stat_mmb', 'none'], categories: ['permanent', 'doctorant'] });
    expect(labo.map((m) => m.label)).toEqual(['A', 'B', 'C']);
    expect(staffOf({ categories: ['none'] }).map((m) => m.label)).toEqual(['Assoc']);
  });

  it('PhD flag as category fallback for older exports', () => {
    const old = { members: [{ label: 'X', type: 'Doctorant', teams: [], isPhd: true, employer: null, authorId: 1 }] };
    expect(hasStaffAttributes(old)).toBe(false);
    expect(filterStaff(old, filter({ categories: ['doctorant'] }), RANGE, AS_OF)).toHaveLength(1);
    expect(hasStaffAttributes(dataset)).toBe(true);
  });
});

describe('presenceByYear', () => {
  it('whole years, then the current year up to asOf', () => {
    const p = presenceByYear({ startDate: null, endDate: null }, RANGE, AS_OF);
    expect(p.get(2022)).toBe(1);
    expect(p.get(2026)).toBeCloseTo(279 / 365, 6);
  });

  it('arrival and departure dates, fuzzy dates by their bounds', () => {
    expect(presenceByYear({ startDate: '2024-09-01', endDate: null }, RANGE, AS_OF).get(2024)).toBeCloseTo(122 / 366, 6);
    expect(presenceByYear({ startDate: '2024-09-01', endDate: null }, RANGE, AS_OF).get(2023)).toBe(0);
    expect(presenceByYear({ startDate: null, endDate: '2023-06' }, RANGE, AS_OF).get(2023)).toBeCloseTo(181 / 365, 6);
    expect(presenceByYear({ startDate: null, endDate: '2023' }, RANGE, AS_OF).get(2024)).toBe(0);
  });

  it('a former member without end date gets nothing', () => {
    expect(presenceByYear({ startDate: null, endDate: null, former: true }, RANGE, AS_OF).size).toBe(0);
  });
});

describe('age brackets', () => {
  it('bracket of an age, unknown without birth year', () => {
    expect(ageBracketOf(34)).toBe('<35');
    expect(ageBracketOf(35)).toBe('35-44');
    expect(ageBracketOf(55)).toBe('55+');
    expect(ageBracketOf(null)).toBe('unknown');
  });

  it('labels of merged brackets', () => {
    expect(mergedBracketLabel(['45-54', '55+'])).toBe('45+');
    expect(mergedBracketLabel(['<35', '35-44'])).toBe('<45');
    expect(mergedBracketLabel(['35-44', '45-54'])).toBe('35-54');
  });

  const ppl = (...names: string[]) => new Set(names);
  it('an under-populated bracket joins its smaller neighbour (D6)', () => {
    const people = new Map([['<35', ppl('a', 'b', 'c', 'd', 'e')], ['35-44', ppl('f', 'g')], ['45-54', ppl('h', 'i', 'j', 'o', 'p', 'q', 'r', 's')], ['55+', ppl('k', 'l', 'm', 'n')]]);
    expect(mergeSmallBrackets(people, 3)).toEqual([['<35', '35-44'], ['45-54'], ['55+']]);
    expect(mergeSmallBrackets(new Map([['55+', ppl('a', 'b')]]), 3)).toEqual([['55+']]);   // nothing to merge with
    expect(mergeSmallBrackets(new Map([['<35', ppl('a')], ['55+', ppl('b')]]), 3)).toEqual([['<35', '55+']]);
  });

  it('counts distinct people: someone who changed bracket counts once', () => {
    // a and b moved from 35-44 to 45-54 during the period: 2 people, not 4.
    const people = new Map([['35-44', ppl('a', 'b')], ['45-54', ppl('a', 'b')], ['55+', ppl('c', 'd', 'e')]]);
    expect(mergeSmallBrackets(people, 3)).toEqual([['35-44', '45-54', '55+']]);
  });
});

describe('publicationRateByAge', () => {
  const pubs = [
    pub(2022, [1]),        // A (42, 35-44)
    pub(2022, [1, 4]),     // A + D (32, <35): once in each bracket, once overall
    pub(2023, [2]),        // B not yet present in 2023: not counted
    pub(2025, [2, 3]),     // B (65, 55+); C has no research FTE
    pub(2025, [3]),        // C only: out of the rate
    pub(2021, [1]),        // out of range
  ];
  const r = publicationRateByAge(pubs, staffOf({ presence: 'period' }), RANGE, AS_OF, 1);
  const byKey = Object.fromEntries(r.brackets.map((b) => [b.key, b]));

  it('counts each publication once per bracket of its present authors (D1, D3)', () => {
    expect(byKey['<35'].publications).toBe(1);
    expect(byKey['35-44'].publications).toBe(2);
    expect(byKey['55+'].publications).toBe(1);
    expect(r.overall.publications).toBe(3);
    expect(r.overall.byYear).toEqual([2, 0, 0, 1, 0]);
  });

  it('author × year pairs of each bracket, for the drill-down to the list', () => {
    expect(byKey['<35'].authorYears).toEqual(['4:2022', '4:2023']);
    expect(byKey['35-44'].authorYears).toEqual(['1:2022', '1:2023', '1:2024']);
    expect(byKey['55+'].authorYears).toEqual(['2:2024', '2:2025', '2:2026']);
  });

  it('FTE-years pro rata of presence (D2), estimated part kept apart (D4)', () => {
    // D: FTE 1 × (2022 + 2023 up to 08-31).
    expect(byKey['<35'].fteYears).toBeCloseTo(1 + 243 / 365, 6);
    expect(byKey['<35'].estimatedFteYears).toBeCloseTo(byKey['<35'].fteYears, 6);
    // A: 0.5 × (2022, 2023, 2024) at 42-44, then 45-54 for 2025 and 2026 (up to asOf).
    expect(byKey['35-44'].fteYears).toBeCloseTo(1.5, 6);
    expect(byKey['45-54'].fteYears).toBeCloseTo(0.5 + 0.5 * 279 / 365, 6);
    expect(byKey['35-44'].rate).toBeCloseTo(2 / 1.5, 6);
    expect(r.excluded).toEqual({ phdOrEmeritus: 1, noResearchFte: 1, undatedFormer: 0, maskedUnknownAge: 0 });
  });

  it('keeps PhD students out of the rate even with a research FTE (D4)', () => {
    const withFte = staffOf().map((m) => (m.label === 'C' ? { ...m, researchFte: 0.5 } : m));
    const r2 = publicationRateByAge([pub(2025, [3])], withFte, RANGE, AS_OF, 1);
    expect(r2.overall.publications).toBe(0);
    expect(r2.excluded.phdOrEmeritus).toBe(1);
  });

  it('merges brackets under the threshold and masks a small unknown age (D6)', () => {
    const merged = publicationRateByAge(pubs, staffOf({ presence: 'period' }), RANGE, AS_OF, 3);
    expect(merged.brackets).toHaveLength(1);
    expect(merged.brackets[0].publications).toBe(3);   // union, not a sum of the per-bracket counts
    expect(merged.overall.publications).toBe(3);
    const noBirth = staffOf().map((m) => ({ ...m, birthYear: null }));
    const masked = publicationRateByAge(pubs, noBirth, RANGE, AS_OF, 3);
    expect(masked.brackets).toEqual([]);
    expect(masked.excluded.maskedUnknownAge).toBe(2);
  });
});

describe('agePyramid', () => {
  it('headcount and research FTE by bracket and category', () => {
    const p = agePyramid(staffOf(), 2026, 1);
    expect(p.brackets).toEqual(['<35', '45-54', '55+', 'unknown']);
    expect(p.categories).toEqual(['permanent', 'doctorant', 'none']);
    expect(p.headcount).toEqual([[0, 1, 0], [1, 0, 0], [1, 0, 0], [0, 0, 1]]);
    expect(p.researchFte[1]).toEqual([0.5, 0, 0]);
  });
});

describe('publicationsPerMember and staffKpis', () => {
  const pubs = [pub(2022, [1]), pub(2023, [1]), pub(2023, [2]), pub(2025, [2])];
  const staff = staffOf();
  const per = publicationsPerMember(pubs, staff, RANGE, AS_OF);

  it('counts the years of presence only', () => {
    expect(Object.fromEntries(per.map((m) => [m.label, m.count]))).toEqual({ A: 2, B: 1, C: 0, Assoc: 0 });
  });

  it('years of presence of each member, for the drill-down', () => {
    expect(per.find((m) => m.label === 'B')!.authorYears).toEqual(['2:2024', '2:2025', '2:2026']);
  });

  it('distribution by publication-count step, non-publishing members included', () => {
    const dist = publicationsDistribution(per);
    expect(dist.steps).toEqual(['0', '1-2', '3-5', '6-10', '11-20', '21+']);
    expect(dist.categories).toEqual(['permanent', 'doctorant', 'none']);
    expect(dist.members[0]).toEqual([0, 1, 1]);   // C and Assoc: no publication
    expect(dist.members[1]).toEqual([2, 0, 0]);   // A (2) and B (1)
    expect(dist.unmatched).toBe(0);
    expect(publicationStepLabel(5)).toBe('21+');
  });

  it('indicators of the population', () => {
    const k = staffKpis(per, staff, publicationRateByAge(pubs, staff, RANGE, AS_OF, 1));
    expect(k.headcount).toBe(4);
    expect(k.researchFte).toBe(1);
    expect(k.withoutResearchFte).toBe(1);   // Assoc; the PhD student C is out of the rate
    expect(k.publishingShare).toBe(0.5);
    expect(k.unmatched).toBe(0);
    expect(k.publicationsPerFteYear).toBeGreaterThan(0);
  });
});
