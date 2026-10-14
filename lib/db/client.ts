// PostgreSQL access of Druid with node-postgres (druid-internal docs/plan-migration-postgresql.md, lot 4). Server side
// only (server.cjs bundle, jobs, scripts): never imported by the browser, nor by the Cloudflare Pages Functions, which
// bundle the driver themselves (functions/_lib/storage.js) and share lib/db/core.ts.
import pg from 'pg';
import { createDbWith, type Db, type DbOptions } from './core';

export { withActor, type DB, type Db, type DbOptions } from './core';

export const createDb = (options: DbOptions): Db => createDbWith(pg, options);
