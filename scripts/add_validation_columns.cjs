#!/usr/bin/env node
/**
 * add_validation_columns.cjs — provisions the columns of the reliability
 * layer (validated status/affiliation) in the `Annuaire` table of the Grist doc.
 *
 * Idempotent: only adds the missing columns. DRY-RUN by default
 * (prints what would be done); pass `--apply` to actually write.
 *
 * Names/types MUST stay aligned with GRIST_VALIDATION_COLUMNS in
 * lib/validation.ts. The application code is backward compatible: as long as these
 * columns do not exist, all records are simply « non validées ».
 *
 * Env:
 *   GRIST_API_URL  (default https://grist.numerique.gouv.fr/api)
 *   GRIST_DOC_ID   (default = VITE_GRIST_DOC_ID from .env if loaded)
 *   GRIST_API_KEY  (deprecated fallback: VITE_GRIST_API_KEY)
 *   GRIST_TABLE    (default Annuaire)
 *   HTTPS_PROXY    (FortiGate network: http://cache.univ-nantes.fr:3128)
 *
 * Usage:
 *   node scripts/add_validation_columns.cjs            # dry-run
 *   node scripts/add_validation_columns.cjs --apply    # writes the columns
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

// Must stay in sync with GRIST_VALIDATION_COLUMNS (lib/validation.ts).
const COLUMNS = [
  { id: 'validated',         label: 'Validé (manuel)',      type: 'Bool' },
  { id: 'validated_status',  label: 'Statut validé',        type: 'Text' },
  { id: 'validation_date',   label: 'Date de validation',   type: 'Date' },
  { id: 'validation_source', label: 'Source de validation', type: 'Text' },
  { id: 'validation_scope',  label: 'Portée (statut,rattachement)', type: 'Text' },
  { id: 'validated_by',      label: 'Validé par',           type: 'Text' },
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
    console.log('✓ Every validation column already exists. Nothing to do.');
    return;
  }
  console.log(`Colonnes manquantes : ${missing.map((c) => c.id).join(', ')}`);

  if (!APPLY) {
    console.log('\n(DRY-RUN) Rerun with --apply to create these columns.');
    return;
  }

  const body = JSON.stringify({ columns: missing.map((c) => ({ id: c.id, fields: { label: c.label, type: c.type } })) });
  const resp = await fetch(`${API_URL}/docs/${DOC}/tables/${TABLE}/columns`, { method: 'POST', headers, body });
  if (!resp.ok) {
    console.error(`✗ Creation failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  console.log(`✓ ${missing.length} column(s) created in ${TABLE}.`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
