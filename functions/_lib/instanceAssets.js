// Per-instance static files of a shared deployment (docs/plan-architecture-multi-instances.md, lot 6,
// light version of D5).
//
// On a deployment that serves one instance, its dashboards (dashboard-data/) and alignment caches
// (<name>_cache.json) are copied straight into public/ and served as static files. On a shared
// deployment (DRUID_INSTANCES) a file of public/ would be served on every host, so the build copies the
// files of each instance into public/instance-assets/<slug>/ and generates, for the URLs the front
// already uses, route files that call serveInstanceAsset: the instance of the request host is
// resolved, and only its own copy is read (env.ASSETS). Direct requests to /instance-assets/ get 404.
// The build only accepts public instances there: private files (lot 7) need a store outside public/
// (R2), which no static-file rule can expose.
//
// No route: this module exports no onRequest handler; the route files are written by
// scripts/prepare-cloudflare-assets.cjs (ASSET_ROUTE_FILES) on a shared build only.
import { instanceOf } from './instance.js';

export const ASSET_ROOT = '/instance-assets';
// Alignment caches read by the front at the site root (lib/gristService.ts, AbesExportModal).
export const ALIGN_CACHES = ['idref_align_cache', 'orcid_align_cache', 'hal_align_cache', 'openalex_align_cache', 'scopus_align_cache'];

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Path of an instance's copy of a public URL path, or null when the path is not an instance file
 * (anything but dashboard-data/… and the alignment caches) or tries to leave the instance folder.
 */
export const instanceAssetPath = (slug, pathname) => {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = p.split('/').slice(1);
  if (!segments.length || !segments.every((s) => SEGMENT.test(s) && !s.includes('..'))) return null;
  const isDashboard = segments[0] === 'dashboard-data' && segments.length > 1;
  const isCache = segments.length === 1 && ALIGN_CACHES.some((name) => segments[0] === `${name}.json`);
  return isDashboard || isCache ? `${ASSET_ROOT}/${slug}/${segments.join('/')}` : null;
};

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** Route handler: the file of the request host's instance (404 for an unknown host or file). */
export async function serveInstanceAsset(context) {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const instance = instanceOf(context);
  if (!instance) return notFound();
  const url = new URL(request.url);
  const target = instanceAssetPath(instance.slug, url.pathname);
  if (!target) return notFound();
  const res = await env.ASSETS.fetch(new Request(new URL(target, url), { method: request.method, headers: request.headers }));
  if (res.status === 304) return res;
  // A missing file gets the SPA fallback (index.html): never hand HTML for a data file.
  if (!res.ok || (res.headers.get('Content-Type') || '').includes('text/html')) return notFound();
  return res;
}

/** Route handler of /instance-assets/*: the copies are only reachable through serveInstanceAsset. */
export const denyDirectAccess = async () => notFound();
