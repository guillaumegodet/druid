import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const { planPresenceMigration } = createRequire(import.meta.url)('../../scripts/migrations/002-validated-presence.cjs');
const rec = (id: number, fields: Record<string, unknown>) => ({ id, fields: { validated: true, Nom: 'X', ...fields } });

describe('migration 002 — validated_status holds the presence', () => {
  const employers = { 1: 'NANTES UNIVERSITE', 2: 'CNRS', 3: 'non renseigné' };

  it('INTERNE / EXTERNE → PRESENT; DEPART, PARTI, PRESENT and non-validated rows untouched', () => {
    const { updates } = planPresenceMigration([
      rec(1, { validated_status: 'INTERNE' }), rec(2, { validated_status: 'externe' }), rec(3, { validated_status: 'DEPART' }),
      rec(4, { validated_status: 'PRESENT' }), rec(5, { validated: false, validated_status: 'INTERNE' }),
    ], employers);
    expect(updates.map((u: { id: number; fields: object }) => [u.id, u.fields])).toEqual([[1, { validated_status: 'PRESENT' }], [2, { validated_status: 'PRESENT' }]]);
  });

  it('a task for EXTERNE without employer (empty or « non renseigné »), once', () => {
    const rows = [
      rec(1, { validated_status: 'EXTERNE', Employeur: 0 }), rec(2, { validated_status: 'EXTERNE', Employeur: 3 }),
      rec(3, { validated_status: 'EXTERNE', Employeur: 2 }), rec(4, { validated_status: 'INTERNE', Employeur: 0 }),
    ];
    expect(planPresenceMigration(rows, employers).tasks.map((t: { chercheurRowId: number }) => t.chercheurRowId)).toEqual([1, 2]);
    expect(planPresenceMigration(rows, employers, new Set([1])).tasks.map((t: { chercheurRowId: number }) => t.chercheurRowId)).toEqual([2]);
  });
});
