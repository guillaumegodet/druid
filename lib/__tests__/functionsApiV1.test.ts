// Cloudflare Function of the domain API (functions/api/v1/[[path]].js): the security cases of the former Grist proxy
// (druid-internal docs/plan-migration-postgresql.md, lot 2 g) — key of each instance, document of the instance only,
// read-only instance, Cloudflare Access identity required for a write, no anonymous write on a shared deployment.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';

// The Functions import the registry written by a Cloudflare build (ignored by git): created empty when absent, as
// scripts/tests/functions-guards.mjs does.
const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/functionsApiV1.test.ts: no instance.json.\nexport default null;\n');
}
const { onRequest } = await import('../../functions/api/v1/[[path]].js');
const { resolveInstance, resolveForHost } = await import('../../functions/_lib/instance.js');
const { parseInstanceConfig, buildRegistry } = createRequire(import.meta.url)('../../scripts/instances/instanceConfig.cjs');

const DOC = 'docA';
const demoRaw = JSON.parse(fs.readFileSync(new URL('../../instances/demo/instance.json', import.meta.url), 'utf8'));
const demoReg = parseInstanceConfig(demoRaw).config;
const demo2Reg = parseInstanceConfig({ ...demoRaw, slug: 'demo-2', label: 'Démo 2', domains: ['demo-2.example.org'], grist: { docId: 'docDemo20002', publicRead: true } }).config;
const privReg = parseInstanceConfig({
  slug: 'ecole', label: 'École fictive', target: 'cloudflare', domains: ['ecole.example.org'], access: 'cloudflare-access',
  readOnly: false, grist: { docId: 'docEcole0001', apiBase: 'https://grist.example.org/api/' },
  capabilities: { HAS_STATUS_VALIDATION: true }, features: { news: true, newsletter: false },
  admins: ['admin@example.org'], openalexMailto: 'veille@example.org', secrets: ['GRIST_API_KEY'],
}).config;
const multiReg = buildRegistry([demoReg, demo2Reg], { mode: 'multi' }).registry;
const d2 = resolveForHost('demo-2.example.org', { GRIST_API_KEY: 'common' }, multiReg);
const ecoleShared = resolveInstance({}, privReg, { shared: true });

/** Grist upstream stub: records every call, answers what the domain API reads. */
let calls: { url: string; method: string; auth?: string; ua?: string }[] = [];
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', auth: init.headers?.Authorization, ua: init.headers?.['User-Agent'] });
    const body = /\/records/.test(u) ? { records: [{ id: 1, fields: { LABO: 'LAB-A' } }] } : /\/columns$/.test(u) ? { columns: [] }
      : /\/tables$/.test(u) ? { tables: [] } : { updatedAt: 'v1' };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
});

const call = (method: string, path: string, { env = {}, instance, headers = {}, body }: { env?: Record<string, string>; instance?: any; headers?: Record<string, string>; body?: unknown } = {}) =>
  onRequest({
    request: new Request(`https://h.example.org${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env, params: {}, data: instance ? { instance } : {},
  });
const ACCESS = { 'Cf-Access-Authenticated-User-Email': 'a@example.org' };
const GROUPS = { entries: [{ recordId: 1, groups: ['g'] }] };

describe('functions/api/v1 (Cloudflare)', () => {
  it('public read-only demo: reads its public document without key, refuses every write before any upstream call', async () => {
    const env = { DRUID_INSTANCE: 'demo', READ_ONLY: 'true', VITE_GRIST_DOC_ID: DOC };
    const r = await call('GET', '/api/v1/structures', { env });
    expect(r.status).toBe(200);
    expect(calls.every((c) => c.url.includes(`/docs/${DOC}`) && c.auth === undefined && c.ua === 'Druid-CRISalid-demo/1.0')).toBe(true);
    calls = [];
    const w = await call('PATCH', '/api/v1/people/groups', { env, headers: ACCESS, body: GROUPS });
    expect([w.status, (await w.json()).error, calls.length]).toEqual([403, 'Read-only instance: writes are disabled', 0]);
  });

  it('writable instance: key required, sent upstream; a write needs a Cloudflare Access identity', async () => {
    expect((await call('GET', '/api/v1/structures', { env: { VITE_GRIST_DOC_ID: DOC } })).status).toBe(500);
    const env = { VITE_GRIST_DOC_ID: DOC, GRIST_API_KEY: 'k' };
    expect((await call('GET', '/api/v1/structures', { env })).status).toBe(200);
    expect(calls.every((c) => c.auth === 'Bearer k')).toBe(true);
    expect((await call('PATCH', '/api/v1/people/groups', { env, body: GROUPS })).status).toBe(403);
    calls = [];
    expect((await call('PATCH', '/api/v1/people/groups', { env, headers: ACCESS, body: GROUPS })).status).toBe(200);
    expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith(`/docs/${DOC}/tables/Annuaire/records`))).toBe(true);
    // Local `wrangler pages dev` only: anonymous writes allowed on a single deployment.
    expect((await call('PATCH', '/api/v1/people/groups', { env: { ...env, ALLOW_ANONYMOUS_WRITES: 'true' }, body: GROUPS })).status).toBe(200);
  });

  it('shared deployment: own document only, own key only, never an anonymous write', async () => {
    expect((await call('GET', '/api/v1/structures', { instance: d2, env: { GRIST_API_KEY: 'common' } })).status).toBe(200);
    expect(calls.every((c) => c.url.includes('/docs/docDemo20002') && c.auth === undefined)).toBe(true);
    calls = [];
    expect((await call('GET', '/api/v1/structures', { instance: ecoleShared, env: { GRIST_API_KEY: 'common' } })).status).toBe(500);
    expect(calls).toEqual([]);
    const env = { GRIST_API_KEY: 'common', GRIST_API_KEY__ECOLE: 'ke' };
    expect((await call('PATCH', '/api/v1/people/groups', { instance: ecoleShared, env, headers: ACCESS, body: GROUPS })).status).toBe(200);
    expect(calls.every((c) => c.auth === 'Bearer ke' && c.url.startsWith('https://grist.example.org/api/docs/docEcole0001'))).toBe(true);
    expect((await call('PATCH', '/api/v1/people/groups', { instance: ecoleShared, env: { ...env, ALLOW_ANONYMOUS_WRITES: 'true' }, body: GROUPS })).status).toBe(403);
  });

  it('the former Grist proxy answers 410', async () => {
    const { onRequest: proxy } = await import('../../functions/api/grist/[[path]].js');
    const r = await proxy();
    expect([r.status, (await r.json()).error]).toEqual([410, 'Grist proxy removed: use /api/v1']);
  });
});
