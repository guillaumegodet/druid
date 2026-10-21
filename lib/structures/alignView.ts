/**
 * @file alignView.ts
 * @description The « Structures » tab of the alignment page as the API serves it (druid-internal
 * docs/plan-druid-saas.md, § 4.3 and 4.5): one row per structure, one cell per identifier type, with a state — present,
 * conflict, strong, ambiguous, arbitrate, absent, none — computed from the confirmed identifiers, the pending
 * candidates and what the job searched. Pure: shared by the server (lib/structures/pg/alignCommands.ts) and the
 * browser (components/structures/StructureAlignPanel.tsx).
 */
import type { StructureIdType, StructureIdentifier } from './identifiers';
import type { CandidateEvidence, CandidateStrength } from './alignEngine';

export type StructureCellStatus = 'present' | 'conflict' | 'strong' | 'ambiguous' | 'arbitrate' | 'absent' | 'none';

export interface StructureCandidateView {
  candidateId: string;
  score: number;
  strength: CandidateStrength;
  evidence: CandidateEvidence;
  mode: 'search' | 'verify';
  seenAt: string;
}

export interface StructureAlignCell {
  status: StructureCellStatus;
  /** Confirmed identifiers of the type, primary first. */
  existing: StructureIdentifier[];
  /** Pending candidates, best first. */
  candidates: StructureCandidateView[];
  searchedAt: string | null;
  error?: string;
}

export interface StructureAlignRow {
  /** `S-<id>` as the structure list names it. */
  id: string;
  structureId: number;
  acronym: string;
  name: string;
  level: 'lab' | 'team' | 'institution' | 'other';
  parentAcronym: string | null;
  cluster: string | null;
  cells: Partial<Record<StructureIdType, StructureAlignCell>>;
}

export interface StructureAlignOverview {
  generatedAt: string;
  types: StructureIdType[];
  rows: StructureAlignRow[];
  stats: { structures: number; actionable: number; strong: number; ambiguous: number; arbitrate: number; conflicts: number };
}

export const ACTIONABLE_STATUSES: StructureCellStatus[] = ['strong', 'ambiguous', 'arbitrate', 'conflict'];

/** State of one cell from its identifiers, pending candidates and search bookkeeping. */
export const cellStatus = (existing: StructureIdentifier[], candidates: StructureCandidateView[], searched: boolean, multi: boolean): StructureCellStatus => {
  const strong = candidates.filter((c) => c.strength === 'strong');
  const medium = candidates.filter((c) => c.strength === 'medium');
  const conflict = candidates.some((c) => c.strength === 'conflict') || existing.some((i) => i.checkResult && (i.checkResult as any).ok === false);
  if (existing.length) {
    if (conflict) return 'conflict';
    // Several HAL records or OpenAlex institutions are normal: more strong candidates are offered on top.
    if (multi && strong.length === 1) return 'strong';
    if (multi && strong.length > 1) return 'ambiguous';
    return 'present';
  }
  if (strong.length === 1) return 'strong';
  if (strong.length > 1) return 'ambiguous';
  if (medium.length) return 'arbitrate';
  return searched ? 'absent' : 'none';
};

export const isActionable = (cell: StructureAlignCell | undefined): boolean => !!cell && ACTIONABLE_STATUSES.includes(cell.status);
