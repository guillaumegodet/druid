// Grist → PostgreSQL import, loading part (druid-internal docs/plan-migration-postgresql.md, lot 5): writes the rows of
// gristToPg.ts in the transaction it is given, as the database owner (druid_owner). Replays from scratch: the imported
// tables are emptied first (and the tables that point to them, CASCADE), so a rehearsal can be run again and again
// until the switch-over. The `updated_at` / audit triggers are off for the bulk load (owner only); one audit_log row
// records the import instead.
import { sql, Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import type { DirectoryRows, MigrationReport } from './gristToPg';

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

const insertAll = async (trx: Transaction<DB>, table: keyof DB, rows: Record<string, any>[]) => {
  for (const part of chunks(rows)) await trx.insertInto(table as any).values(part as any).execute();
};
/** Inserts and returns legacy Grist id → new id. */
const insertMapped = async (trx: Transaction<DB>, table: 'establishment' | 'structure' | 'membership', rows: Record<string, any>[]) => {
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
