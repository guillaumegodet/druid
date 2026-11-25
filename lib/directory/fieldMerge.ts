/**
 * Merge of the values that several sources give for one field of a person (migration 20261121150000,
 * table person_field_value). Pure functions only: the PostgreSQL side is lib/directory/pg/fieldValues.ts.
 *
 * Same principle as the CRISalid-labo merge module: each source keeps its own value, the record shows the best
 * reconciliation, and a validated manual correction is replayed on top of every recomputation instead of being
 * overwritten by the next import.
 *
 * Rules, for one field:
 *   1. A manual row always wins (even an empty value: the user cleared the field on purpose).
 *   2. Otherwise the most trusted source wins (lowest rank of field_source_priority; an unlisted source ranks last),
 *      then the most recently observed value, then the source name (deterministic).
 *   3. A compatible value that is more precise refines the winner (birth date `1980` + `1980-05-12` → `1980-05-12`),
 *      except a value the manual correction already saw and chose not to keep.
 *   4. A source that disagrees with the result is a divergence. Under a manual correction, it is a CONFLICT to review
 *      when the source changed (or appeared) after the correction; a divergence the user already saw is not.
 */
import { normalizeFuzzyDate } from '../dates';

export const MANUAL_SOURCE = 'manual';

/** One row of person_field_value, as the merge needs it. Timestamps are ISO strings. */
export interface FieldValue {
  source: string;
  /** Normalized value; null = the source says it has no value. */
  value: string | null;
  assertedAt: string;
  observedAt: string;
  assertedBy?: string | null;
  /** Manual row only: the value of each other source when the correction was made. */
  acknowledged?: Record<string, string | null>;
}

/** Rank of each source for one field (lower = more trusted). */
export type SourceRanks = ReadonlyMap<string, number>;

export type DivergenceKind =
  /** A less trusted (or older) source says something else: nothing to do. */
  | 'overridden'
  /** Under a manual correction, a source the user already saw and overrode: nothing to do. */
  | 'acknowledged'
  /** Under a manual correction, the source changed its value since: to review. */
  | 'changed_since_manual'
  /** Under a manual correction, the source gave a value after it: to review. */
  | 'new_since_manual';

export interface Divergence {
  source: string;
  value: string;
  rank: number;
  kind: DivergenceKind;
  observedAt: string;
}

export interface FieldResolution {
  field: string;
  /** Value to project on the `person` column. */
  value: string | null;
  /** Source of the value (`manual`, `ldap`…); null when no source has a value. */
  source: string | null;
  /** Source whose more precise compatible value was taken (rule 3). */
  refinedBy: string | null;
  divergences: Divergence[];
  /** The divergences to review (changed_since_manual, new_since_manual). */
  conflicts: Divergence[];
}

// ── Field rules ────────────────────────────────────────────────────────────────────────────────────────────────────

interface FieldRule {
  /** Canonical form; '' = empty; null = not a valid value. */
  normalize: (raw: unknown) => string | null;
  /** Same information, possibly at different precisions. */
  compatible: (a: string, b: string) => boolean;
  /** Higher = more precise. */
  precision: (v: string) => number;
}

const textRule: FieldRule = {
  normalize: (raw) => (raw === null || raw === undefined ? '' : String(raw).trim()),
  compatible: (a, b) => a.toLowerCase() === b.toLowerCase(),
  precision: () => 0,
};

const fuzzyDateRule: FieldRule = {
  // Also the compact form of LDAP (supannOIDCDateDeNaissance: YYYYMMDD), read the same way by lib/directory/people.ts.
  normalize: (raw) => {
    const m = typeof raw === 'string' ? /^\s*(\d{4})(\d{2})(\d{2})\s*$/.exec(raw) : null;
    return normalizeFuzzyDate(m ? `${m[1]}-${m[2]}-${m[3]}` : raw);
  },
  // YYYY, YYYY-MM, YYYY-MM-DD: a less precise date is a prefix of the more precise one.
  compatible: (a, b) => a.startsWith(b) || b.startsWith(a),
  precision: (v) => v.length,
};

const FIELD_RULES: Record<string, FieldRule> = {
  birth_date: fuzzyDateRule,
  corps_grade: { ...textRule, normalize: (raw) => (raw === null || raw === undefined ? '' : String(raw).trim().toUpperCase()) },
};

const ruleOf = (field: string): FieldRule => FIELD_RULES[field] ?? textRule;

/** Fields whose `person` column is a projection of person_field_value. */
export const MERGED_FIELDS = Object.keys(FIELD_RULES);

export class FieldValueError extends Error {}

/**
 * Canonical value of `raw` for `field` (null for an empty value). Throws on a value that cannot be stored (a typed
 * birth date that is not a date): an import drops such a value, a form rejects it.
 */
export const normalizeFieldValue = (field: string, raw: unknown): string | null => {
  const v = ruleOf(field).normalize(raw);
  if (v === null) throw new FieldValueError(`Invalid value for ${field}: ${String(raw)}`);
  return v === '' ? null : v;
};

const sameValue = (field: string, a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase() && ruleOf(field).precision(a) === ruleOf(field).precision(b);

// ── Merge ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const rankOf = (ranks: SourceRanks, source: string): number => ranks.get(source) ?? Number.MAX_SAFE_INTEGER;

/** Most trusted first, then most recent, then by name. */
const byTrust = (ranks: SourceRanks) => (a: FieldValue, b: FieldValue): number =>
  rankOf(ranks, a.source) - rankOf(ranks, b.source)
  || (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0)
  || a.source.localeCompare(b.source);

export const resolveField = (field: string, rows: readonly FieldValue[], ranks: SourceRanks): FieldResolution => {
  const rule = ruleOf(field);
  const manual = rows.find((r) => r.source === MANUAL_SOURCE) ?? null;
  const sources = rows.filter((r) => r.source !== MANUAL_SOURCE && r.value !== null).sort(byTrust(ranks));
  const acknowledged = manual?.acknowledged ?? {};
  const isAcknowledged = (r: FieldValue): boolean =>
    Object.prototype.hasOwnProperty.call(acknowledged, r.source) && sameValue(field, acknowledged[r.source] ?? null, r.value);

  const winner: FieldValue | null = manual ?? sources[0] ?? null;
  let value: string | null = winner?.value ?? null;
  let refinedBy: string | null = null;

  // Rule 3: a compatible, more precise value refines the result.
  for (const r of sources) {
    const candidate = r.value!;
    if (value === null || r === winner || (manual && isAcknowledged(r))) continue;
    if (rule.compatible(value, candidate) && rule.precision(candidate) > rule.precision(value)) {
      value = candidate;
      refinedBy = r.source;
    }
  }

  const divergences: Divergence[] = [];
  for (const r of sources) {
    if (r === winner) continue;
    if (value !== null && rule.compatible(value, r.value!)) continue;
    let kind: DivergenceKind = 'overridden';
    if (manual) {
      if (isAcknowledged(r)) kind = 'acknowledged';
      else if (Object.prototype.hasOwnProperty.call(acknowledged, r.source)) kind = 'changed_since_manual';
      else kind = 'new_since_manual';
    }
    divergences.push({ source: r.source, value: r.value!, rank: rankOf(ranks, r.source), kind, observedAt: r.observedAt });
  }

  return {
    field,
    value,
    source: winner ? winner.source : null,
    refinedBy,
    divergences,
    conflicts: divergences.filter((d) => d.kind === 'changed_since_manual' || d.kind === 'new_since_manual'),
  };
};

// ── Writes (what to store, decided here so that every importer behaves the same) ───────────────────────────────────

interface ObservationInput {
  field: string;
  source: string;
  /** Raw value from the source; empty = the source has no value. */
  value: unknown;
  by?: string | null;
  now: string;
}

/**
 * Row to store when `source` reports `value` (a sync, an import, a file). A value equal to the stored one only
 * moves observedAt; a new value restarts assertedAt. A source never writes the manual row.
 */
export const observe = (current: FieldValue | null, input: ObservationInput): { row: FieldValue; changed: boolean } => {
  if (input.source === MANUAL_SOURCE) throw new FieldValueError('A source cannot write the manual value');
  const value = normalizeFieldValue(input.field, input.value);
  if (current && sameValue(input.field, current.value, value)) {
    return { row: { ...current, observedAt: input.now }, changed: false };
  }
  return {
    row: { source: input.source, value, assertedAt: input.now, observedAt: input.now, assertedBy: input.by ?? null },
    changed: true,
  };
};

/**
 * Manual row for a correction typed by `by`: it records what every other source says at that moment, so that the
 * next import of the same (wrong) value is not raised again, but a source that changes later is.
 */
export const correct = (rows: readonly FieldValue[], field: string, raw: unknown, by: string, now: string): FieldValue => ({
  source: MANUAL_SOURCE,
  value: normalizeFieldValue(field, raw),
  assertedAt: now,
  observedAt: now,
  assertedBy: by,
  acknowledged: snapshotOf(rows),
});

/** « Keep my correction »: the manual row now acknowledges what the sources currently say. */
export const keepCorrection = (rows: readonly FieldValue[], by: string, now: string): FieldValue => {
  const manual = rows.find((r) => r.source === MANUAL_SOURCE);
  if (!manual) throw new FieldValueError('No manual value to keep');
  return { ...manual, observedAt: now, assertedBy: by, acknowledged: snapshotOf(rows) };
};

const snapshotOf = (rows: readonly FieldValue[]): Record<string, string | null> =>
  Object.fromEntries(rows.filter((r) => r.source !== MANUAL_SOURCE).map((r) => [r.source, r.value]));
