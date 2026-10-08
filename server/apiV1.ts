// Node host of the directory domain API (/api/v1) for server.cjs — druid-internal
// docs/plan-migration-postgresql.md, lot 1 — and storage client of the Node jobs (lot 3: scripts/lib/storage.cjs).
//
// Bundled by `npm run build:server` (esbuild) into server-api.cjs, which server.cjs requires: the
// TypeScript domain code (lib/directory/*) then runs unchanged on Node and in the Cloudflare Functions.
// This file only adapts Express to the Web Request/Response of the Hono application and turns the
// Keycloak session into a DirectoryScope.
import fs from 'node:fs';
import path from 'node:path';
import { AUDIT_HEADER, createDirectoryApi } from '../lib/directory/api';
import { createGristDirectoryCommands } from '../lib/directory/commands';
import { createGristLdapCommands } from '../lib/directory/ldapCommands';
import { createGristAlignCommands } from '../lib/directory/alignCommands';
import { tokenAlignTexts } from '../lib/directory/alignTexts';
import {
  createGristDirectoryRepository, createGristReader, DirectoryScope, GristClient, LdapCacheSnapshot,
} from '../lib/directory/repository';
import { createGristPublicationsStore } from '../lib/publications/store';

/** The parts of an Express request / response used here (no dependency on the Express typings). */
interface NodeRequest {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  session?: { user?: { preferred_username?: string; access?: { allSlugs?: boolean; labAnchors?: string[] } } };
}
interface NodeResponse {
  status(code: number): NodeResponse;
  setHeader(name: string, value: string): void;
  end(body?: Buffer): void;
  /** Express: the audit of the writes goes to res.locals.apiAudit, read by the activity log of server.cjs. */
  locals?: Record<string, unknown>;
}

export interface ApiV1Options {
  gristApiBase: string;
  gristDocId: string;
  gristApiKey: string;
  /** Other documents the instance may read (GRIST_EXTRA_DOC_IDS: axes curation of a structure). */
  gristExtraDocIds?: string[];
  /** Folder holding the caches of the sync scripts (ldap_status_cache.json…), dist/ being the fallback — same rule
   * as the cache routes of server.cjs. */
  appRoot: string;
  /** LDAP review routes (capability HAS_LDAP). */
  hasLdap?: boolean;
  /** Qualinka engine for the IdRef search (capability HAS_QUALINKA). */
  hasQualinka?: boolean;
}

// Storage of the Node jobs (lot 3): taken from this bundle by scripts/lib/storage.cjs.
export { gristClientFromEnv, jobStorageFromEnv, jobContext } from '../lib/directory/jobStorage';

/** Session access (server.cjs parseDruidAccess) → scope; null without an authenticated user. */
export const scopeOfSession = (req: Pick<NodeRequest, 'session'>): DirectoryScope | null => {
  const access = req.session?.user?.access;
  if (!req.session?.user || !access) return null;
  return { all: !!access.allSlugs, labAnchors: Array.isArray(access.labAnchors) ? access.labAnchors : [] };
};

/** Reads a JSON cache of the app root (dist/ being the fallback) again only when its modification time or size
 * changed — same rule as the cache routes of server.cjs. Missing or empty file → `empty`. */
const jsonFileLoader = <T>(appRoot: string, name: string, empty: T): (() => Promise<{ data: T; version: string }>) => {
  let last: { data: T; version: string } | null = null;
  return async () => {
    for (const file of [path.join(appRoot, name), path.join(appRoot, 'dist', name)]) {
      let stat: fs.Stats;
      try { stat = fs.statSync(file); } catch { continue; }
      if (stat.size === 0) continue;
      const version = `${file}:${stat.mtimeMs}:${stat.size}`;
      if (last?.version !== version) {
        try {
          last = { data: JSON.parse(fs.readFileSync(file, 'utf8')), version };
        } catch (err) {
          // A cache being rewritten by a sync: keep the previous content rather than failing the API.
          console.warn(`[api/v1] unreadable ${name}, previous version kept:`, (err as Error).message);
          return last ?? { data: empty, version: '' };
        }
      }
      return last!;
    }
    return { data: empty, version: '' };
  };
};

/** Express request → Web Request (the JSON body already parsed by express.json is serialized again). */
const toWebRequest = (req: NodeRequest): Request => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body !== undefined;
  if (hasBody) headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(`http://${headers.get('host') || 'localhost'}${req.originalUrl}`, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body) : undefined,
  });
};

/**
 * Directory storage of the server: Grist clients, repository, publications store and domain commands, created once and
 * shared by `/api/v1` and the other routes of server.cjs (druid-internal docs/plan-migration-postgresql.md, lot 3 c).
 */
export const createServerStorage = (options: ApiV1Options) => {
  if (!options.gristDocId) throw new Error('VITE_GRIST_DOC_ID is not set: no directory document to serve');
  const readers = new Map<string, GristClient>();
  const allowedDocs = new Set([options.gristDocId, ...(options.gristExtraDocIds || [])].filter(Boolean));
  const readerFor = (docId: string): GristClient | null => {
    if (!allowedDocs.has(docId)) return null;
    if (!readers.has(docId)) {
      readers.set(docId, createGristReader({
        apiBase: options.gristApiBase, docId, apiKey: options.gristApiKey, userAgent: 'Druid-CRISalid/1.0',
      }));
    }
    return readers.get(docId)!;
  };
  const main = readerFor(options.gristDocId)!;
  const ldapStatus = jsonFileLoader<Record<string, any>>(options.appRoot, 'ldap_status_cache.json', {});
  const repository = createGristDirectoryRepository({ grist: main, loadLdapCache: ldapStatus });
  const publications = createGristPublicationsStore({ main, readerFor });
  const commands = createGristDirectoryCommands({ grist: main, repository });
  const ldapCandidates = jsonFileLoader<any>(options.appRoot, 'ldap_candidates_cache.json', { proposals: [], ambiguous: [] });
  const ldapStructures = jsonFileLoader<Record<string, any>>(options.appRoot, 'structures_ldap_cache.json', {});
  const ldap = options.hasLdap ? createGristLdapCommands({
    grist: main, repository, annuaireColumns: commands.annuaireColumns,
    ldap: { status: ldapStatus, candidates: async () => (await ldapCandidates()).data, structures: async () => (await ldapStructures()).data },
  }) : undefined;
  // Alignment caches written by the scripts at the app root (idref_align_cache.json…), re-read when they change.
  const alignLoaders = new Map<string, () => Promise<{ data: Record<string, any> | null; version: string }>>();
  const align = createGristAlignCommands({
    grist: main, repository, annuaireColumns: commands.annuaireColumns, texts: tokenAlignTexts, hasQualinka: !!options.hasQualinka,
    caches: {
      read: async (name) => {
        if (!alignLoaders.has(name)) alignLoaders.set(name, jsonFileLoader<Record<string, any> | null>(options.appRoot, `${name}.json`, null));
        return (await alignLoaders.get(name)!()).data;
      },
    },
  });
  return { grist: main, repository, publications, commands, ldap, align };
};
export type ServerStorage = ReturnType<typeof createServerStorage>;

/** Express handler of `/api/v1/*`. */
export const createApiV1Handler = (storage: ServerStorage) => {
  const api = createDirectoryApi();
  return async (req: NodeRequest, res: NodeResponse): Promise<void> => {
    const response = await api.fetch(toWebRequest(req), {
      ...storage, scope: scopeOfSession(req), actor: req.session?.user?.preferred_username, writeRefusal: null,
    });
    res.status(response.status);
    const audit = response.headers.get(AUDIT_HEADER);
    if (audit && res.locals) {
      try { res.locals.apiAudit = JSON.parse(audit); } catch { /* malformed: not logged */ }
    }
    response.headers.forEach((value, name) => { if (name.toLowerCase() !== AUDIT_HEADER.toLowerCase()) res.setHeader(name, value); });
    res.end(Buffer.from(await response.arrayBuffer()));
  };
};
