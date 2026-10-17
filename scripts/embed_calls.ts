/**
 * Embeds the passages of the open and forthcoming calls for the « My project » assistant (druid-internal
 * docs/plan-funding-calls.md, lot 7): each call is cut into passages (summary, objectives, scope), a passage is sent to
 * the embedding service (bge-m3, EMBEDDING_API_*) only when its text or the model changed, the passages of the calls
 * no longer open are dropped. Refused unless the instance runs on PostgreSQL.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL, EMBEDDING_API_URL, EMBEDDING_API_KEY, EMBEDDING_API_MODEL):
 *   node scripts/.build/embed_calls.cjs [--dry-run] [--limit=N]
 * Meant for a nightly job (ofelia), after the collection of the calls.
 */
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { embedderFromEnv } from '../lib/calls/embeddings';
import { createCallPassageStore } from '../lib/calls/passageStore';
import { embedOpenCalls } from '../lib/calls/projectChat';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined;

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the passages of the calls need the PostgreSQL storage');
  const embedder = embedderFromEnv(process.env);
  if (!embedder) throw new Error('EMBEDDING_API_URL / EMBEDDING_API_MODEL are not set: no embedding service');
  const store = createCallPassageStore(databaseFromEnv(process.env));
  const started = Date.now();
  const report = await embedOpenCalls(store, embedder, { dryRun: DRY_RUN, limit: LIMIT, log: (line) => console.log(line) });
  console.log(`embed-calls (${embedder.model}): ${report.calls} open call(s), ${report.kept} unchanged, ${report.embedded} embedded `
    + `(${report.passages} passage(s)), ${report.dropped} closed call(s) dropped, ${Math.round((Date.now() - started) / 1000)} s${DRY_RUN ? ' (dry run)' : ''}`);
}

main()
  .then(() => closeDatabases())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabases();
    process.exit(1);
  });
