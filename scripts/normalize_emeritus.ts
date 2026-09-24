/**
 * @file normalize_emeritus.ts
 * @description Normalization of emeritus status in the Grist Annuaire (decision of 2026-09-15):
 * every record carrying a trace of emeritus status (Corps_grade, TYPE_EMPLOI or LIB_TYPE_EMPLOI) receives
 * in `Corps_grade` the emeritus code of its original corps (MCFEM / DREM / otherwise PREM,
 * single rule: lib/emeritus.ts). TYPE_EMPLOI and LIB_TYPE_EMPLOI are not modified.
 *
 * Usage (from src/, Node 20, env VITE_GRIST_DOC_ID + GRIST_API_KEY):
 *   npm run normalize:emeritus                 → dry-run, JSON plan on --out (default scripts/.build/emeritus_plan.json)
 *   npm run normalize:emeritus -- --apply      → applies (PATCH Corps_grade + dated line in Commentaires),
 *                                                before/after backup in --out
 * Options: --ldap=<ldap_status_cache.json> (fallback corps when Corps_grade is empty), --out=<file>.
 */
import { readFileSync, writeFileSync } from 'fs';
import { hasEmeritusTrace, emeritusGradeFor, EMERITUS_GRADES } from '../lib/emeritus';
import { getGradeFromNcorps } from '../lib/gradeTypology';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // FortiGate (see scripts/sync_idref.cjs)
const GRIST_BASE = process.env.GRIST_BASE_URL || 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY;

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = args.includes('--apply');
const OUT = opt('--out') || 'scripts/.build/emeritus_plan.json';
const LDAP_PATH = opt('--ldap');

async function grist(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${GRIST_BASE}/docs/${DOC}/${path}`, {
    ...init, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Grist ${init.method || 'GET'} ${path} → ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

interface PlanItem {
  rowId: number; uid: string; name: string; labo: string;
  before: string; after: string; typeEmploi: string; libTypeEmploi: string; ldapCategory: string; ldapCorps: string;
  reason: string;
}

async function main() {
  if (!DOC || !KEY) throw new Error('VITE_GRIST_DOC_ID / GRIST_API_KEY not configured');
  let ldap: Record<string, any> = {};
  if (LDAP_PATH) { try { ldap = JSON.parse(readFileSync(LDAP_PATH, 'utf8')); } catch (e) { console.warn(`LDAP cache unreadable (${LDAP_PATH}) — ignored`); } }

  const { records } = await grist('tables/Annuaire/records');
  const changes: PlanItem[] = [];
  const already: PlanItem[] = [];
  for (const r of records) {
    const f = r.fields;
    const uid = String(f['uid_dyna'] || '');
    const l = uid ? ldap[uid] : undefined;
    const signals = { grade: f['Corps_grade'], typeEmploi: f['TYPE_EMPLOI'], libTypeEmploi: f['LIB_TYPE_EMPLOI'], ldapCategory: l?.categorie };
    if (!hasEmeritusTrace(signals)) continue;
    const before = String(f['Corps_grade'] || '').trim();
    // Base corps: Corps_grade, otherwise the mapped LDAP corps (fallback), then TYPE_EMPLOI (« PROFESSEUR EMERITE » ⇒ PREM).
    const ldapBase = l?.empCorps ? getGradeFromNcorps(String(l.empCorps)) : null;
    // emeritusGradeFor never returns null (simplified rule of 2026-09-15, see lib/emeritus.ts):
    // an unrecognized original corps falls back to PREM, not to a « à qualifier » queue (medium review
    // of scripts/, finding normalize_emeritus.ts — the former `!after` branch was dead code).
    const after: string = emeritusGradeFor(before || ldapBase || '');
    const item: PlanItem = {
      rowId: r.id, uid, name: `${String(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim(), labo: String(f['LABO'] || ''),
      before, after, typeEmploi: String(f['TYPE_EMPLOI'] || ''), libTypeEmploi: String(f['LIB_TYPE_EMPLOI'] || ''),
      ldapCategory: String(l?.categorie || ''), ldapCorps: String(l?.empCorps || ''),
      reason: after === before ? 'déjà normalisé' : `${before || '∅'} → ${after}`,
    };
    if (after === before) already.push(item);
    else changes.push(item);
  }

  const byTarget: Record<string, number> = {};
  for (const c of changes) byTarget[`${c.before || '∅'} → ${c.after}`] = (byTarget[`${c.before || '∅'} → ${c.after}`] || 0) + 1;
  console.log(`Records with a trace of emeritus status: ${changes.length + already.length}`);
  console.log(`  to normalize: ${changes.length}`, JSON.stringify(byTarget));
  console.log(`  already normalized: ${already.length}`);

  // Choice column: make sure the 4 codes are in the list (otherwise Grist displays them as « hors liste »).
  const { columns } = await grist('tables/Annuaire/columns');
  const col = columns.find((c: any) => c.id === 'Corps_grade');
  let widget: any = {};
  try { widget = JSON.parse(col?.fields?.widgetOptions || '{}'); } catch { widget = {}; }
  const choices: string[] = Array.isArray(widget.choices) ? widget.choices : [];
  const missingChoices = EMERITUS_GRADES.filter((g) => !choices.includes(g));
  if (missingChoices.length) console.log(`  missing choices in Corps_grade: ${missingChoices.join(', ')}${APPLY ? ' → added' : ' (added on apply)'}`);

  const plan = { generatedAt: new Date().toISOString(), applied: APPLY, changes, already, missingChoices };
  writeFileSync(OUT, JSON.stringify(plan, null, 2));
  console.log(`Plan written: ${OUT}`);
  if (!APPLY) { console.log('Dry run — rerun with --apply to write to Grist.'); return; }

  if (missingChoices.length && col) {
    await grist('tables/Annuaire/columns', {
      method: 'PATCH',
      body: JSON.stringify({ columns: [{ id: 'Corps_grade', fields: { widgetOptions: JSON.stringify({ ...widget, choices: [...choices, ...missingChoices] }) } }] }),
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  const byId: Record<number, any> = {};
  for (const r of records) byId[r.id] = r.fields;
  const patch = changes.map((c) => {
    const curCom = String(byId[c.rowId]?.['Commentaires'] || '');
    const note = `[${today}] Éméritat : Corps_grade ${c.before || '∅'} → ${c.after} (normalisation, trace : ${[c.typeEmploi, c.libTypeEmploi, c.ldapCategory].filter(Boolean).join(' / ')})`;
    return { id: c.rowId, fields: { Corps_grade: c.after, Commentaires: curCom ? `${curCom}\n${note}` : note } };
  });
  for (let i = 0; i < patch.length; i += 100) {
    await grist('tables/Annuaire/records', { method: 'PATCH', body: JSON.stringify({ records: patch.slice(i, i + 100) }) });
  }
  console.log(`Applied: ${patch.length} records updated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
