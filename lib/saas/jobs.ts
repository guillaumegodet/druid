/**
 * @file jobs.ts
 * @description Jobs a tenant asks for (druid-internal docs/plan-druid-saas.md, lot 3 a): the catalogue of the user
 * types with their parameters (zod), the key under which a live job excludes a second one (one alignment per source,
 * one ETL build at a time), the progress in the shape the alignment pages poll (the progress files of server.cjs,
 * lib/unifiedAlignRuns.ts), and the queries of the Functions: enqueue (the existing live job when there is one),
 * cancel (queued → cancelled at once, running → the runner stops the child process), list.
 */
import { sql } from 'kysely';
import { z } from 'zod';
import { enqueueJob, type Job, type JobType, type SaasDb } from './controlPlane';

export const PEOPLE_ALIGN_SOURCES = ['idref', 'orcid', 'hal', 'openalex', 'scopus'] as const;
export type PeopleAlignSource = typeof PEOPLE_ALIGN_SOURCES[number];
export const ALIGN_GROUPS = ['personnel', 'doctorants', 'hors_recherche'] as const;
export type AlignGroup = typeof ALIGN_GROUPS[number];

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

/** `people.align`: one source, the scope of the run (same query string as /api/align/:source/trigger). */
export const PeopleAlignParams = z.object({
  source: z.enum(PEOPLE_ALIGN_SOURCES),
  mode: z.enum(['search', 'verify']).default('search'),
  labo: optionalText(120).transform((v) => v?.toUpperCase()),
  group: z.enum(ALIGN_GROUPS).optional(),
  /** Reprocess the whole scope (incremental by default: never processed or in error). */
  force: z.boolean().default(false),
  limit: z.number().int().min(0).max(100_000).default(0),
  /** One directory row (its Grist-like id), searched again from its drawer. */
  record: z.number().int().min(0).default(0),
}).refine((p) => p.source !== 'idref' || p.mode === 'search', { message: 'IdRef runs in search mode only' });
export type PeopleAlignParams = z.infer<typeof PeopleAlignParams>;

/** `structures.align` (lot 4 e): same options as scripts/align_structures.ts. */
export const StructuresAlignParams = z.object({
  mode: z.enum(['search', 'verify']).default('search'),
  types: z.array(z.string().regex(/^[a-z_]+$/)).max(20).optional(),
  only: z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/)).max(500).optional(),
  force: z.boolean().default(false),
  limit: z.number().int().min(0).max(10_000).optional(),
  /** Set by the provisioning: the first dashboards are built once the labs carry their identifiers. */
  thenEtl: z.boolean().default(false),
});
export type StructuresAlignParams = z.infer<typeof StructuresAlignParams>;

/** `etl.build` (lot 3 c): the dashboards of the labs (all of them, or the given lab slugs). */
export const EtlBuildParams = z.object({
  slugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)).max(500).optional(),
  redownloadBso: z.boolean().default(false),
});
export type EtlBuildParams = z.infer<typeof EtlBuildParams>;

/** Types a member may ask for (the others, `tenant.provision`, are internal). */
export const USER_JOB_TYPES: Record<string, z.ZodType<Record<string, unknown>, any>> = {
  'people.align': PeopleAlignParams as unknown as z.ZodType<Record<string, unknown>, any>,
  'structures.align': StructuresAlignParams as unknown as z.ZodType<Record<string, unknown>, any>,
  'etl.build': EtlBuildParams as unknown as z.ZodType<Record<string, unknown>, any>,
};
export const isUserJobType = (type: unknown): type is JobType => typeof type === 'string' && type in USER_JOB_TYPES;

export type ParsedParams = { ok: true; params: Record<string, unknown> } | { ok: false; issues: string[] };
export const parseJobParams = (type: string, raw: unknown): ParsedParams => {
  const schema = USER_JOB_TYPES[type];
  if (!schema) return { ok: false, issues: [`unknown job type ${type}`] };
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`) };
  return { ok: true, params: parsed.data };
};

/** Key of a job among the live ones of its tenant: one run per alignment source, one of each other type. */
export const jobKeyOf = (type: string, params: Record<string, unknown> = {}): string =>
  (type === 'people.align' ? `people.align:${String(params.source || '')}` : type);

/** Query string of the legacy trigger routes → `people.align` params (booleans and numbers parsed, unknown keys dropped). */
export const peopleAlignParamsOfQuery = (source: string, q: URLSearchParams): unknown => ({
  source,
  mode: source === 'idref' ? 'search' : (q.get('mode') || 'search'),
  labo: q.get('labo') || undefined,
  group: q.get('group') || undefined,
  force: q.get('force') === '1' || q.get('force') === 'true',
  limit: Math.max(0, parseInt(q.get('limit') || '0', 10) || 0),
  record: Math.max(0, parseInt(q.get('record') || '0', 10) || 0),
});

export const structuresAlignParamsOfQuery = (q: URLSearchParams): unknown => ({
  mode: q.get('mode') || 'search',
  types: q.get('types') ? String(q.get('types')).split(',').map((t) => t.trim()).filter(Boolean) : undefined,
  only: q.get('only') ? String(q.get('only')).split(',').map((t) => t.trim()).filter(Boolean) : undefined,
  force: q.get('force') === '1' || q.get('force') === 'true',
  limit: Math.max(0, parseInt(q.get('limit') || '0', 10) || 0) || undefined,
});

/** Shape of the progress files of server.cjs (lib/unifiedAlignRuns.ts UnifiedRunProgress), from a job row. */
export interface LegacyProgress {
  running: boolean;
  total: number;
  done: number;
  mode?: string;
  error?: string;
  stopped?: boolean;
  quota?: Record<string, unknown>;
  /** Extra facts of the job runner (never read by the legacy pages). */
  queued?: boolean;
  jobId?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  step?: string;
}
export const lastLogLine = (job: Pick<Job, 'log'>): string => (job.log || '').split('\n').filter(Boolean).slice(-1)[0] || '';
export const legacyProgressOf = (job: Job | null): LegacyProgress => {
  if (!job) return { running: false, total: 0, done: 0 };
  const p = (job.progress || {}) as Record<string, unknown>;
  const running = job.status === 'queued' || job.status === 'running';
  const out: LegacyProgress = {
    running, total: Number(p.total || 0), done: Number(p.done || 0), jobId: job.id, queued: job.status === 'queued',
    startedAt: job.started_at, finishedAt: job.finished_at,
  };
  if (typeof p.mode === 'string') out.mode = p.mode;
  if (typeof p.step === 'string') out.step = p.step;
  if (p.quota && typeof p.quota === 'object') out.quota = p.quota as Record<string, unknown>;
  if (job.status === 'failed') out.error = lastLogLine(job) || 'failed';
  if (job.status === 'cancelled' || p.stopped === true) out.stopped = true;
  return out;
};

// ── Queries ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const liveJob = async (db: SaasDb, tenantId: string, key: string): Promise<Job | null> =>
  (await db.selectFrom('job').selectAll().where('tenant_id', '=', tenantId).where('key', '=', key)
    .where('status', 'in', ['queued', 'running']).orderBy('created_at', 'desc').executeTakeFirst()) || null;

/** Newest job of a key, whatever its status (the progress the pages poll once the run is over). */
export const latestJobOfKey = async (db: SaasDb, tenantId: string, key: string): Promise<Job | null> =>
  (await db.selectFrom('job').selectAll().where('tenant_id', '=', tenantId).where('key', '=', key)
    .orderBy('created_at', 'desc').executeTakeFirst()) || null;

export const listJobs = async (db: SaasDb, tenantId: string, limit = 50): Promise<Job[]> =>
  db.selectFrom('job').selectAll().where('tenant_id', '=', tenantId).orderBy('created_at', 'desc').limit(Math.min(200, Math.max(1, limit))).execute();

/** Queues a user job, unless one of the same key is live: then that one comes back (`created: false`, the 409 of the routes). */
export const enqueueUserJob = async (db: SaasDb, { tenantId, type, params, createdBy }: { tenantId: string; type: JobType; params: Record<string, unknown>; createdBy: string | null }): Promise<{ job: Job; created: boolean }> => {
  const key = jobKeyOf(type, params);
  const live = await liveJob(db, tenantId, key);
  if (live) return { job: live, created: false };
  const id = await enqueueJob(db, { tenantId, type, params, createdBy, key });
  const job = await db.selectFrom('job').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return { job, created: true };
};

/** « Stop »: a queued job is cancelled at once; a running one is asked to stop (the runner ends it). */
export const requestCancel = async (db: SaasDb, jobId: string, tenantId: string): Promise<'cancelled' | 'stopping' | null> => {
  const cancelled = await db.updateTable('job').set({ status: 'cancelled', finished_at: sql<string>`now()`, cancel_requested_at: sql<string>`now()` })
    .where('id', '=', jobId).where('tenant_id', '=', tenantId).where('status', '=', 'queued').returning('id').executeTakeFirst();
  if (cancelled) return 'cancelled';
  const stopping = await db.updateTable('job').set({ cancel_requested_at: sql<string>`now()` })
    .where('id', '=', jobId).where('tenant_id', '=', tenantId).where('status', '=', 'running').returning('id').executeTakeFirst();
  return stopping ? 'stopping' : null;
};
