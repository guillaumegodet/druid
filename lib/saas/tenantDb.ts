/**
 * @file tenantDb.ts
 * @description Provisioning of the PostgreSQL schema of a tenant (druid-internal docs/plan-druid-saas.md, lot 1 b).
 * Node only (spawns dbmate): the CLI scripts/saas/tenant_db.ts, the onboarding job (lot 2) and the CI integration test
 * share it. The schema is created by the owner role, the application role gets rows-only rights through default
 * privileges set BEFORE the migrations of db/migrations run with `search_path=<schema>` (dbmate then creates every
 * table, function and domain in that schema, and its own schema_migrations there).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createDbWith } from '../db/core';
import { SAAS_SCHEMA, tenantSchemaName, type SaasDb, type TenantStatus } from './controlPlane';

export interface TenantDbOptions {
  /** Connection string of the owner role (DDL): the one dbmate uses. */
  ownerUrl: string;
  /** Migrations of a tenant schema (default db/migrations of the working directory). */
  migrationsDir?: string;
  /** dbmate binary (default: node_modules/.bin/dbmate, else `dbmate` in PATH). */
  dbmateBin?: string;
  /** Application role that reads and writes the rows (db/roles.sql); skipped when the role does not exist. */
  appRole?: string;
  log?: (line: string) => void;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const ident = (name: string): string => {
  if (!IDENT_RE.test(name)) throw new Error(`invalid identifier "${name}"`);
  return `"${name}"`;
};

const defaultDbmate = (): string => {
  const local = path.join(process.cwd(), 'node_modules', '.bin', 'dbmate');
  return fs.existsSync(local) ? local : 'dbmate';
};

/** `ownerUrl` with `search_path=<schema>` (dbmate reads it: schema of the migrations and of schema_migrations). */
export const urlWithSearchPath = (ownerUrl: string, schema: string): string => {
  const u = new URL(ownerUrl);
  u.searchParams.set('search_path', schema);
  return u.toString();
};

const runDbmate = (bin: string, args: string[], log: (l: string) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => log(`dbmate: ${l}`)));
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`dbmate exited with ${code}: ${err.trim()}`))));
  });

/** Runs the tenant migrations on `schema` (create or update); the schema exists afterwards, with its rights. */
export const migrateTenantSchema = async (schema: string, opts: TenantDbOptions): Promise<void> => {
  const log = opts.log || (() => {});
  const appRole = opts.appRole ?? 'druid_app';
  const migrationsDir = opts.migrationsDir || path.join(process.cwd(), 'db', 'migrations');
  const client = new pg.Client({ connectionString: opts.ownerUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`);
    const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appRole]);
    if (role.rowCount) {
      // Default privileges apply to the objects created afterwards by the migrations: set them first.
      await client.query(`GRANT USAGE ON SCHEMA ${ident(schema)} TO ${ident(appRole)}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${ident(schema)} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(appRole)}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${ident(schema)} GRANT USAGE, SELECT ON SEQUENCES TO ${ident(appRole)}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${ident(schema)} GRANT EXECUTE ON FUNCTIONS TO ${ident(appRole)}`);
    } else {
      log(`role ${appRole} absent: single-role database, no grant`);
    }
  } finally {
    await client.end();
  }
  await runDbmate(opts.dbmateBin || defaultDbmate(),
    ['-u', urlWithSearchPath(opts.ownerUrl, schema), '--migrations-dir', migrationsDir, '--no-dump-schema', 'up'], log);
  // Functions created before 20261021090000 pinned `search_path = public`: make sure every trigger function of the
  // schema resolves its tables in the schema (idempotent; the migration above already does it for audit_row).
  const client2 = new pg.Client({ connectionString: opts.ownerUrl });
  await client2.connect();
  try {
    const fns = await client2.query<{ name: string }>(
      `SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.prorettype = 'trigger'::regtype`, [schema]);
    for (const { name } of fns.rows) {
      await client2.query(`ALTER FUNCTION ${ident(schema)}.${ident(name)}() SET search_path = ${ident(schema)}, pg_temp`);
    }
  } finally {
    await client2.end();
  }
};

/** Migrations of the control plane (db/saas/migrations) on the `saas` schema: `npm run db:saas:migrate` does the same. */
export const migrateControlPlane = async (opts: TenantDbOptions): Promise<void> => {
  const dir = path.join(path.dirname(opts.migrationsDir || path.join(process.cwd(), 'db', 'migrations')), 'saas', 'migrations');
  await runDbmate(opts.dbmateBin || defaultDbmate(),
    ['-u', urlWithSearchPath(opts.ownerUrl, SAAS_SCHEMA), '--migrations-dir', dir, '--no-dump-schema', 'up'], opts.log || (() => {}));
};

/** Drops the schema of a tenant and everything in it. The caller has checked the tenant row (status deleted). */
export const dropTenantSchema = async (schema: string, opts: Pick<TenantDbOptions, 'ownerUrl'>): Promise<void> => {
  if (!schema.startsWith('t_')) throw new Error(`refusing to drop "${schema}": not a tenant schema`);
  const client = new pg.Client({ connectionString: opts.ownerUrl });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
  } finally {
    await client.end();
  }
};

/** Control-plane client on the owner URL (the CLI and the jobs; the Functions use their Hyperdrive binding). */
export const openSaasDb = (connectionString: string, max = 2): SaasDb =>
  createDbWith(pg, { connectionString, max, allowExitOnIdle: true, schema: SAAS_SCHEMA });

export interface CreateTenantInput {
  slug: string;
  label: string;
  hosts: string[];
  planCode?: string;
  mailDomains?: string[];
  ownerEmail?: string | null;
  ror?: string | null;
  uai?: string | null;
  country?: string | null;
  createdBy?: string | null;
}

/**
 * Creates a tenant: control-plane row (status provisioning), its schema migrated, then status active. The row comes
 * first so that a crash leaves a visible `provisioning` tenant, never an orphan schema.
 */
export const createTenant = async (saas: SaasDb, input: CreateTenantInput, opts: TenantDbOptions): Promise<{ id: string; schema: string }> => {
  const schema = tenantSchemaName(input.slug);
  const row = await saas.insertInto('tenant').values({
    slug: input.slug, label: input.label, schema_name: schema, plan_code: input.planCode || 'trial',
    mail_domains: input.mailDomains || [], ror: input.ror || null, uai: input.uai || null, country: input.country || null,
    created_by: input.createdBy || input.ownerEmail || null,
  }).returning('id').executeTakeFirstOrThrow();
  await saas.insertInto('tenant_host').values(input.hosts.map((host, i) => ({ host: host.toLowerCase(), tenant_id: row.id, is_primary: i === 0 }))).execute();
  if (input.ownerEmail) {
    await saas.insertInto('member').values({ tenant_id: row.id, email: input.ownerEmail.toLowerCase(), role: 'owner', invited_by: null }).execute();
  }
  await migrateTenantSchema(schema, opts);
  await setTenantStatus(saas, row.id, 'active');
  return { id: row.id, schema };
};

export const setTenantStatus = async (saas: SaasDb, tenantId: string, status: TenantStatus): Promise<void> => {
  await saas.updateTable('tenant').set({ status, updated_at: new Date().toISOString() }).where('id', '=', tenantId).execute();
};

/** Migrates every tenant schema (deployment of a new version): one failure stops the loop and is reported. */
export const migrateAllTenants = async (saas: SaasDb, opts: TenantDbOptions): Promise<string[]> => {
  const tenants = await saas.selectFrom('tenant').select(['slug', 'schema_name']).where('status', '<>', 'deleted').orderBy('slug').execute();
  for (const t of tenants) {
    (opts.log || (() => {}))(`tenant ${t.slug}: migrating ${t.schema_name}`);
    await migrateTenantSchema(t.schema_name, opts);
  }
  return tenants.map((t) => t.slug);
};
