import { describe, it, expect } from 'vitest';
import { ResearcherStatus } from '../../types';
import {
  Presence, derivePresence, employerKindOf, ldapAccountOf, presenceFromValidated, isHomeStaff, legacyStatus,
  DEPARTURE_NOTICE_MONTHS,
} from '../presence';

const today = '2026-10-07';
const base = { employer: 'home' as const, hasRealUid: true, ldapEtat: 'N', today };

describe('employerKindOf', () => {
  it('home, external, unknown', () => {
    expect(employerKindOf('NANTES UNIVERSITE', '0442953W')).toBe('home');
    expect(employerKindOf('Nantes Université')).toBe('home');
    expect(employerKindOf('CNRS', '0753639Y')).toBe('external');
    expect(employerKindOf('')).toBe('unknown');
    expect(employerKindOf('non renseigné')).toBe('unknown');
  });
});

describe('ldapAccountOf', () => {
  it('only a real uid found in the cache has an account; D = closing', () => {
    expect(ldapAccountOf('dupont-j', 'N')).toBe('active');
    expect(ldapAccountOf('dupont-j', 'A')).toBe('active');
    expect(ldapAccountOf('dupont-j', 'D')).toBe('closing');
    expect(ldapAccountOf('dupont-j', undefined)).toBe('none');
    expect(ldapAccountOf('ext_dupont-j', 'N')).toBe('none');
    expect(ldapAccountOf('', 'N')).toBe('none');
  });
});

describe('presenceFromValidated', () => {
  it('reads the new values and the legacy ones (D5)', () => {
    expect(presenceFromValidated('PRESENT')).toBe(Presence.PRESENT);
    expect(presenceFromValidated('INTERNE')).toBe(Presence.PRESENT);
    expect(presenceFromValidated('EXTERNE')).toBe(Presence.PRESENT);
    expect(presenceFromValidated('Départ')).toBe(Presence.DEPART);
    expect(presenceFromValidated('PARTI')).toBe(Presence.PARTI);
    expect(presenceFromValidated('')).toBeUndefined();
  });
});

describe('derivePresence', () => {
  it('home staff: LDAP state, then absence from LDAP', () => {
    expect(derivePresence(base)).toBe(Presence.PRESENT);
    expect(derivePresence({ ...base, ldapEtat: 'D' })).toBe(Presence.DEPART);
    expect(derivePresence({ ...base, ldapEtat: undefined })).toBe(Presence.PARTI);
    expect(derivePresence({ ...base, employer: 'unknown', ldapEtat: 'D' })).toBe(Presence.DEPART);
  });

  it('another employer: the hosted LDAP account says nothing (D3)', () => {
    expect(derivePresence({ ...base, employer: 'external', ldapEtat: 'D' })).toBe(Presence.PRESENT);
    expect(derivePresence({ ...base, employer: 'external', ldapEtat: undefined })).toBe(Presence.PRESENT);
  });

  it('no real uid: dates only', () => {
    const ext = { employer: 'unknown' as const, hasRealUid: false, today };
    expect(derivePresence(ext)).toBe(Presence.PRESENT);
    expect(derivePresence({ ...ext, employmentEnd: '2025' })).toBe(Presence.PARTI);
    expect(derivePresence({ ...ext, employmentEnd: '2026-12-31' })).toBe(Presence.DEPART);
    expect(derivePresence({ ...ext, employmentEnd: '2027-06' })).toBe(Presence.PRESENT);
  });

  it(`an employment end within ${DEPARTURE_NOTICE_MONTHS} months is an announced departure, a fuzzy one by its last day`, () => {
    expect(derivePresence({ ...base, employmentEnd: '2027-01-07' })).toBe(Presence.DEPART);
    expect(derivePresence({ ...base, employmentEnd: '2027-01-08' })).toBe(Presence.PRESENT);
    expect(derivePresence({ ...base, employmentEnd: '2027' })).toBe(Presence.PRESENT);
    expect(derivePresence({ ...base, employmentEnd: '2026' })).toBe(Presence.DEPART);
  });

  it('validation above LDAP and dates, below the certain departure', () => {
    expect(derivePresence({ ...base, ldapEtat: 'D', validated: Presence.PRESENT })).toBe(Presence.PRESENT);
    expect(derivePresence({ ...base, validated: Presence.PARTI })).toBe(Presence.PARTI);
    expect(derivePresence({ ...base, validated: Presence.PRESENT, employmentEnd: '2026-01', membershipEnd: '2026-02' })).toBe(Presence.PARTI);
  });

  it('retiree without emeritus status', () => {
    expect(derivePresence({ ...base, retireeWithoutEmeritus: true })).toBe(Presence.PARTI);
    expect(derivePresence({ ...base, retireeWithoutEmeritus: true, validated: Presence.PRESENT })).toBe(Presence.PRESENT);
  });
});

describe('isHomeStaff / legacyStatus', () => {
  it('home employer, or unknown employer with an LDAP account', () => {
    expect(isHomeStaff('home', 'none')).toBe(true);
    expect(isHomeStaff('unknown', 'active')).toBe(true);
    expect(isHomeStaff('unknown', 'none')).toBe(false);
    expect(isHomeStaff('external', 'active')).toBe(false);
  });
  it('maps back to the four legacy values', () => {
    expect(legacyStatus(Presence.PRESENT, 'home', 'active')).toBe(ResearcherStatus.INTERNE);
    expect(legacyStatus(Presence.PRESENT, 'external', 'active')).toBe(ResearcherStatus.EXTERNE);
    expect(legacyStatus(Presence.PRESENT, 'unknown', 'none')).toBe(ResearcherStatus.EXTERNE);
    expect(legacyStatus(Presence.DEPART, 'external', 'none')).toBe(ResearcherStatus.DEPART);
    expect(legacyStatus(Presence.PARTI, 'home', 'active')).toBe(ResearcherStatus.PARTI);
  });
});
