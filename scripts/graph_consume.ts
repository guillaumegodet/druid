/**
 * Consumer of the identifier actions coming back from SoVisu+ (lot 3 of druid-internal
 * docs/plan-retour-identifiants-sovisuplus.md): reads the queue druid-person-actions (bound to
 * `task.people.person.#` on the exchange `graph`, dead-letter `dlx.druid`) one message at a time and takes each action
 * over in the record (lib/graph/inboundPg.ts). Long-running: the compose service druid-graph-consume restarts it when
 * the bus or the database goes away (exit code 1).
 *
 * DRUID_GRAPH_INBOUND: `off` (default: exits at once), `dry-run` (journals what each message would do, writes nothing
 * else; replayed when the mode turns `on`), `on`. A message that fails 3 times goes to dlq.druid-person-actions. The
 * user `druid` may only read its queue: nothing is declared (checkQueue, consume). The logs name persons and identifier
 * types, never a value. Refused unless the instance runs on PostgreSQL.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL, DRUID_GRAPH_INBOUND, DRUID_AMQP_URL[, DRUID_GRAPH_INBOUND_QUEUE]):
 *   node scripts/.build/graph_consume.cjs
 */
import { connect } from 'amqplib';
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { handleInboundDelivery, inboundModeFromEnv, replayPlannedMessages } from '../lib/graph/inboundPg';

/** Pause before a failed message is handed back to the queue: a database restart must not spin the loop. */
const RETRY_DELAY_MS = 5000;

async function main() {
  const mode = inboundModeFromEnv(process.env);
  if (mode === 'off') { console.log('[graph_consume] DRUID_GRAPH_INBOUND=off: nothing to do'); return; }
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the inbound actions need the PostgreSQL directory');
  const url = process.env.DRUID_AMQP_URL || '';
  if (!url) throw new Error('DRUID_AMQP_URL is not set');
  const queue = process.env.DRUID_GRAPH_INBOUND_QUEUE || 'druid-person-actions';
  const db = databaseFromEnv(process.env);

  if (mode === 'on') {
    const n = await replayPlannedMessages(db);
    if (n) console.log(`[graph_consume] ${n} message(s) read in dry-run mode replayed`);
  }

  const connection = await connect(url, { clientProperties: { connection_name: 'druid-graph-consume' } });
  const channel = await connection.createChannel();
  const { messageCount } = await channel.checkQueue(queue);
  await channel.prefetch(1);
  console.log(`[graph_consume] ${mode}: listening to ${queue} (${messageCount} waiting)`);

  let stopping = false;
  const stop = async (code: number, why: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[graph_consume] stopping: ${why}`);
    await channel.close().catch(() => {});
    await connection.close().catch(() => {});
    await closeDatabases().catch(() => {});
    process.exit(code);
  };
  connection.on('close', () => { void stop(1, 'connection to the bus closed'); });
  connection.on('error', (err) => { console.error('[graph_consume] bus error:', err.message); });
  process.on('SIGTERM', () => { void stop(0, 'SIGTERM'); });
  process.on('SIGINT', () => { void stop(0, 'SIGINT'); });

  await channel.consume(queue, async (msg) => {
    if (!msg) { await stop(1, 'consumer cancelled by the broker'); return; }
    const verdict = await handleInboundDelivery(db, msg.content.toString('utf8'), mode);
    if (verdict === 'ack') channel.ack(msg);
    else if (verdict === 'dead-letter') channel.nack(msg, false, false);
    else setTimeout(() => channel.nack(msg, false, true), RETRY_DELAY_MS);
  }, { noAck: false });
}

main().catch(async (e) => {
  console.error('[graph_consume] ✗', e);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
