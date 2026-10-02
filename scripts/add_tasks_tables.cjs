#!/usr/bin/env node
/**
 * add_tasks_tables.cjs — provisions the `Taches` and `Taches_evenements` tables
 * (« À traiter › Tâches », docs/plan-chantiers-taches.md, lot 1). Schema in
 * scripts/lib/tasks_schema.cjs (shared with server.cjs, which also creates the
 * tables on first use).
 *
 * Idempotent: only creates the missing tables. DRY-RUN by default; pass
 * `--apply` to actually write.
 *
 * Env: GRIST_API_URL (default https://grist.numerique.gouv.fr/api), GRIST_DOC_ID
 * (default VITE_GRIST_DOC_ID), GRIST_API_KEY (fallback VITE_GRIST_API_KEY).
 *
 * Usage:
 *   node scripts/add_tasks_tables.cjs            # dry-run
 *   node scripts/add_tasks_tables.cjs --apply    # creates the tables
 */
'use strict';

try { require('dotenv').config(); } catch { /* dotenv optional */ }

const schema = require('./lib/tasks_schema.cjs');

const API_URL = process.env.GRIST_API_URL || 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.GRIST_DOC_ID || process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY;
const APPLY = process.argv.includes('--apply');

async function main() {
  if (!DOC || !KEY) {
    console.error('✗ GRIST_DOC_ID and GRIST_API_KEY required (or VITE_GRIST_*). Aborting.');
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  console.log(`Grist : ${API_URL} · doc ${DOC} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const resp = await fetch(`${API_URL}/docs/${DOC}/tables`, { headers });
  if (!resp.ok) {
    console.error(`✗ Failed to read the tables: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const have = new Set((await resp.json()).tables.map((t) => t.id));
  const missing = [[schema.TASKS_TABLE, schema.TASKS_COLUMNS], [schema.EVENTS_TABLE, schema.EVENTS_COLUMNS]]
    .filter(([id]) => !have.has(id));
  if (missing.length === 0) {
    console.log(`✓ Tables ${schema.TASKS_TABLE} and ${schema.EVENTS_TABLE} already exist — nothing to do.`);
    return;
  }
  for (const [id, cols] of missing) console.log(`${APPLY ? '+' : '(dry-run) +'} table ${id} (${cols.length} columns)`);
  if (!APPLY) { console.log('Rerun with --apply to create the tables.'); return; }
  await schema.ensureTasksTables({ apiBase: API_URL, doc: DOC, headers, log: console.log });
}

main().catch((e) => { console.error('✗ Unexpected error:', e); process.exit(1); });
