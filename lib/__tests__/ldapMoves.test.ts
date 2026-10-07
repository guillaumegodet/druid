import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { buildArrivals, buildDepartures, defaultSince, LdapMovePerson } from '../ldapMoves';
import { Researcher, ResearcherStatus, Presence, Structure, StructureLevel } from '../../types';

// ldap_common.cjs exits the process without the LDAP_* variables: dummy values, nothing is contacted.
process.env.LDAP_URL = process.env.LDAP_URL || 'ldaps://ldap.example.org';
process.env.LDAP_BIND_DN = process.env.LDAP_BIND_DN || 'cn=reader,dc=example,dc=org';
process.env.LDAP_BIND_PASSWORD = process.env.LDAP_BIND_PASSWORD || 'unused';
const M = createRequire(import.meta.url)('../../scripts/lib/ldap_moves.cjs');

const move = (over: Partial<LdapMovePerson> = {}): LdapMovePerson => ({
  uid: 'martin-c',
  lastName: 'Martin',
  firstName: 'Claire',
  email: 'claire.martin@example.org',
  etat: 'N',
  categorie: 'DOCTORANT',
  empCorps: '',
  dateFin: '2029-09-30',
  affectationCodes: ['100', '1162'],
  affectationPrincipale: '1162',
  affectationPrincipaleLabel: 'UFR LETTRES/UR 1162 LABLET',
  createdAt: '2026-09-15',
  account: { state: 'A', subState: 'SupannActif', start: '', end: '2029-09-30' },
  ...over,
});

const researcher = (uid: string, status = ResearcherStatus.INTERNE): Researcher => ({
  id: uid,
  uid,
  presence: status === ResearcherStatus.PARTI ? Presence.PARTI : status === ResearcherStatus.DEPART ? Presence.DEPART : Presence.PRESENT,
  lastName: uid.toUpperCase(),
  firstName: '',
  displayName: uid.toUpperCase(),
  email: '',
  birthDate: '',
  status,
  employment: { employer: '', contractType: '', grade: '', internalTypology: '', startDate: '', endDate: '' },
  affiliations: [],
  groups: [],
  identifiers: {},
  civility: '',
});

const lab = { id: 'S-1', level: StructureLevel.ENTITE, acronym: 'LABLET', officialName: 'Laboratoire fictif', localId: '1162' } as unknown as Structure;

describe('ldap_moves.cjs', () => {
  it('parses the {COMPTE} value of supannRessourceEtatDate, other resources ignored', () => {
    expect(M.parseAccountState(['{UAI:0000000X:CLOUD}A::20220411:20271231', '{COMPTE}A:SupannSursis:20260831:']))
      .toEqual({ state: 'A', subState: 'SupannSursis', start: '2026-08-31', end: '' });
    expect(M.parseAccountState(['{COMPTE}A:SupannActif::20261231'])).toEqual({ state: 'A', subState: 'SupannActif', start: '', end: '2026-12-31' });
    expect(M.parseAccountState(['{VPN}A'])).toBeNull();
  });

  it('departure = grace period, lock or inactive, never a pre-created or active account', () => {
    const acc = (v: string) => M.parseAccountState([v]);
    expect(M.isDepartureState(acc('{COMPTE}A:SupannSursis:20260831:'))).toBe(true);
    expect(M.isDepartureState(acc('{COMPTE}S:SupannVerrouAdministratif:20260831:'))).toBe(true);
    expect(M.isDepartureState(acc('{COMPTE}I::20260901:'))).toBe(true);
    expect(M.isDepartureState(acc('{COMPTE}I:SupannPrecree:20261019:'))).toBe(false);
    expect(M.isDepartureState(acc('{COMPTE}A:SupannActif::20261231'))).toBe(false);
    expect(M.isDepartureState(null)).toBe(false);
  });

  it('accepts only real calendar dates (no LDAP filter injection)', () => {
    expect(M.toLdapDay('2026-09-01')).toBe('20260901');
    expect(M.toLdapDay('2026-02-30')).toBeNull();
    expect(M.toLdapDay('2026-09-01)(uid=*')).toBeNull();
    expect(M.toLdapDay('')).toBeNull();
  });
});

describe('buildArrivals', () => {
  it('drops the uids that already have a record (case-insensitive) and detects the lab', () => {
    const rows = buildArrivals([move(), move({ uid: 'Durand-P', lastName: 'Durand' })], [researcher('durand-p')], [lab]);
    expect(rows.map((r) => r.uid)).toEqual(['martin-c']);
    expect(rows[0].labs).toEqual(['LABLET']);
    expect(rows[0].upcoming).toBe(false);
  });

  it('puts the pre-created accounts (arrival to come) first, then the newest accounts', () => {
    const rows = buildArrivals([
      move({ uid: 'a-old', createdAt: '2026-09-02' }),
      move({ uid: 'b-new', createdAt: '2026-09-20' }),
      move({ uid: 'c-soon', etat: 'A', createdAt: '2023-03-09' }),
    ], [], []);
    expect(rows.map((r) => r.uid)).toEqual(['c-soon', 'b-new', 'a-old']);
    expect(rows[0].upcoming).toBe(true);
    expect(rows[1].labs).toEqual([]);
  });
});

describe('buildDepartures', () => {
  it('keeps the records whose account left, except those already gone or without a record', () => {
    const left = (uid: string, start: string) => move({ uid, account: { state: 'A', subState: 'SupannSursis', start, end: '' } });
    const rows = buildDepartures(
      [left('martin-c', '2026-08-31'), left('durand-p', '2026-09-15'), left('petit-l', '2026-09-01'), left('nobody-x', '2026-09-01')],
      [researcher('martin-c'), researcher('durand-p', ResearcherStatus.EXTERNE), researcher('petit-l', ResearcherStatus.PARTI)],
    );
    expect(rows.map((d) => [d.researcher.uid, d.since])).toEqual([['durand-p', '2026-09-15'], ['martin-c', '2026-08-31']]);
  });
});

describe('defaultSince', () => {
  it('is the first day of the previous month, across a year boundary too', () => {
    expect(defaultSince(new Date('2026-10-02T10:00:00Z'))).toBe('2026-09-01');
    expect(defaultSince(new Date('2027-01-15T10:00:00Z'))).toBe('2026-12-01');
  });
});
