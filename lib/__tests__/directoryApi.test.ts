// Directory domain API, read side (druid-internal docs/plan-migration-postgresql.md, lot 1): routes,
// lab scope, Grist repository caching, Node session adapter. Fictitious data only.
import { describe, it, expect, vi } from 'vitest';
import { createDirectoryApi, AUDIT_HEADER } from '../directory/api';
import { createGristDirectoryRepository, DirectoryRepository, GristReader } from '../directory/repository';
import type { GristRecord } from '../directory/gristMapping';
import { scopeOfSession } from '../../server/apiV1';
import { createGristPublicationsStore, PublicationsStore } from '../publications/store';
import { AXES_GRIST } from '../publications/axes';

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
    records: async (table, filter) => {
      reader.calls.push(table);
      if (!tables[table]) throw new Error(`Grist HTTP 404 on /tables/${table}/records`);
      if (!filter) return tables[table];
      return tables[table].filter((r) => Object.entries(filter).every(([col, values]) => values.includes(r.fields[col])));
    },
    tableIds: async () => Object.keys(tables),
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

describe('createGristDirectoryRepository — merges and ABES fingerprints', () => {
  const mergeRow = (id: number, date: string): GristRecord => ({ id, fields: { uid_dyna: `u${id}`, Nom: 'X', date, kept_rowid: 1, dropped_rowid: 2 } });

  it('lists the merge log, most recent first, and nothing before the first merge', async () => {
    const log = [mergeRow(1, '2026-09-01'), mergeRow(2, '2026-10-01'), mergeRow(3, '2026-09-15')];
    const withLog = createGristDirectoryRepository({ grist: fakeReader({ Fusions_log: log }) });
    expect((await withLog.merges(2)).items.map((m) => m.id)).toEqual([2, 3]);
    // A merge written while the document date has not moved yet still shows up (no table cache).
    log.push(mergeRow(4, '2026-10-08'));
    expect((await withLog.merges(1)).items.map((m) => m.id)).toEqual([4]);
    const withoutLog = createGristDirectoryRepository({ grist: fakeReader({ Annuaire: ANNUAIRE }) });
    expect((await withoutLog.merges(50)).items).toEqual([]);
  });

  it('returns the ABES fingerprints of the rows of the scope only', async () => {
    const rows = [
      annuaireRow(1, { uid_dyna: 'durand-a', LABO: 'LAB-A', ABES_export_hash: 'h1', ABES_export_date: '2026-09-11' }),
      annuaireRow(2, { LABO: 'LAB²B', ABES_export_hash: 'h2' }),
      annuaireRow(3, { uid_dyna: 'martin-b', LABO: 'LAB-A' }),
    ];
    const repo = createGristDirectoryRepository({ grist: fakeReader({ Annuaire: rows }) });
    expect((await repo.abesExports(ALL)).items).toEqual([
      { key: 'durand-a', hash: 'h1', date: '2026-09-11' },
      { key: 'g2', hash: 'h2', date: '' },
    ]);
    expect((await repo.abesExports({ all: false, labAnchors: ['laba'] })).items.map((m) => m.key)).toEqual(['durand-a']);
  });
});

describe('createGristPublicationsStore (D10)', () => {
  const axes = AXES_GRIST['ec-nantes'];
  const newsletterRow = (id: number, slug: string, date: string): GristRecord =>
    ({ id, fields: { slug, titre: `T${id}`, date_publication: date, statut: id === 1 ? '' : 'valide' } });

  it('reads the news items of one structure, most recent first', async () => {
    const main = fakeReader({ Newsletter: [newsletterRow(1, 'laba', '2026-09-01'), newsletterRow(2, 'laba', '2026-10-01'), newsletterRow(3, 'lab2b', '2026-10-02')] });
    const store = createGristPublicationsStore({ main: main as any, readerFor: () => null });
    const items = await store.newsletter('laba');
    expect(items.map((i) => [i.id, i.statut])).toEqual([[2, 'valide'], [1, 'genere']]);
    const withoutTable = createGristPublicationsStore({ main: fakeReader({ Annuaire: [] }) as any, readerFor: () => null });
    expect(await withoutTable.newsletter('laba')).toEqual([]);
  });

  it('reads the axis corrections from the side document, only when the instance may read it', async () => {
    const side = fakeReader({ [axes.table]: [
      { id: 5, fields: { doi: '10.1/ABC', Titre: 'Un titre', [axes.field]: 'Axe 1' } },
      { id: 6, fields: { doi: '10.1/def', Titre: 'Autre', [axes.field]: '' } },
    ] });
    const allowed = createGristPublicationsStore({ main: fakeReader({}) as any, readerFor: (doc) => (doc === axes.docId ? side as any : null) });
    expect(await allowed.axisCorrections('ec-nantes')).toEqual([{ gristId: 5, doi: '10.1/ABC', title: 'Un titre', axe: 'Axe 1' }]);
    expect(await allowed.axisCorrections('laba')).toBeNull();
    const refused = createGristPublicationsStore({ main: fakeReader({}) as any, readerFor: () => null });
    await expect(refused.axisCorrections('ec-nantes')).rejects.toThrow('Document not readable');
  });
});

describe('createDirectoryApi', () => {
  const stubRepository = (): DirectoryRepository & { people: ReturnType<typeof vi.fn>; merges: ReturnType<typeof vi.fn> } => ({
    people: vi.fn(async () => ({ items: [{ id: 'durand-a' } as any], updatedAt: 'v1' })),
    structures: vi.fn(async () => ({ items: [], updatedAt: 'v1' })),
    institutions: vi.fn(async () => ({ items: [], updatedAt: 'v1' })),
    merges: vi.fn(async () => ({ items: [], updatedAt: 'v1' })),
    abesExports: vi.fn(async () => ({ items: [], updatedAt: 'v1' })),
    labsOfUid: vi.fn(async () => []),
    duplicates: vi.fn(),
    recordRows: vi.fn(async () => []),
    invalidate: vi.fn(),
  });
  const stubPublications = (): PublicationsStore & { newsletter: ReturnType<typeof vi.fn> } => ({
    newsletter: vi.fn(async () => []),
    axisCorrections: vi.fn(async (slug: string) => (slug === 'ec-nantes' ? [] : null)),
    newsletterSlugOf: vi.fn(async () => null),
    updateNewsletterItem: vi.fn(),
    updateAxisCorrection: vi.fn(async () => ({ table: 't' })),
  });
  const call = (path: string, bindings: any, method = 'GET') =>
    createDirectoryApi().fetch(new Request(`http://druid.test${path}`, { method }), { publications: stubPublications(), ...bindings });

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

describe('createDirectoryApi — institution tools and publications', () => {
  const LAB = { all: false, labAnchors: ['laba'] };
  const repository = () => ({
    people: vi.fn(), structures: vi.fn(), institutions: vi.fn(),
    merges: vi.fn(async (limit: number) => ({ items: [], updatedAt: String(limit) })),
    abesExports: vi.fn(async () => ({ items: [{ key: 'durand-a', hash: 'h', date: '' }], updatedAt: 'v1' })),
  });
  const call = async (path: string, scope: any, publications?: Partial<PublicationsStore>) => {
    const resp = await createDirectoryApi().fetch(new Request(`http://druid.test${path}`), {
      repository: repository() as any,
      publications: { newsletter: async () => [], axisCorrections: async (s: string) => (s === 'ec-nantes' ? [] : null), ...publications } as any,
      scope,
    });
    return { status: resp.status, body: await resp.json() };
  };

  it('keeps the merge log to the institution right and bounds the limit', async () => {
    expect((await call('/api/v1/merges', LAB)).status).toBe(403);
    expect((await call('/api/v1/merges', ALL)).body.updatedAt).toBe('50');
    expect((await call('/api/v1/merges?limit=100000', ALL)).body.updatedAt).toBe('500');
    expect((await call('/api/v1/merges?limit=abc', ALL)).body.updatedAt).toBe('50');
  });

  it('serves the ABES fingerprints to every right (scoped by the repository)', async () => {
    expect((await call('/api/v1/abes-exports', LAB)).body.items).toHaveLength(1);
  });

  it('serves the newsletter of the user\'s structures only, the axis corrections to every user', async () => {
    expect((await call('/api/v1/newsletter', ALL)).status).toBe(400);
    expect((await call('/api/v1/newsletter?slug=LAB-A', LAB)).status).toBe(200);
    expect((await call('/api/v1/newsletter?slug=lab2b', LAB)).status).toBe(403);
    // A report on ec-nantes shared with a lab right shows the corrected axes (no personal data in them).
    expect((await call('/api/v1/axis-corrections/ec-nantes', LAB)).status).toBe(200);
    expect((await call('/api/v1/axis-corrections/ec-nantes', ALL)).status).toBe(200);
    expect((await call('/api/v1/axis-corrections/laba', ALL)).status).toBe(404);
  });

  it('answers 403 when the instance may not read the side document', async () => {
    const refused = createGristPublicationsStore({ main: fakeReader({}) as any, readerFor: () => null });
    const resp = await call('/api/v1/axis-corrections/ec-nantes', ALL, { axisCorrections: refused.axisCorrections });
    expect(resp).toEqual({ status: 403, body: { error: 'Forbidden' } });
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

describe('publications writes (lot 2 f)', () => {
  const LAB = { all: false, labAnchors: ['laba'] };
  const make = () => {
    const writes: string[] = [];
    const client = (name: string, tables: Record<string, any[]>) => ({
      docUpdatedAt: async () => 'v', tableIds: async () => Object.keys(tables),
      records: async (t: string, f?: any) => (tables[t] || []).filter((r) => !f || f.id.includes(r.id)),
      updateRecords: async (t: string, recs: any[]) => { writes.push(`${name}:${t}:${recs.map((r) => `${r.id}=${JSON.stringify(r.fields)}`)}`); },
    }) as any;
    const main = client('main', { Newsletter: [{ id: 3, fields: { slug: 'laba' } }, { id: 4, fields: { slug: 'lab2b' } }] });
    const side = client('side', { [AXES_GRIST['ec-nantes'].table]: [] });
    const publications = createGristPublicationsStore({ main, readerFor: (doc) => (doc === AXES_GRIST['ec-nantes'].docId ? side : null) });
    const call = async (path: string, body: unknown, scope: any) => {
      const resp = await createDirectoryApi().fetch(
        new Request(`http://druid.test${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        { repository: {} as any, publications, commands: {} as any, scope, writeRefusal: null },
      );
      return { status: resp.status, audit: resp.headers.get(AUDIT_HEADER) };
    };
    return { call, writes };
  };

  it('writes the editorial fields of a news item of the user\'s structures only', async () => {
    const { call, writes } = make();
    const ok = await call('/api/v1/newsletter/3', { fields: { statut: 'valide', valide_par: 'someone@example.org' } }, LAB);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.audit!)[0]).toMatchObject({ table: 'Newsletter', rows: [3], fields: ['statut', 'valide_par'] });
    expect((await call('/api/v1/newsletter/4', { fields: { statut: 'valide' } }, LAB)).status).toBe(403);
    expect((await call('/api/v1/newsletter/9', { fields: { statut: 'valide' } }, ALL)).status).toBe(404);
    expect((await call('/api/v1/newsletter/3', { fields: { slug: 'lab2b' } }, ALL)).status).toBe(400);
    expect((await call('/api/v1/newsletter/3', { fields: { statut: 'whatever' } }, ALL)).status).toBe(400);
    expect(writes).toEqual(['main:Newsletter:3={"statut":"valide","valide_par":"someone@example.org"}']);
  });

  it('writes an axis correction with the structure\'s right, in the side document', async () => {
    const { call, writes } = make();
    expect((await call('/api/v1/axis-corrections/ec-nantes/12', { axe: 'Axe 2' }, LAB)).status).toBe(403);
    expect((await call('/api/v1/axis-corrections/ec-nantes/12', { axe: 'Axe 2' }, { all: false, labAnchors: ['ecnantes'] })).status).toBe(200);
    expect((await call('/api/v1/axis-corrections/laba/12', { axe: 'Axe 2' }, ALL)).status).toBe(404);
    expect(writes).toEqual([`side:${AXES_GRIST['ec-nantes'].table}:12={"${AXES_GRIST['ec-nantes'].field}":"Axe 2"}`]);
  });
});
