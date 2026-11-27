/**
 * Nightly reconciliation with the SoVisu+ action table (lot 5 of druid-internal
 * docs/plan-retour-identifiants-sovisuplus.md): replays the identifier actions the bus did not deliver to Druid, with
 * the consumer's own code (lib/graph/inboundReconcile.ts). Run by ofelia in the container druid-graph-consume (the only
 * Druid container on the SoVisu+ database network), after the night's cdb run.
 *
 * DRUID_GRAPH_INBOUND: same modes as the consumer (`off`: nothing; `dry-run`: replayed messages are journaled
 * `planned`; `on`). SOVISUPLUS_DATABASE_URL: read-only role on the table "Action" of the SoVisu+ database. Exit code 1
 * when the table changed shape or a message failed. The logs name persons and identifier types, never a value.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL, DRUID_GRAPH_INBOUND, SOVISUPLUS_DATABASE_URL):
 *   node scripts/.build/graph_reconcile_sovisuplus.cjs [--since=YYYY-MM-DD]   (default: the last 30 days)
 * First run: --since=2026-11-13 (move to CRISalid 1.7, when SoVisu+ started to publish these actions).
 */
import { createDb } from '../lib/db/client';
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { inboundModeFromEnv } from '../lib/graph/inboundPg';
import { runReconcile } from '../lib/graph/inboundReconcile';

const DEFAULT_WINDOW_DAYS = 30;

const sinceArg = (args: string[], now = new Date()): string => {
  const raw = (args.find((a) => a.startsWith('--since=')) || '').slice(8);
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('--since must be a date YYYY-MM-DD');
    return raw;
  }
  return new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
};

async function main() {
  const mode = inboundModeFromEnv(process.env);
  if (mode === 'off') { console.log('[graph_reconcile] DRUID_GRAPH_INBOUND=off: nothing to do'); return; }
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the inbound actions need the PostgreSQL directory');
  const svpUrl = process.env.SOVISUPLUS_DATABASE_URL || '';
  if (!svpUrl) throw new Error('SOVISUPLUS_DATABASE_URL is not set');
  const since = sinceArg(process.argv.slice(2));
  const svp = createDb({ connectionString: svpUrl, max: 1, allowExitOnIdle: true }) as any;
  try {
    const r = await runReconcile({ db: databaseFromEnv(process.env), svp, mode, since });
    const replayed = Object.entries(r.replayed).map(([s, n]) => `${s} ${n}`).join(', ') || 'none';
    console.log(`[graph_reconcile] ${mode} since ${since}: ${r.scanned} identifier action(s) in SoVisu+, ${r.known} already received, `
      + `replayed: ${replayed}${r.labels.length ? ` (${r.labels.join(', ')})` : ''}, superseded ${r.superseded}`);
    if (r.undispatched) console.log(`[graph_reconcile] ⚠ ${r.undispatched} action(s) never published by SoVisu+ for more than an hour: check its connection to the bus`);
    if (r.replayed.failed) process.exitCode = 1;
  } finally {
    await svp.destroy().catch(() => {});
    await closeDatabases().catch(() => {});
  }
}

main().catch(async (e) => {
  console.error('[graph_reconcile] ✗', e instanceof Error ? e.message : e);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
