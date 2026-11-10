/**
 * @file console.ts
 * @description DirlaData console (druid-internal docs/plan-druid-saas.md, lot 6 c): what the super-administration on
 * `SAAS_ADMIN_HOST` reads and changes in the control plane — the tenants and their activity, the plan and the status
 * of a tenant, the relaunch of a job, the journal of the console (`console_event`). Access: a console session
 * (`session.kind = 'console'`) of an address of `SAAS_SUPERADMIN_EMAILS` (functions/console).
 */
import { sql } from 'kysely';
import { liveJob } from './jobs';
import { normalizeEmail, publicJobInfo, type Job, type SaasDb, type Tenant } from './controlPlane';
import { redactSecrets } from './redact';
import { cancelDeletion, deletionOf } from './lifecycle';

/** Addresses allowed on the console (comma, space or semicolon separated). */
export const superadminEmails = (raw: unknown): string[] =>
  [...new Set(String(raw || '').split(/[\s,;]+/).map(normalizeEmail).filter((e) => e.includes('@')))];
export const isSuperadmin = (raw: unknown, email: string | null | undefined): boolean =>
  !!email && superadminEmails(raw).includes(normalizeEmail(email));

export class ConsoleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface TenantOverview {
  slug: string; label: string; status: Tenant['status']; plan: string; host: string | null; createdAt: string;
  members: number; lastLoginAt: string | null;
  lastJob: { type: string; status: string; createdAt: string } | null;
  failedJobs7d: number;
  pendingQuotes: number;
  /** Deletion planned by the owner (lot 6 a-3). */
  deleteAfter: string | null;
}

/** Every tenant but the deleted ones, newest first, with what the console list shows. */
export const tenantsOverview = async (db: SaasDb): Promise<TenantOverview[]> => {
  const rows = await db.selectFrom('tenant').select(['id', 'slug', 'label', 'status', 'plan_code', 'created_at', 'delete_after'])
    .select((eb) => [
      eb.selectFrom('tenant_host').select('host').whereRef('tenant_host.tenant_id', '=', 'tenant.id').where('is_primary', '=', true).limit(1).as('host'),
      eb.selectFrom('member').select(eb.fn.countAll<string>().as('n')).whereRef('member.tenant_id', '=', 'tenant.id').as('members'),
      eb.selectFrom('member').select((sub) => sub.fn.max('member.last_login_at').as('m')).whereRef('member.tenant_id', '=', 'tenant.id').as('last_login'),
      eb.selectFrom('job').select(eb.fn.countAll<string>().as('n')).whereRef('job.tenant_id', '=', 'tenant.id').where('status', '=', 'failed')
        .where('created_at', '>', sql<string>`now() - interval '7 days'`).as('failed7'),
      eb.selectFrom('quote_request').select(eb.fn.countAll<string>().as('n')).whereRef('quote_request.tenant_id', '=', 'tenant.id').where('handled_at', 'is', null).as('quotes'),
    ])
    .where('status', '<>', 'deleted').orderBy('created_at', 'desc').execute();
  const out: TenantOverview[] = [];
  for (const r of rows as any[]) {
    const last = await db.selectFrom('job').select(['type', 'status', 'created_at']).where('tenant_id', '=', r.id).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    out.push({
      slug: r.slug, label: r.label, status: r.status, plan: r.plan_code, host: r.host ?? null, createdAt: String(r.created_at),
      members: Number(r.members || 0), lastLoginAt: r.last_login ? String(r.last_login) : null,
      lastJob: last ? { type: last.type, status: last.status, createdAt: String(last.created_at) } : null,
      failedJobs7d: Number(r.failed7 || 0),
      pendingQuotes: Number(r.quotes || 0),
      deleteAfter: r.delete_after ? new Date(r.delete_after).toISOString() : null,
    });
  }
  return out;
};

export const tenantBySlug = async (db: SaasDb, slug: string): Promise<Tenant> => {
  const t = await db.selectFrom('tenant').selectAll().where('slug', '=', slug).where('status', '<>', 'deleted').executeTakeFirst();
  if (!t) throw new ConsoleError(404, 'Unknown tenant');
  return t;
};

/** The tenant page: facts, hosts, members, the latest jobs (log tail masked), access requests, journal. */
export const tenantDetail = async (db: SaasDb, slug: string) => {
  const t = await tenantBySlug(db, slug);
  const [hosts, members, jobs, accessRequests, events, plans, quotes] = await Promise.all([
    db.selectFrom('tenant_host').select(['host', 'is_primary']).where('tenant_id', '=', t.id).orderBy('host').execute(),
    db.selectFrom('member').select(['id', 'email', 'role', 'lab_scope', 'created_at', 'last_login_at']).where('tenant_id', '=', t.id).orderBy('created_at').execute(),
    db.selectFrom('job').selectAll().where('tenant_id', '=', t.id).orderBy('created_at', 'desc').limit(30).execute(),
    db.selectFrom('access_request').select(['email', 'created_at', 'handled_at']).where('tenant_id', '=', t.id).orderBy('created_at', 'desc').limit(30).execute(),
    db.selectFrom('console_event').select(['at', 'actor', 'action', 'details']).where('tenant_id', '=', t.id).orderBy('at', 'desc').limit(30).execute(),
    db.selectFrom('plan').select(['code', 'label', 'seats']).execute(),
    db.selectFrom('quote_request').selectAll().where('tenant_id', '=', t.id).orderBy('created_at', 'desc').limit(30).execute(),
  ]);
  return {
    tenant: {
      slug: t.slug, label: t.label, status: t.status, plan: t.plan_code, schema: t.schema_name, ror: t.ror, uai: t.uai,
      mailDomains: t.mail_domains, createdBy: t.created_by, createdAt: String(t.created_at),
      deletion: deletionOf(t),
    },
    plans: plans.map((p) => ({ code: p.code, label: p.label, seats: p.seats })),
    hosts,
    members: members.map((m) => ({ id: m.id, email: m.email, role: m.role, labScope: m.lab_scope, createdAt: String(m.created_at), lastLoginAt: m.last_login_at ? String(m.last_login_at) : null })),
    jobs: jobs.map((j: Job) => ({ ...publicJobInfo(j), logTail: redactSecrets(String(j.log || '').slice(-3000)) })),
    accessRequests: accessRequests.map((r) => ({ email: r.email, createdAt: String(r.created_at), handledAt: r.handled_at ? String(r.handled_at) : null })),
    events: events.map((e) => ({ at: String(e.at), actor: e.actor, action: e.action, details: e.details })),
    quotes: quotes.map((q) => ({
      id: q.id, email: q.email, plan: q.plan_code, researchers: q.researchers, accounts: q.accounts, message: q.message, feature: q.feature,
      createdAt: String(q.created_at), handledAt: q.handled_at ? String(q.handled_at) : null,
    })),
  };
};

/** A quote request answered (lot 6 b requests, handled here). */
export const markQuoteHandled = async (db: SaasDb, slug: string, quoteId: string, actor: string): Promise<void> => {
  const t = await tenantBySlug(db, slug);
  const r = await db.updateTable('quote_request').set({ handled_at: sql`now()` as any }).where('tenant_id', '=', t.id).where('id', '=', quoteId)
    .where('handled_at', 'is', null).executeTakeFirst();
  if (!Number(r.numUpdatedRows)) throw new ConsoleError(404, 'Quote request not found');
  await logConsole(db, { actor, action: 'quote-handled', tenantId: t.id, details: { quote: quoteId } });
};

export const logConsole = async (db: SaasDb, { actor, action, tenantId = null, details = {} }: { actor: string; action: string; tenantId?: string | null; details?: Record<string, unknown> }): Promise<void> => {
  await db.insertInto('console_event').values({ actor: normalizeEmail(actor), action, tenant_id: tenantId, details: JSON.stringify(details) as any }).execute();
};

/** Changes the plan of a tenant (the console is the only way: D11, activation after the purchase order). */
export const setTenantPlan = async (db: SaasDb, slug: string, planCode: string, actor: string): Promise<{ from: string; to: string }> => {
  const t = await tenantBySlug(db, slug);
  if (!(await db.selectFrom('plan').select('code').where('code', '=', planCode).executeTakeFirst())) throw new ConsoleError(400, 'Unknown plan');
  if (t.plan_code === planCode) return { from: planCode, to: planCode };
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('tenant').set({ plan_code: planCode, updated_at: sql`now()` as any }).where('id', '=', t.id).execute();
    await logConsole(trx as unknown as SaasDb, { actor, action: 'plan', tenantId: t.id, details: { from: t.plan_code, to: planCode } });
  });
  return { from: t.plan_code, to: planCode };
};

/** Suspends (read-only for everybody) or reactivates an active tenant; a tenant being built is left alone. */
export const setTenantStatus = async (db: SaasDb, slug: string, status: 'active' | 'suspended', actor: string): Promise<void> => {
  const t = await tenantBySlug(db, slug);
  if (t.status !== 'active' && t.status !== 'suspended') throw new ConsoleError(409, 'Only an active or suspended tenant can change status');
  if (t.delete_after) throw new ConsoleError(409, 'A deletion is planned: cancel it first');
  if (t.status === status) return;
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('tenant').set({ status, updated_at: sql`now()` as any }).where('id', '=', t.id).execute();
    await logConsole(trx as unknown as SaasDb, { actor, action: status === 'suspended' ? 'suspend' : 'reactivate', tenantId: t.id });
  });
};

/** Cancels the deletion an owner asked (lot 6 a-3): the tenant gets back its previous status. */
export const cancelTenantDeletion = async (db: SaasDb, slug: string, actor: string): Promise<string> => {
  const t = await tenantBySlug(db, slug);
  if (!t.delete_after) throw new ConsoleError(409, 'No deletion is planned');
  const status = await cancelDeletion(db, t.id);
  await logConsole(db, { actor, action: 'deletion-cancelled', tenantId: t.id, details: { status, deleteAfter: new Date(t.delete_after).toISOString() } });
  return status;
};

/** Queues a job again (same type, parameters and key): 409 when one of its key is already queued or running. */
export const retryJob = async (db: SaasDb, slug: string, jobId: string, actor: string): Promise<string> => {
  const t = await tenantBySlug(db, slug);
  const job = await db.selectFrom('job').selectAll().where('id', '=', jobId).where('tenant_id', '=', t.id).executeTakeFirst();
  if (!job) throw new ConsoleError(404, 'Job not found');
  if (job.status === 'queued' || job.status === 'running') throw new ConsoleError(409, 'Job already running');
  if (await liveJob(db, t.id, job.key)) throw new ConsoleError(409, 'Job already running');
  const row = await db.insertInto('job').values({ tenant_id: t.id, type: job.type, key: job.key, params: job.params, created_by: `console:${normalizeEmail(actor)}` })
    .returning('id').executeTakeFirstOrThrow();
  await logConsole(db, { actor, action: 'retry', tenantId: t.id, details: { job: job.id, type: job.type, queued: row.id } });
  return row.id;
};

/** Journal of the console, newest first (every tenant). */
export const consoleEvents = async (db: SaasDb, limit = 100) =>
  (await db.selectFrom('console_event').leftJoin('tenant', 'tenant.id', 'console_event.tenant_id')
    .select(['console_event.at', 'console_event.actor', 'console_event.action', 'console_event.details', 'tenant.slug'])
    .orderBy('console_event.at', 'desc').limit(limit).execute())
    .map((e) => ({ at: String(e.at), actor: e.actor, action: e.action, details: e.details, slug: e.slug }));
