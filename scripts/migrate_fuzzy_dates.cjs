#!/usr/bin/env node
/**
 * Migrates the four employment / membership date columns of the Grist Annuaire from Date (epoch)
 * to Text so they can hold reduced-precision dates (`YYYY`, `YYYY-MM`, `YYYY-MM-DD` — lib/dates.ts,
 * decision of 2026-09-22). Existing epochs are rewritten as `YYYY-MM-DD` strings (UTC calendar day,
 * the same value the app displayed).
 *
 * Usage (dry-run by default, nothing written):
 *   GRIST_API_KEY=… VITE_GRIST_DOC_ID=… node scripts/migrate_fuzzy_dates.cjs [--apply] [--out=DIR]
 *   node scripts/migrate_fuzzy_dates.cjs --rollback=DIR/fuzzy_dates_backup_<doc>_<ts>.json [--apply]
 * Options: --doc=<docId> overrides VITE_GRIST_DOC_ID, --base=<api url> (default grist.numerique.gouv.fr).
 * The backup file (written before any change, --apply only) holds every row's previous cell values
 * and lets --rollback restore the Date type and the epochs.
 *
 * Run from the Druid container (network + env already there):
 *   docker cp scripts/migrate_fuzzy_dates.cjs crisalid-druid-1:/tmp/ &&
 *   docker exec -w /app crisalid-druid-1 node /tmp/migrate_fuzzy_dates.cjs --apply --out=/app/cache-data
 */
const fs = require('fs');
const path = require('path');

const COLS = ['employment_start_date', 'employment_end_date', 'affiliation_start_date', 'affiliation_end_date'];
const TABLE = 'Annuaire';
const BATCH = 500;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const APPLY = args.apply === true;
const DOC = args.doc || process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY;
const BASE = args.base || process.env.GRIST_API_BASE || 'https://grist.numerique.gouv.fr/api';
const OUT = args.out || process.cwd();
if (!DOC || !KEY) { console.error('GRIST_API_KEY and VITE_GRIST_DOC_ID (or --doc) are required'); process.exit(2); }

const grist = async (p, init) => {
  const r = await fetch(`${BASE}/docs/${DOC}/${p}`, {
    ...init, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init && init.headers) },
  });
  if (!r.ok) throw new Error(`Grist ${r.status} ${p}: ${await r.text()}`);
  return r.json();
};
const epochToIso = (v) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? new Date(v * 1000).toISOString().slice(0, 10) : '');
const isoToEpoch = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000) : null; };

async function patchRecords(records) {
  for (let i = 0; i < records.length; i += BATCH) {
    await grist(`tables/${TABLE}/records`, { method: 'PATCH', body: JSON.stringify({ records: records.slice(i, i + BATCH) }) });
  }
}

async function migrate() {
  const { columns } = await grist(`tables/${TABLE}/columns`);
  const byId = Object.fromEntries(columns.map((c) => [c.id, c.fields]));
  const todo = COLS.filter((c) => byId[c] && byId[c].type !== 'Text');
  const missing = COLS.filter((c) => !byId[c]);
  const done = COLS.filter((c) => byId[c] && byId[c].type === 'Text');
  console.log(`doc ${DOC} — to migrate: ${todo.join(', ') || '(none)'}${done.length ? ` — already Text: ${done.join(', ')}` : ''}${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`);
  if (todo.length === 0) return;

  const { records } = await grist(`tables/${TABLE}/records`);
  const backup = { doc: DOC, table: TABLE, at: new Date().toISOString(), columns: {}, rows: [] };
  for (const c of todo) backup.columns[c] = { type: byId[c].type, widgetOptions: byId[c].widgetOptions || '' };
  const stats = {};
  const patch = [];
  for (const r of records) {
    const before = {}; const after = {}; let touched = false;
    for (const c of todo) {
      const v = r.fields[c];
      before[c] = v;
      const iso = epochToIso(v);
      stats[c] = stats[c] || { filled: 0, empty: 0, odd: 0 };
      if (iso) stats[c].filled++; else if (v === null || v === undefined || v === 0 || v === '') stats[c].empty++; else stats[c].odd++;
      after[c] = iso || null;
      touched = true;
    }
    backup.rows.push({ id: r.id, fields: before });
    if (touched) patch.push({ id: r.id, fields: after });
  }
  for (const c of todo) console.log(`  ${c}: ${stats[c].filled} dated, ${stats[c].empty} empty, ${stats[c].odd} unreadable (→ cleared)`);
  const odd = records.filter((r) => todo.some((c) => { const v = r.fields[c]; return !epochToIso(v) && !(v === null || v === undefined || v === 0 || v === ''); }));
  for (const r of odd.slice(0, 20)) console.log(`    unreadable row ${r.id}: ${JSON.stringify(Object.fromEntries(todo.map((c) => [c, r.fields[c]])))}`);

  if (!APPLY) { console.log(`dry-run: ${patch.length} rows would be rewritten; add --apply to migrate`); return; }

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `fuzzy_dates_backup_${DOC}_${backup.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup));
  console.log(`backup written: ${file}`);

  await grist(`tables/${TABLE}/columns`, {
    method: 'PATCH',
    body: JSON.stringify({ columns: todo.map((id) => ({ id, fields: { type: 'Text', widgetOptions: JSON.stringify({ widget: 'TextBox', alignment: 'left' }) } })) }),
  });
  console.log(`columns converted to Text: ${todo.join(', ')}`);
  await patchRecords(patch);
  console.log(`${patch.length} rows rewritten as YYYY-MM-DD text`);
}

async function rollback(file) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (backup.doc !== DOC) throw new Error(`backup is for doc ${backup.doc}, current doc is ${DOC}`);
  const cols = Object.keys(backup.columns);
  console.log(`rollback of ${cols.join(', ')} on ${backup.rows.length} rows from ${backup.at}`);
  if (!APPLY) { console.log('dry-run: add --apply to restore'); return; }
  await grist(`tables/${TABLE}/columns`, {
    method: 'PATCH',
    body: JSON.stringify({ columns: cols.map((id) => ({ id, fields: { type: backup.columns[id].type, widgetOptions: backup.columns[id].widgetOptions } })) }),
  });
  // Values written back as epochs (a Date cell), from the saved value (epoch) or its ISO text.
  const patch = backup.rows.map((r) => ({
    id: r.id,
    fields: Object.fromEntries(cols.map((c) => { const v = r.fields[c]; return [c, typeof v === 'number' ? v : (isoToEpoch(v) ?? null)]; })),
  }));
  await patchRecords(patch);
  console.log(`${patch.length} rows restored`);
}

(args.rollback ? rollback(args.rollback) : migrate()).catch((e) => { console.error(e.message || e); process.exit(1); });
