// PostgreSQL access of Druid without the driver import (druid-internal docs/plan-migration-postgresql.md, lot 4; D5:
// Kysely for the queries, plain SQL migrations run by dbmate in db/migrations). `createDbWith` takes node-postgres as
// an argument: the server (lib/db/client.ts) passes the package, the Cloudflare Pages Functions pass the bundle of
// functions/_generated/pg.js (scripts/functions_pg_bundle.cjs). The row types (schema.gen.ts) are generated from the
// migrated schema by `npm run db:types`; the CI checks they are up to date.
import { Kysely, PostgresDialect, sql, Transaction } from 'kysely';
import type pg from 'pg';
import type { DB } from './schema.gen';

export type { DB };
export type Db = Kysely<DB>;
/** What `createDbWith` needs from node-postgres. */
export type PgDriver = Pick<typeof pg, 'Pool' | 'types'>;

// `date` columns stay 'YYYY-MM-DD' strings (no JavaScript Date at local midnight): same choice as the generated types.
const DATE_OID = 1082;

export interface DbOptions {
  connectionString: string;
  /** Pool size: the database is small and shared with the jobs. */
  max?: number;
  /** A job: its process may end while idle connections remain (they no longer keep it alive). */
  allowExitOnIdle?: boolean;
}

export const createDbWith = (driver: PgDriver, { connectionString, max = 5, allowExitOnIdle = false }: DbOptions): Db => {
  const getTypeParser = (oid: number, format?: any) => (oid === DATE_OID ? (v: string) => v : driver.types.getTypeParser(oid, format));
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new driver.Pool({ connectionString, max, allowExitOnIdle, types: { getTypeParser } }) }),
  });
};

/**
 * Runs `fn` in a transaction whose writes the audit log attributes to `actor` (Keycloak / Access user, or the name of
 * a job): the audit_row trigger reads `druid.actor`, set for this transaction only.
 */
export const withActor = <T>(db: Db, actor: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> =>
  db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('druid.actor', ${actor}, true)`.execute(trx);
    return fn(trx);
  });
