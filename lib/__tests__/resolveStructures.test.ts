// Lab and team labels of a membership → structures (lib/directory/pg/recordFields.ts). Fictitious structures:
// the generic team codes of the lab rosters (E1, E2…) exist in several labs, and a label must never link a member
// to the team of another lab, even when that lab is the only one declaring the code as a structure.
import { describe, it, expect } from 'vitest';
import { resolveStructures } from '../directory/pg/recordFields';

type Row = { id: string; acronym: string | null; parent_id: string | null };
const STRUCTURES: Row[] = [
  { id: '1', acronym: 'LAB-A', parent_id: null },
  { id: '2', acronym: 'LAB-B', parent_id: null },
  { id: '3', acronym: 'LAB-C', parent_id: null },
  { id: '11', acronym: 'E1', parent_id: '1' }, // only LAB-A declares its E1 team
  { id: '12', acronym: 'TEAMX', parent_id: '1' },
  { id: '21', acronym: 'TEAMX', parent_id: '2' }, // same acronym in two labs
  { id: '31', acronym: 'SOLO', parent_id: '3' }, // unique acronym
  { id: '40', acronym: null, parent_id: null },
];
/** Enough of a Kysely transaction for resolveStructures: one query over `structure`. */
const trx = {
  selectFrom: () => ({ select: () => ({ orderBy: () => ({ execute: async () => STRUCTURES }) }) }),
} as any;

describe('resolveStructures', () => {
  it('links a team label to the team under the lab of the membership', async () => {
    expect(await resolveStructures(trx, 'LAB-A', ['E1', 'TEAMX'])).toEqual({ structureId: '1', teamIds: ['11', '12'] });
    expect(await resolveStructures(trx, 'LAB-B', ['TEAMX'])).toEqual({ structureId: '2', teamIds: ['21'] });
  });

  it('never links a label to the team of another lab, even when that team is the only one of its acronym', async () => {
    expect(await resolveStructures(trx, 'LAB-B', ['E1'])).toEqual({ structureId: '2', teamIds: [] });
    expect(await resolveStructures(trx, 'LAB-A', ['SOLO'])).toEqual({ structureId: '1', teamIds: [] });
    expect(await resolveStructures(trx, 'LAB-C', ['E1', 'SOLO'])).toEqual({ structureId: '3', teamIds: ['31'] });
  });

  it('without a resolved lab, links the one structure bearing the acronym', async () => {
    expect(await resolveStructures(trx, 'UNKNOWN', ['E1', 'TEAMX'])).toEqual({ structureId: null, teamIds: ['11'] });
    expect(await resolveStructures(trx, 'zzz', ['SOLO'])).toEqual({ structureId: null, teamIds: ['31'] });
    expect(await resolveStructures(trx, '', [])).toEqual({ structureId: null, teamIds: [] });
  });

  it('ignores the lab itself, unknown labels, case and repeats', async () => {
    expect(await resolveStructures(trx, 'LAB-A', ['LAB-A', 'e1', 'E1', 'NOPE'])).toEqual({ structureId: '1', teamIds: ['11'] });
  });
});
