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
// are listed in the `ADMIN_EMAILS` variable (comma-separated e-mails).
//
// Instance (docs/plan-instance-demo-cloudflare.md, lot A1): the same Functions serve every
// Cloudflare instance (Centrale, public demo), told apart by environment variables:
//   DRUID_INSTANCE  — slug (default `centrale`), also used by the build and the Grist proxy
//   INSTANCE_LABEL  — display name of the anonymous user (default « Centrale Nantes »)
//   READ_ONLY       — "true": public read-only instance (no admin, the proxy refuses writes)
//
// auth.ts (frontend) redirects to /auth/login when /api/me is not OK:
// so we always answer 200 here; access control happens at the edge (Access).

export const parseAdminEmails = (raw) =>
  String(raw || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

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
  // its own internal researchers (Centrale). Can be re-enabled with SHOW_STATUS_VALIDATION=true.
  HAS_STATUS_VALIDATION: false,
  // « À traiter › Tâches »: needs the /api/tasks routes of server.cjs (no Functions port).
  HAS_TASKS: false,
  // Public read-only instance (demo): READ_ONLY=true. Not a HAS_* flag — it removes features
  // rather than adding an integration; the Grist proxy enforces it server-side.
  READ_ONLY: false,
};

const isTrue = (v) => String(v || '').toLowerCase() === 'true';

/** Instance settings read from the Pages environment (build variables are also exposed
 * to Functions). */
export const instanceFromEnv = (env = {}) => ({
  slug: String(env.DRUID_INSTANCE || 'centrale').trim() || 'centrale',
  label: String(env.INSTANCE_LABEL || 'Centrale Nantes'),
  readOnly: isTrue(env.READ_ONLY),
});

/** Capabilities of this instance: the structural ones are fixed (see above), the others
 * come from the environment. */
export const capabilitiesFromEnv = (env = {}) => ({
  ...CAPABILITIES,
  HAS_STATUS_VALIDATION: isTrue(env.SHOW_STATUS_VALIDATION),
  READ_ONLY: isTrue(env.READ_ONLY),
});

export const buildUser = (email, adminEmails, capabilities = CAPABILITIES, instance = instanceFromEnv()) => {
  const isAdmin = !!email && adminEmails.includes(String(email).toLowerCase());
  const roles = isAdmin ? ['user', 'admin'] : ['user'];
  const access = {
    isSuperAdmin: isAdmin,
    isMediaAdmin: false,
    isLabViewer: false,
    annuaireLabs: [],
    allowedSlugs: 'all',
  };
  return email
    ? { name: email, email, preferred_username: email, roles, access, capabilities }
    : { name: instance.label, email: '', preferred_username: instance.slug, roles, access, capabilities, anonymous: true };
};

export async function onRequest(context) {
  const { request, env } = context;
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  const instance = instanceFromEnv(env);
  // Read-only instance: nobody is admin (the Administration section only holds write tools).
  const adminEmails = instance.readOnly ? [] : parseAdminEmails(env.ADMIN_EMAILS);
  const user = buildUser(email, adminEmails, capabilitiesFromEnv(env), instance);
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
