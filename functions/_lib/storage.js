// Directory storage of the Cloudflare Pages Functions (druid-internal docs/plan-migration-postgresql.md, lots 1, 3 d and
// 10 a): the same repository, domain commands and publications store as server.cjs (lib/directory/*, bundled by Pages
// with the TypeScript modules), for the instance serving the request. Every Function reaches the directory through it,
// never through the Grist API or the database itself.
//
// PostgreSQL only since lot 12 a (2026-11-25): an instance still declaring `storage: grist` gets a configuration error
// (500) on every directory route. The Grist reader stays on the Node side (server.cjs, the nightly copy) until lot 12 b.
//
// The PostgreSQL database of the instance through its Hyperdrive binding HYPERDRIVE (HYPERDRIVE__<SLUG>) — or, for a
// tenant or a registry instance with `postgres.schema`, its schema of the shared database (SAAS_HYPERDRIVE) — one
// database client per request (the connections of a Worker do not outlive the request; Hyperdrive holds the real pool),
// released by `release()` once the response is built. The driver comes from the bundle written by the build
// (functions/_generated/pg.js, scripts/functions_pg_bundle.cjs: node-postgres with its Node built-ins as `node:*`, which
// the Pages Functions build accepts without a flag), never from the `pg` package directly.
import pg from '../_generated/pg.js';
import { createDbWith } from '../../lib/db/core.ts';
import { alignCacheSourceOf } from '../../lib/saas/alignCache.ts';
import { tokenAlignTexts } from '../../lib/directory/alignTexts.ts';
import { createPgStorage } from '../../lib/directory/pg/storage.ts';
import { instanceAssetPath } from './instanceAssets.js';
import { HYPERDRIVE_BINDING, instanceOf, secretOf } from './instance.js';
import { isControlPlane, tenantConnectionString } from './saas.js';

/**
 * Alignment caches of the instance: static files (public/ on a single-instance deployment, its own copy under
 * /instance-assets/<slug>/ on a shared one), read through env.ASSETS — never through the public URL (Access).
 */
const alignCachesOf = (context, instance) => ({
  read: async (name) => {
    const url = new URL(context.request.url);
    const target = instance.shared ? instanceAssetPath(instance.slug, `/${name}.json`) : `/${name}.json`;
    if (!target || !context.env.ASSETS) return null;
    const res = await context.env.ASSETS.fetch(new Request(new URL(target, url)));
    if (!res.ok || (res.headers.get('Content-Type') || '').includes('text/html')) return null;
    return res.json().catch(() => null);
  },
});

const pgStorage = (context, instance) => {
  // A tenant of the control plane (druid-internal docs/plan-druid-saas.md, lot 1 b): its schema of the shared database,
  // every query qualified by the schema (lib/db/core.ts) — the binding of the control plane, no per-instance binding.
  // A registry instance with `postgres.schema` (the public demos on the druid-saas Worker) lives in a schema of that same
  // database when the deployment has no HYPERDRIVE binding of its own for it (druid-demo.pages.dev keeps its Neon).
  const own = instance.tenant ? null : secretOf(context.env, instance, HYPERDRIVE_BINDING);
  const sharedSchema = !instance.tenant && !own && instance.postgres?.schema && isControlPlane(context.env) ? instance.postgres.schema : null;
  const binding = instance.tenant || sharedSchema ? tenantConnectionString(context.env) : own;
  const connectionString = binding && typeof binding === 'object' ? binding.connectionString : (typeof binding === 'string' ? binding : '');
  if (!connectionString) {
    return { instance, apiKey: undefined, store: null, missing: `${instance.tenant ? 'SAAS_HYPERDRIVE' : 'HYPERDRIVE'} binding not configured on Cloudflare`, release: async () => {} };
  }
  const db = createDbWith(pg, { connectionString, max: 1, schema: instance.tenant ? instance.tenant.schema : sharedSchema || undefined });
  // A tenant's caches are rows of its schema, written by the runner after each run (lib/saas/alignCache.ts); its IdRef
  // search is the Qualinka engine of the runner (lot 3 b). The other instances read their static files.
  const caches = instance.tenant ? alignCacheSourceOf(db) : alignCachesOf(context, instance);
  const store = createPgStorage({
    db, tablesActor: 'cloudflare', align: { caches, texts: tokenAlignTexts, hasQualinka: !!instance.tenant },
  });
  // The repository caches (lists, structures) are dropped with the client: one request, one client.
  return { instance, apiKey: undefined, store, missing: null, release: () => db.destroy().catch(() => {}) };
};

/**
 * Storage of the instance serving the request: `{ instance, apiKey, store, missing, release }`. `store` =
 * `{ kind, grist?, tables, repository, commands, publications, align }` (`grist` only on a Grist instance); `missing` is
 * the configuration error to answer with (500) when the store cannot be built, `release()` is to be awaited (or
 * handed to `context.waitUntil`) once the response is built; `apiKey` is undefined when the instance has none.
 */
export const storageOf = (context) => {
  const instance = instanceOf(context);
  if (instance.storage !== 'postgres') {
    return { instance, apiKey: undefined, store: null, missing: 'Grist storage is no longer served on Cloudflare: storage postgres required', release: async () => {} };
  }
  return pgStorage(context, instance);
};

/**
 * Runs `fn(storage)` with the storage of the request, then releases it: on PostgreSQL the client holds one of the few
 * connections the database allows (5 for Centrale), whatever `fn` returns or throws. `fn` checks `storage.missing`.
 */
export const withStorage = async (context, fn) => {
  const storage = storageOf(context);
  try {
    return await fn(storage);
  } finally {
    await storage.release();
  }
};

// Keeps the driver referenced in the bundle of the Functions (node-postgres through Hyperdrive; the runtime needs the
// Node.js compatibility of the project, `nodejs_compat`).
export const PG_DRIVER = pg;
