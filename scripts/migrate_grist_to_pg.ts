/**
 * Import of the Grist directory into PostgreSQL (druid-internal docs/plan-migration-postgresql.md, lot 5): reads the
 * Grist document of the instance (storage client of the jobs), transforms the directory (lib/migration/gristToPg.ts)
 * and the work tables (gristToPgWork.ts), writes the migration report, then loads the rows in ONE transaction
 * (lib/migration/loadPg.ts) as the database owner.
 *
 * DRY-RUN by default: everything is loaded (constraints checked by PostgreSQL) then rolled back. `--apply` commits.
 * Replayable: the imported tables are emptied first. The report (JSON + Markdown) names Grist rows and columns, never
 * a value.
 *
 * Usage (env VITE_GRIST_DOC_ID + GRIST_API_KEY for the source, DATABASE_URL = druid_owner for the target):
 *   npm run migrate:grist-to-pg -- [--apply] [--out=<directory>]
 * druid-test: docker run --rm --network druid-test_druid-test-db --env-file .env.test --env-file .env.test-migrate \
 *   druid-test:latest node scripts/.build/migrate_grist_to_pg.cjs   (see druid-internal docs/procedure-base-postgresql.md)
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createDb } from '../lib/db/client';
import { gristClientFromEnv } from '../lib/directory/jobStorage';
import { mergeReport, reportMarkdown, transformDirectory, type GristDirectoryInput } from '../lib/migration/gristToPg';
import { WORK_TABLES, isArbitrationTable, transformWork, type GristWorkInput } from '../lib/migration/gristToPgWork';
import { loadDirectory, loadWork } from '../lib/migration/loadPg';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OUT = (args.find((a) => a.startsWith('--out=')) || '--out=scripts/.build/grist_to_pg').slice(6);

class DryRun extends Error {}

/** Grist sometimes refuses to open a document for a while (HTTP 500 « workers-lock »): retried with a growing pause. */
const withRetry = async <T>(what: string, fn: () => Promise<T>, attempts = 6): Promise<T> => {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      if (status < 500 || i >= attempts) throw e;
      const wait = 15 * i;
      console.warn(`[grist_to_pg] ${what}: Grist HTTP ${status}, retry ${i}/${attempts - 1} in ${wait} s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (role druid_owner) not configured');
  const grist = gristClientFromEnv(process.env, 'Druid-CRISalid-grist_to_pg/1.0');
  const tableIds = await withRetry('tables', () => grist.tableIds());
  const read = async (t: string) => (tableIds.includes(t) ? withRetry(t, () => grist.records(t)) : null);
  const input: GristDirectoryInput = {
    Annuaire: await read('Annuaire'), Structures: await read('Structures'),
    Etablissements: await read('Etablissements'), Corps_Categorie: await read('Corps_Categorie'),
  };
  const directory = transformDirectory(input);
  const workInput = Object.fromEntries(await Promise.all(WORK_TABLES.map(async (t) => [t, await read(t)]))) as GristWorkInput;
  workInput.arbitrations = Object.fromEntries(await Promise.all(tableIds.filter(isArbitrationTable).map(async (t) => [t, (await read(t)) || []])));
  const work = transformWork(workInput, directory.rows);
  const report = mergeReport(directory.report, {
    issues: work.issues, source: work.source,
    counts: Object.fromEntries(Object.entries(work.rows).map(([t, r]) => [t, r.length])),
  });

  mkdirSync(OUT, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  writeFileSync(join(OUT, `report-${stamp}.json`), JSON.stringify(report, null, 1));
  writeFileSync(join(OUT, `report-${stamp}.md`), reportMarkdown(report));
  console.log(`[grist_to_pg] ${APPLY ? 'APPLY' : 'DRY-RUN'} · source ${JSON.stringify(report.source)}`);
  console.log(`[grist_to_pg] rows ${JSON.stringify(report.counts)}`);
  console.log(`[grist_to_pg] cases ${JSON.stringify(report.summary)}`);
  console.log(`[grist_to_pg] report: ${join(OUT, `report-${stamp}.md`)}`);

  const db = createDb({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const counts = await db.transaction().execute(async (trx) => {
      const loaded = { ...await loadDirectory(trx, directory.rows, report), ...await loadWork(trx, work.rows) };
      console.log(`[grist_to_pg] loaded ${JSON.stringify(loaded)}`);
      if (!APPLY) throw new DryRun();
      return loaded;
    });
    console.log(`[grist_to_pg] committed (${counts.person} people).`);
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
    console.log('[grist_to_pg] dry-run: rolled back — rerun with --apply to commit.');
  } finally {
    await db.destroy();
  }
}

main().catch((e) => { console.error('[grist_to_pg] ✗', e); process.exit(1); });
