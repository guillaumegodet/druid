// Cloudflare Pages Function — directory domain API (/api/v1), druid-internal
// docs/plan-migration-postgresql.md, lot 1. Same Hono application as server.cjs (lib/directory/api.ts),
// bundled by Pages with the TypeScript modules it imports.
//
// Instance (functions/_lib/instance.js): Grist document and API base of the instance serving the request,
// key GRIST_API_KEY (GRIST_API_KEY__<SLUG> on a shared deployment); a read-only instance may read a public
// document without key, as the /api/grist proxy does.
//
// Rights: the Cloudflare instances have no lab scope (see functions/api/me.js): every account that gets
// through Cloudflare Access reads the whole directory, as it did through the proxy. Writes, as through the
// proxy: refused on a read-only instance, and without a Cloudflare Access identity (unless
// ALLOW_ANONYMOUS_WRITES=true locally). The audit of the writes goes to the Functions log.
import { AUDIT_HEADER, createDirectoryApi } from '../../../lib/directory/api.ts';
import { createGristDirectoryCommands } from '../../../lib/directory/commands.ts';
import { createGristAlignCommands } from '../../../lib/directory/alignCommands.ts';
import { tokenAlignTexts } from '../../../lib/directory/alignTexts.ts';
import { createGristDirectoryRepository, createGristReader } from '../../../lib/directory/repository.ts';
import { createGristPublicationsStore } from '../../../lib/publications/store.ts';
import { instanceOf, secretOf } from '../../_lib/instance.js';
import { instanceAssetPath } from '../../_lib/instanceAssets.js';

const api = createDirectoryApi();
// One set of stores (and their caches) per instance and document, for the lifetime of the isolate.
const stores = new Map();

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequest(context) {
  const instance = instanceOf(context);
  const apiKey = secretOf(context.env, instance, 'GRIST_API_KEY');
  if (!apiKey && !instance.readOnly) return json(500, { error: 'GRIST_API_KEY not configured on Cloudflare' });

  const key = `${instance.slug}|${instance.grist.apiBase}|${instance.grist.docId}`;
  let store = stores.get(key);
  if (!store) {
    const main = createGristReader({
      apiBase: instance.grist.apiBase,
      docId: instance.grist.docId,
      apiKey: apiKey || undefined,
      userAgent: `Druid-CRISalid-${instance.slug}/1.0`,
    });
    const repository = createGristDirectoryRepository({ grist: main });
    store = {
      grist: main,
      repository,
      commands: createGristDirectoryCommands({ grist: main, repository }),
      // Only the instance document, as the /api/grist proxy (no side document on Cloudflare).
      publications: createGristPublicationsStore({ main, readerFor: (docId) => (docId === instance.grist.docId ? main : null) }),
    };
    stores.set(key, store);
  }
  const identity = context.request.headers.get('Cf-Access-Authenticated-User-Email');
  const allowAnonymousWrites = !instance.shared && context.env.ALLOW_ANONYMOUS_WRITES === 'true';
  const writeRefusal = instance.readOnly
    ? { status: 403, error: 'Read-only instance: writes are disabled' }
    : (!identity && !allowAnonymousWrites ? { status: 403, error: 'Grist writes require an authenticated user (Cloudflare Access)' } : null);

  // Alignment caches: static files of the instance (public/ on a single-instance deployment, its own copy under
  // /instance-assets/<slug>/ on a shared one), read through env.ASSETS — never through the public URL (Access).
  const readAlignCache = async (name) => {
    const url = new URL(context.request.url);
    const target = instance.shared ? instanceAssetPath(instance.slug, `/${name}.json`) : `/${name}.json`;
    if (!target || !context.env.ASSETS) return null;
    const res = await context.env.ASSETS.fetch(new Request(new URL(target, url)));
    if (!res.ok || (res.headers.get('Content-Type') || '').includes('text/html')) return null;
    return res.json().catch(() => null);
  };
  const align = createGristAlignCommands({
    grist: store.grist, repository: store.repository, annuaireColumns: store.commands.annuaireColumns,
    texts: tokenAlignTexts, hasQualinka: false, caches: { read: readAlignCache },
  });

  const response = await api.fetch(context.request, { ...store, align, scope: { all: true, labAnchors: [] }, writeRefusal });
  const audit = response.headers.get(AUDIT_HEADER);
  if (!audit) return response;
  console.log(JSON.stringify({ event: 'api.write', instance: instance.slug, user: identity, path: new URL(context.request.url).pathname, status: response.status, writes: JSON.parse(audit) }));
  const headers = new Headers(response.headers);
  headers.delete(AUDIT_HEADER);
  return new Response(response.body, { status: response.status, headers });
}
