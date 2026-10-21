// Magic link of a tenant (druid-internal docs/plan-druid-saas.md, lot 1 e), safe against the link scanners of the
// mail providers (a GET must not consume the link):
//   GET  /api/auth/verify?token=…  → page that submits the token by POST (JavaScript, or a button without it);
//   POST /api/auth/verify (form)   → consumes the link once (atomic UPDATE), opens the session, sets the cookie and
//                                     redirects to the page asked for.
// A link of another tenant (or of the portal) never opens this one: the row must carry this tenant's id.
import { consumeMagicLink, createSession, touchLogin } from '../../../lib/saas/controlPlane.ts';
import { instanceOf } from '../../_lib/instance.js';
import { html, json, safeNextPath, sessionCookie, sha256Hex, verifyInterstitial, withSaasDb } from '../../_lib/saas.js';

const loginUrl = (origin, params) => {
  const u = new URL('/auth/login', origin);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
};

export function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!token) return Response.redirect(loginUrl(url.origin, { reason: 'invalid' }), 302);
  return html(verifyInterstitial(token, '/api/auth/verify'));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;
  const instance = instanceOf(context);
  if (!instance.tenant) return json(404, { error: 'Not a tenant of the control plane' });
  let token = '';
  try {
    token = String((await request.formData()).get('token') || '');
  } catch { /* no form body */ }
  if (!token) return Response.redirect(loginUrl(origin, { reason: 'invalid' }), 302);
  const tenantId = instance.tenant.id;
  const opened = await withSaasDb(env, async (db) => {
    const link = await consumeMagicLink(db, await sha256Hex(token));
    if (!link || link.tenant_id !== tenantId) return null;
    await touchLogin(db, tenantId, link.email);
    const id = await createSession(db, { email: link.email, tenantId, userAgent: request.headers.get('User-Agent') });
    return { id, next: safeNextPath(link.next_path) || '/' };
  });
  if (!opened) return Response.redirect(loginUrl(origin, { reason: 'expired' }), 302);
  console.log(JSON.stringify({ event: 'auth.login', instance: instance.slug }));
  return new Response(null, { status: 303, headers: { Location: new URL(opened.next, origin).toString(), 'Set-Cookie': sessionCookie(opened.id) } });
}
