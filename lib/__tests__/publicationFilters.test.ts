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
