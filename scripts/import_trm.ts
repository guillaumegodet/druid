/**
 * Imports a Topic-to-Researcher Match report of crisalid-agents (`trm-<cluster>-<date>.json`, one per Horizon Europe
 * cluster) into the tables of the « European calls » tab (druid-internal docs/plan-eu-calls.md, lot 2): the
 * topics of the report, its run and its matches. A new import of a cluster replaces the previous run of that cluster;
 * the feedback already given on the pairs is kept (keyed by pair id).
 *
 * Refused unless the instance runs on PostgreSQL. The report is read as data: the names it carries are those of the
 * graph, the uids are matched to the directory by the tab, not here.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL):
 *   node scripts/.build/import_trm.cjs --file=<report.json> [--file=<other report.json>…] [--by=<who>] [--merge] [--no-portal]
 *   node scripts/.build/import_trm.cjs --refresh-titles [--cluster=CL4]
 * `--merge`: the report completes the run already imported for its cluster (topics replayed after a failure of the
 * batch, `topic_researcher_match.py --topic … --out <other directory>`) instead of replacing it.
 * The titles parsed from the PDFs carry word splits: after an import (unless `--no-portal`), and with
 * `--refresh-titles` alone, the official title and deadlines of every topic are read from the Funding & Tenders
 * portal (lib/euCalls/portal.ts); topics the portal does not know keep the parsed title.
 * The database network of an instance may be internal (no egress): run the script inside the application container,
 * with NODE_USE_ENV_PROXY=1 when the outgoing calls go through a proxy (HTTPS_PROXY).
 */
import { readFileSync } from 'fs';
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { createEuCallsStore } from '../lib/euCalls/pg';
import { parseTrmReport } from '../lib/euCalls/trm';
import { fetchPortalTopics } from '../lib/euCalls/portal';

const args = process.argv.slice(2);
const FILES = args.filter((a) => a.startsWith('--file=')).map((a) => a.slice('--file='.length));
const BY = args.find((a) => a.startsWith('--by='))?.slice('--by='.length) || 'import_trm';
const MERGE = args.includes('--merge');
const PORTAL = !args.includes('--no-portal');
const REFRESH = args.includes('--refresh-titles');
const CLUSTER = args.find((a) => a.startsWith('--cluster='))?.slice('--cluster='.length);

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the European calls need the PostgreSQL storage');
  if (!FILES.length && !REFRESH) throw new Error('--file=<TRM report> is required (one or more), or --refresh-titles');
  const db = databaseFromEnv(process.env);
  const store = createEuCallsStore(db);
  const refreshTitles = async (ids: string[]) => {
    const portal = await fetchPortalTopics(ids);
    const changed = await store.updateTopicsFromPortal([...portal.values()]);
    console.log(`portal: ${portal.size}/${ids.length} topics found, ${changed} title(s) or deadline(s) updated`);
  };
  if (REFRESH) {
    await refreshTitles(await store.topicIds(CLUSTER));
    return;
  }
  for (const file of FILES) {
    const run = parseTrmReport(readFileSync(file, 'utf8'));
    const report = await store.importRun(run, BY, { merge: MERGE });
    const covered = new Set(run.matches.map((m) => m.topicId)).size;
    console.log(`${file}: run ${report.runId} (${report.cluster}, model ${run.model || '?'}) — ${report.topics} topics `
      + `(${run.failedTopics.length} failed in the batch), ${report.matches} matches on ${covered} topics`
      + (report.replacedRunId ? `; replaced run ${report.replacedRunId}` : '')
      + (report.mergedIntoRunId ? `; merged into run ${report.mergedIntoRunId}` : ''));
    for (const f of run.failedTopics) console.log(`  failed topic ${f.topicId}: ${f.error}`);
    if (PORTAL) await refreshTitles(run.topics.map((t) => t.topicId));
  }
}

main()
  .then(() => closeDatabases())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabases();
    process.exit(1);
  });
