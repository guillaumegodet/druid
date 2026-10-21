/**
 * Alignment of the identifiers of the research structures (druid-internal docs/plan-druid-saas.md, lot 4 e): reads
 * RNSR, ROR, AureHAL, OpenAlex, IdRef and Wikidata for every lab and team of the directory, and writes candidates for
 * the « Structures » tab of the alignment page (lib/structures). PostgreSQL storage only.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL; OPENALEX_API_KEY or OPENALEX_MAILTO for OpenAlex):
 *   node scripts/.build/align_structures.cjs [--mode=search|verify] [--types=ror,hal_struct] [--only=LS2N,12]
 *                                             [--force] [--limit=20] [--progress=structures_align_progress.json]
 * Run by server.cjs from the page (progress file, « Stop » = SIGTERM, same contract as the people alignments) or by a
 * cron. Outgoing calls go through the proxy of the instance when NODE_USE_ENV_PROXY=1 and HTTPS_PROXY are set.
 */
import fs from 'node:fs';
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { ALIGNED_STRUCTURE_ID_TYPES, isStructureIdType, type StructureIdType } from '../lib/structures/identifiers';
import { runStructureAlignment } from '../lib/structures/alignRun';
import { createRegistryClient } from '../lib/structures/registryClient';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = option('mode') === 'verify' ? 'verify' : 'search';
const typesArg = (option('types') || '').split(',').map((s) => s.trim()).filter(Boolean);
const types: StructureIdType[] = typesArg.length ? typesArg.filter(isStructureIdType) : ALIGNED_STRUCTURE_ID_TYPES;
const only = (option('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const force = args.includes('--force');
const limit = Number(option('limit') || 0);
const progressPath = option('progress') || 'structures_align_progress.json';

let stopRequested = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { console.warn('[align-structures] stop requested: finishing the structures in progress'); stopRequested = true; });

const startedAt = new Date().toISOString();
const writeProgress = (p: Record<string, unknown>) => {
  try { fs.writeFileSync(progressPath, JSON.stringify({ mode, startedAt, ...p })); } catch { /* the progress file is a convenience */ }
};

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the structure alignment needs the PostgreSQL storage');
  const db = databaseFromEnv(process.env);
  const registry = createRegistryClient({
    openalexApiKey: process.env.OPENALEX_API_KEY || null, openalexMailto: process.env.OPENALEX_MAILTO || process.env.OPENALEX_EMAIL || null,
    log: (l) => console.warn(`[align-structures] ${l}`),
  });
  writeProgress({ running: true, total: 0, done: 0 });
  const report = await runStructureAlignment(db, registry, {
    mode, types, only, force, limit,
    log: (l) => console.log(`[align-structures] ${l}`),
    onProgress: (p) => writeProgress({ running: true, ...p }),
    shouldStop: () => stopRequested,
  });
  writeProgress({ running: false, total: report.total, done: report.done, candidates: report.candidates, conflicts: report.conflicts, verificationIssues: report.verificationIssues, errors: report.errors, stopped: report.stopped, finishedAt: new Date().toISOString() });
  console.log(`[align-structures] ${report.done}/${report.total} structure(s): ${report.candidates} candidate(s), ${report.conflicts} conflict(s), ${report.verificationIssues} verification issue(s), ${report.errors} error(s)${report.stopped ? ', stopped' : ''}`);
}

main().catch((err) => {
  console.error(`[align-structures] ${err instanceof Error ? err.message : err}`);
  writeProgress({ running: false, error: err instanceof Error ? err.message : String(err), finishedAt: new Date().toISOString() });
  process.exitCode = 1;
}).finally(() => closeDatabases());
