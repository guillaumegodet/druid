// Logout: redirects to the Cloudflare Access logout (when enabled),
// otherwise to the home page. Replaces `/auth/logout` from server.cjs (Keycloak).
export async function onRequest(context) {
  const url = new URL(context.request.url)
  return Response.redirect(`${url.origin}/cdn-cgi/access/logout`, 302)
}
