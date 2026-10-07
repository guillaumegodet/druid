// Cloudflare Pages Function — directory domain API (/api/v1), druid-internal
// docs/plan-migration-postgresql.md, lot 1. Same Hono application as server.cjs (lib/directory/api.ts),
// bundled by Pages with the TypeScript modules it imports.
//
// Instance (functions/_lib/instance.js): Grist document and API base of the instance serving the request,
// key GRIST_API_KEY (GRIST_API_KEY__<SLUG> on a shared deployment); a read-only instance may read a public
// document without key, as the /api/grist proxy does.
//
// Rights: the Cloudflare instances have no lab scope (see functions/api/me.js): every account that gets
// through Cloudflare Access reads the whole directory, as it did through the proxy.
import { createDirectoryApi } from '../../../lib/directory/api.ts';
import { createGristDirectoryRepository, createGristReader } from '../../../lib/directory/repository.ts';
import { instanceOf, secretOf } from '../../_lib/instance.js';

const api = createDirectoryApi();
// One repository (and its caches) per instance and document, for the lifetime of the isolate.
const repositories = new Map();

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequest(context) {
  const instance = instanceOf(context);
  const apiKey = secretOf(context.env, instance, 'GRIST_API_KEY');
  if (!apiKey && !instance.readOnly) return json(500, { error: 'GRIST_API_KEY not configured on Cloudflare' });

  const key = `${instance.slug}|${instance.grist.apiBase}|${instance.grist.docId}`;
  let repository = repositories.get(key);
  if (!repository) {
    repository = createGristDirectoryRepository({
      grist: createGristReader({
        apiBase: instance.grist.apiBase,
        docId: instance.grist.docId,
        apiKey: apiKey || undefined,
        userAgent: `Druid-CRISalid-${instance.slug}/1.0`,
      }),
    });
    repositories.set(key, repository);
  }
  return api.fetch(context.request, { repository, scope: { all: true, labAnchors: [] } });
}
