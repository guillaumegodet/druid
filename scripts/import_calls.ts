/**
 * Imports a Topic-to-Researcher Match report of crisalid-agents (`trm-<cluster>-<date>.json`, one per Horizon Europe
 * cluster) into the tables of the « Calls for proposals » tab (druid-internal docs/plan-funding-calls.md, lot 1):
 * the topics of the report become calls of the programme, with its run and its matches. A new import of a subset
 * (cluster) replaces the previous run of that subset; the feedback already given on the pairs is kept (keyed by pair id).
 *
 * Refused unless the instance runs on PostgreSQL. The report is read as data: the names it carries are those of the
 * graph, the uids are matched to the directory by the tab, not here.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL):
 *   node scripts/.build/import_calls.cjs --file=<report.json> [--file=<other report.json>…] [--by=<who>] [--merge]
 *        [--no-portal] [--perimeter=<label>] [--programme=horizon-europe]
 * `--programme`: programme of the report, Horizon Europe by default; a report of a topics file written by
 * export_calls.cjs (lot 3) is imported with the programme of that file. A call collected from its source keeps its
 * texts, subset and classification: the report only adds its summary and the matches.
 * `--perimeter`: the perimeter the batch was run on (the structures whose publications carry vectors, e.g. « IMN »),
 * shown by the tab so that nobody reads the matches of another structure as a coverage of that structure (`--scope` is
 * accepted as a synonym, name of the former import_trm.cjs).
 *   node scripts/.build/import_calls.cjs --refresh-titles [--subset=CL4]
 *   node scripts/.build/import_calls.cjs --translate-only
 * `--merge`: the report completes the run already imported for its subset (topics replayed after a failure of the
 * batch, `topic_researcher_match.py --topic … --out <other directory>`) instead of replacing it.
 * The titles parsed from the PDFs carry word splits: after an import (unless `--no-portal`), and with
 * `--refresh-titles` alone, the official title and deadlines of every topic are read from the Funding & Tenders
 * portal (lib/calls/portal.ts); topics the portal does not know keep the parsed title.
 * After an import (unless `--no-translate`), and with `--translate-only` alone, the English summaries and justifications
 * still without a French version are translated with the model of the instance (ILAAS_API_KEY / ILAAS_API_BASE /
 * ILAAS_MODEL, lib/calls/translate.ts); without a key the step is skipped.
 * The database network of an instance may be internal (no egress): run the script inside the application container,
 * with NODE_USE_ENV_PROXY=1 when the outgoing calls go through a proxy (HTTPS_PROXY).
 */
import { readFileSync } from 'fs';
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { createCallsStore } from '../lib/calls/pg';
import { parseTrmReport } from '../lib/calls/trm';
import { fetchPortalTopics } from '../lib/calls/portal';
import { HORIZON_EUROPE } from '../lib/calls/programmes';
import { translateTexts, translatorFromEnv } from '../lib/calls/translate';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const FILES = args.filter((a) => a.startsWith('--file=')).map((a) => a.slice('--file='.length));
const BY = option('by') || 'import_calls';
const MERGE = args.includes('--merge');
const PERIMETER = option('perimeter') || option('scope') || '';
const PROGRAMME = option('programme') || HORIZON_EUROPE.programmeId;
const PORTAL = !args.includes('--no-portal');
const REFRESH = args.includes('--refresh-titles');
const TRANSLATE = !args.includes('--no-translate');
const TRANSLATE_ONLY = args.includes('--translate-only');
const SUBSET = option('subset') || option('cluster');

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the calls for proposals need the PostgreSQL storage');
  if (!FILES.length && !REFRESH && !TRANSLATE_ONLY) throw new Error('--file=<TRM report> is required (one or more), or --refresh-titles / --translate-only');
  const db = databaseFromEnv(process.env);
  const store = createCallsStore(db);
  const refreshTitles = async (ids: string[]) => {
    const portal = await fetchPortalTopics(ids);
    const changed = await store.updateCallsFromSource([...portal.values()].map((t) => ({ callId: t.topicId, title: t.title, deadlines: t.deadlines })));
    console.log(`portal: ${portal.size}/${ids.length} topics found, ${changed} title(s) or deadline(s) updated`);
  };
  const translatePending = async () => {
    const settings = translatorFromEnv(process.env);
    if (!settings) { console.log('translation skipped: ILAAS_API_KEY is not set'); return; }
    const pending = await store.pendingTranslations();
    const texts = [...pending.calls.map((c) => c.text), ...pending.matches.map((m) => m.text)];
    if (!texts.length) { console.log('translation: nothing pending'); return; }
    const fr = await translateTexts(texts, settings);
    const calls = pending.calls.map((c, i) => ({ callId: c.callId, fr: fr[i] }));
    const matches = pending.matches.map((m, i) => ({ pairId: m.pairId, fr: fr[pending.calls.length + i] }));
    await store.saveTranslations(calls, matches);
    console.log(`translation: ${calls.filter((c) => c.fr).length}/${calls.length} summaries, ${matches.filter((m) => m.fr).length}/${matches.length} justifications translated (${settings.model})`);
  };
  if (REFRESH) {
    await refreshTitles(await store.callIds(PROGRAMME, SUBSET));
    return;
  }
  if (TRANSLATE_ONLY) {
    await translatePending();
    return;
  }
  for (const file of FILES) {
    const run = parseTrmReport(readFileSync(file, 'utf8'), PROGRAMME);
    const report = await store.importRun(run, BY, { merge: MERGE, perimeter: PERIMETER });
    const covered = new Set(run.matches.map((m) => m.topicId)).size;
    console.log(`${file}: run ${report.runId} (${report.programmeId} ${report.subset}, model ${run.model || '?'}) — ${report.calls} calls `
      + `(${run.failedTopics.length} failed in the batch), ${report.matches} matches on ${covered} calls`
      + (report.replacedRunId ? `; replaced run ${report.replacedRunId}` : '')
      + (report.mergedIntoRunId ? `; merged into run ${report.mergedIntoRunId}` : ''));
    for (const f of run.failedTopics) console.log(`  failed topic ${f.topicId}: ${f.error}`);
    if (PORTAL) await refreshTitles(run.topics.map((t) => t.topicId));
  }
  if (TRANSLATE) await translatePending();
}

main()
  .then(() => closeDatabases())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabases();
    process.exit(1);
  });
