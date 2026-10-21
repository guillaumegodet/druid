// Logout. On a tenant of the control plane (druid-internal docs/plan-druid-saas.md, lot 1 e): the session row is
// deleted, the cookie cleared, back to the login page. Elsewhere: the Cloudflare Access logout (when enabled),
// otherwise the home page. Replaces `/auth/logout` from server.cjs (Keycloak).
import { deleteSession } from '../../lib/saas/controlPlane.ts';
import { clearSessionCookie, instanceForRequestAnywhere, isControlPlane, readSessionId, withSaasDb } from '../_lib/saas.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (isControlPlane(env)) {
    const instance = await instanceForRequestAnywhere(request, env);
    if (instance?.tenant) {
      await withSaasDb(env, (db) => deleteSession(db, readSessionId(request))).catch(() => {});
      return new Response(null, { status: 302, headers: { Location: `${url.origin}/auth/login`, 'Set-Cookie': clearSessionCookie() } });
    }
  }
  return Response.redirect(`${url.origin}/cdn-cgi/access/logout`, 302);
}
