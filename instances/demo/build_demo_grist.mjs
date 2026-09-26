#!/usr/bin/env node
// Creates or refreshes the Grist doc of a fictitious public instance: the demo
// (docs/plan-instance-demo-cloudflare.md, lot A3) or demo-2 (docs/plan-architecture-multi-instances.md,
// lot 6 c), chosen with --instance (default demo); its data comes from instances/<slug>/demo-data.mjs.
//
//  - tables and columns: schema of the Centrale doc (instances/demo/schema.json), so the same
//    code reads both; missing tables/columns are created, existing ones are left as they are;
//  - data: Etablissements, Structures and Annuaire are emptied then refilled from <slug>/demo-data.mjs
//    (fictitious); the Alignement_* tables are created empty (a read-only instance cannot
//    create them on first use like Centrale does).
// Dry run by default; --apply writes.
//
// Usage (no node on the host):
//   docker run --rm --network host -v "$PWD":/app -w /app \
//     -e GRIST_API_KEY=<key> [-e DEMO_GRIST_DOC_ID=<doc>] [-e DEMO_GRIST_WORKSPACE_ID=<ws>] \
//     node:20-slim node instances/demo/build_demo_grist.mjs [--instance demo-2] [--apply]
// Without DEMO_GRIST_DOC_ID, --apply creates a new doc (DOC_NAMES) in DEMO_GRIST_WORKSPACE_ID
// and prints its id. The doc must then be shared publicly as viewer (Grist UI), which the
// read-only instance relies on (VITE_GRIST_PUBLIC_BASE_URL).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const argInstance = process.argv.indexOf('--instance');
const INSTANCE = argInstance > 0 ? process.argv[argInstance + 1] : 'demo';
const DOC_NAMES = { demo: 'Druid — démo', 'demo-2': 'Druid — démo 2' };
if (!DOC_NAMES[INSTANCE]) { console.error(`--instance must be one of: ${Object.keys(DOC_NAMES).join(', ')}`); process.exit(1); }
const { ETABLISSEMENTS, STRUCTURES, buildResearchers } = await import(`../${INSTANCE}/demo-data.mjs`);
const BASE = (process.env.GRIST_API_BASE || 'https://grist.numerique.gouv.fr/api').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;
const WORKSPACE = process.env.DEMO_GRIST_WORKSPACE_ID;
let DOC = process.env.DEMO_GRIST_DOC_ID;
const DOC_NAME = DOC_NAMES[INSTANCE];

if (!KEY) { console.error('GRIST_API_KEY is required'); process.exit(1); }
if (!DOC && !WORKSPACE) { console.error('DEMO_GRIST_DOC_ID or DEMO_GRIST_WORKSPACE_ID is required'); process.exit(1); }

const schema = JSON.parse(fs.readFileSync(path.join(HERE, 'schema.json'), 'utf8'));

const grist = async (method, url, body) => {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → HTTP ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

/** 'YYYY-MM-DD' → epoch seconds (Grist Date column). */
const toEpoch = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 : null;
};

/** Column definition for POST /tables or /columns. */
const colDef = (c) => ({ id: c.id, fields: { ...c.fields } });

const log = (...a) => console.log(APPLY ? '' : '[dry-run]', ...a);

// ── Data, checked before any write ───────────────────────────────────────────
const researchers = buildResearchers();
const uids = new Set();
for (const r of researchers) {
  if (uids.has(r.uid_dyna)) throw new Error(`Duplicate uid_dyna in demo-data: ${r.uid_dyna}`);
  uids.add(r.uid_dyna);
}
const annuaireCols = new Set(schema.tables.find((t) => t.id === 'Annuaire').columns.map((c) => c.id));
for (const k of Object.keys(researchers[0])) {
  if (k !== 'employerKey' && !annuaireCols.has(k)) throw new Error(`Annuaire column missing from schema.json: ${k}`);
}
console.log(`${INSTANCE}: ${ETABLISSEMENTS.length} établissements, ${STRUCTURES.length} structures, ${researchers.length} chercheurs`);

// ── Doc ──────────────────────────────────────────────────────────────────────
if (!DOC) {
  if (!APPLY) {
    log(`would create the doc « ${DOC_NAME} » in workspace ${WORKSPACE}`);
    process.exit(0);
  }
  DOC = await grist('POST', `/workspaces/${WORKSPACE}/docs`, { name: DOC_NAME });
  console.log(`Doc created: ${DOC}`);
}

// ── Tables and columns ───────────────────────────────────────────────────────
const existing = new Map();
for (const t of (await grist('GET', `/docs/${DOC}/tables`)).tables) {
  const cols = (await grist('GET', `/docs/${DOC}/tables/${t.id}/columns?hidden=true`)).columns;
  existing.set(t.id, new Set(cols.map((c) => c.id)));
}
for (const table of schema.tables) {
  const have = existing.get(table.id);
  if (!have) {
    log(`create table ${table.id} (${table.columns.length} columns)`);
    if (APPLY) await grist('POST', `/docs/${DOC}/tables`, { tables: [{ id: table.id, columns: table.columns.map(colDef) }] });
    continue;
  }
  const missing = table.columns.filter((c) => !have.has(c.id));
  if (missing.length) {
    log(`table ${table.id}: add ${missing.map((c) => c.id).join(', ')}`);
    if (APPLY) await grist('POST', `/docs/${DOC}/tables/${table.id}/columns`, { columns: missing.map(colDef) });
  }
}
// Annuaire.Employeur shows the employer name in the Grist UI (visibleCol is a doc-specific
// column ref, so it cannot come from schema.json). Cosmetic: the API returns the row id anyway.
if (APPLY) {
  const etabCols = (await grist('GET', `/docs/${DOC}/tables/Etablissements/columns`)).columns;
  const annCols = (await grist('GET', `/docs/${DOC}/tables/Annuaire/columns`)).columns;
  const target = etabCols.find((c) => c.id === 'Employeur')?.fields.colRef;
  const employeur = annCols.find((c) => c.id === 'Employeur');
  if (target && employeur && !employeur.fields.displayCol) {
    await grist('PATCH', `/docs/${DOC}/tables/Annuaire/columns`, { columns: [{ id: 'Employeur', fields: { visibleCol: target } }] });
    // visibleCol alone does not create the display helper column: SetDisplayFormula does.
    await grist('POST', `/docs/${DOC}/apply`, [['SetDisplayFormula', 'Annuaire', null, employeur.fields.colRef, '$Employeur.Employeur']]);
    console.log('Annuaire.Employeur: shows Etablissements.Employeur');
  }
}
// A new doc comes with an empty Table1: remove it.
if (existing.has('Table1')) {
  log('remove Table1');
  if (APPLY) await grist('POST', `/docs/${DOC}/apply`, [['RemoveTable', 'Table1']]);
}

// ── Data ─────────────────────────────────────────────────────────────────────
const replaceRecords = async (table, rows) => {
  if (!APPLY) { log(`${table}: replace records with ${rows.length} rows`); return []; }
  const { records } = await grist('GET', `/docs/${DOC}/tables/${table}/records`);
  if (records.length) await grist('POST', `/docs/${DOC}/tables/${table}/data/delete`, records.map((r) => r.id));
  const ids = [];
  for (let i = 0; i < rows.length; i += 100) {
    const res = await grist('POST', `/docs/${DOC}/tables/${table}/records`, { records: rows.slice(i, i + 100).map((fields) => ({ fields })) });
    ids.push(...res.records.map((r) => r.id));
  }
  console.log(`${table}: ${rows.length} rows written`);
  return ids;
};

const etabIds = await replaceRecords('Etablissements', ETABLISSEMENTS.map(({ key, ...f }) => f));
const employerRow = Object.fromEntries(ETABLISSEMENTS.map((e, i) => [e.key, etabIds[i]]));
await replaceRecords('Structures', STRUCTURES);
await replaceRecords('Annuaire', researchers.map(({ employerKey, DATE_DE_NAISSANCE_JJ_MM_AAAA, ...f }) => ({
  ...f,
  DATE_DE_NAISSANCE_JJ_MM_AAAA: toEpoch(DATE_DE_NAISSANCE_JJ_MM_AAAA),
  Employeur: employerRow[employerKey] ?? 0,
})));

if (APPLY) {
  console.log(`\nDone. Doc: ${DOC} — ${BASE.replace(/\/api$/, '')}/doc/${DOC}`);
  console.log('Remaining manual step: share the doc publicly as viewer (Grist UI → Share → Public access).');
}
