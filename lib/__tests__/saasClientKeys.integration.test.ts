// API keys of the establishment on a database (druid-internal docs/plan-druid-saas.md, lot 6 a-2): « My institution »
// tests then stores them encrypted, never shows them back, keeps a failed test out unless forced; the Functions of the
// tenant then use its language model, the runner reads the same rows.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tenantSchemaName } from '../saas/controlPlane';
import { generateSecretsKey, readTenantSecrets } from '../saas/secrets';
import { createTenant, dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/saasClientKeys.integration.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();

const middleware = await import('../../functions/api/_middleware.js');
const tenantApi = await import('../../functions/api/tenant/[[path]].js');
const selectTopics = await import('../../functions/api/collab-theme/select-topics.js');
const authRequest = await import('../../functions/api/auth/request.js');
const authVerify = await import('../../functions/api/auth/verify.js');
const { forgetHost, requestEnv } = await import('../../functions/_lib/saas.js');

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP || url;
const saas = url ? openSaasDb(url) : null;
const SLUG = 'zz-keys';
const HOST = `${SLUG}.example.org`;
const OWNER = 'owner-keys@example.org';
const SECRETS_KEY = generateSecretsKey();
const env: Record<string, unknown> = { SAAS_HYPERDRIVE: { connectionString: appUrl }, SAAS_DEV_LINKS: 'true', SAAS_SECRETS_KEY: SECRETS_KEY };
const LLM_KEY = 'sk-tenant-llm-0001';

// The services the Worker calls (the database is not reached through fetch).
const realFetch = globalThis.fetch;
const calls: { url: string; headers: Record<string, string> }[] = [];
let llmStatus = 200;
const fakeFetch = async (input: any, init: any = {}) => {
  const u = String(input?.url ?? input);
  calls.push({ url: u, headers: init.headers || {} });
  if (u.startsWith('https://llm.example.org/')) {
    if (llmStatus !== 200) return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: llmStatus });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"domains":[],"subfields":[],"topics":[]}' } }] }), { status: 200 });
  }
  if (u.startsWith('https://api.elsevier.com/')) {
    return init.headers?.['X-ELS-Insttoken']
      ? new Response(JSON.stringify({ 'search-results': { entry: [] } }), { status: 200 })
      : new Response(JSON.stringify({ 'service-error': { status: { statusCode: 'AUTHORIZATION_ERROR', statusText: 'The requestor is not authorized' } } }), { status: 401 });
  }
  return realFetch(input, init);
};

const call = async (handler: any, input: { path: string; method?: string; headers?: Record<string, string>; body?: string }) => {
  const request = new Request(`https://${HOST}${input.path}`, { method: input.method || 'GET', headers: input.headers, body: input.body });
  const context: any = { request, env, data: {}, params: {}, waitUntil: () => {}, next: () => handler(context) };
  return middleware.onRequest(context);
};
const send = (cookie: string, method: string, body?: unknown) => ({ method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe.skipIf(!url)('API keys of a tenant', () => {
  let tenantId = '';
  let owner = '';
  beforeAll(async () => {
    vi.stubGlobal('fetch', fakeFetch);
    await migrateControlPlane({ ownerUrl: url! });
    await saas!.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await createTenant(saas!, { slug: SLUG, label: 'Université Clés', hosts: [HOST], ownerEmail: OWNER }, { ownerUrl: url! });
    tenantId = (await saas!.selectFrom('tenant').select('id').where('slug', '=', SLUG).executeTakeFirstOrThrow()).id;
    forgetHost(HOST);
    const asked = await call(authRequest.onRequestPost, { path: '/api/auth/request', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER }) });
    const { link } = await asked.json() as { link: string };
    const opened = await call(authVerify.onRequestPost, { path: '/api/auth/verify', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: new URL(link).searchParams.get('token')! }).toString() });
    owner = (opened.headers.get('Set-Cookie') || '').split(';')[0];
  }, 120_000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await saas?.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await saas?.destroy();
  });

  it('nothing set: the AI route points to « My institution », not to Cloudflare', async () => {
    const view = await (await call(tenantApi.onRequest, { path: '/api/tenant/keys', headers: { Cookie: owner } })).json() as any;
    expect(view.available).toBe(true);
    expect(view.groups.llm.set.ILAAS_API_KEY).toBe(false);
    const r = await call(selectTopics.onRequestPost, { path: '/api/collab-theme/select-topics', ...send(owner, 'POST', { theme: 'eau' }) });
    expect(r.status).toBe(500);
    expect((await r.json() as any).error).toBe('No language model is configured for this Druid (My institution › API keys)');
  });

  it('a refused key is not stored (409 with the outcome), unless forced', async () => {
    llmStatus = 401;
    const r = await call(tenantApi.onRequest, { path: '/api/tenant/keys/llm', ...send(owner, 'PUT', { apiBase: 'https://llm.example.org/v1', model: 'm-1', apiKey: LLM_KEY }) });
    expect(r.status).toBe(409);
    const body = await r.json() as any;
    expect(body).toMatchObject({ stored: false, check: { ok: false, code: 'invalid_key' } });
    expect(await saas!.selectFrom('tenant_secret').select('name').where('tenant_id', '=', tenantId).execute()).toEqual([]);
    const forced = await call(tenantApi.onRequest, { path: '/api/tenant/keys/llm', ...send(owner, 'PUT', { apiBase: 'https://llm.example.org/v1', model: 'm-1', apiKey: LLM_KEY, force: true }) });
    expect(forced.status).toBe(200);
    expect(await forced.json()).toMatchObject({ stored: true, check: { ok: false, code: 'invalid_key' } });
    const view = await (await call(tenantApi.onRequest, { path: '/api/tenant/keys', headers: { Cookie: owner } })).json() as any;
    expect(view.groups.llm.check).toMatchObject({ ok: false, code: 'invalid_key' });
    llmStatus = 200;
  });

  it('a working key: tested, stored encrypted, never shown back; the address and model are', async () => {
    const r = await call(tenantApi.onRequest, { path: '/api/tenant/keys/llm', ...send(owner, 'PUT', { apiBase: 'https://llm.example.org/v1/', model: 'm-1', apiKey: LLM_KEY }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ stored: true, check: { ok: true, code: 'ok' } });
    const rows = await saas!.selectFrom('tenant_secret').select(['name', 'ciphertext']).where('tenant_id', '=', tenantId).orderBy('name').execute();
    expect(rows.map((x) => x.name)).toEqual(['ILAAS_API_BASE', 'ILAAS_API_KEY', 'ILAAS_MODEL']);
    expect(rows.every((x) => !x.ciphertext.includes(LLM_KEY))).toBe(true);
    const text = await (await call(tenantApi.onRequest, { path: '/api/tenant/keys', headers: { Cookie: owner } })).text();
    expect(text).not.toContain(LLM_KEY);
    const view = JSON.parse(text);
    expect(view.groups.llm.values).toEqual({ ILAAS_API_BASE: 'https://llm.example.org/v1', ILAAS_MODEL: 'm-1' });
    expect(view.groups.llm.check).toMatchObject({ ok: true, code: 'ok', checkedBy: OWNER });
    // The runner reads the same rows.
    expect(await readTenantSecrets(saas!, tenantId, SECRETS_KEY)).toMatchObject({ ILAAS_API_KEY: LLM_KEY, ILAAS_MODEL: 'm-1' });
  });

  it('the Functions of the tenant use its model', async () => {
    const seen = await call(async (ctx: any) => new Response(JSON.stringify(await requestEnv(ctx))), { path: '/api/x', headers: { Cookie: owner } });
    expect(await seen.json()).toMatchObject({ ILAAS_API_KEY: LLM_KEY, ILAAS_API_BASE: 'https://llm.example.org/v1', ILAAS_MODEL: 'm-1' });
    calls.length = 0;
    const r = await call(selectTopics.onRequestPost, { path: '/api/collab-theme/select-topics', ...send(owner, 'POST', { theme: 'eau', topics: ['Hydrology'] }) });
    expect(r.status).toBe(200);
    expect(calls.find((c) => c.url === 'https://llm.example.org/v1/chat/completions')?.headers.Authorization).toBe(`Bearer ${LLM_KEY}`);
  });

  it('a new address keeps the stored key when the field is left empty', async () => {
    const r = await call(tenantApi.onRequest, { path: '/api/tenant/keys/llm', ...send(owner, 'PUT', { apiBase: 'https://llm.example.org/v2', model: 'm-2' }) });
    expect(r.status).toBe(200);
    expect(await readTenantSecrets(saas!, tenantId, SECRETS_KEY)).toMatchObject({ ILAAS_API_KEY: LLM_KEY, ILAAS_API_BASE: 'https://llm.example.org/v2' });
  });

  it('Elsevier: a key without its institution token is refused from outside; with it, stored', async () => {
    const path = '/api/tenant/keys/scopus';
    const outside = await call(tenantApi.onRequest, { path, ...send(owner, 'PUT', { apiKey: 'els-key-000001' }) });
    expect(outside.status).toBe(409);
    expect((await outside.json() as any).check.code).toBe('not_entitled');
    const ok = await call(tenantApi.onRequest, { path, ...send(owner, 'PUT', { apiKey: 'els-key-000001', instToken: 'els-token-000001' }) });
    expect(ok.status).toBe(200);
    expect(await readTenantSecrets(saas!, tenantId, SECRETS_KEY)).toMatchObject({ SCOPUS_API_KEY: 'els-key-000001', SCOPUS_INST_TOKEN: 'els-token-000001' });
    const tested = await call(tenantApi.onRequest, { path: '/api/tenant/keys/scopus/test', ...send(owner, 'POST') });
    expect((await tested.json() as any).check.ok).toBe(true);
  });

  it('removal, rights and a deployment without SAAS_SECRETS_KEY', async () => {
    expect((await call(tenantApi.onRequest, { path: '/api/tenant/keys/llm', ...send(owner, 'DELETE') })).status).toBe(200);
    const left = await readTenantSecrets(saas!, tenantId, SECRETS_KEY);
    expect(left.ILAAS_API_KEY).toBeUndefined();
    expect(left.SCOPUS_API_KEY).toBe('els-key-000001');
    expect((await call(tenantApi.onRequest, { path: '/api/tenant/keys/other', ...send(owner, 'PUT', {}) })).status).toBe(404);
    expect((await call(tenantApi.onRequest, { path: '/api/tenant/keys' })).status).toBe(401);
    delete env.SAAS_SECRETS_KEY;
    try {
      const view = await (await call(tenantApi.onRequest, { path: '/api/tenant/keys', headers: { Cookie: owner } })).json() as any;
      expect(view.available).toBe(false);
      expect(view.groups.scopus.set.SCOPUS_API_KEY).toBe(true);
      expect((await call(tenantApi.onRequest, { path: '/api/tenant/keys/llm', ...send(owner, 'PUT', { apiKey: LLM_KEY }) })).status).toBe(503);
    } finally { env.SAAS_SECRETS_KEY = SECRETS_KEY; }
  });
});
