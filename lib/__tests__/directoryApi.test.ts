// Directory domain API, read side (druid-internal docs/plan-migration-postgresql.md, lot 1): routes,
// lab scope, Grist repository caching, Node session adapter. Fictitious data only.
import { describe, it, expect, vi } from 'vitest';
import { createDirectoryApi } from '../directory/api';
import { createGristDirectoryRepository, DirectoryRepository, GristReader } from '../directory/repository';
import type { GristRecord } from '../directory/gristMapping';
import { scopeOfSession } from '../../server/apiV1';

const annuaireRow = (id: number, fields: Record<string, any>): GristRecord => ({
  id,
  fields: { uid_dyna: '', Nom: '', Prenom: '', LABO: '', Employeur: 0, ...fields },
});

const ANNUAIRE: GristRecord[] = [
  annuaireRow(1, { uid_dyna: 'durand-a', Nom: 'Durand', Prenom: 'Alice', LABO: 'LAB-A', Employeur: 10, Email: 'alice@example.org' }),
  annuaireRow(2, { uid_dyna: 'martin-b', Nom: 'Martin', Prenom: 'Bruno', LABO: 'LAB²B' }),
  annuaireRow(3, { Nom: 'Petit', Prenom: 'Chloé', LABO: 'lab-a' }),
  // Same person on two qualified rows: grouped on the PRINCIPAL one.
  annuaireRow(4, { uid_dyna: 'leroy-d', Nom: 'Leroy', Prenom: 'David', LABO: 'LAB-A', rattachement: 'PRINCIPAL' }),
  annuaireRow(5, { uid_dyna: 'leroy-d', Nom: 'Leroy', Prenom: 'David', LABO: 'LAB²B', rattachement: 'SECONDAIRE' }),
];
const ETABLISSEMENTS: GristRecord[] = [
  { id: 10, fields: { Employeur: 'Université Exemple', UAI: '0000000A', ROR: '', idref: '', Libelle: '' } },
  { id: 11, fields: { Employeur: 'Organisme Exemple', UAI: '', ROR: '', idref: '', Libelle: 'Organisme national' } },
];
const STRUCTURES: GristRecord[] = [
  { id: 7, fields: { short_labels: 'LAB-A[fr]', long_labels: 'Laboratoire A[fr]', local_id: '1001', generic_type: 'unit', type: 'UMR' } },
];

const fakeReader = (tables: Record<string, GristRecord[]>, updatedAt = { value: '2026-10-07T00:00:00Z' }) => {
  const reader: GristReader & { calls: string[] } = {
    calls: [],
    docUpdatedAt: async () => updatedAt.value,
    records: async (table) => {
      reader.calls.push(table);
      if (!tables[table]) throw new Error(`Grist HTTP 404 on /tables/${table}/records`);
      return tables[table];
    },
  };
  return reader;
};

const ALL = { all: true, labAnchors: [] };

describe('createGristDirectoryRepository', () => {
  it('maps the whole directory for the institution right (multi-row person grouped, employer resolved)', async () => {
    const repo = createGristDirectoryRepository({ grist: fakeReader({ Annuaire: ANNUAIRE, Etablissements: ETABLISSEMENTS }) });
    const { items, updatedAt } = await repo.people(ALL);
    expect(updatedAt).toBe('2026-10-07T00:00:00Z');
    expect(items.map((r) => r.id).sort()).toEqual(['durand-a', 'ext_petit-c', 'leroy-d', 'martin-b']);
    expect(items.find((r) => r.id === 'durand-a')!.employment.employer).toBe('Université Exemple');
    expect(items.find((r) => r.id === 'leroy-d')!.affiliations.map((a) => a.structureName)).toEqual(['LAB-A', 'LAB²B']);
  });

  it('keeps only the rows of the lab scope, on the normalized LABO acronym', async () => {
    const repo = createGristDirectoryRepository({ grist: fakeReader({ Annuaire: ANNUAIRE, Etablissements: ETABLISSEMENTS }) });
    const labA = await repo.people({ all: false, labAnchors: ['laba'] });
    // Row 5 (LAB²B) is outside the scope: David Leroy comes back as his LAB-A row only, as through the proxy.
    expect(labA.items.map((r) => r.id).sort()).toEqual(['durand-a', 'ext_petit-c', 'leroy-d']);
    expect(labA.items.find((r) => r.id === 'leroy-d')!.affiliations).toHaveLength(1);
    const labB = await repo.people({ all: false, labAnchors: ['lab2b'] });
    expect(labB.items.map((r) => r.id).sort()).toEqual(['leroy-d', 'martin-b']);
    expect((await repo.people({ all: false, labAnchors: [] })).items).toEqual([]);
  });

  it('reads the tables again only when the document changed', async () => {
    const updatedAt = { value: 'v1' };
    const reader = fakeReader({ Annuaire: ANNUAIRE, Etablissements: ETABLISSEMENTS, Structures: STRUCTURES }, updatedAt);
    const repo = createGristDirectoryRepository({ grist: reader });
    await repo.people(ALL);
    await repo.people({ all: false, labAnchors: ['laba'] });
    await repo.structures();
    await repo.structures();
    expect(reader.calls.sort()).toEqual(['Annuaire', 'Etablissements', 'Structures']);
    updatedAt.value = 'v2';
    await repo.people(ALL);
    expect(reader.calls.filter((t) => t === 'Annuaire')).toHaveLength(2);
  });

  it('maps the directory again when the LDAP cache changes', async () => {
    const ldap = { data: {} as Record<string, any>, version: 'a' };
    const repo = createGristDirectoryRepository({
      grist: fakeReader({ Annuaire: ANNUAIRE, Etablissements: ETABLISSEMENTS }),
      loadLdapCache: async () => ldap,
    });
    const before = (await repo.people(ALL)).items.find((r) => r.id === 'martin-b')!;
    expect(before.ldapAccount).toBe('none');
    ldap.data = { 'martin-b': { etat: 'D' } };
    ldap.version = 'b';
    const after = (await repo.people(ALL)).items.find((r) => r.id === 'martin-b')!;
    expect(after.ldapAccount).toBe('closing');
  });

  it('tolerates an unreadable Etablissements table for the people (employer left empty)', async () => {
    const repo = createGristDirectoryRepository({ grist: fakeReader({ Annuaire: ANNUAIRE }) });
    const { items } = await repo.people(ALL);
    expect(items.find((r) => r.id === 'durand-a')!.employment.employer).toBe('ID: 10');
  });

  it('maps structures and institutions (sorted, deduplicated by name)', async () => {
    const repo = createGristDirectoryRepository({
      grist: fakeReader({ Structures: STRUCTURES, Etablissements: [...ETABLISSEMENTS, { id: 12, fields: { Employeur: 'Organisme Exemple' } }] }),
    });
    const structures = (await repo.structures()).items;
    expect(structures[0]).toMatchObject({ id: 'S-7', acronym: 'LAB-A', officialName: 'Laboratoire A', localId: '1001', level: '2' });
    const institutions = (await repo.institutions()).items;
    expect(institutions.map((i) => [i.id, i.name, i.label])).toEqual([
      [11, 'Organisme Exemple', 'Organisme national'],
      [10, 'Université Exemple', 'Université Exemple'],
    ]);
  });
});

describe('createDirectoryApi', () => {
  const stubRepository = (): DirectoryRepository & { people: ReturnType<typeof vi.fn> } => ({
    people: vi.fn(async () => ({ items: [{ id: 'durand-a' } as any], updatedAt: 'v1' })),
    structures: vi.fn(async () => ({ items: [], updatedAt: 'v1' })),
    institutions: vi.fn(async () => ({ items: [], updatedAt: 'v1' })),
  });
  const call = (path: string, bindings: any, method = 'GET') =>
    createDirectoryApi().fetch(new Request(`http://druid.test${path}`, { method }), bindings);

  it('refuses a request without an authenticated user', async () => {
    const resp = await call('/api/v1/people', { repository: stubRepository(), scope: null });
    expect(resp.status).toBe(401);
    expect(await resp.json()).toEqual({ error: 'Unauthorized' });
  });

  it('answers the lists with the scope of the user, never cached by the browser', async () => {
    const repository = stubRepository();
    const scope = { all: false, labAnchors: ['laba'] };
    const resp = await call('/api/v1/people', { repository, scope });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('cache-control')).toBe('no-store');
    expect(await resp.json()).toEqual({ items: [{ id: 'durand-a' }], updatedAt: 'v1' });
    expect(repository.people).toHaveBeenCalledWith(scope);
    expect((await call('/api/v1/structures', { repository, scope })).status).toBe(200);
    expect((await call('/api/v1/institutions', { repository, scope })).status).toBe(200);
  });

  it('answers 404 on an unknown route or method and 502 when the storage fails', async () => {
    const repository = stubRepository();
    expect((await call('/api/v1/nothing', { repository, scope: ALL })).status).toBe(404);
    expect((await call('/api/v1/people', { repository, scope: ALL }, 'DELETE')).status).toBe(404);
    repository.people.mockRejectedValueOnce(new Error('Grist HTTP 500'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resp = await call('/api/v1/people', { repository, scope: ALL });
    spy.mockRestore();
    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ error: 'Directory storage unavailable' });
  });
});

describe('scopeOfSession (server/apiV1.ts)', () => {
  it('turns the Keycloak session access into a directory scope', () => {
    expect(scopeOfSession({})).toBeNull();
    expect(scopeOfSession({ session: {} })).toBeNull();
    expect(scopeOfSession({ session: { user: { access: { allSlugs: true, labAnchors: [] } } } })).toEqual({ all: true, labAnchors: [] });
    expect(scopeOfSession({ session: { user: { access: { allSlugs: false, labAnchors: ['laba'] } } } })).toEqual({ all: false, labAnchors: ['laba'] });
  });
});
