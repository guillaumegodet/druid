import { describe, it, expect } from 'vitest';
import { buildTaskEmail, hasTaskEmail, mailtoUrl } from '../taskEmailTemplates';
import { TASK_TYPES, TASK_TYPE_IDS } from '../tasks';

const ctx = { civility: 'Mme', firstName: 'Jeanne', lastName: 'Dupont', labo: 'CREN', orcid: '0000-0001-9900-9046', halId: 'j-dupont', scopusId: '123', description: 'Second ORCID : 0009-0000-0000-0001', senderName: 'J. Durand' };

describe('lib/taskEmailTemplates (docs/plan-chantiers-taches.md, lot 3)', () => {
  it('every type flagged email:true has a template, the others none', () => {
    for (const id of TASK_TYPE_IDS) {
      expect(hasTaskEmail(id), id).toBe(TASK_TYPES[id].email);
      expect(buildTaskEmail(id, ctx) === null, id).toBe(!TASK_TYPES[id].email);
    }
    expect(hasTaskEmail('bogus')).toBe(false);
  });
  it('substitutes the researcher context and the task detail', () => {
    const e = buildTaskEmail('orcid_deux_ids', ctx)!;
    expect(e.subject).toMatch(/ORCID/);
    expect(e.body).toContain('Bonjour Madame Dupont,');
    expect(e.body).toContain('(CREN)');
    expect(e.body).toContain('0000-0001-9900-9046');
    expect(e.body).toContain('Précision : Second ORCID : 0009-0000-0000-0001');
    expect(e.body).toContain('J. Durand');
    expect(e.body).not.toMatch(/\n{3,}/);
  });
  it('degrades cleanly without civility, identifiers or description', () => {
    const e = buildTaskEmail('scopus_deux_ids', { firstName: 'Jean', lastName: 'Martin' })!;
    expect(e.body.startsWith('Bonjour Jean Martin,')).toBe(true);
    expect(e.body).not.toContain('Précision');
    expect(e.body).not.toContain('(dont');
  });
  it('mailtoUrl encodes recipient, subject and body', () => {
    const url = mailtoUrl('a.b@example.org', { subject: 'Sujet é', body: 'Ligne 1\nLigne 2' });
    expect(url).toBe('mailto:a.b%40example.org?subject=Sujet%20%C3%A9&body=Ligne%201%0ALigne%202');
  });
});
