#!/usr/bin/env node
/**
 * add_fte_columns.cjs — provisions in the `Annuaire` table the two FTE columns of the record
 * (lot 1 of the research FTE plan; lib/fte.ts):
 *   - etp_quotite: overall FTE (« quotité agent »), Numeric 0-1;
 *   - etp_recherche: research FTE, Numeric 0-1 (0 = no research time).
 *
 * Empty ≠ 0: Grist fills a Numeric cell with 0, on the existing rows when the column is created and
 * on every new row afterwards. The columns therefore get the trigger formula `None` applied to new
 * records only (recalcWhen 0, no dependency), and the existing rows of a newly created column are
 * reset to null. Columns that already exist only get the trigger formula, their values are untouched.
 *
 * Idempotent. DRY-RUN by default; `--apply` to write.
 * Env: VITE_GRIST_DOC_ID, GRIST_API_KEY (fallback VITE_GRIST_API_KEY). Modeled on add_align_columns.cjs.
 *
 * Usage:
 *   node scripts/add_fte_columns.cjs            # dry-run
 *   node scripts/add_fte_columns.cjs --apply    # creates / fixes the columns
 */
'use strict';
const common = require('./lib/align_common.cjs');

const TABLE = 'Annuaire';
const APPLY = common.hasFlag('apply');
const BATCH = 500;

const COLUMNS = [
  { id: 'etp_quotite',   label: 'ETP (quotité agent)' },
  { id: 'etp_recherche', label: 'ETP recherche' },
];
/** New rows get null (trigger formula on new records only), not the Numeric default 0. */
const TRIGGER = { formula: 'None', isFormula: false, recalcWhen: 0 };

async function main() {
  console.log(`Grist : doc ${common.DOC} · table ${TABLE} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const columns = await common.gristColumns(TABLE);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const missing = COLUMNS.filter((c) => !byId.has(c.id));
  const noTrigger = COLUMNS.filter((c) => byId.has(c.id) && String(byId.get(c.id).fields.formula || '') !== 'None');
  if (!missing.length && !noTrigger.length) { console.log('✓ Both FTE columns exist with their trigger formula. Nothing to do.'); return; }
  if (missing.length) console.log(`Colonnes manquantes : ${missing.map((c) => c.id).join(', ')}`);
  if (noTrigger.length) console.log(`Formule « nouvelles lignes = vide » à poser : ${noTrigger.map((c) => c.id).join(', ')}`);
  if (!APPLY) { console.log('\n(DRY-RUN) Rerun with --apply.'); return; }

  if (missing.length) {
    await common.gristAddColumns(TABLE,
      missing.map((c) => ({ id: c.id, fields: { label: c.label, type: 'Numeric', ...TRIGGER } })),
    );
    // The rows existing at creation time got the Numeric default 0: reset them to « not provided ».
    const records = await common.gristRecords(TABLE);
    const empty = Object.fromEntries(missing.map((c) => [c.id, null]));
    for (let i = 0; i < records.length; i += BATCH) {
      await common.gristPatchRecords(TABLE, records.slice(i, i + BATCH).map((r) => ({ id: r.id, fields: empty })));
    }
    console.log(`✓ ${missing.length} column(s) created, ${records.length} row(s) set to empty.`);
  }
  if (noTrigger.length) {
    await common.gristUpdateColumns(TABLE, noTrigger.map((c) => ({ id: c.id, fields: TRIGGER })));
    console.log(`✓ Trigger formula set on ${noTrigger.map((c) => c.id).join(', ')} (values untouched).`);
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
