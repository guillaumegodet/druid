#!/usr/bin/env node
/**
 * add_newsletter_table.cjs — provisions the `Newsletter` table (general-audience
 * news briefs generated from the OpenAlex monitoring, validation workflow by the researcher
 * then the editor, see components/dashboard/NewsletterPanel.tsx).
 *
 * Idempotent: only creates the table if it is missing. DRY-RUN by default;
 * pass `--apply` to actually write.
 *
 * Env:
 *   GRIST_API_URL  (default https://grist.numerique.gouv.fr/api)
 *   GRIST_DOC_ID   (default = VITE_GRIST_DOC_ID from .env if loaded)
 *   GRIST_API_KEY  (deprecated fallback: VITE_GRIST_API_KEY)
 *   HTTPS_PROXY    (FortiGate network: http://cache.univ-nantes.fr:3128)
 *
 * Usage:
 *   node scripts/add_newsletter_table.cjs            # dry-run
 *   node scripts/add_newsletter_table.cjs --apply    # creates the table
 */
'use strict';

// FortiGate: the proxy performs SSL inspection (see docker/CLAUDE.md).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

try { require('dotenv').config(); } catch { /* dotenv optional */ }

const API_URL = process.env.GRIST_API_URL || 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.GRIST_DOC_ID || process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY;
const APPLY = process.argv.includes('--apply');

// Must stay in sync with NewsletterPanel.tsx and
// functions/api/newsletter/generate.js. Statuses: genere → envoye (request sent
// to the researcher) → valide | rejete → publie.
const COLUMNS = [
  'work_id', 'slug', 'numero', 'titre', 'doi', 'date_publication', 'journal',
  'auteurs', 'labs', 'accroche', 'resume', 'resume_genere', 'statut',
  'chercheur_nom', 'chercheur_email', 'chercheur_photo', 'chercheur_url',
  'genere_le', 'valide_le', 'valide_par', 'commentaire',
];

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function main() {
  if (!DOC || !KEY) {
    console.error('✗ GRIST_DOC_ID and GRIST_API_KEY required (or VITE_GRIST_*). Aborting.');
    process.exit(1);
  }
  console.log(`Grist : ${API_URL} · doc ${DOC} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const resp = await fetch(`${API_URL}/docs/${DOC}/tables`, { headers });
  if (!resp.ok) {
    console.error(`✗ Failed to read the tables: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const tables = new Set((await resp.json()).tables.map((t) => t.id));
  if (tables.has('Newsletter')) {
    console.log('✓ The Newsletter table already exists — nothing to do.');
    return;
  }
  console.log(`${APPLY ? '+' : '(dry-run) +'} table Newsletter (${COLUMNS.length} colonnes Text)`);
  if (!APPLY) {
    console.log('Rerun with --apply to create the table.');
    return;
  }

  const body = {
    tables: [{
      id: 'Newsletter',
      columns: COLUMNS.map((id) => ({ id, fields: { label: id, type: 'Text' } })),
    }],
  };
  const create = await fetch(`${API_URL}/docs/${DOC}/tables`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!create.ok) {
    console.error(`✗ Creation failed: ${create.status} ${await create.text()}`);
    process.exit(1);
  }
  console.log('✓ Newsletter table created.');
}

main().catch((e) => {
  console.error('✗ Unexpected error:', e);
  process.exit(1);
});
