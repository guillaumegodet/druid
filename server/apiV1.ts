// Node host of the directory domain API (/api/v1) for server.cjs — druid-internal
// docs/plan-migration-postgresql.md, lot 1.
//
// Bundled by `npm run build:server` (esbuild) into server-api.cjs, which server.cjs requires: the
// TypeScript domain code (lib/directory/*) then runs unchanged on Node and in the Cloudflare Functions.
// This file only adapts Express to the Web Request/Response of the Hono application and turns the
// Keycloak session into a DirectoryScope.
import fs from 'node:fs';
import path from 'node:path';
import { createDirectoryApi } from '../lib/directory/api';
import {
  createGristDirectoryRepository, createGristReader, DirectoryScope, LdapCacheSnapshot,
} from '../lib/directory/repository';

/** The parts of an Express request / response used here (no dependency on the Express typings). */
interface NodeRequest {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  session?: { user?: { access?: { allSlugs?: boolean; labAnchors?: string[] } } };
}
interface NodeResponse {
  status(code: number): NodeResponse;
  setHeader(name: string, value: string): void;
  end(body?: Buffer): void;
}

export interface ApiV1Options {
  gristApiBase: string;
  gristDocId: string;
  gristApiKey: string;
  /** Folder holding ldap_status_cache.json (app root), dist/ being the fallback — same rule as the
   * /ldap_status_cache.json route of server.cjs. */
  appRoot: string;
}

/** Session access (server.cjs parseDruidAccess) → scope; null without an authenticated user. */
export const scopeOfSession = (req: Pick<NodeRequest, 'session'>): DirectoryScope | null => {
  const access = req.session?.user?.access;
  if (!req.session?.user || !access) return null;
  return { all: !!access.allSlugs, labAnchors: Array.isArray(access.labAnchors) ? access.labAnchors : [] };
};

/** Reads ldap_status_cache.json again only when its modification time or size changed. */
const ldapCacheLoader = (appRoot: string): (() => Promise<LdapCacheSnapshot>) => {
  let last: LdapCacheSnapshot | null = null;
  return async () => {
    const candidates = [path.join(appRoot, 'ldap_status_cache.json'), path.join(appRoot, 'dist', 'ldap_status_cache.json')];
    for (const file of candidates) {
      let stat: fs.Stats;
      try { stat = fs.statSync(file); } catch { continue; }
      if (stat.size === 0) continue;
      const version = `${file}:${stat.mtimeMs}:${stat.size}`;
      if (last?.version !== version) {
        try {
          last = { data: JSON.parse(fs.readFileSync(file, 'utf8')), version };
        } catch (err) {
          // A cache being rewritten by the LDAP sync: keep the previous content rather than failing the API.
          console.warn('[api/v1] unreadable LDAP cache, previous version kept:', (err as Error).message);
          return last ?? { data: {}, version: '' };
        }
      }
      return last!;
    }
    return { data: {}, version: '' };
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

/** Express handler of `/api/v1/*`. */
export const createApiV1Handler = (options: ApiV1Options) => {
  const api = createDirectoryApi();
  const repository = createGristDirectoryRepository({
    grist: createGristReader({
      apiBase: options.gristApiBase,
      docId: options.gristDocId,
      apiKey: options.gristApiKey,
      userAgent: 'Druid-CRISalid/1.0',
    }),
    loadLdapCache: ldapCacheLoader(options.appRoot),
  });
  return async (req: NodeRequest, res: NodeResponse): Promise<void> => {
    const response = await api.fetch(toWebRequest(req), { repository, scope: scopeOfSession(req) });
    res.status(response.status);
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
};
