// Portal « create my Druid » (druid-internal docs/plan-druid-saas.md, lot 2): /start on the portal host of a
// control-plane deployment (SAAS_PORTAL_HOST). Outside /api, so the control plane is checked here. A session of the
// portal (tenant_id NULL) is opened by a magic link; the assistant (functions/_lib/portalPages.js) calls the relays
// below, the creation writes the tenant (status provisioning) and queues the job `tenant.provision` that the runner
// (lib/saas/runner.ts) completes; the construction page polls the status, then opens the tenant with a magic link of
// ITS host.
//
//   GET  /start                         home (e-mail form, or one's Druids)
//   POST /start/auth/request            { email }                     → magic link of the portal
//   GET  /start/auth/verify?token=…     interstitial; POST (form)      → session, redirect to /start/new
//   GET  /start/logout
//   GET  /start/new                     assistant (session)
//   GET  /start/api/organizations?q=    ROR search                     → { items }
//   GET  /start/api/organizations/:ror  establishment (ministry), OpenAlex, RNSR structures, proposals
//   POST /start/api/tenants             OnboardingPayload (session)    → 201 { slug, host } | 409
//   GET  /start/api/tenants/:slug       status and jobs (member)
//   POST /start/api/tenants/:slug/open  magic link of the tenant host (member) → { url }
//   POST /start/api/tenants/:slug/access-request (session)
//   GET  /start/wait/:slug              construction page
import {
  consumeMagicLink, createAccessRequest, createSession, deleteSession, enqueueJob, findMember, findTenantByRor,
  findTenantBySlug, isValidEmail, isValidSlug, latestJobs, normalizeEmail, normalizeHost, primaryHost, publicJobInfo,
  sessionEmail, tenantSchemaName, tenantsOfEmail,
} from '../../lib/saas/controlPlane.ts';
import {
  OnboardingPayload, esrEstablishmentFromRecord, mailDomainOf, proposeSlug, rnsrStructureFromRecord, rorIdOf,
  rorOrganizationFromRecord, tenantHostOf,
} from '../../lib/saas/onboarding.ts';
import { LINKS_PER_QUARTER, recentLinks } from '../api/auth/request.js';
import { assistantPage, homePage, waitPage } from '../_lib/portalPages.js';
import {
  clearSessionCookie, html, isControlPlane, issueMagicLink, json, readSessionId, safeNextPath, sessionCookie, sha256Hex,
  verifyInterstitial, withSaasDb,
} from '../_lib/saas.js';

const ESR = 'https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets';
const PORTAL_LABEL = 'portail Druid';

/** The portal answers on its host only, and only with a control plane. */
export const portalHostOf = (env) => (isControlPlane(env) && env.SAAS_PORTAL_HOST ? normalizeHost(env.SAAS_PORTAL_HOST) : null);
const baseDomainOf = (env) => String(env.SAAS_BASE_DOMAIN || '').toLowerCase().replace(/^\.+|\.+$/g, '');

const redirect = (location, headers = {}) => new Response(null, { status: 302, headers: { Location: location, ...headers } });

/** Fetch of the relays: JSON or null, 8 s at most, a polite identification. */
const getJson = async (url, env) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': `Druid-portal (${env.OPENALEX_MAILTO || 'mailto:contact@example.org'})` }, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const odsRecords = async (dataset, where, select, env, max = 500) => {
  const out = [];
  for (let offset = 0; offset < max; offset += 100) {
    const u = new URL(`${ESR}/${dataset}/records`);
    u.searchParams.set('where', where);
    u.searchParams.set('limit', '100');
    u.searchParams.set('offset', String(offset));
    if (select) u.searchParams.set('select', select);
    const j = await getJson(u.toString(), env);
    if (!j?.results) break;
    out.push(...j.results);
    if (out.length >= (j.total_count || 0) || j.results.length < 100) break;
  }
  return out;
};

const RNSR_SELECT = 'numero_national_de_structure,sigle,libelle,label_numero,type_de_structure,code_de_niveau_de_structure,commune,site_web,tutelles,uai_des_tutelles,numero_de_structure_parent';

/** Details of an organization: ministry record, OpenAlex id, RNSR structures of its UAI, proposals. */
export const organizationDetails = async (ror, env) => {
  const [rorRaw, esrRows, oa] = await Promise.all([
    getJson(`https://api.ror.org/v2/organizations/${ror}`, env),
    odsRecords('fr-esr-principaux-etablissements-enseignement-superieur', `search(identifiant_ror, "${ror}")`, null, env, 100),
    getJson(`https://api.openalex.org/institutions?filter=ror:https://ror.org/${ror}&select=id,display_name,works_count&per-page=1${env.OPENALEX_MAILTO ? `&mailto=${encodeURIComponent(env.OPENALEX_MAILTO)}` : ''}`, env),
  ]);
  const organization = rorRaw ? rorOrganizationFromRecord(rorRaw) : null;
  const establishment = esrEstablishmentFromRecord(esrRows[0]) || null;
  const openalexRaw = oa?.results?.[0];
  const openalex = openalexRaw ? { id: String(openalexRaw.id).replace('https://openalex.org/', ''), name: openalexRaw.display_name, worksCount: openalexRaw.works_count } : null;
  const labs = establishment?.uai
    ? (await odsRecords('fr-esr-structures-recherche-publiques-actives', `search(uai_des_tutelles, "${establishment.uai}")`, RNSR_SELECT, env))
      .map(rnsrStructureFromRecord).filter(Boolean).filter((s) => s.level !== '1').sort((a, b) => (a.acronym || a.name).localeCompare(b.acronym || b.name, 'fr'))
    : [];
  const name = establishment?.name || organization?.name || ror;
  return { organization, establishment, openalex, labs, proposals: { slug: proposeSlug(name), label: name, mailDomain: mailDomainOf(establishment?.website || organization?.website) } };
};

const sessionOf = async (env, request) => withSaasDb(env, (db) => sessionEmail(db, readSessionId(request), null));

const bodyOf = async (request) => {
  const ct = request.headers.get('Content-Type') || '';
  try {
    return ct.includes('application/json') ? await request.json() : Object.fromEntries((await request.formData()).entries());
  } catch {
    return null;
  }
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const portalHost = portalHostOf(env);
  if (!portalHost || normalizeHost(url.hostname) !== portalHost) return json(404, { error: 'Portal not enabled on this host' });
  const baseDomain = baseDomainOf(env);
  const path = url.pathname.replace(/^\/start/, '').replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const origin = url.origin;

  // ── Session of the portal ──
  if (path === '/auth/request' && method === 'POST') {
    const body = await bodyOf(request);
    if (!body) return json(400, { error: 'Invalid request' });
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return json(400, { error: 'Invalid e-mail address' });
    let link = null;
    try {
      link = await withSaasDb(env, async (db) => {
        if (await recentLinks(db, email, null) >= LINKS_PER_QUARTER) return null;
        return issueMagicLink(db, env, { email, tenantId: null, verifyUrl: `${origin}/start/auth/verify`, nextPath: safeNextPath(body.next) || '/start/new', label: PORTAL_LABEL });
      });
    } catch (err) {
      console.error(JSON.stringify({ event: 'portal.auth.request.failed', error: String(err?.message || err) }));
    }
    return json(200, link ? { ok: true, link } : { ok: true });
  }
  if (path === '/auth/verify' && method === 'GET') {
    const token = url.searchParams.get('token') || '';
    return token ? html(verifyInterstitial(token, '/start/auth/verify')) : redirect(`${origin}/start?reason=invalid`);
  }
  if (path === '/auth/verify' && method === 'POST') {
    const body = await bodyOf(request);
    const token = String(body?.token || '');
    if (!token) return redirect(`${origin}/start?reason=invalid`);
    const opened = await withSaasDb(env, async (db) => {
      const link = await consumeMagicLink(db, await sha256Hex(token));
      if (!link || link.tenant_id !== null) return null;
      const id = await createSession(db, { email: link.email, tenantId: null, userAgent: request.headers.get('User-Agent') });
      return { id, next: safeNextPath(link.next_path) || '/start' };
    });
    if (!opened) return redirect(`${origin}/start?reason=expired`);
    return new Response(null, { status: 303, headers: { Location: `${origin}${opened.next}`, 'Set-Cookie': sessionCookie(opened.id) } });
  }
  if (path === '/logout') {
    await withSaasDb(env, (db) => deleteSession(db, readSessionId(request))).catch(() => {});
    return redirect(`${origin}/start`, { 'Set-Cookie': clearSessionCookie() });
  }

  const email = await sessionOf(env, request);

  // ── Pages ──
  if (path === '/' && method === 'GET') {
    const tenants = email ? await withSaasDb(env, (db) => tenantsOfEmail(db, email)) : [];
    return html(homePage({ email, tenants, sent: url.searchParams.get('sent') === '1', reason: url.searchParams.get('reason') || '', baseDomain }));
  }
  if (path === '/new' && method === 'GET') {
    if (!email) return redirect(`${origin}/start`);
    return html(assistantPage({ email, baseDomain }));
  }
  const wait = path.match(/^\/wait\/([a-z0-9-]+)$/);
  if (wait && method === 'GET') {
    if (!email) return redirect(`${origin}/start`);
    const found = await withSaasDb(env, async (db) => {
      const tenant = await findTenantBySlug(db, wait[1]);
      return tenant && (await findMember(db, tenant.id, email)) ? { tenant, host: await primaryHost(db, tenant.id) } : null;
    });
    if (!found) return redirect(`${origin}/start`);
    return html(waitPage({ slug: found.tenant.slug, label: found.tenant.label, host: found.host || tenantHostOf(found.tenant.slug, baseDomain) }));
  }

  // ── Relays and API (session required) ──
  if (!path.startsWith('/api/')) return json(404, { error: 'Not found' });
  if (!email) return json(401, { error: 'Authentication required', login: '/start' });

  if (path === '/api/organizations' && method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 200);
    if (q.length < 2) return json(200, { items: [] });
    const j = await getJson(`https://api.ror.org/v2/organizations?query=${encodeURIComponent(q)}`, env);
    if (!j) return json(502, { error: 'Upstream registry unavailable' });
    const items = (j.items || []).map(rorOrganizationFromRecord).filter(Boolean).slice(0, 20);
    return json(200, { items });
  }
  const org = path.match(/^\/api\/organizations\/([a-z0-9]+)$/i);
  if (org && method === 'GET') {
    const ror = rorIdOf(org[1]);
    if (!ror) return json(400, { error: 'Invalid request' });
    const details = await organizationDetails(ror, env);
    if (!details.organization && !details.establishment) return json(404, { error: 'Not found' });
    return json(200, details);
  }

  if (path === '/api/tenants' && method === 'POST') {
    const body = await bodyOf(request);
    const parsed = OnboardingPayload.safeParse(body);
    if (!parsed.success) return json(400, { error: 'Invalid request', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 10) });
    const p = parsed.data;
    if (!isValidSlug(p.slug) || !baseDomain) return json(400, { error: 'Invalid request', issues: ['slug: reserved or invalid'] });
    const host = tenantHostOf(p.slug, baseDomain);
    const result = await withSaasDb(env, async (db) => {
      if (p.establishment.ror) {
        const existing = await findTenantByRor(db, p.establishment.ror);
        if (existing) return { status: 409, body: { error: 'This establishment already has a Druid', existing: { slug: existing.slug, label: existing.label } } };
      }
      if (await findTenantBySlug(db, p.slug)) return { status: 409, body: { error: 'This slug is already taken' } };
      try {
        const tenant = await db.insertInto('tenant').values({
          slug: p.slug, label: p.label, schema_name: tenantSchemaName(p.slug), ror: p.establishment.ror, uai: p.establishment.uai,
          country: p.establishment.countryCode || p.establishment.country, mail_domains: p.mailDomains,
          settings: { openalex: p.establishment.openalex, openalexMailto: env.OPENALEX_MAILTO || null },
          onboarding: p, created_by: email,
        }).returning('id').executeTakeFirstOrThrow();
        await db.insertInto('tenant_host').values({ host, tenant_id: tenant.id, is_primary: true }).execute();
        await db.insertInto('member').values({ tenant_id: tenant.id, email, role: 'owner', invited_by: null }).execute();
        const jobId = await enqueueJob(db, { tenantId: tenant.id, type: 'tenant.provision', params: { host }, createdBy: email });
        return { status: 201, body: { slug: p.slug, host, jobId } };
      } catch (err) {
        // Unique index on the ROR or the slug: somebody was faster.
        if (String(err?.code) === '23505') return { status: 409, body: { error: 'This establishment already has a Druid' } };
        throw err;
      }
    });
    if (result.status === 201) console.log(JSON.stringify({ event: 'portal.tenant.created', slug: p.slug, ror: p.establishment.ror, labs: p.labs.length }));
    return json(result.status, result.body);
  }

  const tenantRoute = path.match(/^\/api\/tenants\/([a-z0-9-]+)(\/open|\/access-request)?$/);
  if (tenantRoute) {
    const [, slug, action] = tenantRoute;
    return withSaasDb(env, async (db) => {
      const tenant = await findTenantBySlug(db, slug);
      if (!tenant || tenant.status === 'deleted') return json(404, { error: 'Unknown tenant' });
      if (action === '/access-request' && method === 'POST') {
        await createAccessRequest(db, tenant.id, email);
        return json(200, { ok: true });
      }
      const member = await findMember(db, tenant.id, email);
      if (!member) return json(403, { error: 'This account is not a member of this Druid' });
      const host = (await primaryHost(db, tenant.id)) || tenantHostOf(tenant.slug, baseDomain);
      if (!action && method === 'GET') {
        const jobs = (await latestJobs(db, tenant.id)).map(publicJobInfo);
        return json(200, { slug: tenant.slug, label: tenant.label, status: tenant.status, host, plan: tenant.plan_code, jobs });
      }
      if (action === '/open' && method === 'POST') {
        if (tenant.status !== 'active') return json(409, { error: 'Invalid request', issues: ['tenant not active'] });
        // The link opens the TENANT host (its own cookie): the token travels in the URL of the interstitial once.
        const link = await issueMagicLink(db, env, { email, tenantId: tenant.id, verifyUrl: `https://${host}/api/auth/verify`, nextPath: '/', label: tenant.label, deliver: 'return' });
        return json(200, { url: link });
      }
      return json(404, { error: 'Not found' });
    });
  }
  return json(404, { error: 'Not found' });
}
