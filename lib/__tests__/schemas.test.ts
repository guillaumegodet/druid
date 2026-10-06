import { describe, it, expect } from 'vitest';
import { ResearcherSchema, AffiliationSchema, EmploymentSchema, ResearcherListSchema } from '../schemas';
import { ResearcherStatus } from '../../types';

const minimalResearcher = {
  id: 'R001',
  employment: { employer: 'Université Paris' },
  affiliations: [],
  identifiers: {},
};

describe('ResearcherSchema', () => {
  it('parses a minimal valid researcher', () => {
    const result = ResearcherSchema.safeParse(minimalResearcher);
    expect(result.success).toBe(true);
  });

  it('defaults status to EXTERNE when not provided', () => {
    const result = ResearcherSchema.safeParse(minimalResearcher);
    expect(result.success && result.data.status).toBe(ResearcherStatus.EXTERNE);
  });

  it('accepts an invalid email (validation deliberately disabled: 13 malformed addresses in Grist made the whole list fail, see lib/schemas.ts)', () => {
    const result = ResearcherSchema.safeParse({ ...minimalResearcher, email: 'not-an-email' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty string as email (allows no email)', () => {
    const result = ResearcherSchema.safeParse({ ...minimalResearcher, email: '' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status value', () => {
    const result = ResearcherSchema.safeParse({ ...minimalResearcher, status: 'INCONNU' });
    expect(result.success).toBe(false);
  });

  it('requires id to be present', () => {
    const { id: _id, ...withoutId } = minimalResearcher;
    const result = ResearcherSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('accepts all valid status values', () => {
    for (const status of Object.values(ResearcherStatus)) {
      const result = ResearcherSchema.safeParse({ ...minimalResearcher, status });
      expect(result.success).toBe(true);
    }
  });
});

describe('EmploymentSchema', () => {
  it('keeps the FTEs, a real 0 included (stripped, they would be erased in Grist on the next save)', () => {
    const result = EmploymentSchema.safeParse({ employer: 'U ANGERS', fte: 1, researchFte: 0 });
    expect(result.success && result.data.fte).toBe(1);
    expect(result.success && result.data.researchFte).toBe(0);
  });

  it('accepts missing or null FTEs, rejects an FTE above 1', () => {
    expect(EmploymentSchema.safeParse({ employer: '', fte: null }).success).toBe(true);
    expect(EmploymentSchema.safeParse({ employer: '' }).success).toBe(true);
    expect(EmploymentSchema.safeParse({ employer: '', researchFte: 1.5 }).success).toBe(false);
  });
});

describe('AffiliationSchema', () => {
  it('keeps membershipType (stripped before, then erased in Grist on the next save)', () => {
    const result = AffiliationSchema.safeParse({ structureName: 'LPPL', membershipType: 'stat_mmb' });
    expect(result.success && result.data.membershipType).toBe('stat_mmb');
  });

  it('defaults isPrimary to false when not provided', () => {
    const result = AffiliationSchema.safeParse({ structureName: 'IRISA' });
    expect(result.success && result.data.isPrimary).toBe(false);
  });

  it('accepts a full affiliation object', () => {
    const result = AffiliationSchema.safeParse({
      structureName: 'IRISA',
      team: 'DiverSE',
      startDate: '2020-09-01',
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });

  it('defaults structureName to empty string when absent', () => {
    const result = AffiliationSchema.safeParse({});
    expect(result.success && result.data.structureName).toBe('');
  });
});

describe('ResearcherListSchema', () => {
  it('parses an array of valid researchers', () => {
    const result = ResearcherListSchema.safeParse([
      minimalResearcher,
      { ...minimalResearcher, id: 'R002' },
    ]);
    expect(result.success).toBe(true);
    expect(result.success && result.data.length).toBe(2);
  });

  it('fails if one item in the array is invalid', () => {
    const result = ResearcherListSchema.safeParse([minimalResearcher, { invalid: true }]);
    expect(result.success).toBe(false);
  });

  it('parses an empty array', () => {
    const result = ResearcherListSchema.safeParse([]);
    expect(result.success).toBe(true);
    expect(result.success && result.data.length).toBe(0);
  });
});
