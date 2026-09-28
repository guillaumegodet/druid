import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserReportsBackend,
  LOCAL_REPORTS_KEY,
  serverReportsBackend,
} from '../../components/dashboard/report/reportsApi';
import type { ReportDefinition } from '../../components/dashboard/report/definition';

// « Mes rapports » storage (docs/plan-mes-rapports.md, lot 2): scripts/lib/reports_store.cjs
// on an in-memory Grist, and the two client backends. Users and reports are fictitious.
const store = createRequire(import.meta.url)('../../scripts/lib/reports_store.cjs');

type Row = { id: number; fields: Record<string, unknown> };
let docSeq = 0;

/** In-memory Grist with the methods of gristClient(). */
function fakeGrist(existing: Record<string, string[]> = {}) {
  const tables = new Map<string, Row[]>();
  const columns = new Map<string, string[]>();
  for (const [t, cols] of Object.entries(existing)) { tables.set(t, []); columns.set(t, cols); }
  const seq = new Map<string, number>();
  const calls: string[] = [];
  let failNext = false;
  const guard = () => {
    if (failNext) { failNext = false; throw new Error('Grist HTTP 500 (GET tables)'); }
  };
  return {
    key: `fake-${++docSeq}`,
    calls,
    failOnce: () => { failNext = true; },
    rows: (t: string) => tables.get(t) ?? [],
    tables: async () => { guard(); calls.push('tables'); return [...tables.keys()].map((id) => ({ id })); },
    createTables: async (ts: { id: string; columns: { id: string }[] }[]) => {
      calls.push(`create ${ts.map((t) => t.id).join(',')}`);
      ts.forEach((t) => { tables.set(t.id, []); columns.set(t.id, t.columns.map((c) => c.id)); });
    },
    columns: async (t: string) => (columns.get(t) ?? []).map((id) => ({ id })),
    addColumns: async (t: string, cols: { id: string }[]) => {
      calls.push(`add columns ${t}: ${cols.map((c) => c.id).join(',')}`);
      columns.set(t, [...(columns.get(t) ?? []), ...cols.map((c) => c.id)]);
    },
    records: async (t: string, filter?: Record<string, unknown[]>) => {
      guard();
      return (tables.get(t) ?? [])
        .filter((r) => !filter || Object.entries(filter).every(([k, vs]) => vs.includes(r.fields[k])))
        .map((r) => ({ id: r.id, fields: { ...r.fields } }));
    },
    add: async (t: string, rows: Record<string, unknown>[]) => rows.map((fields) => {
      const id = (seq.get(t) ?? 0) + 1;
      seq.set(t, id);
      tables.get(t)!.push({ id, fields: { ...fields } });
      return id;
    }),
    update: async (t: string, rows: Row[]) => {
      for (const u of rows) Object.assign(tables.get(t)!.find((r) => r.id === u.id)!.fields, u.fields);
    },
    remove: async (t: string, ids: number[]) => { tables.set(t, tables.get(t)!.filter((r) => !ids.includes(r.id))); },
  };
}

const definition = (name = 'Lab × University of Ottawa'): ReportDefinition => ({
  schemaVersion: 1,
  name,
  description: 'Draft',
  context: {
    slug: 'test-lab',
    perimetre: 'affiliation',
    period: { kind: 'relative', lastYears: 5, includeCurrent: false },
    filters: { partnerKeys: ['03c4mmv16'] },
  },
  blocks: [{ id: 'c1', kind: 'chart', chartId: 'publications-par-annee' }],
  lang: 'fr',
});

const ALICE = { id: 'alice', isSuperAdmin: false };
const BOB = { id: 'Bob', isSuperAdmin: false };
const CAROL = { id: 'carol', isSuperAdmin: false };
const ADMIN = { id: 'admin', isSuperAdmin: true };

/** In-memory PDF archive (the `blobs` of the store). */
function fakeBlobs() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    put: async (k: string, b: Uint8Array) => { files.set(k, b); },
    get: async (k: string) => files.get(k) ?? null,
    remove: async (k: string) => { files.delete(k); },
  };
}

function setup({ blobs = null as ReturnType<typeof fakeBlobs> | null, start = '2026-09-28T10:00:00Z' } = {}) {
  const grist = fakeGrist();
  let t = Date.parse(start);
  const clock = { advance: (ms: number) => { t += ms; } };
  const s = store.createReportsStore(grist, { now: () => new Date((t += 1000)), blobs });
  const route = (user: object, method: string, path: string, body?: unknown) =>
    store.routeReports(s, user, { method, segments: path.split('/'), body });
  return { grist, s, route, clock };
}

const PDF = new TextEncoder().encode('%PDF-1.7 fake');

describe('reports store — access control', () => {
  it('creates the three tables once, then a private report visible to its owner only', async () => {
    const { grist, route } = setup();
    const created = await route(ALICE, 'POST', '', { definition: definition() });
    expect(created.status).toBe(201);
    expect(created.body.report).toMatchObject({ id: 1, name: 'Lab × University of Ottawa', role: 'owner', visibility: 'private', shares: [] });
    await route(ALICE, 'GET', '');
    expect(grist.calls.filter((c) => c.startsWith('create'))).toEqual(['create Rapports,Rapports_partages,Rapports_generations']);
    expect((await route(ALICE, 'GET', '')).body.mine.map((r: { id: number }) => r.id)).toEqual([1]);
    // Another user: answered as absent (ids of private reports do not leak), and not listed.
    expect(await route(BOB, 'GET', '1')).toEqual({ status: 404, body: { error: 'Report not found' } });
    expect((await route(BOB, 'GET', '')).body).toEqual({ mine: [], shared: [], instance: [], templates: [] });
    // Super admin: may read it, not edit its content.
    expect((await route(ADMIN, 'GET', '1')).body.report.role).toBe('admin');
    expect((await route(ADMIN, 'PATCH', '1', { definition: definition('Renamed') })).status).toBe(403);
  });

  it('refuses definitions out of bounds', async () => {
    const { route } = setup();
    const bad = { ...definition(), context: { ...definition().context, slug: '../etc' } };
    expect(await route(ALICE, 'POST', '', { definition: bad }))
      .toEqual({ status: 400, body: { error: 'Invalid report definition: context.slug' } });
    expect((await route(ALICE, 'POST', '', { definition: { ...definition(), name: '  ' } })).status).toBe(400);
    const huge = { ...definition(), description: 'x'.repeat(250_000) };
    expect((await route(ALICE, 'POST', '', { definition: huge })).body.error).toBe('Invalid report definition: too large');
  });

  it('shares with viewers and editors, and detects concurrent edits', async () => {
    const { route } = setup();
    await route(ALICE, 'POST', '', { definition: definition() });
    const shares = await route(ALICE, 'POST', '1/shares', {
      shares: [{ grantee: 'bob', role: 'viewer' }, { grantee: 'CAROL', role: 'editor' }, { grantee: 'alice', role: 'editor' }],
    });
    // Grantees normalized, the owner never listed as a grantee.
    expect(shares.body.shares.map((x: { grantee: string; role: string }) => `${x.grantee}:${x.role}`).sort())
      .toEqual(['bob:viewer', 'carol:editor']);
    expect((await route(BOB, 'GET', '')).body.shared.map((r: { role: string }) => r.role)).toEqual(['viewer']);
    expect((await route(BOB, 'PATCH', '1', { definition: definition('B') })).status).toBe(403);
    expect((await route(BOB, 'GET', '1/shares')).status).toBe(403);

    const loaded = (await route(CAROL, 'GET', '1')).body.report;
    const saved = await route(CAROL, 'PATCH', '1', { definition: definition('Edited by Carol'), expectedUpdatedAt: loaded.updatedAt });
    expect(saved.body.report).toMatchObject({ name: 'Edited by Carol', role: 'editor' });
    // Alice saves over the version she loaded before Carol's edit.
    expect(await route(ALICE, 'PATCH', '1', { definition: definition('Stale'), expectedUpdatedAt: loaded.updatedAt }))
      .toEqual({ status: 409, body: { error: 'Report changed since it was loaded' } });
    // Only the owner changes the visibility.
    expect((await route(CAROL, 'PATCH', '1', { visibility: 'instance' })).status).toBe(403);
  });

  it('replaces the share list (add, change role, revoke) and validates it', async () => {
    const { grist, route } = setup();
    await route(ALICE, 'POST', '', { definition: definition() });
    await route(ALICE, 'POST', '1/shares', { shares: [{ grantee: 'bob', role: 'viewer' }, { grantee: 'carol', role: 'viewer' }] });
    await route(ALICE, 'POST', '1/shares', { shares: [{ grantee: 'bob', role: 'editor' }] });
    expect(grist.rows('Rapports_partages').map((r) => `${r.fields.grantee}:${r.fields.role}`)).toEqual(['bob:editor']);
    expect((await route(CAROL, 'GET', '1')).status).toBe(404);
    expect((await route(ALICE, 'POST', '1/shares', { shares: [{ grantee: 'bob', role: 'owner' }] })).status).toBe(400);
    expect((await route(ALICE, 'POST', '1/shares', { shares: 'bob' })).status).toBe(400);
  });

  it('exposes instance-wide reports, which any reader may duplicate', async () => {
    const { route } = setup();
    await route(ALICE, 'POST', '', { definition: definition(), visibility: 'instance' });
    expect((await route(BOB, 'GET', '')).body.instance.map((r: { role: string }) => r.role)).toEqual(['viewer']);
    const copy = await route(BOB, 'POST', '1/duplicate', { name: 'My copy' });
    expect(copy.status).toBe(201);
    expect(copy.body.report).toMatchObject({ id: 2, name: 'My copy', owner: 'Bob', visibility: 'private', role: 'owner' });
  });

  it('soft-deletes for the owner only', async () => {
    const { grist, route } = setup();
    await route(ALICE, 'POST', '', { definition: definition(), visibility: 'instance' });
    expect((await route(BOB, 'POST', '1/delete')).status).toBe(403);
    expect((await route(ALICE, 'POST', '1/delete')).body).toEqual({ ok: true });
    expect((await route(ALICE, 'GET', '1')).status).toBe(404);
    expect((await route(BOB, 'GET', '')).body.instance).toEqual([]);
    expect(grist.rows('Rapports')[0].fields.deleted_at).toBeTruthy();
  });

  it('records generations from any reader, with bounds', async () => {
    const { route } = setup();
    await route(ALICE, 'POST', '', { definition: definition() });
    await route(ALICE, 'POST', '1/shares', { shares: [{ grantee: 'bob', role: 'viewer' }] });
    const gen = await route(BOB, 'POST', '1/generations', {
      definitionSnapshot: { period: { start: 2021, end: 2025 } }, publicationCount: 145, dataDate: '2026-09-25', aiTexts: { executive: 'Text' },
    });
    expect(gen.status).toBe(201);
    expect(gen.body.generation).toMatchObject({ generatedBy: 'Bob', publicationCount: 145, aiTexts: { executive: 'Text' }, sharedFrozen: false });
    expect((await route(ALICE, 'GET', '')).body.mine[0].lastGeneratedAt).toBe(gen.body.generation.generatedAt);
    expect((await route(BOB, 'POST', '1/generations', { publicationCount: -1 })).status).toBe(400);
    expect((await route(CAROL, 'GET', '1/generations')).status).toBe(404);
    // History: the owner sees the generation; a plain reader only shared ones; no archive here.
    expect((await route(ALICE, 'GET', '1/generations')).body).toMatchObject({ archive: false, generations: [{ generatedBy: 'Bob', hasPdf: false }] });
    expect((await route(BOB, 'GET', '1/generations')).body.generations).toEqual([]);
    expect(await route(ALICE, 'PUT', `1/generations/${gen.body.generation.id}/pdf`, PDF))
      .toEqual({ status: 501, body: { error: 'PDF archiving is not configured on this instance' } });
  });

  it('archives PDFs, shares a frozen version with readers, and applies the retention', async () => {
    const blobs = fakeBlobs();
    const { route, clock } = setup({ blobs });
    await route(ALICE, 'POST', '', { definition: definition('Report') });
    await route(ALICE, 'POST', '1/shares', { shares: [{ grantee: 'bob', role: 'viewer' }] });
    const gen = (await route(ALICE, 'POST', '1/generations', { publicationCount: 3 })).body.generation;
    expect((await route(ALICE, 'PUT', `1/generations/${gen.id}/pdf`, new TextEncoder().encode('not a pdf'))).status).toBe(400);
    expect((await route(BOB, 'PUT', `1/generations/${gen.id}/pdf`, PDF)).status).toBe(403);
    const put = await route(ALICE, 'PUT', `1/generations/${gen.id}/pdf`, PDF);
    expect(put.body.generation).toMatchObject({ hasPdf: true });
    expect([...blobs.files.keys()]).toEqual([`reports/1/${gen.id}.pdf`]);

    const own = await route(ALICE, 'GET', `1/generations/${gen.id}/pdf`);
    expect(own).toMatchObject({ status: 200, filename: 'report_2026-09-28.pdf' });
    expect(own.binary).toEqual(PDF);
    // Bob (viewer) sees and downloads it only once the owner shares it.
    expect((await route(BOB, 'GET', `1/generations/${gen.id}/pdf`)).status).toBe(404);
    expect((await route(BOB, 'PATCH', `1/generations/${gen.id}`, { sharedFrozen: true })).status).toBe(403);
    await route(ALICE, 'PATCH', `1/generations/${gen.id}`, { sharedFrozen: true });
    expect((await route(BOB, 'GET', '1/generations')).body.generations.map((g: { id: number }) => g.id)).toEqual([gen.id]);
    expect((await route(BOB, 'GET', `1/generations/${gen.id}/pdf`)).binary).toEqual(PDF);

    // Retention: 20 PDFs per report, 2 years at most.
    for (let i = 0; i < 21; i++) {
      const g = (await route(ALICE, 'POST', '1/generations', {})).body.generation;
      await route(ALICE, 'PUT', `1/generations/${g.id}/pdf`, PDF);
    }
    expect(blobs.files.size).toBe(20);
    expect(blobs.files.has(`reports/1/${gen.id}.pdf`)).toBe(false);
    expect((await route(ALICE, 'GET', `1/generations/${gen.id}/pdf`)).body).toEqual({ error: 'PDF not archived' });
    clock.advance(731 * 86400000);
    const late = (await route(ALICE, 'POST', '1/generations', {})).body.generation;
    await route(ALICE, 'PUT', `1/generations/${late.id}/pdf`, PDF);
    expect([...blobs.files.keys()]).toEqual([`reports/1/${late.id}.pdf`]);
  });

  it('routes generation sub-paths strictly', async () => {
    const { route } = setup({ blobs: fakeBlobs() });
    await route(ALICE, 'POST', '', { definition: definition() });
    expect((await route(ALICE, 'GET', '1/generations/x/pdf')).body).toEqual({ error: 'Invalid id' });
    expect((await route(ALICE, 'GET', '1/generations/9/pdf')).body).toEqual({ error: 'Generation not found' });
    expect((await route(ALICE, 'DELETE', '1/generations/9')).status).toBe(404);
    expect((await route(ALICE, 'GET', '1/generations/9/pdf/more')).status).toBe(404);
  });

  it('answers unknown routes, bad ids and Grist failures', async () => {
    const { grist, route } = setup();
    expect(await route(ALICE, 'GET', 'abc')).toEqual({ status: 400, body: { error: 'Invalid id' } });
    expect(await route(ALICE, 'PUT', '')).toEqual({ status: 404, body: { error: 'Not found' } });
    expect((await route(ALICE, 'GET', '1/unknown')).status).toBe(404);
    grist.failOnce();
    expect(await route(ALICE, 'GET', '')).toEqual({ status: 502, body: { error: 'Grist HTTP 500 (GET tables)' } });
  });
});

describe('reports store — schema evolution and instance templates', () => {
  it('adds the columns introduced since the tables were created', async () => {
    const old = store.REPORTS_COLUMNS.filter((c: { id: string }) => c.id !== 'published_template').map((c: { id: string }) => c.id);
    const grist = fakeGrist({
      Rapports: old,
      Rapports_partages: store.SHARES_COLUMNS.map((c: { id: string }) => c.id),
      Rapports_generations: store.GENERATIONS_COLUMNS.map((c: { id: string }) => c.id),
    });
    const s = store.createReportsStore(grist);
    await store.routeReports(s, ALICE, { method: 'GET', segments: [''], body: undefined });
    expect(grist.calls.filter((c) => c.startsWith('create') || c.startsWith('add'))).toEqual(['add columns Rapports: published_template']);
  });

  it('lets super admins only publish instance templates, readable by everyone', async () => {
    const { route } = setup();
    await route(ALICE, 'POST', '', { definition: definition('Lab template') });
    expect((await route(ALICE, 'PATCH', '1', { publishedTemplate: true })).status).toBe(403);
    // A super admin who is not the owner may publish it (no content change).
    const published = await route(ADMIN, 'PATCH', '1', { publishedTemplate: true });
    expect(published.body.report.publishedTemplate).toBe(true);
    const bob = (await route(BOB, 'GET', '')).body;
    expect(bob.templates.map((r: { name: string; role: string }) => `${r.name}:${r.role}`)).toEqual(['Lab template:viewer']);
    expect(bob.instance).toEqual([]);
    expect((await route(BOB, 'GET', '1')).body.report.role).toBe('viewer');
    // A copy is an ordinary private report.
    expect((await route(BOB, 'POST', '1/duplicate')).body.report.publishedTemplate).toBe(false);
  });
});

describe('fsBlobs (Nantes PDF archive)', () => {
  it('writes, reads and removes PDFs under the directory, and refuses foreign keys', async () => {
    const { fsBlobs } = createRequire(import.meta.url)('../../scripts/lib/reports_blobs_fs.cjs');
    const { mkdtempSync, readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'report-pdfs-'));
    const blobs = fsBlobs(dir);
    await blobs.put('reports/1/2.pdf', PDF);
    expect(await blobs.get('reports/1/2.pdf')).toEqual(PDF);
    expect(readdirSync(join(dir, 'reports/1'))).toEqual(['2.pdf']); // no leftover .part
    await blobs.remove('reports/1/2.pdf');
    expect(await blobs.get('reports/1/2.pdf')).toBeNull();
    await expect(blobs.put('../../etc/passwd', PDF)).rejects.toThrow(/Invalid archive key/);
  });
});

describe('gristClient', () => {
  it('calls the Grist REST API of one document with the key', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ records: [{ id: 3, fields: {} }] }), { status: 200 });
    };
    const c = store.gristClient({ apiBase: 'https://grist.example.org/api', doc: 'DOC', apiKey: 'k', fetchImpl });
    await c.records('Rapports_partages', { grantee: ['bob'] });
    expect(await c.add('Rapports', [{ name: 'x' }])).toEqual([3]);
    await c.remove('Rapports_partages', [4]);
    expect(seen.map((s) => `${s.init.method} ${decodeURIComponent(s.url)}`)).toEqual([
      'GET https://grist.example.org/api/docs/DOC/tables/Rapports_partages/records?filter={"grantee":["bob"]}',
      'POST https://grist.example.org/api/docs/DOC/tables/Rapports/records',
      'POST https://grist.example.org/api/docs/DOC/tables/Rapports_partages/data/delete',
    ]);
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(seen[1].init.body).toBe('{"records":[{"fields":{"name":"x"}}]}');
  });
});

describe('client backends', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates a definition before sending it to the server', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const bad = { ...definition(), blocks: [{ id: 'c1', kind: 'chart', chartId: 'no-such-chart' }] } as unknown as ReportDefinition;
    await expect(serverReportsBackend.create(bad)).rejects.toThrow(/Invalid report definition/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('flags a stored definition that no longer fits the schema', async () => {
    const stored = { id: 1, name: 'Old', description: '', templateId: null, owner: 'alice', visibility: 'private', createdAt: null, updatedAt: null, role: 'owner', definition: { schemaVersion: 0 } };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ report: stored }), { status: 200 }));
    const r = await serverReportsBackend.get(1);
    expect(r.definition).toBeNull();
    expect(r.definitionError).toMatch(/schemaVersion/);
  });

  it('keeps reports in browser storage on a read-only instance', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
    } as unknown as Storage;
    let t = 0;
    const b = browserReportsBackend(() => storage, () => new Date(Date.UTC(2026, 8, 28, 10, 0, t++)));
    const a = await b.create(definition('First'));
    await b.create(definition('Second'));
    expect((await b.list()).mine.map((r) => r.name)).toEqual(['Second', 'First']);
    const edited = await b.update(a.id, { definition: definition('First, edited'), expectedUpdatedAt: a.updatedAt });
    await expect(b.update(a.id, { definition: definition('Stale'), expectedUpdatedAt: a.updatedAt })).rejects.toThrow(/changed since/);
    expect((await b.duplicate(edited.id)).name).toBe('First, edited');
    await b.remove(a.id);
    await expect(b.get(a.id)).rejects.toThrow(/Report not found/);
    await expect(b.setShares(2, [])).rejects.toThrow(/read-only instance/);
    expect(JSON.parse(data.get(LOCAL_REPORTS_KEY)!).nextId).toBe(4);
  });

  it('reports an unavailable browser storage instead of losing the report silently', async () => {
    const b = browserReportsBackend(() => null);
    await expect(b.create(definition())).rejects.toThrow(/Browser storage unavailable/);
    expect((await b.list()).mine).toEqual([]);
  });
});
