// « My institution » of a tenant (druid-internal docs/plan-druid-saas.md, lot 6 a-1), for the owners — the admins read:
//   GET    /api/tenant                              plan, seats, members, pending access requests, mail domains
//   POST   /api/tenant/members { email, role, labScope? }   invites (within the seats of the plan) → 201 + e-mail
//   PATCH  /api/tenant/members/:id { role, labScope? }      changes the role (the last owner keeps it)
//   DELETE /api/tenant/members/:id                          removes the member, closes their sessions
//   POST   /api/tenant/members/:id/resend                   sends the invitation again
//   POST   /api/tenant/access-requests/:id/accept { role, labScope? }   invites the requester
//   POST   /api/tenant/access-requests/:id/dismiss
//   PUT    /api/tenant/mail-domains { mailDomains: [] }
// The rules (seats, last owner, domains) live in lib/saas/members.ts.
import {
  MemberError, dismissAccessRequest, findAccessRequest, findMemberById, inviteMember, listAccessRequests, listMembers, removeMember, seatsOf,
  setMailDomains, updateMember,
} from '../../../lib/saas/members.ts';
import { sendInvitation } from '../../_lib/email.js';
import { forgetHost, json, withSaasDb } from '../../_lib/saas.js';
import { tenantMember } from '../../_lib/jobs.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Invitation e-mail (the login page of the tenant, address prefilled); a failure does not undo the invitation. */
const invite = async (context, instance, inviter, member) => {
  const origin = new URL(context.request.url).origin;
  const loginUrl = `${origin}/auth/login?email=${encodeURIComponent(member.email)}`;
  if (!context.env.RESEND_API_KEY) return { sent: false, loginUrl };
  try {
    await sendInvitation(context.env, { to: member.email, label: instance.label, loginUrl, invitedBy: inviter, role: member.role });
    return { sent: true };
  } catch (err) {
    console.error(JSON.stringify({ event: 'tenant.invitation.failed', instance: instance.slug, error: String(err?.message || err) }));
    return { sent: false, loginUrl };
  }
};

export async function onRequest(context) {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  const { instance, identity, member } = t;
  const { request } = context;
  const method = request.method;
  const parts = new URL(request.url).pathname.replace(/^\/api\/tenant\/?/, '').replace(/\/$/, '').split('/').filter(Boolean);
  const isOwner = member.role === 'owner';
  if (!isOwner && member.role !== 'admin') return json(403, { error: 'Owner right required' });
  if (method !== 'GET') {
    if (!isOwner) return json(403, { error: 'Owner right required' });
    if (instance.readOnly) return json(403, { error: 'Read-only instance: writes are disabled' });
  }
  const tenant = instance.tenant;
  try {
    return await withSaasDb(context.env, async (db) => {
      if (!parts.length && method === 'GET') {
        const row = await db.selectFrom('tenant').select(['label', 'mail_domains', 'created_at']).where('id', '=', tenant.id).executeTakeFirstOrThrow();
        const plans = await db.selectFrom('plan').select(['code', 'label', 'seats', 'history_years', 'refresh', 'features']).orderBy('created_at').execute();
        return json(200, {
          slug: tenant.slug, label: row.label, status: tenant.status, createdAt: row.created_at,
          plan: tenant.plan ? { code: tenant.plan.code, label: tenant.plan.label, seats: tenant.plan.seats, historyYears: tenant.plan.history_years, refresh: tenant.plan.refresh, features: tenant.plan.features } : null,
          plans: plans.map((p) => ({ code: p.code, label: p.label, seats: p.seats, historyYears: p.history_years, refresh: p.refresh, features: p.features })),
          seats: await seatsOf(db, tenant, tenant.plan),
          members: await listMembers(db, tenant.id),
          accessRequests: await listAccessRequests(db, tenant.id),
          mailDomains: row.mail_domains,
          me: { email: identity, role: member.role },
        });
      }
      // An empty body is fine (resend, dismiss); a body that is not JSON is not.
      let body = {};
      if (method !== 'GET' && method !== 'DELETE') {
        const text = await request.text();
        try { body = text.trim() ? JSON.parse(text) || {} : {}; } catch { return json(400, { error: 'Invalid request' }); }
      }
      const [section, id, action] = parts;
      if (id && !UUID_RE.test(id)) return json(404, { error: 'Not found' });
      if (section === 'members' && !id && method === 'POST') {
        const created = await inviteMember(db, tenant, tenant.plan, { email: body.email, role: body.role, labScope: body.labScope, invitedBy: identity });
        console.log(JSON.stringify({ event: 'tenant.member.invited', instance: instance.slug, role: created.role }));
        return json(201, { member: created, ...(await invite(context, instance, identity, created)) });
      }
      if (section === 'members' && id && !action && method === 'PATCH') {
        return json(200, { member: await updateMember(db, tenant.id, id, { role: body.role, labScope: body.labScope }) });
      }
      if (section === 'members' && id && !action && method === 'DELETE') {
        await removeMember(db, tenant.id, id);
        console.log(JSON.stringify({ event: 'tenant.member.removed', instance: instance.slug }));
        return json(200, { removed: true });
      }
      if (section === 'members' && id && action === 'resend' && method === 'POST') {
        const m = await findMemberById(db, tenant.id, id);
        return json(200, await invite(context, instance, identity, m));
      }
      if (section === 'access-requests' && id && action === 'accept' && method === 'POST') {
        const r = await findAccessRequest(db, tenant.id, id);
        const created = await inviteMember(db, tenant, tenant.plan, { email: r.email, role: body.role || 'viewer', labScope: body.labScope, invitedBy: identity });
        return json(201, { member: created, ...(await invite(context, instance, identity, created)) });
      }
      if (section === 'access-requests' && id && action === 'dismiss' && method === 'POST') {
        await dismissAccessRequest(db, tenant.id, id);
        return json(200, { dismissed: true });
      }
      if (section === 'mail-domains' && !id && method === 'PUT') {
        const mailDomains = await setMailDomains(db, tenant.id, body.mailDomains);
        // The tenant (and its mail domains) is cached per host: the next login request reads the new list.
        // (this isolate at once; the KV registry and the other isolates within their cache period, 5 min at most).
        forgetHost(new URL(request.url).host);
        return json(200, { mailDomains });
      }
      return json(404, { error: 'Not found' });
    });
  } catch (err) {
    if (err instanceof MemberError) return json(err.status, { error: err.message });
    throw err;
  }
}

