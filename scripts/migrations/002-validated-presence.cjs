#!/usr/bin/env node
/**
 * Migration 002 — `validated_status` holds the presence (release 1.6.0, decisions D4 / D5 of the status
 * rework): INTERNE and EXTERNE become PRESENT (DEPART / PARTI unchanged; validation date, source and author
 * kept), and every record validated EXTERNE without an employer gets an « employer to enter » task — once
 * the value is PRESENT, the « not the institution » information only survives through the employer.
 *
 * Run AFTER the deployment of 1.6.0: an older Druid reads PRESENT as « no validated status ».
 * Idempotent (rows already PRESENT are skipped, a task is not created twice); DRY-RUN by default,
 * `--apply` to write, after a JSON backup of the rewritten cells (`--backup=<file>`, default in /tmp).
 *
 * Env: GRIST_API_URL (default https://grist.numerique.gouv.fr/api), GRIST_DOC_ID (default
 * VITE_GRIST_DOC_ID), GRIST_API_KEY.
 *
 * Usage (Nantes):
 *   docker exec crisalid-druid-1 node scripts/migrations/002-validated-presence.cjs
 *   docker exec crisalid-druid-1 node scripts/migrations/002-validated-presence.cjs --apply
 */
'use strict';

const fs = require('fs');
const schema = require('../lib/tasks_schema.cjs');

const API_URL = process.env.GRIST_API_URL || 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.GRIST_DOC_ID || process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY;
const APPLY = process.argv.includes('--apply');
const BACKUP = (process.argv.find((a) => a.startsWith('--backup=')) || '').slice('--backup='.length)
  || `/tmp/validated_status_backup_${new Date().toISOString().slice(0, 10)}.json`;
const ORIGINE = 'migration:002-validated-presence';
const TASK_TYPE = 'annuaire_employeur_a_renseigner';

const isValidated = (v) => v === true || v === 1 || v === 'true' || v === 'OUI' || v === 'oui' || v === 'yes';
const day = (v) => (typeof v === 'number' && v ? new Date(v * 1000).toISOString().slice(0, 10) : String(v || ''));

/**
 * Pure: `records` = Annuaire /records, `employers` = { rowId: label } of Etablissements, `alreadyTasked` =
 * Annuaire row ids that already have this migration's task. Returns the cell updates and the tasks to create.
 */
function planPresenceMigration(records, employers, alreadyTasked = new Set()) {
  const updates = [];
  const tasks = [];
  for (const r of records) {
    const f = r.fields;
    if (!isValidated(f.validated)) continue;
    const vs = String(f.validated_status || '').trim().toUpperCase();
    if (vs !== 'INTERNE' && vs !== 'EXTERNE') continue;
    updates.push({ id: r.id, fields: { validated_status: 'PRESENT' }, before: f.validated_status });
    const employer = f.Employeur ? String(employers[f.Employeur] || '') : '';
    if (vs === 'EXTERNE' && (!employer || /^non renseign/i.test(employer)) && !alreadyTasked.has(r.id)) {
      tasks.push({
        type: TASK_TYPE, chercheurRowId: r.id, uid_dyna: f.uid_dyna || '',
        nom: `${String(f.Nom || '').toUpperCase()} ${f.Prenom || ''}`.trim(), labo: f.LABO || '',
        description: `Fiche validée « EXTERNE » (${f.validation_source || 'source inconnue'}, ${day(f.validation_date) || 'date inconnue'}) sans employeur. `
          + 'Depuis la version 1.6.0, la validation porte la présence seulement : renseigner l’employeur (CNRS, Inserm, CHU, '
          + 'autre université…) pour garder l’information « pas l’établissement ».',
      });
    }
  }
  return { updates, tasks };
}

async function main() {
  if (!DOC || !KEY) throw new Error('GRIST_DOC_ID (or VITE_GRIST_DOC_ID) and GRIST_API_KEY required');
  const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const call = async (method, path, body) => {
    const r = await fetch(`${API_URL}/docs/${DOC}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.json();
  };
  const employers = Object.fromEntries((await call('GET', 'tables/Etablissements/records')).records.map((r) => [r.id, r.fields.Employeur || '']));
  const records = (await call('GET', 'tables/Annuaire/records')).records;
  let existing = [];
  try { existing = (await call('GET', `tables/${schema.TASKS_TABLE}/records`)).records; } catch (e) { if (APPLY) throw e; }
  const alreadyTasked = new Set(existing.filter((t) => t.fields.origine === ORIGINE).map((t) => t.fields.chercheur));
  const { updates, tasks } = planPresenceMigration(records, employers, alreadyTasked);
  console.log(`[002] ${APPLY ? 'APPLY' : 'DRY-RUN'} · validated_status → PRESENT: ${updates.length} · « employer to enter » tasks: ${tasks.length}`);
  if (!APPLY) return;

  fs.writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(updates.map((u) => [u.id, { validated_status: u.before }]))));
  console.log(`[002] backup: ${BACKUP}`);
  for (let i = 0; i < updates.length; i += 100) {
    await call('PATCH', 'tables/Annuaire/records', { records: updates.slice(i, i + 100).map(({ id, fields }) => ({ id, fields })) });
  }
  if (tasks.length) {
    await schema.ensureTasksTables({ apiBase: API_URL, doc: DOC, headers });
    const rows = tasks.map((t) => ({ fields: schema.normalizeCreate(t, { author: 'druid:migration', origine: ORIGINE }) }));
    for (let i = 0; i < rows.length; i += 100) await call('POST', `tables/${schema.TASKS_TABLE}/records`, { records: rows.slice(i, i + 100) });
  }
  console.log(`[002] written: ${updates.length} cells, ${tasks.length} tasks`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { planPresenceMigration };
