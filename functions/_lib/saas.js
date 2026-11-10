// Multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lot 1 c-e): tenants resolved at run time from the
// control plane (schema `saas` of the shared database, lib/saas/controlPlane.ts) instead of the registry written at
// build time — adding an establishment is a row, not a build. Active on a deployment that binds the control-plane
// database as `SAAS_HYPERDRIVE` (Hyperdrive); the hosts of the build-time registry (demos) are still served first
// (functions/api/_middleware.js).
//
// Identity: a session cookie (`druid_session`, opened by a magic link, functions/api/auth/*) tied to ONE tenant — the
// cookie of another host never opens this tenant. Cloudflare Access is not involved.
import pg from '../_generated/pg.js';
import registry from '../_generated/registry.js';
import { createDbWith } from '../../lib/db/core.ts';
import {
  SAAS_SCHEMA, createMagicLink, findMember, findTenantByHost, normalizeHost, sessionOf,
} from '../../lib/saas/controlPlane.ts';
import { sendMagicLink } from '../../lib/saas/email.ts';
import { llmEnvOf } from '../../lib/saas/clientKeys.ts';
import { readTenantSecrets } from '../../lib/saas/secrets.ts';
import { DEFAULT_GRIST_API_BASE, instanceEnv, instanceForRequest, instanceOf, resolveForHost } from './instance.js';

export const SAAS_BINDING = 'SAAS_HYPERDRIVE';
/** Optional KV namespace caching host → tenant (5 min); without it, the isolate memo below (60 s) is the only cache. */
export const SAAS_REGISTRY_BINDING = 'SAAS_REGISTRY';
export const SESSION_COOKIE = 'druid_session';
const SESSION_DAYS = 30;
const MEMO_MS = 60_000;
const KV_TTL_S = 300;

export const isControlPlane = (env) => !!env?.[SAAS_BINDING];

const connectionStringOf = (env) => {
  const b = env?.[SAAS_BINDING];
  return typeof b === 'string' ? b : (b && typeof b === 'object' ? b.connectionString : '') || '';
};

/** Control-plane client of this request (one connection, Hyperdrive holds the pool): destroy it with `release`. */
export const saasDb = (env) => createDbWith(pg, { connectionString: connectionStringOf(env), max: 1, schema: SAAS_SCHEMA });

export const withSaasDb = async (env, fn) => {
  const db = saasDb(env);
  try {
    return await fn(db);
  } finally {
    await db.destroy().catch(() => {});
  }
};

const memo = new Map();

/** Tenant and plan serving `host`, or null — cached per isolate (60 s) and in KV when bound (5 min). */
export const tenantForHost = async (env, host) => {
  const h = normalizeHost(host);
  if (!h) return null;
  const now = Date.now();
  const m = memo.get(h);
  if (m && m.until > now) return m.value;
  const kv = env?.[SAAS_REGISTRY_BINDING];
  let found = kv ? await kv.get(`host:${h}`, 'json').catch(() => null) : null;
  if (!found) {
    found = await withSaasDb(env, (db) => findTenantByHost(db, h));
    // A tenant being provisioned changes within minutes: never cached.
    if (found && kv && found.tenant.status !== 'provisioning') await kv.put(`host:${h}`, JSON.stringify(found), { expirationTtl: KV_TTL_S }).catch(() => {});
  }
  if (!found || found.tenant.status !== 'provisioning') memo.set(h, { value: found || null, until: now + MEMO_MS });
  return found || null;
};

/** Forgets a host (after a change of the tenant): the isolate memo only — the KV entry expires by itself. */
export const forgetHost = (host) => memo.delete(normalizeHost(host));
/** Forgets a host everywhere this deployment caches it: the memo of this isolate and the KV registry (the other
 *  isolates within their 60 s). After a change of plan or status (DirlaData console, lot 6 c). */
export const forgetHostEverywhere = async (env, host) => {
  forgetHost(host);
  const kv = env?.[SAAS_REGISTRY_BINDING];
  if (kv) await kv.delete(`host:${normalizeHost(host)}`).catch(() => {});
};

/**
 * Runtime settings of a tenant, in the shape of functions/_lib/instance.js resolveInstance (what every handler
 * reads), plus `tenant` (control-plane facts) and `auth: 'saas'`.
 */
export const tenantInstance = ({ tenant, plan }) => {
  const settings = tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
  return {
    slug: tenant.slug,
    label: tenant.label,
    // Suspended or provisioning: readable by its members, no write anywhere (storage and UI).
    readOnly: tenant.status !== 'active',
    statusValidation: !!settings.capabilities?.HAS_STATUS_VALIDATION,
    storage: 'postgres',
    grist: { docId: '', apiBase: DEFAULT_GRIST_API_BASE, publicBaseUrl: null },
    features: { news: false, newsletter: false },
    // Rights come from the members (functions/api/me.js), never from a list of admins.
    admins: [],
    openalexMailto: typeof settings.openalexMailto === 'string' ? settings.openalexMailto : null,
    fromRegistry: true,
    shared: true,
    auth: 'saas',
    tenant: {
      id: tenant.id, slug: tenant.slug, schema: tenant.schema_name, status: tenant.status, planCode: tenant.plan_code,
      plan: plan || null, mailDomains: tenant.mail_domains || [], settings,
      // Deletion planned by the owner (lot 6 a-3): the app says when.
      deleteAfter: tenant.delete_after || null,
    },
  };
};

export const resolveTenantInstance = async (env, host) => {
  const found = await tenantForHost(env, host);
  return found ? tenantInstance(found) : null;
};

/**
 * Instance of the build-time registry serving the request, or null. With a control plane, only the hosts the registry
 * DECLARES are served from it (a single-instance or missing registry would otherwise answer for every host and hide
 * the tenants); without one, the historical rule (functions/_lib/instance.js).
 */
export const registryInstanceForRequest = (request, env) => {
  const host = new URL(request.url).hostname;
  return isControlPlane(env) ? (registry?.mode === 'multi' ? resolveForHost(host, env, registry) : null) : instanceForRequest(request, env);
};

/** Instance serving the request, registry first, then the control plane — the rule of functions/api/_middleware.js. */
export const instanceForRequestAnywhere = async (request, env) => {
  const fromRegistry = registryInstanceForRequest(request, env);
  if (fromRegistry || !isControlPlane(env)) return fromRegistry;
  return resolveTenantInstance(env, new URL(request.url).hostname);
};

/** `next` of a login kept only as a same-site path (no open redirect). */
export const safeNextPath = (next) => {
  const s = String(next || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s.slice(0, 500) : null;
};

/** Connection of the schema of a tenant: the shared database, every query qualified by the schema (lib/db/core.ts). */
export const tenantConnectionString = (env) => connectionStringOf(env);

/** Runs `fn(db)` on the schema of a tenant instance (one connection, released after). */
export const withTenantDb = async (env, instance, fn) => {
  const db = createDbWith(pg, { connectionString: connectionStringOf(env), max: 1, schema: instance.tenant.schema });
  try {
    return await fn(db);
  } finally {
    await db.destroy().catch(() => {});
  }
};

// ── Keys of the establishment (lot 6 a-2) ──────────────────────────────────────────────────────────────────────────────
const secretsMemo = new Map();

/** Decrypted secrets of a tenant (lib/saas/secrets.ts), cached per isolate for 60 s; {} without SAAS_SECRETS_KEY. */
export const tenantSecretsOf = async (env, instance) => {
  const id = instance?.tenant?.id;
  if (!id || !env?.SAAS_SECRETS_KEY) return {};
  const now = Date.now();
  const m = secretsMemo.get(id);
  if (m && m.until > now) return m.value;
  const value = await withSaasDb(env, (db) => readTenantSecrets(db, id, env.SAAS_SECRETS_KEY));
  secretsMemo.set(id, { value, until: now + MEMO_MS });
  return value;
};
/** After a change of the keys (this isolate at once, the others within 60 s). */
export const forgetTenantSecrets = (tenantId) => secretsMemo.delete(tenantId);

/**
 * Environment of a handler for the instance of the request (functions/_lib/instance.js instanceEnv), plus, on a
 * tenant, the language model of the establishment when it entered one (« My institution › API keys »).
 */
export const requestEnv = async (context) => {
  const instance = instanceOf(context);
  const env = instanceEnv(context.env, instance);
  if (!instance?.tenant) return env;
  return { ...env, ...llmEnvOf(await tenantSecretsOf(context.env, instance)) };
};

/** Error of an AI route without a language model: on a tenant it points to the settings, not to Cloudflare. */
export const noLlmError = (instance) => (instance?.tenant
  ? 'No language model is configured for this Druid (My institution › API keys)'
  : 'ILAAS_API_KEY not configured on Cloudflare (secret + redeploy)');

/** R2 bucket of the private files of the tenants (dashboards, lot 3 c): binding `SAAS_ASSETS`, optional. */
export const SAAS_ASSETS_BINDING = 'SAAS_ASSETS';

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const readSessionId = (request) => {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const id = m ? m[1].trim() : null;
  return id && UUID_RE.test(id) ? id : null;
};

export const sessionCookie = (id, maxAgeSeconds = SESSION_DAYS * 86400) =>
  `${SESSION_COOKIE}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/** `{ email, member }` of the session cookie for THIS tenant (both null without a live session). */
export const saasIdentity = async (env, request, instance) => {
  const sid = readSessionId(request);
  if (!sid) return { email: null, member: null, impersonatedBy: null };
  return withSaasDb(env, async (db) => {
    const session = await sessionOf(db, sid, instance.tenant.id);
    if (!session) return { email: null, member: null, impersonatedBy: null };
    const member = await findMember(db, instance.tenant.id, session.email);
    // An impersonation (DirlaData console, lot 6 c): the member's rights, the console user named.
    return { email: session.email, member, impersonatedBy: session.impersonatedBy };
  });
};

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

// ── Magic links ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const generateToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const sha256Hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Stores a magic link for `email` (hash only) and sends it, or returns it when SAAS_DEV_LINKS=true without Resend
 * (local runs and tests). `verifyUrl` = absolute URL of the verify route of the host that will open the session.
 * Returns the link when it is not sent (dev), else null.
 */
export const issueMagicLink = async (db, env, { email, tenantId, verifyUrl, nextPath = null, label, deliver = 'email', kind = 'user', impersonatedBy = null, ttlMinutes = 15 }) => {
  const token = generateToken();
  await createMagicLink(db, { email, tenantId, tokenHash: await sha256Hex(token), nextPath, kind, impersonatedBy, ttlMinutes });
  const link = `${verifyUrl}?token=${token}`;
  // deliver 'return': handed to the caller (the portal opens a tenant for a person already signed in there).
  if (deliver === 'return') return link;
  if (env.RESEND_API_KEY) { await sendMagicLink(env, { to: email, link, tenantLabel: label }); return null; }
  if (env.SAAS_DEV_LINKS === 'true') return link;
  throw new Error('RESEND_API_KEY not configured');
};

/** Interstitial page of a magic link: the token is submitted by POST (the GET of a mail scanner consumes nothing). */
export const verifyInterstitial = (token, action) => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Druid — connexion</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:3rem 1.5rem;color:#1c1b19;background:#f4f0e6">
<p style="font-weight:800;font-size:1.4rem">Druid</p>
<p style="color:#6f6a5e">Connexion en cours… · Signing you in…</p>
<form id="f" method="POST" action="${esc(action)}">
<input type="hidden" name="token" value="${esc(token)}">
<noscript><button type="submit" style="margin-top:1rem;padding:.7rem 1.5rem;border:0;border-radius:999px;background:#1c1b19;color:#fff;font-weight:600;cursor:pointer">Me connecter · Sign in</button></noscript>
</form>
<script>document.getElementById('f').submit()</script>
</body></html>`;
};
export const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
