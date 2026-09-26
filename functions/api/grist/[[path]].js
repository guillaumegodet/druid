// Cloudflare Pages Function — Grist proxy.
// Equivalent of `app.all('/api/grist/*')` + `gristProxyGuard` in server.cjs (Nantes 77a3f44).
// The Grist API key stays ONLY on the edge (CF secret), never in the bundle.
//
// Settings (functions/_lib/instance.js: instance.json, overridden by the Pages variables):
//   GRIST_API_KEY   (secret)   — key of a Grist account with access to the Centrale doc;
//                                optional on a read-only instance (public doc read anonymously)
//   grist.apiBase              — GRIST_API_BASE, default https://grist.numerique.gouv.fr/api
//   grist.docId                — the only proxied doc (GRIST_DOC_ID, then VITE_GRIST_DOC_ID)
//   ALLOW_ANONYMOUS_WRITES     — "true" locally only: writes without an Access identity
//   readOnly                   — READ_ONLY (public demo, docs/plan-instance-demo-cloudflare.md):
//                                every write is refused, whatever the identity
//   slug                       — DRUID_INSTANCE, only used in the User-Agent (default centrale)
//
// Scope (the key has full rights on the Grist account, so the proxy must restrict it):
//  - path: docs/<allowed doc>[/tables[/<table>[/records|/columns|/data/delete]]];
//    everything else (orgs, workspaces, attachments, sql, other docs) → 403;
//  - GET: always proxied;
//  - writes: POST/PATCH only (DELETE and PUT → 405), never on the doc root, only
//    to the listed tables (GRIST_TABLES) or to create a listed table
//    (POST /tables) — the Alignement_* and Fusions_log tables are created by the
//    frontend on first use;
//  - every write requires a Cloudflare Access identity (header
//    Cf-Access-Authenticated-User-Email), unless ALLOW_ANONYMOUS_WRITES=true;
//  - read-only instance: every write → 403, checked before anything else (overrides
//    ALLOW_ANONYMOUS_WRITES).
// Centrale has no lab scope (every account = institution-wide rights).

import { instanceConfig } from '../../_lib/instance.js';

const PATH_RE = /^docs\/([A-Za-z0-9_-]+)(?:\/(tables)(?:\/([A-Za-z0-9_]+)(?:\/(records|columns|data\/delete))?)?)?$/;
const GRIST_TABLES = new Set([
  'Annuaire', 'Structures', 'Etablissements', 'Newsletter',
  'Alignement_IdRef', 'Alignement_HAL', 'Alignement_ORCID', 'Alignement_OpenAlex',
  'Fusions_log', 'BenchmarkPeerGroups',
]);

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Checks a request to the proxy; returns a refusal Response, or null if it can be proxied. */
export const gristGuard = ({ method, path, doc, hasIdentity, allowAnonymousWrites, readOnly = false, tableIdOfBody }) => {
  const m = PATH_RE.exec(path);
  if (!m || !doc || m[1] !== doc) return json(403, { error: 'Grist path not allowed by the proxy' });
  const [, , tablesSeg, table, sub] = m;
  if (method === 'GET' || method === 'HEAD') return null;
  if (readOnly) return json(403, { error: 'Read-only instance: writes are disabled' });
  if (!['POST', 'PATCH'].includes(method)) return json(405, { error: `Method not relayed: ${method}` });
  if (!tablesSeg) return json(403, { error: 'Writing to the document root is refused' });
  if (!hasIdentity && !allowAnonymousWrites) {
    return json(403, { error: 'Grist writes require an authenticated user (Cloudflare Access)' });
  }
  if (!table) {
    // POST /tables: only the creation of a listed table
    if (method !== 'POST') return json(405, { error: 'Method not relayed on /tables' });
    const ids = tableIdOfBody();
    if (!ids.length || ids.some((id) => !GRIST_TABLES.has(id))) {
      return json(403, { error: 'Table creation not allowed' });
    }
    return null;
  }
  if (!GRIST_TABLES.has(table)) return json(403, { error: `Table not writable through the proxy: ${table}` });
  if (!sub) return json(403, { error: 'Writing to the table definition is refused' });
  return null;
};

export async function onRequest(context) {
  const { request, env, params } = context;

  const instance = instanceConfig(env);
  const { readOnly } = instance;
  const apiKey = env.GRIST_API_KEY;
  // Without a key, only a read-only instance may relay (anonymous reads of a public doc):
  // a writable instance without a key is a configuration error.
  if (!apiKey && !readOnly) return json(500, { error: 'GRIST_API_KEY not configured on Cloudflare' });

  const base = instance.grist.apiBase;
  // params.path = segments after /api/grist/  (e.g. ['docs','abc','tables','Annuaire','records'])
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const gristPath = segments.join('/');
  const method = request.method;
  let body = '';
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) body = await request.text();

  const refusal = gristGuard({
    method,
    path: gristPath,
    doc: instance.grist.docId,
    hasIdentity: !!request.headers.get('Cf-Access-Authenticated-User-Email'),
    allowAnonymousWrites: env.ALLOW_ANONYMOUS_WRITES === 'true',
    readOnly,
    tableIdOfBody: () => {
      try { return (JSON.parse(body).tables || []).map((t) => String(t.id || '')); } catch { return []; }
    },
  });
  if (refusal) return refusal;

  // Keep the original query string (?filter=..., ?limit=...)
  const search = new URL(request.url).search;
  const targetUrl = `${base}/${segments.map(encodeURIComponent).join('/')}${search}`;
  const init = {
    method,
    headers: {
      Accept: 'application/json',
      'User-Agent': `Druid-CRISalid-${instance.slug}/1.0`,
    },
  };
  if (apiKey) init.headers.Authorization = `Bearer ${apiKey}`;
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = body;
  }

  try {
    const upstream = await fetch(targetUrl, init);
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return json(502, { error: String((err && err.message) || err) });
  }
}
