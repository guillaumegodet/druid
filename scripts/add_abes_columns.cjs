#!/usr/bin/env node
/**
 * add_abes_columns.cjs — provisions in the `Annuaire` table the tracking columns of the
 * ABES export / IdRef enrichment (docs/plan-export-abes-idref.md, lot 3):
 *   - ABES_export_hash: fingerprint of the actions proposed in the last submission (lib/abesExport.rowHash);
 *     an identical row is not sent again until ABES has integrated it;
 *   - ABES_export_date: date (YYYY-MM-DD) of the last submission marked from Druid.
 *
 * Idempotent: only adds the missing columns. DRY-RUN by default; `--apply` to write.
 * Env: VITE_GRIST_DOC_ID, GRIST_API_KEY. Modeled on add_align_columns.cjs.
 *
 * Usage:
 *   node scripts/add_abes_columns.cjs            # dry-run
 *   node scripts/add_abes_columns.cjs --apply    # creates the missing columns
 */
'use strict';
const common = require('./lib/align_common.cjs');

const TABLE = 'Annuaire';
const APPLY = common.hasFlag('apply');

const COLUMNS = [
  { id: 'ABES_export_hash', label: 'ABES export (empreinte)', type: 'Text' },
  { id: 'ABES_export_date', label: 'ABES export (date)', type: 'Text' },
];

async function main() {
  console.log(`Grist : doc ${common.DOC} · table ${TABLE} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const { columns } = await common.gristGet(`/docs/${common.DOC}/tables/${TABLE}/columns`);
  const existing = new Set(columns.map((c) => c.id));
  const missing = COLUMNS.filter((c) => !existing.has(c.id));
  if (!missing.length) { console.log('✓ The ABES columns already exist. Nothing to do.'); return; }
  console.log(`Colonnes manquantes : ${missing.map((c) => c.id).join(', ')}`);
  if (!APPLY) { console.log('\n(DRY-RUN) Rerun with --apply to create these columns.'); return; }
  await common.gristWrite('POST', `/docs/${common.DOC}/tables/${TABLE}/columns`, {
    columns: missing.map((c) => ({ id: c.id, fields: { label: c.label, type: c.type } })),
  });
  console.log(`✓ ${missing.length} column(s) created in ${TABLE}.`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
