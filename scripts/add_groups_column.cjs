#!/usr/bin/env node
/**
 * add_groups_column.cjs — provisions the `groupes` column (membership of the
 * functional groups, names separated by « | ») in the `Annuaire` table.
 *
 * Idempotent: only adds the column if it is missing. DRY-RUN by default
 * (prints what would be done); pass `--apply` to actually write.
 *
 * The application code is backward compatible: as long as the column does not exist,
 * records belong to no group and saving a member fails with an explicit
 * message pointing to this script.
 *
 * Env:
 *   GRIST_API_URL  (default https://grist.numerique.gouv.fr/api)
 *   GRIST_DOC_ID   (default = VITE_GRIST_DOC_ID from .env if loaded)
 *   GRIST_API_KEY  (deprecated fallback: VITE_GRIST_API_KEY)
 *   GRIST_TABLE    (default Annuaire)
 *   HTTPS_PROXY    (FortiGate network: http://cache.univ-nantes.fr:3128)
 *
 * Usage:
 *   node scripts/add_groups_column.cjs            # dry-run
 *   node scripts/add_groups_column.cjs --apply    # writes the column
 */
'use strict';

// FortiGate: the proxy performs SSL inspection (see docker/CLAUDE.md).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

try { require('dotenv').config(); } catch { /* dotenv optional */ }

const API_URL = process.env.GRIST_API_URL || 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.GRIST_DOC_ID || process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY;
const TABLE = process.env.GRIST_TABLE || 'Annuaire';
const APPLY = process.argv.includes('--apply');

// Must stay in sync with the read/write of these columns (lib/gristService.ts).
const COLUMNS = [
  { id: 'groupes', label: 'Groupes fonctionnels', type: 'Text' },
  // OpenAlex author ID: resolved through ORCID by the group ETL, or confirmed by
  // hand (lab-scoped name search) for members without ORCID.
  { id: 'openalex_author_id', label: 'ID auteur OpenAlex', type: 'Text' },
];

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function main() {
  if (!DOC || !KEY) {
    console.error('✗ GRIST_DOC_ID and GRIST_API_KEY required (or VITE_GRIST_*). Aborting.');
    process.exit(1);
  }
  console.log(`Grist : ${API_URL} · doc ${DOC} · table ${TABLE} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const colResp = await fetch(`${API_URL}/docs/${DOC}/tables/${TABLE}/columns`, { headers });
  if (!colResp.ok) {
    console.error(`✗ Failed to read the columns: ${colResp.status} ${await colResp.text()}`);
    process.exit(1);
  }
  const existing = new Set((await colResp.json()).columns.map((c) => c.id));

  const missing = COLUMNS.filter((c) => !existing.has(c.id));
  if (missing.length === 0) {
    console.log('✓ Every column already exists — nothing to do.');
    return;
  }
  for (const c of missing) {
    console.log(`${APPLY ? '+' : '(dry-run) +'} ${c.id} (${c.type}) — ${c.label}`);
  }
  if (!APPLY) {
    console.log('Rerun with --apply to create the column(s).');
    return;
  }

  const body = {
    columns: missing.map((c) => ({ id: c.id, fields: { label: c.label, type: c.type } })),
  };
  const resp = await fetch(`${API_URL}/docs/${DOC}/tables/${TABLE}/columns`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    console.error(`✗ Creation failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  console.log(`✓ ${missing.length} column(s) created.`);
}

main().catch((e) => {
  console.error('✗ Unexpected error:', e);
  process.exit(1);
});
