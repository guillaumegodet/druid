/**
 * Exports the calls of a programme as topics files of the Topic-to-Researcher Match batch of crisalid-agents
 * (druid-internal docs/plan-funding-calls.md, lot 3): one file per subset (cluster, scheme, mission…), to run with
 * `topic_researcher_match.py --topics-file <file>`, the reports being imported back with
 * `import_calls.cjs --programme=<id> --file=<report>`. Only the calls collected with a text are exported
 * (lib/calls/trmExport.ts); by default the open and forthcoming ones.
 *
 * Refused unless the instance runs on PostgreSQL.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL):
 *   node scripts/.build/export_calls.cjs --programme=eic --out=<directory> [--subset=PATHFINDER]
 *        [--status=open,forthcoming] [--list]
 * `--subset`: export this subset only ('' = the calls of the programme without subset); `--list`: print the subsets
 * and their number of calls, write nothing.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { createCallsStore } from '../lib/calls/pg';
import { BUILT_IN_PROGRAMMES, type CallStatus } from '../lib/calls/programmes';
import { hasMatchingText, subsetsOf, topicsFileName, topicsFileOf } from '../lib/calls/trmExport';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const PROGRAMME = option('programme');
const OUT = option('out');
const SUBSET = option('subset');
const STATUSES = (option('status') ?? 'open,forthcoming').split(',').map((s) => s.trim()).filter(Boolean) as CallStatus[];
const LIST = args.includes('--list');

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the calls for proposals need the PostgreSQL storage');
  const programme = BUILT_IN_PROGRAMMES.find((p) => p.programmeId === PROGRAMME);
  if (!programme) throw new Error(`--programme=<id> is required, one of: ${BUILT_IN_PROGRAMMES.map((p) => p.programmeId).join(', ')}`);
  if (!OUT && !LIST) throw new Error('--out=<directory> is required (or --list)');
  const store = createCallsStore(databaseFromEnv(process.env));
  const calls = await store.callsForMatching(programme.programmeId, { subset: SUBSET, statuses: STATUSES });
  const withoutText = calls.filter((c) => !hasMatchingText(c));
  const subsets = SUBSET !== undefined ? [SUBSET] : subsetsOf(calls);
  console.log(`${programme.programmeId}: ${calls.length} call(s) ${STATUSES.join('/')}, ${withoutText.length} without text (left out)`);
  if (LIST) {
    for (const subset of subsets) console.log(`  ${subset || '(none)'}: ${calls.filter((c) => c.subset === subset && hasMatchingText(c)).length}`);
    return;
  }
  mkdirSync(OUT!, { recursive: true });
  for (const subset of subsets) {
    const file = topicsFileOf(programme, calls, { subset });
    if (!file.topics.length) continue;
    const path = join(OUT!, topicsFileName(programme.programmeId, subset));
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`  ${path}: ${file.topics.length} topic(s), run label ${file.subset}`);
  }
}

main()
  .then(() => closeDatabases())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabases();
    process.exit(1);
  });
