/**
 * @file lifecycle.ts
 * @description Export and deletion of a tenant (druid-internal docs/plan-druid-saas.md, lot 6 a-3), the rules shared
 * by the Functions (functions/api/tenant: the owner asks), the console of lot 6 c (cancels) and the runner (runs):
 *  - export: a `tenant.export` job (one at a time) writes an archive to the asset store; it can be downloaded for
 *    `EXPORT_TTL_DAYS` days from « My institution », then the runner removes it;
 *  - deletion: the owner confirms with the slug, the tenant is suspended (read-only) until `delete_after`
 *    (`DELETION_DELAY_DAYS` days), then the runner queues `tenant.delete`; the owner or the console may cancel before.
 * Imports carry their `.ts` extension: the Functions load this module under Node type stripping in the CI guards.
 */
import { sql } from 'kysely';
import { normalizeEmail, type Job, type SaasDb, type Tenant, type TenantStatus } from './controlPlane.ts';

export const EXPORT_TTL_DAYS = 7;
export const DELETION_DELAY_DAYS = 30;
const DAY_MS = 86_400_000;

export class LifecycleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── Export ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Date part of a file name (UTC): `20261110`. */
const ymd = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Folder and file of an export: `druid-<slug>-<yyyymmdd>-<8 hex of the job>`. */
export const exportBaseName = (slug: string, jobId: string, at: Date): string =>
  `druid-${slug}-${ymd(at)}-${jobId.replace(/-/g, '').slice(0, 8)}`;

/** Key of the archive in the asset store (under the tenant prefix, so that a deletion removes it too). */
export const exportObjectKey = (slug: string, jobId: string, at: Date): string =>
  `${slug}/exports/${exportBaseName(slug, jobId, at)}.tar.gz`;

/** What the runner leaves in `job.progress` once the archive is uploaded (and `purgedAt` once it is removed). */
export interface ExportResult { objectKey: string; fileName: string; size: number; expiresAt: string; purgedAt?: string }

export interface ExportView {
  id: string;
  status: Job['status'];
  createdAt: string;
  finishedAt: string | null;
  createdBy: string | null;
  fileName: string | null;
  size: number | null;
  expiresAt: string | null;
  /** Ready and not expired: the download route serves it. */
  available: boolean;
  error: string | null;
}

const resultOf = (job: Pick<Job, 'progress'>): ExportResult | null => {
  const p = (job.progress || {}) as Record<string, unknown>;
  return typeof p.objectKey === 'string' && p.objectKey ? (p as unknown as ExportResult) : null;
};

export const exportViewOf = (job: Job, now = new Date()): ExportView => {
  const r = resultOf(job);
  const expiresAt = r?.expiresAt ? new Date(r.expiresAt) : null;
  return {
    id: job.id, status: job.status, createdAt: String(job.created_at), finishedAt: job.finished_at ? String(job.finished_at) : null,
    createdBy: job.created_by, fileName: r?.fileName ?? null, size: typeof r?.size === 'number' ? r.size : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    available: job.status === 'done' && !!r && !r.purgedAt && !!expiresAt && expiresAt.getTime() > now.getTime(),
    error: job.status === 'failed' ? (job.log || '').split('\n').filter(Boolean).slice(-1)[0] || 'failed' : null,
  };
};

/** The latest exports of a tenant, newest first. */
export const listExports = async (db: SaasDb, tenantId: string, limit = 5): Promise<ExportView[]> => {
  const rows = await db.selectFrom('job').selectAll().where('tenant_id', '=', tenantId).where('type', '=', 'tenant.export')
    .orderBy('created_at', 'desc').limit(limit).execute();
  const now = new Date();
  return rows.map((j) => exportViewOf(j, now));
};

/** Queues an export, unless one is queued or running (that one comes back, `created: false`). */
export const requestExport = async (db: SaasDb, tenantId: string, by: string): Promise<{ job: Job; created: boolean }> => {
  const live = await db.selectFrom('job').selectAll().where('tenant_id', '=', tenantId).where('key', '=', 'tenant.export')
    .where('status', 'in', ['queued', 'running']).executeTakeFirst();
  if (live) return { job: live, created: false };
  const job = await db.insertInto('job').values({ tenant_id: tenantId, type: 'tenant.export', key: 'tenant.export', params: {}, created_by: normalizeEmail(by) })
    .returningAll().executeTakeFirstOrThrow();
  return { job, created: true };
};

/** Object of a downloadable export of this tenant, or why not (404 unknown, 410 expired or removed). */
export const exportToDownload = async (db: SaasDb, tenantId: string, jobId: string, now = new Date()): Promise<{ objectKey: string; fileName: string; size: number }> => {
  const job = await db.selectFrom('job').selectAll().where('id', '=', jobId).where('tenant_id', '=', tenantId).where('type', '=', 'tenant.export').executeTakeFirst();
  const r = job ? resultOf(job) : null;
  if (!job || job.status !== 'done' || !r) throw new LifecycleError('Export not found', 404);
  if (!exportViewOf(job, now).available) throw new LifecycleError('This export has expired: ask for a new one', 410);
  return { objectKey: r.objectKey, fileName: r.fileName, size: r.size };
};

/** Exports past their date whose archive is still in the store (the runner removes them). */
export const expiredExports = async (db: SaasDb, now = new Date()): Promise<{ id: string; objectKey: string }[]> => {
  const rows = await db.selectFrom('job').select(['id', 'progress']).where('type', '=', 'tenant.export').where('status', '=', 'done')
    .where(sql<boolean>`progress ? 'objectKey'`).where(sql<boolean>`NOT (progress ? 'purgedAt')`)
    .where(sql<boolean>`(progress->>'expiresAt')::timestamptz < ${now.toISOString()}::timestamptz`).execute();
  return rows.map((r) => ({ id: r.id, objectKey: String((r.progress as Record<string, unknown>).objectKey) }));
};

export const markExportPurged = async (db: SaasDb, jobId: string, now = new Date()): Promise<void> => {
  await db.updateTable('job').set({ progress: sql`progress || ${JSON.stringify({ purgedAt: now.toISOString() })}::jsonb` as any }).where('id', '=', jobId).execute();
};

// ── Deletion ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DeletionView { requestedAt: string; requestedBy: string | null; deleteAfter: string }

export const deletionOf = (t: Pick<Tenant, 'delete_requested_at' | 'delete_requested_by' | 'delete_after'>): DeletionView | null =>
  t.delete_after && t.delete_requested_at
    ? { requestedAt: new Date(t.delete_requested_at).toISOString(), requestedBy: t.delete_requested_by, deleteAfter: new Date(t.delete_after).toISOString() }
    : null;

/**
 * The owner asks for the deletion: `confirm` must be the slug. The tenant is suspended at once (read-only for
 * everybody, its runs stop being scheduled) and deleted after `DELETION_DELAY_DAYS` days.
 */
export const requestDeletion = async (db: SaasDb, tenant: Pick<Tenant, 'id' | 'slug'>, { by, confirm, now = new Date() }: { by: string; confirm: unknown; now?: Date }): Promise<DeletionView> => {
  if (String(confirm ?? '').trim().toLowerCase() !== tenant.slug) throw new LifecycleError('Type the name of the Druid to confirm', 400);
  const deleteAfter = new Date(now.getTime() + DELETION_DELAY_DAYS * DAY_MS);
  const row = await db.updateTable('tenant').set({
    status_before_delete: sql`status` as any, status: 'suspended', delete_requested_at: now.toISOString(), delete_requested_by: normalizeEmail(by),
    delete_after: deleteAfter.toISOString(), updated_at: now.toISOString(),
  }).where('id', '=', tenant.id).where('status', 'in', ['active', 'suspended']).where('delete_after', 'is', null)
    .returning(['delete_requested_at', 'delete_requested_by', 'delete_after']).executeTakeFirst();
  if (!row) throw new LifecycleError('A deletion is already planned', 409);
  return deletionOf(row)!;
};

/** Cancels a planned deletion: the tenant gets back the status it had (a tenant the console had suspended stays so). */
export const cancelDeletion = async (db: SaasDb, tenantId: string): Promise<TenantStatus> => {
  const row = await db.updateTable('tenant').set({
    status: sql`coalesce(status_before_delete, 'active')` as any, status_before_delete: null, delete_requested_at: null, delete_requested_by: null,
    delete_after: null, updated_at: new Date().toISOString(),
  }).where('id', '=', tenantId).where('status', '=', 'suspended').where('delete_after', 'is not', null).returning('status').executeTakeFirst();
  if (!row) throw new LifecycleError('No deletion is planned', 409);
  return row.status;
};

/** Is the deletion of this tenant due (still asked, date passed)? The runner checks again before dropping anything. */
export const isDeletionDue = (t: Pick<Tenant, 'status' | 'delete_after'>, now = new Date()): boolean =>
  t.status === 'suspended' && !!t.delete_after && new Date(t.delete_after).getTime() <= now.getTime();

/** Tenants whose deletion is due and that have no `tenant.delete` queued, running or failed in the last day. */
export const dueDeletions = async (db: SaasDb, now = new Date()): Promise<{ id: string; slug: string }[]> =>
  db.selectFrom('tenant').select(['id', 'slug']).where('status', '=', 'suspended').where('delete_after', '<=', now.toISOString())
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom('job').select('job.id').whereRef('job.tenant_id', '=', 'tenant.id').where('job.type', '=', 'tenant.delete')
      .where((eb) => eb.or([eb('job.status', 'in', ['queued', 'running']), eb.and([eb('job.status', '=', 'failed'), eb('job.created_at', '>', new Date(now.getTime() - DAY_MS).toISOString())])])))))
    .orderBy('delete_after').execute();

/** Slug and schema name a deleted tenant keeps, so that its establishment can come back under its own name. */
export const tombstoneOf = (tenantId: string): { slug: string; schema: string } => {
  const hex = tenantId.replace(/-/g, '').slice(0, 12).toLowerCase();
  return { slug: `deleted-${hex}`, schema: `t_deleted_${hex}` };
};

/**
 * Last step of a deletion, once the schema and the files are gone: every row naming a person is removed (members,
 * sessions, links, secrets, requests, the other jobs), the hosts are freed, and the tenant row stays as a tombstone
 * (status `deleted`, slug and schema renamed, label and dates kept for the journal of the console).
 */
export const tombstoneTenant = async (db: SaasDb, tenantId: string, keepJobId: string): Promise<void> => {
  const { slug, schema } = tombstoneOf(tenantId);
  await db.transaction().execute(async (trx) => {
    for (const table of ['member', 'session', 'magic_link', 'tenant_secret', 'tenant_key_check', 'access_request', 'quote_request', 'tenant_host'] as const) {
      await trx.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
    }
    await trx.deleteFrom('job').where('tenant_id', '=', tenantId).where('id', '<>', keepJobId).execute();
    await trx.updateTable('job').set({ created_by: null, params: {} }).where('id', '=', keepJobId).execute();
    await trx.updateTable('tenant').set({
      status: 'deleted', slug, schema_name: schema, mail_domains: [], settings: {}, onboarding: null, created_by: null,
      delete_requested_by: null, status_before_delete: null, updated_at: new Date().toISOString(),
    }).where('id', '=', tenantId).execute();
  });
};
