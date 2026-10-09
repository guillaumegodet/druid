// Copy of the PostgreSQL directory into the Grist document (druid-internal docs/plan-migration-postgresql.md, lot 8 e).
//
// Once an instance runs on PostgreSQL, its Grist document becomes a read-only copy, refreshed every night: the managers
// keep their work tables and their `Ref` columns to the Annuaire (D4), and the copy is the way back to Grist (lot 7).
// The source is the PostgreSQL « tables » view (tableClient.ts), which shows the migrated tables as the document they
// came from, with the same row ids: a row is added, updated or removed by its id, so the references stay right.
//
// Pure: the plan of one table. Only the document's data columns are written — never a formula column (writing one
// would turn it into a data column), nor `manualSort` / helper columns; a field of the source the document has no
// column for is reported, not created.
import type { GristRecord } from '../gristMapping';

export const COPIED_TABLES = ['Etablissements', 'Structures', 'Annuaire'] as const;
export type CopiedTable = (typeof COPIED_TABLES)[number];

export interface GristColumn { id: string; fields: Record<string, any> }

export interface TableCopyPlan {
  table: string;
  sourceRows: number;
  targetRows: number;
  /** Rows of the source the document does not have, with their source id. */
  adds: { id: number; fields: Record<string, unknown> }[];
  /** Cells that differ, by row. */
  updates: { id: number; fields: Record<string, unknown> }[];
  /** Rows of the document the source no longer has (merged or deleted in Druid). */
  removes: number[];
  /** Number of cells changed, per column (report, no value). */
  changedColumns: Record<string, number>;
  /** Fields of the source without a data column in the document (not copied). */
  missingColumns: string[];
}

const SKIPPED = (id: string) => id === 'manualSort' || id.startsWith('gristHelper_');

/** Civility compared by meaning: the document mixes F / M (most rows) and Mme / M.; the database keeps F / M. */
const CIVILITY: Record<string, string> = { F: 'F', MME: 'F', MADAME: 'F', M: 'M', 'M.': 'M', MONSIEUR: 'M' };

/**
 * Per-column rules: how the document writes a value of the database (`write`) and when two values are the same
 * (`same`). Numeric identifiers: 0 = none (the import's sentinel) — not for the FTE columns, where 0 is a value.
 */
const zeroIsEmpty = (v: unknown) => (v === 0 ? null : v);
const CELL_RULES: Record<string, Record<string, { write?: (v: unknown) => unknown; same?: (v: unknown) => unknown }>> = {
  Annuaire: {
    Civilite: { same: (v) => (typeof v === 'string' ? CIVILITY[v.trim().toUpperCase()] ?? v : v) },
    ID_SCOPUS: { same: zeroIsEmpty },
    N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: { same: zeroIsEmpty },
    IdHAL_i: { same: zeroIsEmpty },
  },
};

/** Data columns the copy may write. */
export const writableColumns = (columns: GristColumn[]): Map<string, string> =>
  new Map(columns.filter((c) => !c.fields?.isFormula && !SKIPPED(c.id)).map((c) => [c.id, String(c.fields?.type ?? '')]));

/** A cell as compared: empty text, null and an empty reference (0) are the same; lists compared by content. */
export const normalizeCell = (value: unknown, type: string): unknown => {
  if (value === undefined || value === null || value === '') return null;
  if (type.startsWith('Ref:') && value === 0) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
};

/** Plan of one table: what to add, update and remove in the document for it to read as the source. */
export function planTableCopy(table: string, source: GristRecord[], target: GristRecord[], columns: GristColumn[]): TableCopyPlan {
  const writable = writableColumns(columns);
  const rules = CELL_RULES[table] ?? {};
  const toGrist = (col: string, v: unknown) => (rules[col]?.write ? rules[col].write!(v) : v);
  const comparable = (col: string, v: unknown) => normalizeCell(rules[col]?.same ? rules[col].same!(v) : v, writable.get(col)!);
  const targetById = new Map(target.map((r) => [r.id, r]));
  const sourceIds = new Set(source.map((r) => r.id));
  const missing = new Set<string>();
  const changedColumns: Record<string, number> = {};
  const plan: TableCopyPlan = {
    table, sourceRows: source.length, targetRows: target.length, adds: [], updates: [], removes: [], changedColumns, missingColumns: [],
  };
  for (const row of source) {
    const fields: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(row.fields || {})) {
      if (!writable.has(col)) {
        if (!columns.some((c) => c.id === col)) missing.add(col);
        continue;
      }
      fields[col] = toGrist(col, value);
    }
    const existing = targetById.get(row.id);
    if (!existing) {
      plan.adds.push({ id: row.id, fields });
      continue;
    }
    const changed: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(fields)) {
      if (JSON.stringify(comparable(col, value)) !== JSON.stringify(comparable(col, existing.fields?.[col]))) {
        changed[col] = value ?? null;
        changedColumns[col] = (changedColumns[col] ?? 0) + 1;
      }
    }
    if (Object.keys(changed).length) plan.updates.push({ id: row.id, fields: changed });
  }
  plan.removes = target.filter((r) => !sourceIds.has(r.id)).map((r) => r.id);
  plan.missingColumns = [...missing].sort();
  return plan;
}

/**
 * Grist user actions applying a plan (POST /apply), in batches: rows added with their source ids (BulkAddRecord takes
 * explicit ids), updates grouped by set of columns, removals.
 */
export function copyActions(plan: TableCopyPlan, batch = 500): unknown[][] {
  const actions: unknown[][] = [];
  const columnar = (rows: { id: number; fields: Record<string, unknown> }[]) => {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r.fields)))];
    return { ids: rows.map((r) => r.id), values: Object.fromEntries(cols.map((c) => [c, rows.map((r) => (c in r.fields ? r.fields[c] ?? null : null))])) };
  };
  for (let i = 0; i < plan.adds.length; i += batch) {
    const { ids, values } = columnar(plan.adds.slice(i, i + batch));
    actions.push(['BulkAddRecord', plan.table, ids, values]);
  }
  // An update only writes its changed cells: rows with the same set of changed columns go together.
  const groups = new Map<string, { id: number; fields: Record<string, unknown> }[]>();
  for (const u of plan.updates) {
    const key = Object.keys(u.fields).sort().join('|');
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  for (const rows of groups.values()) {
    for (let i = 0; i < rows.length; i += batch) {
      const { ids, values } = columnar(rows.slice(i, i + batch));
      actions.push(['BulkUpdateRecord', plan.table, ids, values]);
    }
  }
  for (let i = 0; i < plan.removes.length; i += batch) actions.push(['BulkRemoveRecord', plan.table, plan.removes.slice(i, i + batch)]);
  return actions;
}

/** A copy that would remove more than this share of a table (with at least `floor` rows) is refused without --force:
 * an empty or half-loaded source must never empty the document. */
export const massRemoval = (plan: TableCopyPlan, share = 0.05, floor = 50): boolean =>
  plan.removes.length > Math.max(floor, plan.targetRows * share);
