/**
 * @file members.ts
 * @description Accounts of a tenant (druid-internal docs/plan-druid-saas.md, lot 6 a-1): the members and their roles,
 * the invitations within the seats of the plan, the access requests of colleagues, the mail domains. The « My
 * institution » tab of the Administration page (functions/api/tenant) calls these; the rules live here so that the
 * DirlaData console (lot 6 c) reuses them.
 *
 * An invitation is a member row whose `last_login_at` is still null, plus an e-mail pointing to the login page of the
 * tenant: the invitee asks for a magic link there like any member (no long-lived token in a mailbox).
 */
import { sql } from 'kysely';
import { emailDomain, isValidEmail, normalizeAcronym, normalizeEmail, type Member, type MemberRole, type Plan, type SaasDb, type Tenant } from './controlPlane';

export const MEMBER_ROLES: MemberRole[] = ['owner', 'admin', 'viewer', 'lab'];
export const isMemberRole = (v: unknown): v is MemberRole => MEMBER_ROLES.includes(v as MemberRole);
export const MAX_MAIL_DOMAINS = 10;
const DOMAIN_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A refusal of an account operation: HTTP status + English message (lib/apiErrors.ts). */
export class MemberError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface MemberView {
  id: string;
  email: string;
  role: MemberRole;
  labScope: string[];
  invitedBy: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** Invited, never signed in. */
  pending: boolean;
}
export const memberView = (m: Member): MemberView => ({
  id: m.id, email: m.email, role: m.role, labScope: m.lab_scope || [], invitedBy: m.invited_by,
  createdAt: String(m.created_at), lastLoginAt: m.last_login_at ? String(m.last_login_at) : null, pending: !m.last_login_at,
});

export const listMembers = async (db: SaasDb, tenantId: string): Promise<MemberView[]> =>
  (await db.selectFrom('member').selectAll().where('tenant_id', '=', tenantId).orderBy('created_at').execute()).map(memberView);

export interface AccessRequestView { id: string; email: string; note: string | null; createdAt: string }
export const listAccessRequests = async (db: SaasDb, tenantId: string): Promise<AccessRequestView[]> =>
  (await db.selectFrom('access_request').selectAll().where('tenant_id', '=', tenantId).where('handled_at', 'is', null).orderBy('created_at').execute())
    .map((r) => ({ id: r.id, email: r.email, note: r.note, createdAt: String(r.created_at) }));

/** Seats of the plan: used (every member, the invited ones included) and allowed (null = unlimited). */
export const seatsOf = async (db: SaasDb, tenant: Pick<Tenant, 'id'>, plan: Pick<Plan, 'seats'> | null): Promise<{ used: number; allowed: number | null }> => {
  const row = await db.selectFrom('member').select(({ fn }) => fn.countAll<string>().as('n')).where('tenant_id', '=', tenant.id).executeTakeFirst();
  return { used: Number(row?.n || 0), allowed: plan?.seats ?? null };
};

/** The lab acronyms of a `lab` member (required for that role, ignored for the others). */
const labScopeOf = (role: MemberRole, labScope: unknown): string[] => {
  if (role !== 'lab') return [];
  const labs = [...new Set((Array.isArray(labScope) ? labScope : []).map((l) => String(l || '').trim()).filter(Boolean))].slice(0, 50);
  if (!labs.length || labs.some((l) => !normalizeAcronym(l))) throw new MemberError(400, 'A lab account needs at least one lab');
  return labs;
};

export interface InviteInput { email: string; role: MemberRole; labScope?: string[]; invitedBy: string }

/** Adds a member within the seats of the plan: 409 when the address is already a member or the plan is full. */
export const inviteMember = async (db: SaasDb, tenant: Pick<Tenant, 'id'>, plan: Pick<Plan, 'seats'> | null, input: InviteInput): Promise<MemberView> => {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new MemberError(400, 'Invalid e-mail address');
  if (!isMemberRole(input.role)) throw new MemberError(400, 'Unknown role');
  const labScope = labScopeOf(input.role, input.labScope);
  return db.transaction().execute(async (trx) => {
    // One invitation at a time per tenant: the seat count and the insert cannot interleave.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`druid.members.${tenant.id}`}))`.execute(trx);
    if (await trx.selectFrom('member').select('id').where('tenant_id', '=', tenant.id).where('email', '=', email).executeTakeFirst()) {
      throw new MemberError(409, 'This address is already a member');
    }
    const { used, allowed } = await seatsOf(trx as unknown as SaasDb, tenant, plan);
    if (allowed !== null && used >= allowed) throw new MemberError(409, 'Account limit of the plan reached');
    const row = await trx.insertInto('member').values({ tenant_id: tenant.id, email, role: input.role, lab_scope: labScope, invited_by: normalizeEmail(input.invitedBy) || null })
      .returningAll().executeTakeFirstOrThrow();
    // A pending access request of this address is answered by the invitation.
    await trx.updateTable('access_request').set({ handled_at: sql`now()` as any }).where('tenant_id', '=', tenant.id).where('email', '=', email).where('handled_at', 'is', null).execute();
    return memberView(row);
  });
};

const ownersOf = async (db: SaasDb, tenantId: string): Promise<number> => {
  const row = await db.selectFrom('member').select(({ fn }) => fn.countAll<string>().as('n')).where('tenant_id', '=', tenantId).where('role', '=', 'owner').executeTakeFirst();
  return Number(row?.n || 0);
};

const memberOfTenant = async (db: SaasDb, tenantId: string, memberId: string): Promise<Member> => {
  const m = await db.selectFrom('member').selectAll().where('tenant_id', '=', tenantId).where('id', '=', memberId).executeTakeFirst();
  if (!m) throw new MemberError(404, 'Member not found');
  return m;
};

/** Changes the role (and labs) of a member; the last owner keeps the role. */
export const updateMember = async (db: SaasDb, tenantId: string, memberId: string, input: { role: MemberRole; labScope?: string[] }): Promise<MemberView> => {
  if (!isMemberRole(input.role)) throw new MemberError(400, 'Unknown role');
  const labScope = labScopeOf(input.role, input.labScope);
  return db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`druid.members.${tenantId}`}))`.execute(trx);
    const m = await memberOfTenant(trx as unknown as SaasDb, tenantId, memberId);
    if (m.role === 'owner' && input.role !== 'owner' && (await ownersOf(trx as unknown as SaasDb, tenantId)) <= 1) {
      throw new MemberError(409, 'The last owner of a Druid keeps the role');
    }
    const row = await trx.updateTable('member').set({ role: input.role, lab_scope: labScope }).where('id', '=', m.id).returningAll().executeTakeFirstOrThrow();
    return memberView(row);
  });
};

/** Removes a member and closes their sessions on the tenant; never the last owner. */
export const removeMember = async (db: SaasDb, tenantId: string, memberId: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`druid.members.${tenantId}`}))`.execute(trx);
    const m = await memberOfTenant(trx as unknown as SaasDb, tenantId, memberId);
    if (m.role === 'owner' && (await ownersOf(trx as unknown as SaasDb, tenantId)) <= 1) throw new MemberError(409, 'The last owner of a Druid cannot be removed');
    await trx.deleteFrom('session').where('tenant_id', '=', tenantId).where('email', '=', m.email).execute();
    await trx.deleteFrom('member').where('id', '=', m.id).execute();
  });
};

export const findMemberById = (db: SaasDb, tenantId: string, memberId: string): Promise<Member> => memberOfTenant(db, tenantId, memberId);

/** Answers an access request without inviting (« Dismiss »). */
export const dismissAccessRequest = async (db: SaasDb, tenantId: string, requestId: string): Promise<void> => {
  const r = await db.updateTable('access_request').set({ handled_at: sql`now()` as any }).where('tenant_id', '=', tenantId).where('id', '=', requestId)
    .where('handled_at', 'is', null).executeTakeFirst();
  if (!Number(r.numUpdatedRows)) throw new MemberError(404, 'Access request not found');
};

export const findAccessRequest = async (db: SaasDb, tenantId: string, requestId: string): Promise<{ id: string; email: string }> => {
  const r = await db.selectFrom('access_request').select(['id', 'email']).where('tenant_id', '=', tenantId).where('id', '=', requestId).where('handled_at', 'is', null).executeTakeFirst();
  if (!r) throw new MemberError(404, 'Access request not found');
  return r;
};

/** Normalized mail domains (`@Univ-X.fr` → `univ-x.fr`), at most MAX_MAIL_DOMAINS; 400 on an invalid one. */
export const normalizeMailDomains = (raw: unknown): string[] => {
  const list = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,;]+/)).map((d) => String(d || '').trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const out = [...new Set(list)];
  if (out.length > MAX_MAIL_DOMAINS) throw new MemberError(400, 'Too many mail domains');
  if (out.some((d) => !DOMAIN_RE.test(d))) throw new MemberError(400, 'Invalid mail domain');
  return out;
};

export const setMailDomains = async (db: SaasDb, tenantId: string, raw: unknown): Promise<string[]> => {
  const domains = normalizeMailDomains(raw);
  await db.updateTable('tenant').set({ mail_domains: domains, updated_at: sql`now()` as any }).where('id', '=', tenantId).execute();
  return domains;
};

/** May a non-member ask for access from the login page: an address of one of the tenant's mail domains. */
export const mayAskAccess = (tenant: Pick<Tenant, 'mail_domains'>, email: string): boolean => tenant.mail_domains.includes(emailDomain(email));

/** E-mail addresses of the owners (notices of access requests). */
export const ownerEmails = async (db: SaasDb, tenantId: string): Promise<string[]> =>
  (await db.selectFrom('member').select('email').where('tenant_id', '=', tenantId).where('role', '=', 'owner').orderBy('created_at').execute()).map((r) => r.email);
