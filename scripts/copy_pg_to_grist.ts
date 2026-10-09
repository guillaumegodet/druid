/**
 * Nightly copy of the PostgreSQL directory into the instance's Grist document (druid-internal
 * docs/plan-migration-postgresql.md, lot 8 e): Etablissements, Structures, Annuaire, row by row with the same ids, so
 * that the managers' work tables and their `Ref` columns keep pointing at the right rows (D4). Also the way back to
 * Grist after the switch (lot 7): the document then reads as the database.
 *
 * DRY-RUN by default (plan and report only), `--apply` writes. Refused unless the instance runs on PostgreSQL
 * (DRUID_STORAGE=postgres): on Grist the source would be the document itself. A table whose copy would remove more
 * than 5 % of its rows (at least 50) is skipped unless `--force`: an empty or half-loaded database must never empty
 * the document. Formula columns are never written. The report (JSON + Markdown) names tables, row ids and columns,
 * never a value.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL, VITE_GRIST_DOC_ID, GRIST_API_KEY[, GRIST_API_BASE]):
 *   node scripts/.build/copy_pg_to_grist.cjs [--apply] [--force] [--out=<directory>] [--tables=Annuaire,Structures]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { closeDatabases, databaseFromEnv, gristClientFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { createPgTableClient } from '../lib/directory/pg/tableClient';
import { COPIED_TABLES, copyActions, massRemoval, planTableCopy, type TableCopyPlan } from '../lib/directory/pg/gristCopy';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const OUT = (args.find((a) => a.startsWith('--out=')) || '--out=scripts/.build/pg_to_grist').slice(6);
const ONLY = (args.find((a) => a.startsWith('--tables=')) || '').slice(9).split(',').filter(Boolean);

/** POST /apply on the document (user actions: BulkAddRecord takes explicit row ids, the REST /records does not). */
const applyActions = async (actions: unknown[][]) => {
  const base = (process.env.GRIST_API_BASE || 'https://grist.numerique.gouv.fr/api').replace(/\/+$/, '');
  const url = `${base}/docs/${encodeURIComponent(process.env.VITE_GRIST_DOC_ID || '')}/apply`;
  for (const action of actions) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GRIST_API_KEY || ''}`, 'Content-Type': 'application/json', 'User-Agent': 'Druid-CRISalid-pg_to_grist/1.0' },
      body: JSON.stringify([action]),
    });
    if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} on ${String(action[0])} ${String(action[1])}: ${(await resp.text()).slice(0, 300)}`);
  }
};

const summaryOf = (p: TableCopyPlan, skipped: boolean) => ({
  table: p.table, source: p.sourceRows, document: p.targetRows, adds: p.adds.length, updates: p.updates.length,
  removes: p.removes.length, skipped, changedColumns: p.changedColumns, missingColumns: p.missingColumns,
  addedIds: p.adds.slice(0, 50).map((a) => a.id), removedIds: p.removes.slice(0, 50),
});

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the directory is in the Grist document, nothing to copy');
  const db = databaseFromEnv(process.env);
  const source = createPgTableClient({ db, actor: 'job:pg_to_grist' });
  const grist = gristClientFromEnv(process.env, 'Druid-CRISalid-pg_to_grist/1.0');
  const tables = COPIED_TABLES.filter((t) => !ONLY.length || ONLY.includes(t));
  const report: Record<string, unknown>[] = [];
  let refused = 0;
  for (const table of tables) {
    const [rows, current, columns] = await Promise.all([source.records(table), grist.records(table), grist.columns(table)]);
    const plan = planTableCopy(table, rows, current, columns);
    const skip = massRemoval(plan) && !FORCE;
    if (skip) refused++;
    report.push(summaryOf(plan, skip));
    console.log(`[pg_to_grist] ${table}: ${plan.sourceRows} in PostgreSQL, ${plan.targetRows} in Grist → +${plan.adds.length} ~${plan.updates.length} -${plan.removes.length}`
      + (skip ? ` SKIPPED (would remove ${plan.removes.length} rows: --force to allow)` : ''));
    if (plan.missingColumns.length) console.log(`[pg_to_grist] ${table}: not in the document: ${plan.missingColumns.join(', ')}`);
    if (APPLY && !skip) {
      await applyActions(copyActions(plan));
      console.log(`[pg_to_grist] ${table}: written`);
    }
  }
  mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const doc = { generatedAt: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', document: process.env.VITE_GRIST_DOC_ID?.slice(0, 4), tables: report };
  writeFileSync(join(OUT, `copy-${stamp}.json`), JSON.stringify(doc, null, 1));
  writeFileSync(join(OUT, `copy-${stamp}.md`), [
    `# Copie PostgreSQL → Grist — ${doc.generatedAt} (${doc.mode})`, '',
    '| Table | PostgreSQL | Grist | Ajouts | Mises à jour | Suppressions | Ignorée |', '|---|---:|---:|---:|---:|---:|---|',
    ...report.map((r: any) => `| ${r.table} | ${r.source} | ${r.document} | ${r.adds} | ${r.updates} | ${r.removes} | ${r.skipped ? 'oui (suppression massive)' : ''} |`),
    '', ...report.flatMap((r: any) => [`## ${r.table}`, '', `Colonnes modifiées : ${JSON.stringify(r.changedColumns)}`, '',
      `Absentes du document : ${r.missingColumns.join(', ') || '—'}`, '', `Lignes ajoutées (50 premières) : ${r.addedIds.join(', ') || '—'}`, '',
      `Lignes supprimées (50 premières) : ${r.removedIds.join(', ') || '—'}`, '']),
  ].join('\n'));
  console.log(`[pg_to_grist] report: ${join(OUT, `copy-${stamp}.md`)}`);
  await closeDatabases();
  if (refused) process.exitCode = 2;
}

main().catch(async (e) => {
  console.error('[pg_to_grist] ✗', e);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
