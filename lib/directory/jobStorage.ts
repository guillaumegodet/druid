// Storage of the Node jobs and scripts (druid-internal docs/plan-migration-postgresql.md, lot 3): the same Grist
// client, repository and domain commands as the API, configured from the environment. The JavaScript jobs take it
// from the server bundle (scripts/lib/storage.cjs → server-api.cjs), the TypeScript scripts import it directly
// (bundled by esbuild). One door to the directory, so that one implementation can be swapped for another (lot 6).
import { createDb, type Db } from '../db/client';
import { createGristDirectoryCommands, CommandContext, DirectoryCommands } from './commands';
import { createGristDirectoryRepository, createGristReader, DirectoryRepository, GristClient } from './repository';
import { createPgDirectoryRepository } from './pg/repository';
import { createPgDirectoryCommands } from './pg/commands';
import { createPgTableClient } from './pg/tableClient';

/**
 * Storage of the directory (lot 6 f): `DRUID_STORAGE=postgres` (with DRUID_DATABASE_URL, role druid_app) or `grist`
 * (default — the Cloudflare instances, and Nantes until the switch).
 */
export type StorageKind = 'grist' | 'postgres';
export const storageKindFromEnv = (env: Record<string, string | undefined>): StorageKind => {
  const kind = String(env.DRUID_STORAGE || 'grist').trim().toLowerCase();
  if (kind !== 'grist' && kind !== 'postgres') throw new Error(`DRUID_STORAGE must be grist or postgres, not « ${kind} »`);
  if (kind === 'postgres' && !env.DRUID_DATABASE_URL) throw new Error('DRUID_STORAGE=postgres needs DRUID_DATABASE_URL');
  return kind;
};
/** One pool per process and database. */
const pools = new Map<string, Db>();
export const databaseFromEnv = (env: Record<string, string | undefined>, max = 4, allowExitOnIdle = true): Db => {
  const url = env.DRUID_DATABASE_URL!;
  if (!pools.has(url)) pools.set(url, createDb({ connectionString: url, max, allowExitOnIdle }));
  return pools.get(url)!;
};
/** Closes the pools (end of a job, so that the process can exit). */
export const closeDatabases = async () => {
  for (const db of pools.values()) await db.destroy();
  pools.clear();
};

/**
 * Tables of the directory for the jobs: the Grist client of the document, or with DRUID_STORAGE=postgres the
 * migrated tables seen as that document (lib/directory/pg/tableClient.ts), writes audited under the job's name.
 */
export const tablesFromEnv = (env: Record<string, string | undefined>, userAgent = 'Druid-CRISalid-jobs/1.0'): GristClient =>
  (storageKindFromEnv(env) === 'postgres' ? createPgTableClient({ db: databaseFromEnv(env), actor: `job:${userAgent}` }) : gristClientFromEnv(env, userAgent));

/**
 * Grist client configured from the environment (VITE_GRIST_DOC_ID, GRIST_API_KEY, GRIST_API_BASE).
 * Throws when the document or the key is missing.
 */
export const gristClientFromEnv = (env: Record<string, string | undefined>, userAgent = 'Druid-CRISalid-jobs/1.0'): GristClient => {
  const docId = env.VITE_GRIST_DOC_ID;
  const apiKey = env.GRIST_API_KEY || env.VITE_GRIST_API_KEY;
  if (!docId || !apiKey) throw new Error('VITE_GRIST_DOC_ID / GRIST_API_KEY not configured');
  return createGristReader({ apiBase: env.GRIST_API_BASE || 'https://grist.numerique.gouv.fr/api', docId, apiKey, userAgent });
};

export interface JobStorage {
  /** Tables of the directory (Grist, or the PostgreSQL table view). */
  grist: GristClient;
  repository: DirectoryRepository;
  commands: DirectoryCommands;
}

export const jobStorageFromEnv = (env: Record<string, string | undefined>, userAgent?: string): JobStorage => {
  if (storageKindFromEnv(env) === 'postgres') {
    const db = databaseFromEnv(env);
    const repository = createPgDirectoryRepository({ db });
    return { grist: tablesFromEnv(env, userAgent), repository, commands: createPgDirectoryCommands({ db, repository }) };
  }
  const grist = gristClientFromEnv(env, userAgent);
  const repository = createGristDirectoryRepository({ grist });
  return { grist, repository, commands: createGristDirectoryCommands({ grist, repository }) };
};

/**
 * Command context of a job: institution right (a job is run by an administrator on the server); the scripts print
 * their own report of what they wrote, `onWrite` lets them count the writes.
 */
export const jobContext = (onWrite: CommandContext['audit'] = () => {}, actor = 'job'): CommandContext => ({
  scope: { all: true, labAnchors: [] },
  actor,
  audit: onWrite,
});
