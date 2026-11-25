// Cloudflare Function of the domain API (functions/api/v1/[[path]].js): the security cases of the former Grist proxy
// (druid-internal docs/plan-migration-postgresql.md, lot 2 g) — database of the instance only, read-only instance,
// Cloudflare Access identity required for a write, no anonymous write on a shared deployment. PostgreSQL only since
// lot 12 a: an instance still declaring `storage: grist` answers 500.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../db/client';
import { demoDirectoryInput, type DemoData } from '../migration/demoSeed';
import { transformDirectory } from '../migration/gristToPg';
import { loadDirectory } from '../migration/loadPg';
import { migrateTenantSchema } from '../saas/tenantDb';

// The Functions import the registry written by a Cloudflare build (ignored by git): created empty when absent, as
// scripts/tests/functions-guards.mjs does.
const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/functionsApiV1.test.ts: no instance.json.\nexport default null;\n');
}
// The driver bundle of the Functions (functions/_generated/pg.js, written by a Cloudflare build): built when absent.
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();
const { onRequest } = await import('../../functions/api/v1/[[path]].js');
const { resolveInstance } = await import('../../functions/_lib/instance.js');
const { parseInstanceConfig, buildRegistry } = createRequire(import.meta.url)('../../scripts/instances/instanceConfig.cjs');

const demoFile = JSON.parse(fs.readFileSync(new URL('../../instances/demo/instance.json', import.meta.url), 'utf8'));
const pgReg = parseInstanceConfig(demoFile).config;
const pgDemo = resolveInstance({}, pgReg);
const privReg = parseInstanceConfig({
  slug: 'ecole', label: 'École fictive', target: 'cloudflare', domains: ['ecole.example.org'], access: 'cloudflare-access',
  readOnly: false, storage: 'postgres', capabilities: { HAS_STATUS_VALIDATION: true }, features: { news: true, newsletter: false },
  admins: ['admin@example.org'], openalexMailto: 'veille@example.org', secrets: [],
}).config;
const ecole = resolveInstance({}, privReg);
const ecoleShared = resolveInstance({}, privReg, { shared: true });
// A database nobody listens to: a refusal decided before any query never notices it.
const NOWHERE = { connectionString: 'postgres://druid:x@127.0.0.1:9/none?sslmode=disable' };

/** No upstream call is expected from the domain API: every fetch is recorded. */
let calls: { url: string; method: string }[] = [];
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
});

const call = (method: string, path: string, { env = {}, instance, headers = {}, body }: { env?: Record<string, unknown>; instance?: any; headers?: Record<string, string>; body?: unknown } = {}) =>
  onRequest({
    request: new Request(`https://h.example.org${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env, params: {}, data: instance ? { instance } : {},
  });
const ACCESS = { 'Cf-Access-Authenticated-User-Email': 'a@example.org' };
const GROUPS = { entries: [{ recordId: 1, groups: ['g'] }] };

describe('functions/api/v1 (Cloudflare)', () => {
  it('an instance still declaring storage grist: 500 before any call (lot 12 a)', async () => {
    const r = await call('GET', '/api/v1/structures', { env: { DRUID_STORAGE: 'grist', VITE_GRIST_DOC_ID: 'docA', GRIST_API_KEY: 'k' } });
    expect([r.status, (await r.json()).error, calls]).toEqual([500, 'Grist storage is no longer served on Cloudflare: storage postgres required', []]);
  });

  it('read-only instance: every write refused before the database', async () => {
    const w = await call('PATCH', '/api/v1/people/groups', { instance: pgDemo, env: { HYPERDRIVE: NOWHERE }, headers: ACCESS, body: GROUPS });
    expect([w.status, (await w.json()).error, calls]).toEqual([403, 'Read-only instance: writes are disabled', []]);
  });

  it('writable instance: a write needs a Cloudflare Access identity, never anonymous on a shared deployment', async () => {
    const w = await call('PATCH', '/api/v1/people/groups', { instance: ecole, env: { HYPERDRIVE: NOWHERE }, body: GROUPS });
    expect([w.status, (await w.json()).error]).toEqual([403, 'Writes require an authenticated user (Cloudflare Access)']);
    const shared = await call('PATCH', '/api/v1/people/groups', { instance: ecoleShared, env: { HYPERDRIVE__ECOLE: NOWHERE, ALLOW_ANONYMOUS_WRITES: 'true' }, body: GROUPS });
    expect(shared.status).toBe(403);
  });

  it('the former Grist proxy answers 410', async () => {
    const { onRequest: proxy } = await import('../../functions/api/grist/[[path]].js');
    const r = await proxy();
    expect([r.status, (await r.json()).error]).toEqual([410, 'Grist proxy removed: use /api/v1']);
  });

  it('PostgreSQL instance without its Hyperdrive binding: 500 before any call', async () => {
    const r = await call('GET', '/api/v1/structures', { instance: pgDemo, env: {} });
    expect([r.status, (await r.json()).error, calls]).toEqual([500, 'HYPERDRIVE binding not configured on Cloudflare', []]);
    // Shared deployment: the binding of another instance is never borrowed.
    const shared = resolveInstance({}, pgReg, { shared: true });
    const s = await call('GET', '/api/v1/structures', { instance: shared, env: { HYPERDRIVE: { connectionString: 'postgres://x' } } });
    expect(s.status).toBe(500);
  });
});

// Needs DATABASE_URL_APP (druid_app on a migrated database): run by the « database » CI job and `npm run test:db`.
const pgUrl = process.env.DATABASE_URL_APP;
describe.skipIf(!pgUrl)('functions/api/v1 on PostgreSQL through Hyperdrive (lot 10 a)', () => {
  const binding = { connectionString: pgUrl };

  it('reads the database of the instance, never Grist; a read-only instance refuses writes', async () => {
    const r = await call('GET', '/api/v1/structures', { instance: pgDemo, env: { HYPERDRIVE: binding } });
    expect(r.status).toBe(200);
    expect(Array.isArray((await r.json()).items)).toBe(true);
    const p = await call('GET', '/api/v1/people', { instance: pgDemo, env: { HYPERDRIVE: binding } });
    expect(p.status).toBe(200);
    expect(Array.isArray((await p.json()).items)).toBe(true);
    expect(calls).toEqual([]);
    const w = await call('PATCH', '/api/v1/people/groups', { instance: pgDemo, env: { HYPERDRIVE: binding }, headers: ACCESS, body: GROUPS });
    expect([w.status, (await w.json()).error]).toEqual([403, 'Read-only instance: writes are disabled']);
  });

  it('shared deployment: binding of the instance only', async () => {
    const shared = resolveInstance({}, pgReg, { shared: true });
    const r = await call('GET', '/api/v1/structures', { instance: shared, env: { HYPERDRIVE__DEMO: binding } });
    expect(r.status).toBe(200);
  });

  // Public demos on the druid-saas Worker (lot 10 e): a schema of the control-plane database, loaded like
  // scripts/seed_demo_pg.ts --schema does (search_path of the transaction), read through SAAS_HYPERDRIVE.
  const ownerUrl = process.env.DATABASE_URL;
  it.skipIf(!ownerUrl)('instance with postgres.schema: its schema of the shared database, never without SAAS_HYPERDRIVE', async () => {
    const schema = 'i_zz_fn_demo';
    const owner = createDb({ connectionString: ownerUrl!, max: 1 });
    try {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schema)} CASCADE`.execute(owner);
      await migrateTenantSchema(schema, { ownerUrl: ownerUrl! });
      const data = await import('../../instances/demo-2/demo-data.mjs') as DemoData;
      const directory = transformDirectory(demoDirectoryInput(data));
      await owner.transaction().execute(async (trx) => {
        await sql`SELECT set_config('search_path', ${schema}, true)`.execute(trx);
        await loadDirectory(trx, directory.rows, directory.report);
      });
      const inSchema = resolveInstance({}, parseInstanceConfig({ ...demoFile, slug: 'demo-2', postgres: { schema } }, { folder: 'demo-2' }).config, { shared: true });
      expect(inSchema.postgres.schema).toBe(schema);
      const p = await call('GET', '/api/v1/people', { instance: inSchema, env: { SAAS_HYPERDRIVE: binding } });
      expect(p.status).toBe(200);
      expect((await p.json()).items.length).toBe(data.buildResearchers().length);
      // Not a control-plane deployment: the schema alone opens nothing.
      const none = await call('GET', '/api/v1/people', { instance: inSchema, env: {} });
      expect([none.status, (await none.json()).error]).toEqual([500, 'HYPERDRIVE binding not configured on Cloudflare']);
      expect(calls).toEqual([]);
    } finally {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schema)} CASCADE`.execute(owner);
      await owner.destroy();
    }
  }, 120_000);
});
