/**
 * Collects the calls for proposals of a source into the tables of the « Calls for proposals » tab (druid-internal
 * docs/plan-funding-calls.md, lot 2). Source `ft-portal` (the only one so far): the Funding & Tenders portal of the
 * European Commission — its public reference file lists every grant topic (identifier, title, call, programme, status,
 * dates), streamed and filtered on the active programmes (lib/calls/programmes.ts, Administration › Calls for
 * proposals); the text of a new or changed topic is read from the public JSON of the topic (lib/calls/portal.ts).
 * Closed topics unknown to the store are not imported. Every run is logged (call_collection) and shown by the
 * administration. Refused unless the instance runs on PostgreSQL.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL):
 *   node scripts/.build/collect_calls.cjs --source=ft-portal [--programme=erc,msca] [--details-limit=300]
 *        [--listing-file=<grantsTenders.json>] [--by=<who>]
 * `--programme`: collect these programmes even when inactive (default: the active programmes of the source).
 * `--details-limit`: at most this many topic texts fetched in one run (default 400; a changed topic beyond the limit
 * still gets its dates and status, a new one waits for the next run). `--listing-file`: read the listing from a local
 * file instead of the portal (tests, offline). Meant for a nightly job (ofelia); the outgoing calls go through the
 * proxy of the instance when NODE_USE_ENV_PROXY=1 and HTTPS_PROXY are set.
 */
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { createCallsStore } from '../lib/calls/pg';
import { collectFromPortal } from '../lib/calls/collect';
import { PORTAL_LISTING_URL } from '../lib/calls/ftPortal';
import { fetchPortalTopic } from '../lib/calls/portal';
import { FT_PORTAL_SOURCE } from '../lib/calls/programmes';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SOURCE = option('source') || FT_PORTAL_SOURCE;
const PROGRAMMES = (option('programme') || '').split(',').map((s) => s.trim()).filter(Boolean);
const DETAILS_LIMIT = Number(option('details-limit') || 400);
const LISTING_FILE = option('listing-file');
const BY = option('by') || 'collect_calls';

/** The listing as a stream of text chunks, from the portal or a local file. */
async function* listingChunks(): AsyncGenerator<string | Uint8Array> {
  if (LISTING_FILE) {
    for await (const chunk of createReadStream(LISTING_FILE)) yield chunk as Uint8Array;
    return;
  }
  const res = await fetch(PORTAL_LISTING_URL);
  if (!res.ok || !res.body) throw new Error(`portal listing: HTTP ${res.status}`);
  for await (const chunk of Readable.fromWeb(res.body as import('stream/web').ReadableStream<Uint8Array>)) yield chunk as Uint8Array;
}

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the calls for proposals need the PostgreSQL storage');
  if (SOURCE !== FT_PORTAL_SOURCE) throw new Error(`unknown source ${SOURCE} (sources: ${FT_PORTAL_SOURCE})`);
  const db = databaseFromEnv(process.env);
  const store = createCallsStore(db);
  await store.syncProgrammes();
  const programmes = await store.programmesOfSource(SOURCE, PROGRAMMES);
  if (!programmes.length) { console.log(`${SOURCE}: no programme to collect (activate one in Administration › Calls for proposals)`); return; }
  const ids = programmes.map((p) => p.programmeId);
  console.log(`${SOURCE}: collecting ${ids.join(', ')}${LISTING_FILE ? ` from ${LISTING_FILE}` : ''}`);
  const collectionId = await store.startCollection(SOURCE, ids, BY);
  try {
    const stats = await collectFromPortal({
      programmes, listing: listingChunks(), fetchDetails: (id) => fetchPortalTopic(id), store: store.collectorStore,
      today: new Date().toISOString().slice(0, 10), detailsLimit: DETAILS_LIMIT, log: (m) => console.log(m),
    });
    for (const e of stats.errors.slice(0, 20)) console.log(`  ${e}`);
    await store.finishCollection(collectionId, {
      status: 'done', seen: stats.seen, new: stats.new, updated: stats.updated, detailsFetched: stats.detailsFetched, error: stats.errors.join('\n'),
    }, ids);
  } catch (e) {
    await store.finishCollection(collectionId, { status: 'failed', seen: 0, new: 0, updated: 0, detailsFetched: 0, error: e instanceof Error ? e.message : String(e) }, []);
    throw e;
  }
}

main()
  .then(() => closeDatabases())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabases();
    process.exit(1);
  });
