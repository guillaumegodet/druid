/**
 * @file runner.ts
 * @description Jobs of a multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lots 2 d and 3): the
 * Functions enqueue rows in `saas.job`, this runner (a Node process next to the database, never a Worker) claims them
 * (`FOR UPDATE SKIP LOCKED`, one running job per tenant) and runs the handler of their type:
 *  - `tenant.provision` (lot 2): schema migrated, directory seeded, route of the host, tenant active, « ready » e-mail;
 *  - `structures.align` (lot 4): the structure alignment, in process;
 *  - `people.align` (lot 3 b): one of scripts/sync_*.cjs as a child process on the schema of the tenant
 *    (DRUID_DATABASE_SCHEMA), its cache stored in the tenant's `align_cache` table once the run is over;
 *  - `etl.build` (lot 3 c): the druid-biblio configuration of every lab, the ETL as a child process per lab, the
 *    dashboards uploaded to the asset store (R2).
 * A « Stop » of the UI (job.cancel_requested_at) ends the child process (SIGTERM: the alignment scripts save what they
 * have) and the job ends `cancelled`. Scheduled refreshes (lot 3 d) and the alerts on repeated failures (lot 3 e) are
 * here too.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import pg from 'pg';
import { createDbWith, type Db } from '../db/core';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { enqueueJob, primaryHost, type Job, type Plan, type SaasDb, type Tenant } from './controlPlane';
import { runStructureAlignment } from '../structures/alignRun';
import { ALIGNED_STRUCTURE_ID_TYPES, isStructureIdType, type StructureIdType } from '../structures/identifiers';
import { createRegistryClient } from '../structures/registryClient';
import { sendEmail, sendTenantReady, type EmailEnv } from './email';
import { OnboardingPayload, seedTenantDirectory, tenantHostOf } from './onboarding';
import { migrateTenantSchema, setTenantStatus, type TenantDbOptions } from './tenantDb';
import { EtlBuildParams, PeopleAlignParams, StructuresAlignParams } from './jobs';
import { cacheNamesOfSource, writeAlignCache } from './alignCache';
import { readTenantSecrets } from './secrets';
import { dashboardIndexOf, etlLabsOf, yamlOf } from './etlConfig';
import type { AssetStore } from './r2';

export interface CloudflareRouteEnv {
  /** API token with Workers Routes: Edit on the zone. */
  apiToken: string;
  zoneId: string;
  /** Name of the Worker serving the tenants (druid-saas). */
  workerName: string;
}

export interface EtlEnv {
  /** Folder of the data of the tenants: `<dataDir>/<tenant slug>/` is the BIBLIO_DATA_DIR of a run. */
  dataDir: string;
  /** Command of one lab, `{slug}` and `{dataDir}` replaced (e.g. `python3 /opt/druid-biblio/scripts/run_structure_etl.py {slug}`). */
  command: string[];
  /** Per lab (default 4 h). */
  timeoutMs?: number;
}

export interface RunnerEnv {
  /** Owner connection string (migrations) — the runner sits next to the database. */
  ownerUrl: string;
  /** Application connection string for the seeding and the scripts (default: ownerUrl). */
  appUrl?: string;
  /** Base domain of the tenants (`dirladata.fr`): the host of a new tenant is `<slug>.<base>`. */
  baseDomain: string;
  cloudflare?: CloudflareRouteEnv | null;
  email?: EmailEnv | null;
  dbmateBin?: string;
  migrationsDir?: string;
  log?: (line: string) => void;
  /** OpenAlex key of the deployment (or a mailto) for the structure alignment and the scripts. */
  openalexApiKey?: string | null;
  openalexMailto?: string | null;
  /** Name of this runner process (job.runner; stale jobs of a restarted runner are failed). */
  name?: string;
  /** Checkout of Druid holding scripts/ and server-api.cjs (default: the working directory). */
  druidRoot?: string;
  /** Folder of the per-tenant files of the alignment scripts (caches, progress, logs): `<workDir>/<slug>/`. */
  workDir?: string;
  nodeBin?: string;
  /** Key of the tenant secrets (lib/saas/secrets.ts), handed to the scripts as environment variables. */
  secretsKey?: string | null;
  etl?: EtlEnv | null;
  /** Where the dashboards go (lib/saas/r2.ts); null = kept on disk only. */
  assets?: AssetStore | null;
  /** Ops address told of repeated failures (lot 3 e). */
  alertEmail?: string | null;
  /** Minimum MemAvailable (MiB) to claim a job; 0 = no check. */
  memoryFloorMb?: number;
  /** Night window (UTC hours, start → end) of the scheduled refreshes; default 20 → 6. */
  nightWindow?: [number, number];
  /** Overrides for the tests (no network, no real child process). */
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof nodeSpawn;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;
export interface JobContext {
  saas: SaasDb;
  env: RunnerEnv;
  tenant: Tenant;
  plan: Plan | null;
  /** Progress visible to the user (the portal and the alignment pages poll it). */
  progress: (step: string, pct: number, extra?: Record<string, unknown>) => Promise<void>;
  log: (line: string) => void;
  /** « Stop » asked by the UI. */
  isCancelRequested: () => Promise<boolean>;
}

/** Thrown by a handler whose child process was stopped on request: the job ends `cancelled`, not `failed`. */
export class JobCancelled extends Error {
  constructor(message = 'cancelled') { super(message); this.name = 'JobCancelled'; }
}

const tenantDbOf = (env: RunnerEnv, tenant: Tenant): Db =>
  createDbWith(pg, { connectionString: env.appUrl || env.ownerUrl, max: 2, allowExitOnIdle: true, schema: tenant.schema_name });

/** Route `<host>/*` → the Worker, through the Cloudflare API (idempotent: an existing route is kept). */
export const ensureWorkerRoute = async (cf: CloudflareRouteEnv, host: string, fetchImpl: typeof fetch = fetch): Promise<'created' | 'exists'> => {
  const base = `https://api.cloudflare.com/client/v4/zones/${cf.zoneId}/workers/routes`;
  const headers = { Authorization: `Bearer ${cf.apiToken}`, 'Content-Type': 'application/json' };
  const pattern = `${host}/*`;
  const listed = await fetchImpl(base, { headers });
  const list = (await listed.json()) as { success: boolean; result?: { pattern: string }[]; errors?: unknown[] };
  if (!list.success) throw new Error(`Cloudflare routes: ${JSON.stringify(list.errors)}`);
  if ((list.result || []).some((r) => r.pattern === pattern)) return 'exists';
  const created = await fetchImpl(base, { method: 'POST', headers, body: JSON.stringify({ pattern, script: cf.workerName }) });
  const out = (await created.json()) as { success: boolean; errors?: unknown[] };
  if (!out.success) throw new Error(`Cloudflare route ${pattern}: ${JSON.stringify(out.errors)}`);
  return 'created';
};

/** `tenant.provision`: the schema, the directory, the route, the status, the e-mail. */
export const provisionTenant: JobHandler = async (job, { saas, env, tenant, progress, log }) => {
  const opts: TenantDbOptions = { ownerUrl: env.ownerUrl, dbmateBin: env.dbmateBin, migrationsDir: env.migrationsDir, log };
  await progress('schema', 10);
  await migrateTenantSchema(tenant.schema_name, opts);
  await progress('directory', 40);
  const parsed = OnboardingPayload.safeParse(tenant.onboarding);
  if (parsed.success) {
    const db = tenantDbOf(env, tenant);
    try {
      const report = await seedTenantDirectory(db, parsed.data, 'onboarding');
      log(`directory: ${report.institution} institution, ${report.structures} structures, ${report.skipped.length} skipped`);
      for (const s of report.skipped) log(`  skipped ${s.acronym}: ${s.reason}`);
      await progress('directory', 60, { structures: report.structures, skipped: report.skipped.length });
    } finally {
      await db.destroy();
    }
  } else {
    log(`no onboarding payload (${parsed.error.issues.length} issue(s)): empty directory`);
  }
  await progress('route', 70);
  const host = (await primaryHost(saas, tenant.id)) || tenantHostOf(tenant.slug, env.baseDomain);
  if (env.cloudflare) {
    const r = await ensureWorkerRoute(env.cloudflare, host, env.fetchImpl);
    log(`route ${host}/*: ${r}`);
  } else {
    log(`route ${host}/*: no Cloudflare configuration, skipped`);
  }
  await setTenantStatus(saas, tenant.id, 'active');
  await progress('ready', 100, { host });
  const owner = await saas.selectFrom('member').select('email').where('tenant_id', '=', tenant.id).where('role', '=', 'owner').orderBy('created_at').executeTakeFirst();
  if (owner && env.email?.RESEND_API_KEY) {
    await sendTenantReady(env.email, { to: owner.email, label: tenant.label, loginUrl: `https://${host}/auth/login` }).catch((err) => log(`e-mail failed: ${err.message}`));
  }
  // The identifiers of the seeded labs (HAL, ROR, OpenAlex…) follow from their RNSR: queued, not awaited; the first
  // dashboards are built once they are known (thenEtl).
  await enqueueJob(saas, { tenantId: tenant.id, type: 'structures.align', params: { mode: 'search', thenEtl: true }, createdBy: job.created_by ?? null });
};

/**
 * `structures.align` (druid-internal docs/plan-druid-saas.md, lot 4 e): the structure alignment of a tenant,
 * `params` = lib/saas/jobs.ts StructuresAlignParams.
 */
export const alignStructures: JobHandler = async (job, { saas, env, tenant, progress, log }) => {
  const params = StructuresAlignParams.parse(job.params || {});
  const types = params.types ? (params.types as unknown[]).filter(isStructureIdType) as StructureIdType[] : ALIGNED_STRUCTURE_ID_TYPES;
  const db = tenantDbOf(env, tenant);
  try {
    const registry = createRegistryClient({ openalexApiKey: env.openalexApiKey ?? null, openalexMailto: env.openalexMailto ?? null, fetch: env.fetchImpl as any, log: (l) => log(`registry: ${l}`) });
    const report = await runStructureAlignment(db, registry, {
      mode: params.mode, types, only: params.only, force: params.force, limit: params.limit || undefined, log,
      onProgress: ({ total, done }) => { void progress('structures', total ? Math.round((done / total) * 100) : 100, { total, done, mode: params.mode }); },
    });
    log(`${report.done}/${report.total} structure(s): ${report.candidates} candidate(s), ${report.conflicts} conflict(s), ${report.verificationIssues} verification issue(s), ${report.errors} error(s)`);
    await progress('done', 100, { ...report, mode: params.mode });
  } finally {
    await db.destroy();
  }
  if (params.thenEtl) await enqueueJob(saas, { tenantId: tenant.id, type: 'etl.build', params: {}, createdBy: job.created_by ?? null });
};

// ── Child processes ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Environment handed to a child: the runner's own, minus its secrets and database URLs. */
export const childEnvOf = (overrides: Record<string, string | undefined>, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(SAAS_|DATABASE_URL|RESEND_API_KEY|CLOUDFLARE_|CF_)/.test(k)) continue;
    out[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined && v !== '') out[k] = v;
  return out;
};

export interface ChildRun {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Output file (appended): the whole output of the child, its tail goes to the job log. */
  outputFile: string;
  /** JSON file the child writes its progress to (read every `pollMs`). */
  progressFile?: string;
  onProgress?: (p: Record<string, unknown>) => void;
  pollMs?: number;
  timeoutMs?: number;
  /** Delay between SIGTERM and SIGKILL once a stop was asked (default 60 s). */
  killAfterMs?: number;
}
export interface ChildResult { code: number | null; signal: NodeJS.Signals | null; cancelled: boolean; timedOut: boolean; progress: Record<string, unknown> | null }

const readJson = (file: string): Record<string, unknown> | null => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const tailOf = (file: string, lines = 30): string[] => {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-lines); } catch { return []; }
};

/** Runs a child process, relays its progress file, stops it when asked (SIGTERM then SIGKILL) or after `timeoutMs`. */
export const runChild = async (run: ChildRun, ctx: { log: (l: string) => void; isCancelRequested: () => Promise<boolean>; spawnImpl?: typeof nodeSpawn }): Promise<ChildResult> => {
  const spawn = ctx.spawnImpl || nodeSpawn;
  const out = fs.openSync(run.outputFile, 'a');
  let child: ChildProcess;
  try {
    child = spawn(run.command, run.args, { cwd: run.cwd, env: run.env, stdio: ['ignore', out, out] });
  } catch (err) {
    fs.closeSync(out);
    throw err;
  }
  ctx.log(`child ${child.pid ?? '?'}: ${[run.command, ...run.args].map((a) => (a.length > 80 ? `${a.slice(0, 77)}…` : a)).join(' ')}`);
  const pollMs = run.pollMs ?? 2000;
  const started = Date.now();
  let cancelled = false;
  let timedOut = false;
  let killTimer: NodeJS.Timeout | null = null;
  let lastProgress: string | null = null;
  const stop = (why: string) => {
    if (killTimer) return;
    ctx.log(`${why}: SIGTERM sent to ${child.pid ?? '?'}`);
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, run.killAfterMs ?? 60_000);
  };
  const relay = () => {
    if (!run.progressFile || !run.onProgress) return;
    const p = readJson(run.progressFile);
    if (!p) return;
    const key = JSON.stringify(p);
    if (key === lastProgress) return;
    lastProgress = key;
    run.onProgress(p);
  };
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setInterval(async () => {
      relay();
      try {
        if (!cancelled && await ctx.isCancelRequested()) { cancelled = true; stop('stop requested'); }
      } catch (err) { ctx.log(`cancel check failed: ${err instanceof Error ? err.message : String(err)}`); }
      if (run.timeoutMs && !timedOut && Date.now() - started > run.timeoutMs) { timedOut = true; stop(`timeout after ${Math.round(run.timeoutMs / 60000)} min`); }
    }, pollMs);
    child.on('error', (err) => { clearInterval(timer); reject(err); });
    child.on('exit', (code, signal) => { clearInterval(timer); resolve({ code, signal }); });
  }).finally(() => { if (killTimer) clearTimeout(killTimer); fs.closeSync(out); });
  relay();
  for (const line of tailOf(run.outputFile)) ctx.log(`  ${line}`);
  return { ...result, cancelled, timedOut, progress: run.progressFile ? readJson(run.progressFile) : null };
};

const workDirOf = (env: RunnerEnv, tenant: Tenant): string => {
  const dir = path.join(env.workDir || path.join(env.druidRoot || process.cwd(), 'saas-work'), tenant.slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * `people.align` (lot 3 b): one alignment script (scripts/sync_*.cjs — IdRef = the Qualinka engine) on the schema of
 * the tenant, in `<workDir>/<slug>/` where its cache and progress files live between runs; the caches are copied to the
 * tenant's `align_cache` table at the end (the Functions serve and read them). The keys of the establishment (Scopus,
 * its own OpenAlex key) come from its secrets.
 */
export const alignPeople: JobHandler = async (job, ctx) => {
  const { env, tenant, log, saas } = ctx;
  const params = PeopleAlignParams.parse(job.params || {});
  const root = env.druidRoot || process.cwd();
  const cwd = workDirOf(env, tenant);
  const progressFile = `${params.source}_align_progress.json`;
  const script = params.source === 'idref' ? 'scripts/sync_idref_qualinka.cjs' : `scripts/sync_${params.source}.cjs`;
  const args = [path.join(root, script), `--mode=${params.mode}`, `--progress=${progressFile}`];
  if (params.source === 'idref') args.push('--labos');
  if (params.labo) args.push(`--labo=${params.labo}`);
  if (params.group) args.push(`--group=${params.group}`);
  if (params.force) args.push('--force');
  if (params.limit > 0) args.push(`--limit=${params.limit}`);
  if (params.record > 0) args.push(`--record=${params.record}`);
  const secrets = await readTenantSecrets(saas, tenant.id, env.secretsKey, log);
  if (params.source === 'scopus' && !secrets.SCOPUS_API_KEY) throw new Error('Scopus alignment needs the Elsevier key of the establishment (SCOPUS_API_KEY)');
  const settings = (tenant.settings || {}) as Record<string, unknown>;
  const childEnv = childEnvOf({
    DRUID_STORAGE: 'postgres', DRUID_DATABASE_URL: env.appUrl || env.ownerUrl, DRUID_DATABASE_SCHEMA: tenant.schema_name,
    OPENALEX_API_KEY: env.openalexApiKey || undefined, OPENALEX_MAILTO: (typeof settings.openalexMailto === 'string' && settings.openalexMailto) || env.openalexMailto || undefined,
    ...secrets,
  });
  fs.rmSync(path.join(cwd, progressFile), { force: true });
  await ctx.progress('running', 0, { mode: params.mode, source: params.source, total: 0, done: 0 });
  const result = await runChild({
    command: env.nodeBin || process.execPath, args, cwd, env: childEnv, outputFile: path.join(cwd, `${params.source}_align.log`),
    progressFile: path.join(cwd, progressFile), timeoutMs: 12 * 3600_000,
    onProgress: (p) => { const total = Number(p.total || 0); const done = Number(p.done || 0); void ctx.progress('running', total ? Math.round((done / total) * 100) : 0, { ...p, mode: params.mode, source: params.source }); },
  }, { log, isCancelRequested: ctx.isCancelRequested, spawnImpl: env.spawnImpl });
  const db = tenantDbOf(env, tenant);
  try {
    for (const name of cacheNamesOfSource(params.source)) {
      const data = readJson(path.join(cwd, `${name}.json`));
      if (!data) { log(`no ${name}.json written`); continue; }
      await writeAlignCache(db, name, data);
      log(`${name}: ${Object.keys(data).length} entries stored`);
    }
  } finally {
    await db.destroy();
  }
  const final: Record<string, unknown> = { ...(result.progress || {}), mode: params.mode, source: params.source, running: false };
  const total = Number(final.total || 0); const done = Number(final.done || 0);
  await ctx.progress('done', total ? Math.round((done / total) * 100) : 100, final);
  if (result.cancelled) throw new JobCancelled('stopped by the user');
  if (result.timedOut) throw new Error('script stopped: time limit reached');
  if (result.code !== 0) throw new Error(`script exited with ${result.signal ? `signal ${result.signal}` : `code ${result.code}`}`);
};

/**
 * `etl.build` (lot 3 c): the druid-biblio configuration of every lab (from the directory and the identifiers the
 * structure alignment confirmed), the ETL of each lab as a child process (BIBLIO_DATA_DIR = the tenant's folder), the
 * dashboards uploaded to the asset store under `<slug>/dashboard-data/`. A lab that fails does not stop the others.
 */
export const buildEtl: JobHandler = async (job, ctx) => {
  const { env, tenant, plan, log, saas } = ctx;
  const params = EtlBuildParams.parse(job.params || {});
  if (!env.etl) throw new Error('ETL not configured on this runner (SAAS_ETL_DATA_DIR / SAAS_ETL_COMMAND)');
  const settings = (tenant.settings || {}) as Record<string, unknown>;
  const mailto = (typeof settings.openalexMailto === 'string' && settings.openalexMailto) || env.openalexMailto || null;
  const db = tenantDbOf(env, tenant);
  let structures;
  try { structures = (await createPgDirectoryRepository({ db }).structures()).items; } finally { await db.destroy(); }
  const report = etlLabsOf(structures, { historyYears: plan?.history_years ?? null, mailto });
  for (const s of report.skipped) log(`skipped ${s.acronym}: ${s.reason}`);
  const labs = params.slugs ? report.labs.filter((l) => params.slugs!.includes(l.slug)) : report.labs;
  const dataDir = path.join(env.etl.dataDir, tenant.slug);
  fs.mkdirSync(dataDir, { recursive: true });
  for (const lab of labs) {
    fs.mkdirSync(path.join(dataDir, lab.slug), { recursive: true });
    fs.writeFileSync(path.join(dataDir, lab.slug, 'config.yaml'), yamlOf(lab.config));
  }
  log(`${labs.length} lab(s) configured in ${dataDir}${params.slugs ? ` (of ${report.labs.length})` : ''}`);
  if (!labs.length) { await ctx.progress('done', 100, { labs: 0, built: 0, failed: 0 }); return; }
  const secrets = await readTenantSecrets(saas, tenant.id, env.secretsKey, log);
  const childEnv = childEnvOf({ BIBLIO_DATA_DIR: dataDir, OPENALEX_API_KEY: secrets.OPENALEX_API_KEY || env.openalexApiKey || undefined, ILAAS_API_KEY: secrets.ILAAS_API_KEY });
  const built: string[] = [];
  const failed: string[] = [];
  for (const [i, lab] of labs.entries()) {
    await ctx.progress('etl', Math.round((i / labs.length) * 100), { total: labs.length, done: i, lab: lab.slug, built: built.length, failed: failed.length });
    const cmd = env.etl.command.map((a) => a.replace(/\{slug\}/g, lab.slug).replace(/\{dataDir\}/g, dataDir));
    const statusFile = path.join(dataDir, lab.slug, 'etl_status.json');
    fs.rmSync(statusFile, { force: true });
    const result = await runChild({
      command: cmd[0], args: cmd.slice(1), cwd: dataDir, env: childEnv, outputFile: path.join(dataDir, lab.slug, 'etl_run.log'),
      progressFile: statusFile, timeoutMs: env.etl.timeoutMs ?? 4 * 3600_000,
      onProgress: (p) => { const lines = Array.isArray(p.log) ? p.log : []; void ctx.progress('etl', Math.round((i / labs.length) * 100), { total: labs.length, done: i, lab: lab.slug, step: String(lines[lines.length - 1] || ''), built: built.length, failed: failed.length }); },
    }, { log, isCancelRequested: ctx.isCancelRequested, spawnImpl: env.spawnImpl });
    if (result.cancelled) throw new JobCancelled(`stopped by the user after ${built.length} lab(s)`);
    if (result.code !== 0 || result.timedOut) { failed.push(lab.slug); log(`${lab.slug}: ETL failed (${result.timedOut ? 'timeout' : `code ${result.code}`})`); continue; }
    let uploaded = 0;
    for (const file of ['dashboard.json.gz', 'dashboard.public.json.gz']) {
      const p = path.join(dataDir, lab.slug, file);
      if (!fs.existsSync(p)) continue;
      if (env.assets) await env.assets.put(`${tenant.slug}/dashboard-data/${lab.slug}/${file}`, new Uint8Array(fs.readFileSync(p)), 'application/gzip');
      uploaded++;
    }
    if (!uploaded) { failed.push(lab.slug); log(`${lab.slug}: ETL ended without a dashboard.json.gz`); continue; }
    built.push(lab.slug);
    log(`${lab.slug}: ${uploaded} file(s)${env.assets ? ' uploaded' : ' (no asset store: kept on disk)'}`);
  }
  // The index lists every lab whose dashboard exists on disk (this run and the previous ones).
  const indexed = report.labs.filter((l) => fs.existsSync(path.join(dataDir, l.slug, 'dashboard.json.gz')));
  if (env.assets) await env.assets.put(`${tenant.slug}/dashboard-data/index.json`, new TextEncoder().encode(JSON.stringify(dashboardIndexOf(indexed))), 'application/json');
  await ctx.progress('done', 100, { total: labs.length, done: labs.length, built: built.length, failed: failed.length, indexed: indexed.length });
  if (failed.length && !built.length) throw new Error(`every lab failed: ${failed.join(', ')}`);
  if (failed.length) log(`${failed.length} lab(s) failed: ${failed.join(', ')}`);
};

export const HANDLERS: Record<string, JobHandler> = {
  'tenant.provision': provisionTenant, 'structures.align': alignStructures, 'people.align': alignPeople, 'etl.build': buildEtl,
};

// ── Claiming and running ──────────────────────────────────────────────────────────────────────────────────────────────
/** Claims the oldest queued job of a tenant with no running job (one runner at a time per row), or null. */
export const claimJob = async (saas: SaasDb, types: string[], runner = 'runner'): Promise<Job | null> => {
  const row = await sql<Job>`
    UPDATE saas.job SET status = 'running', started_at = now(), attempts = attempts + 1, runner = ${runner}
    WHERE id = (
      SELECT j.id FROM saas.job j
      WHERE j.status = 'queued' AND j.type = ANY(${types})
        AND NOT EXISTS (SELECT 1 FROM saas.job r WHERE r.tenant_id = j.tenant_id AND r.status = 'running')
      ORDER BY j.created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING *`.execute(saas);
  return row.rows[0] || null;
};

/** Jobs left `running` by a previous life of this runner (crash, restart): failed, so that their tenant is not blocked. */
export const recoverStaleJobs = async (saas: SaasDb, runner: string): Promise<number> => {
  const rows = await saas.updateTable('job').set({ status: 'failed', finished_at: sql<string>`now()`, log: sql<string>`concat_ws(E'\\n', log, 'failed: runner restarted')` })
    .where('status', '=', 'running').where('runner', '=', runner).returning('id').execute();
  return rows.length;
};

const appendLog = async (saas: SaasDb, id: string, line: string) => {
  await sql`UPDATE saas.job SET log = concat_ws(E'\\n', log, ${line}::text) WHERE id = ${id}::uuid`.execute(saas);
};

/** Two failures in a row of the same key (this one included) → the ops address is told (lot 3 e). */
export const alertOnRepeatedFailure = async (saas: SaasDb, env: RunnerEnv, job: Job, tenant: Tenant | null, message: string): Promise<boolean> => {
  if (!env.alertEmail || !env.email?.RESEND_API_KEY) return false;
  const previous = await saas.selectFrom('job').select('status').where('tenant_id', '=', job.tenant_id).where('key', '=', job.key)
    .where('id', '<>', job.id).where('created_at', '<', job.created_at).orderBy('created_at', 'desc').executeTakeFirst();
  if (previous?.status !== 'failed') return false;
  const subject = `[Druid SaaS] ${tenant?.slug || job.tenant_id}: ${job.type} failed twice`;
  const text = `Tenant ${tenant?.label || ''} (${tenant?.slug || job.tenant_id})\nJob ${job.id} (${job.type}, key ${job.key}) failed twice in a row.\n\n${message}\n`;
  await sendEmail(env.email, { to: env.alertEmail, subject, text, html: `<pre>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre>` })
    .catch((err) => (env.log || (() => {}))(`alert e-mail failed: ${err instanceof Error ? err.message : String(err)}`));
  return true;
};

/** Runs one claimed job: progress and log on the row, `done`, `cancelled` or `failed` at the end. */
export const runJob = async (saas: SaasDb, env: RunnerEnv, job: Job, handlers = HANDLERS): Promise<'done' | 'failed' | 'cancelled'> => {
  // The log lines are written in order and all flushed before the final status.
  let pending: Promise<void> = Promise.resolve();
  const log = (line: string) => {
    (env.log || (() => {}))(`job ${job.id} (${job.type}): ${line}`);
    pending = pending.then(() => appendLog(saas, job.id, line)).catch((err) => { (env.log || (() => {}))(`log write failed: ${err instanceof Error ? err.message : String(err)}`); });
  };
  const progress = async (step: string, pct: number, extra: Record<string, unknown> = {}) => {
    await saas.updateTable('job').set({ progress: { ...extra, step, pct } }).where('id', '=', job.id).execute();
  };
  const isCancelRequested = async () => {
    const row = await saas.selectFrom('job').select('cancel_requested_at').where('id', '=', job.id).executeTakeFirst();
    return !!row?.cancel_requested_at;
  };
  let tenant: Tenant | null = null;
  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`no handler for job type ${job.type}`);
    tenant = (await saas.selectFrom('tenant').selectAll().where('id', '=', job.tenant_id).executeTakeFirst()) || null;
    if (!tenant) throw new Error('tenant not found');
    const plan = (await saas.selectFrom('plan').selectAll().where('code', '=', tenant.plan_code).executeTakeFirst()) || null;
    await handler(job, { saas, env, tenant, plan, progress, log, isCancelRequested });
    await pending;
    await saas.updateTable('job').set({ status: 'done', finished_at: sql<string>`now()` }).where('id', '=', job.id).execute();
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cancelled = err instanceof JobCancelled;
    await pending;
    await appendLog(saas, job.id, `${cancelled ? 'cancelled' : 'failed'}: ${message}`).catch(() => {});
    await saas.updateTable('job').set({ status: cancelled ? 'cancelled' : 'failed', finished_at: sql<string>`now()` }).where('id', '=', job.id).execute();
    (env.log || (() => {}))(`job ${job.id} (${job.type}) ${cancelled ? 'cancelled' : 'failed'}: ${message}`);
    if (!cancelled) await alertOnRepeatedFailure(saas, env, job, tenant, message).catch(() => {});
    return cancelled ? 'cancelled' : 'failed';
  }
};

/** Processes the queued jobs of the handled types until none is left; returns what was run. */
export const runJobsOnce = async (saas: SaasDb, env: RunnerEnv, handlers = HANDLERS): Promise<{ done: number; failed: number; cancelled: number }> => {
  const out = { done: 0, failed: 0, cancelled: 0 };
  for (;;) {
    const job = await claimJob(saas, Object.keys(handlers), env.name || 'runner');
    if (!job) return out;
    out[await runJob(saas, env, job, handlers)]++;
  }
};

// ── Scheduled refreshes (lot 3 d) ─────────────────────────────────────────────────────────────────────────────────────
export const REFRESH_DAYS: Record<string, number> = { monthly: 30, weekly: 7, daily: 1 };
/** `now` falls in the window `[start, end)` of UTC hours (the window may cross midnight). */
export const inNightWindow = (now: Date, [start, end]: [number, number]): boolean => {
  const h = now.getUTCHours();
  return start <= end ? h >= start && h < end : h >= start || h < end;
};
/**
 * Queues an `etl.build` for the active tenants whose last build is older than the refresh period of their plan (a
 * failed build is retried the next night), at most `batch` per call (spreading), inside the night window.
 */
export const scheduleRefreshes = async (saas: SaasDb, env: RunnerEnv, { now = new Date(), batch = 3, ignoreWindow = false }: { now?: Date; batch?: number; ignoreWindow?: boolean } = {}): Promise<string[]> => {
  if (!ignoreWindow && !inNightWindow(now, env.nightWindow || [20, 6])) return [];
  const tenants = await saas.selectFrom('tenant').innerJoin('plan', 'plan.code', 'tenant.plan_code')
    .select(['tenant.id', 'tenant.slug', 'plan.refresh']).where('tenant.status', '=', 'active').orderBy('tenant.created_at').execute();
  const queued: string[] = [];
  for (const t of tenants) {
    if (queued.length >= batch) break;
    const last = await saas.selectFrom('job').select(['status', 'created_at']).where('tenant_id', '=', t.id).where('type', '=', 'etl.build')
      .orderBy('created_at', 'desc').executeTakeFirst();
    if (last && (last.status === 'queued' || last.status === 'running')) continue;
    const days = last?.status === 'failed' ? 1 : (REFRESH_DAYS[t.refresh] ?? 30);
    if (last && now.getTime() - new Date(last.created_at).getTime() < days * 86_400_000) continue;
    await enqueueJob(saas, { tenantId: t.id, type: 'etl.build', params: {}, createdBy: 'scheduler' });
    queued.push(t.slug);
  }
  return queued;
};

/** MemAvailable of /proc/meminfo in MiB (null elsewhere than Linux). */
export const memAvailableMb = (): number | null => {
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+) kB/);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch { return null; }
};

/** Long-running loop: polls every `intervalMs` (the Functions have no way to wake the runner up), schedules the refreshes. */
export const runForever = async (saas: SaasDb, env: RunnerEnv, intervalMs = 10_000, handlers = HANDLERS, signal?: AbortSignal, scheduleEveryMs = 15 * 60_000): Promise<void> => {
  const log = env.log || (() => {});
  let lastSchedule = 0;
  let lowMemoryTold = false;
  while (!signal?.aborted) {
    const floor = env.memoryFloorMb || 0;
    const available = floor ? memAvailableMb() : null;
    if (floor && available !== null && available < floor) {
      if (!lowMemoryTold) { log(`MemAvailable ${available} MiB < ${floor} MiB: waiting before claiming a job`); lowMemoryTold = true; }
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    lowMemoryTold = false;
    if (Date.now() - lastSchedule > scheduleEveryMs) {
      lastSchedule = Date.now();
      const queued = await scheduleRefreshes(saas, env).catch((err) => { log(`scheduler error: ${err.message}`); return [] as string[]; });
      if (queued.length) log(`scheduled etl.build for ${queued.join(', ')}`);
    }
    const { done, failed, cancelled } = await runJobsOnce(saas, env, handlers).catch((err) => { log(`runner error: ${err.message}`); return { done: 0, failed: 0, cancelled: 0 }; });
    if (done + failed + cancelled === 0) await new Promise((r) => setTimeout(r, intervalMs));
  }
};

export const defaultRunnerName = (): string => `${os.hostname()}:${process.pid}`;
