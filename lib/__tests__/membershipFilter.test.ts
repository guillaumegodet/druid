import { describe, it, expect } from 'vitest';
import { matchesMembershipFilter, primaryMembershipType, MEMBERSHIP_NONE } from '../membershipFilter';
import type { Affiliation } from '../../types';

const aff = (over: Partial<Affiliation>): Affiliation => ({ structureName: 'LAB', team: '', startDate: '', isPrimary: false, ...over });
const rec = (...affiliations: Affiliation[]) => ({ affiliations });

describe('primaryMembershipType', () => {
  it('reads the primary affiliation only', () => {
    const r = rec(aff({ membershipType: 'assoc_mmb' }), aff({ isPrimary: true, membershipType: 'stat_mmb' }));
    expect(primaryMembershipType(r)).toBe('stat_mmb');
  });

  it('no primary affiliation → undefined', () => {
    expect(primaryMembershipType(rec(aff({ membershipType: 'stat_mmb' })))).toBeUndefined();
  });
});

describe('matchesMembershipFilter', () => {
  const statutory = rec(aff({ isPrimary: true, membershipType: 'stat_mmb' }));
  const associate = rec(aff({ isPrimary: true, membershipType: 'assoc_mmb' }), aff({ membershipType: 'stat_mmb' }));
  const notFilled = rec(aff({ isPrimary: true }));

  it('empty selection = no filter', () => {
    expect(matchesMembershipFilter(notFilled, [])).toBe(true);
  });

  it('matches on the primary membership type, not the secondary ones', () => {
    expect(matchesMembershipFilter(statutory, ['stat_mmb'])).toBe(true);
    expect(matchesMembershipFilter(associate, ['stat_mmb'])).toBe(false);
    expect(matchesMembershipFilter(associate, ['stat_mmb', 'assoc_mmb'])).toBe(true);
  });

  it('« not specified » option catches the records without a type', () => {
    expect(matchesMembershipFilter(notFilled, [MEMBERSHIP_NONE])).toBe(true);
    expect(matchesMembershipFilter(rec(), [MEMBERSHIP_NONE])).toBe(true);
    expect(matchesMembershipFilter(statutory, [MEMBERSHIP_NONE])).toBe(false);
  });
});
