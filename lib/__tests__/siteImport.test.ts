// Import of a lab website directory (druid-internal docs/plan-migration-postgresql.md, lot 8 d2): matching, creations,
// complements, differences, presence. Rules ported from druid-biblio's sync_annuaire.py. Fictitious data only.
import { describe, it, expect } from 'vitest';
import {
  planSiteImport, SiteImportDocumentSchema, typingOf, employerResolver, normName, applySiteImport, SiteImportSelectionSchema,
} from '../directory/siteImport';
import type { Researcher } from '../../types';
import type { Institution } from '../directory/gristMapping';

const researcher = (id: string, last: string, first: string, opts: Partial<{
  uid: string; email: string; lab: string; team: string; role: string; validated: boolean; grade: string;
  employer: string; photoUrl: string; cv: string; rowId: number; extra: { structureName: string; team: string; role?: string; gristRowId?: number }[];
}> = {}): Researcher => ({
  id, uid: opts.uid ?? id, lastName: last, firstName: first, displayName: `${last.toUpperCase()} ${first}`,
  civility: '', email: opts.email ?? '', status: 'Actif' as any, gristRowId: opts.rowId,
  photoUrl: opts.photoUrl ?? '', profiles: { cvSiteLabo: opts.cv ?? '' },
  employment: { employer: opts.employer ?? '', grade: opts.grade ?? '' },
  affiliations: [
    { structureName: opts.lab ?? 'LAB-A', team: opts.team ?? '', startDate: '', isPrimary: true, role: opts.role as any },
    ...(opts.extra ?? []).map((e) => ({ ...e, startDate: '', isPrimary: false, role: e.role as any })),
  ],
  groups: [], identifiers: {},
  validation: { validated: opts.validated ?? false, validationScope: [] },
} as Researcher);

const INSTITUTIONS: Institution[] = [
  { id: 1, name: 'UNIVERSITE EXEMPLE', label: 'Université Exemple', uai: '', ror: '', idref: '' },
  { id: 2, name: 'Université Exemple', label: '', uai: '', ror: '', idref: '' },
  { id: 3, name: 'ORGANISME', label: 'Organisme national', uai: '', ror: '', idref: '' },
];

const doc = (people: Record<string, string>[]) => SiteImportDocumentSchema.parse({
  format: 'druid-site-import', version: 1, lab: 'LAB-A', source: 'Site LAB-A', people,
});

describe('site import — matching', () => {
  const PEOPLE = [
    researcher('durand-a', 'Durand', 'Alice', { email: 'alice@example.org', rowId: 11 }),
    researcher('martin-b', 'Martin-Leroy', 'Bruno', { rowId: 12, uid: 'mart-b' }),
    researcher('petit-c', 'Petit', 'Chloé', { rowId: 13 }),
    researcher('petit-d', 'Petit', 'Denis', { rowId: 14 }),
    researcher('roux-e', 'Roux', 'Anna-Maria', { rowId: 15 }),
    researcher('autre-f', 'Autre', 'Fanny', { lab: 'LAB-B', email: 'fanny@example.org', rowId: 16 }),
  ];

  it('matches on uid, email, name, compatible first name or the only member with that last name', () => {
    const plan = planSiteImport(doc([
      { lastName: 'Inconnu', firstName: 'X', uid: 'mart-b' },
      { lastName: 'DURAND-SMITH', firstName: 'Alice', email: 'ALICE@example.org' },
      { lastName: 'Petit', firstName: 'Chloe' },
      { lastName: 'PETIT', firstName: 'Denis Marc' },
      { lastName: 'Roux', firstName: 'Ana' },
    ]), PEOPLE, INSTITUTIONS);
    expect(plan.matches.map((m) => [m.researcherId, m.matchedBy])).toEqual([
      ['martin-b', 'uid'], ['durand-a', 'email'], ['petit-c', 'name'], ['petit-d', 'firstName'], ['roux-e', 'lastName'],
    ]);
    expect(plan.matches[0].recordId).toBe(12);
    expect(plan.creations).toEqual([]);
    expect(plan.labCount).toBe(5);
  });

  it('leaves a homonym without compatible first name out, and creates the unknown people', () => {
    const plan = planSiteImport(doc([
      { lastName: 'Petit', firstName: 'Zoé' },
      { lastName: 'Nouveau', firstName: 'Noé', email: 'fanny@example.org', employer: 'Université Exemple', position: 'Doctorant' },
    ]), PEOPLE, INSTITUTIONS);
    expect(plan.ambiguous.map((a) => [a.person.firstName, a.candidates.map((c) => c.researcherId)])).toEqual([['Zoé', ['petit-c', 'petit-d']]]);
    expect(plan.creations).toHaveLength(1);
    expect(plan.creations[0]).toMatchObject({ index: 1, employmentType: 'DOCTORANT', grade: '', sameEmailLabs: ['LAB-B'] });
  });
});

describe('site import — complements, differences, presence', () => {
  it('fills the empty fields, lists the other values as differences, never overwrites a photo', () => {
    const people = [researcher('durand-a', 'Durand', 'Alice', {
      email: 'Alice@Example.org', team: 'EQ1', grade: 'MCF', photoUrl: 'https://old/photo.jpg', rowId: 11,
    })];
    // The same email in another case is not a difference.
    const plan = planSiteImport(doc([{
      lastName: 'Durand', firstName: 'Alice', email: 'alice@example.org', team: 'EQ1|EQ2', grade: 'PR',
      profileUrl: 'https://lab/durand', directoryUrl: 'https://lab/annuaire/durand', photoUrl: 'https://new/photo.jpg',
    }]), people, INSTITUTIONS);
    const [m] = plan.matches;
    expect(m.complements).toEqual([
      { field: 'profileUrl', value: 'https://lab/durand' }, { field: 'directoryUrl', value: 'https://lab/annuaire/durand' },
    ]);
    expect(m.differences).toEqual([
      { field: 'team', current: 'EQ1', site: 'EQ1|EQ2' }, { field: 'grade', current: 'MCF', site: 'PR' },
    ]);
  });

  it('proposes the unvalidated members present on the site, lists the absent ones (qualified secondary ones excepted)', () => {
    const people = [
      researcher('durand-a', 'Durand', 'Alice', { validated: false }),
      researcher('martin-b', 'Martin', 'Bruno', { validated: true }),
      researcher('petit-c', 'Petit', 'Chloé', { validated: true }),
      researcher('roux-e', 'Roux', 'Emma', { lab: 'LAB-B', extra: [{ structureName: 'LAB-A', team: '', role: 'SECONDAIRE', gristRowId: 99 }] }),
      researcher('leroy-f', 'Leroy', 'Félix', { role: 'HISTORIQUE' }),
    ];
    const plan = planSiteImport(doc([
      { lastName: 'Durand', firstName: 'Alice' }, { lastName: 'Martin', firstName: 'Bruno' }, { lastName: 'Roux', firstName: 'Emma' },
    ]), people, INSTITUTIONS);
    expect(plan.matches.map((m) => [m.researcherId, m.toValidate])).toEqual([['durand-a', true], ['martin-b', false], ['roux-e', false]]);
    expect(plan.matches[2].recordId).toBe(99);
    expect(plan.absent.map((a) => [a.researcherId, a.validated])).toEqual([['petit-c', true]]);
  });
});

describe('site import — typing and employer', () => {
  it('types the new records like sync_annuaire', () => {
    const p = (position: string, role = '', grade = '') => typingOf({ position, role, grade } as any);
    expect(p('Post-doctorant')).toEqual({ grade: 'POST-DOC', employmentType: 'Ch_aut' });
    expect(p('Doctorante')).toEqual({ grade: '', employmentType: 'DOCTORANT' });
    expect(p('', 'Doctorant/Post-doc')).toEqual({ grade: '', employmentType: 'DOCTORANT' });
    expect(p('Maître de conférences', 'Chercheur', 'MCF')).toEqual({ grade: 'MCF', employmentType: '' });
  });

  it('resolves the employer label to the institution the lab already uses, then any matching one', () => {
    const members = [researcher('a', 'A', 'A', { employer: 'Université Exemple' }), researcher('b', 'B', 'B', { employer: 'Université Exemple' }),
      researcher('c', 'C', 'C', { employer: 'UNIVERSITE EXEMPLE' })];
    const resolve = employerResolver(INSTITUTIONS, members);
    expect(resolve('université exemple')).toBe('Université Exemple');
    expect(resolve('Organisme national')).toBe('ORGANISME');
    expect(resolve('Inconnu')).toBe('');
    expect(resolve('')).toBe('');
  });

  it('normalizes names like sync_annuaire and rejects an unknown file', () => {
    expect(normName("  Le Brun-D’Arc  ")).toBe('le brun d arc');
    expect(() => SiteImportDocumentSchema.parse({ format: 'other', version: 1, lab: 'X', people: [] })).toThrow();
    expect(() => SiteImportDocumentSchema.parse({ format: 'druid-site-import', version: 1, lab: 'X', people: [{ firstName: 'x' }] })).toThrow();
  });
});

describe('site import — application (lot 8 d3)', () => {
  const fakeCommands = () => {
    const calls: { op: string; recordId?: number; researcher?: Researcher; entries?: any[] }[] = [];
    let next = 500;
    return {
      calls,
      createPerson: async (researcher: Researcher) => { calls.push({ op: 'create', researcher }); return { recordId: next++ }; },
      updatePerson: async (recordId: number, researcher: Researcher) => {
        if (researcher.lastName === 'Casse') throw new Error('Grist HTTP 500');
        calls.push({ op: 'update', recordId, researcher });
      },
      applyValidations: async (entries: any[]) => { calls.push({ op: 'validate', entries }); return entries.length; },
    };
  };
  const PEOPLE = [
    researcher('durand-a', 'Durand', 'Alice', { rowId: 11, team: 'EQ1', lab: 'Lab-A' }),
    researcher('martin-b', 'Martin', 'Bruno', { rowId: 12, validated: true, grade: 'MCF' }),
    researcher('casse-c', 'Casse', 'Carl', { rowId: 13 }),
  ];
  const DOC = doc([
    { lastName: 'Durand', firstName: 'Alice', team: 'EQ1|EQ2', profileUrl: 'https://lab/durand', status: 'EXTERNE' },
    { lastName: 'Martin', firstName: 'Bruno', grade: 'PR' },
    { lastName: 'Nouveau', firstName: 'Noé', employer: 'Organisme national', position: 'Post-doctorant', directoryUrl: 'https://lab/annuaire/noe' },
    { lastName: 'Casse', firstName: 'Carl', email: 'carl@example.org' },
  ]);
  const run = (selection: any, commands = fakeCommands()) => applySiteImport({
    doc: DOC, selection: SiteImportSelectionSchema.parse(selection), people: PEOPLE, institutions: INSTITUTIONS,
    commands, ctx: {}, today: '2026-10-09', actor: 'admin-x',
  }).then((result) => ({ result, calls: commands.calls }));

  it('applies only what was ticked, in order: creations, field updates, then validations', async () => {
    const { result, calls } = await run({
      creations: [2], validateNew: true,
      fields: [{ index: 0, field: 'profileUrl' }, { index: 0, field: 'team' }, { index: 1, field: 'grade' }],
      validate: [0],
    });
    expect(result).toEqual({ created: 1, updated: 2, validated: 1, stale: 0, errors: [] });
    expect(calls.map((c) => c.op)).toEqual(['create', 'update', 'update', 'validate']);
    const created = calls[0].researcher!;
    expect(created).toMatchObject({
      lastName: 'Nouveau', annuaireUrl: 'https://lab/annuaire/noe', importSource: 'Site LAB-A',
      employment: { employer: 'ORGANISME', grade: 'POST-DOC', contractType: 'Ch_aut' },
      affiliations: [{ structureName: 'Lab-A', isPrimary: true }],
      validation: { validated: true, validatedStatus: 'PRESENT', validationSource: 'Site LAB-A', validatedBy: 'admin-x' },
    });
    // The lab's membership gets the site's teams; the rest of the record is untouched.
    expect(calls[1]).toMatchObject({ recordId: 11, researcher: { profiles: { cvSiteLabo: 'https://lab/durand' } } });
    expect(calls[1].researcher!.affiliations[0].team).toBe('EQ1|EQ2');
    expect(calls[2].researcher!.employment.grade).toBe('PR');
    expect(calls[3].entries).toEqual([{ recordId: 11, validation: expect.objectContaining({ validatedStatus: 'PRESENT', validationDate: '2026-10-09' }) }]);
    expect(PEOPLE[0].affiliations[0].team).toBe('EQ1');
  });

  it('skips what the plan no longer offers and reports the failures without stopping', async () => {
    const { result, calls } = await run({
      creations: [0], fields: [{ index: 1, field: 'email' }, { index: 3, field: 'email' }], validate: [1, 9],
    });
    expect(result.stale).toBe(4);
    expect(result.errors).toEqual([{ index: 3, name: 'CASSE Carl', error: 'Grist HTTP 500' }]);
    expect(calls).toEqual([]);
  });
});
