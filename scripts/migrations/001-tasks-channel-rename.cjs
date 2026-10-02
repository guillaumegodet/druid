#!/usr/bin/env node
/**
 * Migration 001 — renames a channel value of the « À traiter › Tâches » table (Grist `Taches`, column
 * `canal`): the authorities correspondent channel is now `correspondant_idref` (CHANGELOG, rubric
 * Migration). Run at the deployment of the version that brings the new value.
 *
 * The old value is given on the command line (it was a person's name and must not appear in this
 * public repository). The script:
 *  - sets `canal` to the new value on every row that carries the old one;
 *  - removes from the column's choices every value this Druid no longer knows (CANALS of
 *    scripts/lib/tasks_schema.cjs) and that no row uses any more, and adds the missing ones.
 * Idempotent; DRY-RUN by default, `--apply` to write.
 *
 * Env: GRIST_API_URL (default https://grist.numerique.gouv.fr/api), GRIST_DOC_ID (default
 * VITE_GRIST_DOC_ID), GRIST_API_KEY.
 *
 * Usage (Nantes):
 *   docker exec crisalid-druid-1 node scripts/migrations/001-tasks-channel-rename.cjs --from=<old value>
 *   docker exec crisalid-druid-1 node scripts/migrations/001-tasks-channel-rename.cjs --from=<old value> --apply
 */
'use strict';

const { TASKS_TABLE, CANALS } = require('../lib/tasks_schema.cjs');

const TO = 'correspondant_idref';
const API_URL = process.env.GRIST_API_URL || 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.GRIST_DOC_ID || process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY;
const APPLY = process.argv.includes('--apply');
const FROM = (process.argv.find((a) => a.startsWith('--from=')) || '').slice('--from='.length).trim();

/** Rows to rewrite and new choice list of the column. Pure: `records` = /records, `widgetOptions` =
 *  the current options of the `canal` column. */
function planMigration(records, widgetOptions, from, to = TO, known = CANALS) {
  const updates = records
    .filter((r) => from && r.fields.canal === from)
    .map((r) => ({ id: r.id, fields: { canal: to } }));
  const moved = new Set(updates.map((u) => u.id));
  const used = new Set(records.map((r) => (moved.has(r.id) ? to : r.fields.canal)).filter(Boolean));
  let opts = {};
  try { opts = JSON.parse(widgetOptions || '{}') || {}; } catch { /* unreadable ⇒ rebuilt */ }
  const have = Array.isArray(opts.choices) ? opts.choices : [];
  const choices = [...have.filter((c) => known.includes(c) || used.has(c)), ...known.filter((c) => !have.includes(c))];
  const choicesChanged = JSON.stringify(choices) !== JSON.stringify(have);
  return { updates, choices, choicesChanged, widgetOptions: JSON.stringify({ ...opts, choices }) };
}

module.exports = { planMigration };

async function main() {
  if (!DOC || !KEY) throw new Error('GRIST_DOC_ID (or VITE_GRIST_DOC_ID) and GRIST_API_KEY required');
  if (!FROM) throw new Error('--from=<old value> required');
  if (FROM === TO) throw new Error('--from is already the new value');
  const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const base = `${API_URL}/docs/${DOC}/tables/${TASKS_TABLE}`;
  const get = async (url) => {
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} on ${url.replace(API_URL, '')}`);
    return resp.json();
  };
  const { records } = await get(`${base}/records`);
  const column = (await get(`${base}/columns`)).columns.find((c) => c.id === 'canal');
  if (!column) throw new Error(`no canal column in ${TASKS_TABLE}`);

  const plan = planMigration(records, column.fields.widgetOptions, FROM);
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} · ${records.length} task(s) · ${plan.updates.length} to move to « ${TO} »`
    + ` · choices ${plan.choicesChanged ? `→ ${plan.choices.join(', ')}` : 'unchanged'}`);
  if (!APPLY) { console.log('Rerun with --apply to write.'); return; }

  // Rows first: the old choice is only removed once no row uses it.
  for (let i = 0; i < plan.updates.length; i += 100) {
    const resp = await fetch(`${base}/records`, { method: 'PATCH', headers, body: JSON.stringify({ records: plan.updates.slice(i, i + 100) }) });
    if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} while updating rows: ${await resp.text()}`);
  }
  if (plan.choicesChanged) {
    const resp = await fetch(`${base}/columns`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ columns: [{ id: 'canal', fields: { widgetOptions: plan.widgetOptions } }] }),
    });
    if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} while updating the choices: ${await resp.text()}`);
  }
  console.log(`Done: ${plan.updates.length} row(s) updated${plan.choicesChanged ? ', choices updated' : ''}.`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`Migration 001 failed: ${e.message}`); process.exit(1); });
}
