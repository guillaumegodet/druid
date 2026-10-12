/**
 * Import of the news items of the newsletter from the instance's Grist document (table `Newsletter`) into PostgreSQL
 * (`newsletter_item`), lot 14 a of druid-internal docs/plan-migration-postgresql.md. The items get new ids: no id of a
 * news item is kept anywhere (the Newsletter panel reloads its list), and the application role may not move the
 * sequence. Idempotent: an item already in the table (same structure and OpenAlex work) is left as it is.
 *
 * DRY-RUN by default (plan and report only), `--apply` writes, in one transaction signed `import:newsletter`. Refused
 * unless the instance runs on PostgreSQL. The report (JSON + Markdown) gives counts by structure and status and the
 * Grist ids of the rows set aside, never a text.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL, VITE_GRIST_DOC_ID, GRIST_API_KEY[, GRIST_API_BASE]):
 *   node scripts/.build/import_newsletter.cjs [--apply] [--out=<directory>]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { withActor } from '../lib/db/client';
import { closeDatabases, databaseFromEnv, gristClientFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { planNewsletterImport } from '../lib/publications/newsletterImport';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OUT = (args.find((a) => a.startsWith('--out=')) || '--out=scripts/.build/newsletter_import').slice(6);

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the news items stay in Grist');
  const grist = gristClientFromEnv(process.env, 'Druid-CRISalid-newsletter_import/1.0');
  const tables = await grist.tableIds();
  const records = tables.includes('Newsletter') ? await grist.records('Newsletter') : [];
  const db = databaseFromEnv(process.env);
  const present = await db.selectFrom('newsletter_item').select(['slug', 'work_id']).execute();
  const plan = planNewsletterImport(records, present);

  if (APPLY && plan.rows.length) {
    await withActor(db, 'import:newsletter', async (trx) => {
      for (let i = 0; i < plan.rows.length; i += 200) {
        await trx.insertInto('newsletter_item').values(plan.rows.slice(i, i + 200)).execute();
      }
    });
  }

  const doc = {
    generatedAt: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', gristTable: tables.includes('Newsletter'),
    gristRows: records.length, alreadyPresent: plan.alreadyPresent, toImport: plan.rows.length,
    byStructure: plan.byStructure, byStatus: plan.byStatus, setAside: plan.setAside,
  };
  console.log(`[newsletter_import] ${doc.mode}: ${records.length} Grist rows, ${plan.rows.length} to import, `
    + `${plan.alreadyPresent} already present, ${plan.setAside.length} set aside`);
  mkdirSync(OUT, { recursive: true });
  const stamp = doc.generatedAt.replace(/[:.]/g, '-');
  writeFileSync(join(OUT, `newsletter-import-${stamp}.json`), JSON.stringify(doc, null, 1));
  const lines = (o: Record<string, number>) => Object.entries(o).map(([k, n]) => `- ${k} : ${n}`);
  writeFileSync(join(OUT, `newsletter-import-${stamp}.md`), [
    `# Import des brèves — ${doc.generatedAt} (${doc.mode})`, '',
    `Table Grist \`Newsletter\` : ${doc.gristTable ? `${records.length} lignes` : 'absente'} ; à importer ${plan.rows.length}, déjà présentes ${plan.alreadyPresent}.`, '',
    '## Par structure', '', ...lines(plan.byStructure), '',
    '## Par statut', '', ...lines(plan.byStatus), '',
    `## Mises de côté (${plan.setAside.length})`, '', ...(plan.setAside.length ? plan.setAside.map((s) => `- ligne Grist ${s.id} : ${s.reason}`) : ['—']), '',
  ].join('\n'));
  console.log(`[newsletter_import] report: ${OUT}/newsletter-import-${stamp}.{json,md}`);
  await closeDatabases();
}

main().catch(async (e) => {
  console.error('[newsletter_import] ✗', e);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
