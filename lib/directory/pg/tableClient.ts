// The migrated tables seen as the Grist document they come from (druid-internal docs/plan-migration-postgresql.md,
// lot 6 f), for what still speaks in Grist tables: the sync jobs and scripts (scripts/lib/storage.cjs, align_common,
// sync_tasks…) and a few reads of server.cjs (record of a key, labs of the users). The domain itself (API, commands,
// LDAP, alignments, work routes) runs on its native PostgreSQL implementations; this client only puts them together:
//   Annuaire              record fields (recordFields.ts): read, cells written back (patches)
//   Etablissements        establishments, read
//   Structures            V2 fields (structures.ts): read, added, patched
//   Alignement_<source>   alignment reviews (review.ts): read, added, patched, deleted
//   Taches / Taches_evenements, Rapports*, Arbitrage_*, BenchmarkPeerGroups   work ports (lib/work/pg)
// Any other table, or a write these tables do not take, is refused (404 / 501) rather than lost; the schema is the
// migrations' own (adding tables or columns is a no-op). Every write is one transaction, audited under `actor`.
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import type { Db } from '../../db/client';
import { ApiError } from '../errors';
import type { GristClient } from '../repository';
import type { GristRecord } from '../gristMapping';
import type { CommandContext } from '../commands';
import type { UnifiedAlignSource } from '../alignments';
import { createPgWorkPorts } from '../../work/pg/workPorts';
import { RECORD_FIELDS } from './commands';
import { pgWriting, writeRecordPatches } from './alignCommands';
import { readRecords } from './recordFields';
import { readReviewRecords, writeReview } from './review';
import { insertStructure, patchStructure, readStructureRecords } from './structures';

const REVIEW_TABLES: Record<string, UnifiedAlignSource> = {
  Alignement_IdRef: 'idref', Alignement_ORCID: 'orcid', Alignement_HAL: 'hal', Alignement_OpenAlex: 'openalex', Alignement_Scopus: 'scopus',
};
const WORK_TABLES = ['Taches', 'Taches_evenements', 'Rapports', 'Rapports_partages', 'Rapports_generations', 'BenchmarkPeerGroups'];
const isArbitration = (t: string) => /^Arbitrage_[A-Za-z0-9_]+$/.test(t);

/** Rows of a Grist filter ({ column: [values] }, `id` included). */
const filtered = (rows: GristRecord[], filter?: Record<string, unknown[]>) => (!filter ? rows
  : rows.filter((r) => Object.entries(filter).every(([col, values]) => values.includes(col === 'id' ? r.id : r.fields[col]))));

/** Establishments as the Etablissements table (a value the import kept aside is shown again). */
export const establishmentRecords = async (db: any): Promise<GristRecord[]> =>
  (await db.selectFrom('establishment').select(['id', 'name', 'uai', 'ror', 'label', 'idref', 'extra']).orderBy('id').execute())
    .map((e: any) => ({ id: Number(e.id), fields: { Employeur: e.name, UAI: e.uai ?? '', ROR: e.ror ?? '', Libelle: e.label ?? '', idref: e.idref ?? '', commentaire: '', ...(e.extra || {}) } }));

/**
 * `SELECT <columns> FROM <table> [WHERE <column> = ? | id IN (?, …)]` — the read-only queries of server.cjs and of the
 * Grist commands, evaluated on the rows of the table. `*` = id and every field.
 */
const SQL_RE = /^\s*SELECT\s+(.+?)\s+FROM\s+"?(\w+)"?(?:\s+WHERE\s+"?(\w+)"?\s*(=|IN)\s*(\?|\(\s*\?(?:\s*,\s*\?)*\s*\)))?\s*;?\s*$/i;
export const parseGristSql = (query: string) => {
  const unsupported = () => new ApiError(501, `Query not supported on PostgreSQL: ${query.slice(0, 80)}`);
  const m = SQL_RE.exec(query);
  if (!m) throw unsupported();
  const columns = m[1] === '*' ? null : m[1].split(',').map((c) => {
    const [, col, alias] = /^\s*"?(\w+)"?(?:\s+AS\s+"?(\w+)"?)?\s*$/i.exec(c) || [];
    if (!col) throw unsupported();
    return { col, alias: alias || col };
  });
  return { columns, table: m[2], where: m[3] ? { col: m[3], op: m[4].toUpperCase() as '=' | 'IN' } : null };
};

export interface PgTableClientOptions {
  db: Db;
  /** Author of the writes in the audit log (a job's name, or the user). */
  actor?: string;
}

export const createPgTableClient = ({ db, actor = '' }: PgTableClientOptions): GristClient => {
  const ctx = { actor, scope: { all: true, labAnchors: [] }, audit: () => {} } as CommandContext;
  const writing = <T>(fn: (trx: Transaction<DB>) => Promise<T>) => pgWriting(db, ctx, fn, () => {});
  const work = createPgWorkPorts({ db, actor });

  /** Annuaire rows; a filter on id / uid_dyna only reads the memberships it names. */
  const annuaire = async (filter?: Record<string, unknown[]>) => {
    let q = db.selectFrom('membership as m').innerJoin('person as p', 'p.id', 'm.person_id').selectAll('m').orderBy('m.id');
    if (filter?.id) q = q.where('m.id', 'in', filter.id.map((v) => String(Number(v) || 0)));
    if (filter?.uid_dyna) {
      const uids = filter.uid_dyna.map((v) => String(v ?? ''));
      q = uids.includes('') ? q.where((eb) => eb.or([eb('p.uid', 'in', uids), eb('p.uid', 'is', null)])) : q.where('p.uid', 'in', uids);
    }
    return filtered(await readRecords(db, await q.execute()), filter);
  };
  const tableIds = async () => [
    'Annuaire', 'Etablissements', 'Structures', ...Object.keys(REVIEW_TABLES), ...WORK_TABLES, ...await work.conflicts.tables(),
  ];
  const notFound = (table: string) => new ApiError(404, `Table not found on PostgreSQL: ${table}`);
  const refused = (table: string, what: string) => new ApiError(501, `${what} not supported on PostgreSQL for ${table}`);

  const records = async (table: string, filter?: Record<string, unknown[]>): Promise<GristRecord[]> => {
    if (table === 'Annuaire') return annuaire(filter);
    if (table === 'Etablissements') return filtered(await establishmentRecords(db), filter);
    if (table === 'Structures') return filtered(await readStructureRecords(db), filter);
    if (REVIEW_TABLES[table]) return filtered(await readReviewRecords(db, REVIEW_TABLES[table]), filter);
    if (table === 'Taches') return filtered(await work.tasks.tasks(), filter);
    if (table === 'Taches_evenements') {
      const one = filter?.tache?.length === 1 ? Number(filter.tache[0]) : undefined;
      return filtered(await work.tasks.events(one), filter);
    }
    if (table.startsWith('Rapports')) return work.reports.records(table, filter);
    if (table === 'BenchmarkPeerGroups') {
      const rows = await db.selectFrom('benchmark_peer_group').selectAll().orderBy('id').execute();
      return filtered(rows.map((g) => ({ id: Number(g.id), fields: { owner: g.owner, name: g.name, rors: JSON.stringify(g.rors), updated_at: g.updated_at ? new Date(g.updated_at as any).toISOString() : '' } })), filter);
    }
    if (isArbitration(table) && (await work.conflicts.tables()).includes(table)) return filtered(await work.conflicts.rows(table), filter);
    throw notFound(table);
  };

  return {
    docUpdatedAt: async () => {
      const r = await sql<{ at: Date | null }>`SELECT max(at) AS at FROM audit_log`.execute(db);
      return r.rows[0]?.at ? new Date(r.rows[0].at).toISOString() : '';
    },
    tableIds,
    records,
    async columns(table) {
      if (table === 'Annuaire') return RECORD_FIELDS.map((c) => ({ id: c.id, fields: { label: c.label, type: c.type, isFormula: false } }));
      if (!(await tableIds()).includes(table)) throw notFound(table);
      if (table.startsWith('Rapports')) return (await work.reports.columns(table)).map((c) => ({ ...c, fields: {} }));
      // The columns of the other tables are those of their rows (the schema belongs to the migrations).
      const rows = await records(table);
      return [...new Set(rows.flatMap((r) => Object.keys(r.fields)))].map((id) => ({ id, fields: {} }));
    },
    addColumns: async () => {},
    updateColumns: async () => {},
    addTables: async () => {},

    async addRecords(table, rows) {
      const list = rows.map((r) => r.fields);
      if (REVIEW_TABLES[table]) return writing(async (trx) => (await writeReview(trx, REVIEW_TABLES[table], { toCreate: list, toPatch: [] })).created);
      if (table === 'Structures') return writing(async (trx) => { const ids: number[] = []; for (const f of list) ids.push(await insertStructure(trx, f)); return ids; });
      if (table === 'Taches') return work.tasks.addTasks(list);
      if (table === 'Taches_evenements') return work.tasks.addEvents(list);
      if (table.startsWith('Rapports')) return work.reports.add(table, list);
      throw refused(table, 'Adding rows');
    },

    async updateRecords(table, rows) {
      if (!rows.length) return;
      if (table === 'Annuaire') { await writing((trx) => writeRecordPatches(trx, rows)); return; }
      if (REVIEW_TABLES[table]) { await writing((trx) => writeReview(trx, REVIEW_TABLES[table], { toCreate: [], toPatch: rows })); return; }
      if (table === 'Structures') {
        await writing(async (trx) => {
          for (const r of rows) if (!(await patchStructure(trx, r.id, r.fields))) throw new ApiError(404, `Structure not found: S-${r.id}`);
        });
        return;
      }
      if (table === 'Taches') return work.tasks.updateTasks(rows);
      if (table.startsWith('Rapports')) return work.reports.update(table, rows);
      if (isArbitration(table)) return work.conflicts.resolve(table, [], rows);
      throw refused(table, 'Updating rows');
    },

    async deleteRecords(table, ids) {
      if (!ids.length) return;
      if (REVIEW_TABLES[table]) {
        await writing((trx) => trx.deleteFrom('alignment_candidate').where('source', '=', REVIEW_TABLES[table]).where('id', 'in', ids.map(String)).execute());
        return;
      }
      if (table === 'Rapports_partages') return work.reports.remove(table, ids);
      throw refused(table, 'Deleting rows');
    },

    async sql(query, args) {
      const { columns, table, where } = parseGristSql(query);
      const values = (args || []) as unknown[];
      const filter = !where ? undefined : { [where.col]: where.op === '=' ? [values[0]] : values };
      const rows = await records(table, filter);
      return rows.map((r) => {
        const row: Record<string, any> = { id: r.id, ...r.fields };
        return columns ? Object.fromEntries(columns.map(({ col, alias }) => [alias, row[col] ?? null])) : row;
      });
    },
  };
};
