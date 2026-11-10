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
 *    dashboards uploaded to the asset store (R2);
 *  - `tenant.export` (lot 6 a-3): `pg_dump` of the schema, the dashboards and the accounts in one archive uploaded to
 *    the asset store for 7 days, the owner told by e-mail;
 *  - `tenant.delete` (lot 6 a-3): once the 30 days of a deletion asked by the owner are over, the route, the objects,
 *    the files, the schema and the rows of the tenant (lib/saas/lifecycle.ts).
 * A « Stop » of the UI (job.cancel_requested_at) ends the child process (SIGTERM: the alignment scripts save what they
 * have) and the job ends `cancelled`. Scheduled refreshes (lot 3 d), the alerts on repeated failures (lot 3 e), the
 * removal of expired exports and the queueing of due deletions (lot 6 a-3), the e-mails of a failed job and of an
 * inactive tenant (lot 6 d, lib/saas/notices.ts) are here too.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import pg from 'pg';
import { createDbWith, type Db } from '../db/core';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { redactSecrets } from './redact';
import { enqueueJob, primaryHost, type Job, type Plan, type SaasDb, type Tenant } from './controlPlane';
import { runStructureAlignment } from '../structures/alignRun';
import { ALIGNED_STRUCTURE_ID_TYPES, isStructureIdType, type StructureIdType } from '../structures/identifiers';
import { createRegistryClient } from '../structures/registryClient';
import { sendEmail, sendExportReady, sendInactivityNotice, sendJobFailed, sendTenantDeleted, sendTenantReady, type EmailEnv } from './email';
import { OnboardingPayload, seedTenantDirectory, tenantHostOf } from './onboarding';
import { dropTenantSchema, migrateTenantSchema, setTenantStatus, type TenantDbOptions } from './tenantDb';
import { EtlBuildParams, PeopleAlignParams, StructuresAlignParams } from './jobs';
import { cacheNamesOfSource, writeAlignCache } from './alignCache';
import { llmEnvOf } from './clientKeys';
import { readTenantSecrets } from './secrets';
import { dashboardIndexOf, etlLabsOf, yamlOf } from './etlConfig';
import { deletePrefix, type AssetStore } from './r2';
import {
  EXPORT_TTL_DAYS, dueDeletions, expiredExports, exportBaseName, exportObjectKey, isDeletionDue, markExportPurged, tombstoneTenant,
} from './lifecycle';
import { logConsole } from './console';
import {
  failureReason, failureRecipients, inNoticeHours, inactiveTenants, jobLabelOf, jobPagePath, markInactivityNotified, ownerEmailsOf, previousRunOf,
} from './notices';

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
  /** pg_dump of the exports (lot 6 a-3), at least the major version of the server (default `pg_dump` in PATH). */
  pgDumpBin?: string;
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

/** Removes the route `<host>/*` of the Worker (deletion of a tenant): 'absent' when there was none. */
export const removeWorkerRoute = async (cf: CloudflareRouteEnv, host: string, fetchImpl: typeof fetch = fetch): Promise<'removed' | 'absent'> => {
  const base = `https://api.cloudflare.com/client/v4/zones/${cf.zoneId}/workers/routes`;
  const headers = { Authorization: `Bearer ${cf.apiToken}`, 'Content-Type': 'application/json' };
  const listed = await fetchImpl(base, { headers });
  const list = (await listed.json()) as { success: boolean; result?: { id: string; pattern: string }[]; errors?: unknown[] };
  if (!list.success) throw new Error(`Cloudflare routes: ${JSON.stringify(list.errors)}`);
  const route = (list.result || []).find((r) => r.pattern === `${host}/*`);
  if (!route) return 'absent';
  const removed = await fetchImpl(`${base}/${route.id}`, { method: 'DELETE', headers });
  const out = (await removed.json()) as { success: boolean; errors?: unknown[] };
  if (!out.success) throw new Error(`Cloudflare route ${host}/*: ${JSON.stringify(out.errors)}`);
  return 'removed';
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
  // The identifiers of the seeded labs (HAL, ROR, OpenAlex…) follow from their RNSR: queued, not awaited. They are only
  // candidates until the establishment accepts them, so the first dashboards are NOT chained here: the establishment
  // builds them from the alignment page once its labs carry a confirmed OpenAlex id or HAL collection (an ETL run
  // before that harvests nothing and fails every lab).
  await enqueueJob(saas, { tenantId: tenant.id, type: 'structures.align', params: { mode: 'search' }, createdBy: job.created_by ?? null });
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
// A child's last lines go to the job log (journald, saas.job.log): their secret parameters are masked (lib/saas/redact.ts).
export { redactSecrets };
const tailOf = (file: string, lines = 30): string[] => {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-lines).map(redactSecrets); } catch { return []; }
};

/** Runs a child process, relays its progress file, stops it when asked (SIGTERM then SIGKILL) or after `timeoutMs`. */
export const runChild = async (run: ChildRun, ctx: { log: (l: string) => void; isCancelRequested: () => Promise<boolean>; spawnImpl?: typeof nodeSpawn }): Promise<ChildResult> => {
  const spawn = ctx.spawnImpl || nodeSpawn;
  // Truncated at each run: appended, the tail of a successful run still showed the errors of the previous one.
  const out = fs.openSync(run.outputFile, 'w');
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
  // The establishment of the tenant (onboarding: ROR → OpenAlex), whose other labs are the « internal » partners.
  const homeOpenalex = typeof settings.openalex === 'string' && settings.openalex ? [settings.openalex] : [];
  const establishment = ((tenant.onboarding || {}) as { establishment?: { name?: string } }).establishment;
  const homeName = String(establishment?.name || '').trim() || tenant.label;
  const report = etlLabsOf(structures, { historyYears: plan?.history_years ?? null, mailto, home: { name: homeName, openalexIds: homeOpenalex } });
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
  const childEnv = childEnvOf({ BIBLIO_DATA_DIR: dataDir, OPENALEX_API_KEY: secrets.OPENALEX_API_KEY || env.openalexApiKey || undefined, ...llmEnvOf(secrets) });
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
      // `detail`, not `step`: progress() sets `step` itself ('etl'), which overwrote the lab's last log line.
      onProgress: (p) => { const lines = Array.isArray(p.log) ? p.log : []; void ctx.progress('etl', Math.round((i / labs.length) * 100), { total: labs.length, done: i, lab: lab.slug, detail: redactSecrets(String(lines[lines.length - 1] || '')).slice(0, 300), built: built.length, failed: failed.length }); },
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

// ── Export and deletion (lot 6 a-3) ───────────────────────────────────────────────────────────────────────────────────
/** libpq environment of a connection string (the password never goes on a command line). */
export const libpqEnvOf = (connectionString: string): Record<string, string> => {
  const u = new URL(connectionString);
  const out: Record<string, string> = {
    PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  if (u.password) out.PGPASSWORD = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) out.PGSSLMODE = sslmode;
  return out;
};

const csvCell = (v: unknown): string => {
  const s = Array.isArray(v) ? v.join(' ') : v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const exportReadme = (tenant: Tenant, base: string, at: Date, labs: string[]): string => `Druid — ${tenant.label}
Export du ${at.toISOString().slice(0, 10)} · Export of ${at.toISOString().slice(0, 10)}

FR
- database.sql : toutes les tables de votre Druid (référentiel, appartenances, alignements, rapports, journal…),
  schéma PostgreSQL « ${tenant.schema_name} » (pg_dump, format texte). Restauration dans une base PostgreSQL vide
  (version 17 ou plus) : psql -d <base> -v ON_ERROR_STOP=1 -f database.sql
- dashboards/<labo>/ : les tableaux de bord de publications calculés pour chaque laboratoire (JSON compressé).
- members.csv : les comptes (adresse, rôle, laboratoires, dates).
L'archive contient des données personnelles (chercheurs, comptes) : conservez-la en lieu sûr.

EN
- database.sql: every table of your Druid (directory, affiliations, alignments, reports, journal…), PostgreSQL schema
  "${tenant.schema_name}" (pg_dump, plain format). Restore into an empty PostgreSQL database (version 17 or later):
  psql -d <database> -v ON_ERROR_STOP=1 -f database.sql
- dashboards/<lab>/: the publication dashboards computed for each lab (compressed JSON).
- members.csv: the accounts (address, role, labs, dates).
The archive holds personal data (researchers, accounts): keep it safe.

${base} · ${labs.length} dashboard(s)
`;

/**
 * `tenant.export` (lot 6 a-3): `pg_dump --schema` of the tenant, its dashboards (the files of the ETL on disk) and its
 * accounts, archived as `<base>.tar.gz` and uploaded under `<slug>/exports/`; the result stays in `job.progress`
 * (lib/saas/lifecycle.ts ExportResult) for `EXPORT_TTL_DAYS` days, the requester is told by e-mail.
 */
export const exportTenant: JobHandler = async (job, ctx) => {
  const { env, tenant, log, saas } = ctx;
  if (!env.assets) throw new Error('No asset store on this runner (SAAS_R2_*): the export has nowhere to go');
  const at = new Date();
  const base = exportBaseName(tenant.slug, job.id, at);
  const work = path.join(workDirOf(env, tenant), `export-${job.id}`);
  const dir = path.join(work, base);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    await ctx.progress('database', 10);
    const dumped = await runChild({
      command: env.pgDumpBin || 'pg_dump',
      args: ['--schema', tenant.schema_name, '--no-owner', '--no-privileges', '--format', 'plain', '--file', path.join(dir, 'database.sql')],
      cwd: work, env: childEnvOf(libpqEnvOf(env.ownerUrl)), outputFile: path.join(work, 'pg_dump.log'), timeoutMs: 3600_000,
    }, { log, isCancelRequested: ctx.isCancelRequested, spawnImpl: env.spawnImpl });
    if (dumped.cancelled) throw new JobCancelled('stopped by the user');
    if (dumped.code !== 0 || !fs.existsSync(path.join(dir, 'database.sql'))) throw new Error(`pg_dump failed (${dumped.timedOut ? 'timeout' : `code ${dumped.code}`})`);

    await ctx.progress('dashboards', 50);
    const labs: string[] = [];
    const etlDir = env.etl ? path.join(env.etl.dataDir, tenant.slug) : null;
    if (etlDir && fs.existsSync(etlDir)) {
      for (const lab of fs.readdirSync(etlDir).sort()) {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(lab)) continue;
        for (const file of ['dashboard.json.gz', 'dashboard.public.json.gz']) {
          const src = path.join(etlDir, lab, file);
          if (!fs.existsSync(src)) continue;
          fs.mkdirSync(path.join(dir, 'dashboards', lab), { recursive: true });
          fs.copyFileSync(src, path.join(dir, 'dashboards', lab, file));
          if (!labs.includes(lab)) labs.push(lab);
        }
      }
    }
    const members = await saas.selectFrom('member').select(['email', 'role', 'lab_scope', 'invited_by', 'created_at', 'last_login_at'])
      .where('tenant_id', '=', tenant.id).orderBy('created_at').execute();
    const header = ['email', 'role', 'labs', 'invited_by', 'created_at', 'last_login_at'];
    const rows = members.map((m) => [m.email, m.role, m.lab_scope, m.invited_by, m.created_at ? new Date(m.created_at).toISOString() : '', m.last_login_at ? new Date(m.last_login_at).toISOString() : ''].map(csvCell).join(','));
    fs.writeFileSync(path.join(dir, 'members.csv'), `${header.join(',')}\n${rows.join('\n')}\n`);
    fs.writeFileSync(path.join(dir, 'README.txt'), exportReadme(tenant, base, at, labs));

    await ctx.progress('archive', 70, { dashboards: labs.length, members: members.length });
    const archive = path.join(work, `${base}.tar.gz`);
    const tarred = await runChild({
      command: 'tar', args: ['-czf', archive, '-C', work, base], cwd: work, env: childEnvOf({}), outputFile: path.join(work, 'tar.log'), timeoutMs: 3600_000,
    }, { log, isCancelRequested: ctx.isCancelRequested, spawnImpl: env.spawnImpl });
    if (tarred.cancelled) throw new JobCancelled('stopped by the user');
    if (tarred.code !== 0 || !fs.existsSync(archive)) throw new Error(`tar failed (code ${tarred.code})`);

    await ctx.progress('upload', 85);
    const body = new Uint8Array(fs.readFileSync(archive));
    const objectKey = exportObjectKey(tenant.slug, job.id, at);
    await env.assets.put(objectKey, body, 'application/gzip');
    const expiresAt = new Date(at.getTime() + EXPORT_TTL_DAYS * 86_400_000).toISOString();
    await ctx.progress('done', 100, { objectKey, fileName: `${base}.tar.gz`, size: body.byteLength, expiresAt, dashboards: labs.length, members: members.length });
    log(`export ${base}.tar.gz: ${body.byteLength} bytes, ${labs.length} dashboard(s), ${members.length} account(s), until ${expiresAt}`);
    const to = job.created_by && job.created_by.includes('@') ? job.created_by : null;
    if (to && env.email?.RESEND_API_KEY) {
      const host = (await primaryHost(saas, tenant.id)) || tenantHostOf(tenant.slug, env.baseDomain);
      await sendExportReady(env.email, { to, label: tenant.label, adminUrl: `https://${host}/?page=ADMIN&tab=establishment`, expiresAt })
        .catch((err) => log(`e-mail failed: ${err.message}`));
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

/**
 * `tenant.delete` (lot 6 a-3), queued by the scheduler once `delete_after` is past: checks again that the deletion is
 * still asked, then removes the routes, the objects of the asset store (`<slug>/…`), the files of the runner, the
 * schema, and last the rows (lib/saas/lifecycle.ts tombstoneTenant). Each step is idempotent: a failed run is retried
 * the next day from the start.
 */
export const deleteTenant: JobHandler = async (job, ctx) => {
  const { env, tenant, log, saas } = ctx;
  if (!isDeletionDue(tenant)) { log(`deletion of ${tenant.slug} not due (status ${tenant.status}, delete_after ${tenant.delete_after ?? '—'}): nothing done`); return; }
  const owners = (await saas.selectFrom('member').select('email').where('tenant_id', '=', tenant.id).where('role', '=', 'owner').execute()).map((m) => m.email);
  const hosts = (await saas.selectFrom('tenant_host').select('host').where('tenant_id', '=', tenant.id).execute()).map((h) => h.host);
  await ctx.progress('routes', 10);
  for (const host of hosts) {
    if (!env.cloudflare) { log(`route ${host}/*: no Cloudflare configuration, skipped`); continue; }
    log(`route ${host}/*: ${await removeWorkerRoute(env.cloudflare, host, env.fetchImpl)}`);
  }
  await ctx.progress('files', 30);
  if (env.assets) log(`asset store: ${await deletePrefix(env.assets, `${tenant.slug}/`)} object(s) removed`);
  else log('asset store: none configured, skipped');
  for (const dir of [path.join(env.workDir || path.join(env.druidRoot || process.cwd(), 'saas-work'), tenant.slug), env.etl ? path.join(env.etl.dataDir, tenant.slug) : null]) {
    if (!dir || !fs.existsSync(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    log(`folder ${dir} removed`);
  }
  await ctx.progress('schema', 60);
  await dropTenantSchema(tenant.schema_name, { ownerUrl: env.ownerUrl });
  log(`schema ${tenant.schema_name} dropped`);
  await ctx.progress('rows', 90);
  await tombstoneTenant(saas, tenant.id, job.id);
  await logConsole(saas, { actor: 'runner', action: 'deleted', tenantId: tenant.id, details: { slug: tenant.slug, schema: tenant.schema_name, hosts, requestedAt: tenant.delete_requested_at } });
  await ctx.progress('done', 100, { hosts: hosts.length });
  log(`tenant ${tenant.slug} deleted`);
  if (env.email?.RESEND_API_KEY) {
    for (const to of owners) await sendTenantDeleted(env.email, { to, label: tenant.label }).catch((err) => log(`e-mail failed: ${err.message}`));
  }
};

export const HANDLERS: Record<string, JobHandler> = {
  'tenant.provision': provisionTenant, 'structures.align': alignStructures, 'people.align': alignPeople, 'etl.build': buildEtl,
  'tenant.export': exportTenant, 'tenant.delete': deleteTenant,
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

/** Jobs of the platform, retried by nobody and told to nobody else: the ops address hears of their first failure. */
const PLATFORM_JOB_TYPES = ['tenant.provision', 'tenant.delete'];

/** Two failures in a row of the same key (this one included), or one of a platform job → the ops address is told (lot 3 e). */
export const alertOnRepeatedFailure = async (saas: SaasDb, env: RunnerEnv, job: Job, tenant: Tenant | null, message: string): Promise<boolean> => {
  if (!env.alertEmail || !env.email?.RESEND_API_KEY) return false;
  const once = PLATFORM_JOB_TYPES.includes(job.type);
  if (!once && (await previousRunOf(saas, job))?.status !== 'failed') return false;
  const subject = `[Druid SaaS] ${tenant?.slug || job.tenant_id}: ${job.type} failed${once ? '' : ' twice'}`;
  const text = `Tenant ${tenant?.label || ''} (${tenant?.slug || job.tenant_id})\nJob ${job.id} (${job.type}, key ${job.key}) failed${once ? '' : ' twice in a row'}.\n\n${message}\n`;
  await sendEmail(env.email, { to: env.alertEmail, subject, text, html: `<pre>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre>` })
    .catch((err) => (env.log || (() => {}))(`alert e-mail failed: ${err instanceof Error ? err.message : String(err)}`));
  return true;
};

/** A failed job of the establishment → the member who started it, or the owners for a scheduled one (lot 6 d). */
export const notifyJobFailure = async (saas: SaasDb, env: RunnerEnv, job: Job, tenant: Tenant | null, message: string): Promise<string[]> => {
  if (!tenant || !env.email?.RESEND_API_KEY) return [];
  const recipients = await failureRecipients(saas, job, tenant);
  if (!recipients.length) return [];
  const host = (await primaryHost(saas, tenant.id)) || tenantHostOf(tenant.slug, env.baseDomain);
  const sent: string[] = [];
  for (const to of recipients) {
    await sendJobFailed(env.email, {
      to, label: tenant.label, what: jobLabelOf(job), reason: failureReason(message), pageUrl: `https://${host}${jobPagePath(job.type)}`, retried: job.created_by === 'scheduler',
    }).then(() => sent.push(to), (err) => (env.log || (() => {}))(`failure e-mail failed: ${err instanceof Error ? err.message : String(err)}`));
  }
  return sent;
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
    if (!cancelled) {
      await alertOnRepeatedFailure(saas, env, job, tenant, message).catch(() => {});
      await notifyJobFailure(saas, env, job, tenant, message).catch(() => {});
    }
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
 * failed build is retried the next night), at most `batch` per call (spreading), inside the night window. Only
 * REFRESHES: a tenant that never built its dashboards successfully is left to the establishment (first build from
 * the alignment page, once its identifiers are confirmed), else a fresh tenant would fail every night.
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
    if (!last || last.status === 'queued' || last.status === 'running') continue;
    const built = await saas.selectFrom('job').select('id').where('tenant_id', '=', t.id).where('type', '=', 'etl.build').where('status', '=', 'done')
      .limit(1).executeTakeFirst();
    if (!built) continue;
    const days = last?.status === 'failed' ? 1 : (REFRESH_DAYS[t.refresh] ?? 30);
    if (now.getTime() - new Date(last.created_at).getTime() < days * 86_400_000) continue;
    await enqueueJob(saas, { tenantId: t.id, type: 'etl.build', params: {}, createdBy: 'scheduler' });
    queued.push(t.slug);
  }
  return queued;
};

/**
 * Lifecycle of the tenants, every tick of the scheduler: the archives of expired exports are removed from the asset
 * store, a `tenant.delete` is queued for each tenant whose deletion is due (lot 6 a-3), and in office hours the owners
 * of a tenant nobody signed in to for 90 days are told (lot 6 d).
 */
export const scheduleLifecycle = async (saas: SaasDb, env: RunnerEnv, now = new Date()): Promise<{ purged: number; deletions: string[]; inactive: string[] }> => {
  let purged = 0;
  if (env.assets) {
    for (const e of await expiredExports(saas, now)) {
      await env.assets.delete(e.objectKey);
      await markExportPurged(saas, e.id, now);
      purged++;
    }
  }
  const deletions: string[] = [];
  for (const t of await dueDeletions(saas, now)) {
    await enqueueJob(saas, { tenantId: t.id, type: 'tenant.delete', params: {}, createdBy: 'scheduler' });
    deletions.push(t.slug);
  }
  const inactive: string[] = [];
  if (env.email?.RESEND_API_KEY && inNoticeHours(now)) {
    for (const t of await inactiveTenants(saas, now)) {
      const owners = await ownerEmailsOf(saas, t.id);
      const host = (await primaryHost(saas, t.id)) || tenantHostOf(t.slug, env.baseDomain);
      let sent = 0;
      for (const to of owners) {
        await sendInactivityNotice(env.email, { to, label: t.label, lastActivity: t.lastActivity, loginUrl: `https://${host}/auth/login`, adminUrl: `https://${host}/?page=ADMIN&tab=establishment` })
          .then(() => { sent++; }, (err) => (env.log || (() => {}))(`inactivity e-mail failed (${t.slug}): ${err instanceof Error ? err.message : String(err)}`));
      }
      // Marked even without an owner: a tenant left without one is a matter for the console, not a daily retry.
      if (sent || !owners.length) await markInactivityNotified(saas, t.id, now);
      if (sent) inactive.push(t.slug);
    }
  }
  return { purged, deletions, inactive };
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
      const life = await scheduleLifecycle(saas, env).catch((err) => { log(`lifecycle error: ${err.message}`); return { purged: 0, deletions: [] as string[], inactive: [] as string[] }; });
      if (life.purged) log(`${life.purged} expired export(s) removed`);
      if (life.deletions.length) log(`scheduled tenant.delete for ${life.deletions.join(', ')}`);
      if (life.inactive.length) log(`inactivity e-mail sent for ${life.inactive.join(', ')}`);
    }
    const { done, failed, cancelled } = await runJobsOnce(saas, env, handlers).catch((err) => { log(`runner error: ${err.message}`); return { done: 0, failed: 0, cancelled: 0 }; });
    if (done + failed + cancelled === 0) await new Promise((r) => setTimeout(r, intervalMs));
  }
};

export const defaultRunnerName = (): string => `${os.hostname()}:${process.pid}`;
