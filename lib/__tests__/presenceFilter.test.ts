import { describe, it, expect } from 'vitest';
import { Presence } from '../presence';
import {
  EMPLOYER_HOME, EMPLOYER_EXTERNAL, EMPLOYER_NONE, matchesEmployerFilter, matchesPresenceFilter, matchesLdapAccountFilter,
  filtersFromLegacyStatus, isInternalShortcut, presenceRank,
} from '../presenceFilter';

const r = (employer: string, employerKind: 'home' | 'external' | 'unknown', presence: Presence, ldapAccount: 'active' | 'closing' | 'none' = 'none') =>
  ({ employment: { employer }, employerKind, presence, ldapAccount }) as any;

describe('presence filters', () => {
  const home = r('NANTES UNIVERSITE', 'home', Presence.PRESENT, 'active');
  const cnrs = r('CNRS', 'external', Presence.DEPART);
  const none = r('', 'unknown', Presence.PARTI, 'closing');

  it('employer: by name or by kind', () => {
    expect([home, cnrs, none].filter((x) => matchesEmployerFilter(x, [EMPLOYER_HOME]))).toEqual([home]);
    expect([home, cnrs, none].filter((x) => matchesEmployerFilter(x, [EMPLOYER_EXTERNAL, EMPLOYER_NONE]))).toEqual([cnrs, none]);
    expect([home, cnrs, none].filter((x) => matchesEmployerFilter(x, ['CNRS']))).toEqual([cnrs]);
    expect([home, cnrs, none].filter((x) => matchesEmployerFilter(x, []))).toHaveLength(3);
  });

  it('presence and LDAP account', () => {
    expect([home, cnrs, none].filter((x) => matchesPresenceFilter(x, [Presence.DEPART, Presence.PARTI]))).toEqual([cnrs, none]);
    expect([home, cnrs, none].filter((x) => matchesLdapAccountFilter(x, ['none']))).toEqual([cnrs]);
    expect([home, cnrs, none].filter((x) => matchesLdapAccountFilter(x, ['active', 'closing']))).toEqual([home, none]);
  });

  it('translates the former status URL values', () => {
    expect(filtersFromLegacyStatus(['INTERNE'])).toEqual({ presence: [Presence.PRESENT], employer: [EMPLOYER_HOME] });
    expect(filtersFromLegacyStatus(['INTERNE', 'EXTERNE'])).toEqual({ presence: [Presence.PRESENT], employer: [EMPLOYER_HOME, EMPLOYER_EXTERNAL] });
    expect(filtersFromLegacyStatus(['DEPART', 'INTERNE'])).toEqual({ presence: [Presence.DEPART, Presence.PRESENT], employer: [] });
    expect(filtersFromLegacyStatus([])).toEqual({ presence: [], employer: [] });
  });

  it('internal shortcut and sort rank', () => {
    expect(isInternalShortcut([Presence.PRESENT], [EMPLOYER_HOME])).toBe(true);
    expect(isInternalShortcut([Presence.PRESENT], [EMPLOYER_HOME, 'CNRS'])).toBe(false);
    expect(presenceRank(Presence.PRESENT)).toBeLessThan(presenceRank(Presence.PARTI));
    expect(presenceRank(undefined)).toBe(3);
  });
});
