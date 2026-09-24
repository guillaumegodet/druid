#!/usr/bin/env node
/**
 * migrate_review_tables.cjs — brings the existing review tables up to the definitions in the code
 * (docs/archive/plan-alignement-openalex.md, § 8 « identités mêlées », lot 7a):
 *   - `Decision`: adds the « Identité mêlée » value (and its color) to the existing choices;
 *   - `Note`, `Signale_le` columns and `Meler_action` button if absent.
 * The tables are created by the scripts / the front end with these columns; this script is only for
 * those created before 2026-09-11. Idempotent. DRY-RUN by default; `--apply` to write.
 * Env: VITE_GRIST_DOC_ID, GRIST_API_KEY.
 */
'use strict';
const common = require('./lib/align_common.cjs');

const TABLES = ['Alignement_IdRef', 'Alignement_ORCID', 'Alignement_HAL', 'Alignement_OpenAlex'];
const APPLY = common.hasFlag('apply');

async function migrate(table) {
  let columns;
  try { ({ columns } = await common.gristGet(`/docs/${common.DOC}/tables/${table}/columns`)); }
  catch (e) { console.log(`· ${table}: missing (created on the first run) — nothing to do`); return; }
  const byId = new Map(columns.map((c) => [c.id, c]));
  const wanted = common.reviewDecisionColumns(table);
  const toAdd = wanted.filter((c) => c.id !== 'Decision' && !byId.has(c.id));
  let decisionPatch = null;
  const dec = byId.get('Decision');
  if (dec) {
    let opts = {};
    try { opts = JSON.parse(dec.fields.widgetOptions || '{}'); } catch (e) { /* noop */ }
    const choices = Array.isArray(opts.choices) ? opts.choices : [];
    if (!choices.includes(common.DECISION_MIXED)) {
      decisionPatch = { id: 'Decision', fields: { widgetOptions: JSON.stringify({ ...opts, choices: [...choices, common.DECISION_MIXED], choiceOptions: { ...(opts.choiceOptions || {}), ...common.DECISION_CHOICE_OPTIONS } }) } };
    }
  }
  console.log(`· ${table}: ${decisionPatch ? 'add the « Identité mêlée » choice' : 'Decision choices up to date'}; missing columns: ${toAdd.map((c) => c.id).join(', ') || 'none'}`);
  if (!APPLY || (!decisionPatch && !toAdd.length)) return;
  if (decisionPatch) await common.gristWrite('PATCH', `/docs/${common.DOC}/tables/${table}/columns`, { columns: [decisionPatch] });
  if (toAdd.length) await common.gristWrite('POST', `/docs/${common.DOC}/tables/${table}/columns`, { columns: toAdd });
  console.log(`  ✓ ${table} migrated`);
}

async function main() {
  console.log(`Grist : doc ${common.DOC} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  for (const t of TABLES) await migrate(t);
  if (!APPLY) console.log('\n(DRY-RUN) Rerun with --apply to write.');
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
