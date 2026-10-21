/**
 * @file controlPlane.ts
 * @description Control plane of a multi-tenant Druid deployment (druid-internal docs/plan-druid-saas.md, lot 1):
 * the `saas` schema (db/saas/migrations) read by the Cloudflare Functions and by the jobs — tenants and their hosts,
 * plans, members, magic links and sessions. Pure helpers (host → schema name, member → rights, plan → capabilities)
 * live here too, so that the same rules apply to every runtime and can be unit-tested without a database.
 *
 * The tables of a tenant live in its own schema (`schema_name`, migrated from db/migrations); this module never reads
 * them — lib/db/core.ts opens a client on that schema for the directory repository.
 */
import type { Generated, Kysely, Selectable } from 'kysely';
import { sql } from 'kysely';

// ── Tables of the saas schema ─────────────────────────────────────────────────────────────────────────────────────────
export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'deleted';
export type MemberRole = 'owner' | 'admin' | 'viewer' | 'lab';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface PlanTable {
  code: string;
  label: string;
  seats: number | null;
  history_years: number | null;
  refresh: 'monthly' | 'weekly' | 'daily';
  capabilities: Record<string, boolean>;
  features: Record<string, unknown>;
  created_at: Generated<string>;
}
export interface TenantTable {
  id: Generated<string>;
  slug: string;
  label: string;
  schema_name: string;
  status: Generated<TenantStatus>;
  plan_code: Generated<string>;
  ror: string | null;
  uai: string | null;
  country: string | null;
  mail_domains: Generated<string[]>;
  settings: Generated<Record<string, unknown>>;
  created_by: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}
export interface TenantHostTable {
  host: string;
  tenant_id: string;
  is_primary: Generated<boolean>;
  created_at: Generated<string>;
}
export interface MemberTable {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  role: MemberRole;
  lab_scope: Generated<string[]>;
  invited_by: string | null;
  created_at: Generated<string>;
  last_login_at: string | null;
}
export interface MagicLinkTable {
  id: Generated<string>;
  email: string;
  tenant_id: string | null;
  token_hash: string;
  next_path: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: Generated<string>;
}
export interface SessionTable {
  id: Generated<string>;
  email: string;
  tenant_id: string | null;
  expires_at: string;
  created_at: Generated<string>;
  last_seen_at: Generated<string>;
  user_agent: string | null;
}
export interface JobTable {
  id: Generated<string>;
  tenant_id: string;
  type: string;
  params: Generated<Record<string, unknown>>;
  status: Generated<JobStatus>;
  progress: Generated<Record<string, unknown>>;
  log: string | null;
  attempts: Generated<number>;
  created_by: string | null;
  created_at: Generated<string>;
  started_at: string | null;
  finished_at: string | null;
}
export interface TenantSecretTable {
  tenant_id: string;
  name: string;
  ciphertext: string;
  iv: string;
  updated_at: Generated<string>;
}
export interface SaasDB {
  plan: PlanTable;
  tenant: TenantTable;
  tenant_host: TenantHostTable;
  member: MemberTable;
  magic_link: MagicLinkTable;
  session: SessionTable;
  job: JobTable;
  tenant_secret: TenantSecretTable;
}
export type SaasDb = Kysely<SaasDB>;
export type Tenant = Selectable<TenantTable>;
export type Plan = Selectable<PlanTable>;
export type Member = Selectable<MemberTable>;

/** Schema of the control plane; the client is opened with `schema: SAAS_SCHEMA` (lib/db/core.ts). */
export const SAAS_SCHEMA = 'saas';

// ── Pure rules ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Sub-domains that can never be a tenant (site, portal, demos, mail). */
export const RESERVED_SLUGS = ['www', 'app', 'api', 'demo', 'demo-2', 'admin', 'mail', 'send', 'druid', 'static', 'status'];

export const isValidSlug = (slug: string): boolean => SLUG_RE.test(slug) && !RESERVED_SLUGS.includes(slug);

/** PostgreSQL schema of a tenant: `t_<slug>` with `-` → `_` (an identifier, never quoted elsewhere). */
export const tenantSchemaName = (slug: string): string => {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid tenant slug "${slug}"`);
  return `t_${slug.replace(/-/g, '_')}`;
};

/** Request host as stored in tenant_host: lower case, no port, no trailing dot. */
export const normalizeHost = (host: string): string =>
  String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '').replace(/\.$/, '');

export const normalizeEmail = (email: string): string => String(email || '').trim().toLowerCase();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email);
export const emailDomain = (email: string): string => normalizeEmail(email).split('@')[1] || '';

/** Same rule as lib/normalize.ts normalizeAcronym and server.cjs (scope anchors are compared on normalized acronyms). */
export const normalizeAcronym = (s: string): string =>
  String(s).toLowerCase().split('²').join('2').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');

/** Rights of the front (lib/auth.ts DruidAccess) and roles, from a member row. */
export interface MemberAccess {
  roles: string[];
  access: { isSuperAdmin: boolean; isMediaAdmin: boolean; isLabViewer: boolean; annuaireLabs: string[]; allowedSlugs: 'all' | string[] };
  /** Scope of the domain API (lib/directory/api.ts): everything, or the labs of the member. */
  scope: { all: boolean; labAnchors: string[] };
}
export const accessForMember = (member: Pick<Member, 'role' | 'lab_scope'> | null, readOnly = false): MemberAccess => {
  const role = member?.role;
  const labAnchors = (member?.lab_scope || []).map(normalizeAcronym).filter(Boolean);
  // A read-only tenant (suspended): nobody administers anything, everybody still reads what their role allows.
  const isSuperAdmin = !readOnly && role === 'owner';
  const establishment = role === 'owner' || role === 'admin' || role === 'viewer';
  const roles = ['user'];
  if (isSuperAdmin || (!readOnly && role === 'admin')) roles.push('admin');
  if (establishment || role === 'lab') roles.push('dashboard_viewer');
  return {
    roles,
    access: { isSuperAdmin, isMediaAdmin: false, isLabViewer: false, annuaireLabs: [], allowedSlugs: establishment ? 'all' : labAnchors },
    scope: establishment ? { all: true, labAnchors: [] } : { all: false, labAnchors },
  };
};

/** Capabilities of a tenant: the structural ones of the runtime, then the plan, then the tenant's own overrides. */
export const capabilitiesForTenant = (
  base: Record<string, boolean>,
  plan: Pick<Plan, 'capabilities'> | null,
  tenant: Pick<Tenant, 'settings' | 'status'>,
): Record<string, boolean> => {
  const overrides = (tenant.settings?.capabilities && typeof tenant.settings.capabilities === 'object'
    ? tenant.settings.capabilities : {}) as Record<string, boolean>;
  const out: Record<string, boolean> = { ...base };
  for (const src of [plan?.capabilities || {}, overrides]) {
    for (const [k, v] of Object.entries(src)) if (k in base) out[k] = !!v;
  }
  if (tenant.status !== 'active') out.READ_ONLY = true;
  return out;
};

/** Public block `tenant` of /api/me: what the front shows (plan, locked features, seats) — never an id or a secret. */
export const publicTenantInfo = (tenant: Tenant, plan: Plan | null, memberCount: number) => ({
  slug: tenant.slug,
  status: tenant.status,
  plan: plan ? { code: plan.code, label: plan.label, seats: plan.seats, historyYears: plan.history_years, refresh: plan.refresh, features: plan.features } : null,
  members: memberCount,
  mailDomains: tenant.mail_domains,
});

// ── Queries ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TenantByHost { tenant: Tenant; plan: Plan | null }

/** Tenant serving `host`, with its plan; null when no active or suspended tenant declares it. */
export const findTenantByHost = async (db: SaasDb, host: string): Promise<TenantByHost | null> => {
  const h = normalizeHost(host);
  if (!h) return null;
  const tenant = await db.selectFrom('tenant_host').innerJoin('tenant', 'tenant.id', 'tenant_host.tenant_id')
    .selectAll('tenant').where('tenant_host.host', '=', h).where('tenant.status', '<>', 'deleted').executeTakeFirst();
  if (!tenant) return null;
  const plan = (await db.selectFrom('plan').selectAll().where('code', '=', tenant.plan_code).executeTakeFirst()) || null;
  return { tenant, plan };
};

export const findTenantBySlug = async (db: SaasDb, slug: string): Promise<Tenant | null> =>
  (await db.selectFrom('tenant').selectAll().where('slug', '=', slug).executeTakeFirst()) || null;

export const findMember = async (db: SaasDb, tenantId: string, email: string): Promise<Member | null> =>
  (await db.selectFrom('member').selectAll().where('tenant_id', '=', tenantId).where('email', '=', normalizeEmail(email)).executeTakeFirst()) || null;

export const countMembers = async (db: SaasDb, tenantId: string): Promise<number> => {
  const row = await db.selectFrom('member').select(({ fn }) => fn.countAll<string>().as('n')).where('tenant_id', '=', tenantId).executeTakeFirst();
  return Number(row?.n || 0);
};

/** May `email` receive a magic link for this tenant: a member, or an address of one of its mail domains. */
export const mayRequestLink = (tenant: Pick<Tenant, 'mail_domains'>, member: Member | null, email: string): boolean =>
  !!member || tenant.mail_domains.includes(emailDomain(email));

export interface MagicLinkInput { email: string; tenantId: string | null; tokenHash: string; nextPath?: string | null; ttlMinutes?: number }
export const createMagicLink = async (db: SaasDb, { email, tenantId, tokenHash, nextPath = null, ttlMinutes = 15 }: MagicLinkInput): Promise<void> => {
  await db.insertInto('magic_link').values({
    email: normalizeEmail(email), tenant_id: tenantId, token_hash: tokenHash, next_path: nextPath,
    expires_at: sql<string>`now() + make_interval(mins => ${ttlMinutes})`,
  }).execute();
};

/** Consumes a link once (atomic UPDATE): the row, or null when unknown, expired or already used. */
export const consumeMagicLink = async (db: SaasDb, tokenHash: string): Promise<Selectable<MagicLinkTable> | null> =>
  (await db.updateTable('magic_link').set({ consumed_at: sql<string>`now()` })
    .where('token_hash', '=', tokenHash).where('consumed_at', 'is', null).where('expires_at', '>', sql<string>`now()`)
    .returningAll().executeTakeFirst()) || null;

export interface SessionInput { email: string; tenantId: string | null; userAgent?: string | null; ttlDays?: number }
export const createSession = async (db: SaasDb, { email, tenantId, userAgent = null, ttlDays = 30 }: SessionInput): Promise<string> => {
  const row = await db.insertInto('session').values({
    email: normalizeEmail(email), tenant_id: tenantId, user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
    expires_at: sql<string>`now() + make_interval(days => ${ttlDays})`,
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** E-mail of a live session of this tenant (the cookie of another host never opens this one), or null. */
export const sessionEmail = async (db: SaasDb, sessionId: string | null, tenantId: string | null): Promise<string | null> => {
  if (!sessionId || !UUID_RE.test(sessionId)) return null;
  let q = db.selectFrom('session').select('email').where('id', '=', sessionId).where('expires_at', '>', sql<string>`now()`);
  q = tenantId === null ? q.where('tenant_id', 'is', null) : q.where('tenant_id', '=', tenantId);
  const row = await q.executeTakeFirst();
  return row?.email || null;
};

export const deleteSession = async (db: SaasDb, sessionId: string | null): Promise<void> => {
  if (!sessionId || !UUID_RE.test(sessionId)) return;
  await db.deleteFrom('session').where('id', '=', sessionId).execute();
};

export const touchLogin = async (db: SaasDb, tenantId: string, email: string): Promise<void> => {
  await db.updateTable('member').set({ last_login_at: sql<string>`now()` }).where('tenant_id', '=', tenantId).where('email', '=', normalizeEmail(email)).execute();
};
