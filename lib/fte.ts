/**
 * @file fte.ts
 * @description Full-time equivalents of a researcher: overall FTE (« quotité agent ») and research
 * FTE, stored in the optional Grist Annuaire columns `etp_quotite` and `etp_recherche` (Numeric,
 * created on 2026-10-06 — docs/plan-chercheurs-age-etp.md, lot 1).
 *
 * An empty cell (null) means « not provided » and is NOT the same as 0: a professor fully
 * discharged from research has a research FTE of 0, while a missing value will later get a default
 * from the grade (decision D4). Grist fills a Numeric cell with 0 on every new row, so both
 * columns carry the trigger formula `None` applied to new records only, and Druid always writes
 * them explicitly (null when empty).
 *
 * Pure module (no network / DOM access): testable and shared by gristService and the record form.
 */

import type { AnnuaireColumnMeta } from './gristService';

/** Grist columns of the Annuaire table, absent from the documents created before 2026-10-06. */
export const FTE_COLUMNS = { fte: 'etp_quotite', researchFte: 'etp_recherche' } as const;

export type FteField = keyof typeof FTE_COLUMNS;

/**
 * Reads a Grist cell: a number in [0, 1], or null when the cell is empty or unreadable.
 * Accepts the text a Grist user may type into a non-Numeric copy of the column (« 0,5 »).
 */
export const parseFteCell = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  if (typeof raw === 'string' && raw.trim() === '') return null;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

/** Value typed in the record form: '' → null, a valid FTE → number, anything else → 'invalid'. */
export const parseFteInput = (text: string): number | null | 'invalid' => {
  if (text.trim() === '') return null;
  const n = parseFteCell(text);
  return n === null ? 'invalid' : n;
};

/** True when the Annuaire of this document has both FTE columns (instances without them hide the fields). */
export const hasFteColumns = (cols: AnnuaireColumnMeta[]): boolean =>
  Object.values(FTE_COLUMNS).every((id) => cols.some((c) => c.id === id));

/**
 * Fields of an Annuaire write: each FTE column present in the document, null when empty — never
 * omitted, so that a new row gets a real empty value. Columns missing from the document are skipped
 * (writing them would make Grist reject the whole record).
 */
export function fteGristFields(
  cols: AnnuaireColumnMeta[],
  values: { fte?: number | null; researchFte?: number | null },
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [field, col] of Object.entries(FTE_COLUMNS) as [FteField, string][]) {
    if (!cols.some((c) => c.id === col)) continue;
    out[col] = parseFteCell(values[field]);
  }
  return out;
}
