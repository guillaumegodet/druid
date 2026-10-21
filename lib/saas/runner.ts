/**
 * @file runner.ts
 * @description Jobs of a multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lots 2 d and 3): the
 * Functions enqueue rows in `saas.job`, this runner (a Node process next to the database, never a Worker) claims them
 * one at a time (`FOR UPDATE SKIP LOCKED`) and runs the handler of their type. Lot 2 brings the first one,
 * `tenant.provision`: schema migrated, directory seeded from the onboarding payload, route of the host, tenant active,
 * « ready » e-mail, then a `structures.align` job queued (lot 4: the identifiers of the labs are found from the RNSR of
 * the seed, without any typing). The other types wait for lot 3 (ETL, people alignments).
 */
import { sql } from 'kysely';
import pg from 'pg';
import { createDbWith } from '../db/core';
import { enqueueJob, primaryHost, type Job, type SaasDb, type Tenant } from './controlPlane';
import { runStructureAlignment } from '../structures/alignRun';
import { ALIGNED_STRUCTURE_ID_TYPES, isStructureIdType, type StructureIdType } from '../structures/identifiers';
import { createRegistryClient } from '../structures/registryClient';
import { sendTenantReady, type EmailEnv } from './email';
import { OnboardingPayload, seedTenantDirectory, tenantHostOf } from './onboarding';
import { migrateTenantSchema, setTenantStatus, type TenantDbOptions } from './tenantDb';

export interface CloudflareRouteEnv {
  /** API token with Workers Routes: Edit on the zone. */
  apiToken: string;
  zoneId: string;
  /** Name of the Worker serving the tenants (druid-saas). */
  workerName: string;
}

export interface RunnerEnv {
  /** Owner connection string (migrations) — the runner sits next to the database. */
  ownerUrl: string;
  /** Application connection string for the seeding (default: ownerUrl). */
  appUrl?: string;
  /** Base domain of the tenants (`dirladata.fr`): the host of a new tenant is `<slug>.<base>`. */
  baseDomain: string;
  cloudflare?: CloudflareRouteEnv | null;
  email?: EmailEnv | null;
  dbmateBin?: string;
  migrationsDir?: string;
  log?: (line: string) => void;
  /** OpenAlex key of the deployment (or a mailto) for the structure alignment. */
  openalexApiKey?: string | null;
  openalexMailto?: string | null;
  /** Overrides for the tests (no network). */
  fetchImpl?: typeof fetch;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;
export interface JobContext {
  saas: SaasDb;
  env: RunnerEnv;
  tenant: Tenant;
  /** Progress visible to the user (the portal polls it). */
  progress: (step: string, pct: number, extra?: Record<string, unknown>) => Promise<void>;
  log: (line: string) => void;
}

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
    const db = createDbWith(pg, { connectionString: env.appUrl || env.ownerUrl, max: 2, allowExitOnIdle: true, schema: tenant.schema_name });
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
  // The identifiers of the seeded labs (HAL, ROR, OpenAlex…) follow from their RNSR: queued, not awaited.
  await enqueueJob(saas, { tenantId: tenant.id, type: 'structures.align', params: { mode: 'search' }, createdBy: job.created_by ?? null });
};

/**
 * `structures.align` (druid-internal docs/plan-druid-saas.md, lot 4 e): the structure alignment of a tenant,
 * `params` = { mode?: 'search' | 'verify', types?: string[], only?: string[], force?: boolean, limit?: number }.
 */
export const alignStructures: JobHandler = async (job, { env, tenant, progress, log }) => {
  const params = (job.params || {}) as { mode?: string; types?: unknown; only?: unknown; force?: unknown; limit?: unknown };
  const types = Array.isArray(params.types) ? (params.types as unknown[]).filter(isStructureIdType) as StructureIdType[] : ALIGNED_STRUCTURE_ID_TYPES;
  const db = createDbWith(pg, { connectionString: env.appUrl || env.ownerUrl, max: 2, allowExitOnIdle: true, schema: tenant.schema_name });
  try {
    const registry = createRegistryClient({ openalexApiKey: env.openalexApiKey ?? null, openalexMailto: env.openalexMailto ?? null, fetch: env.fetchImpl as any, log: (l) => log(`registry: ${l}`) });
    const report = await runStructureAlignment(db, registry, {
      mode: params.mode === 'verify' ? 'verify' : 'search', types,
      only: Array.isArray(params.only) ? (params.only as unknown[]).map(String) : undefined,
      force: params.force === true, limit: Number(params.limit) || undefined, log,
      onProgress: ({ total, done }) => { void progress('structures', total ? Math.round((done / total) * 100) : 100, { total, done }); },
    });
    log(`${report.done}/${report.total} structure(s): ${report.candidates} candidate(s), ${report.conflicts} conflict(s), ${report.verificationIssues} verification issue(s), ${report.errors} error(s)`);
    await progress('done', 100, { ...report });
  } finally {
    await db.destroy();
  }
};

export const HANDLERS: Record<string, JobHandler> = { 'tenant.provision': provisionTenant, 'structures.align': alignStructures };

/** Claims the oldest queued job (one runner at a time per row), or null. */
export const claimJob = async (saas: SaasDb, types: string[]): Promise<Job | null> => {
  const row = await sql<Job>`
    UPDATE saas.job SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (SELECT id FROM saas.job WHERE status = 'queued' AND type = ANY(${types}) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING *`.execute(saas);
  return row.rows[0] || null;
};

const appendLog = async (saas: SaasDb, id: string, line: string) => {
  await sql`UPDATE saas.job SET log = concat_ws(E'\\n', log, ${line}::text) WHERE id = ${id}::uuid`.execute(saas);
};

/** Runs one claimed job: progress and log on the row, `done` or `failed` at the end. */
export const runJob = async (saas: SaasDb, env: RunnerEnv, job: Job, handlers = HANDLERS): Promise<'done' | 'failed'> => {
  // The log lines are written in order and all flushed before the final status.
  let pending: Promise<void> = Promise.resolve();
  const log = (line: string) => {
    (env.log || (() => {}))(`job ${job.id} (${job.type}): ${line}`);
    pending = pending.then(() => appendLog(saas, job.id, line)).catch((err) => { (env.log || (() => {}))(`log write failed: ${err instanceof Error ? err.message : String(err)}`); });
  };
  const progress = async (step: string, pct: number, extra: Record<string, unknown> = {}) => {
    await saas.updateTable('job').set({ progress: { step, pct, ...extra } }).where('id', '=', job.id).execute();
  };
  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`no handler for job type ${job.type}`);
    const tenant = await saas.selectFrom('tenant').selectAll().where('id', '=', job.tenant_id).executeTakeFirst();
    if (!tenant) throw new Error('tenant not found');
    await handler(job, { saas, env, tenant, progress, log });
    await pending;
    await saas.updateTable('job').set({ status: 'done', finished_at: sql<string>`now()` }).where('id', '=', job.id).execute();
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pending;
    await appendLog(saas, job.id, `failed: ${message}`).catch(() => {});
    await saas.updateTable('job').set({ status: 'failed', finished_at: sql<string>`now()` }).where('id', '=', job.id).execute();
    (env.log || (() => {}))(`job ${job.id} (${job.type}) failed: ${message}`);
    return 'failed';
  }
};

/** Processes the queued jobs of the handled types until none is left; returns what was run. */
export const runJobsOnce = async (saas: SaasDb, env: RunnerEnv, handlers = HANDLERS): Promise<{ done: number; failed: number }> => {
  const out = { done: 0, failed: 0 };
  for (;;) {
    const job = await claimJob(saas, Object.keys(handlers));
    if (!job) return out;
    out[await runJob(saas, env, job, handlers)]++;
  }
};

/** Long-running loop: polls every `intervalMs` (the Functions have no way to wake the runner up). */
export const runForever = async (saas: SaasDb, env: RunnerEnv, intervalMs = 10_000, handlers = HANDLERS, signal?: AbortSignal): Promise<void> => {
  while (!signal?.aborted) {
    const { done, failed } = await runJobsOnce(saas, env, handlers).catch((err) => { (env.log || (() => {}))(`runner error: ${err.message}`); return { done: 0, failed: 0 }; });
    if (done + failed === 0) await new Promise((r) => setTimeout(r, intervalMs));
  }
};
