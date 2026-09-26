// Cloudflare Pages Function — user identity.
// Replaces `/api/me` from server.cjs (Keycloak/session): same response shape as
// lib/auth.ts (`UserInfo` with the `access` object, see Nantes 1febe73 / 25c7809).
//
// Strategy:
//  - Cloudflare Access in front of the site → header `Cf-Access-Authenticated-User-Email`
//    = real identity (usable for `validated_by`).
//  - Otherwise (Access not configured, or local `wrangler pages dev`) → generic
//    anonymous user so that the app can start. ⚠️ In this mode the Grist proxy
//    refuses writes unless ALLOW_ANONYMOUS_WRITES=true (local dev).
//
// Rights: Centrale has no lab scope — every Access account sees everything
// (`allowedSlugs: 'all'`). Admins (Administration section, `admin` role)
// are the `admins` of instance.json (or the `ADMIN_EMAILS` variable, comma-separated e-mails).
//
// Instance (docs/plan-architecture-multi-instances.md, lot 5 c): the same Functions serve every
// Cloudflare instance (Centrale, public demo), told apart by their instance.json
// (functions/_lib/instance.js), Pages variables overriding it during the transition:
//   slug     — DRUID_INSTANCE (default `centrale`), also used by the build and the Grist proxy
//   label    — INSTANCE_LABEL: display name of the anonymous user (default « Centrale Nantes »)
//   readOnly — READ_ONLY: public read-only instance (no admin, the proxy refuses writes)
//
// auth.ts (frontend) redirects to /auth/login when /api/me is not OK:
// so we always answer 200 here; access control happens at the edge (Access).

import { instanceConfig, parseAdminEmails, publicInstanceInfo, resolveInstance } from '../_lib/instance.js';

export { parseAdminEmails };

// Capabilities (docs/plan-architecture-multi-instances.md, lot 1, Nantes repo): all set to
// false here, independently of any env variable — this runtime (Cloudflare
// Pages Functions) structurally cannot host any of these integrations (no reachable
// university LDAP network, no child_process to launch a sync script,
// no Python backend for the ETL/dataviz). The Nantes counterpart (server.cjs) derives them
// from the config actually present (LDAP_URL, ETL_API_URL, etc.).
export const CAPABILITIES = {
  HAS_LDAP: false,
  HAS_KEYCLOAK_ADMIN: false,
  HAS_ETL_API: false,
  HAS_PIPELINES_CHAT: false,
  HAS_HELP_CHAT: false,
  HAS_SOVISU_EXPORT: false,
  HAS_SERVER_JOBS: false,
  HAS_BENCHMARK: false,
  HAS_QUALINKA: false,
  // Internal/external status + manual validation: irrelevant for an instance that only records
  // its own internal researchers (Centrale). Tunable per instance (capabilities of instance.json).
  HAS_STATUS_VALIDATION: false,
  // « À traiter › Tâches »: needs the /api/tasks routes of server.cjs (no Functions port).
  HAS_TASKS: false,
  // Public read-only instance (demo): readOnly in instance.json. Not a HAS_* flag — it removes features
  // rather than adding an integration; the Grist proxy enforces it server-side.
  READ_ONLY: false,
};

/** Capabilities of this instance: the structural ones are fixed (see above), the others
 * come from its settings (functions/_lib/instance.js). */
export const capabilitiesFor = (instance) => ({
  ...CAPABILITIES,
  HAS_STATUS_VALIDATION: instance.statusValidation,
  READ_ONLY: instance.readOnly,
});

export const buildUser = (email, adminEmails, capabilities = CAPABILITIES, instance = resolveInstance()) => {
  const isAdmin = !!email && adminEmails.includes(String(email).toLowerCase());
  const roles = isAdmin ? ['user', 'admin'] : ['user'];
  const access = {
    isSuperAdmin: isAdmin,
    isMediaAdmin: false,
    isLabViewer: false,
    annuaireLabs: [],
    allowedSlugs: 'all',
  };
  // Instance settings the front used to read from the bundle (plan-architecture-multi-instances lot 6 a).
  const info = publicInstanceInfo(instance);
  return email
    ? { name: email, email, preferred_username: email, roles, access, capabilities, instance: info }
    : { name: instance.label, email: '', preferred_username: instance.slug, roles, access, capabilities, instance: info, anonymous: true };
};

export async function onRequest(context) {
  const { request, env } = context;
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  const instance = instanceConfig(env);
  // Read-only instance: nobody is admin (the Administration section only holds write tools).
  const adminEmails = instance.readOnly ? [] : instance.admins;
  const user = buildUser(email, adminEmails, capabilitiesFor(instance), instance);
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
