// Cloudflare Pages Function — « Mes rapports » API (docs/plan-mes-rapports.md, lots 2 and 9).
// Equivalent of `app.all('/api/reports*')` in server.cjs: same routing, access control and Grist
// storage, from the shared module scripts/lib/reports_store.cjs (bundled by esbuild), over the storage client of the
// instance (functions/_lib/storage.js).
//
// Identity = Cloudflare Access (header Cf-Access-Authenticated-User-Email); without it the API
// refuses (401), except locally with ALLOW_ANONYMOUS_WRITES=true (never on a shared deployment).
// Read-only instance (public demo): 403 on every route — the client keeps reports in the browser
// (lib/reportsApi.ts). Super admins = the `admins` of the instance.
//
// Archived PDFs (lot 9): an R2 bucket bound as `REPORT_PDFS` to the Pages project, keys prefixed by
// the instance slug (one bucket may serve a shared deployment). Without the binding, archiving is
// off: the history keeps the metadata only.
import reportsStore from '../../../scripts/lib/reports_store.cjs';
import { storageOf } from '../../_lib/storage.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** R2 adapter of the `blobs` expected by createReportsStore. */
const r2Blobs = (bucket, prefix) => ({
  put: (key, bytes) => bucket.put(`${prefix}/${key}`, bytes, { httpMetadata: { contentType: 'application/pdf' } }),
  get: async (key) => {
    const obj = await bucket.get(`${prefix}/${key}`);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  },
  remove: (key) => bucket.delete(`${prefix}/${key}`),
});

export async function onRequest(context) {
  const { request, env, params } = context;
  const { instance, apiKey, store: storage } = storageOf(context);
  if (instance.readOnly) return json(403, { error: 'Read-only instance: reports are kept in the browser' });

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  const anonymousAllowed = !instance.shared && env.ALLOW_ANONYMOUS_WRITES === 'true';
  if (!email && !anonymousAllowed) return json(401, { error: 'Unauthorized' });

  if (!apiKey) return json(500, { error: 'GRIST_API_KEY not configured on Cloudflare' });

  let body;
  if (!['GET', 'HEAD'].includes(request.method)) {
    if ((request.headers.get('Content-Type') || '').startsWith('application/pdf')) {
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > reportsStore.LIMITS.maxPdfBytes) return json(400, { error: 'Invalid PDF' });
      body = new Uint8Array(await request.arrayBuffer());
    } else {
      try {
        const raw = await request.text();
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        return json(400, { error: 'Invalid report definition' });
      }
    }
  }
  const store = reportsStore.createReportsStore(
    reportsStore.storageClient(storage.grist, `${instance.grist.apiBase}/${instance.grist.docId}`),
    { blobs: env.REPORT_PDFS ? r2Blobs(env.REPORT_PDFS, instance.slug) : null },
  );
  const user = {
    id: email ? email.toLowerCase() : 'anonymous',
    isSuperAdmin: !!email && instance.admins.includes(email.toLowerCase()),
  };
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const out = await reportsStore.routeReports(store, user, { method: request.method, segments, body });
  if (out.binary) {
    return new Response(out.binary, {
      status: out.status,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${out.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
  return json(out.status, out.body);
}
