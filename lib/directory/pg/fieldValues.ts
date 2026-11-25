// Per-field provenance of the person record on PostgreSQL (migration 20261121150000): reads and writes of
// person_field_value, and the projection of the merged value (lib/directory/fieldMerge.ts) on the `person` column.
// Every write goes through here, so that a sync, an import and a form all follow the same rules: a source only
// records what it says, and the column is recomputed — it is never written directly.
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import { resolveGrade } from '../../emeritus';
import type { FieldProvenance, FieldSourceDetail } from '../../../types';
import {
  MANUAL_SOURCE, MERGED_FIELDS, correct, keepCorrection, normalizeFieldValue, observe, resolveField,
  type FieldResolution, type FieldValue, type SourceRanks,
} from '../fieldMerge';

/** Column of `person` written by the projection, per merged field. */
const PERSON_COLUMN: Record<string, 'birth_date' | 'corps_grade'> = { birth_date: 'birth_date', corps_grade: 'corps_grade' };

const assertMerged = (field: string): void => {
  if (!MERGED_FIELDS.includes(field) || !PERSON_COLUMN[field]) throw new Error(`Field not merged by source: ${field}`);
};

const iso = (v: unknown): string => new Date(v as string).toISOString();

const toFieldValue = (r: any): FieldValue => ({
  source: r.source,
  value: r.value ?? null,
  assertedAt: iso(r.asserted_at),
  observedAt: iso(r.observed_at),
  assertedBy: r.asserted_by ?? null,
  ...(r.source === MANUAL_SOURCE ? { acknowledged: (r.acknowledged ?? {}) as Record<string, string | null> } : {}),
});

/** Source ranks of every merged field: field → (source → rank). */
export const readSourceRanks = async (db: Transaction<DB> | any): Promise<Map<string, SourceRanks>> => {
  const out = new Map<string, Map<string, number>>();
  for (const r of await db.selectFrom('field_source_priority').selectAll().execute()) {
    if (!out.has(r.field)) out.set(r.field, new Map());
    out.get(r.field)!.set(r.source, r.rank);
  }
  return out;
};

/** Values of one field of one person, all sources. */
const readFieldValues = async (trx: Transaction<DB>, personId: string, field: string): Promise<FieldValue[]> =>
  (await trx.selectFrom('person_field_value').selectAll().where('person_id', '=', personId).where('field', '=', field).execute())
    .map(toFieldValue);

const upsert = async (trx: Transaction<DB>, personId: string, field: string, row: FieldValue, importBatchId?: string | null): Promise<void> => {
  const values = {
    person_id: personId,
    field,
    source: row.source,
    value: row.value,
    asserted_at: row.assertedAt,
    observed_at: row.observedAt,
    asserted_by: row.assertedBy ?? null,
    acknowledged: JSON.stringify(row.acknowledged ?? {}),
    ...(importBatchId !== undefined ? { import_batch_id: importBatchId } : {}),
  };
  await trx.insertInto('person_field_value').values(values)
    .onConflict((oc) => oc.columns(['person_id', 'field', 'source']).doUpdateSet({
      value: values.value, asserted_at: values.asserted_at, observed_at: values.observed_at, asserted_by: values.asserted_by,
      acknowledged: values.acknowledged, ...(importBatchId !== undefined ? { import_batch_id: importBatchId } : {}),
    }))
    .execute();
};

/** Recomputes the field from its sources and writes the `person` column when it changed. */
export const reprojectField = async (trx: Transaction<DB>, personId: string, field: string, ranks?: SourceRanks): Promise<FieldResolution> => {
  assertMerged(field);
  const fieldRanks = ranks ?? (await readSourceRanks(trx)).get(field) ?? new Map();
  const resolution = resolveField(field, await readFieldValues(trx, personId, field), fieldRanks);
  const column = PERSON_COLUMN[field];
  await trx.updateTable('person').set({ [column]: resolution.value } as any)
    .where('id', '=', personId)
    .where(column, 'is distinct from', resolution.value as any)
    .execute();
  return resolution;
};

interface ObserveArgs {
  personId: string;
  field: string;
  source: string;
  value: unknown;
  by?: string | null;
  importBatchId?: string | null;
  now?: string;
  ranks?: SourceRanks;
}

/** A source (sync, import, file) reports a value: stored as its own, then the column is recomputed. */
export const observeFieldValue = async (trx: Transaction<DB>, a: ObserveArgs): Promise<FieldResolution & { changed: boolean }> => {
  assertMerged(a.field);
  const now = a.now ?? new Date().toISOString();
  const current = (await readFieldValues(trx, a.personId, a.field)).find((r) => r.source === a.source) ?? null;
  const { row, changed } = observe(current, { field: a.field, source: a.source, value: a.value, by: a.by, now });
  await upsert(trx, a.personId, a.field, row, changed ? a.importBatchId : undefined);
  return { ...(await reprojectField(trx, a.personId, a.field, a.ranks)), changed };
};

/** A user corrects the value (record form, arbitration « other value »). */
export const correctFieldValue = async (trx: Transaction<DB>, personId: string, field: string, value: unknown, by: string, now = new Date().toISOString()): Promise<FieldResolution> => {
  assertMerged(field);
  await upsert(trx, personId, field, correct(await readFieldValues(trx, personId, field), field, value, by, now));
  return reprojectField(trx, personId, field);
};

/** « Keep my correction »: closes the conflicts raised by the sources that changed since. */
export const keepFieldCorrection = async (trx: Transaction<DB>, personId: string, field: string, by: string, now = new Date().toISOString()): Promise<FieldResolution> => {
  assertMerged(field);
  await upsert(trx, personId, field, keepCorrection(await readFieldValues(trx, personId, field), by, now));
  return reprojectField(trx, personId, field);
};

/** « Back to the sources »: drops the manual correction (an arbitration « take the imported value »). */
export const dropFieldCorrection = async (trx: Transaction<DB>, personId: string, field: string): Promise<FieldResolution> => {
  assertMerged(field);
  await trx.deleteFrom('person_field_value')
    .where('person_id', '=', personId).where('field', '=', field).where('source', '=', MANUAL_SOURCE)
    .execute();
  return reprojectField(trx, personId, field);
};

/** Every field of every person with conflicts to review (the future « À traiter › Conflits de sources »). */
export const listFieldConflicts = async (trx: Transaction<DB>, field: string): Promise<{ personId: string; resolution: FieldResolution }[]> => {
  assertMerged(field);
  const ranks = (await readSourceRanks(trx)).get(field) ?? new Map();
  const rows = await trx.selectFrom('person_field_value').selectAll().where('field', '=', field)
    .where('person_id', 'in', (qb) => qb.selectFrom('person_field_value').select('person_id').where('field', '=', field).where('source', '=', MANUAL_SOURCE))
    .orderBy('person_id').execute();
  const byPerson = new Map<string, FieldValue[]>();
  for (const r of rows) {
    if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, []);
    byPerson.get(r.person_id)!.push(toFieldValue(r));
  }
  const out: { personId: string; resolution: FieldResolution }[] = [];
  for (const [personId, values] of byPerson) {
    const resolution = resolveField(field, values, ranks);
    if (resolution.conflicts.length) out.push({ personId, resolution });
  }
  return out;
};

// ── Merge of two persons (duplicates) ──────────────────────────────────────────────────────────────────────────────────

/** Source of the values a merged-away record carried as manual corrections (case 20 of the plan). */
const MERGED_RECORD_SOURCE = 'merged_record';

/**
 * Before a person is merged into another and deleted (duplicates), its values by source move to the kept person
 * instead of disappearing with it: a source the kept person lacks is taken over, a source both have keeps its most
 * recent observation. A manual correction of the absorbed person becomes the `merged_record` source — never the kept
 * person's correction: shown in the record's sources, and a conflict to review when it contradicts a correction of the
 * kept person. The values chosen in the merge assistant are written afterwards, as human choices.
 */
export const moveFieldValues = async (trx: Transaction<DB>, fromPersonId: string, toPersonId: string): Promise<number> => {
  const rows = await trx.selectFrom('person_field_value').selectAll().where('person_id', '=', fromPersonId).execute();
  let moved = 0;
  for (const r of rows) {
    if (!MERGED_FIELDS.includes(r.field)) continue;
    const source = r.source === MANUAL_SOURCE ? MERGED_RECORD_SOURCE : r.source;
    const existing = await trx.selectFrom('person_field_value').select(['id', 'observed_at'])
      .where('person_id', '=', toPersonId).where('field', '=', r.field).where('source', '=', source).executeTakeFirst();
    if (existing && new Date(existing.observed_at as any) >= new Date(r.observed_at as any)) continue;
    const values = {
      value: r.value, asserted_at: r.asserted_at, observed_at: r.observed_at, asserted_by: r.asserted_by,
      import_batch_id: r.import_batch_id, note: `merged from person ${fromPersonId}`,
    } as any;
    if (existing) await trx.updateTable('person_field_value').set(values).where('id', '=', existing.id).execute();
    else await trx.insertInto('person_field_value').values({ ...values, person_id: toPersonId, field: r.field, source }).execute();
    moved++;
  }
  for (const field of new Set(rows.map((r) => r.field).filter((f) => MERGED_FIELDS.includes(f)))) await reprojectField(trx, toPersonId, field);
  return moved;
};

// ── Writes of the application (record form, imports, LDAP, arbitrations, merges) ──────────────────────────────────────

/** Record field (Grist column name used by the commands) → merged field. */
export const MERGED_RECORD_FIELDS: Record<string, 'birth_date' | 'corps_grade'> = {
  DATE_DE_NAISSANCE_JJ_MM_AAAA: 'birth_date',
  Corps_grade: 'corps_grade',
};

/** A value reported by a source in the same operation (an import line, the LDAP entry of an attached record). */
interface FieldObservation {
  source: string;
  value: unknown;
  importBatchId?: string | null;
}

interface MergedWrite {
  /** Value the record must end with: typed in the form, kept in an import review, chosen in an arbitration. */
  value: unknown;
  /** The source that reported a value during the same operation, recorded as its own whatever the outcome. */
  observed?: FieldObservation;
  /**
   * True when `value` is a human choice (record form, import line kept, arbitration, merge of duplicates): if it differs
   * from what the record showed and the merge does not give it, it becomes a manual correction (D2 of druid-internal
   * `docs/plan-maj-chercheurs.md`). False for a source that only reports (LDAP attach): the ranks decide.
   */
  explicit: boolean;
}

const same = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/**
 * Applies one write of the application to a merged field, instead of writing the `person` column: the observed value
 * is stored under its source, then a human choice that changes what the record showed, and that the merge does not
 * give, becomes a manual correction. A value equal to what the record showed is not a choice: the record form sends
 * every field on each save, an unchecked import line keeps the shown value (then only the ranks decide). For the
 * grade, the record shows the emeritus code derived from the stored one (lib/emeritus.ts): that code counts as shown.
 * The author of a correction is the transaction's `druid.actor`.
 */
export const writeMergedField = async (trx: Transaction<DB>, personId: string, field: string, w: MergedWrite): Promise<FieldResolution | null> => {
  assertMerged(field);
  const column = PERSON_COLUMN[field];
  const person = await trx.selectFrom('person').select([column, 'employment_type', 'employment_type_label'] as any)
    .where('id', '=', personId).executeTakeFirstOrThrow() as any;
  const shown = (person[column] ?? null) as string | null;
  const target = normalizeFieldValue(field, w.value);
  const resolution = w.observed ? await observeFieldValue(trx, {
    personId, field, source: w.observed.source, value: w.observed.value, importBatchId: w.observed.importBatchId,
  }) : null;
  if (!w.explicit || same(target, shown)) return resolution;
  if (field === 'corps_grade' && shown && same(target, resolveGrade(shown, {
    grade: shown, typeEmploi: person.employment_type, libTypeEmploi: person.employment_type_label,
  }))) return resolution;
  if (resolution && same(target, resolution.value)) return resolution;
  const by = (await sql<{ actor: string | null }>`SELECT nullif(current_setting('druid.actor', true), '') AS actor`.execute(trx)).rows[0]?.actor;
  return correctFieldValue(trx, personId, field, target, by || 'unknown');
};


const provenanceOf = (rows: FieldValue[], res: FieldResolution): FieldProvenance => {
  const manual = rows.find((r) => r.source === MANUAL_SOURCE);
  return {
    source: res.source, refinedBy: res.refinedBy, conflicts: res.conflicts.length, value: res.value,
    ...(manual ? { correctedBy: manual.assertedBy ?? null, correctedAt: manual.assertedAt } : {}),
  };
};

/**
 * Sources of the merged fields of one person (the record's « sources » panel): each source with its value, rank and
 * how it diverges from the shown value, the shown value and its source.
 */
export const readFieldSources = async (db: Transaction<DB> | any, personId: string): Promise<Record<string, { value: string | null; source: string | null; provenance: FieldProvenance; sources: FieldSourceDetail[] }>> => {
  const ranks = await readSourceRanks(db);
  const out: Record<string, { value: string | null; source: string | null; provenance: FieldProvenance; sources: FieldSourceDetail[] }> = {};
  for (const field of MERGED_FIELDS) {
    const fieldRanks = ranks.get(field) ?? new Map<string, number>();
    const rows = await readFieldValues(db, personId, field);
    const res = resolveField(field, rows, fieldRanks);
    const kindOf = new Map(res.divergences.map((d) => [d.source, d.kind]));
    out[field] = {
      value: res.value,
      source: res.source,
      provenance: provenanceOf(rows, res),
      sources: rows
        .map((r) => ({
          source: r.source, value: r.value, observedAt: r.observedAt, assertedBy: r.assertedBy ?? null,
          rank: r.source === MANUAL_SOURCE ? null : (fieldRanks.get(r.source) ?? null),
          kind: (kindOf.get(r.source) ?? '') as FieldSourceDetail['kind'],
        }))
        .sort((a, b) => (a.rank ?? -1) - (b.rank ?? -1) || a.source.localeCompare(b.source)),
    };
  }
  return out;
};

/** Provenance of every merged field of every person (one read of person_field_value; resolved in memory). */
export const readFieldProvenance = async (db: Transaction<DB> | any): Promise<Map<string, Record<string, FieldProvenance>>> => {
  const ranks = await readSourceRanks(db);
  const groups = new Map<string, FieldValue[]>();
  for (const r of await db.selectFrom('person_field_value').selectAll().execute()) {
    const key = `${r.person_id}\u0000${r.field}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(toFieldValue(r));
  }
  const out = new Map<string, Record<string, FieldProvenance>>();
  for (const [key, rows] of groups) {
    const [personId, field] = key.split('\u0000');
    if (!MERGED_FIELDS.includes(field)) continue;
    const res = resolveField(field, rows, ranks.get(field) ?? new Map());
    if (!out.has(personId)) out.set(personId, {});
    out.get(personId)![field] = provenanceOf(rows, res);
  }
  return out;
};
