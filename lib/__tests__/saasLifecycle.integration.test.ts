// Export and deletion of a tenant end to end (druid-internal docs/plan-druid-saas.md, lot 6 a-3): the owner asks for an
// export (one at a time, owners only), the runner archives the dump (pg_dump faked), the dashboards and the accounts
// and uploads it, the owner downloads it until it expires and the scheduler removes it; the owner asks for the
// deletion (confirmed with the slug), the tenant is read-only, the owner cancels, asks again, and once the date is
// past the scheduler queues `tenant.delete`, which drops the schema, the objects, the files and the rows.
// Needs DATABASE_URL (owner) and dbmate; no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantSchemaName } from '../saas/controlPlane';
import { dueDeletions } from '../saas/lifecycle';
import { runJobsOnce, scheduleLifecycle, type RunnerEnv } from '../saas/runner';
import { memoryAssetStore } from '../saas/r2';
import { createTenant, dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/saasLifecycle.integration.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();

const middleware = await import('../../functions/api/_middleware.js');
const authRequest = await import('../../functions/api/auth/request.js');
const authVerify = await import('../../functions/api/auth/verify.js');
const tenantApi = await import('../../functions/api/tenant/[[path]].js');
const me = await import('../../functions/api/me.js');
const { forgetHost } = await import('../../functions/_lib/saas.js');

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP || url;
const saas = url ? openSaasDb(url) : null;
const SLUG = 'zz-life-alpha';
const HOST = `${SLUG}.example.org`;
const OWNER = 'owner-life@example.org';
const ADMIN = 'admin-life@example.org';
const store = memoryAssetStore();
const SAAS_ASSETS = {
  get: async (key: string) => {
    const o = store.objects.get(key);
    return o ? { body: o.body } : null;
  },
};
const env = { SAAS_HYPERDRIVE: { connectionString: appUrl }, SAAS_DEV_LINKS: 'true', SAAS_ASSETS };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-life-'));

const call = async (handler: any, input: { path: string; method?: string; headers?: Record<string, string>; body?: string }) => {
  const request = new Request(`https://${HOST}${input.path}`, { method: input.method || 'GET', headers: input.headers, body: input.body });
  const context: any = { request, env, data: {}, params: {}, waitUntil: () => {}, next: () => handler(context) };
  return middleware.onRequest(context);
};
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];
const api = (cookie: string, method: string, p: string, body?: unknown) =>
  call(tenantApi.onRequest, { path: `/api/tenant${p}`, method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

// pg_dump faked (no client in the test image): writes the --file it is given; tar is the real one.
const fakeSpawn = ((cmd: string, args: string[], opts: any) => {
  if (cmd !== 'pg_dump') return spawn(cmd, args, opts);
  const file = args[args.indexOf('--file') + 1];
  const schema = args[args.indexOf('--schema') + 1];
  const script = `require('fs').writeFileSync(${JSON.stringify(file)}, '-- dump of ' + ${JSON.stringify(schema)} + ' as ' + process.env.PGUSER + '\\n')`;
  return spawn(process.execPath, ['-e', script], opts);
}) as typeof spawn;

const runnerEnv = (): RunnerEnv => ({
  ownerUrl: url!, appUrl, baseDomain: 'example.org', cloudflare: null, email: null, name: 'test-runner',
  druidRoot: tmp, workDir: path.join(tmp, 'work'), spawnImpl: fakeSpawn, assets: store, log: process.env.DEBUG_JOBS ? (l) => console.log(l) : () => {},
  etl: { dataDir: path.join(tmp, 'etl'), command: ['true'] },
});

const schemaExists = async (schema: string) =>
  ((await sql`SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema}`.execute(saas!)).rows.length > 0);

describe.skipIf(!url)('export and deletion of a tenant', () => {
  let tenantId = '';
  let owner = '';
  let admin = '';
  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    await saas!.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    forgetHost(HOST);
    ({ id: tenantId } = await createTenant(saas!, { slug: SLUG, label: 'Lifecycle tenant', hosts: [HOST], ownerEmail: OWNER }, { ownerUrl: url! }));
    await saas!.insertInto('member').values({ tenant_id: tenantId, email: ADMIN, role: 'admin', invited_by: OWNER }).execute();
    const signIn = async (email: string) => {
      const asked = await call(authRequest.onRequestPost, { path: '/api/auth/request', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const { link } = await asked.json() as { link: string };
      const token = new URL(link).searchParams.get('token')!;
      const opened = await call(authVerify.onRequestPost, { path: '/api/auth/verify', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
      return cookieOf(opened);
    };
    owner = await signIn(OWNER);
    admin = await signIn(ADMIN);
    // A dashboard built earlier by the ETL, on the disk of the runner and in the store.
    fs.mkdirSync(path.join(tmp, 'etl', SLUG, 'ls2n'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'etl', SLUG, 'ls2n', 'dashboard.json.gz'), 'gz');
    await store.put(`${SLUG}/dashboard-data/ls2n/dashboard.json.gz`, new Uint8Array([1, 2]));
  }, 180_000);
  afterAll(async () => {
    await saas?.deleteFrom('tenant').where('label', '=', 'Lifecycle tenant').execute();
    await dropTenantSchema(tenantSchemaName(SLUG), { ownerUrl: url! });
    await saas?.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports the data: owners only, one at a time, archived and downloadable until it expires', async () => {
    expect((await api(admin, 'POST', '/exports')).status).toBe(403);
    const asked = await api(owner, 'POST', '/exports');
    expect(asked.status).toBe(202);
    const { export: ex } = await asked.json() as { export: { id: string; status: string } };
    expect(ex.status).toBe('queued');
    expect((await api(owner, 'POST', '/exports')).status).toBe(409);

    expect(await runJobsOnce(saas!, runnerEnv())).toEqual({ done: 1, failed: 0, cancelled: 0 });
    const listed = await (await api(owner, 'GET', '/exports')).json() as { exports: { id: string; available: boolean; fileName: string; size: number }[] };
    expect(listed.exports[0]).toMatchObject({ id: ex.id, available: true });
    expect(listed.exports[0].fileName).toMatch(/^druid-zz-life-alpha-\d{8}-[0-9a-f]{8}\.tar\.gz$/);

    const dl = await api(owner, 'GET', `/exports/${ex.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('Content-Disposition')).toBe(`attachment; filename="${listed.exports[0].fileName}"`);
    const archive = path.join(tmp, 'out.tar.gz');
    fs.writeFileSync(archive, new Uint8Array(await dl.arrayBuffer()));
    const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => f.replace(/^[^/]+\//, '')).sort();
    expect(files).toEqual(expect.arrayContaining(['README.txt', 'dashboards/ls2n/dashboard.json.gz', 'database.sql', 'members.csv']));
    const out = path.join(tmp, 'out');
    fs.mkdirSync(out);
    execFileSync('tar', ['-xzf', archive, '-C', out]);
    const root = path.join(out, fs.readdirSync(out)[0]);
    expect(fs.readFileSync(path.join(root, 'database.sql'), 'utf8')).toBe(`-- dump of ${tenantSchemaName(SLUG)} as druid_owner\n`);
    expect(fs.readFileSync(path.join(root, 'members.csv'), 'utf8')).toMatch(/^email,role,labs,invited_by,created_at,last_login_at\nowner-life@example\.org,owner,/);
    expect((await api(admin, 'GET', `/exports/${ex.id}/download`)).status).toBe(403);
    // The work folder of the export is gone.
    expect(fs.existsSync(path.join(tmp, 'work', SLUG, `export-${ex.id}`))).toBe(false);

    // Expired: 410, then the scheduler removes the archive.
    const job = await saas!.selectFrom('job').select('progress').where('id', '=', ex.id).executeTakeFirstOrThrow();
    const key = String((job.progress as any).objectKey);
    expect(store.objects.has(key)).toBe(true);
    await saas!.updateTable('job').set({ progress: { ...(job.progress as object), expiresAt: '2026-01-01T00:00:00.000Z' } }).where('id', '=', ex.id).execute();
    expect((await api(owner, 'GET', `/exports/${ex.id}/download`)).status).toBe(410);
    expect((await scheduleLifecycle(saas!, runnerEnv())).purged).toBe(1);
    expect(store.objects.has(key)).toBe(false);
    expect((await scheduleLifecycle(saas!, runnerEnv())).purged).toBe(0);
  }, 60_000);

  it('plans the deletion: confirmed with the slug, read-only, cancellable', async () => {
    expect((await api(admin, 'POST', '/deletion', { confirm: SLUG })).status).toBe(403);
    expect((await api(owner, 'POST', '/deletion', { confirm: 'wrong' })).status).toBe(400);
    const asked = await api(owner, 'POST', '/deletion', { confirm: SLUG.toUpperCase() });
    expect(asked.status).toBe(200);
    const { deletion } = await asked.json() as { deletion: { deleteAfter: string; requestedBy: string } };
    expect(deletion.requestedBy).toBe(OWNER);
    expect(new Date(deletion.deleteAfter).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect((await api(owner, 'POST', '/deletion', { confirm: SLUG })).status).toBe(409);
    const t = await saas!.selectFrom('tenant').selectAll().where('id', '=', tenantId).executeTakeFirstOrThrow();
    expect(t).toMatchObject({ status: 'suspended', status_before_delete: 'active' });
    // Read-only for everybody, the owner included; /api/me and « My institution » say when.
    expect((await api(owner, 'PUT', '/mail-domains', { mailDomains: ['example.org'] })).status).toBe(403);
    const mine = await (await call(me.onRequest, { path: '/api/me', headers: { Cookie: owner } })).json() as any;
    expect(mine.tenant).toMatchObject({ status: 'suspended', role: 'owner', deleteAfter: deletion.deleteAfter });
    expect(((await (await api(owner, 'GET', '')).json()) as any).deletion.deleteAfter).toBe(deletion.deleteAfter);
    // An export is still possible.
    expect((await api(owner, 'POST', '/exports')).status).toBe(202);
    await saas!.deleteFrom('job').where('tenant_id', '=', tenantId).where('status', '=', 'queued').execute();
    // Not due yet: nothing scheduled.
    expect((await scheduleLifecycle(saas!, runnerEnv())).deletions).toEqual([]);

    const cancelled = await api(owner, 'DELETE', '/deletion');
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ cancelled: true, status: 'active' });
    expect((await api(owner, 'DELETE', '/deletion')).status).toBe(409);
    const events = await saas!.selectFrom('console_event').select('action').where('tenant_id', '=', tenantId).orderBy('at').execute();
    expect(events.map((e) => e.action)).toEqual(['deletion-requested', 'deletion-cancelled']);
  }, 60_000);

  it('deletes the tenant once the date is past: route, objects, files, schema, rows', async () => {
    expect((await api(owner, 'POST', '/deletion', { confirm: SLUG })).status).toBe(200);
    await saas!.updateTable('tenant').set({ delete_after: new Date(Date.now() - 60_000).toISOString() }).where('id', '=', tenantId).execute();
    expect((await dueDeletions(saas!)).map((t) => t.slug)).toEqual([SLUG]);
    expect((await scheduleLifecycle(saas!, runnerEnv())).deletions).toEqual([SLUG]);
    // Queued once only.
    expect((await scheduleLifecycle(saas!, runnerEnv())).deletions).toEqual([]);
    expect(await schemaExists(tenantSchemaName(SLUG))).toBe(true);

    expect(await runJobsOnce(saas!, runnerEnv())).toEqual({ done: 1, failed: 0, cancelled: 0 });
    expect(await schemaExists(tenantSchemaName(SLUG))).toBe(false);
    expect([...store.objects.keys()].filter((k) => k.startsWith(`${SLUG}/`))).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'etl', SLUG))).toBe(false);
    const t = await saas!.selectFrom('tenant').selectAll().where('id', '=', tenantId).executeTakeFirstOrThrow();
    expect(t).toMatchObject({ status: 'deleted', label: 'Lifecycle tenant', mail_domains: [], onboarding: null, created_by: null, delete_requested_by: null });
    expect(t.slug).toMatch(/^deleted-[0-9a-f]{12}$/);
    for (const table of ['member', 'session', 'magic_link', 'tenant_host'] as const) {
      expect(await saas!.selectFrom(table).select('tenant_id').where('tenant_id', '=', tenantId).execute()).toEqual([]);
    }
    const jobs = await saas!.selectFrom('job').select(['type', 'status', 'created_by']).where('tenant_id', '=', tenantId).execute();
    expect(jobs).toEqual([{ type: 'tenant.delete', status: 'done', created_by: null }]);
    const last = await saas!.selectFrom('console_event').select(['actor', 'action']).where('tenant_id', '=', tenantId).orderBy('at', 'desc').executeTakeFirstOrThrow();
    expect(last).toEqual({ actor: 'runner', action: 'deleted' });
    // The host serves nothing any more, and the slug is free again.
    forgetHost(HOST);
    expect((await call(me.onRequest, { path: '/api/me', headers: { Cookie: owner } })).status).not.toBe(200);
    expect(await dueDeletions(saas!)).toEqual([]);
  }, 60_000);
});
