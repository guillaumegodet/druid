// Import of the news items from Grist into PostgreSQL (lib/publications/newsletterImport.ts, lot 14 a of druid-internal
// docs/plan-migration-postgresql.md): ids kept, items already present left alone, unusable rows set aside.
import { describe, expect, it } from 'vitest';
import { planNewsletterImport } from '../publications/newsletterImport';

const rec = (id: number, fields: Record<string, unknown>) => ({ id, fields: { slug: 'ls2n', work_id: `W${id}`, statut: 'genere', ...fields } });

describe('planNewsletterImport', () => {
  it('keeps the Grist ids, maps the texts and the dates, counts by structure and status', () => {
    const plan = planNewsletterImport([
      rec(3, { titre: 'Un titre', statut: 'valide', valide_le: '2026-09-20T10:00:00.000Z', valide_par: 'ada-l', genere_le: 1758000000 }),
      rec(1, { slug: 'lppl', statut: '', doi: null }),
    ], []);
    expect(plan.rows.map((r) => [r.id, r.slug, r.statut])).toEqual([[1, 'lppl', 'genere'], [3, 'ls2n', 'valide']]);
    expect(plan.rows[1]).toMatchObject({ titre: 'Un titre', valide_par: 'ada-l', doi: '' });
    expect(plan.rows[1].valide_le?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    expect(plan.rows[1].genere_le?.toISOString()).toBe('2025-09-16T05:20:00.000Z');
    expect(plan.rows[0].doi).toBe('');
    expect(plan).toMatchObject({ byStructure: { lppl: 1, ls2n: 1 }, byStatus: { genere: 1, valide: 1 }, alreadyPresent: 0, setAside: [] });
  });

  it('leaves the items already in PostgreSQL, sets aside duplicates, empty keys and unknown statuses, renumbers a taken id', () => {
    const plan = planNewsletterImport([
      rec(1, {}), rec(2, { work_id: 'W1' }), rec(3, { slug: '' }), rec(4, { statut: 'brouillon' }), rec(5, {}), rec(6, {}),
    ], [{ id: 6, slug: 'ls2n', work_id: 'W6' }, { id: 5, slug: 'lten', work_id: 'W99' }]);
    expect(plan.rows.map((r) => [r.id, r.work_id])).toEqual([[1, 'W1'], [undefined, 'W5']]);
    expect(plan.alreadyPresent).toBe(1);
    expect(plan.setAside).toEqual([
      { id: 2, reason: 'doublon de la ligne 1' },
      { id: 3, reason: 'structure ou œuvre OpenAlex vide' },
      { id: 4, reason: 'statut inconnu « brouillon »' },
    ]);
  });
});
