// Accounts of a tenant (druid-internal docs/plan-druid-saas.md, lot 6 a-1), end to end on a database: « My institution »
// API (functions/api/tenant) — seats of the plan, invitations, roles, the last owner, removal closing the sessions,
// mail domains — and the access requests a colleague of a mail domain sends from the login page.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantSchemaName } from '../saas/controlPlane';
import { normalizeMailDomains } from '../saas/members';
import { createTenant, dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/saasMembers.integration.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();

const middleware = await import('../../functions/api/_middleware.js');
const me = await import('../../functions/api/me.js');
const tenantApi = await import('../../functions/api/tenant/[[path]].js');
const authRequest = await import('../../functions/api/auth/request.js');
const authVerify = await import('../../functions/api/auth/verify.js');
const { forgetHost } = await import('../../functions/_lib/saas.js');

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP || url;
const saas = url ? openSaasDb(url) : null;
const SLUG = 'zz-members';
const HOST = `${SLUG}.example.org`;
const OWNER = 'owner-members@example.org';
const env = { SAAS_HYPERDRIVE: { connectionString: appUrl }, SAAS_DEV_LINKS: 'true' };

const call = async (handler: any, input: { path: string; method?: string; headers?: Record<string, string>; body?: string }) => {
  const request = new Request(`https://${HOST}${input.path}`, { method: input.method || 'GET', headers: input.headers, body: input.body });
  const context: any = { request, env, data: {}, params: {}, waitUntil: () => {}, next: () => handler(context) };
  return middleware.onRequest(context);
};
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];
const api = (cookie: string, path: string, method = 'GET', body?: unknown) =>
  call(tenantApi.onRequest, { path: `/api/tenant${path}`, method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const requestLink = (email: string) =>
  call(authRequest.onRequestPost, { path: '/api/auth/request', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
const signIn = async (email: string): Promise<string | null> => {
  const { link } = await (await requestLink(email)).json() as { link?: string };
  if (!link) return null;
  const form = new URLSearchParams({ token: new URL(link).searchParams.get('token')! });
  const opened = await call(authVerify.onRequestPost, { path: '/api/auth/verify', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  return cookieOf(opened);
};

describe('mail domains', () => {
  it('normalized, deduplicated, validated', () => {
    expect(normalizeMailDomains(' @Univ-X.fr, etu.univ-x.fr;univ-x.fr ')).toEqual(['univ-x.fr', 'etu.univ-x.fr']);
    expect(normalizeMailDomains([])).toEqual([]);
    expect(() => normalizeMailDomains(['not a domain'])).toThrow('Invalid mail domain');
    expect(() => normalizeMailDomains(Array.from({ length: 11 }, (_, i) => `d${i}.fr`))).toThrow('Too many mail domains');
  });
});

describe.skipIf(!url)('accounts of a tenant', () => {
  let tenantId = '';
  let owner = '';
  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    await saas!.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await createTenant(saas!, { slug: SLUG, label: 'Université Membres', hosts: [HOST], ownerEmail: OWNER }, { ownerUrl: url! });
    tenantId = (await saas!.selectFrom('tenant').select('id').where('slug', '=', SLUG).executeTakeFirstOrThrow()).id;
    forgetHost(HOST);
    owner = (await signIn(OWNER))!;
  }, 120_000);
  afterAll(async () => {
    await saas?.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await saas?.destroy();
  });

  it('the trial has one account: the owner; inviting is refused until the plan changes', async () => {
    const view = await (await api(owner, '')).json() as any;
    expect(view.plan.code).toBe('trial');
    expect(view.seats).toEqual({ used: 1, allowed: 1 });
    expect(view.members).toEqual([expect.objectContaining({ email: OWNER, role: 'owner', pending: false })]);
    const refused = await api(owner, '/members', 'POST', { email: 'a@example.org', role: 'viewer' });
    expect(refused.status).toBe(409);
    expect((await refused.json() as any).error).toBe('Account limit of the plan reached');
    // The Team plan (the DirlaData console will do it, lot 6 c).
    await saas!.updateTable('tenant').set({ plan_code: 'team' }).where('id', '=', tenantId).execute();
    forgetHost(HOST);
  });

  it('invites, refuses a duplicate, a lab account without labs, and the invitee signs in', async () => {
    const created = await api(owner, '/members', 'POST', { email: ' Admin@Example.org ', role: 'admin' });
    expect(created.status).toBe(201);
    const body = await created.json() as any;
    // No Resend in the tests: the link to hand over comes back, address prefilled.
    expect(body).toMatchObject({ member: { email: 'admin@example.org', role: 'admin', pending: true }, sent: false });
    expect(body.loginUrl).toBe(`https://${HOST}/auth/login?email=admin%40example.org`);
    expect((await api(owner, '/members', 'POST', { email: 'admin@example.org', role: 'viewer' })).status).toBe(409);
    const noLab = await api(owner, '/members', 'POST', { email: 'lab@example.org', role: 'lab' });
    expect(noLab.status).toBe(400);
    expect((await api(owner, '/members', 'POST', { email: 'lab@example.org', role: 'lab', labScope: ['LAB1', 'LAB1', 'LAB2'] })).status).toBe(201);
    const admin = (await signIn('admin@example.org'))!;
    const view = await (await api(admin, '')).json() as any;
    expect(view.me).toEqual({ email: 'admin@example.org', role: 'admin' });
    expect(view.members.find((m: any) => m.email === 'admin@example.org').pending).toBe(false);
    expect(view.members.find((m: any) => m.email === 'lab@example.org').labScope).toEqual(['LAB1', 'LAB2']);
    // An admin reads, does not write.
    expect((await api(admin, '/members', 'POST', { email: 'x@example.org', role: 'viewer' })).status).toBe(403);
  });

  it('the last owner keeps the role and stays; removing a member closes their sessions', async () => {
    const view = await (await api(owner, '')).json() as any;
    const me1 = view.members.find((m: any) => m.email === OWNER);
    expect((await api(owner, `/members/${me1.id}`, 'PATCH', { role: 'viewer' })).status).toBe(409);
    expect((await api(owner, `/members/${me1.id}`, 'DELETE')).status).toBe(409);
    const adminRow = view.members.find((m: any) => m.email === 'admin@example.org');
    const admin = (await signIn('admin@example.org'))!;
    expect((await call(me.onRequest, { path: '/api/me', headers: { Cookie: admin } })).status).toBe(200);
    expect((await api(owner, `/members/${adminRow.id}`, 'DELETE')).status).toBe(200);
    // The session is gone: the cookie no longer opens the tenant.
    expect((await api(admin, '')).status).toBe(401);
    expect((await api(owner, '/members/not-a-uuid', 'DELETE')).status).toBe(404);
  });

  it('mail domains, and the access request of a colleague of a domain, accepted then dismissed', async () => {
    const saved = await api(owner, '/mail-domains', 'PUT', { mailDomains: ['@Example.org'] });
    expect(await saved.json()).toEqual({ mailDomains: ['example.org'] });
    expect((await api(owner, '/mail-domains', 'PUT', { mailDomains: ['nope'] })).status).toBe(400);
    forgetHost(HOST);
    // A non-member of the domain: same answer as for anyone, no link, a request recorded once.
    for (const email of ['colleague@example.org', 'colleague@example.org', 'other@example.org', 'stranger@example.net']) {
      const res = await requestLink(email);
      expect(await res.json()).toEqual({ ok: true });
    }
    let view = await (await api(owner, '')).json() as any;
    expect(view.accessRequests.map((r: any) => r.email)).toEqual(['colleague@example.org', 'other@example.org']);
    const [colleague, other] = view.accessRequests;
    const accepted = await api(owner, `/access-requests/${colleague.id}/accept`, 'POST', {});
    expect(accepted.status).toBe(201);
    expect((await accepted.json() as any).member).toMatchObject({ email: 'colleague@example.org', role: 'viewer' });
    expect((await api(owner, `/access-requests/${other.id}/dismiss`, 'POST')).status).toBe(200);
    expect((await api(owner, `/access-requests/${other.id}/dismiss`, 'POST')).status).toBe(404);
    view = await (await api(owner, '')).json() as any;
    expect(view.accessRequests).toEqual([]);
    // The accepted colleague now signs in; a dismissed one asking again does not reopen the request.
    expect(await signIn('colleague@example.org')).toBeTruthy();
    await requestLink('other@example.org');
    expect((await (await api(owner, '')).json() as any).accessRequests).toEqual([]);
  });

  it('outside a tenant member: 401 without session, 403 for a viewer or a lab account', async () => {
    expect((await api('', '')).status).toBe(401);
    const lab = (await signIn('lab@example.org'))!;
    expect((await api(lab, '')).status).toBe(403);
  });
});
