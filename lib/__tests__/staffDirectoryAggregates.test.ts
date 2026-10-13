import { describe, expect, it } from 'vitest';
import { Presence, Researcher, Structure } from '../../types';
import {
  ageGroups, directoryKpis, genderBreakdown, genderOf, identifierCoverage, presenceBreakdown,
  researchersOfSlug, topCounts,
} from '../staffDirectoryAggregates';

const mk = (over: Partial<Researcher> & { id: string }): Researcher => ({
  uid: over.id,
  lastName: 'Doe',
  firstName: 'J',
  civility: '',
  status: 'INTERNE',
  presence: Presence.PRESENT,
  employerKind: 'home',
  employment: { employer: 'Nantes Université' },
  affiliations: [{ structureName: 'LS2N', team: '', startDate: '2020-01-01', isPrimary: true }],
  groups: [],
  identifiers: {},
  ...over,
} as Researcher);

const structures: Pick<Structure, 'id' | 'acronym' | 'officialName' | 'parentStructure'>[] = [
  { id: 's1', acronym: 'LS2N', officialName: 'Laboratoire des sciences du numérique' },
  { id: 's2', acronym: 'SIMS', officialName: 'Signal image et son', parentStructure: 'LS2N' },
  { id: 's3', acronym: 'CEISAM', officialName: 'Chimie' },
];

describe('presenceBreakdown / genderBreakdown / ageGroups', () => {
  it('splits the present staff by employer kind, then leaving and left', () => {
    const rows = [
      mk({ id: 'a' }),
      mk({ id: 'b', employerKind: 'external' }),
      mk({ id: 'c', employerKind: 'unknown' }),
      mk({ id: 'd', presence: Presence.DEPART }),
      mk({ id: 'e', presence: Presence.PARTI, employerKind: 'external' }),
    ];
    expect(presenceBreakdown(rows)).toEqual({ home: 1, external: 1, unknown: 1, depart: 1, parti: 1 });
  });

  it('reads the gender from the civility, tolerant to the input variants', () => {
    expect(genderOf('Mme')).toBe('f');
    expect(genderOf('MADAME X')).toBe('f');
    expect(genderOf('M.')).toBe('m');
    expect(genderOf('Monsieur')).toBe('m');
    expect(genderOf('Dr')).toBe('other');
    expect(genderOf('')).toBeNull();
    expect(genderBreakdown([mk({ id: 'a', civility: 'Mme' }), mk({ id: 'b', civility: 'M.' }), mk({ id: 'c' })]))
      .toEqual({ women: 1, men: 1, other: 0, unknown: 1 });
  });

  it('buckets the ages and skips unusable birth dates', () => {
    const rows = [
      mk({ id: 'a', birthDate: '2000-05-01' }),
      mk({ id: 'b', birthDate: '1990' }),
      mk({ id: 'c', birthDate: '1975-01-01' }),
      mk({ id: 'd', birthDate: '1950-01-01' }),
      mk({ id: 'e', birthDate: '' }),
      mk({ id: 'f', birthDate: 'n/a' }),
    ];
    expect(ageGroups(rows, 2026)).toEqual({ under30: 1, '31to45': 1, '46to60': 1, over60: 1 });
  });
});

describe('topCounts / identifierCoverage / directoryKpis', () => {
  it('ranks the values, missing ones under an empty name', () => {
    const rows = [
      mk({ id: 'a', employment: { employer: 'CNRS' } }),
      mk({ id: 'b', employment: { employer: 'CNRS' } }),
      mk({ id: 'c', employment: { employer: 'Nantes Université' } }),
      mk({ id: 'd', employment: { employer: '' } }),
    ];
    expect(topCounts(rows, (r) => r.employment.employer, 2)).toEqual([
      { name: 'CNRS', count: 2 }, { name: '', count: 1 },
    ]);
  });

  it('counts each identifier, HAL by form id or numeric id, OpenAlex by single or reviewed ids', () => {
    const rows = [
      mk({ id: 'a', identifiers: { orcid: '0000-0001-0000-0000', halIdNum: '12' } }),
      mk({ id: 'b', identifiers: { idref: '1', halId: 'j-doe', openalexIds: 'A1|A2', scopusId: '7' } }),
      mk({ id: 'c', identifiers: { openalexId: 'A3' } }),
    ];
    expect(identifierCoverage(rows)).toEqual({ orcid: 1, idref: 1, hal: 2, scopus: 1, openalex: 2 });
  });

  it('computes the key figures (rates in percent, women share among known genders)', () => {
    const rows = [
      mk({ id: 'a', civility: 'Mme', nuFields: { hdr: true }, identifiers: { orcid: 'x' } }),
      mk({ id: 'b', civility: 'M.' }),
      mk({ id: 'c', presence: Presence.PARTI }),
      mk({ id: 'd', presence: Presence.DEPART }),
    ];
    const k = directoryKpis(rows);
    expect(k).toMatchObject({ total: 4, present: 2, leaving: 1, left: 1, hdr: 1, hdrRate: 25, women: 1, men: 1, womenShare: 50, orcid: 1, orcidRate: 25 });
    expect(directoryKpis([]).hdrRate).toBeNull();
  });
});

describe('researchersOfSlug', () => {
  const rows = [
    mk({ id: 'a' }),
    mk({ id: 'b', affiliations: [{ structureId: 's2', structureName: 'SIMS', team: '', startDate: '2020', isPrimary: true }] }),
    mk({ id: 'c', affiliations: [{ structureName: 'LS2N', team: '', startDate: '2015', endDate: '2024-06-30', isPrimary: true }] }),
    mk({ id: 'd', affiliations: [{ structureName: 'CEISAM', team: '', startDate: '2015', isPrimary: true }] }),
    mk({ id: 'e', affiliations: [{ structureName: 'ls2n', team: '', startDate: '2015', endDate: '2027', isPrimary: true }] }),
  ];

  it('matches the structure and its teams on the active affiliations, tolerant on the acronym', () => {
    const got = researchersOfSlug('ls2n', structures, rows, '2026-10-13');
    expect(got?.map((r) => r.id)).toEqual(['a', 'b', 'e']);
    expect(researchersOfSlug('SIMS', structures, rows, '2026-10-13')?.map((r) => r.id)).toEqual(['b']);
  });

  it('returns null when no structure matches the slug (group, institution-wide corpus)', () => {
    expect(researchersOfSlug('groupe-mer', structures, rows)).toBeNull();
    expect(researchersOfSlug('', structures, rows)).toBeNull();
  });
});
