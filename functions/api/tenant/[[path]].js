// « My institution » of a tenant (druid-internal docs/plan-druid-saas.md, lot 6 a-1), for the owners — the admins read:
//   GET    /api/tenant                              plan, seats, members, pending access requests, mail domains
//   POST   /api/tenant/members { email, role, labScope? }   invites (within the seats of the plan) → 201 + e-mail
//   PATCH  /api/tenant/members/:id { role, labScope? }      changes the role (the last owner keeps it)
//   DELETE /api/tenant/members/:id                          removes the member, closes their sessions
//   POST   /api/tenant/members/:id/resend                   sends the invitation again
//   POST   /api/tenant/access-requests/:id/accept { role, labScope? }   invites the requester
//   POST   /api/tenant/access-requests/:id/dismiss
//   PUT    /api/tenant/mail-domains { mailDomains: [] }
//   GET    /api/tenant/keys                          API keys of the establishment: which are set, last test (lot 6 a-2)
//   PUT    /api/tenant/keys/llm { apiBase, model, apiKey?, force? }        tests then stores (409 + outcome if the test fails)
//   PUT    /api/tenant/keys/scopus { apiKey?, instToken?, apiKey2?, instToken2?, keep*?, force? }
//   POST   /api/tenant/keys/:group/test                                    tests the stored keys again
//   DELETE /api/tenant/keys/:group
// Owners only, also on a suspended tenant (lot 6 a-3; rules in lib/saas/lifecycle.ts):
//   GET    /api/tenant/exports                       the latest exports (status, size, expiry)
//   POST   /api/tenant/exports                       queues a `tenant.export` job → 202 (409 + the live one)
//   GET    /api/tenant/exports/:id/download          the archive (410 once expired)
//   POST   /api/tenant/deletion { confirm: <slug> }  suspends the tenant, deleted after 30 days; owners told by e-mail
//   DELETE /api/tenant/deletion                      cancels a planned deletion
// Every member (lot 6 b):
//   GET    /api/tenant/offer                         the plan of the tenant and the plans, cheapest first (locked features)
//   POST   /api/tenant/quote { plan, researchers?, accounts?, message?, feature? }   e-mail to DirlaData + quote_request
// The rules (seats, last owner, domains) live in lib/saas/members.ts; those of the keys in lib/saas/clientKeys.ts.
import {
  ClientKeyError, describeClientKeys, isKeyGroup, removeClientKeys, retestClientKeys, saveClientKeys,
} from '../../../lib/saas/clientKeys.ts';
import {
  LifecycleError, cancelDeletion, deletionOf, exportToDownload, exportViewOf, listExports, requestDeletion, requestExport,
} from '../../../lib/saas/lifecycle.ts';
import { logConsole } from '../../../lib/saas/console.ts';
import {
  MemberError, dismissAccessRequest, findAccessRequest, findMemberById, inviteMember, listAccessRequests, listMembers, removeMember, seatsOf,
  setMailDomains, updateMember,
} from '../../../lib/saas/members.ts';
import { sendDeletionScheduled, sendInvitation, sendQuoteRequest } from '../../_lib/email.js';
import { SAAS_ASSETS_BINDING, forgetHost, forgetHostEverywhere, forgetTenantSecrets, json, withSaasDb } from '../../_lib/saas.js';
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

/** Plans in the order of the grid (seats ascending, unlimited last): the first one unlocking a feature is the cheapest. */
const plansInOrder = async (db) => {
  const rows = await db.selectFrom('plan').select(['code', 'label', 'seats', 'history_years', 'refresh', 'features']).execute();
  const rank = (p) => (p.code === 'trial' ? -1 : p.seats === null ? Number.MAX_SAFE_INTEGER : p.seats);
  return rows.sort((a, b) => rank(a) - rank(b)).map((p) => ({ code: p.code, label: p.label, seats: p.seats, historyYears: p.history_years, refresh: p.refresh, features: p.features }));
};

const offer = (context, instance) => withSaasDb(context.env, async (db) => {
  const plan = instance.tenant.plan;
  return json(200, { plan: plan ? { code: plan.code, label: plan.label } : null, plans: await plansInOrder(db) });
});

const QUOTE_PLANS = ['team', 'complete', 'onsite'];
const QUOTES_PER_DAY = 5;
const intOrNull = (v, max) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
};

/** « Request a quote »: kept in quote_request, e-mailed to DirlaData (SAAS_SALES_EMAIL) with the requester as Reply-To. */
const quote = async (context, instance, identity) => {
  let body;
  try { body = await context.request.json(); } catch { return json(400, { error: 'Invalid request' }); }
  const plan = String(body?.plan || '');
  const researchers = intOrNull(body?.researchers, 1_000_000);
  const accounts = intOrNull(body?.accounts, 100_000);
  const message = body?.message ? String(body.message).trim().slice(0, 4000) : null;
  const feature = body?.feature ? String(body.feature).slice(0, 40) : null;
  if (!QUOTE_PLANS.includes(plan) || researchers === undefined || accounts === undefined) return json(400, { error: 'Invalid request' });
  const tenant = instance.tenant;
  return withSaasDb(context.env, async (db) => {
    const recent = await db.selectFrom('quote_request').select(({ fn }) => fn.countAll().as('n')).where('tenant_id', '=', tenant.id)
      .where('created_at', '>', new Date(Date.now() - 86_400_000).toISOString()).executeTakeFirst();
    if (Number(recent?.n || 0) >= QUOTES_PER_DAY) return json(429, { error: 'Too many quote requests today' });
    await db.insertInto('quote_request').values({ tenant_id: tenant.id, email: identity, plan_code: plan, researchers, accounts, message, feature }).execute();
    let sent = false;
    if (context.env.RESEND_API_KEY && context.env.SAAS_SALES_EMAIL) {
      try {
        await sendQuoteRequest(context.env, { to: context.env.SAAS_SALES_EMAIL, label: instance.label, slug: tenant.slug, requester: identity, plan, researchers, accounts, message, feature });
        sent = true;
      } catch (err) {
        console.error(JSON.stringify({ event: 'tenant.quote.mail_failed', instance: instance.slug, error: String(err?.message || err) }));
      }
    }
    console.log(JSON.stringify({ event: 'tenant.quote', instance: instance.slug, plan, feature, sent }));
    return json(201, { recorded: true });
  });
};

/**
 * API keys of the establishment (lot 6 a-2). Owners write, admins read; the values never leave the server, except the
 * address and model of the language model. The Worker needs SAAS_SECRETS_KEY (the runner's) to encrypt and test.
 */
const keys = async (context, db, instance, identity, method, group, action, body) => {
  const tenantId = instance.tenant.id;
  const secretsKey = context.env.SAAS_SECRETS_KEY || null;
  if (!group && method === 'GET') return json(200, { available: !!secretsKey, groups: await describeClientKeys(db, tenantId, secretsKey) });
  if (!isKeyGroup(group)) return json(404, { error: 'Not found' });
  if (!secretsKey) return json(503, { error: 'SAAS_SECRETS_KEY not configured' });
  const log = (event, extra = {}) => console.log(JSON.stringify({ event: `tenant.keys.${event}`, instance: instance.slug, group, ...extra }));
  if (!action && method === 'PUT') {
    const check = await saveClientKeys(db, tenantId, group, body, secretsKey, { by: identity, force: body?.force === true });
    const stored = check.ok || body?.force === true;
    forgetTenantSecrets(tenantId);
    log('saved', { ok: check.ok, code: check.code, stored });
    return json(stored ? 200 : 409, { stored, check, ...(stored ? {} : { error: 'The key test failed' }) });
  }
  if (action === 'test' && method === 'POST') {
    const check = await retestClientKeys(db, tenantId, group, secretsKey, { by: identity });
    log('tested', { ok: check.ok, code: check.code });
    return json(200, { check });
  }
  if (!action && method === 'DELETE') {
    await removeClientKeys(db, tenantId, group);
    forgetTenantSecrets(tenantId);
    log('removed');
    return json(200, { removed: true });
  }
  return json(404, { error: 'Not found' });
};

/** Every host of the tenant forgotten by the caches (its status changed: read-only at once everywhere). */
const forgetTenantHosts = async (env, db, tenantId) => {
  const hosts = await db.selectFrom('tenant_host').select('host').where('tenant_id', '=', tenantId).execute();
  for (const h of hosts) await forgetHostEverywhere(env, h.host);
};

/**
 * Export and deletion (lot 6 a-3), owners only and also on a suspended tenant: its data stays the establishment's, which
 * exports it or cancels the deletion until the last day.
 */
const lifecycle = async (context, instance, identity, method, section, id, action) => {
  const { env, request } = context;
  const tenant = instance.tenant;
  const log = (event, extra = {}) => console.log(JSON.stringify({ event: `tenant.${event}`, instance: instance.slug, ...extra }));
  return withSaasDb(env, async (db) => {
    if (section === 'exports' && !id && method === 'GET') return json(200, { exports: await listExports(db, tenant.id) });
    if (section === 'exports' && !id && method === 'POST') {
      const { job, created } = await requestExport(db, tenant.id, identity);
      if (created) log('export.requested');
      return json(created ? 202 : 409, { export: exportViewOf(job), ...(created ? {} : { error: 'An export is already running' }) });
    }
    if (section === 'exports' && id && action === 'download' && method === 'GET') {
      if (!UUID_RE.test(id)) return json(404, { error: 'Not found' });
      const bucket = env[SAAS_ASSETS_BINDING];
      if (!bucket) return json(503, { error: 'No file store on this deployment' });
      const file = await exportToDownload(db, tenant.id, id);
      const object = await bucket.get(file.objectKey);
      if (!object) return json(410, { error: 'This export has expired: ask for a new one' });
      log('export.downloaded');
      return new Response(object.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${file.fileName}"`,
          ...(file.size ? { 'Content-Length': String(file.size) } : {}), 'Cache-Control': 'no-store',
        },
      });
    }
    if (section === 'deletion' && !id && method === 'POST') {
      let body = {};
      try { body = (await request.json()) || {}; } catch { return json(400, { error: 'Invalid request' }); }
      const deletion = await requestDeletion(db, tenant, { by: identity, confirm: body.confirm });
      await logConsole(db, { actor: identity, action: 'deletion-requested', tenantId: tenant.id, details: { deleteAfter: deletion.deleteAfter } });
      await forgetTenantHosts(env, db, tenant.id);
      log('deletion.requested', { deleteAfter: deletion.deleteAfter });
      if (env.RESEND_API_KEY) {
        const owners = await db.selectFrom('member').select('email').where('tenant_id', '=', tenant.id).where('role', '=', 'owner').execute();
        const adminUrl = `${new URL(request.url).origin}/?page=ADMIN&tab=establishment`;
        for (const o of owners) {
          await sendDeletionScheduled(env, { to: o.email, label: instance.label, requestedBy: identity, deleteAfter: deletion.deleteAfter, adminUrl })
            .catch((err) => console.error(JSON.stringify({ event: 'tenant.deletion.mail_failed', instance: instance.slug, error: String(err?.message || err) })));
        }
      }
      return json(200, { deletion });
    }
    if (section === 'deletion' && !id && method === 'DELETE') {
      const status = await cancelDeletion(db, tenant.id);
      await logConsole(db, { actor: identity, action: 'deletion-cancelled', tenantId: tenant.id, details: { status } });
      await forgetTenantHosts(env, db, tenant.id);
      log('deletion.cancelled', { status });
      return json(200, { cancelled: true, status });
    }
    return json(404, { error: 'Not found' });
  });
};

export async function onRequest(context) {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  const { instance, identity, member } = t;
  const { request } = context;
  const method = request.method;
  const parts = new URL(request.url).pathname.replace(/^\/api\/tenant\/?/, '').replace(/\/$/, '').split('/').filter(Boolean);
  if (parts[0] === 'offer' && parts.length === 1 && method === 'GET') return offer(context, instance);
  if (parts[0] === 'quote' && parts.length === 1 && method === 'POST') return quote(context, instance, identity);
  const isOwner = member.role === 'owner';
  if (!isOwner && member.role !== 'admin') return json(403, { error: 'Owner right required' });
  if (parts[0] === 'exports' || parts[0] === 'deletion') {
    if (!isOwner) return json(403, { error: 'Owner right required' });
    try {
      return await lifecycle(context, instance, identity, method, parts[0], parts[1], parts[2]);
    } catch (err) {
      if (err instanceof LifecycleError) return json(err.status, { error: err.message });
      throw err;
    }
  }
  if (method !== 'GET') {
    if (!isOwner) return json(403, { error: 'Owner right required' });
    if (instance.readOnly) return json(403, { error: 'Read-only instance: writes are disabled' });
  }
  const tenant = instance.tenant;
  try {
    return await withSaasDb(context.env, async (db) => {
      if (!parts.length && method === 'GET') {
        const row = await db.selectFrom('tenant').select(['label', 'mail_domains', 'created_at', 'delete_requested_at', 'delete_requested_by', 'delete_after'])
          .where('id', '=', tenant.id).executeTakeFirstOrThrow();
        const plans = await db.selectFrom('plan').select(['code', 'label', 'seats', 'history_years', 'refresh', 'features']).orderBy('created_at').execute();
        return json(200, {
          slug: tenant.slug, label: row.label, status: tenant.status, createdAt: row.created_at,
          plan: tenant.plan ? { code: tenant.plan.code, label: tenant.plan.label, seats: tenant.plan.seats, historyYears: tenant.plan.history_years, refresh: tenant.plan.refresh, features: tenant.plan.features } : null,
          plans: plans.map((p) => ({ code: p.code, label: p.label, seats: p.seats, historyYears: p.history_years, refresh: p.refresh, features: p.features })),
          seats: await seatsOf(db, tenant, tenant.plan),
          members: await listMembers(db, tenant.id),
          accessRequests: await listAccessRequests(db, tenant.id),
          mailDomains: row.mail_domains,
          deletion: deletionOf(row),
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
      if (section === 'keys') return keys(context, db, instance, identity, method, id, action, body);
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
    if (err instanceof MemberError || err instanceof ClientKeyError) return json(err.status, { error: err.message });
    throw err;
  }
}

