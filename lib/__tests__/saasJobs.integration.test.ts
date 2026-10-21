// Jobs of a tenant end to end (druid-internal docs/plan-druid-saas.md, lot 3): the alignment routes of the Functions
// queue jobs (409 when live, roles), the runner runs a people alignment as a child process (faked by a Node one-liner)
// and stores its cache, served at /<name>.json to the members; « Stop » ends a running child; the ETL build writes the
// druid-biblio configuration, runs the (fake) ETL per lab and uploads the dashboards to the asset store, served from
// the R2 binding; one running job per tenant; scheduled refreshes; stale jobs of a restarted runner.
// Needs DATABASE_URL (owner) and dbmate; no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StructureLevel } from '../../types';
import { enqueueJob, tenantSchemaName } from '../saas/controlPlane';
import { claimJob, recoverStaleJobs, runJobsOnce, scheduleRefreshes, type RunnerEnv } from '../saas/runner';
import { memoryAssetStore } from '../saas/r2';
import { createTenant, dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/saasJobs.integration.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();

const middleware = await import('../../functions/api/_middleware.js');
const me = await import('../../functions/api/me.js');
const v1 = await import('../../functions/api/v1/[[path]].js');
const authRequest = await import('../../functions/api/auth/request.js');
const authVerify = await import('../../functions/api/auth/verify.js');
const align = await import('../../functions/api/align/[[path]].js');
const idrefTrigger = await import('../../functions/api/sync-idref-trigger.js');
const idrefProgress = await import('../../functions/api/sync-idref-progress.js');
const structuresAlign = await import('../../functions/api/structures-align/[[path]].js');
const jobsApi = await import('../../functions/api/jobs/[[path]].js');
const assets = await import('../../functions/_lib/instanceAssets.js');
const { forgetHost } = await import('../../functions/_lib/saas.js');

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP || url;
const saas = url ? openSaasDb(url) : null;
const SLUG = 'zz-jobs-alpha';
const OTHER = 'zz-jobs-beta';
const HOST = (slug: string) => `${slug}.example.org`;
const OWNER = 'owner-jobs@example.org';
const VIEWER = 'viewer-jobs@example.org';
const store = memoryAssetStore();
/** R2 binding as the Function reads it. */
const SAAS_ASSETS = {
  get: async (key: string) => {
    const o = store.objects.get(key);
    return o ? { body: o.body, httpEtag: '"x"', writeHttpMetadata: (h: Headers) => h.set('Content-Type', o.contentType) } : null;
  },
};
const env = { SAAS_HYPERDRIVE: { connectionString: appUrl }, SAAS_DEV_LINKS: 'true', SAAS_ASSETS };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-jobs-'));

const call = async (handler: any, input: { host: string; path: string; method?: string; headers?: Record<string, string>; body?: string }) => {
  const request = new Request(`https://${input.host}${input.path}`, { method: input.method || 'GET', headers: input.headers, body: input.body });
  const context: any = { request, env, data: {}, params: {}, waitUntil: () => {}, next: () => handler(context) };
  return middleware.onRequest(context);
};
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];

// Fake alignment script: honours --progress=, writes the cache of its source, stops on SIGTERM when asked to linger.
const FAKE_ALIGN = `
const fs = require('fs');
const args = process.argv;
const prog = (args.find((a) => a.startsWith('--progress=')) || '').slice(11) || 'p.json';
const src = prog.replace('_align_progress.json', '');
const linger = process.env.FAKE_LINGER === '1';
fs.writeFileSync(prog, JSON.stringify({ running: true, total: 3, done: 1, mode: 'search' }));
const finish = (stopped) => {
  fs.writeFileSync(src === 'idref' ? 'idref_align_qualinka_cache.json' : src + '_align_cache.json', JSON.stringify({ u1: { mode: 'search', status: stopped ? 'error' : 'ok', schema: process.env.DRUID_DATABASE_SCHEMA, scopus: process.env.SCOPUS_API_KEY || '' } }));
  fs.writeFileSync(prog, JSON.stringify({ running: false, total: 3, done: stopped ? 1 : 3, mode: 'search', stopped }));
  process.exit(stopped ? 143 : 0);
};
if (!linger) setTimeout(() => finish(false), 300);
else { process.on('SIGTERM', () => finish(true)); setInterval(() => {}, 1000); }
`;
// Fake druid-biblio ETL: writes etl_status.json then a dashboard.json.gz in BIBLIO_DATA_DIR/<slug>/.
const FAKE_ETL = `
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const slug = process.argv[process.argv.length - 1];
const dir = path.join(process.env.BIBLIO_DATA_DIR, slug);
const cfg = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
if (slug === 'broken') { fs.writeFileSync(path.join(dir, 'etl_status.json'), JSON.stringify({ state: 'error', log: ['boom'] })); process.exit(1); }
fs.writeFileSync(path.join(dir, 'etl_status.json'), JSON.stringify({ state: 'running', log: ['Téléchargement OpenAlex…'] }));
fs.writeFileSync(path.join(dir, 'dashboard.json.gz'), zlib.gzipSync(JSON.stringify({ slug, config: cfg.split('\\n')[0] })));
fs.writeFileSync(path.join(dir, 'etl_status.json'), JSON.stringify({ state: 'done', log: ['Export du tableau de bord'] }));
`;
const fakeSpawn = ((cmd: string, args: string[], opts: any) => spawn(process.execPath, ['-e', args[0].endsWith('.cjs') ? FAKE_ALIGN : FAKE_ETL, '--', ...args.slice(args[0].endsWith('.cjs') ? 1 : 0)], opts)) as typeof spawn;

const runnerEnv = (over: Partial<RunnerEnv> = {}): RunnerEnv => ({
  ownerUrl: url!, appUrl, baseDomain: 'example.org', cloudflare: null, email: null, name: 'test-runner',
  druidRoot: tmp, workDir: path.join(tmp, 'work'), spawnImpl: fakeSpawn, assets: store, log: process.env.DEBUG_JOBS ? (l) => console.log(l) : () => {},
  etl: { dataDir: path.join(tmp, 'etl'), command: ['python3', '/opt/druid-biblio/scripts/run_structure_etl.py', '{slug}'] },
  ...over,
});

describe.skipIf(!url)('jobs of a tenant', () => {
  let tenantId = '';
  let owner = '';
  let viewer = '';
  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    for (const slug of [SLUG, OTHER]) {
      await saas!.deleteFrom('tenant').where('slug', '=', slug).execute();
      await dropTenantSchema(tenantSchemaName(slug), { ownerUrl: url! });
      forgetHost(HOST(slug));
    }
    ({ id: tenantId } = await createTenant(saas!, { slug: SLUG, label: 'Jobs tenant', hosts: [HOST(SLUG)], ownerEmail: OWNER }, { ownerUrl: url! }));
    await createTenant(saas!, { slug: OTHER, label: 'Other tenant', hosts: [HOST(OTHER)], ownerEmail: `owner-${OTHER}@example.org` }, { ownerUrl: url! });
    await saas!.insertInto('member').values({ tenant_id: tenantId, email: VIEWER, role: 'viewer', invited_by: OWNER }).execute();
    const signIn = async (email: string) => {
      const asked = await call(authRequest.onRequestPost, { host: HOST(SLUG), path: '/api/auth/request', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const { link } = await asked.json() as { link: string };
      const token = new URL(link).searchParams.get('token')!;
      const opened = await call(authVerify.onRequestPost, { host: HOST(SLUG), path: '/api/auth/verify', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
      return cookieOf(opened);
    };
    owner = await signIn(OWNER);
    viewer = await signIn(VIEWER);
    // Two labs: one with an RNSR (BSO) and an OpenAlex id, one that will fail in the fake ETL; a team is ignored.
    for (const body of [
      { level: StructureLevel.ENTITE, nature: 'LABO', type: 'UMR', acronym: 'LS2N', officialName: 'Lab one', localId: 'LS2N', rnsrId: '201722241F' },
      { level: StructureLevel.ENTITE, nature: 'LABO', type: 'UR', acronym: 'BROKEN', officialName: 'Lab two', localId: 'BROKEN', rnsrId: '200012345X' },
      { level: StructureLevel.EQUIPE, nature: 'LABO', type: '', acronym: 'TEAM', officialName: 'Team', localId: 'TEAM', parentStructure: 'LS2N' },
    ]) {
      const created = await call(v1.onRequest, { host: HOST(SLUG), path: '/api/v1/structures', method: 'POST', headers: { Cookie: owner, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      expect(created.status).toBe(201);
    }
  }, 180_000);
  afterAll(async () => {
    for (const slug of [SLUG, OTHER]) {
      await saas?.deleteFrom('tenant').where('slug', '=', slug).execute();
      await dropTenantSchema(tenantSchemaName(slug), { ownerUrl: url! });
    }
    await saas?.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('/api/me says the runs are available; the estimate answers; roles on the trigger', async () => {
    const who = await (await call(me.onRequest, { host: HOST(SLUG), path: '/api/me', headers: { Cookie: owner } })).json() as any;
    expect(who.capabilities).toMatchObject({ HAS_SERVER_JOBS: true, HAS_QUALINKA: true, HAS_STRUCTURE_IDS: true });
    const est = await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/estimate?mode=search', headers: { Cookie: owner } });
    expect(est.status).toBe(200);
    const body = await est.json() as any;
    expect(Object.keys(body.sources).sort()).toEqual(['hal', 'idref', 'openalex', 'orcid']);   // no Scopus key: no Scopus
    expect(body.sources.orcid).toEqual({ eligible: 0, pending: 0, unit: { requests: 3 } });
    expect((await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/orcid/trigger', headers: { Cookie: viewer } })).status).toBe(403);
    expect((await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/orcid/trigger' })).status).toBe(401);
    expect((await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/wos/trigger', headers: { Cookie: owner } })).status).toBe(404);
  });

  it('a people run is queued once (409 while live), run by the runner, its cache stored and served to members', async () => {
    const started = await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/orcid/trigger?mode=search&labo=ls2n', headers: { Cookie: owner } });
    expect(started.status).toBe(202);
    const job = (await started.json() as any).job;
    expect(job).toMatchObject({ type: 'people.align', key: 'people.align:orcid', status: 'queued', params: { source: 'orcid', labo: 'LS2N' } });
    const again = await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/orcid/trigger', headers: { Cookie: owner } });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'Alignment already running: ORCID', progress: { running: true, queued: true } });
    // Another source runs in parallel, the IdRef legacy route too.
    expect((await call(idrefTrigger.onRequestGet, { host: HOST(SLUG), path: '/api/sync-idref-trigger?mode=align', headers: { Cookie: owner } })).status).toBe(202);
    expect(await (await call(idrefProgress.onRequestGet, { host: HOST(SLUG), path: '/api/sync-idref-progress', headers: { Cookie: viewer } })).json()).toMatchObject({ running: true });
    const before = await (await call(assets.serveInstanceAsset, { host: HOST(SLUG), path: '/orcid_align_cache.json', headers: { Cookie: owner } })).json();
    expect(before).toEqual({});

    const out = await runJobsOnce(saas!, runnerEnv());
    expect(out).toEqual({ done: 2, failed: 0, cancelled: 0 });
    const progress = await (await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/orcid/progress', headers: { Cookie: viewer } })).json() as any;
    expect(progress).toMatchObject({ running: false, total: 3, done: 3, mode: 'search', queued: false });
    const row = await saas!.selectFrom('job').selectAll().where('id', '=', job.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('done');
    expect(row.runner).toBe('test-runner');
    expect(row.log).toContain('orcid_align_cache: 1 entries stored');
    // The script ran on the schema of the tenant, in its work folder.
    expect(fs.existsSync(path.join(tmp, 'work', SLUG, 'orcid_align_cache.json'))).toBe(true);
    const served = await call(assets.serveInstanceAsset, { host: HOST(SLUG), path: '/orcid_align_cache.json', headers: { Cookie: owner } });
    expect(served.status).toBe(200);
    expect(await served.json()).toEqual({ u1: { mode: 'search', status: 'ok', schema: tenantSchemaName(SLUG), scopus: '' } });
    expect((await call(assets.serveInstanceAsset, { host: HOST(SLUG), path: '/orcid_align_cache.json' })).status).toBe(401);
    expect((await call(assets.serveInstanceAsset, { host: HOST(OTHER), path: '/orcid_align_cache.json', headers: { Cookie: owner } })).status).toBe(401);
    const qualinka = await call(assets.serveInstanceAsset, { host: HOST(SLUG), path: '/idref_align_qualinka_cache.json', headers: { Cookie: viewer } });
    expect(Object.keys(await qualinka.json() as any)).toEqual(['u1']);
    // The estimate now sees the cache (no record: still 0, but the read works).
    expect((await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/estimate?mode=search', headers: { Cookie: owner } })).status).toBe(200);
  });

  it('« Stop » ends a running child: the job is cancelled, the progress says stopped', async () => {
    expect((await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/hal/trigger', headers: { Cookie: owner } })).status).toBe(202);
    const lingering = runnerEnv({ spawnImpl: ((cmd: string, args: string[], opts: any) => fakeSpawn(cmd, args, { ...opts, env: { ...opts.env, FAKE_LINGER: '1' } })) as typeof spawn });
    const running = runJobsOnce(saas!, lingering);
    for (let i = 0; i < 100; i++) {
      const p = await (await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/hal/progress', headers: { Cookie: owner } })).json() as any;
      if (p.running && !p.queued && p.total === 3) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const stop = await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/hal/stop', method: 'POST', headers: { Cookie: owner } });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ stopping: true, outcome: 'stopping' });
    expect(await runnerEnvResult(running)).toEqual({ done: 0, failed: 0, cancelled: 1 });
    const p = await (await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/hal/progress', headers: { Cookie: owner } })).json() as any;
    expect(p).toMatchObject({ running: false, stopped: true, done: 1 });
    expect((await call(align.onRequest, { host: HOST(SLUG), path: '/api/align/hal/stop', method: 'POST', headers: { Cookie: owner } })).status).toBe(404);
  }, 30_000);
  const runnerEnvResult = (p: Promise<{ done: number; failed: number; cancelled: number }>) => p;

  it('the ETL build configures the labs, runs them, uploads the dashboards, served from the R2 binding', async () => {
    const started = await call(jobsApi.onRequest, { host: HOST(SLUG), path: '/api/jobs', method: 'POST', headers: { Cookie: owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'etl.build', params: {} }) });
    expect(started.status).toBe(202);
    const job = (await started.json() as any).job;
    expect((await call(jobsApi.onRequest, { host: HOST(SLUG), path: '/api/jobs', method: 'POST', headers: { Cookie: owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'etl.build' }) })).status).toBe(409);
    expect((await call(jobsApi.onRequest, { host: HOST(SLUG), path: '/api/jobs', method: 'POST', headers: { Cookie: owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'people.align', params: { source: 'nope' } }) })).status).toBe(400);
    expect(await runJobsOnce(saas!, runnerEnv())).toEqual({ done: 1, failed: 0, cancelled: 0 });
    const row = await saas!.selectFrom('job').selectAll().where('id', '=', job.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('done');
    expect(row.progress).toMatchObject({ step: 'done', built: 1, failed: 1, indexed: 1 });
    expect(row.log).toContain('broken: ETL failed (code 1)');
    const yaml = fs.readFileSync(path.join(tmp, 'etl', SLUG, 'ls2n', 'config.yaml'), 'utf8');
    expect(yaml).toContain('acronym: LS2N\n');
    expect(yaml).toContain('bso-publications-latest_201722241F_enriched.jsonl.gz');
    expect(yaml).toContain('year_from: 2024\n');   // trial plan: 3 years
    expect([...store.objects.keys()].sort()).toEqual([`${SLUG}/dashboard-data/index.json`, `${SLUG}/dashboard-data/ls2n/dashboard.json.gz`]);
    expect(JSON.parse(new TextDecoder().decode(store.objects.get(`${SLUG}/dashboard-data/index.json`)!.body))).toEqual({ slugs: ['ls2n'], groups: [], tabsHidden: { ls2n: ['benchmark'] } });
    const served = await call(assets.serveInstanceAsset, { host: HOST(SLUG), path: '/dashboard-data/ls2n/dashboard.json.gz', headers: { Cookie: viewer } });
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('application/gzip');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(store.objects.get(`${SLUG}/dashboard-data/ls2n/dashboard.json.gz`)!.body);
    expect((await call(assets.serveInstanceAsset, { host: HOST(SLUG), path: '/dashboard-data/broken/dashboard.json.gz', headers: { Cookie: viewer } })).status).toBe(404);
    expect((await call(assets.serveInstanceAsset, { host: HOST(OTHER), path: '/dashboard-data/ls2n/dashboard.json.gz', headers: { Cookie: viewer } })).status).toBe(401);
    // Jobs API: list, one, cancel of a finished job is 409.
    const list = await (await call(jobsApi.onRequest, { host: HOST(SLUG), path: '/api/jobs?limit=10', headers: { Cookie: viewer } })).json() as any;
    expect(list.jobs.map((j: any) => j.type)).toEqual(['etl.build', 'people.align', 'people.align', 'people.align']);
    expect((await (await call(jobsApi.onRequest, { host: HOST(SLUG), path: `/api/jobs/${job.id}`, headers: { Cookie: viewer } })).json() as any).job.status).toBe('done');
    expect((await call(jobsApi.onRequest, { host: HOST(SLUG), path: `/api/jobs/${job.id}/cancel`, method: 'POST', headers: { Cookie: owner } })).status).toBe(409);
    expect((await call(jobsApi.onRequest, { host: HOST(SLUG), path: `/api/jobs/${job.id}/cancel`, method: 'POST', headers: { Cookie: viewer } })).status).toBe(403);
    expect((await call(jobsApi.onRequest, { host: HOST(OTHER), path: `/api/jobs/${job.id}`, headers: { Cookie: owner } })).status).toBe(401);
  }, 30_000);

  it('structures.align route queues a job; one running job per tenant; stale jobs of a restarted runner', async () => {
    const started = await call(structuresAlign.onRequest, { host: HOST(SLUG), path: '/api/structures-align/trigger?mode=verify&types=ror', headers: { Cookie: owner } });
    expect(started.status).toBe(202);
    expect((await started.json() as any).job.params).toEqual({ mode: 'verify', types: ['ror'], force: false, thenEtl: false });
    expect(await (await call(structuresAlign.onRequest, { host: HOST(SLUG), path: '/api/structures-align/progress', headers: { Cookie: viewer } })).json()).toMatchObject({ running: true, queued: true });
    const other = await saas!.selectFrom('tenant').select('id').where('slug', '=', OTHER).executeTakeFirstOrThrow();
    await enqueueJob(saas!, { tenantId: tenantId, type: 'etl.build', params: {}, key: 'etl.build' });
    await enqueueJob(saas!, { tenantId: other.id, type: 'etl.build', params: {}, key: 'etl.build' });
    const first = await claimJob(saas!, ['structures.align', 'etl.build'], 'r1');
    expect(first?.type).toBe('structures.align');
    const second = await claimJob(saas!, ['structures.align', 'etl.build'], 'r1');
    expect(second?.tenant_id).toBe(other.id);          // the first tenant already has a running job
    expect(await claimJob(saas!, ['structures.align', 'etl.build'], 'r1')).toBeNull();
    expect(await recoverStaleJobs(saas!, 'r1')).toBe(2);
    expect(await recoverStaleJobs(saas!, 'r1')).toBe(0);
    const stale = await saas!.selectFrom('job').select(['status', 'log']).where('id', '=', first!.id).executeTakeFirstOrThrow();
    expect(stale).toEqual({ status: 'failed', log: 'failed: runner restarted' });
    // The queued etl.build of the first tenant is run now (fake ETL again).
    expect(await runJobsOnce(saas!, runnerEnv())).toEqual({ done: 1, failed: 0, cancelled: 0 });
  }, 30_000);

  it('scheduled refreshes: inside the window, once per period, failed builds retried after a day', async () => {
    const env2 = runnerEnv();
    expect(await scheduleRefreshes(saas!, env2, { now: new Date('2026-10-21T12:00:00Z') })).toEqual([]);           // outside the window
    expect(await scheduleRefreshes(saas!, env2, { now: new Date('2026-10-21T22:00:00Z') })).toEqual([]);           // built today (both tenants)
    await saas!.updateTable('job').set({ created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }).where('type', '=', 'etl.build').execute();
    const queued = await scheduleRefreshes(saas!, env2, { now: new Date('2026-10-21T22:00:00Z'), batch: 1 });
    expect(queued).toEqual([SLUG]);
    expect(await scheduleRefreshes(saas!, env2, { ignoreWindow: true })).toEqual([OTHER]);                         // the first one is queued now
    expect(await scheduleRefreshes(saas!, env2, { ignoreWindow: true })).toEqual([]);
    await saas!.deleteFrom('job').where('type', '=', 'etl.build').where('status', '=', 'queued').execute();
  });
});
