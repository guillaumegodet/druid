#!/usr/bin/env node
/**
 * Backfill of the Annuaire Date columns that contain TEXT (invalid Grist cells).
 *
 * Until 2026-09-17, lib/gristService.ts wrote dates as « JJ-MM-AAAA » text; the columns
 * with the default format (validation_date, affiliation_*_date) therefore stored a string instead of
 * an epoch (review lot 2, finding 1). This script converts to epoch (seconds, midnight UTC) every readable
 * text value (DD-MM-YYYY, YYYY-MM-DD, YYYYMMDD, ISO with time) and LISTS, without touching them, the
 * unreadable texts (« inconnu », « #N-A »…) — to be cleaned up by hand.
 *
 * Dry-run by default; `--apply` to write. Env: GRIST_DOC_ID (or VITE_GRIST_DOC_ID), GRIST_API_KEY.
 *   docker exec crisalid-druid-1 node scripts/fix_date_cells.cjs
 *   docker exec crisalid-druid-1 node scripts/fix_date_cells.cjs --apply
 */
const API_URL = process.env.GRIST_API_URL || 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.GRIST_DOC_ID || process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY;
const TABLE = process.env.GRIST_TABLE || 'Annuaire';
const APPLY = process.argv.includes('--apply');
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const toEpoch = (s) => {
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000);
  m = t.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 1000);
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000);
  return null;
};

(async () => {
  if (!DOC || !KEY) { console.error('✗ GRIST_DOC_ID / GRIST_API_KEY required'); process.exit(1); }
  const cr = await fetch(`${API_URL}/docs/${DOC}/tables/${TABLE}/columns`, { headers });
  if (!cr.ok) throw new Error(`Grist columns ${cr.status}`);
  const dateCols = (await cr.json()).columns.filter((c) => c.fields.type === 'Date' && !c.fields.isFormula).map((c) => c.id);
  console.log(`Colonnes Date de ${TABLE} : ${dateCols.join(', ')}`);
  const rr = await fetch(`${API_URL}/docs/${DOC}/tables/${TABLE}/records`, { headers });
  if (!rr.ok) throw new Error(`Grist records ${rr.status}`);
  const { records } = await rr.json();
  const patches = [];
  const unreadable = [];
  for (const r of records) {
    const fields = {};
    for (const col of dateCols) {
      const v = r.fields[col];
      if (typeof v !== 'string' || !v.trim()) continue;
      const ep = toEpoch(v);
      if (ep === null) unreadable.push({ id: r.id, col, value: v });
      else fields[col] = ep;
    }
    if (Object.keys(fields).length) patches.push({ id: r.id, fields, raw: Object.fromEntries(Object.keys(fields).map((c) => [c, r.fields[c]])) });
  }
  const byCol = {};
  for (const p of patches) for (const c of Object.keys(p.fields)) byCol[c] = (byCol[c] || 0) + 1;
  console.log(`${records.length} rows read; ${patches.length} row(s) to fix:`, byCol);
  for (const p of patches.slice(0, 20)) console.log(`  #${p.id}`, JSON.stringify(p.raw), '→', JSON.stringify(p.fields));
  if (unreadable.length) {
    console.log(`${unreadable.length} unreadable text cell(s) left as is (to clean by hand):`);
    for (const u of unreadable) console.log(`  #${u.id} ${u.col} = ${JSON.stringify(u.value)}`);
  }
  if (!APPLY) { console.log('Dry run: nothing written (--apply to fix).'); return; }
  for (let i = 0; i < patches.length; i += 100) {
    const batch = patches.slice(i, i + 100).map(({ id, fields }) => ({ id, fields }));
    const pr = await fetch(`${API_URL}/docs/${DOC}/tables/${TABLE}/records`, { method: 'PATCH', headers, body: JSON.stringify({ records: batch }) });
    if (!pr.ok) throw new Error(`Grist PATCH ${pr.status}: ${await pr.text()}`);
  }
  console.log(`✓ ${patches.length} row(s) fixed.`);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
