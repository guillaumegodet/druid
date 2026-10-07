// Storage-agnostic access to the directory (druid-internal docs/plan-migration-postgresql.md, lot 1).
//
// The domain API (lib/directory/api.ts) only knows the `DirectoryRepository` interface. The first
// implementation reads Grist (`createGristDirectoryRepository`); the PostgreSQL one (lot 6) will implement
// the same interface and be checked against the same contract tests.
import type { Researcher, Structure } from '../../types';
import { normalizeAcronym } from '../normalize';
import { MERGE_LOG_TABLE } from '../mergeLog';
import {
  AbesExportMark, GristRecord, Institution, MergeLogEntry, mapAbesExportMarks, mapAnnuaireRecords, mapInstitutionRecords,
  mapMergeLogRecords, mapStructureRecords,
} from './gristMapping';

/**
 * What the caller may read. `all`: institution right (every lab). Otherwise `labAnchors` = the
 * normalized acronyms (lib/normalize.normalizeAcronym) of the labs the user is entitled to.
 */
export interface DirectoryScope {
  all: boolean;
  labAnchors: string[];
}

/** A list and the version of the data it was read from (Grist: document modification date). */
export interface Versioned<T> {
  items: T[];
  updatedAt: string;
}

export interface DirectoryRepository {
  /** Researchers; with a lab scope, only the directory rows of those labs (same rule as the former
   * /api/grist proxy filter: `LABO` column). */
  people(scope: DirectoryScope): Promise<Versioned<Researcher>>;
  /** Structures. Not scoped: they hold no personal data and the lab views need the whole tree. */
  structures(): Promise<Versioned<Structure>>;
  /** Employing institutions. */
  institutions(): Promise<Versioned<Institution>>;
  /** Merge log, most recent first (empty when the log table does not exist yet). Institution tool: not scoped. */
  merges(limit: number): Promise<Versioned<MergeLogEntry>>;
  /** Fingerprints of the records already exported to ABES, on the rows of the scope. */
  abesExports(scope: DirectoryScope): Promise<Versioned<AbesExportMark>>;
}

/** Minimal Grist REST client (the server holds the API key). */
export interface GristReader {
  /** Modification date of the document (ISO), '' when unknown. */
  docUpdatedAt(): Promise<string>;
  /** Rows of a table; `filter` = Grist filter (column → accepted values). */
  records(table: string, filter?: Record<string, unknown[]>): Promise<GristRecord[]>;
  /** Identifiers of the document's tables. */
  tableIds(): Promise<string[]>;
}

export interface GristReaderOptions {
  apiBase: string;
  docId: string;
  /** Absent on a read-only instance reading a public document. */
  apiKey?: string;
  userAgent?: string;
  fetch?: typeof fetch;
}

export const createGristReader = ({ apiBase, docId, apiKey, userAgent, fetch: fetchImpl }: GristReaderOptions): GristReader => {
  const doFetch = fetchImpl ?? fetch;
  const docUrl = `${apiBase.replace(/\/+$/, '')}/docs/${encodeURIComponent(docId)}`;
  const get = async (url: string): Promise<any> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (userAgent) headers['User-Agent'] = userAgent;
    const resp = await doFetch(url, { headers });
    if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} on ${url.slice(docUrl.length) || '/'}`);
    return resp.json();
  };
  return {
    docUpdatedAt: async () => String((await get(docUrl))?.updatedAt || ''),
    records: async (table, filter) => {
      const query = filter ? `?filter=${encodeURIComponent(JSON.stringify(filter))}` : '';
      return (await get(`${docUrl}/tables/${encodeURIComponent(table)}/records${query}`))?.records ?? [];
    },
    tableIds: async () => ((await get(`${docUrl}/tables`))?.tables ?? []).map((t: { id: string }) => t.id),
  };
};

/** LDAP status cache (ldap_status_cache.json, keyed by uid) and a version that changes with its content. */
export interface LdapCacheSnapshot {
  data: Record<string, any>;
  version: string;
}

export interface GristDirectoryRepositoryOptions {
  grist: GristReader;
  /** Instance without LDAP (Cloudflare): omitted → empty cache. */
  loadLdapCache?: () => Promise<LdapCacheSnapshot>;
}

/** Scope column of the directory rows: the lab of the row (`LABO`), compared on its normalized acronym. */
const rowInScope = (anchors: Set<string>) => (r: GristRecord): boolean =>
  anchors.has(normalizeAcronym(String(r.fields?.LABO || '')));

/**
 * Grist implementation. Each call reads the document's modification date (one light request) and
 * re-reads the tables only when it changed; the mapped institution-wide list is cached too (it also
 * depends on the LDAP cache version). Concurrent calls share the same in-flight reads.
 */
export const createGristDirectoryRepository = ({ grist, loadLdapCache }: GristDirectoryRepositoryOptions): DirectoryRepository => {
  const tables = new Map<string, { updatedAt: string; rows: Promise<GristRecord[]> }>();
  const rowsOf = (table: string, updatedAt: string): Promise<GristRecord[]> => {
    const hit = tables.get(table);
    if (hit && hit.updatedAt === updatedAt && updatedAt) return hit.rows;
    const rows = grist.records(table);
    tables.set(table, { updatedAt, rows });
    rows.catch(() => { if (tables.get(table)?.rows === rows) tables.delete(table); });
    return rows;
  };
  const ldap = async (): Promise<LdapCacheSnapshot> => (loadLdapCache ? loadLdapCache() : { data: {}, version: '' });
  let allPeople: { key: string; items: Researcher[] } | null = null;
  let structuresCache: { updatedAt: string; items: Structure[] } | null = null;

  return {
    async people(scope) {
      const updatedAt = await grist.docUpdatedAt();
      // The institutions only feed the employer label/UAI: an unreadable table leaves them empty, as before.
      const [annuaire, etablissements, ldapCache] = await Promise.all([
        rowsOf('Annuaire', updatedAt),
        rowsOf('Etablissements', updatedAt).catch(() => [] as GristRecord[]),
        ldap(),
      ]);
      if (scope.all) {
        const key = `${updatedAt}|${ldapCache.version}`;
        if (!allPeople || allPeople.key !== key || !updatedAt) {
          allPeople = { key, items: mapAnnuaireRecords(annuaire, etablissements, ldapCache.data) };
        }
        return { items: allPeople.items, updatedAt };
      }
      const rows = annuaire.filter(rowInScope(new Set(scope.labAnchors)));
      return { items: mapAnnuaireRecords(rows, etablissements, ldapCache.data), updatedAt };
    },
    async structures() {
      const updatedAt = await grist.docUpdatedAt();
      if (!structuresCache || structuresCache.updatedAt !== updatedAt || !updatedAt) {
        structuresCache = { updatedAt, items: mapStructureRecords(await rowsOf('Structures', updatedAt)) };
      }
      return { items: structuresCache.items, updatedAt };
    },
    async institutions() {
      const updatedAt = await grist.docUpdatedAt();
      return { items: mapInstitutionRecords(await rowsOf('Etablissements', updatedAt)), updatedAt };
    },
    // Read on every call, outside the table cache: the history must show a merge right after it is written
    // (even before the document date moves), and the log rows carry whole record snapshots (dropped_json…)
    // that the mapped entries do not need — nothing worth keeping in memory.
    async merges(limit) {
      const [updatedAt, tableIds, rows] = await Promise.all([
        grist.docUpdatedAt(),
        grist.tableIds(),
        grist.records(MERGE_LOG_TABLE).catch((err: unknown) => err as Error),
      ]);
      if (!tableIds.includes(MERGE_LOG_TABLE)) return { items: [], updatedAt };
      if (rows instanceof Error) throw rows;
      return { items: mapMergeLogRecords(rows, limit), updatedAt };
    },
    async abesExports(scope) {
      const updatedAt = await grist.docUpdatedAt();
      const annuaire = await rowsOf('Annuaire', updatedAt);
      const rows = scope.all ? annuaire : annuaire.filter(rowInScope(new Set(scope.labAnchors)));
      return { items: mapAbesExportMarks(rows), updatedAt };
    },
  };
};
