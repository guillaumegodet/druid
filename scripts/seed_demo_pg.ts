/**
 * Seed of a fictitious instance into its PostgreSQL database (druid-internal docs/plan-migration-postgresql.md,
 * lot 10 b): the rows of instances/<slug>/demo-data.mjs go through the same transformation and load as a Grist
 * document (lib/migration), in ONE transaction as the database owner. Replayable: the directory and work tables are
 * emptied first, which is the point — the demo is reloaded at each deployment (scripts/seed_demo_on_pages.cjs).
 * The public demo also gets the fictitious calls for proposals, theses and eligibility of lib/migration/demoExtras.ts
 * (its co-authorship network, instances/demo/dashboard-data/network.json, names the publications the matching cites).
 *
 * DRY-RUN by default (loaded, checked by PostgreSQL, rolled back); `--apply` commits.
 *
 * Usage (DATABASE_URL = druid_owner of the target, migrated with dbmate):
 *   npm run seed:demo -- [--instance demo|demo-2] [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createDb } from '../lib/db/client';
import { demoExtras, type DemoNetwork, type DemoResearcherRow } from '../lib/migration/demoExtras';
import { demoDirectoryInput, emptyWorkInput, type DemoData } from '../lib/migration/demoSeed';
import { loadDemoExtras } from '../lib/migration/loadDemoExtras';
import { mergeReport, transformDirectory } from '../lib/migration/gristToPg';
import { transformWork } from '../lib/migration/gristToPgWork';
import { loadDirectory, loadWork } from '../lib/migration/loadPg';

// Static paths: the bundler (esbuild) ships both data files; the fictitious instances are the ones of this repository.
const DATA: Record<string, () => Promise<DemoData>> = {
  demo: () => import('../instances/demo/demo-data.mjs') as Promise<DemoData>,
  'demo-2': () => import('../instances/demo-2/demo-data.mjs') as Promise<DemoData>,
};
// Instances whose calls for proposals, theses and eligibility are seeded too (their labs are the targets of the calls).
const WITH_EXTRAS = new Set(['demo']);

/** network.json of the instance (publications cited by the matching), null when it ships none. */
const readNetwork = (slug: string): DemoNetwork | null => {
  for (const root of [process.cwd(), path.join(__dirname, '..', '..')]) {
    const file = path.join(root, 'instances', slug, 'dashboard-data', 'network.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as DemoNetwork;
  }
  return null;
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const at = args.indexOf('--instance');
const INSTANCE = at >= 0 ? String(args[at + 1] || '') : 'demo';

class DryRun extends Error {}

async function main() {
  const load = DATA[INSTANCE];
  if (!load) throw new Error(`--instance must be one of: ${Object.keys(DATA).join(', ')}`);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (role druid_owner) not configured');

  const data = await load();
  const directory = transformDirectory(demoDirectoryInput(data));
  const extras = WITH_EXTRAS.has(INSTANCE)
    ? demoExtras(data.buildResearchers() as unknown as DemoResearcherRow[], readNetwork(INSTANCE), new Date().toISOString().slice(0, 10))
    : null;
  const work = transformWork(emptyWorkInput(), directory.rows);
  const report = mergeReport(directory.report, {
    issues: work.issues, source: work.source,
    counts: Object.fromEntries(Object.entries(work.rows).map(([t, r]) => [t, r.length])),
  });
  // Only the missing tables are expected (no Corps_Categorie, no work table in a data file): anything else is a bug.
  const unexpected = report.issues.filter((i) => i.code !== 'table_missing');
  console.log(`[seed_demo] ${APPLY ? 'APPLY' : 'DRY-RUN'} · instance ${INSTANCE} · rows ${JSON.stringify(report.counts)}`);
  if (unexpected.length) {
    console.error(`[seed_demo] ✗ import issues in the data file: ${JSON.stringify(unexpected.slice(0, 5))}`);
    process.exit(1);
  }

  const db = createDb({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const counts = await db.transaction().execute(async (trx) => {
      const loaded = {
        ...await loadDirectory(trx, directory.rows, report),
        ...await loadWork(trx, work.rows),
        ...(extras ? await loadDemoExtras(trx, extras) : {}),
      };
      console.log(`[seed_demo] loaded ${JSON.stringify(loaded)}`);
      if (!APPLY) throw new DryRun();
      return loaded;
    });
    console.log(`[seed_demo] committed (${counts.person} people, ${counts.structure} structures).`);
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
    console.log('[seed_demo] dry-run: rolled back — rerun with --apply to commit.');
  } finally {
    await db.destroy();
  }
}

main().catch((e) => { console.error('[seed_demo] ✗', e); process.exit(1); });
