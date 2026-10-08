// Write commands of the directory domain API (druid-internal docs/plan-migration-postgresql.md, lot 2 a):
// lab scope checked before any write, memberships as Annuaire rows, merge log, audit, API routes. Fictitious data.
import { describe, it, expect, vi } from 'vitest';
import { createGristDirectoryCommands, WriteAudit } from '../directory/commands';
import { createDirectoryApi, AUDIT_HEADER } from '../directory/api';
import { createGristDirectoryRepository, GristClient } from '../directory/repository';
import type { GristRecord } from '../directory/gristMapping';
import type { Researcher } from '../../types';

/** In-memory Grist document: enough of the REST API for the commands, every write recorded. */
const fakeGrist = (initial: Record<string, GristRecord[]>, columns: string[] = ['LABO', 'rattachement', 'doublon_decision']) => {
  const tables: Record<string, GristRecord[]> = JSON.parse(JSON.stringify(initial));
  const cols = new Set(columns);
  let nextId = 1000;
  const writes: string[] = [];
  const client: GristClient & { tables: typeof tables; writes: string[] } = {
    tables, writes,
    docUpdatedAt: async () => 'v1',
    tableIds: async () => Object.keys(tables),
    records: async (table, filter) => (tables[table] || []).filter((r) =>
      !filter || Object.entries(filter).every(([col, values]) => values.includes(r.fields[col]))),
    columns: async () => [...cols].map((id) => ({ id, fields: { label: id, type: id.endsWith('_date') ? 'Text' : 'Any' } })),
    addColumns: async (_t, list) => { for (const c of list) cols.add(c.id); writes.push(`columns ${list.map((c) => c.id).join(',')}`); },
    addTables: async (list) => { for (const t of list) tables[t.id] = []; writes.push(`table ${list.map((t) => t.id).join(',')}`); },
    addRecords: async (table, records) => {
      const ids = records.map(() => nextId++);
      records.forEach((r, i) => (tables[table] ??= []).push({ id: ids[i], fields: { ...r.fields } }));
      writes.push(`add ${table} ${ids.join(',')}`);
      return ids;
    },
    updateRecords: async (table, records) => {
      for (const r of records) {
        const row = tables[table].find((x) => x.id === r.id);
        if (!row) throw new Error(`Grist HTTP 400 on PATCH: unknown row ${r.id}`);
        Object.assign(row.fields, r.fields);
      }
      writes.push(`update ${table} ${records.map((r) => r.id).join(',')}`);
    },
    deleteRecords: async (table, ids) => {
      tables[table] = tables[table].filter((r) => !ids.includes(r.id));
      writes.push(`delete ${table} ${ids.join(',')}`);
    },
    sql: async (query, args) => {
      const [, col, table] = /SELECT id, (\w+) AS v FROM (\w+)/.exec(query)!;
      return (tables[table] || []).filter((r) => args.includes(r.id)).map((r) => ({ id: r.id, v: r.fields[col] }));
    },
  };
  return client;
};

const researcher = (over: Omit<Partial<Researcher>, 'affiliations'> & { affiliations?: any[]; ldapPrefill?: unknown } = {}): Researcher => ({
  id: 'durand-a', uid: 'durand-a', gristRowId: 1, civility: 'F', lastName: 'Durand', firstName: 'Alice',
  displayName: 'DURAND Alice', email: 'alice@example.org', nationality: '', birthDate: '',
  employment: { employer: 'Université Exemple', institutionId: '', contractType: '', grade: '', internalTypology: '', startDate: '', endDate: '' },
  affiliations: [{ structureName: 'LAB-A', team: '', startDate: '2020', endDate: '', isPrimary: true }],
  identifiers: { orcid: '', idref: '', halId: '', scopusId: '' },
  ...over,
} as any);

const ANNUAIRE: GristRecord[] = [
  { id: 1, fields: { uid_dyna: 'durand-a', Nom: 'Durand', LABO: 'LAB-A' } },
  { id: 2, fields: { uid_dyna: 'martin-b', Nom: 'Martin', LABO: 'LAB-B' } },
];
const ETABLISSEMENTS: GristRecord[] = [{ id: 10, fields: { Employeur: 'Université Exemple' } }];
const ALL = { all: true, labAnchors: [] };
const LAB_A = { all: false, labAnchors: ['laba'] };

const setup = (tables: Record<string, GristRecord[]> = { Annuaire: ANNUAIRE, Etablissements: ETABLISSEMENTS }, columns?: string[]) => {
  const grist = fakeGrist(tables, columns);
  const repository = createGristDirectoryRepository({ grist });
  const invalidate = vi.spyOn(repository, 'invalidate');
  const commands = createGristDirectoryCommands({ grist, repository, today: () => '2026-10-08' });
  const audit: WriteAudit[] = [];
  const ctx = (scope: any) => ({ scope, audit: (e: WriteAudit) => audit.push(e) });
  return { grist, commands, audit, ctx, invalidate };
};

describe('createPerson', () => {
  it('creates the record with the employer resolved, and refuses a lab outside the scope before writing', async () => {
    const { grist, commands, audit, ctx, invalidate } = setup();
    const { recordId } = await commands.createPerson(researcher({ uid: 'petit-c', lastName: 'Petit' }), ctx(LAB_A));
    expect(grist.tables.Annuaire.find((r) => r.id === recordId)!.fields).toMatchObject({ uid_dyna: 'petit-c', LABO: 'LAB-A', Employeur: 10 });
    expect(audit[0]).toMatchObject({ table: 'Annuaire', kind: 'create', rows: [recordId] });
    expect(invalidate).toHaveBeenCalled();
    const before = grist.writes.length;
    await expect(commands.createPerson(researcher({ affiliations: [{ structureName: 'LAB-B', isPrimary: true }] }), ctx(LAB_A)))
      .rejects.toMatchObject({ status: 403, message: 'Write outside scope: LABO' });
    expect(grist.writes.length).toBe(before);
  });
});

describe('updatePerson', () => {
  it('rewrites the record row (fuzzy dates as text when the column is Text)', async () => {
    const { grist, commands, ctx } = setup(undefined, ['LABO', 'rattachement', 'doublon_decision', 'affiliation_start_date']);
    await commands.updatePerson(1, researcher(), ctx(LAB_A));
    expect(grist.tables.Annuaire[0].fields).toMatchObject({ Nom: 'Durand', LABO: 'LAB-A', affiliation_start_date: '2020', Employeur: 10 });
    expect(grist.writes).toEqual(['update Annuaire 1']);
  });

  it('refuses a lab right on a row of another lab, or moving its record out of its labs, before any write', async () => {
    const { grist, commands, ctx } = setup();
    await expect(commands.updatePerson(2, researcher({ uid: 'martin-b', affiliations: [{ structureName: 'LAB-A', isPrimary: true }] }), ctx(LAB_A)))
      .rejects.toMatchObject({ status: 403, message: 'Rows outside scope or unknown: Annuaire' });
    await expect(commands.updatePerson(1, researcher({ affiliations: [{ structureName: 'LAB-B', isPrimary: true }] }), ctx(LAB_A)))
      .rejects.toMatchObject({ status: 403 });
    expect(grist.writes).toEqual([]);
  });

  it('writes a second membership on its own row, creating the qualification columns first', async () => {
    const { grist, commands, audit, ctx } = setup(undefined, ['LABO']);
    await commands.updatePerson(1, researcher({ affiliations: [
      { structureName: 'LAB-A', isPrimary: true }, { structureName: 'LAB-B', isPrimary: false, endDate: '' },
    ] }), ctx(ALL));
    expect(grist.writes).toEqual(['columns rattachement,doublon_decision', 'update Annuaire 1', expect.stringMatching(/^add Annuaire \d+$/)]);
    const created = grist.tables.Annuaire.find((r) => r.fields.LABO === 'LAB-B' && r.fields.uid_dyna === 'durand-a')!;
    expect(created.fields).toMatchObject({ rattachement: 'SECONDAIRE', Nom: 'Durand', Email: 'alice@example.org' });
    expect(grist.tables.Annuaire[0].fields.rattachement).toBe('PRINCIPAL');
    expect(audit.map((a) => a.kind)).toEqual(['columns', 'update', 'create']);
  });

  it('logs a removed membership in Fusions_log (table created on first use) before deleting its row', async () => {
    const rows = [
      { id: 1, fields: { uid_dyna: 'durand-a', Nom: 'Durand', LABO: 'LAB-A', rattachement: 'PRINCIPAL' } },
      { id: 3, fields: { uid_dyna: 'durand-a', Nom: 'Durand', LABO: 'LAB-B', rattachement: 'SECONDAIRE' } },
    ];
    const { grist, commands, ctx } = setup({ Annuaire: rows, Etablissements: ETABLISSEMENTS });
    await commands.updatePerson(1, researcher(), ctx(ALL));
    expect(grist.writes).toEqual(['update Annuaire 1', 'table Fusions_log', expect.stringMatching(/^add Fusions_log/), 'delete Annuaire 3']);
    expect(grist.tables.Fusions_log[0].fields).toMatchObject({ kept_rowid: 1, dropped_rowid: 3, auteur: 'druid', note: 'affiliation removed from the record' });
  });

  it('refuses a second membership while other rows of the uid are not qualified (Duplicates page)', async () => {
    const rows = [...ANNUAIRE, { id: 3, fields: { uid_dyna: 'durand-a', LABO: 'LAB-B' } }];
    const { grist, commands, ctx } = setup({ Annuaire: rows, Etablissements: ETABLISSEMENTS });
    await expect(commands.updatePerson(1, researcher({ affiliations: [
      { structureName: 'LAB-A', isPrimary: true }, { structureName: 'LAB-C', isPrimary: false },
    ] }), ctx(ALL))).rejects.toMatchObject({ status: 409 });
    expect(grist.writes).toEqual([]);
  });

  it('ignores, for a lab right, the rows of the uid in other labs (as when it read them through the proxy)', async () => {
    const rows = [...ANNUAIRE, { id: 3, fields: { uid_dyna: 'durand-a', LABO: 'LAB-B', rattachement: 'SECONDAIRE' } }];
    const { grist, commands, ctx } = setup({ Annuaire: rows, Etablissements: ETABLISSEMENTS });
    await commands.updatePerson(1, researcher(), ctx(LAB_A));
    expect(grist.writes).toEqual(['update Annuaire 1']);
    expect(grist.tables.Annuaire.find((r) => r.id === 3)).toBeDefined();
  });
});

describe('bulk commands', () => {
  it('writes groups, validations and ABES marks on the rows of the scope only', async () => {
    const { grist, commands, ctx } = setup();
    await commands.setGroups([{ recordId: 1, groups: ['g1', 'g2'] }], ctx(LAB_A));
    expect(grist.tables.Annuaire[0].fields.groupes).toBe('g1|g2');
    await expect(commands.setGroups([{ recordId: 2, groups: [] }], ctx(LAB_A))).rejects.toMatchObject({ status: 403 });
    expect(await commands.applyValidations([{ recordId: 1, validation: { validated: true, validatedStatus: 'PRESENT', validationScope: ['statut'] } as any }], ctx(LAB_A))).toBe(1);
    expect(grist.tables.Annuaire[0].fields.validated).toBe(true);
    expect(await commands.markAbesSent([{ recordId: 1, hash: 'h' }, { recordId: 2, hash: 'h2' }], '2026-10-08', ctx(ALL))).toBe(2);
    expect(grist.tables.Annuaire[1].fields).toMatchObject({ ABES_export_hash: 'h2', ABES_export_date: '2026-10-08' });
  });

  it('turns a failed groups write into the provisioning hint', async () => {
    const { grist, commands, ctx } = setup();
    grist.updateRecords = async () => { throw new Error('Grist HTTP 400 on PATCH: Invalid column "groupes"'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(commands.setGroups([{ recordId: 1, groups: ['g'] }], ctx(ALL))).rejects.toMatchObject({ status: 502 });
    spy.mockRestore();
  });
});

describe('write routes', () => {
  const call = async (method: string, path: string, body: unknown, bindings: Record<string, unknown> = {}) => {
    const { commands, grist } = setup();
    const repository = createGristDirectoryRepository({ grist });
    const resp = await createDirectoryApi().fetch(
      new Request(`http://druid.test${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      { repository, commands, publications: {} as any, scope: ALL, writeRefusal: null, ...bindings },
    );
    return { status: resp.status, body: await resp.json(), audit: resp.headers.get(AUDIT_HEADER), grist };
  };

  it('creates and updates through the routes, with the audit of the Grist writes in a header', async () => {
    const created = await call('POST', '/api/v1/people', researcher({ uid: 'petit-c' }));
    expect(created.status).toBe(201);
    expect(created.body.recordId).toBeGreaterThan(0);
    expect(JSON.parse(created.audit!)[0]).toMatchObject({ table: 'Annuaire', kind: 'create' });
    const updated = await call('PUT', '/api/v1/people/1', researcher());
    expect(updated).toMatchObject({ status: 200, body: { ok: true } });
    expect((await call('PATCH', '/api/v1/people/groups', { entries: [{ recordId: 1, groups: ['g'] }] })).status).toBe(200);
    expect((await call('POST', '/api/v1/abes-exports', { entries: [{ recordId: 1, hash: 'h' }], date: '2026-10-08' })).body).toEqual({ updated: 1 });
  });

  it('answers 400 on a malformed body, 403 on a refused write (read-only instance), the command status otherwise', async () => {
    expect((await call('PUT', '/api/v1/people/1', { lastName: 'X' })).status).toBe(400);
    expect((await call('PUT', '/api/v1/people/abc', researcher())).status).toBe(400);
    expect((await call('POST', '/api/v1/abes-exports', { entries: [], date: '8/10/2026' })).status).toBe(400);
    const refused = await call('PUT', '/api/v1/people/1', researcher(), { writeRefusal: { status: 403, error: 'Read-only instance: writes are disabled' } });
    expect(refused).toMatchObject({ status: 403, body: { error: 'Read-only instance: writes are disabled' } });
    expect(refused.grist.writes).toEqual([]);
    const outside = await call('PUT', '/api/v1/people/2', researcher({ uid: 'martin-b' }), { scope: LAB_A });
    expect(outside).toMatchObject({ status: 403, body: { error: 'Rows outside scope or unknown: Annuaire' } });
  });

  it('keeps the reads open on a read-only instance', async () => {
    const { commands, grist } = setup();
    const repository = createGristDirectoryRepository({ grist });
    const resp = await createDirectoryApi().fetch(new Request('http://druid.test/api/v1/people'), {
      repository, commands, publications: {} as any, scope: ALL, writeRefusal: { status: 403, error: 'Read-only instance: writes are disabled' },
    });
    expect(resp.status).toBe(200);
  });
});

describe('structures (lot 2 b)', () => {
  const STRUCTURES: GristRecord[] = [
    { id: 7, fields: { short_labels: 'LAB-A[fr]', long_labels: 'Laboratoire A[fr]', local_id: '1001', generic_type: 'unit', type: 'UMR' } },
    { id: 8, fields: { short_labels: 'LAB-B[fr]', long_labels: 'Laboratoire B[fr]', local_id: '1002', generic_type: 'unit', type: 'UR' } },
  ];
  const tables = () => ({ Annuaire: ANNUAIRE, Etablissements: ETABLISSEMENTS, Structures: STRUCTURES });
  const team = (over: Record<string, unknown> = {}) => ({ acronym: 'MULTIX', officialName: 'Équipe Multix', level: '1', parentStructure: 'LAB-A', inclusions: [], participations: [], identifiers: {}, ...over }) as any;

  it('creates a team inside its lab (generated local_id, inclusion in the lab) and returns its Druid id', async () => {
    const { grist, commands, ctx } = setup(tables());
    const { id } = await commands.createStructure(team(), ctx(ALL));
    const row = grist.tables.Structures.find((r) => `S-${r.id}` === id)!;
    expect(row.fields).toMatchObject({ generic_type: 'team', type: 'TEAM', local_id: 'T-LAB_A-MULTIX', parent_structure: 'LAB-A', short_labels: 'MULTIX[fr]' });
    expect(row.fields.inclusions).toBe('local-1001[20261008-]');
  });

  it('refuses a missing acronym, a team without lab, a duplicate, a used local_id and an invalid entity code', async () => {
    const { grist, commands, ctx } = setup(tables());
    await expect(commands.createStructure(team({ acronym: ' ' }), ctx(ALL))).rejects.toMatchObject({ status: 400, message: 'The acronym / short name is required' });
    await expect(commands.createStructure(team({ parentStructure: '' }), ctx(ALL))).rejects.toMatchObject({ status: 400 });
    await expect(commands.createStructure(team({ acronym: 'LAB-B', level: '2', parentStructure: '' }), ctx(ALL)))
      .rejects.toMatchObject({ status: 409, message: 'A structure with this acronym already exists: LAB-B' });
    await expect(commands.createStructure(team({ localId: '1001' }), ctx(ALL))).rejects.toMatchObject({ status: 409, message: 'local_id already used: 1001' });
    await expect(commands.createStructure(team({ localId: '14 85' }), ctx(ALL))).rejects.toMatchObject({ status: 400 });
    expect(grist.writes).toEqual([]);
  });

  it('lets a lab right update its own structure only, and not create another one', async () => {
    const { grist, commands, ctx } = setup(tables());
    await commands.updateStructure(7, { acronym: 'LAB-A', officialName: 'Laboratoire A (nouveau nom)', inclusions: [], participations: [], identifiers: {} } as any, ctx(LAB_A));
    expect(grist.tables.Structures[0].fields.long_labels).toBe('Laboratoire A (nouveau nom)[fr]');
    // Renaming another lab's structure into its own lab: the existing row is checked too.
    await expect(commands.updateStructure(8, { acronym: 'LAB-A', identifiers: {} } as any, ctx(LAB_A)))
      .rejects.toMatchObject({ status: 403, message: 'Rows outside scope or unknown: Structures' });
    await expect(commands.updateStructure(7, { acronym: 'LAB-B', identifiers: {} } as any, ctx(LAB_A)))
      .rejects.toMatchObject({ status: 403, message: 'Write outside scope: short_labels' });
    await expect(commands.createStructure(team(), ctx(LAB_A))).rejects.toMatchObject({ status: 403 });
    expect(grist.writes).toEqual(['update Structures 7']);
  });
});
