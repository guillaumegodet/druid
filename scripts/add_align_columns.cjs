#!/usr/bin/env node
/**
 * add_align_columns.cjs — provisions in the `Annuaire` table the columns of the ORCID and HAL
 * alignments (docs/archive/plan-alignement-orcid-hal.md, §3):
 *   - IdHAL_i: numeric HAL identifier (idHal_i), consumed by CRISalid (`idhali` column
 *     of people.csv) — Text to avoid any numeric reformatting;
 *   - HAL_derniere_maj / HAL_champs_modifies, ORCID_derniere_maj / ORCID_champs_modifies:
 *     write traceability (same convention as IdRef_* and LDAP_*).
 * And those of the OpenAlex alignment (docs/archive/plan-alignement-openalex.md, §3):
 *   - OpenAlex_ids: reviewed list of OpenAlex author profiles (A-ids separated by `|`, without
 *     URL prefix) — multi-valued (main profile + fragments), exported as is into the
 *     `openalex` column of people.csv; distinct from `openalex_author_id` (isolated manual choice
 *     of the group dashboards, add_groups_column.cjs);
 *   - OpenAlex_derniere_maj / OpenAlex_champs_modifies: traceability.
 * And those of the Scopus alignment (docs/plan-alignement-scopus.md): Scopus_derniere_maj /
 * Scopus_champs_modifies (the target ID_SCOPUS, Numeric, predates the alignment).
 *
 * Idempotent: only adds the missing columns. DRY-RUN by default; `--apply` to write.
 * Env: VITE_GRIST_DOC_ID, GRIST_API_KEY (fallback VITE_GRIST_API_KEY). Modeled on add_validation_columns.cjs.
 *
 * Usage:
 *   node scripts/add_align_columns.cjs            # dry-run
 *   node scripts/add_align_columns.cjs --apply    # creates the missing columns
 */
'use strict';
const common = require('./lib/align_common.cjs');

const TABLE = 'Annuaire';
const APPLY = common.hasFlag('apply');

const COLUMNS = [
  { id: 'IdHAL_i',               label: 'IdHAL_i (numérique)',        type: 'Text' },
  { id: 'HAL_derniere_maj',      label: 'HAL dernière MAJ',           type: 'Text' },
  { id: 'HAL_champs_modifies',   label: 'HAL champs modifiés',        type: 'Text' },
  { id: 'ORCID_derniere_maj',    label: 'ORCID dernière MAJ',         type: 'Text' },
  { id: 'ORCID_champs_modifies', label: 'ORCID champs modifiés',      type: 'Text' },
  { id: 'OpenAlex_ids',             label: 'OpenAlex ids (A-ids, |)',     type: 'Text' },
  { id: 'OpenAlex_derniere_maj',    label: 'OpenAlex dernière MAJ',       type: 'Text' },
  { id: 'OpenAlex_champs_modifies', label: 'OpenAlex champs modifiés',    type: 'Text' },
  // Scopus alignment (docs/plan-alignement-scopus.md): the target ID_SCOPUS already exists (Numeric).
  { id: 'Scopus_derniere_maj',      label: 'Scopus dernière MAJ',         type: 'Text' },
  { id: 'Scopus_champs_modifies',   label: 'Scopus champs modifiés',      type: 'Text' },
];

async function main() {
  console.log(`Grist : doc ${common.DOC} · table ${TABLE} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const { columns } = await common.gristGet(`/docs/${common.DOC}/tables/${TABLE}/columns`);
  const existing = new Set(columns.map((c) => c.id));
  const missing = COLUMNS.filter((c) => !existing.has(c.id));
  if (!missing.length) { console.log('✓ Every alignment column already exists. Nothing to do.'); return; }
  console.log(`Colonnes manquantes : ${missing.map((c) => c.id).join(', ')}`);
  if (!APPLY) { console.log('\n(DRY-RUN) Rerun with --apply to create these columns.'); return; }
  await common.gristWrite('POST', `/docs/${common.DOC}/tables/${TABLE}/columns`, {
    columns: missing.map((c) => ({ id: c.id, fields: { label: c.label, type: c.type } })),
  });
  console.log(`✓ ${missing.length} column(s) created in ${TABLE}.`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
