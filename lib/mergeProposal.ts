/**
 * Merge proposal for two Annuaire rows (same person) — PURE logic, no Grist
 * call, to stay testable (see docs/archive/plan-fusion-doublons.md, lot 2).
 *
 * Vocabulary: `keep` = retained row (PATCH), `drop` = absorbed row (DELETE,
 * after logging in `Fusions_log`).
 *
 * Pre-selection rules, in order:
 * 1. non-empty value vs empty → the non-empty one;
 * 2. equal values → nothing to do;
 * 3. concatenable "trace" fields (`Data_source`, `Commentaires`, `groupes`…) → union;
 * 4. Nom/Prenom → the spelling of the LDAP row (civil status); the other spelling remains
 *    readable in the merge note (Commentaires);
 * 5. validation block (validated, validated_status, validation_*) → handled as a
 *    whole: the validated row wins, otherwise the most recent validation;
 * 6. other conflict → the validated row wins, then the most recent validation, then
 *    the most recent LDAP update, then the retained row.
 */

import { isValidatedCell } from './validation';
import { FTE_COLUMNS } from './fte';

/** LABO values that do not designate a lab: `zzz` = parking of LDAP people outside the
 *  lab scope (LDAP update of 2026-06-02, never validated), empty = record without affiliation. */
export const PARKING_LABOS: ReadonlySet<string> = new Set(['zzz', '']);

/** Columns merged by union (separator `|`, or line break for Commentaires). */
export const MERGE_CONCAT_FIELDS: ReadonlySet<string> = new Set([
  'Data_source', 'Commentaires', 'LDAP_champs_modifies', 'IdRef_champs_modifies',
]);

/** Columns of the validation block, arbitrated together. */
export const VALIDATION_BLOCK: readonly string[] = [
  'validated', 'validated_status', 'validation_date', 'validation_source', 'validation_scope', 'validated_by',
];

/** "Last update" columns (ISO dates): the most recent one is kept, no arbitration. */
export const LATEST_WINS_FIELDS: ReadonlySet<string> = new Set(['LDAP_derniere_maj', 'IdRef_derniere_maj']);

/** Columns never copied (technical or derived). */
export const MERGE_SKIP_FIELDS: ReadonlySet<string> = new Set(['id', 'manualSort']);

/** Class of a group of rows sharing a uid_dyna (see docs/archive/plan-fusion-doublons.md). */
export type LdapDuplicateKind = 'same_labo' | 'parking' | 'multi_labo';

/**
 * Classifies a duplicate group from the LABO of its rows:
 * same LABO everywhere → `same_labo` (probable duplicate); at least one parking row →
 * `parking` (to absorb); otherwise `multi_labo` (multiple affiliation to qualify).
 */
export function classifyDuplicate(labos: string[]): LdapDuplicateKind {
  const set = new Set(labos.map((l) => String(l || '').trim()));
  if (set.size === 1) return 'same_labo';
  if ([...set].some((l) => PARKING_LABOS.has(l))) return 'parking';
  return 'multi_labo';
}

export type MergeChoice = 'keep' | 'drop' | 'both';
export type MergeKind = 'same' | 'fill' | 'concat' | 'conflict' | 'validation';

export interface MergeField {
  col: string;
  label: string;
  kind: MergeKind;
  keepValue: any;
  dropValue: any;
  /** Suggested choice (editable by the user for `conflict`/`validation`). */
  choice: MergeChoice;
  /** Reason for the suggestion, for the tooltip. */
  reason: string;
}

export interface MergeRow {
  rowId: number;
  fields: Record<string, any>;
}

export interface MergeColumnMeta {
  id: string;
  label: string;
  type: string;
  isFormula: boolean;
}

export interface MergeProposal {
  keep: MergeRow;
  drop: MergeRow;
  fields: MergeField[];
  /** Do both rows carry the same (non-empty) uid_dyna? */
  sameUid: boolean;
}

const isEmpty = (v: any): boolean =>
  v === null || v === undefined || v === '' || v === false || v === 0 || (Array.isArray(v) && v.length === 0);

const norm = (v: any): string => (isEmpty(v) ? '' : typeof v === 'string' ? v.trim() : JSON.stringify(v));
/** Columns compared case-insensitively (addresses, identifiers). */
const CASE_INSENSITIVE_FIELDS: ReadonlySet<string> = new Set(['Email', 'IdHAL', 'ORCID']);
/** Numeric columns where 0 is a value and not « empty » (FTEs: 0 = no research time, lib/fte.ts). */
const ZERO_IS_VALUE_FIELDS: ReadonlySet<string> = new Set(Object.values(FTE_COLUMNS));
const isEmptyCell = (col: string, v: any): boolean =>
  ZERO_IS_VALUE_FIELDS.has(col) ? v === null || v === undefined || v === '' : isEmpty(v);
const normCol = (col: string, v: any): string => {
  if (ZERO_IS_VALUE_FIELDS.has(col)) return isEmptyCell(col, v) ? '' : String(v);
  return CASE_INSENSITIVE_FIELDS.has(col) ? norm(v).toLowerCase() : norm(v);
};

/**
 * Decodes a Grist Date cell into a comparable value (epoch seconds as a number,
 * or YYYY-MM-DD / DD-MM-YYYY text). `Number(v)` alone returns NaN on text
 * (review lot 3, finding 4: it silently tipped `conflictWinner` toward
 * `drop`, whichever row was validated).
 */
const dateSortKey = (v: any): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v || '').trim();
  if (!s) return 0;
  const parts = s.split(/[-/]/);
  if (parts.length !== 3) return 0;
  const iso = parts[0].length === 2 && parts[2].length === 4 ? `${parts[2]}-${parts[1]}-${parts[0]}` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

const hasLdapSource = (f: Record<string, any>): boolean =>
  String(f['Data_source'] || '').split(/[|,]/).map((s) => s.trim().toUpperCase()).includes('LDAP');

/** Number of filled fields (excluding technical ones) — rough measure of "richness". */
export const filledCount = (f: Record<string, any>): number =>
  Object.entries(f).filter(([k, v]) => !MERGE_SKIP_FIELDS.has(k) && !isEmpty(v)).length;

/**
 * Picks the row to keep by default: non-parking (`zzz`/empty) first, then the
 * validated row, then the most filled one, then the smallest rowId (= the one that
 * carries the bare uid in Druid and therefore the public URL).
 */
export function pickDefaultKeep(a: MergeRow, b: MergeRow): { keep: MergeRow; drop: MergeRow; reason: string } {
  const parkA = PARKING_LABOS.has(String(a.fields['LABO'] || '').trim());
  const parkB = PARKING_LABOS.has(String(b.fields['LABO'] || '').trim());
  if (parkA !== parkB) return parkA ? { keep: b, drop: a, reason: 'parking' } : { keep: a, drop: b, reason: 'parking' };
  const valA = isValidatedCell(a.fields['validated']);
  const valB = isValidatedCell(b.fields['validated']);
  if (valA !== valB) return valA ? { keep: a, drop: b, reason: 'validated' } : { keep: b, drop: a, reason: 'validated' };
  const fa = filledCount(a.fields);
  const fb = filledCount(b.fields);
  if (fa !== fb) return fa > fb ? { keep: a, drop: b, reason: 'filled' } : { keep: b, drop: a, reason: 'filled' };
  return a.rowId <= b.rowId ? { keep: a, drop: b, reason: 'rowid' } : { keep: b, drop: a, reason: 'rowid' };
}

/** Compares two validated rows: which one "wins" a conflict? ('keep' | 'drop') + reason. */
function conflictWinner(keep: Record<string, any>, drop: Record<string, any>): { choice: MergeChoice; reason: string } {
  const vk = isValidatedCell(keep['validated']);
  const vd = isValidatedCell(drop['validated']);
  if (vk !== vd) return { choice: vk ? 'keep' : 'drop', reason: 'validated' };
  const dk = dateSortKey(keep['validation_date']);
  const dd = dateSortKey(drop['validation_date']);
  if (dk !== dd) return { choice: dk > dd ? 'keep' : 'drop', reason: 'validation_date' };
  const lk = String(keep['LDAP_derniere_maj'] || '');
  const ld = String(drop['LDAP_derniere_maj'] || '');
  if (lk !== ld) return { choice: lk > ld ? 'keep' : 'drop', reason: 'ldap_date' };
  return { choice: 'keep', reason: 'default' };
}

/**
 * Builds the proposal field by field. `columns` filters the writable columns
 * (formulas are ignored) and provides the labels.
 */
export function buildMergeProposal(keep: MergeRow, drop: MergeRow, columns: MergeColumnMeta[]): MergeProposal {
  const fields: MergeField[] = [];
  const validationDone = new Set<string>();
  const winner = conflictWinner(keep.fields, drop.fields);
  const keepIsLdap = hasLdapSource(keep.fields);
  const dropIsLdap = hasLdapSource(drop.fields);

  for (const col of columns) {
    if (col.isFormula || MERGE_SKIP_FIELDS.has(col.id)) continue;
    const kv = keep.fields[col.id];
    const dv = drop.fields[col.id];
    const base = { col: col.id, label: col.label || col.id, keepValue: kv, dropValue: dv };

    if (VALIDATION_BLOCK.includes(col.id)) {
      // Validation block: a single decision for the 6 columns (represented on `validated`).
      if (validationDone.has('validation')) continue;
      validationDone.add('validation');
      const anyDiff = VALIDATION_BLOCK.some((c) => norm(keep.fields[c]) !== norm(drop.fields[c]));
      if (!anyDiff) { fields.push({ ...base, col: 'validated', label: 'Validation', kind: 'same', choice: 'keep', reason: 'equal' }); continue; }
      const vk = isValidatedCell(keep.fields['validated']);
      const vd = isValidatedCell(drop.fields['validated']);
      const choice: MergeChoice = vk && !vd ? 'keep' : vd && !vk ? 'drop' : winner.choice;
      fields.push({ ...base, col: 'validated', label: 'Validation', kind: 'validation', choice, reason: vk !== vd ? 'validated' : winner.reason });
      continue;
    }

    if (normCol(col.id, kv) === normCol(col.id, dv)) { fields.push({ ...base, kind: 'same', choice: 'keep', reason: 'equal' }); continue; }
    if (isEmptyCell(col.id, kv) && !isEmptyCell(col.id, dv)) { fields.push({ ...base, kind: 'fill', choice: 'drop', reason: 'fill' }); continue; }
    if (!isEmptyCell(col.id, kv) && isEmptyCell(col.id, dv)) { fields.push({ ...base, kind: 'same', choice: 'keep', reason: 'fill' }); continue; }

    if (MERGE_CONCAT_FIELDS.has(col.id)) { fields.push({ ...base, kind: 'concat', choice: 'both', reason: 'concat' }); continue; }
    if (LATEST_WINS_FIELDS.has(col.id)) {
      fields.push({ ...base, kind: 'fill', choice: String(dv) > String(kv) ? 'drop' : 'keep', reason: 'latest' });
      continue;
    }

    if (col.id === 'Nom' || col.id === 'Prenom') {
      const choice: MergeChoice = keepIsLdap && !dropIsLdap ? 'keep' : dropIsLdap && !keepIsLdap ? 'drop' : winner.choice;
      fields.push({ ...base, kind: 'conflict', choice, reason: keepIsLdap !== dropIsLdap ? 'ldap_name' : winner.reason });
      continue;
    }

    fields.push({ ...base, kind: 'conflict', choice: winner.choice, reason: winner.reason });
  }

  const ku = String(keep.fields['uid_dyna'] || '').trim();
  const du = String(drop.fields['uid_dyna'] || '').trim();
  return { keep, drop, fields, sameUid: !!ku && ku === du };
}

/** Union of two trace values (separator `|`, except Commentaires = lines). */
export function concatValues(col: string, a: any, b: any): string {
  const sep = col === 'Commentaires' ? '\n' : '|';
  const parts = [...String(a ?? '').split(sep), ...String(b ?? '').split(sep)].map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set(parts)).join(sep);
}

/**
 * Translates the proposal (with possibly modified choices) into fields to PATCH
 * on the retained row. Only returns what actually changes.
 * - `Data_source` gets the trace `fusion <date> ← G-<rowId>`; `Commentaires` a dated note
 *   with the spelling (`Prénom Nom (LABO)`) of the absorbed row — no spelling is lost.
 */
export function resolveMergeFields(p: MergeProposal, today: string): Record<string, any> {
  const out: Record<string, any> = {};
  const set = (col: string, v: any) => { if (norm(v) !== norm(p.keep.fields[col])) out[col] = v; };

  for (const f of p.fields) {
    if (f.kind === 'validation') {
      const src = f.choice === 'drop' ? p.drop.fields : p.keep.fields;
      for (const c of VALIDATION_BLOCK) set(c, src[c] ?? null);
      continue;
    }
    if (f.kind === 'same') continue;
    if (f.kind === 'concat' || f.choice === 'both') { set(f.col, concatValues(f.col, f.keepValue, f.dropValue)); continue; }
    if (f.choice === 'drop') set(f.col, f.dropValue);
  }

  // NB: `Alignement_annuaire` is a Grist formula column → not writable. The spelling of
  // the absorbed row is kept in the merge note (Commentaires) below.
  const spelling = (f: Record<string, any>) =>
    `${String(f['Prenom'] || '').trim()} ${String(f['Nom'] || '').trim()} (${String(f['LABO'] || '').trim() || '∅'})`.trim();
  // Merge trace
  const curSrc = 'Data_source' in out ? out['Data_source'] : p.keep.fields['Data_source'];
  out['Data_source'] = concatValues('Data_source', curSrc, `fusion ${today} ← G-${p.drop.rowId}`);
  const curCom = 'Commentaires' in out ? out['Commentaires'] : p.keep.fields['Commentaires'];
  out['Commentaires'] = concatValues('Commentaires', curCom, `[${today}] Fusion : ligne G-${p.drop.rowId} (${spelling(p.drop.fields)}) absorbée`);
  return out;
}

/** Conflicts tolerated by the automatic merge: spellings and formats, not data. */
export const AUTO_MERGE_OK_CONFLICTS: ReadonlySet<string> = new Set(['Nom', 'Prenom', 'Civilite', 'LABO']);

/**
 * Can a merge be done without human review? Yes if:
 * - both rows share the uid_dyna;
 * - the group is `same_labo` or `parking` (never a multiple affiliation);
 * - no value conflict beyond spelling/format (`AUTO_MERGE_OK_CONFLICTS`) — a different
 *   `LABO` is only tolerated in the parking case;
 * - the validation block is not contradictory (two validated rows with different `validated_status`).
 * Returns the refusal reasons (empty = eligible).
 */
export function autoMergeEligibility(p: MergeProposal, kind: LdapDuplicateKind): string[] {
  const reasons: string[] = [];
  if (!p.sameUid) reasons.push('uid_dyna différents');
  if (kind === 'multi_labo') reasons.push('multi-rattachement (labos différents)');
  for (const f of p.fields) {
    if (f.kind === 'conflict' && !AUTO_MERGE_OK_CONFLICTS.has(f.col)) reasons.push(`conflit ${f.col}`);
    if (f.kind === 'conflict' && f.col === 'LABO' && kind !== 'parking') reasons.push('conflit LABO');
    if (f.kind === 'validation') {
      // Two validations (e.g. DRPI list + lab website) are only contradictory when the
      // validated status differs (INTERNE vs EXTERNE): otherwise the most recent one is kept
      // and the Data_source union preserves both provenances.
      const vk = isValidatedCell(p.keep.fields['validated']);
      const vd = isValidatedCell(p.drop.fields['validated']);
      const sk = String(p.keep.fields['validated_status'] || '').trim().toUpperCase();
      const sd = String(p.drop.fields['validated_status'] || '').trim().toUpperCase();
      if (vk && vd && sk && sd && sk !== sd) reasons.push(`statuts validés contradictoires (${sk} / ${sd})`);
    }
  }
  return reasons;
}
