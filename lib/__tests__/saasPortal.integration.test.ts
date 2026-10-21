// Portal « create my Druid » end to end (druid-internal docs/plan-druid-saas.md, lot 2): magic link of the portal,
// creation of a tenant (control-plane rows + job), the runner provisions it (schema, directory, status), the creator
// opens it on its own host. Needs DATABASE_URL (owner) and dbmate; no network (the registries are not called here —
// the relay of the ministry and ROR has its own optional test below, SAAS_NETWORK_TESTS=1).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { tenantSchemaName } from '../saas/controlPlane';
import { runJobsOnce } from '../saas/runner';
import { dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/saasPortal.integration.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();

const portal = await import('../../functions/start/[[path]].js');
const middleware = await import('../../functions/api/_middleware.js');
const me = await import('../../functions/api/me.js');
const v1 = await import('../../functions/api/v1/[[path]].js');
const authVerify = await import('../../functions/api/auth/verify.js');
const { forgetHost } = await import('../../functions/_lib/saas.js');

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP || url;
const saas = url ? openSaasDb(url) : null;
const PORTAL = 'start.example.org';
const BASE = 'example.org';
const SLUG = 'zz-portal-demo';
const env = { SAAS_HYPERDRIVE: { connectionString: appUrl }, SAAS_DEV_LINKS: 'true', SAAS_PORTAL_HOST: PORTAL, SAAS_BASE_DOMAIN: BASE };
const CREATOR = 'creator-portal@example.org';

const req = (host: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  new Request(`https://${host}${path}`, { method: init.method || 'GET', headers: init.headers, body: init.body });
const callPortal = (path: string, init: Parameters<typeof req>[2] = {}) => portal.onRequest({ request: req(PORTAL, path, init), env, data: {}, waitUntil: () => {} } as any);
const callApi = async (handler: any, host: string, path: string, init: Parameters<typeof req>[2] = {}) => {
  const context: any = { request: req(host, path, init), env, data: {}, params: {}, waitUntil: () => {}, next: () => handler(context) };
  return middleware.onRequest(context);
};
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];

const payload = {
  slug: SLUG, label: 'Université de Démonstration', mailDomains: ['univ-demo.example.org'],
  establishment: { ror: '05abcde12', name: 'Université de Démonstration', nameEn: 'Demonstration University', country: 'France', countryCode: 'FR', city: 'Démoville', website: 'https://www.univ-demo.example.org/', uai: '0000000A', siret: '00000000000001', idref: '000000001', wikidata: 'Q9999991', openalex: 'I9999999' },
  labs: [
    { rnsr: '200000001X', acronym: 'LDEMO', name: 'Laboratoire de démonstration', label: 'UMR 0001', type: 'UMR', website: 'https://ldemo.example.org', tutelles: ['Université de Démonstration', 'CNRS'], uaiTutelles: ['0000000A', '0753639Y'] },
    { rnsr: '200000002Y', acronym: 'IDEMO', name: 'Institut de démonstration', label: 'UR 0002', type: 'UR', tutelles: ['Université de Démonstration'], uaiTutelles: ['0000000A'] },
    { rnsr: null, acronym: 'LDEMO', name: 'Doublon de sigle', tutelles: [], uaiTutelles: [] },
  ],
};

describe.skipIf(!url)('portal: create a tenant, provision it, open it', () => {
  let cookie = '';
  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    await saas!.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    forgetHost(`${SLUG}.${BASE}`);
  }, 120_000);
  afterAll(async () => {
    await saas?.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await saas?.destroy();
  });

  it('answers on the portal host only; home page without session; relays need a session', async () => {
    expect((await portal.onRequest({ request: req('other.example.org', '/start'), env, data: {} } as any)).status).toBe(404);
    const home = await callPortal('/start');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Créer mon Druid');
    expect((await callPortal('/start/api/organizations?q=nantes')).status).toBe(401);
    expect((await callPortal('/start/new')).status).toBe(302);
  });

  it('magic link of the portal opens a portal session (not a tenant one)', async () => {
    const asked = await callPortal('/start/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CREATOR.toUpperCase() }) });
    expect(asked.status).toBe(200);
    const { link } = await asked.json() as { link: string };
    expect(link).toContain(`https://${PORTAL}/start/auth/verify?token=`);
    const token = new URL(link).searchParams.get('token')!;
    const page = await callPortal(`/start/auth/verify?token=${token}`);
    expect(await page.text()).toContain('action="/start/auth/verify"');
    const opened = await callPortal('/start/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
    expect(opened.status).toBe(303);
    expect(opened.headers.get('Location')).toBe(`https://${PORTAL}/start/new`);
    cookie = cookieOf(opened);
    const home = await callPortal('/start', { headers: { Cookie: cookie } });
    expect(await home.text()).toContain('Aucun Druid pour le moment');
    expect((await callPortal('/start/new', { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it('creates the tenant (provisioning, job queued), refuses a second one for the same establishment', async () => {
    const created = await callPortal('/start/api/tenants', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ slug: SLUG, host: `${SLUG}.${BASE}` });
    const status = await callPortal(`/start/api/tenants/${SLUG}`, { headers: { Cookie: cookie } });
    const st = await status.json() as any;
    expect(st).toMatchObject({ slug: SLUG, status: 'provisioning', host: `${SLUG}.${BASE}`, plan: 'trial' });
    expect(st.jobs).toEqual([expect.objectContaining({ type: 'tenant.provision', status: 'queued' })]);
    const again = await callPortal('/start/api/tenants', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, slug: 'zz-portal-other' }) });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ existing: { slug: SLUG } });
    const ask = await callPortal(`/start/api/tenants/${SLUG}/access-request`, { method: 'POST', headers: { Cookie: cookie } });
    expect(ask.status).toBe(200);
    expect((await callPortal('/start/api/tenants', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, slug: 'www', establishment: { ...payload.establishment, ror: null } }) })).status).toBe(400);
    // Before provisioning, the tenant host is served (read-only) and the owner cannot open it yet.
    expect((await callPortal(`/start/api/tenants/${SLUG}/open`, { method: 'POST', headers: { Cookie: cookie } })).status).toBe(409);
    const wait = await callPortal(`/start/wait/${SLUG}`, { headers: { Cookie: cookie } });
    expect(await wait.text()).toContain('Construction de votre Druid');
  });

  it('the runner provisions the tenant: schema, directory, status active', async () => {
    // The provisioning queues the structure alignment (lot 4), run here against registries that answer nothing.
    const emptyRegistries = (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })) as unknown as typeof fetch;
    const out = await runJobsOnce(saas!, { ownerUrl: url!, appUrl, baseDomain: BASE, cloudflare: null, email: null, log: () => {}, fetchImpl: emptyRegistries });
    expect(out).toEqual({ done: 2, failed: 0 });
    const st = await (await callPortal(`/start/api/tenants/${SLUG}`, { headers: { Cookie: cookie } })).json() as any;
    expect(st.status).toBe('active');
    expect(st.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tenant.provision', status: 'done', progress: expect.objectContaining({ step: 'ready', pct: 100 }) }),
      expect.objectContaining({ type: 'structures.align', status: 'done' }),
    ]));
    const db = createDb({ connectionString: appUrl!, max: 1, schema: tenantSchemaName(SLUG), allowExitOnIdle: true });
    try {
      const structures = await db.selectFrom('structure').select(['acronym', 'rnsr', 'type']).orderBy('acronym').execute();
      expect(structures).toEqual([{ acronym: 'IDEMO', rnsr: '200000002Y', type: 'UR' }, { acronym: 'LDEMO', rnsr: '200000001X', type: 'UMR' }]);
      const institutions = await db.selectFrom('establishment').select(['name', 'uai', 'ror', 'idref']).execute();
      expect(institutions).toEqual([{ name: 'Université de Démonstration', uai: '0000000A', ror: '05abcde12', idref: '000000001' }]);
    } finally {
      await db.destroy();
    }
    const job = await saas!.selectFrom('job').select('log').where('type', '=', 'tenant.provision').where('tenant_id', '=', (await saas!.selectFrom('tenant').select('id').where('slug', '=', SLUG).executeTakeFirstOrThrow()).id).executeTakeFirstOrThrow();
    expect(job.log).toContain('1 skipped');
  }, 120_000);

  it('the creator opens the tenant on its own host and is its owner', async () => {
    const opened = await callPortal(`/start/api/tenants/${SLUG}/open`, { method: 'POST', headers: { Cookie: cookie } });
    expect(opened.status).toBe(200);
    const { url: link } = await opened.json() as { url: string };
    const host = `${SLUG}.${BASE}`;
    expect(link).toContain(`https://${host}/api/auth/verify?token=`);
    const token = new URL(link).searchParams.get('token')!;
    const session = await callApi(authVerify.onRequestPost, host, '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
    expect(session.status).toBe(303);
    const tenantCookie = cookieOf(session);
    const who = await (await callApi(me.onRequest, host, '/api/me', { headers: { Cookie: tenantCookie } })).json() as any;
    expect(who).toMatchObject({ email: CREATOR, auth: 'session', tenant: { slug: SLUG, status: 'active' } });
    expect(who.access.isSuperAdmin).toBe(true);
    const list = await (await callApi(v1.onRequest, host, '/api/v1/structures', { headers: { Cookie: tenantCookie } })).json() as any;
    expect(list.items.map((s: any) => s.acronym).sort()).toEqual(['IDEMO', 'LDEMO']);
    // The portal session is not a session of the tenant.
    expect((await callApi(me.onRequest, host, '/api/me', { headers: { Cookie: cookie } })).status).toBe(401);
    const home = await callPortal('/start', { headers: { Cookie: cookie } });
    expect(await home.text()).toContain('Université de Démonstration');
  });
});

describe.skipIf(!process.env.SAAS_NETWORK_TESTS)('portal relays (network)', () => {
  it('details of a French university: ministry record, OpenAlex, RNSR structures', async () => {
    const d = await portal.organizationDetails('03gnr7b55', { OPENALEX_MAILTO: 'contact@example.org' });
    expect(d.organization?.name).toMatch(/Nantes/);
    expect(d.establishment).toMatchObject({ uai: '0442953W', siret: '13002974700016' });
    expect(d.openalex?.id).toMatch(/^I\d+$/);
    expect(d.labs.length).toBeGreaterThan(50);
    expect(d.labs.find((l: any) => l.acronym === 'LS2N')).toMatchObject({ rnsr: '201722241F', labelType: 'UMR' });
    expect(d.proposals.slug).toBe('nantes-universite');
  }, 60_000);
});
