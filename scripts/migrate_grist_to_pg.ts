/**
 * Import of the Grist directory into PostgreSQL (druid-internal docs/plan-migration-postgresql.md, lot 5): reads the
 * Grist document of the instance (storage client of the jobs), transforms it (lib/migration/gristToPg.ts), writes the
 * migration report, then loads the rows in ONE transaction (lib/migration/loadPg.ts) as the database owner.
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
import { reportMarkdown, transformDirectory, type GristDirectoryInput } from '../lib/migration/gristToPg';
import { loadDirectory } from '../lib/migration/loadPg';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OUT = (args.find((a) => a.startsWith('--out=')) || '--out=scripts/.build/grist_to_pg').slice(6);

class DryRun extends Error {}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (role druid_owner) not configured');
  const grist = gristClientFromEnv(process.env, 'Druid-CRISalid-grist_to_pg/1.0');
  const tableIds = await grist.tableIds();
  const read = async (t: string) => (tableIds.includes(t) ? grist.records(t) : null);
  const input: GristDirectoryInput = {
    Annuaire: await read('Annuaire'), Structures: await read('Structures'),
    Etablissements: await read('Etablissements'), Corps_Categorie: await read('Corps_Categorie'),
  };
  const { rows, report } = transformDirectory(input);

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
      const loaded = await loadDirectory(trx, rows, report);
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
