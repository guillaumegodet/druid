// Storage-agnostic access to the directory (druid-internal docs/plan-migration-postgresql.md, lot 1).
//
// The domain API (lib/directory/api.ts) only knows the `DirectoryRepository` interface. The first
// implementation reads Grist (`createGristDirectoryRepository`); the PostgreSQL one (lot 6) will implement
// the same interface and be checked against the same contract tests.
import type { Researcher, Structure } from '../../types';
import { normalizeAcronym } from '../normalize';
import { MERGE_LOG_TABLE } from '../mergeLog';
import { computeDuplicateGroups, DuplicatesDiff } from './duplicates';
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
  /** Labs (LABO) of the directory rows carrying this uid, within the scope — duplicate warning of the creation form. */
  labsOfUid(uid: string, scope: DirectoryScope): Promise<string[]>;
  /** Duplicate groups (rows sharing a uid_dyna) among the rows of the scope — « Doublons » page (lot 2 c). */
  duplicates(scope: DirectoryScope): Promise<DuplicatesDiff>;
  /** Raw Annuaire rows (Grist values) of the scope, read fresh — merge assistant (lot 2 c). */
  recordRows(ids: number[], scope: DirectoryScope): Promise<{ rowId: number; fields: Record<string, any> }[]>;
  /** Forgets the cached reads (called by the commands after a write). */
  invalidate(): void;
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

/** Grist REST client with the write operations used by the domain API commands (lib/directory/commands.ts). */
export interface GristClient extends GristReader {
  /** Columns of a table: id + Grist fields (label, type, isFormula…). */
  columns(table: string): Promise<{ id: string; fields: Record<string, any> }[]>;
  addColumns(table: string, columns: { id: string; fields: Record<string, any> }[]): Promise<void>;
  /** Changes column settings (label, type, choices…). */
  updateColumns(table: string, columns: { id: string; fields: Record<string, any> }[]): Promise<void>;
  addTables(tables: { id: string; columns: { id: string; fields: Record<string, any> }[] }[]): Promise<void>;
  /** Creates rows, returns their ids. */
  addRecords(table: string, records: { fields: Record<string, any> }[]): Promise<number[]>;
  updateRecords(table: string, records: { id: number; fields: Record<string, any> }[]): Promise<void>;
  deleteRecords(table: string, ids: number[]): Promise<void>;
  /** Read-only SQL (Grist /sql endpoint, parameterized). */
  sql(query: string, args: unknown[]): Promise<Record<string, any>[]>;
}

export interface GristReaderOptions {
  apiBase: string;
  docId: string;
  /** Absent on a read-only instance reading a public document. */
  apiKey?: string;
  userAgent?: string;
  fetch?: typeof fetch;
}

export const createGristReader = ({ apiBase, docId, apiKey, userAgent, fetch: fetchImpl }: GristReaderOptions): GristClient => {
  const doFetch = fetchImpl ?? fetch;
  const docUrl = `${apiBase.replace(/\/+$/, '')}/docs/${encodeURIComponent(docId)}`;
  const call = async (url: string, method = 'GET', body?: unknown): Promise<any> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (userAgent) headers['User-Agent'] = userAgent;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const resp = await doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 300);
      throw new Error(`Grist HTTP ${resp.status} on ${method} ${url.slice(docUrl.length) || '/'}${detail ? `: ${detail}` : ''}`);
    }
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  };
  const get = (url: string) => call(url);
  const tableUrl = (table: string) => `${docUrl}/tables/${encodeURIComponent(table)}`;
  return {
    docUpdatedAt: async () => String((await get(docUrl))?.updatedAt || ''),
    records: async (table, filter) => {
      const query = filter ? `?filter=${encodeURIComponent(JSON.stringify(filter))}` : '';
      return (await get(`${docUrl}/tables/${encodeURIComponent(table)}/records${query}`))?.records ?? [];
    },
    tableIds: async () => ((await get(`${docUrl}/tables`))?.tables ?? []).map((t: { id: string }) => t.id),
    columns: async (table) => (await get(`${tableUrl(table)}/columns`))?.columns ?? [],
    addColumns: async (table, columns) => { await call(`${tableUrl(table)}/columns`, 'POST', { columns }); },
    updateColumns: async (table, columns) => { await call(`${tableUrl(table)}/columns`, 'PATCH', { columns }); },
    addTables: async (tables) => { await call(`${docUrl}/tables`, 'POST', { tables }); },
    addRecords: async (table, records) =>
      ((await call(`${tableUrl(table)}/records`, 'POST', { records }))?.records ?? []).map((r: { id: number }) => r.id),
    updateRecords: async (table, records) => { await call(`${tableUrl(table)}/records`, 'PATCH', { records }); },
    deleteRecords: async (table, ids) => { await call(`${tableUrl(table)}/data/delete`, 'POST', ids); },
    sql: async (query, args) => ((await call(`${docUrl}/sql`, 'POST', { sql: query, args }))?.records ?? [])
      .map((r: { fields: Record<string, any> }) => r.fields),
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
    async labsOfUid(uid, scope) {
      const rows = await grist.records('Annuaire', { uid_dyna: [uid] });
      const kept = scope.all ? rows : rows.filter(rowInScope(new Set(scope.labAnchors)));
      return kept.map((r) => String(r.fields?.LABO || '—'));
    },
    async duplicates(scope) {
      const updatedAt = await grist.docUpdatedAt();
      const annuaire = await rowsOf('Annuaire', updatedAt);
      const records = scope.all ? annuaire : annuaire.filter(rowInScope(new Set(scope.labAnchors)));
      const { doublonsUid, duplicatesByKind } = computeDuplicateGroups(records);
      return {
        generatedAt: new Date().toISOString(),
        stats: { gristTotal: records.length, pending: doublonsUid.filter((d) => !d.qualified).length, qualified: doublonsUid.filter((d) => d.qualified).length, parKind: duplicatesByKind },
        doublonsUid,
      };
    },
    async recordRows(ids, scope) {
      if (ids.length === 0) return [];
      const rows = await grist.records('Annuaire', { id: ids });
      const kept = scope.all ? rows : rows.filter(rowInScope(new Set(scope.labAnchors)));
      return kept.map((r) => ({ rowId: r.id, fields: r.fields }));
    },
    invalidate() {
      tables.clear();
      allPeople = null;
      structuresCache = null;
    },
    async abesExports(scope) {
      const updatedAt = await grist.docUpdatedAt();
      const annuaire = await rowsOf('Annuaire', updatedAt);
      const rows = scope.all ? annuaire : annuaire.filter(rowInScope(new Set(scope.labAnchors)));
      return { items: mapAbesExportMarks(rows), updatedAt };
    },
  };
};
