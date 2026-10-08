/**
 * Bulk processing of the `uid_dyna` duplicates of the Grist Annuaire
 * (docs/archive/plan-fusion-doublons.md, lot 3). DRY-RUN by default.
 *
 * Reuses the logic of the merge assistant (`lib/mergeProposal.ts`) and the merge command of the domain API
 * (`mergeRows`, lib/directory/commands.ts: `Fusions_log` journal, then PATCH, then delete): same rules, same
 * traceability, same restore. Reads and writes go through the storage of the jobs (lib/directory/jobStorage.ts).
 *
 * Automatic scope: « même labo » groups (probable duplicate) and « parking » groups (`zzz`/empty
 * row absorbed into the lab row), when no value conflict remains other than
 * spelling/format. Multi-affiliations and conflicts are left for the review (Druid).
 *
 * Usage (from src/, Node 20 via docker, env VITE_GRIST_DOC_ID + GRIST_API_KEY):
 *   npm run merge:doublons -- [--kind same_labo|parking] [--uid X] [--limit N] [--out plan.json] [--apply]
 * e.g.:
 *   docker run --rm --env-file ../.env -v "$PWD":/app -w /app node:20 npm run merge:doublons
 */
import { writeFileSync } from 'fs';
import {
  buildMergeProposal, pickDefaultKeep, resolveMergeFields, classifyDuplicate, autoMergeEligibility,
  MergeRow, MergeColumnMeta, LdapDuplicateKind,
} from '../lib/mergeProposal';
import { jobContext, jobStorageFromEnv } from '../lib/directory/jobStorage';

const AUTHOR = process.env.MERGE_AUTHOR || 'merge_doublons (script)';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes('--apply');
const KIND = opt('--kind') as LdapDuplicateKind | undefined;
const UID = opt('--uid');
const LIMIT = Number(opt('--limit') || 0);
const OUT = opt('--out') || 'scripts/.build/merge_doublons_plan.json';

interface PlanItem {
  uid: string; kind: LdapDuplicateKind; keepRowId: number; dropRowId: number;
  keepLabel: string; dropLabel: string; eligible: boolean; reasons: string[];
  decisions: { col: string; kind: string; choice: string; reason: string; keep: any; drop: any }[];
  patch: Record<string, any>;
}

const label = (r: MergeRow) => `${r.fields['Prenom'] || ''} ${r.fields['Nom'] || ''} (${r.fields['LABO'] || '∅'}${r.fields['validated'] ? ', validée' : ''}) G-${r.rowId}`;

async function main() {
  const { grist, commands } = jobStorageFromEnv(process.env, 'Druid-CRISalid-merge_doublons/1.0');
  const rawCols = await grist.columns('Annuaire');
  const columns: MergeColumnMeta[] = rawCols.map((c: any) => ({
    id: c.id, label: c.fields?.label || c.id, type: c.fields?.type || 'Any', isFormula: !!c.fields?.isFormula,
  }));
  const writable = new Set(columns.filter((c) => !c.isFormula).map((c) => c.id));
  const records = await grist.records('Annuaire');

  // Groups by uid_dyna (≥ 2 rows)
  const byUid = new Map<string, MergeRow[]>();
  for (const r of records) {
    const uid = String(r.fields['uid_dyna'] || '').trim();
    if (!uid) continue;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid)!.push({ rowId: r.id, fields: r.fields });
  }
  const groups = [...byUid.entries()].filter(([, rows]) => rows.length > 1).filter(([uid]) => !UID || uid === UID);

  const plan: PlanItem[] = [];
  const skipped: { uid: string; kind: LdapDuplicateKind; why: string }[] = [];
  for (const [uid, rows] of groups) {
    const kind = classifyDuplicate(rows.map((r) => String(r.fields['LABO'] || '')));
    if (KIND && kind !== KIND) continue;
    if (kind === 'multi_labo') { skipped.push({ uid, kind, why: 'multi-rattachement : revue manuelle' }); continue; }
    if (rows.length > 2) { skipped.push({ uid, kind, why: `${rows.length} lignes : fusionner deux à deux dans Druid` }); continue; }
    const { keep, drop } = pickDefaultKeep(rows[0], rows[1]);
    const proposal = buildMergeProposal(keep, drop, columns);
    const reasons = autoMergeEligibility(proposal, kind);
    const today = new Date().toISOString().slice(0, 10);
    const patchAll = resolveMergeFields(proposal, today);
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(patchAll)) if (writable.has(k)) patch[k] = v;
    plan.push({
      uid, kind, keepRowId: keep.rowId, dropRowId: drop.rowId, keepLabel: label(keep), dropLabel: label(drop),
      eligible: reasons.length === 0, reasons,
      decisions: proposal.fields.filter((f) => f.kind !== 'same').map((f) => ({ col: f.col, kind: f.kind, choice: f.choice, reason: f.reason, keep: f.keepValue, drop: f.dropValue })),
      patch,
    });
  }
  const eligible = plan.filter((p) => p.eligible);
  const toReview = plan.filter((p) => !p.eligible);
  const count = (items: { kind: LdapDuplicateKind }[]) => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.kind] = (c[i.kind] || 0) + 1;
    return JSON.stringify(c);
  };

  console.log('='.repeat(70));
  console.log(`${APPLY ? 'APPLICATION' : 'DRY-RUN (no write)'} — merge of uid_dyna duplicates`);
  console.log('='.repeat(70));
  console.log(`Duplicate groups: ${groups.length} | analyzed: ${plan.length} ${count(plan)} | out of scope: ${skipped.length} ${count(skipped)}`);
  console.log(`\nPROPOSED AUTOMATIC MERGES: ${eligible.length} ${count(eligible)}`);
  for (const p of eligible) {
    const fills = p.decisions.filter((d) => d.kind === 'fill').length;
    const confl = p.decisions.filter((d) => d.kind === 'conflict').map((d) => `${d.col}:${JSON.stringify(d.keep)}←${JSON.stringify(d.drop)}`);
    console.log(`  ✓ ${p.uid.padEnd(22)} keeps ${p.keepLabel}  ← absorbs ${p.dropLabel} | ${fills} additions${confl.length ? ' | spellings ' + confl.join(', ') : ''}`);
  }
  console.log(`\nTO REVIEW IN DRUID (conflicts): ${toReview.length} ${count(toReview)}`);
  for (const p of toReview) console.log(`  ? ${p.uid.padEnd(22)} ${p.keepLabel} / ${p.dropLabel} — ${p.reasons.join(' ; ')}`);
  if (skipped.length) {
    console.log(`\nOUT OF SCOPE: ${skipped.length}`);
    for (const s of skipped.slice(0, 8)) console.log(`  - ${s.uid.padEnd(22)} ${s.kind} — ${s.why}`);
    if (skipped.length > 8) console.log(`  … ${skipped.length - 8} autres`);
  }
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), apply: APPLY, plan, skipped }, null, 1));
  console.log(`\nPlan : ${OUT}`);

  if (!APPLY) { console.log('\n>>> DRY-RUN: rerun with --apply to merge the eligible groups.'); return; }

  // ── Apply: journal → PATCH → delete (mergeRows, which creates the journal table when missing), group by group
  // (one failure does not stop the others).
  const ctx = jobContext((w) => { if (w.kind === 'table') console.log(`Table ${w.table} created.`); });
  const todo = LIMIT > 0 ? eligible.slice(0, LIMIT) : eligible;
  let ok = 0, ko = 0;
  for (const p of todo) {
    try {
      // Fresh re-read: the row may have changed since the dry-run.
      const fresh = await grist.records('Annuaire', { id: [p.keepRowId, p.dropRowId] });
      const keep = fresh.find((r) => r.id === p.keepRowId); const drop = fresh.find((r) => r.id === p.dropRowId);
      if (!keep || !drop) throw new Error('one of the rows no longer exists');
      const keepRow = { rowId: keep.id, fields: keep.fields }; const dropRow = { rowId: drop.id, fields: drop.fields };
      const proposal = buildMergeProposal(keepRow, dropRow, columns);
      const reasons = autoMergeEligibility(proposal, p.kind);
      if (reasons.length) throw new Error(`no longer eligible: ${reasons.join('; ')}`);
      // mergeRows keeps the writable columns only, as the dry-run plan.
      const fields = resolveMergeFields(proposal, new Date().toISOString().slice(0, 10));
      const { logId } = await commands.mergeRows({ keepRowId: p.keepRowId, dropRowId: p.dropRowId, fields, author: AUTHOR, note: `script lot 3 (${p.kind})` }, ctx);
      ok++;
      console.log(`  ✓ ${p.uid} : G-${p.dropRowId} → G-${p.keepRowId} (journal #${logId})`);
    } catch (e: any) {
      ko++;
      console.error(`  ✗ ${p.uid} : ${e.message || e}`);
    }
  }
  console.log(`\n${ok} merge(s) done, ${ko} failure(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
