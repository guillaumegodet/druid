// Grist → PostgreSQL import, loading part (druid-internal docs/plan-migration-postgresql.md, lot 5): writes the rows of
// gristToPg.ts in the transaction it is given, as the database owner (druid_owner). Replays from scratch: the imported
// tables are emptied first (and the tables that point to them, CASCADE), so a rehearsal can be run again and again
// until the switch-over. The `updated_at` / audit triggers are off for the bulk load (owner only); one audit_log row
// records the import instead.
import { sql, Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import type { DirectoryRows, MigrationReport } from './gristToPg';
import type { WorkRows } from './gristToPgWork';

/** Tables the directory import fills, in dependency order. */
export const DIRECTORY_TABLES = [
  'establishment', 'ref_corps_grade', 'structure', 'person', 'membership', 'membership_team', 'person_identifier',
  'person_identifier_check', 'person_link', 'sync_state',
] as const;

const CHUNK = 500;
const chunks = <T>(rows: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
};
/** Drops the `$…` reference keys of a transformed row. */
const plain = <T extends Record<string, any>>(row: T): Record<string, any> =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('$')));

/** jsonb columns: written as JSON text (a value that is itself a string or a list must not be taken for an array). */
const asJson = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const insertAll = async (trx: Transaction<DB>, table: keyof DB, rows: Record<string, any>[]) => {
  for (const part of chunks(rows)) await trx.insertInto(table as any).values(part as any).execute();
};
/** Inserts and returns legacy Grist id → new id. */
const insertMapped = async (trx: Transaction<DB>, table: 'establishment' | 'structure' | 'membership' | 'task' | 'report', rows: Record<string, any>[]) => {
  const ids = new Map<number, string>();
  for (const part of chunks(rows)) {
    const back = await trx.insertInto(table).values(part as any).returning(['id', 'legacy_grist_id']).execute();
    for (const r of back as { id: string; legacy_grist_id: number | null }[]) ids.set(r.legacy_grist_id!, r.id);
  }
  return ids;
};

export const loadDirectory = async (trx: Transaction<DB>, rows: DirectoryRows, report: MigrationReport): Promise<Record<string, number>> => {
  const tables = sql.join(DIRECTORY_TABLES.map((t) => sql.table(t)));
  await sql`TRUNCATE ${tables} RESTART IDENTITY CASCADE`.execute(trx);
  for (const t of DIRECTORY_TABLES) await sql`ALTER TABLE ${sql.table(t)} DISABLE TRIGGER USER`.execute(trx);

  const establishments = await insertMapped(trx, 'establishment', rows.establishment.map(plain));
  await insertAll(trx, 'ref_corps_grade', rows.ref_corps_grade.map(plain));
  const structures = await insertMapped(trx, 'structure', rows.structure.map(plain));
  for (const s of rows.structure.filter((x) => x.$parent !== null)) {
    await trx.updateTable('structure').set({ parent_id: structures.get(s.$parent!)! })
      .where('id', '=', structures.get(s.legacy_grist_id)!).execute();
  }
  await insertAll(trx, 'person', rows.person.map((p) => ({ ...plain(p), employer_id: p.$employer === null ? null : establishments.get(p.$employer) ?? null })));
  const memberships = await insertMapped(trx, 'membership', rows.membership.map((m) =>
    ({ ...plain(m), structure_id: m.$structure === null ? null : structures.get(m.$structure) ?? null })));
  await insertAll(trx, 'membership_team', rows.membership.flatMap((m) => m.$teams.map((t) =>
    ({ membership_id: memberships.get(m.legacy_grist_id)!, team_structure_id: structures.get(t)! }))));
  await insertAll(trx, 'person_identifier', rows.person_identifier);
  await insertAll(trx, 'person_identifier_check', rows.person_identifier_check);
  await insertAll(trx, 'person_link', rows.person_link);
  await insertAll(trx, 'sync_state', rows.sync_state);

  for (const t of DIRECTORY_TABLES) await sql`ALTER TABLE ${sql.table(t)} ENABLE TRIGGER USER`.execute(trx);
  await trx.insertInto('audit_log').values({
    table_name: '*', action: 'insert', actor: 'import:grist_to_pg',
    after: JSON.stringify({ source: report.source, counts: report.counts, summary: report.summary }),
  } as any).execute();

  const counts: Record<string, number> = {};
  for (const t of DIRECTORY_TABLES) {
    const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(trx);
    counts[t] = Number(r.rows[0].n);
  }
  return counts;
};

/** Tables the work import fills (lot 5 b), emptied first too. */
export const WORK_TABLES_PG = [
  'task', 'task_event', 'merge_log', 'alignment_candidate', 'import_batch', 'import_row', 'report', 'report_share',
  'report_generation', 'benchmark_peer_group',
] as const;

/** Work tables, after loadDirectory in the same transaction (the people they point to are already there). */
export const loadWork = async (trx: Transaction<DB>, rows: WorkRows): Promise<Record<string, number>> => {
  const tables = sql.join(WORK_TABLES_PG.map((t) => sql.table(t)));
  await sql`TRUNCATE ${tables} RESTART IDENTITY CASCADE`.execute(trx);
  for (const t of WORK_TABLES_PG) await sql`ALTER TABLE ${sql.table(t)} DISABLE TRIGGER USER`.execute(trx);

  const tasks = await insertMapped(trx, 'task', rows.task.map((t) => ({ ...plain(t), extra: asJson(t.extra) })));
  await insertAll(trx, 'task_event', rows.task_event.map((e) => ({ ...plain(e), extra: asJson(e.extra), task_id: tasks.get(e.$task)! })));
  await insertAll(trx, 'merge_log', rows.merge_log.map((m) => ({ ...plain(m), dropped_snapshot: asJson(m.dropped_snapshot),
    kept_before: asJson(m.kept_before), kept_patch: asJson(m.kept_patch), extra: asJson(m.extra) })));
  await insertAll(trx, 'alignment_candidate', rows.alignment_candidate.map((a) => ({ ...plain(a), payload: asJson(a.payload) })));
  const batches = new Map<string, string>();
  for (const b of rows.import_batch) {
    const { id } = await trx.insertInto('import_batch').values(b).returning('id').executeTakeFirstOrThrow();
    batches.set(b.legacy_table, id);
  }
  await insertAll(trx, 'import_row', rows.import_row.map((r) => ({ ...plain(r), imported_json: asJson(r.imported_json), extra: asJson(r.extra), batch_id: batches.get(r.$batch)! })));
  const reports = await insertMapped(trx, 'report', rows.report.map((r) => ({ ...plain(r), definition: asJson(r.definition), extra: asJson(r.extra) })));
  await insertAll(trx, 'report_share', rows.report_share.map((r) => ({ ...plain(r), report_id: reports.get(r.$report)! })));
  await insertAll(trx, 'report_generation', rows.report_generation.map((r) => ({ ...plain(r), definition_snapshot: asJson(r.definition_snapshot),
    ai_texts: asJson(r.ai_texts), extra: asJson(r.extra), report_id: reports.get(r.$report)! })));
  await insertAll(trx, 'benchmark_peer_group', rows.benchmark_peer_group);

  for (const t of WORK_TABLES_PG) await sql`ALTER TABLE ${sql.table(t)} ENABLE TRIGGER USER`.execute(trx);
  const counts: Record<string, number> = {};
  for (const t of WORK_TABLES_PG) {
    const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(trx);
    counts[t] = Number(r.rows[0].n);
  }
  return counts;
};
