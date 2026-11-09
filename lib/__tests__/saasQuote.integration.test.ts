// Plans of a tenant on a database (druid-internal docs/plan-druid-saas.md, lot 6 b): the API refuses the routes of a
// locked feature, the offer lists the plans cheapest first, a quote request is validated, kept and rate-limited.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantSchemaName } from '../saas/controlPlane';
import { createTenant, dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/saasQuote.integration.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();

const middleware = await import('../../functions/api/_middleware.js');
const tenantApi = await import('../../functions/api/tenant/[[path]].js');
const reports = await import('../../functions/api/reports/[[path]].js');
const calls = await import('../../functions/api/calls/[[path]].js');
const authRequest = await import('../../functions/api/auth/request.js');
const authVerify = await import('../../functions/api/auth/verify.js');
const { forgetHost } = await import('../../functions/_lib/saas.js');

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP || url;
const saas = url ? openSaasDb(url) : null;
const SLUG = 'zz-quote';
const HOST = `${SLUG}.example.org`;
const OWNER = 'owner-quote@example.org';
const env = { SAAS_HYPERDRIVE: { connectionString: appUrl }, SAAS_DEV_LINKS: 'true' };

const call = async (handler: any, input: { path: string; method?: string; headers?: Record<string, string>; body?: string }) => {
  const request = new Request(`https://${HOST}${input.path}`, { method: input.method || 'GET', headers: input.headers, body: input.body });
  const context: any = { request, env, data: {}, params: {}, waitUntil: () => {}, next: () => handler(context) };
  return middleware.onRequest(context);
};
const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe.skipIf(!url)('plans of a tenant', () => {
  let tenantId = '';
  let owner = '';
  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    await saas!.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await createTenant(saas!, { slug: SLUG, label: 'Université Devis', hosts: [HOST], ownerEmail: OWNER }, { ownerUrl: url! });
    tenantId = (await saas!.selectFrom('tenant').select('id').where('slug', '=', SLUG).executeTakeFirstOrThrow()).id;
    forgetHost(HOST);
    const asked = await call(authRequest.onRequestPost, { path: '/api/auth/request', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER }) });
    const { link } = await asked.json() as { link: string };
    const opened = await call(authVerify.onRequestPost, { path: '/api/auth/verify', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: new URL(link).searchParams.get('token')! }).toString() });
    owner = (opened.headers.get('Set-Cookie') || '').split(';')[0];
  }, 120_000);
  afterAll(async () => {
    await saas?.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await saas?.destroy();
  });

  it('the trial: reports and calls refused by the API, whatever the front shows', async () => {
    const r = await call(reports.onRequest, { path: '/api/reports', headers: { Cookie: owner } });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Not included in the plan of this Druid', feature: 'reports' });
    expect((await call(calls.onRequest, { path: '/api/calls/x', headers: { Cookie: owner } })).status).toBe(403);
  });

  it('the Complete plan opens them', async () => {
    await saas!.updateTable('tenant').set({ plan_code: 'complete' }).where('id', '=', tenantId).execute();
    forgetHost(HOST);
    const r = await call(reports.onRequest, { path: '/api/reports', headers: { Cookie: owner } });
    expect(r.status).not.toBe(403);
    await saas!.updateTable('tenant').set({ plan_code: 'trial' }).where('id', '=', tenantId).execute();
    forgetHost(HOST);
  });

  it('the offer: every member reads the plans, cheapest first', async () => {
    const offer = await (await call(tenantApi.onRequest, { path: '/api/tenant/offer', headers: { Cookie: owner } })).json() as any;
    expect(offer.plan).toEqual({ code: 'trial', label: 'Essai' });
    expect(offer.plans.map((p: any) => p.code)).toEqual(['trial', 'team', 'complete']);
    expect((await call(tenantApi.onRequest, { path: '/api/tenant/offer' })).status).toBe(401);
  });

  it('a quote request: validated, kept, five a day', async () => {
    const path = '/api/tenant/quote';
    expect((await call(tenantApi.onRequest, { path, ...json(owner, { plan: 'gold' }) })).status).toBe(400);
    expect((await call(tenantApi.onRequest, { path, ...json(owner, { plan: 'complete', researchers: -3 }) })).status).toBe(400);
    const ok = await call(tenantApi.onRequest, { path, ...json(owner, { plan: 'complete', researchers: '850', accounts: 12, message: ' Pour le conseil. ', feature: 'reports' }) });
    expect(ok.status).toBe(201);
    const rows = await saas!.selectFrom('quote_request').select(['email', 'plan_code', 'researchers', 'accounts', 'message', 'feature', 'handled_at']).where('tenant_id', '=', tenantId).execute();
    expect(rows).toEqual([{ email: OWNER, plan_code: 'complete', researchers: 850, accounts: 12, message: 'Pour le conseil.', feature: 'reports', handled_at: null }]);
    for (let i = 0; i < 4; i++) expect((await call(tenantApi.onRequest, { path, ...json(owner, { plan: 'team' }) })).status).toBe(201);
    const limited = await call(tenantApi.onRequest, { path, ...json(owner, { plan: 'team' }) });
    expect(limited.status).toBe(429);
    expect((await limited.json() as any).error).toBe('Too many quote requests today');
  });
});
