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
import { createDb } from '../lib/db/client';
import { createPgLdapCommands } from '../lib/directory/pg/ldapCommands';
import { createPgStorage } from '../lib/directory/pg/storage';
import { createPgWorkPorts } from '../lib/work/pg/workPorts';
import type { StorageKind } from '../lib/directory/jobStorage';
import { graphActionsOverview, recordPeopleCsvExport } from '../lib/graph/pg';
import { prepareGraphForPeopleCsv, type GraphActionsMode } from '../lib/graph/publisher';
import { connectGraphBus } from '../lib/graph/bus';
import { createCallsStore } from '../lib/calls/pg';
import { createPairFeedbackStore } from '../lib/pairs/feedback';
import { createThesisStore } from '../lib/thesisStore';
import { createEligibilityStore } from '../lib/calls/eligibilityStore';
import { createManualCallsStore } from '../lib/calls/manualStore';
import { extractCallFields, fetchCallDocument, htmlDocument, pdfDocument, textDocument, type CallDocument } from '../lib/calls/callDocument';
import { translatorFromEnv } from '../lib/calls/translate';
import { validateManualCall, type ManualCallInput } from '../lib/calls/manual';
import { embedderFromEnv } from '../lib/calls/embeddings';
import { createCallPassageStore } from '../lib/calls/passageStore';
import { createProjectChat } from '../lib/calls/projectChat';
import type { GraphIdentifier, GraphIdentifierType } from '../lib/graph/identifierActions';

/** The parts of an Express request / response used here (no dependency on the Express typings). */
interface NodeRequest {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  session?: { user?: { preferred_username?: string; access?: { allSlugs?: boolean; labAnchors?: string[] } } };
  /** Machine client authenticated by a service token (server.cjs, scripts/lib/service_tokens.cjs). */
  service?: { name: string };
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
  /** Storage of the directory and of the work tables (DRUID_STORAGE, lot 6 f): Grist by default. */
  storage?: StorageKind;
  /** PostgreSQL of the instance (DRUID_DATABASE_URL, role druid_app), with storage = postgres. */
  databaseUrl?: string;
  /** Identifier removals sent to the CRISalid graph (DRUID_GRAPH_ACTIONS, lot 11 d): `on` makes the people.csv export
   * send the removals still to send first. */
  graphActions?: GraphActionsMode;
  graphAcceptedTypes?: GraphIdentifierType[];
  /** CRISalid bus (DRUID_AMQP_URL, DRUID_GRAPH_EXCHANGE). */
  amqpUrl?: string;
  graphExchange?: string;
}

// Storage of the Node jobs (lot 3): taken from this bundle by scripts/lib/storage.cjs.
export {
  gristClientFromEnv, jobStorageFromEnv, jobContext, tablesFromEnv, storageKindFromEnv, closeDatabases,
} from '../lib/directory/jobStorage';
export { acceptedTypesFromEnv, graphActionsModeFromEnv } from '../lib/graph/publisher';

/**
 * Session access (server.cjs parseDruidAccess) → scope; null without an authenticated user. A service token reads the
 * institution-wide directory: server.cjs only lets it reach a few read routes (SERVICE_READ_ROUTES).
 */
export const scopeOfSession = (req: Pick<NodeRequest, 'session' | 'service'>): DirectoryScope | null => {
  if (req.service?.name) return { all: true, labAnchors: [] };
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
const manualCallsOf = (db: Parameters<typeof createManualCallsStore>[0]) => {
  const llm = translatorFromEnv(process.env);
  return {
    ...createManualCallsStore(db),
    readUrl: (url: string) => fetchCallDocument(url),
    readPdf: (data: Uint8Array) => pdfDocument(data),
    /** A page saved by the person (a website the server cannot reach, such as an intranet) or a pasted text. */
    readHtml: (html: string) => htmlDocument(html),
    readText: (text: string) => textDocument(text),
    /** Whether the language model of the instance is configured (ILAAS_API_KEY). */
    canExtract: !!llm,
    extract: (doc: CallDocument) => (llm ? extractCallFields(doc, llm) : Promise.resolve(null)),
    validate: (input: ManualCallInput) => validateManualCall(input, new Date().toISOString().slice(0, 10)),
  };
};

const projectChatOf = (db: Parameters<typeof createCallPassageStore>[0]) => {
  const llm = translatorFromEnv(process.env);
  const embedder = embedderFromEnv(process.env);
  return llm && embedder ? createProjectChat({ store: createCallPassageStore(db), embedder, llm }) : null;
};

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
  const kind: StorageKind = options.storage ?? 'grist';
  if (kind === 'postgres' && !options.databaseUrl) throw new Error('DRUID_STORAGE=postgres needs DRUID_DATABASE_URL');
  // Publications: news items in PostgreSQL on an instance on PostgreSQL (lot 14 a), in the Grist document otherwise;
  // axis corrections in the Grist document of the structure in both cases (until lot 10).
  const gristPublications = createGristPublicationsStore({ main, readerFor });
  const ldapStatus = jsonFileLoader<Record<string, any>>(options.appRoot, 'ldap_status_cache.json', {});
  const ldapCandidates = jsonFileLoader<any>(options.appRoot, 'ldap_candidates_cache.json', { proposals: [], ambiguous: [] });
  const ldapStructures = jsonFileLoader<Record<string, any>>(options.appRoot, 'structures_ldap_cache.json', {});
  const ldapSource = { status: ldapStatus, candidates: async () => (await ldapCandidates()).data, structures: async () => (await ldapStructures()).data };
  // Alignment caches written by the scripts at the app root (idref_align_cache.json…), re-read when they change.
  const alignLoaders = new Map<string, () => Promise<{ data: Record<string, any> | null; version: string }>>();
  const caches = {
    read: async (name: string) => {
      if (!alignLoaders.has(name)) alignLoaders.set(name, jsonFileLoader<Record<string, any> | null>(options.appRoot, `${name}.json`, null));
      return (await alignLoaders.get(name)!()).data;
    },
  };
  const hasQualinka = !!options.hasQualinka;

  if (kind === 'postgres') {
    const db = createDb({ connectionString: options.databaseUrl!, max: 8 });
    // Same assembly as the Cloudflare Functions (lib/directory/pg/storage.ts, lot 10 a).
    const { repository, commands, publications, tables, align } = createPgStorage({
      db, loadLdapCache: ldapStatus, gristPublications, tablesActor: 'server',
      align: { caches, texts: tokenAlignTexts, hasQualinka },
    });
    return {
      kind, grist: main, publications, repository, commands, tables,
      ldap: options.hasLdap ? createPgLdapCommands({ db, repository, ldap: ldapSource }) : undefined,
      align: align!,
      /** Ports of the work routes (tasks, arbitrations, peer lists, reports), writes audited under `actor`. */
      workPorts: (actor: string) => createPgWorkPorts({ db, actor }),
      /** Removals sent before the people.csv export and state update after it, while the graph publisher is on (lot 11 d). */
      graph: options.graphActions === 'on' ? {
        prepareGraphForPeopleCsv: () => prepareGraphForPeopleCsv({
          db, accepted: options.graphAcceptedTypes,
          openBus: async () => {
            if (!options.amqpUrl) throw new Error('DRUID_AMQP_URL is not set');
            return connectGraphBus(options.amqpUrl, options.graphExchange || 'graph');
          },
        }),
        recordPeopleCsvExport: (uids: string[], identifiers: GraphIdentifier[]) => recordPeopleCsvExport(db, uids, identifiers),
      } : null,
      /** Follow-up of the removals sent to the graph (Administration, lot 11 e), from `dry-run` on. */
      graphOverview: options.graphActions && options.graphActions !== 'off'
        ? () => graphActionsOverview(db, options.graphAcceptedTypes) : null,
      graphMode: options.graphActions || 'off',
      /** « Calls for proposals » tab: calls of the funding programmes matched to the researchers (druid-internal
       * docs/plan-funding-calls.md, lot 1), PostgreSQL only. */
      calls: createCallsStore(db),
      /** Opinions on the suggested connections between researchers (`docs/plan-binomes-chercheurs.md` lot 4), PostgreSQL only. */
      pairFeedback: createPairFeedbackStore(db),
      /** Doctoral theses of the researchers, read from theses.fr (scripts/sync_theses.ts, plan-funding-calls lot 5). */
      theses: createThesisStore(db),
      /** Candidates of the calls reserved by career stage (lib/calls/eligibility.ts), institution right only. */
      eligibility: createEligibilityStore(db),
      /** Calls added by hand (plan-funding-calls lot 6): store, reading of a URL or a PDF, fields proposed by ILaaS. */
      manualCalls: manualCallsOf(db),
      /** « My project » assistant (plan-funding-calls lot 7): null without an embedding service or a language model. */
      projectChat: projectChatOf(db),
    };
  }
  const repository = createGristDirectoryRepository({ grist: main, loadLdapCache: ldapStatus });
  const commands = createGristDirectoryCommands({ grist: main, repository });
  return {
    kind, grist: main, publications: gristPublications, repository, commands, tables: main,
    ldap: options.hasLdap ? createGristLdapCommands({ grist: main, repository, annuaireColumns: commands.annuaireColumns, ldap: ldapSource }) : undefined,
    align: createGristAlignCommands({ grist: main, repository, annuaireColumns: commands.annuaireColumns, texts: tokenAlignTexts, hasQualinka, caches }),
    workPorts: null,
    graph: null,
    graphOverview: null,
    graphMode: 'off' as GraphActionsMode,
    calls: null,
    pairFeedback: null,
    theses: null,
    eligibility: null,
    manualCalls: null,
    projectChat: null,
  };
};
export type ServerStorage = ReturnType<typeof createServerStorage>;

/** Express handler of `/api/v1/*`. */
export const createApiV1Handler = (storage: ServerStorage) => {
  const api = createDirectoryApi();
  return async (req: NodeRequest, res: NodeResponse): Promise<void> => {
    const response = await api.fetch(toWebRequest(req), {
      ...storage, scope: scopeOfSession(req),
      actor: req.service?.name ? `service:${req.service.name}` : req.session?.user?.preferred_username, writeRefusal: null,
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
