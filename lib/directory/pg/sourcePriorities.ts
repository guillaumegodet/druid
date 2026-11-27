// Order of the sources of the fields merged by source, per instance (lot 5 of druid-internal
// `docs/plan-maj-chercheurs.md`, decision D6: the institution's administrators set it; a change recomputes every record
// of the field, with a preview first, and is logged). The rules of each field (lib/directory/fieldMerge.ts) and the
// precedence of a manual correction are not settings.
import type { Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import { MANUAL_SOURCE, MERGED_FIELDS, resolveField, type FieldValue } from '../fieldMerge';
import { readSourceRanks } from './fieldValues';

export interface FieldSourceOrder {
  field: string;
  /** Ranked sources, most trusted first. */
  sources: { source: string; rank: number; customized: boolean }[];
  /** Sources that gave values for the field but have no rank (they come last). */
  unranked: string[];
}

/** Starting profiles (SaaS onboarding, « apply a profile »): an order of sources applied to every field. */
export const SOURCE_PROFILES: Record<string, string[]> = {
  /** University with a SUPANN LDAP directory: the defaults of the migrations. */
  ldap: ['ldap', 'hr_file', 'partner_directory', 'site', 'lab_file', 'legacy'],
  /** No LDAP access: the HR export first, then the partner directories, the sites and the lab files. */
  no_ldap: ['hr_file', 'partner_directory', 'site', 'lab_file', 'ldap', 'legacy'],
};

const toFieldValue = (r: any): FieldValue => ({
  source: r.source, value: r.value ?? null,
  assertedAt: new Date(r.asserted_at).toISOString(), observedAt: new Date(r.observed_at).toISOString(),
  assertedBy: r.asserted_by ?? null,
  ...(r.source === MANUAL_SOURCE ? { acknowledged: (r.acknowledged ?? {}) as Record<string, string | null> } : {}),
});

export const readSourceOrders = async (db: Transaction<DB> | any): Promise<FieldSourceOrder[]> => {
  const [ranks, seen] = await Promise.all([
    db.selectFrom('field_source_priority').selectAll().orderBy('field').orderBy('rank').execute(),
    db.selectFrom('person_field_value').select(['field', 'source']).distinct().execute(),
  ]);
  return MERGED_FIELDS.map((field) => {
    const sources = ranks.filter((r: any) => r.field === field).map((r: any) => ({ source: r.source, rank: r.rank, customized: !!r.customized }));
    const ranked = new Set(sources.map((s: any) => s.source));
    const unranked: string[] = [...new Set<string>(seen.filter((s: any) => s.field === field && s.source !== MANUAL_SOURCE && !ranked.has(s.source)).map((s: any) => String(s.source)))].sort();
    return { field, sources, unranked };
  });
};

export class SourceOrderError extends Error {}

/** Checks an order: known field, no duplicate, no `manual` (a correction always wins), at least one source. */
const checkOrder = (field: string, order: unknown): string[] => {
  if (!MERGED_FIELDS.includes(field)) throw new SourceOrderError(`Unknown field: ${field}`);
  if (!Array.isArray(order) || !order.length || order.length > 40) throw new SourceOrderError('Invalid order of sources');
  const list = order.map((s) => String(s ?? '').trim());
  if (list.some((s) => !/^[a-z][a-z0-9_:-]{0,60}$/.test(s) || s === MANUAL_SOURCE) || new Set(list).size !== list.length) {
    throw new SourceOrderError('Invalid order of sources');
  }
  return list;
};

export interface SourceOrderEffect {
  /** Persons with values for the field. */
  persons: number;
  /** Persons whose shown value would change, and a few of them. */
  changed: number;
  examples: { personId: string; before: string | null; after: string | null }[];
}

/** Shown value of every person under the given ranks (one read, resolved in memory). */
const effectOf = async (db: Transaction<DB> | any, field: string, ranks: Map<string, number>) => {
  const rows = await db.selectFrom('person_field_value').selectAll().where('field', '=', field).orderBy('person_id').execute();
  const byPerson = new Map<string, FieldValue[]>();
  for (const r of rows) {
    if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, []);
    byPerson.get(r.person_id)!.push(toFieldValue(r));
  }
  const current = await readSourceRanks(db);
  const changes: { personId: string; before: string | null; after: string | null }[] = [];
  for (const [personId, values] of byPerson) {
    const before = resolveField(field, values, current.get(field) ?? new Map()).value;
    const after = resolveField(field, values, ranks).value;
    if ((before ?? '').toLowerCase() !== (after ?? '').toLowerCase()) changes.push({ personId, before, after });
  }
  return { persons: byPerson.size, changes };
};

const ranksOf = (order: string[]) => new Map(order.map((s, i) => [s, (i + 1) * 10]));

/** What an order would change, without writing. */
export const previewSourceOrder = async (db: Transaction<DB> | any, field: string, order: unknown): Promise<SourceOrderEffect> => {
  const list = checkOrder(field, order);
  const { persons, changes } = await effectOf(db, field, ranksOf(list));
  return { persons, changed: changes.length, examples: changes.slice(0, 10) };
};

/**
 * Sets the order of the sources of a field (ranks 10, 20, 30…, marked `customized` so that a later migration never
 * overwrites them) and recomputes the records whose shown value changes. In the caller's transaction (audited).
 */
export const applySourceOrder = async (trx: Transaction<DB>, field: string, order: unknown): Promise<SourceOrderEffect> => {
  const list = checkOrder(field, order);
  const ranks = ranksOf(list);
  const { persons, changes } = await effectOf(trx, field, ranks);
  await trx.deleteFrom('field_source_priority').where('field', '=', field).execute();
  await trx.insertInto('field_source_priority').values(list.map((source, i) => ({ field, source, rank: (i + 1) * 10, customized: true })) as any).execute();
  for (const c of changes) {
    await trx.updateTable('person').set({ [field]: c.after } as any).where('id', '=', c.personId).execute();
  }
  return { persons, changed: changes.length, examples: changes.slice(0, 10) };
};
