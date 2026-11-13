// Import of a spreadsheet of researchers (druid-internal docs/plan-druid-saas.md, lot 5 a): reading the sheet (headers
// in French or English, CSV with `;`), identifiers, grouping of a person's rows, matching, joins, teams, rejected rows.
// Fictitious data only.
import { describe, expect, it } from 'vitest';
import { StructureLevel, type Researcher, type Structure } from '../../types';
import type { Institution } from '../directory/gristMapping';
import {
  applyPeopleImport, fieldOfHeader, halIdOf, idrefOf, orcidOf, parseCsv, planPeopleImport, readSheet, teamKey, teamsOfCell, withImport,
  type PeopleImportRow,
} from '../directory/peopleImport';

const structure = (acronym: string, level: StructureLevel, parent = '', officialName = ''): Structure =>
  ({ id: `S-${acronym}-${parent}`, acronym, level, parentStructure: parent, officialName } as unknown as Structure);
const STRUCTURES = [
  structure('LAB-A', StructureLevel.ENTITE, '', 'Laboratoire Alpha'), structure('LAB-B', StructureLevel.ENTITE),
  structure('IA', StructureLevel.EQUIPE, 'LAB-A'),
];
const INSTITUTIONS: Institution[] = [{ id: 1, name: 'UNIVERSITE EXEMPLE', label: 'Université Exemple', uai: '', ror: '', idref: '' }];

const researcher = (id: string, last: string, first: string, lab: string, opts: Partial<{ email: string; orcid: string; team: string; grade: string; rowId: number }> = {}): Researcher => ({
  id, uid: '', lastName: last, firstName: first, displayName: `${last.toUpperCase()} ${first}`, civility: '', email: opts.email ?? '', status: 'Actif' as any,
  gristRowId: opts.rowId ?? 1, employment: { employer: '', grade: opts.grade ?? '' },
  affiliations: [{ structureName: lab, team: opts.team ?? '', startDate: '', isPrimary: true }],
  groups: [], identifiers: opts.orcid ? { orcid: opts.orcid } : {}, photoUrl: '', annuaireUrl: '', profiles: {},
} as unknown as Researcher);

const row = (r: Partial<PeopleImportRow>): PeopleImportRow =>
  ({ lastName: '', firstName: '', lab: '', email: '', team: '', employer: '', position: '', grade: '', orcid: '', idref: '', halId: '', uid: '', ...r });

describe('reading the sheet', () => {
  it('recognizes French and English headers, ignores the others, keeps the first column of a field', () => {
    expect(fieldOfHeader('Prénom')).toBe('firstName');
    expect(fieldOfHeader(' E-mail ')).toBe('email');
    expect(fieldOfHeader('Corps-grade')).toBe('grade');
    expect(fieldOfHeader('Unité de recherche')).toBe('lab');
    expect(fieldOfHeader('Last name')).toBe('lastName');
    expect(fieldOfHeader('Remarques')).toBeNull();
    const r = readSheet([[], ['Nom', 'Prénom', 'Labo', 'Remarques', 'Nom'], ['Durand', 'Léa', 'LAB-A', 'x', 'autre'], ['', '', '', '', ''], ['Petit', '', 'LAB-B']]);
    expect(r.columns.map((c) => c.field)).toEqual(['lastName', 'firstName', 'lab', null, null]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ lastName: 'Durand', firstName: 'Léa', lab: 'LAB-A' });
    expect(r.missing).toEqual([]);
    expect(readSheet([['Prénom', 'E-mail'], ['a', 'b']]).missing).toEqual(['lastName', 'lab']);
  });

  it('reads a CSV written by French Excel (BOM, `;`, quotes, line breaks in a cell)', () => {
    expect(parseCsv('﻿Nom;Prénom;Équipe\r\nDurand;"Léa";"IA; Réseaux"\r\n"O""Neil";Ann;"a\nb"\r\n')).toEqual([
      ['Nom', 'Prénom', 'Équipe'], ['Durand', 'Léa', 'IA; Réseaux'], ['O"Neil', 'Ann', 'a\nb'],
    ]);
    expect(parseCsv('Nom,Labo\nDurand,LAB-A')).toEqual([['Nom', 'Labo'], ['Durand', 'LAB-A']]);
  });

  it('normalizes the identifiers, from a bare id or a URL', () => {
    expect(orcidOf('https://orcid.org/0000-0002-1825-009x')).toBe('0000-0002-1825-009X');
    expect(orcidOf('1234')).toBe('');
    expect(idrefOf('https://www.idref.fr/12345678X/')).toBe('12345678X');
    expect(idrefOf('1234')).toBe('');
    expect(halIdOf('https://cv.hal.science/lea-durand')).toBe('lea-durand');
    expect(teamsOfCell('IA | Réseaux; IA')).toEqual(['IA', 'Réseaux']);
  });
});

describe('plan', () => {
  const people = [
    researcher('durand-l', 'Durand', 'Léa', 'LAB-A', { email: 'lea.durand@example.org', team: 'IA', rowId: 10 }),
    researcher('martin-p', 'Martin', 'Paul', 'LAB-A', { rowId: 11 }),
    researcher('martin-j', 'Martin', 'Jeanne', 'LAB-A', { rowId: 12 }),
    researcher('petit-o', 'Petit', 'Olivier', 'LAB-B', { orcid: '0000-0002-1825-0097', rowId: 13 }),
  ];
  const plan = planPeopleImport({ source: 'Fichier test', rows: [
    /* 0 */ row({ lastName: 'Nouveau', firstName: 'Sam', lab: 'LAB-A', team: 'IA', email: 'Sam@Example.org', grade: 'MCF', employer: 'Université Exemple' }),
    /* 1 */ row({ lastName: 'NOUVEAU', firstName: 'Sam', lab: 'lab b', team: 'Réseaux' }),
    /* 2 */ row({ lastName: 'Durand', firstName: 'Léa', lab: 'Laboratoire Alpha', grade: 'PR', orcid: 'https://orcid.org/0000-0001-0000-0001' }),
    /* 3 */ row({ lastName: 'Durand', firstName: 'Léa', lab: 'LAB-B', email: 'lea.durand@example.org' }),
    /* 4 */ row({ lastName: 'Martin', firstName: 'Lucie', lab: 'LAB-A' }),
    /* 5 */ row({ lastName: 'Inconnu', lab: 'LAB-Z' }),
    /* 6 */ row({ firstName: 'Sans nom', lab: 'LAB-A' }),
    /* 7 */ row({ lastName: 'Autre', firstName: 'Nom', lab: 'LAB-B', orcid: '0000-0002-1825-0097', idref: 'pas un ppn' }),
    /* 8 */ row({ lastName: 'Nouveau', firstName: 'Sam', lab: 'LAB-A' }),
  ] }, people, INSTITUTIONS, STRUCTURES);

  it('creates one record per new person, with every lab of its rows', () => {
    expect(plan.creations).toHaveLength(1);
    expect(plan.creations[0]).toMatchObject({
      index: 0, rows: [0, 1, 8], lastName: 'Nouveau', firstName: 'Sam', email: 'sam@example.org', grade: 'MCF', employer: 'UNIVERSITE EXEMPLE',
      labs: [{ lab: 'LAB-A', team: 'IA' }, { lab: 'LAB-B', team: 'Réseaux' }],
    });
    expect(plan.rejected).toContainEqual({ index: 8, name: 'NOUVEAU Sam', lab: 'LAB-A', reason: 'duplicate' });
  });

  it('matches by email or identifier anywhere, completes a member, adds a membership elsewhere', () => {
    // Rows 2 and 3 are one person (same name), matched by the email of row 3.
    expect(plan.updates.find((u) => u.index === 2)).toMatchObject({
      researcherId: 'durand-l', matchedBy: 'email', lab: 'LAB-A',
      complements: [{ field: 'grade', value: 'PR' }, { field: 'orcid', value: '0000-0001-0000-0001' }], differences: [],
    });
    expect(plan.joins).toContainEqual({ index: 3, researcherId: 'durand-l', name: 'DURAND Léa', matchedBy: 'email', lab: 'LAB-B', team: '' });
    // Row 7: another name, but the ORCID of a member of LAB-B → that member, nothing new to write; the bad PPN is reported.
    expect(plan.unchanged).toBe(1);
    expect(plan.warnings).toEqual([{ index: 7, field: 'idref', value: 'pas un ppn' }]);
  });

  it('leaves homonyms without a compatible first name out, and reports rows it cannot place', () => {
    expect(plan.ambiguous).toEqual([{ index: 4, name: 'MARTIN Lucie', lab: 'LAB-A', candidates: [{ researcherId: 'martin-p', name: 'MARTIN Paul' }, { researcherId: 'martin-j', name: 'MARTIN Jeanne' }] }]);
    expect(plan.rejected).toContainEqual({ index: 5, name: 'INCONNU', lab: 'LAB-Z', reason: 'unknownLab' });
    expect(plan.rejected).toContainEqual({ index: 6, name: 'Sans nom', lab: 'LAB-A', reason: 'lastName' });
  });

  it('proposes the unknown teams of a lab', () => {
    expect(plan.teams).toEqual([{ lab: 'LAB-B', acronym: 'Réseaux' }]);
  });

  it('writes the grade only when the difference is ticked, never another identifier', () => {
    const u = planPeopleImport({ source: '', rows: [row({ lastName: 'Petit', firstName: 'Olivier', lab: 'LAB-B', grade: 'DR', orcid: '0000-0001-0000-0001' })] },
      [researcher('petit-o', 'Petit', 'Olivier', 'LAB-B', { orcid: '0000-0002-1825-0097', grade: 'CR' })], INSTITUTIONS, STRUCTURES).updates[0];
    expect(u.complements).toEqual([]);
    expect(u.differences).toEqual([{ field: 'grade', current: 'CR', file: 'DR' }]);
  });
});

describe('application', () => {
  it('creates the teams, the people (main lab, then the others), and one update per matched researcher', async () => {
    const people = [researcher('durand-l', 'Durand', 'Léa', 'LAB-A', { email: 'lea@example.org', rowId: 10 })];
    const calls: string[] = [];
    let next = 100;
    const commands = {
      createStructure: async (s: Structure) => { calls.push(`team ${s.parentStructure}/${s.acronym}`); return { id: 'x' }; },
      createPerson: async (r: Researcher) => { calls.push(`create ${r.lastName} ${r.affiliations.map((a) => a.structureName).join('+')}`); return { recordId: next++ }; },
      updatePerson: async (id: number, r: Researcher) => { calls.push(`update ${id} ${r.affiliations.map((a) => `${a.structureName}${a.isPrimary ? '*' : ''}`).join('+')} ${r.identifiers?.orcid ?? ''}`); },
      applyValidations: async () => 0,
    };
    const input = { source: 'Fichier test', rows: [
      row({ lastName: 'Nouveau', firstName: 'Sam', lab: 'LAB-A' }), row({ lastName: 'Nouveau', firstName: 'Sam', lab: 'LAB-B', team: 'NEW' }),
      row({ lastName: 'Durand', firstName: 'Léa', lab: 'LAB-A', orcid: '0000-0001-0000-0001' }), row({ lastName: 'Durand', firstName: 'Léa', lab: 'LAB-B' }),
    ] };
    const result = await applyPeopleImport({
      input, people, institutions: INSTITUTIONS, structures: STRUCTURES, commands, ctx: {}, today: '2026-11-10', actor: 't',
      selection: { teams: [teamKey('LAB-B', 'NEW'), 'gone|X'], creations: [0], joins: [3], fields: [{ index: 2, field: 'orcid' }], validateNew: false },
    });
    expect(calls).toEqual([
      'team LAB-B/NEW', 'create Nouveau LAB-A', 'update 100 LAB-A*+LAB-B ', 'update 10 LAB-A*+LAB-B 0000-0001-0000-0001',
    ]);
    expect(result).toEqual({ teamsCreated: 1, created: 1, joined: 2, updated: 1, stale: 1, errors: [] });
  });

  it('marks the first membership as the main one before adding another', () => {
    const r = researcher('a', 'A', 'B', 'LAB-A');
    r.affiliations[0].isPrimary = undefined as any;
    const out = withImport(r, [{ index: 0, researcherId: 'a', name: '', matchedBy: 'email', lab: 'LAB-B', team: 'IA' }], []);
    expect(out.affiliations.map((a) => [a.structureName, a.isPrimary, a.team])).toEqual([['LAB-A', true, ''], ['LAB-B', false, 'IA']]);
  });
});
