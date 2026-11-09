// DirlaData console (druid-internal docs/plan-druid-saas.md, lot 6 c), end to end on a database: its host only, its
// own sessions for the allowed addresses, the change of plan and status (journaled, caches forgotten), the relaunch of
// a job, and an impersonation that opens a marked 2-hour session on the tenant without touching the member's last
// sign-in.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob, tenantSchemaName } from '../saas/controlPlane';
import { isSuperadmin, superadminEmails } from '../saas/console';
import { createTenant, dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/saasConsole.integration.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();

const consoleFn = await import('../../functions/console/[[path]].js');
const middleware = await import('../../functions/api/_middleware.js');
const me = await import('../../functions/api/me.js');
const authVerify = await import('../../functions/api/auth/verify.js');
const { forgetHost } = await import('../../functions/_lib/saas.js');

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP || url;
const saas = url ? openSaasDb(url) : null;
const ADMIN_HOST = 'admin.example.org';
const SLUG = 'zz-console';
const TENANT_HOST = `${SLUG}.example.org`;
const OWNER = 'owner-console@example.org';
const BOSS = 'boss@example.org';
const env: Record<string, any> = { SAAS_HYPERDRIVE: { connectionString: appUrl }, SAAS_DEV_LINKS: 'true', SAAS_ADMIN_HOST: ADMIN_HOST, SAAS_SUPERADMIN_EMAILS: `${BOSS}, other@example.org` };

const consoleCall = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string; host?: string } = {}) =>
  consoleFn.onRequest({ request: new Request(`https://${init.host || ADMIN_HOST}${path}`, { method: init.method || 'GET', headers: init.headers, body: init.body, redirect: 'manual' }), env, data: {} } as any);
const tenantCall = async (handler: any, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
  const request = new Request(`https://${TENANT_HOST}${path}`, { method: init.method || 'GET', headers: init.headers, body: init.body });
  const context: any = { request, env, data: {}, params: {}, waitUntil: () => {}, next: () => handler(context) };
  return middleware.onRequest(context);
};
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];
const post = (cookie: string, body: unknown) => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: `https://${ADMIN_HOST}` }, body: JSON.stringify(body) });

describe('console allow-list', () => {
  it('parsed, normalized', () => {
    expect(superadminEmails(' A@Example.org;b@example.org  nope ')).toEqual(['a@example.org', 'b@example.org']);
    expect(isSuperadmin('a@example.org', 'A@example.org')).toBe(true);
    expect(isSuperadmin('', 'a@example.org')).toBe(false);
    expect(isSuperadmin('a@example.org', null)).toBe(false);
  });
});

describe.skipIf(!url)('DirlaData console', () => {
  let tenantId = '';
  let boss = '';
  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    await saas!.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await createTenant(saas!, { slug: SLUG, label: 'Université Console', hosts: [TENANT_HOST], ownerEmail: OWNER }, { ownerUrl: url! });
    tenantId = (await saas!.selectFrom('tenant').select('id').where('slug', '=', SLUG).executeTakeFirstOrThrow()).id;
    forgetHost(TENANT_HOST);
  }, 120_000);
  afterAll(async () => {
    await saas?.deleteFrom('console_event').where('actor', '=', BOSS).execute();
    await saas?.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await saas?.destroy();
  });

  it('its host only; a link for the allowed addresses only, same answer for everybody', async () => {
    expect((await consoleCall('/console', { host: TENANT_HOST })).status).toBe(404);
    const page = await consoleCall('/console');
    expect(await page.text()).toContain('Recevoir un lien');
    const stranger = await consoleCall('/console/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER }) });
    expect(await stranger.json()).toEqual({ ok: true });
    const asked = await consoleCall('/console/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'Boss@Example.org' }) });
    const { link } = await asked.json() as { link: string };
    expect(link).toMatch(/^https:\/\/admin\.example\.org\/console\/auth\/verify\?token=/);
    const opened = await consoleCall('/console/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: new URL(link).searchParams.get('token')! }).toString() });
    expect(opened.status).toBe(303);
    boss = cookieOf(opened);
    expect(opened.headers.get('Set-Cookie')).toContain(`Max-Age=${12 * 3600}`);
  });

  it('the overview and the page of a tenant; a tenant session never opens the console', async () => {
    const list = await (await consoleCall('/console/api/tenants', { headers: { Cookie: boss } })).json() as any;
    expect(list.tenants.find((t: any) => t.slug === SLUG)).toMatchObject({ plan: 'trial', status: 'active', members: 1, host: TENANT_HOST });
    const detail = await (await consoleCall(`/console/api/tenants/${SLUG}`, { headers: { Cookie: boss } })).json() as any;
    expect(detail.members.map((m: any) => m.email)).toEqual([OWNER]);
    expect((await consoleCall('/console/api/tenants', { headers: { Cookie: 'druid_session=not-a-session' } })).status).toBe(401);
    // Same cookie name, but a session of the tenant: refused.
    const tenantSession = await saas!.insertInto('session').values({ email: BOSS, tenant_id: tenantId, expires_at: new Date(Date.now() + 3600_000).toISOString() }).returning('id').executeTakeFirstOrThrow();
    expect((await consoleCall('/console/api/tenants', { headers: { Cookie: `druid_session=${tenantSession.id}` } })).status).toBe(401);
    // A write from another site.
    expect((await consoleCall(`/console/api/tenants/${SLUG}/plan`, { ...post(boss, { plan: 'team' }), headers: { ...post(boss, {}).headers, Origin: 'https://evil.example.net' } })).status).toBe(403);
  });

  it('plan and status changed, journaled', async () => {
    expect((await consoleCall(`/console/api/tenants/${SLUG}/plan`, post(boss, { plan: 'gold' }))).status).toBe(400);
    const changed = await consoleCall(`/console/api/tenants/${SLUG}/plan`, post(boss, { plan: 'complete' }));
    expect(await changed.json()).toEqual({ from: 'trial', to: 'complete' });
    expect((await consoleCall(`/console/api/tenants/${SLUG}/status`, post(boss, { status: 'suspended' }))).status).toBe(200);
    let t = await saas!.selectFrom('tenant').select(['plan_code', 'status']).where('id', '=', tenantId).executeTakeFirstOrThrow();
    expect(t).toEqual({ plan_code: 'complete', status: 'suspended' });
    expect((await consoleCall(`/console/api/tenants/${SLUG}/status`, post(boss, { status: 'active' }))).status).toBe(200);
    t = await saas!.selectFrom('tenant').select(['plan_code', 'status']).where('id', '=', tenantId).executeTakeFirstOrThrow();
    expect(t.status).toBe('active');
    const events = await saas!.selectFrom('console_event').select(['action', 'details']).where('tenant_id', '=', tenantId).orderBy('id').execute();
    expect(events.map((e) => e.action)).toEqual(['plan', 'suspend', 'reactivate']);
    expect(events[0].details).toEqual({ from: 'trial', to: 'complete' });
  });

  it('a quote request listed, then marked handled', async () => {
    await saas!.insertInto('quote_request').values({ tenant_id: tenantId, email: OWNER, plan_code: 'complete', researchers: 400, accounts: null, message: 'Merci', feature: 'reports' }).execute();
    const list = await (await consoleCall('/console/api/tenants', { headers: { Cookie: boss } })).json() as any;
    expect(list.tenants.find((t: any) => t.slug === SLUG).pendingQuotes).toBe(1);
    const detail = await (await consoleCall(`/console/api/tenants/${SLUG}`, { headers: { Cookie: boss } })).json() as any;
    expect(detail.quotes).toEqual([expect.objectContaining({ email: OWNER, plan: 'complete', researchers: 400, feature: 'reports', handledAt: null })]);
    const id = detail.quotes[0].id;
    expect((await consoleCall(`/console/api/tenants/${SLUG}/quotes/${id}/handled`, post(boss, {}))).status).toBe(200);
    expect((await consoleCall(`/console/api/tenants/${SLUG}/quotes/${id}/handled`, post(boss, {}))).status).toBe(404);
  });

  it('a failed job relaunched once', async () => {
    const failed = await enqueueJob(saas!, { tenantId, type: 'structures.align', params: { mode: 'search' }, key: 'structures.align' });
    await saas!.updateTable('job').set({ status: 'failed', log: 'boom' }).where('id', '=', failed).execute();
    const r = await consoleCall(`/console/api/tenants/${SLUG}/jobs/${failed}/retry`, post(boss, {}));
    expect(r.status).toBe(202);
    const { jobId } = await r.json() as { jobId: string };
    expect(await saas!.selectFrom('job').select(['type', 'status', 'params', 'created_by']).where('id', '=', jobId).executeTakeFirstOrThrow())
      .toEqual({ type: 'structures.align', status: 'queued', params: { mode: 'search' }, created_by: `console:${BOSS}` });
    expect((await consoleCall(`/console/api/tenants/${SLUG}/jobs/${failed}/retry`, post(boss, {}))).status).toBe(409);
    await saas!.deleteFrom('job').where('tenant_id', '=', tenantId).execute();
  });

  it('impersonation: a marked session of the member, short, the last sign-in untouched; journaled', async () => {
    const owner = await saas!.selectFrom('member').select(['id', 'last_login_at']).where('tenant_id', '=', tenantId).executeTakeFirstOrThrow();
    const r = await consoleCall(`/console/api/tenants/${SLUG}/impersonate`, post(boss, { memberId: owner.id, reason: 'support ticket 12' }));
    expect(r.status).toBe(200);
    const { url: link } = await r.json() as { url: string };
    expect(link).toMatch(new RegExp(`^https://${TENANT_HOST}/api/auth/verify\\?token=`));
    const opened = await tenantCall(authVerify.onRequestPost, '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: new URL(link).searchParams.get('token')! }).toString() });
    expect(opened.status).toBe(303);
    expect(opened.headers.get('Set-Cookie')).toContain(`Max-Age=${2 * 3600}`);
    const info = await (await tenantCall(me.onRequest, '/api/me', { headers: { Cookie: cookieOf(opened) } })).json() as any;
    expect(info).toMatchObject({ email: OWNER, impersonatedBy: BOSS });
    expect((await saas!.selectFrom('member').select('last_login_at').where('id', '=', owner.id).executeTakeFirstOrThrow()).last_login_at).toEqual(owner.last_login_at);
    const ev = await saas!.selectFrom('console_event').select(['action', 'details']).where('tenant_id', '=', tenantId).where('action', '=', 'impersonate').executeTakeFirstOrThrow();
    expect(ev.details).toEqual({ as: OWNER, reason: 'support ticket 12' });
  });

  it('an address removed from the allow-list loses the console at once', async () => {
    const before = env.SAAS_SUPERADMIN_EMAILS;
    env.SAAS_SUPERADMIN_EMAILS = 'other@example.org';
    try {
      expect((await consoleCall('/console/api/tenants', { headers: { Cookie: boss } })).status).toBe(401);
    } finally {
      env.SAAS_SUPERADMIN_EMAILS = before;
    }
  });
});
