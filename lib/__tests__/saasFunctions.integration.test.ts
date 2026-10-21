// Cloudflare Functions of a tenant of the control plane (druid-internal docs/plan-druid-saas.md, lot 1 c-e), end to end
// on a database: middleware (host → tenant, session → identity), /api/me, magic link, session cookie, /api/v1 reads
// and writes by role, logout, isolation between two tenants. Needs DATABASE_URL (owner) — the Hyperdrive binding is
// faked with the application URL when DATABASE_URL_APP is set.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StructureLevel } from '../../types';
import { tenantSchemaName } from '../saas/controlPlane';
import { createTenant, dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/saasFunctions.integration.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();

const middleware = await import('../../functions/api/_middleware.js');
const me = await import('../../functions/api/me.js');
const v1 = await import('../../functions/api/v1/[[path]].js');
const authRequest = await import('../../functions/api/auth/request.js');
const authVerify = await import('../../functions/api/auth/verify.js');
const login = await import('../../functions/auth/login.js');
const logout = await import('../../functions/auth/logout.js');
const { forgetHost } = await import('../../functions/_lib/saas.js');

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP || url;
const saas = url ? openSaasDb(url) : null;
const SLUGS = ['zz-fn-alpha', 'zz-fn-beta'];
const HOST = (slug: string) => `${slug}.example.org`;
const env = { SAAS_HYPERDRIVE: { connectionString: appUrl }, SAAS_DEV_LINKS: 'true' };

/** Runs the middleware then `handler`, like Pages does for a /api route. */
const call = async (handler: any, input: { host: string; path: string; method?: string; headers?: Record<string, string>; body?: string }) => {
  const request = new Request(`https://${input.host}${input.path}`, { method: input.method || 'GET', headers: input.headers, body: input.body });
  const context: any = { request, env, data: {}, params: {}, waitUntil: () => {}, next: () => handler(context) };
  return middleware.onRequest(context);
};
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];

describe.skipIf(!url)('Functions of a tenant', () => {
  const owners: Record<string, string> = {};
  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    for (const slug of SLUGS) {
      await saas!.deleteFrom('tenant').where('slug', '=', slug).execute();
      await dropTenantSchema(tenantSchemaName(slug), { ownerUrl: url! });
      owners[slug] = `owner-${slug}@example.org`;
      await createTenant(saas!, { slug, label: `Tenant ${slug}`, hosts: [HOST(slug)], ownerEmail: owners[slug] }, { ownerUrl: url! });
      forgetHost(HOST(slug));
    }
    const alpha = await saas!.selectFrom('tenant').select('id').where('slug', '=', SLUGS[0]).executeTakeFirstOrThrow();
    await saas!.insertInto('member').values([
      { tenant_id: alpha.id, email: 'viewer-alpha@example.org', role: 'viewer', invited_by: owners[SLUGS[0]] },
      { tenant_id: alpha.id, email: 'lab-alpha@example.org', role: 'lab', lab_scope: ['LAB1'], invited_by: owners[SLUGS[0]] },
    ]).execute();
  }, 120_000);
  afterAll(async () => {
    for (const slug of SLUGS) {
      await saas?.deleteFrom('tenant').where('slug', '=', slug).execute();
      await dropTenantSchema(tenantSchemaName(slug), { ownerUrl: url! });
    }
    await saas?.destroy();
  });

  /** Opens a session for `email` on `host` through the magic link (dev link returned by the request). */
  const signIn = async (host: string, email: string, next = '/structures') => {
    const asked = await call(authRequest.onRequestPost, { host, path: '/api/auth/request', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, next }) });
    expect(asked.status).toBe(200);
    const { link } = await asked.json() as { link?: string };
    if (!link) return null;
    const token = new URL(link).searchParams.get('token')!;
    const form = new URLSearchParams({ token });
    const opened = await call(authVerify.onRequestPost, { host, path: '/api/auth/verify', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    return { response: opened, cookie: cookieOf(opened), token };
  };

  it('an unknown host is 404; a tenant without session is 401 on /api/me and /api/v1', async () => {
    expect((await call(me.onRequest, { host: 'nobody.example.org', path: '/api/me' })).status).toBe(404);
    const anon = await call(me.onRequest, { host: HOST(SLUGS[0]), path: '/api/me' });
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ error: 'Authentication required', login: '/auth/login' });
    // A forged Access header is not an identity on a tenant.
    const forged = await call(me.onRequest, { host: HOST(SLUGS[0]), path: '/api/me', headers: { 'Cf-Access-Authenticated-User-Email': owners[SLUGS[0]] } });
    expect(forged.status).toBe(401);
    expect((await call(v1.onRequest, { host: HOST(SLUGS[0]), path: '/api/v1/structures' })).status).toBe(401);
  });

  it('login page on a tenant, home page elsewhere', async () => {
    const ctx: any = { request: new Request(`https://${HOST(SLUGS[0])}/auth/login?next=/x&reason=expired`), env, data: {} };
    const page = await login.onRequestGet(ctx);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Tenant zz-fn-alpha');
    expect(html).toContain('expired');
    const none = await login.onRequestGet({ request: new Request('https://nobody.example.org/auth/login'), env, data: {} });
    expect(none.status).toBe(302);
  });

  it('magic link: unknown address gets 200 without a link; the owner signs in, the link works once, the cookie opens /api/me', async () => {
    const host = HOST(SLUGS[0]);
    expect(await signIn(host, 'stranger@example.org')).toBeNull();
    const session = await signIn(host, owners[SLUGS[0]].toUpperCase());
    expect(session).not.toBeNull();
    expect(session!.response.status).toBe(303);
    expect(session!.response.headers.get('Location')).toBe(`https://${host}/structures`);
    expect(session!.cookie).toMatch(/^druid_session=[0-9a-f-]{36}$/);
    const replay = await call(authVerify.onRequestPost, { host, path: '/api/auth/verify', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: session!.token }).toString() });
    expect(replay.status).toBe(302);
    expect(replay.headers.get('Location')).toContain('reason=expired');
    const who = await call(me.onRequest, { host, path: '/api/me', headers: { Cookie: session!.cookie } });
    expect(who.status).toBe(200);
    const user = await who.json() as any;
    expect(user).toMatchObject({ email: owners[SLUGS[0]], auth: 'session', roles: ['user', 'admin', 'dashboard_viewer'] });
    expect(user.access.isSuperAdmin).toBe(true);
    expect(user.capabilities).toMatchObject({ READ_ONLY: false, HAS_SERVER_JOBS: true, HAS_BENCHMARK: false });
    expect(user.tenant).toMatchObject({ slug: SLUGS[0], status: 'active', plan: { code: 'trial', seats: 1 }, members: 3 });
    expect(user.instance).toMatchObject({ slug: SLUGS[0], label: 'Tenant zz-fn-alpha', storage: 'postgres' });
    // The cookie of alpha opens nothing on beta.
    expect((await call(me.onRequest, { host: HOST(SLUGS[1]), path: '/api/me', headers: { Cookie: session!.cookie } })).status).toBe(401);
    // The GET of the link (mail scanners) consumes nothing: an interstitial page.
    const get = await authVerify.onRequestGet({ request: new Request(`https://${host}/api/auth/verify?token=abc`), env, data: {} } as any);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('name="token" value="abc"');
  });

  it('/api/v1: the owner writes, a viewer only reads, a lab account is scoped, and tenants are isolated', async () => {
    const host = HOST(SLUGS[0]);
    const owner = (await signIn(host, owners[SLUGS[0]]))!;
    const body = JSON.stringify({ level: StructureLevel.ENTITE, nature: 'LABO', type: 'UMR', acronym: 'LAB1', officialName: 'Laboratory one', localId: 'LAB1' });
    const created = await call(v1.onRequest, { host, path: '/api/v1/structures', method: 'POST', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' }, body });
    expect([200, 201]).toContain(created.status);
    const list = await call(v1.onRequest, { host, path: '/api/v1/structures', headers: { Cookie: owner.cookie } });
    expect(list.status).toBe(200);
    expect(((await list.json()) as any).items.map((s: any) => s.acronym)).toEqual(['LAB1']);
    const viewer = (await signIn(host, 'viewer-alpha@example.org'))!;
    expect((await call(v1.onRequest, { host, path: '/api/v1/structures', headers: { Cookie: viewer.cookie } })).status).toBe(200);
    const refused = await call(v1.onRequest, { host, path: '/api/v1/structures', method: 'POST', headers: { Cookie: viewer.cookie, 'Content-Type': 'application/json' }, body: body.replace(/LAB1/g, 'LAB2') });
    expect(refused.status).toBe(403);
    const lab = (await signIn(host, 'lab-alpha@example.org'))!;
    const labMe = await (await call(me.onRequest, { host, path: '/api/me', headers: { Cookie: lab.cookie } })).json() as any;
    expect(labMe.access.allowedSlugs).toEqual(['lab1']);
    expect(labMe.access.isSuperAdmin).toBe(false);
    // Beta sees nothing of alpha.
    const beta = (await signIn(HOST(SLUGS[1]), owners[SLUGS[1]]))!;
    const betaList = await call(v1.onRequest, { host: HOST(SLUGS[1]), path: '/api/v1/structures', headers: { Cookie: beta.cookie } });
    expect(betaList.status).toBe(200);
    expect(((await betaList.json()) as any).items).toEqual([]);
    // Logout: session gone, cookie cleared.
    const out = await logout.onRequest({ request: new Request(`https://${host}/auth/logout`, { headers: { Cookie: owner.cookie } }), env, data: {} } as any);
    expect(out.status).toBe(302);
    expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await call(me.onRequest, { host, path: '/api/me', headers: { Cookie: owner.cookie } })).status).toBe(401);
  }, 60_000);
});
