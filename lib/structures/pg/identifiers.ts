// Identifiers of the structures on PostgreSQL (druid-internal docs/plan-druid-saas.md, lot 4 a): reads and decisions
// on structure_identifier, and the two-way link with the V2 fields of `structure.extra` — the confirmed primaries are
// projected to the fields the exports and the record read (`ror`, `nns`, `idref`, `hal_collection`, `uai`, `isni`,
// `wikidata`, `scopus`, and the lists `hal_struct_ids` / `openalex_ids`), and a V2 write of one of these fields
// (record form, import, LDAP sync, onboarding seed) confirms the value it carries.
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import {
  PROJECTED_LISTS, STRUCTURE_ID_META, STRUCTURE_ID_TYPES, normalizeStructureId, splitIdList, structureIdUrl, type StructureIdType, type StructureIdentifier,
} from '../identifiers';

const rowToIdentifier = (r: any): StructureIdentifier => ({
  type: r.type, value: r.value, isPrimary: !!r.is_primary, status: r.status, source: r.source, note: r.note ?? null, decidedBy: r.decided_by ?? null,
  checkedAt: r.checked_at ? new Date(r.checked_at).toISOString() : null, checkResult: (r.check_result as Record<string, unknown> | null) ?? null,
  url: structureIdUrl(r.type, r.value),
});

/** Identifiers (confirmed and rejected) of some structures, primary first: structure id → list. */
export const readStructureIdentifiers = async (db: any, structureIds?: number[]): Promise<Map<number, StructureIdentifier[]>> => {
  let q = db.selectFrom('structure_identifier').selectAll().orderBy('structure_id').orderBy('is_primary', 'desc').orderBy('id');
  if (structureIds) {
    if (!structureIds.length) return new Map();
    q = q.where('structure_id', 'in', structureIds.map(String));
  }
  const out = new Map<number, StructureIdentifier[]>();
  for (const r of await q.execute()) {
    const id = Number(r.structure_id);
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(rowToIdentifier(r));
  }
  return out;
};

export interface ConfirmOptions {
  source: string;
  /** Make it the primary of its type (default: when the type is single-valued or has no primary yet). */
  primary?: boolean;
  decidedBy?: string | null;
  note?: string | null;
}

/**
 * Confirms `value` as an identifier of the structure: new row, or a rejected / secondary row brought back. A primary
 * demotes the previous one; a single-valued type always takes the new value as primary. Returns false when the value
 * does not have the type's shape.
 */
export const confirmIdentifier = async (trx: Transaction<DB>, structureId: number, type: StructureIdType, raw: unknown, opts: ConfirmOptions): Promise<boolean> => {
  const value = normalizeStructureId(type, raw);
  if (!value) return false;
  const sid = String(structureId);
  const rows = await trx.selectFrom('structure_identifier').select(['id', 'value', 'is_primary', 'status']).where('structure_id', '=', sid).where('type', '=', type).execute();
  const existing = rows.find((r) => r.value === value);
  const hasPrimary = rows.some((r) => r.is_primary && r.status === 'confirmed' && r.value !== value);
  const primary = opts.primary ?? (!STRUCTURE_ID_META[type].multi || !hasPrimary);
  if (primary && hasPrimary) {
    await trx.updateTable('structure_identifier').set({ is_primary: false }).where('structure_id', '=', sid).where('type', '=', type).where('value', '<>', value).execute();
  }
  if (existing) {
    if (existing.status === 'confirmed' && existing.is_primary === primary) return true;
    await trx.updateTable('structure_identifier')
      .set({ status: 'confirmed', is_primary: primary || (existing.is_primary && existing.status === 'confirmed'), source: opts.source, decided_by: opts.decidedBy ?? null, note: opts.note ?? null })
      .where('id', '=', existing.id).execute();
    return true;
  }
  await trx.insertInto('structure_identifier')
    .values({ structure_id: sid, type, value, is_primary: primary, status: 'confirmed', source: opts.source, decided_by: opts.decidedBy ?? null, note: opts.note ?? null })
    .execute();
  return true;
};

/** Rejects a value (refused by a user: never proposed again); the next confirmed value of the type becomes primary. */
export const rejectIdentifier = async (trx: Transaction<DB>, structureId: number, type: StructureIdType, raw: unknown, opts: { decidedBy?: string | null; note?: string | null; source?: string }): Promise<boolean> => {
  const value = normalizeStructureId(type, raw);
  if (!value) return false;
  const sid = String(structureId);
  const existing = await trx.selectFrom('structure_identifier').select(['id', 'is_primary', 'status']).where('structure_id', '=', sid).where('type', '=', type).where('value', '=', value).executeTakeFirst();
  if (existing) {
    await trx.updateTable('structure_identifier').set({ status: 'rejected', is_primary: false, decided_by: opts.decidedBy ?? null, note: opts.note ?? null }).where('id', '=', existing.id).execute();
  } else {
    await trx.insertInto('structure_identifier').values({ structure_id: sid, type, value, is_primary: false, status: 'rejected', source: opts.source ?? 'manual', decided_by: opts.decidedBy ?? null, note: opts.note ?? null }).execute();
  }
  if (existing?.is_primary) {
    const next = await trx.selectFrom('structure_identifier').select('id').where('structure_id', '=', sid).where('type', '=', type).where('status', '=', 'confirmed').orderBy('id').executeTakeFirst();
    if (next) await trx.updateTable('structure_identifier').set({ is_primary: true }).where('id', '=', next.id).execute();
  }
  return true;
};

/** Makes a confirmed value the primary of its type. */
export const setPrimaryIdentifier = async (trx: Transaction<DB>, structureId: number, type: StructureIdType, raw: unknown): Promise<boolean> => {
  const value = normalizeStructureId(type, raw);
  if (!value) return false;
  const sid = String(structureId);
  const row = await trx.selectFrom('structure_identifier').select('id').where('structure_id', '=', sid).where('type', '=', type).where('value', '=', value).where('status', '=', 'confirmed').executeTakeFirst();
  if (!row) return false;
  await trx.updateTable('structure_identifier').set({ is_primary: false }).where('structure_id', '=', sid).where('type', '=', type).where('id', '<>', row.id).execute();
  await trx.updateTable('structure_identifier').set({ is_primary: true }).where('id', '=', row.id).execute();
  return true;
};

/** The V2 fields the confirmed identifiers project to (what `projectIdentifiers` writes). Pure. */
export const projectedFields = (ids: Pick<StructureIdentifier, 'type' | 'value' | 'isPrimary' | 'status'>[], current: Record<string, any>): Record<string, any> => {
  const confirmed = ids.filter((i) => i.status === 'confirmed');
  const fields: Record<string, any> = {};
  for (const type of STRUCTURE_ID_TYPES) {
    const meta = STRUCTURE_ID_META[type];
    const values = [...confirmed.filter((i) => i.type === type && i.isPrimary), ...confirmed.filter((i) => i.type === type && !i.isPrimary)].map((i) => i.value);
    const list = PROJECTED_LISTS[type];
    if (list) { fields[list] = values.join('|'); continue; }
    if (!meta.v2Field) continue;
    const primary = values[0] ?? '';
    if (type === 'hal_collection') {
      // The field is a URL: kept when it already names the collection (another HAL portal), else hal.science.
      const cur = String(current[meta.v2Field] ?? '');
      fields[meta.v2Field] = !primary ? '' : normalizeStructureId('hal_collection', cur) === primary ? cur : structureIdUrl('hal_collection', primary);
    } else if (type === 'scopus_affil') {
      fields[meta.v2Field] = primary ? Number(primary) : null;
    } else {
      fields[meta.v2Field] = primary;
    }
  }
  return fields;
};

/** Writes the projection of the confirmed identifiers onto the structure row (columns and V2 fields of `extra`). */
export const projectIdentifiers = async (trx: Transaction<DB>, structureId: number): Promise<void> => {
  const sid = String(structureId);
  const row = await trx.selectFrom('structure').select(['extra']).where('id', '=', sid).executeTakeFirst();
  if (!row) return;
  const ids = (await readStructureIdentifiers(trx, [structureId])).get(structureId) ?? [];
  const fields = projectedFields(ids, (row.extra as Record<string, any>) || {});
  const orNull = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v));
  await trx.updateTable('structure')
    .set({ ror: orNull(fields.ror), rnsr: orNull(fields.nns), idref: orNull(fields.idref), extra: sql`extra || ${JSON.stringify(fields)}::jsonb` as any })
    .where('id', '=', sid).execute();
};

/**
 * A V2 write (`fields` = the fields written, the others untouched): every identifier field it carries confirms its
 * value, as a manual entry (`source`). Nothing is rejected here — an emptied field says nothing — the identifiers API
 * does that. Returns the number of confirmations made.
 */
export const confirmIdentifiersFromFields = async (trx: Transaction<DB>, structureId: number, fields: Record<string, any>, source = 'manual'): Promise<number> => {
  let n = 0;
  for (const type of STRUCTURE_ID_TYPES) {
    const list = PROJECTED_LISTS[type];
    const field = list ?? STRUCTURE_ID_META[type].v2Field;
    if (!field || !(field in fields)) continue;
    const values = list ? splitIdList(fields[field]) : [fields[field]];
    for (const [i, v] of values.entries()) {
      const value = normalizeStructureId(type, v);
      if (!value) continue;
      const already = await trx.selectFrom('structure_identifier').select('id').where('structure_id', '=', String(structureId)).where('type', '=', type).where('value', '=', value).where('status', '=', 'confirmed').executeTakeFirst();
      if (already) continue;
      if (await confirmIdentifier(trx, structureId, type, value, { source, primary: list ? i === 0 : undefined })) n++;
    }
  }
  return n;
};
