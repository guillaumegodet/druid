// Directory storage of the Cloudflare Pages Functions (druid-internal docs/plan-migration-postgresql.md, lots 1 and 3 d):
// the same Grist client, repository, domain commands and publications store as server.cjs (lib/directory/*, bundled
// by Pages with the TypeScript modules), for the instance serving the request. Every Function reaches the directory
// through it, never through the Grist API itself.
//
// Instance (functions/_lib/instance.js): Grist document and API base of the instance, key GRIST_API_KEY
// (GRIST_API_KEY__<SLUG> on a shared deployment); a read-only instance may read a public document without key.
import { createGristDirectoryCommands } from '../../lib/directory/commands.ts';
import { createGristDirectoryRepository, createGristReader } from '../../lib/directory/repository.ts';
import { createGristPublicationsStore } from '../../lib/publications/store.ts';
import { instanceOf, secretOf } from './instance.js';

// One set of stores (and their caches) per instance, document and key, for the lifetime of the isolate.
const stores = new Map();

/**
 * Storage of the instance serving the request: `{ instance, apiKey, store }`, `store` = `{ grist, repository,
 * commands, publications }`. `apiKey` is undefined when the instance has none (the caller decides whether a keyless
 * read of a public document is allowed).
 */
export const storageOf = (context) => {
  const instance = instanceOf(context);
  const apiKey = secretOf(context.env, instance, 'GRIST_API_KEY');
  // The key is part of the cache key: a rotated secret never reuses a client built with the former one.
  const key = `${instance.slug}|${instance.grist.apiBase}|${instance.grist.docId}|${apiKey || ''}`;
  let store = stores.get(key);
  if (!store) {
    const grist = createGristReader({
      apiBase: instance.grist.apiBase,
      docId: instance.grist.docId,
      apiKey: apiKey || undefined,
      userAgent: `Druid-CRISalid-${instance.slug}/1.0`,
    });
    const repository = createGristDirectoryRepository({ grist });
    store = {
      grist,
      repository,
      commands: createGristDirectoryCommands({ grist, repository }),
      // Only the instance document (no side document on Cloudflare).
      publications: createGristPublicationsStore({ main: grist, readerFor: (docId) => (docId === instance.grist.docId ? grist : null) }),
    };
    stores.set(key, store);
  }
  return { instance, apiKey, store };
};
