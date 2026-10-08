// The work tables on PostgreSQL (druid-internal docs/plan-migration-postgresql.md, lot 6 e): the ports of
// scripts/lib/work_services.cjs (tasks, import arbitrations, Benchmark peer lists) and the storage client of the
// reports (scripts/lib/reports_store.cjs), over task / task_event, import_batch / import_row, benchmark_peer_group and
// report / report_share / report_generation. The rules stay in those shared modules: each port presents the rows as
// the Grist tables they were imported from (columns of Taches, Arbitrage_*, Rapports…) and writes their changes back
// — the Grist twin is scripts/lib/work_grist.cjs, checked against this one by pgWork.integration.test.ts.
//
// Differences by design: a write is one transaction (the arbitration of a conflict writes the record and marks the
// row resolved together); a task or an arbitration names its record through its membership, and through the person
// when that membership is gone (merged), where Grist kept a reference to a deleted row.
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import type { Db } from '../../db/client';
import type { CommandContext } from '../../directory/commands';
import { RECORD_FIELDS } from '../../directory/pg/commands';
import { pgWriting, writeRecordPatches } from '../../directory/pg/alignCommands';
import { readRecords } from '../../directory/pg/recordFields';

type Row = { id: number; fields: Record<string, any> };
type Conn = Db | Transaction<DB>;

export interface PgWorkPortsOptions {
  db: Db;
  /** Author of the writes in the audit log (Keycloak / Access user, or the name of a job). */
  actor?: string;
  /** Clock of the dates the ports write themselves (peer lists); tests. */
  now?: () => Date;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v ? String(v) : '');
const ts = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
};
const txt = (v: unknown): string | null => (v === null || v === undefined || String(v) === '' ? null : String(v));
const jsonText = (v: unknown): string => (v === null || v === undefined ? '' : JSON.stringify(v));
const parsed = (v: unknown): unknown => {
  if (v === null || v === undefined || v === '') return null;
  try { return JSON.parse(String(v)); } catch { return null; }
};
/** Grist filter of a read ({ column: [values] }, `id` included), applied to the rows presented. */
const filtered = (rows: Row[], filter?: Record<string, unknown[]>) => (!filter ? rows
  : rows.filter((r) => Object.entries(filter).every(([col, values]) => values.includes(col === 'id' ? r.id : r.fields[col]))));

/** A column of a Grist table and where it lives: a column of the row, or a value kind. */
type Kind = 'text' | 'ts' | 'bool' | 'int' | 'json';
type Mapping = [grist: string, column: string, kind: Kind][];

const fieldsOf = (row: Record<string, any>, mapping: Mapping): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [g, c, kind] of mapping) {
    const v = row[c];
    out[g] = kind === 'ts' ? iso(v) : kind === 'bool' ? !!v : kind === 'int' ? (v === null || v === undefined ? null : Number(v))
      : kind === 'json' ? jsonText(v) : v ?? '';
  }
  // A value the import could not read stays in `extra` under its column, as Grist showed it.
  return { ...out, ...(row.extra || {}) };
};
/** Grist fields → columns of the row; the others go to `extra`. Written columns leave `extra`. */
const columnsOf = (fields: Record<string, any>, mapping: Mapping) => {
  const values: Record<string, any> = {};
  const extra: Record<string, any> = {};
  const written: string[] = [];
  for (const [g, v] of Object.entries(fields)) {
    const m = mapping.find(([name]) => name === g);
    if (!m) { extra[g] = v; continue; }
    const [, c, kind] = m;
    values[c] = kind === 'ts' ? ts(v) : kind === 'bool' ? v === true : kind === 'int' ? (v === null || v === '' || v === undefined ? null : Number(v))
      : kind === 'json' ? JSON.stringify(parsed(v)) : txt(v);
    written.push(g);
  }
  return { values, extra, written };
};
/** Update of `extra`: the columns written leave it, the unknown fields are merged in. */
const extraUpdate = (extra: Record<string, any>, written: string[]) =>
  sql`(extra - ${sql.val(written)}::text[]) || ${JSON.stringify(extra)}::jsonb`;

/** Record (Annuaire row id) of a row naming a membership and a person: the membership, else the person's first. */
const recordOf = async (conn: Conn, rows: { membership_id: string | null; person_id: string | null }[]) => {
  const persons = [...new Set(rows.filter((r) => !r.membership_id && r.person_id).map((r) => r.person_id!))];
  const first = new Map<string, number>();
  if (persons.length) {
    for (const m of await conn.selectFrom('membership').select(['person_id', sql<string>`min(id)`.as('id')])
      .where('person_id', 'in', persons).groupBy('person_id').execute()) first.set(m.person_id, Number(m.id));
  }
  return (r: { membership_id: string | null; person_id: string | null }) => (r.membership_id ? Number(r.membership_id) : r.person_id ? first.get(r.person_id) ?? 0 : 0);
};
/** Membership and person of a record (Annuaire row id); 0 / unknown → none. */
const membershipRef = async (conn: Conn, recordId: unknown) => {
  const id = Number(recordId);
  if (!Number.isInteger(id) || id <= 0) return { membership_id: null, person_id: null };
  const m = await conn.selectFrom('membership').select(['id', 'person_id']).where('id', '=', String(id)).executeTakeFirst();
  return m ? { membership_id: m.id, person_id: m.person_id } : { membership_id: null, person_id: null };
};

// ── Tasks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const TASK: Mapping = [
  ['cle', 'key', 'text'], ['type', 'type', 'text'], ['base', 'base', 'text'], ['canal', 'channel', 'text'], ['titre', 'title', 'text'],
  ['description', 'description', 'text'], ['uid_dyna', 'uid', 'text'], ['nom', 'person_name', 'text'], ['labo', 'lab', 'text'],
  ['lien', 'link', 'text'], ['statut', 'status', 'text'], ['assignee', 'assignee', 'text'], ['priorite', 'priority', 'text'],
  ['origine', 'origin', 'text'], ['cree_par', 'created_by', 'text'], ['cree_le', 'created_at', 'ts'], ['pris_par', 'taken_by', 'text'],
  ['pris_le', 'taken_at', 'ts'], ['attente_motif', 'waiting_reason', 'text'], ['fait_par', 'done_by', 'text'], ['fait_le', 'done_at', 'ts'],
  ['resolution', 'resolution', 'text'], ['verifie_le', 'verified_at', 'ts'],
];
const EVENT: Mapping = [['date', 'at', 'ts'], ['auteur', 'author', 'text'], ['action', 'action', 'text'], ['detail', 'detail', 'text']];
/** Columns that cannot be null: a value the store does not set keeps the column default. */
const TASK_DEFAULTS: Record<string, string> = { status: 'a_faire', priority: 'normale', type: '', title: '' };

// ── Reports ────────────────────────────────────────────────────────────────────────────────────────────────────────
const REPORT: Mapping = [
  ['owner', 'owner', 'text'], ['name', 'name', 'text'], ['description', 'description', 'text'], ['template_id', 'template_id', 'text'],
  ['definition', 'definition', 'json'], ['visibility', 'visibility', 'text'], ['created_at', 'created_at', 'ts'], ['updated_at', 'updated_at', 'ts'],
  ['deleted_at', 'deleted_at', 'ts'], ['published_template', 'published_template', 'bool'],
];
const SHARE: Mapping = [['report', 'report_id', 'int'], ['grantee', 'grantee', 'text'], ['role', 'role', 'text'], ['granted_by', 'granted_by', 'text'], ['granted_at', 'granted_at', 'ts']];
const GENERATION: Mapping = [
  ['report', 'report_id', 'int'], ['generated_at', 'generated_at', 'ts'], ['generated_by', 'generated_by', 'text'],
  ['definition_snapshot', 'definition_snapshot', 'json'], ['publication_count', 'publication_count', 'int'], ['data_date', 'data_date', 'text'],
  ['ai_texts', 'ai_texts', 'json'], ['pdf_ref', 'pdf_ref', 'text'], ['shared_frozen', 'shared_frozen', 'bool'],
];
const REPORT_TABLES: Record<string, { table: 'report' | 'report_share' | 'report_generation'; mapping: Mapping; hasExtra: boolean }> = {
  Rapports: { table: 'report', mapping: REPORT, hasExtra: true },
  Rapports_partages: { table: 'report_share', mapping: SHARE, hasExtra: false },
  Rapports_generations: { table: 'report_generation', mapping: GENERATION, hasExtra: true },
};

// ── Import arbitrations ────────────────────────────────────────────────────────────────────────────────────────────
const ARBITRATION: Mapping = [
  ['Personne', 'person_label', 'text'], ['Labo', 'lab', 'text'], ['Famille', 'family', 'text'], ['Champ', 'field', 'text'],
  ['Valeur_actuelle', 'current_value', 'text'], ['Valeur_importee', 'imported_value', 'text'], ['Valeur_importee_json', 'imported_json', 'json'],
  ['Remarque', 'remark', 'text'], ['Choix', 'choice', 'text'], ['Valeur_autre', 'other_value', 'text'], ['Resolu_le', 'resolved_at', 'ts'],
  ['Resolu_par', 'resolved_by', 'text'],
];
/** Name of the Grist table of a batch: the imported one, else `Arbitrage_<source>[_YYYY_MM]`. */
const batchTable = (b: { legacy_table: string | null; source: string; label: string | null }) =>
  b.legacy_table || `Arbitrage_${b.source}${b.label ? `_${b.label.replace(/-/g, '_')}` : ''}`;

export const createPgWorkPorts = ({ db, actor = '', now = () => new Date() }: PgWorkPortsOptions) => {
  const ctx = { actor, scope: { all: true, labAnchors: [] }, audit: () => {} } as CommandContext;
  const writing = <T>(fn: (trx: Transaction<DB>) => Promise<T>) => pgWriting(db, ctx, fn, () => {});

  const tasks = {
    /** The tables exist (migrations). */
    ensure: async () => [],
    async tasks(): Promise<Row[]> {
      const rows = await db.selectFrom('task').selectAll().orderBy('id').execute();
      const record = await recordOf(db, rows);
      return rows.map((t) => ({ id: Number(t.id), fields: { ...fieldsOf(t, TASK), chercheur: record(t) || (t.extra as any)?.chercheur || 0 } }));
    },
    async tasksOfUid(uid: string) {
      return (await db.selectFrom('task').select(['id', 'key', 'type', 'status']).where('uid', '=', uid).orderBy('id').execute())
        .map((t) => ({ id: Number(t.id), cle: t.key ?? '', type: t.type, statut: t.status }));
    },
    /** Events of a task; every event without a task id (the jobs' table view). */
    async events(taskId?: number): Promise<Row[]> {
      let q = db.selectFrom('task_event').selectAll().orderBy('id');
      if (taskId !== undefined) q = q.where('task_id', '=', String(taskId));
      const rows = await q.execute();
      return rows.map((e) => ({ id: Number(e.id), fields: { tache: Number(e.task_id), ...fieldsOf(e, EVENT) } }));
    },
    addTasks: (rows: Record<string, any>[]) => writing(async (trx) => {
      const ids: number[] = [];
      for (const fields of rows) {
        const { chercheur, ...rest } = fields;
        const { values, extra } = columnsOf(rest, TASK);
        for (const [c, d] of Object.entries(TASK_DEFAULTS)) values[c] ??= d;
        const { id } = await trx.insertInto('task').values({ ...values, ...(await membershipRef(trx, chercheur)), extra: JSON.stringify(extra) } as any)
          .returning('id').executeTakeFirstOrThrow();
        ids.push(Number(id));
      }
      return ids;
    }),
    updateTasks: (rows: Row[]) => writing(async (trx) => {
      for (const { id, fields } of rows) {
        const { chercheur, ...rest } = fields;
        const { values, extra, written } = columnsOf(rest, TASK);
        for (const [c, d] of Object.entries(TASK_DEFAULTS)) if (c in values && values[c] === null) values[c] = d;
        const ref = 'chercheur' in fields ? await membershipRef(trx, chercheur) : {};
        await trx.updateTable('task').set({ ...values, ...ref, extra: extraUpdate(extra, [...written, ...('chercheur' in fields ? ['chercheur'] : [])]) } as any)
          .where('id', '=', String(id)).execute();
      }
    }),
    addEvents: (rows: Record<string, any>[]) => writing(async (trx) => {
      const ids: number[] = [];
      for (const { tache, ...rest } of rows) {
        const { values, extra } = columnsOf(rest, EVENT);
        const { id } = await trx.insertInto('task_event').values({ ...values, action: values.action ?? '', task_id: String(tache), extra: JSON.stringify(extra) } as any)
          .returning('id').executeTakeFirstOrThrow();
        ids.push(Number(id));
      }
      return ids;
    }),
  };

  const conflicts = {
    tables: async (): Promise<string[]> =>
      (await db.selectFrom('import_batch').select(['legacy_table', 'source', 'label']).orderBy('id').execute()).map(batchTable),
    async rows(table: string): Promise<Row[]> {
      const batch = (await db.selectFrom('import_batch').selectAll().orderBy('id').execute()).find((b) => batchTable(b) === table);
      if (!batch) return [];
      const rows = await db.selectFrom('import_row').selectAll().where('batch_id', '=', batch.id).orderBy('id').execute();
      const record = await recordOf(db, rows);
      return rows.map((r) => ({ id: Number(r.id), fields: { ...fieldsOf(r, ARBITRATION), Fiche: record(r) || (r.extra as any)?.Fiche || 0 } }));
    },
    /** Types of the record fields (RECORD_FIELDS) and the labels of the employers (Ref:Etablissements). */
    async annuaireMeta() {
      const colTypes = new Map(RECORD_FIELDS.map((c) => [c.id, c.type]));
      const employers = await db.selectFrom('establishment').select(['id', 'name']).orderBy('id').execute();
      const refLabels = new Map([['Employeur', new Map(employers.map((e) => [Number(e.id), e.name ?? '']))]]);
      const refIds = new Map([['Employeur', new Map(employers.map((e) => [String(e.name ?? '').toUpperCase(), Number(e.id)]))]]);
      return { colTypes, refLabels, refIds };
    },
    async annuaireRecords(ids: number[]): Promise<Map<number, Record<string, any>>> {
      const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
      if (!wanted.length) return new Map();
      const memberships = await db.selectFrom('membership').selectAll().where('id', 'in', wanted.map(String)).orderBy('id').execute();
      return new Map((await readRecords(db, memberships)).map((r) => [r.id, r.fields]));
    },
    /** The record cells and the rows marked resolved, in one transaction. */
    resolve: (table: string, annuairePatches: Row[], rowPatches: Row[]) => writing(async (trx) => {
      await writeRecordPatches(trx, annuairePatches);
      const batch = (await trx.selectFrom('import_batch').selectAll().execute()).find((b) => batchTable(b) === table);
      for (const { id, fields } of rowPatches) {
        const { values, extra, written } = columnsOf(fields, ARBITRATION);
        await trx.updateTable('import_row').set({ ...values, extra: extraUpdate(extra, written) } as any)
          .where('id', '=', String(id)).where('batch_id', '=', batch?.id ?? '0').execute();
      }
    }),
  };

  const peerGroups = {
    async list(owner: string) {
      return (await db.selectFrom('benchmark_peer_group').selectAll().where('owner', '=', owner).execute())
        .map((g) => ({ id: Number(g.id), name: g.name, rors: g.rors, updatedAt: g.updated_at ? iso(g.updated_at) : null }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    },
    /** Saving again under a name already used by the same user updates that list. */
    save: (owner: string, name: string, rors: string[]) => writing(async (trx) => {
      const updated_at = now().toISOString();
      const existing = await trx.selectFrom('benchmark_peer_group').select('id').where('owner', '=', owner).where('name', '=', name).executeTakeFirst();
      if (existing) {
        await trx.updateTable('benchmark_peer_group').set({ rors, updated_at }).where('id', '=', existing.id).execute();
        return Number(existing.id);
      }
      const { id } = await trx.insertInto('benchmark_peer_group').values({ owner, name, rors, updated_at }).returning('id').executeTakeFirstOrThrow();
      return Number(id);
    }),
    remove: (owner: string, id: number) => writing(async (trx) =>
      Number((await trx.deleteFrom('benchmark_peer_group').where('id', '=', String(id)).where('owner', '=', owner).executeTakeFirst()).numDeletedRows) > 0),
  };

  /** Storage client of reports_store.cjs (its tables always exist: nothing to create). */
  const reportTable = (name: string) => {
    const t = REPORT_TABLES[name];
    if (!t) throw new Error(`Not a report table: ${name}`);
    return t;
  };
  const reports = {
    key: 'postgres',
    tables: async () => Object.keys(REPORT_TABLES).map((id) => ({ id })),
    createTables: async () => {},
    columns: async (name: string) => reportTable(name).mapping.map(([id]) => ({ id })),
    addColumns: async () => {},
    async records(name: string, filter?: Record<string, unknown[]>): Promise<Row[]> {
      const { table, mapping } = reportTable(name);
      const rows = await db.selectFrom(table).selectAll().orderBy('id').execute();
      return filtered(rows.map((r) => ({ id: Number(r.id), fields: fieldsOf(r, mapping) })), filter);
    },
    add: (name: string, rows: Record<string, any>[]) => writing(async (trx) => {
      const { table, mapping, hasExtra } = reportTable(name);
      const ids: number[] = [];
      for (const fields of rows) {
        const { values, extra } = columnsOf(fields, mapping);
        if (table === 'report') values.definition ??= '{}';
        const { id } = await trx.insertInto(table).values({ ...values, ...(hasExtra ? { extra: JSON.stringify(extra) } : {}) } as any)
          .returning('id').executeTakeFirstOrThrow();
        ids.push(Number(id));
      }
      return ids;
    }),
    update: (name: string, rows: Row[]) => writing(async (trx) => {
      const { table, mapping, hasExtra } = reportTable(name);
      for (const { id, fields } of rows) {
        const { values, extra, written } = columnsOf(fields, mapping);
        await trx.updateTable(table).set({ ...values, ...(hasExtra ? { extra: extraUpdate(extra, written) } : {}) } as any)
          .where('id', '=', String(id)).execute();
      }
    }),
    remove: (name: string, ids: number[]) => writing(async (trx) => {
      if (ids.length) await trx.deleteFrom(reportTable(name).table).where('id', 'in', ids.map(String)).execute();
    }),
  };

  return { tasks, conflicts, peerGroups, reports };
};
export type PgWorkPorts = ReturnType<typeof createPgWorkPorts>;
