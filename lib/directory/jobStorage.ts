// Storage of the Node jobs and scripts (druid-internal docs/plan-migration-postgresql.md, lot 3): the same Grist
// client, repository and domain commands as the API, configured from the environment. The JavaScript jobs take it
// from the server bundle (scripts/lib/storage.cjs → server-api.cjs), the TypeScript scripts import it directly
// (bundled by esbuild). One door to the directory, so that one implementation can be swapped for another (lot 6).
import { createGristDirectoryCommands, CommandContext, DirectoryCommands } from './commands';
import { createGristDirectoryRepository, createGristReader, DirectoryRepository, GristClient } from './repository';

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
  grist: GristClient;
  repository: DirectoryRepository;
  commands: DirectoryCommands;
}

export const jobStorageFromEnv = (env: Record<string, string | undefined>, userAgent?: string): JobStorage => {
  const grist = gristClientFromEnv(env, userAgent);
  const repository = createGristDirectoryRepository({ grist });
  return { grist, repository, commands: createGristDirectoryCommands({ grist, repository }) };
};

/**
 * Command context of a job: institution right (a job is run by an administrator on the server); the scripts print
 * their own report of what they wrote, `onWrite` lets them count the writes.
 */
export const jobContext = (onWrite: CommandContext['audit'] = () => {}): CommandContext => ({
  scope: { all: true, labAnchors: [] },
  audit: onWrite,
});
