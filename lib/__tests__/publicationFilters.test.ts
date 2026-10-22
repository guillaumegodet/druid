import { describe, it, expect } from 'vitest';
import { matchesFilters, countActiveFilters, FilterContext } from '../../components/dashboard/publicationFilters';
import type { DashboardPublication } from '../../components/dashboard/types';

const ctx = { memberTypesByAuthorId: new Map(), authorLabelById: new Map() } as unknown as FilterContext;
const pub = (year: number, authorIds: number[]) => ({ year, authorIds } as unknown as DashboardPublication);

describe('authorYears filter (Researchers tab drill-down)', () => {
  const f = { authorYears: ['1:2022', '2:2024'], authorYearsLabel: 'Age 35-44' };

  it('keeps a publication with one of the authors in that year only', () => {
    expect(matchesFilters(pub(2022, [1, 9]), f, ctx)).toBe(true);
    expect(matchesFilters(pub(2024, [2]), f, ctx)).toBe(true);
    expect(matchesFilters(pub(2023, [1]), f, ctx)).toBe(false);   // author 1 not in the bracket in 2023
    expect(matchesFilters(pub(2022, [3]), f, ctx)).toBe(false);
  });

  it('counts as a single active filter (the label goes with it)', () => {
    expect(countActiveFilters(f)).toBe(1);
    expect(countActiveFilters({ authorYears: [] })).toBe(0);
  });
});

describe('sdg filter (Sustainable Development Goals tab)', () => {
  const tagged = { year: 2024, authorIds: [], sdgs: [{ id: 14, score: 0.6 }] } as unknown as DashboardPublication;
  const untagged = { year: 2024, authorIds: [] } as unknown as DashboardPublication;

  it('matches one goal, any goal or none', () => {
    expect(matchesFilters(tagged, { sdg: 14 }, ctx)).toBe(true);
    expect(matchesFilters(tagged, { sdg: 3 }, ctx)).toBe(false);
    expect(matchesFilters(tagged, { sdg: 'any' }, ctx)).toBe(true);
    expect(matchesFilters(untagged, { sdg: 'any' }, ctx)).toBe(false);
    expect(matchesFilters(untagged, { sdg: 'none' }, ctx)).toBe(true);
    expect(matchesFilters(tagged, { sdg: 'none' }, ctx)).toBe(false);
    expect(countActiveFilters({ sdg: 'none' })).toBe(1);
  });
});
