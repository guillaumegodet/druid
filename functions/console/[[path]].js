// DirlaData console (druid-internal docs/plan-druid-saas.md, lot 6 c): /console on SAAS_ADMIN_HOST of a control-plane
// deployment, for the addresses of SAAS_SUPERADMIN_EMAILS only. Its sessions are of their own kind (`console`, 12 h):
// a portal or tenant session never opens it. Every change is journaled (console_event).
//
//   GET  /console                       login, or the tenants
//   POST /console/auth/request { email } magic link (allowed addresses only; same answer for every address)
//   GET  /console/auth/verify?token=…    interstitial; POST (form) → console session
//   GET  /console/logout
//   GET  /console/t/:slug                page of a tenant
//   GET  /console/events                 journal
//   GET  /console/api/tenants            overview
//   GET  /console/api/tenants/:slug      facts, members, jobs, access requests, journal
//   POST /console/api/tenants/:slug/plan { plan }
//   POST /console/api/tenants/:slug/status { status: active | suspended }
//   POST /console/api/tenants/:slug/cancel-deletion   cancels the deletion an owner asked (lot 6 a-3)
//   POST /console/api/tenants/:slug/jobs/:id/retry
//   POST /console/api/tenants/:slug/quotes/:id/handled
//   POST /console/api/tenants/:slug/impersonate { memberId, reason } → { url } (2-hour tenant session, marked)
//   GET  /console/api/events
import {
  consoleSessionEmail, consumeMagicLink, createSession, deleteSession, isValidEmail, normalizeEmail, normalizeHost,
} from '../../lib/saas/controlPlane.ts';
import {
  ConsoleError, cancelTenantDeletion, consoleEvents, isSuperadmin, logConsole, markQuoteHandled, retryJob, setTenantPlan, setTenantStatus, tenantBySlug, tenantDetail,
  tenantsOverview,
} from '../../lib/saas/console.ts';
import { LINKS_PER_QUARTER, recentLinks } from '../api/auth/request.js';
import { consoleEventsPage, consoleLoginPage, consoleTenantPage, consoleTenantsPage } from '../_lib/consolePages.js';
import {
  clearSessionCookie, forgetHostEverywhere, html, isControlPlane, issueMagicLink, json, readSessionId, sessionCookie, sha256Hex,
  verifyInterstitial, withSaasDb,
} from '../_lib/saas.js';

const CONSOLE_HOURS = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const consoleHostOf = (env) => (isControlPlane(env) && env.SAAS_ADMIN_HOST ? normalizeHost(env.SAAS_ADMIN_HOST) : null);
const redirect = (location, headers = {}) => new Response(null, { status: 302, headers: { Location: location, ...headers } });

const bodyOf = async (request) => {
  try {
    const ct = request.headers.get('Content-Type') || '';
    return ct.includes('application/json') ? await request.json() : Object.fromEntries((await request.formData()).entries());
  } catch {
    return null;
  }
};

/** Hosts of a tenant, forgotten by the caches after a change of plan or status. */
const forgetTenant = async (env, db, slug) => {
  const t = await tenantBySlug(db, slug);
  const hosts = await db.selectFrom('tenant_host').select('host').where('tenant_id', '=', t.id).execute();
  for (const h of hosts) await forgetHostEverywhere(env, h.host);
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const host = consoleHostOf(env);
  if (!host || normalizeHost(url.hostname) !== host) return json(404, { error: 'Not found' });
  const path = url.pathname.replace(/^\/console/, '').replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const origin = url.origin;
  // A write comes from the console itself (the cookie is SameSite=Lax; the Origin check closes the rest).
  if (method !== 'GET' && method !== 'HEAD' && request.headers.get('Origin') && request.headers.get('Origin') !== origin) {
    return json(403, { error: 'Cross-site request refused' });
  }

  // ── Session ──
  if (path === '/auth/request' && method === 'POST') {
    const body = await bodyOf(request);
    const email = normalizeEmail(body?.email);
    if (!isValidEmail(email)) return json(400, { error: 'Invalid e-mail address' });
    let link = null;
    if (isSuperadmin(env.SAAS_SUPERADMIN_EMAILS, email)) {
      try {
        link = await withSaasDb(env, async (db) => {
          if (await recentLinks(db, email, null) >= LINKS_PER_QUARTER) return null;
          return issueMagicLink(db, env, { email, tenantId: null, verifyUrl: `${origin}/console/auth/verify`, nextPath: '/console', label: 'console DirlaData', kind: 'console' });
        });
      } catch (err) {
        console.error(JSON.stringify({ event: 'console.auth.request.failed', error: String(err?.message || err) }));
      }
    }
    return json(200, link ? { ok: true, link } : { ok: true });
  }
  if (path === '/auth/verify' && method === 'GET') {
    const token = url.searchParams.get('token') || '';
    return token ? html(verifyInterstitial(token, '/console/auth/verify')) : redirect(`${origin}/console?reason=invalid`);
  }
  if (path === '/auth/verify' && method === 'POST') {
    const body = await bodyOf(request);
    const token = String(body?.token || '');
    if (!token) return redirect(`${origin}/console?reason=invalid`);
    const opened = await withSaasDb(env, async (db) => {
      const link = await consumeMagicLink(db, await sha256Hex(token));
      if (!link || link.tenant_id !== null || link.kind !== 'console' || !isSuperadmin(env.SAAS_SUPERADMIN_EMAILS, link.email)) return null;
      const id = await createSession(db, { email: link.email, tenantId: null, userAgent: request.headers.get('User-Agent'), ttlHours: CONSOLE_HOURS, kind: 'console' });
      await logConsole(db, { actor: link.email, action: 'login' });
      return id;
    });
    if (!opened) return redirect(`${origin}/console?reason=expired`);
    return new Response(null, { status: 303, headers: { Location: `${origin}/console`, 'Set-Cookie': sessionCookie(opened, CONSOLE_HOURS * 3600) } });
  }
  if (path === '/logout') {
    await withSaasDb(env, (db) => deleteSession(db, readSessionId(request))).catch(() => {});
    return redirect(`${origin}/console`, { 'Set-Cookie': clearSessionCookie() });
  }

  // Every other route: a live console session of an address still allowed (removing it from SAAS_SUPERADMIN_EMAILS
  // closes the console at once).
  const actor = await withSaasDb(env, (db) => consoleSessionEmail(db, readSessionId(request)));
  const allowed = actor && isSuperadmin(env.SAAS_SUPERADMIN_EMAILS, actor);
  if (!path.startsWith('/api/')) {
    if (method !== 'GET') return json(405, { error: 'Method not allowed' });
    if (!allowed) return html(consoleLoginPage({ sent: url.searchParams.get('sent') === '1', reason: url.searchParams.get('reason') || '' }));
    if (path === '/') return html(consoleTenantsPage());
    if (path === '/events') return html(consoleEventsPage());
    const t = path.match(/^\/t\/([a-z0-9-]+)$/);
    if (t) return html(consoleTenantPage(t[1]));
    return redirect(`${origin}/console`);
  }
  if (!allowed) return json(401, { error: 'Authentication required' });

  try {
    return await withSaasDb(env, async (db) => {
      if (path === '/api/tenants' && method === 'GET') return json(200, { tenants: await tenantsOverview(db) });
      if (path === '/api/events' && method === 'GET') return json(200, { events: await consoleEvents(db) });
      const m = path.match(/^\/api\/tenants\/([a-z0-9-]+)(?:\/(plan|status|impersonate|cancel-deletion)|\/jobs\/([^/]+)\/retry|\/quotes\/([^/]+)\/handled)?$/);
      if (!m) return json(404, { error: 'Not found' });
      const [, slug, action, jobId, quoteId] = m;
      if (quoteId) {
        if (method !== 'POST' || !UUID_RE.test(quoteId)) return json(404, { error: 'Not found' });
        await markQuoteHandled(db, slug, quoteId, actor);
        return json(200, { handled: true });
      }
      if (!action && !jobId && method === 'GET') return json(200, await tenantDetail(db, slug));
      if (method !== 'POST') return json(405, { error: 'Method not allowed' });
      const body = (await bodyOf(request)) || {};
      if (action === 'plan') {
        const r = await setTenantPlan(db, slug, String(body.plan || ''), actor);
        await forgetTenant(env, db, slug);
        return json(200, r);
      }
      if (action === 'status') {
        if (body.status !== 'active' && body.status !== 'suspended') return json(400, { error: 'Invalid request' });
        await setTenantStatus(db, slug, body.status, actor);
        await forgetTenant(env, db, slug);
        return json(200, { status: body.status });
      }
      if (action === 'cancel-deletion') {
        const status = await cancelTenantDeletion(db, slug, actor);
        await forgetTenant(env, db, slug);
        return json(200, { status });
      }
      if (jobId) {
        if (!UUID_RE.test(jobId)) return json(404, { error: 'Not found' });
        return json(202, { jobId: await retryJob(db, slug, jobId, actor) });
      }
      if (action === 'impersonate') {
        const t = await tenantBySlug(db, slug);
        if (t.status !== 'active' && t.status !== 'suspended') throw new ConsoleError(409, 'Tenant not open yet');
        const member = UUID_RE.test(String(body.memberId || ''))
          ? await db.selectFrom('member').select(['id', 'email']).where('tenant_id', '=', t.id).where('id', '=', String(body.memberId)).executeTakeFirst()
          : null;
        if (!member) throw new ConsoleError(404, 'Member not found');
        const tenantHost = (await db.selectFrom('tenant_host').select('host').where('tenant_id', '=', t.id).where('is_primary', '=', true).executeTakeFirst())?.host;
        if (!tenantHost) throw new ConsoleError(409, 'Tenant without host');
        const reason = String(body.reason || '').trim().slice(0, 300) || null;
        await logConsole(db, { actor, action: 'impersonate', tenantId: t.id, details: { as: member.email, reason } });
        // A link of the tenant host, 5 minutes, opening a 2-hour session marked with the console user.
        const link = await issueMagicLink(db, env, {
          email: member.email, tenantId: t.id, verifyUrl: `https://${tenantHost}/api/auth/verify`, nextPath: '/', label: t.label,
          deliver: 'return', impersonatedBy: actor, ttlMinutes: 5,
        });
        return json(200, { url: link });
      }
      return json(404, { error: 'Not found' });
    });
  } catch (err) {
    if (err instanceof ConsoleError) return json(err.status, { error: err.message });
    throw err;
  }
}
