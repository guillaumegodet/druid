#!/usr/bin/env node
/**
 * One-shot helper (docs/plan-langue-source-en.md, lot A1): after switching the Lingui source
 * locale to English, fill locales/fr/messages.po with the former French source strings, using
 * the {english msgid (with "context\u0004" prefix when any): french msgid} mapping written by
 * switch_source_locale.mjs. Usage: node scripts/i18n/fill_fr_catalog.mjs mapping.json
 */
import fs from 'node:fs';
import PO from 'pofile';

const mapping = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const po = PO.parse(fs.readFileSync('locales/fr/messages.po', 'utf8'));
let filled = 0, kept = 0;
const missing = [];
for (const it of po.items) {
  if (!it.msgid) continue;
  if (it.msgstr[0]) { kept++; continue; }
  const key = it.msgctxt ? `${it.msgctxt}\u0004${it.msgid}` : it.msgid;
  if (mapping[key] !== undefined) { it.msgstr = [mapping[key]]; filled++; }
  else missing.push(`${it.msgctxt ? `[${it.msgctxt}] ` : ''}${it.msgid}  (${it.references.join(', ')})`);
}
fs.writeFileSync('locales/fr/messages.po', po.toString());
console.log(`fr catalog: ${filled} filled, ${kept} already set, ${missing.length} missing`);
for (const m of missing) console.log('  ✗ ' + m.slice(0, 200));
