// Cloudflare Pages Function — « Mes rapports » API (docs/plan-mes-rapports.md, lot 2).
// Equivalent of `app.all('/api/reports*')` in server.cjs: same routing, access control and Grist
// storage, from the shared module scripts/lib/reports_store.cjs (bundled by esbuild).
//
// Identity = Cloudflare Access (header Cf-Access-Authenticated-User-Email); without it the API
// refuses (401), except locally with ALLOW_ANONYMOUS_WRITES=true (never on a shared deployment).
// Read-only instance (public demo): 403 on every route — the client keeps reports in the browser
// (lib/reportsApi.ts). Super admins = the `admins` of the instance.
import reportsStore from '../../../scripts/lib/reports_store.cjs';
import { instanceOf, secretOf } from '../../_lib/instance.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function onRequest(context) {
  const { request, env, params } = context;
  const instance = instanceOf(context);
  if (instance.readOnly) return json(403, { error: 'Read-only instance: reports are kept in the browser' });

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  const anonymousAllowed = !instance.shared && env.ALLOW_ANONYMOUS_WRITES === 'true';
  if (!email && !anonymousAllowed) return json(401, { error: 'Unauthorized' });

  const apiKey = secretOf(env, instance, 'GRIST_API_KEY');
  if (!apiKey) return json(500, { error: 'GRIST_API_KEY not configured on Cloudflare' });

  let body;
  if (!['GET', 'HEAD'].includes(request.method)) {
    try {
      const raw = await request.text();
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      return json(400, { error: 'Invalid report definition' });
    }
  }
  const store = reportsStore.createReportsStore(reportsStore.gristClient({
    apiBase: instance.grist.apiBase,
    doc: instance.grist.docId,
    apiKey,
    userAgent: `Druid-CRISalid-${instance.slug}/1.0`,
  }));
  const user = {
    id: email ? email.toLowerCase() : 'anonymous',
    isSuperAdmin: !!email && instance.admins.includes(email.toLowerCase()),
  };
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const out = await reportsStore.routeReports(store, user, { method: request.method, segments, body });
  return json(out.status, out.body);
}
