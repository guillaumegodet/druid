// PostgreSQL access of Druid (druid-internal docs/plan-migration-postgresql.md, lot 4; D5: Kysely for the queries,
// plain SQL migrations run by dbmate in db/migrations). Server side only (server.cjs bundle, jobs): never imported
// by the browser. The row types (schema.gen.ts) are generated from the migrated schema by `npm run db:types`; the CI
// checks they are up to date.
import { Kysely, PostgresDialect, sql, Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.gen';

export type { DB };
export type Db = Kysely<DB>;

// `date` columns stay 'YYYY-MM-DD' strings (no JavaScript Date at local midnight): same choice as the generated types.
const DATE_OID = 1082;
const typeParser = (oid: number, format?: any) => (oid === DATE_OID ? (v: string) => v : pg.types.getTypeParser(oid, format));

export interface DbOptions {
  connectionString: string;
  /** Pool size: the database is small and shared with the jobs. */
  max?: number;
}

export const createDb = ({ connectionString, max = 5 }: DbOptions): Db =>
  new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max, types: { getTypeParser: typeParser } }) }),
  });

/**
 * Runs `fn` in a transaction whose writes the audit log attributes to `actor` (Keycloak / Access user, or the name of
 * a job): the audit_row trigger reads `druid.actor`, set for this transaction only.
 */
export const withActor = <T>(db: Db, actor: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> =>
  db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('druid.actor', ${actor}, true)`.execute(trx);
    return fn(trx);
  });
