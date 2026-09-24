// Hierarchical parent of a structure, derived from its memberships.
//
// The `parent_structure` column (acronym of the parent lab for a team, of the faculty for a
// unit) duplicates what the « Appartenances » tab already stores in `inclusions`
// (`local-<local_id>` references). It was filled by the Nantes LDAP structures sync only, so
// instances without LDAP (Centrale) had no parent lab in the Structures list even though the
// inclusions were there. Since 2026-09-23 the parent is derived from the inclusions, the
// stored column remaining a fallback for records whose inclusions are not filled yet.
import { Membership, Structure, StructureLevel } from '../types';

/** Level expected for the hierarchical parent: team → unit, unit → intermediate (UFR/pole). */
const PARENT_LEVEL: Partial<Record<string, string>> = {
  [StructureLevel.EQUIPE]: StructureLevel.ENTITE,
  [StructureLevel.ENTITE]: StructureLevel.INTERMEDIAIRE,
};

const isCurrent = (m: Membership): boolean => {
  if (!m.endDate) return true;
  return m.endDate >= new Date().toISOString().slice(0, 10);
};

/**
 * Acronym of the hierarchical parent read from `inclusions` (first current `local-` inclusion
 * pointing to a structure of the expected level), or '' when none resolves — the caller keeps
 * its stored `parentStructure` in that case.
 */
export const parentFromInclusions = (
  structure: Pick<Structure, 'level' | 'inclusions'>,
  byLocalId: Map<string, Pick<Structure, 'level' | 'acronym' | 'officialName'>>,
): string => {
  const wanted = PARENT_LEVEL[String(structure.level)];
  if (!wanted) return '';
  const candidates = (structure.inclusions || []).filter((m) => m.refType === 'local' && m.ref);
  const ordered = [...candidates.filter(isCurrent), ...candidates.filter((m) => !isCurrent(m))];
  for (const m of ordered) {
    const target = byLocalId.get(String(m.ref));
    if (target && String(target.level) === wanted) return target.acronym || target.officialName || '';
  }
  return '';
};

/** Index by `localId`, as expected by `parentFromInclusions`. */
export const indexByLocalId = <T extends Pick<Structure, 'localId'>>(structures: T[]): Map<string, T> =>
  new Map(structures.filter((s) => s.localId).map((s) => [String(s.localId), s]));

/** `parentStructure` resolved for every structure: inclusions first, stored column otherwise. */
export const withDerivedParents = <T extends Structure>(structures: T[]): T[] => {
  const byLid = indexByLocalId(structures);
  return structures.map((s) => {
    const derived = parentFromInclusions(s, byLid);
    return derived && derived !== s.parentStructure ? { ...s, parentStructure: derived } : s;
  });
};
