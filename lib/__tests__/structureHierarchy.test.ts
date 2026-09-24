import { describe, expect, it } from 'vitest';
import { StructureLevel } from '../../types';
import { indexByLocalId, parentFromInclusions, withDerivedParents } from '../structureHierarchy';

const st = (localId: string, level: StructureLevel, acronym: string, extra: Record<string, unknown> = {}) =>
  ({ id: `S-${localId}`, localId, level, acronym, officialName: acronym, inclusions: [], parentStructure: '', ...extra }) as any;

describe('parentFromInclusions', () => {
  const lab = st('1246', StructureLevel.ENTITE, 'LS2N');
  const ufr = st('331', StructureLevel.INTERMEDIAIRE, 'TECH');
  const byLid = indexByLocalId([lab, ufr]);

  it('resolves a team to the unit of its local inclusion (Centrale case: parent_structure empty)', () => {
    const team = st('1789', StructureLevel.EQUIPE, 'CODEX', { inclusions: [{ refType: 'local', ref: '1246', startDate: '2022-01-01' }] });
    expect(parentFromInclusions(team, byLid)).toBe('LS2N');
  });

  it('resolves a unit to its intermediate structure and ignores inclusions of another level', () => {
    const unit = st('999', StructureLevel.ENTITE, 'X', { inclusions: [{ refType: 'local', ref: '1246' }, { refType: 'local', ref: '331' }] });
    expect(parentFromInclusions(unit, byLid)).toBe('TECH');
  });

  it('returns empty for unknown targets, external refs and levels without a parent', () => {
    expect(parentFromInclusions(st('a', StructureLevel.EQUIPE, 'A', { inclusions: [{ refType: 'local', ref: '376' }] }), byLid)).toBe('');
    expect(parentFromInclusions(st('b', StructureLevel.EQUIPE, 'B', { inclusions: [{ refType: 'uai', ref: '0442953W' }] }), byLid)).toBe('');
    expect(parentFromInclusions(st('c', StructureLevel.ETABLISSEMENT, 'C', { inclusions: [{ refType: 'local', ref: '1246' }] }), byLid)).toBe('');
  });

  it('prefers a current inclusion over an ended one', () => {
    const other = st('2000', StructureLevel.ENTITE, 'GeM');
    const idx = indexByLocalId([lab, other]);
    const team = st('t', StructureLevel.EQUIPE, 'T', { inclusions: [
      { refType: 'local', ref: '1246', endDate: '2020-12-31' },
      { refType: 'local', ref: '2000' },
    ] });
    expect(parentFromInclusions(team, idx)).toBe('GeM');
  });
});

describe('withDerivedParents', () => {
  it('overrides the stored column when an inclusion resolves, keeps it otherwise (Nantes fallback)', () => {
    const lab = st('1246', StructureLevel.ENTITE, 'LS2N');
    const itx = st('500', StructureLevel.ENTITE, 'ITX');
    const bird = st('b', StructureLevel.EQUIPE, 'BIRD', { parentStructure: 'THORAX', inclusions: [{ refType: 'local', ref: '500' }] });
    const legacy = st('l', StructureLevel.EQUIPE, 'LEGACY', { parentStructure: 'LPPL' });
    const out = withDerivedParents([lab, itx, bird, legacy]);
    expect(out.find((s) => s.acronym === 'BIRD')!.parentStructure).toBe('ITX');
    expect(out.find((s) => s.acronym === 'LEGACY')!.parentStructure).toBe('LPPL');
    expect(out.find((s) => s.acronym === 'LS2N')).toBe(lab); // untouched object when nothing changes
  });
});
