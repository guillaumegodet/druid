// Directory storage of the Cloudflare Pages Functions (druid-internal docs/plan-migration-postgresql.md, lots 1, 3 d and
// 10 a): the same repository, domain commands and publications store as server.cjs (lib/directory/*, bundled by Pages
// with the TypeScript modules), for the instance serving the request. Every Function reaches the directory through it,
// never through the Grist API or the database itself.
//
// Two storages, chosen by the instance (functions/_lib/instance.js, `storage` of instance.json):
//  - grist: the Grist document of the instance, key GRIST_API_KEY (GRIST_API_KEY__<SLUG> on a shared deployment); a
//    read-only instance may read a public document without key. One set of stores per instance, document and key, for
//    the lifetime of the isolate.
//  - postgres: the PostgreSQL database of the instance through its Hyperdrive binding HYPERDRIVE (HYPERDRIVE__<SLUG>),
//    one database client per request (the connections of a Worker do not outlive the request; Hyperdrive holds the
//    real pool), released by `release()` once the response is built.
import pg from 'pg';
import { createDb } from '../../lib/db/client.ts';
import { createGristAlignCommands } from '../../lib/directory/alignCommands.ts';
import { tokenAlignTexts } from '../../lib/directory/alignTexts.ts';
import { createGristDirectoryCommands } from '../../lib/directory/commands.ts';
import { createPgStorage } from '../../lib/directory/pg/storage.ts';
import { createGristDirectoryRepository, createGristReader } from '../../lib/directory/repository.ts';
import { createGristPublicationsStore } from '../../lib/publications/store.ts';
import { instanceAssetPath } from './instanceAssets.js';
import { HYPERDRIVE_BINDING, instanceOf, secretOf } from './instance.js';

const gristStores = new Map();

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

const gristStorage = (context, instance) => {
  const apiKey = secretOf(context.env, instance, 'GRIST_API_KEY');
  // The key is part of the cache key: a rotated secret never reuses a client built with the former one.
  const key = `${instance.slug}|${instance.grist.apiBase}|${instance.grist.docId}|${apiKey || ''}`;
  let store = gristStores.get(key);
  if (!store) {
    const grist = createGristReader({
      apiBase: instance.grist.apiBase,
      docId: instance.grist.docId,
      apiKey: apiKey || undefined,
      userAgent: `Druid-CRISalid-${instance.slug}/1.0`,
    });
    const repository = createGristDirectoryRepository({ grist });
    store = {
      kind: 'grist',
      grist,
      /** The document as a table client (Annuaire reads of news/newsletter, reports tables). */
      tables: grist,
      repository,
      commands: createGristDirectoryCommands({ grist, repository }),
      // Only the instance document (no side document on Cloudflare).
      publications: createGristPublicationsStore({ main: grist, readerFor: (docId) => (docId === instance.grist.docId ? grist : null) }),
    };
    gristStores.set(key, store);
  }
  // The alignment commands read the caches through the bindings of THIS request: built per request.
  const align = createGristAlignCommands({
    grist: store.grist, repository: store.repository, annuaireColumns: store.commands.annuaireColumns,
    texts: tokenAlignTexts, hasQualinka: false, caches: alignCachesOf(context, instance),
  });
  const missing = !apiKey && !instance.readOnly ? 'GRIST_API_KEY not configured on Cloudflare' : null;
  return { instance, apiKey, store: { ...store, align }, missing, release: async () => {} };
};

const pgStorage = (context, instance) => {
  const binding = secretOf(context.env, instance, HYPERDRIVE_BINDING);
  const connectionString = binding && typeof binding === 'object' ? binding.connectionString : (typeof binding === 'string' ? binding : '');
  if (!connectionString) {
    return { instance, apiKey: undefined, store: null, missing: 'HYPERDRIVE binding not configured on Cloudflare', release: async () => {} };
  }
  const db = createDb({ connectionString, max: 1 });
  const store = createPgStorage({
    db, tablesActor: 'cloudflare', align: { caches: alignCachesOf(context, instance), texts: tokenAlignTexts, hasQualinka: false },
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
  return instance.storage === 'postgres' ? pgStorage(context, instance) : gristStorage(context, instance);
};

// Keeps the driver referenced in the bundle of the Functions (node-postgres through Hyperdrive, nodejs_compat).
export const PG_DRIVER = pg;
