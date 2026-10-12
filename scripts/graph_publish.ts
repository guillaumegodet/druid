/**
 * Graph publisher (druid-internal docs/plan-migration-postgresql.md, lot 11 d): one pass that compares the directory
 * with what the CRISalid knowledge graph holds (graph_identifier_state, loaded by import_graph_snapshot), queues the
 * identifier removals and publishes them to the CRISalid bus as SoVisu+ user actions, so that the IKG cleans up the
 * publications harvested with a wrong identifier. Run once a night by ofelia; the people.csv export runs the same
 * pass just before writing the file, so a correction never waits for the night to be exported.
 *
 * DRUID_GRAPH_ACTIONS: `off` (default, nothing), `dry-run` (plan only, nothing recorded nor sent), `on`. A pass with
 * more than 25 removals to send is refused (exit code 2) unless `--force`. The logs name persons and identifier types,
 * never a value. Refused unless the instance runs on PostgreSQL.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL, DRUID_GRAPH_ACTIONS, DRUID_AMQP_URL[, DRUID_GRAPH_EXCHANGE,
 * DRUID_GRAPH_ACCEPTED_TYPES]):
 *   node scripts/.build/graph_publish.cjs [--force] [--limit=<n>]
 */
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { connectGraphBus } from '../lib/graph/bus';
import { GraphPlanRefused, MAX_REMOVALS_PER_PASS } from '../lib/graph/pg';
import { acceptedTypesFromEnv, graphActionsModeFromEnv, runGraphPass } from '../lib/graph/publisher';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').slice(8)) || MAX_REMOVALS_PER_PASS;

async function main() {
  const mode = graphActionsModeFromEnv(process.env);
  if (mode === 'off') { console.log('[graph_publish] DRUID_GRAPH_ACTIONS=off: nothing to do'); return; }
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the graph actions need the PostgreSQL directory');
  const url = process.env.DRUID_AMQP_URL || '';
  if (mode === 'on' && !url) throw new Error('DRUID_AMQP_URL is not set');
  const exchange = process.env.DRUID_GRAPH_EXCHANGE || 'graph';
  const report = await runGraphPass({
    db: databaseFromEnv(process.env), mode, accepted: acceptedTypesFromEnv(process.env), force: FORCE, limit: LIMIT,
    openBus: () => connectGraphBus(url, exchange),
  });
  const p = report.planned;
  console.log(`[graph_publish] ${mode}: queued ${p.queued.length}${p.queued.length ? ` (${p.queued.join(', ')})` : ''}, blocked ${p.blocked.length}`
    + `${p.blocked.length ? ` (${p.blocked.join(', ')})` : ''}, unblocked ${p.unblocked}, cancelled ${p.cancelled}, unreadable directory values ${p.unreadable.length}`
    + `${p.unreadable.length ? ` (${p.unreadable.join(', ')})` : ''}, persons of the graph without a record ${p.orphans}`);
  if (report.sent.length) console.log(`[graph_publish] sent ${report.sent.length}: ${report.sent.join(', ')}`);
  for (const f of report.failed) console.log(`[graph_publish] failed ${f.action}: ${f.error}`);
  await closeDatabases();
  if (report.failed.length) process.exitCode = 1;
}

main().catch(async (e) => {
  if (e instanceof GraphPlanRefused) {
    console.error(`[graph_publish] ✗ ${e.message}: node scripts/.build/graph_publish.cjs --force`);
    await closeDatabases().catch(() => {});
    process.exit(2);
  }
  console.error('[graph_publish] ✗', e);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
