// Identity of the user of a Functions request, whatever the deployment (druid-internal docs/plan-druid-saas.md,
// lot 1 e): on a tenant of the control plane, the e-mail of the session resolved once by functions/api/_middleware.js
// (`context.data.identity`, null without a live session — the Access header is then IGNORED, a client could forge
// it); elsewhere the Cloudflare Access header, as before.
export const identityOf = (context) => {
  if (context.data && context.data.identity !== undefined) return context.data.identity || null;
  return context.request.headers.get('Cf-Access-Authenticated-User-Email') || null;
};

/** Member row of the tenant for the identity (null outside a tenant, or for a session of a non-member). */
export const memberOf = (context) => context.data?.member || null;
