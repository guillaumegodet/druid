// Structures on PostgreSQL (druid-internal docs/plan-migration-postgresql.md, lot 6): their V2 fields (cdb / SoVisu+
// format: short_labels, inclusions, participations…) live in `extra`, the normalized columns are derived from them on
// every write, as the import does. Shared by the record commands (creation, update) and the LDAP structure sync.
import { sql, Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import type { GristRecord } from '../gristMapping';
import { mapStructureRecords } from '../gristMapping';
import { confirmIdentifiersFromFields } from '../../structures/pg/identifiers';

const orNull = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v));

/** Every structure as { id, fields } in its V2 fields (what the structure mapping and the LDAP diff read). */
export const readStructureRecords = async (db: any): Promise<GristRecord[]> =>
  (await db.selectFrom('structure').select(['id', 'local_id', 'extra']).orderBy('id').execute())
    .map((s: any) => ({ id: Number(s.id), fields: { ...(s.extra as object), local_id: s.local_id } }));

const structureColumns = async (trx: Transaction<DB>, id: number, fields: Record<string, any>) => {
  const [s] = mapStructureRecords([{ id, fields }]);
  const parent = s?.parentStructure
    ? await trx.selectFrom('structure').select('id').where(sql`lower(acronym)`, '=', String(s.parentStructure).toLowerCase()).orderBy('id').executeTakeFirst()
    : undefined;
  const { local_id: localId, ...extra } = fields;
  return {
    local_id: String(localId), acronym: orNull(s?.acronym), name: orNull(s?.officialName), type: orNull(fields.type),
    level: orNull(s?.level), nature: orNull(s?.nature), ror: orNull(fields.ror), rnsr: orNull(fields.nns), idref: orNull(String(fields.idref ?? '').trim()),
    url: orNull(fields.url), parent_id: parent && Number(parent.id) !== id ? parent.id : null, extra: JSON.stringify(extra) as any,
  };
};

/**
 * Writes the whole V2 field set of a structure (normalized columns recomputed). The identifier fields it carries
 * (ror, nns, idref, hal_collection, uai, isni, wikidata, scopus, hal_struct_ids, openalex_ids) confirm their values in
 * structure_identifier (druid-internal docs/plan-druid-saas.md, lot 4 a), as `identifierSource` — `manual` for the
 * record form, `import` for the syncs and seeds.
 */
export const writeStructure = async (trx: Transaction<DB>, id: number, fields: Record<string, any>, identifierSource = 'import'): Promise<void> => {
  await trx.updateTable('structure').set(await structureColumns(trx, id, fields)).where('id', '=', String(id)).execute();
  await confirmIdentifiersFromFields(trx, id, fields, identifierSource);
};

/** Merges some V2 fields into a structure (LDAP sync, record form). */
export const patchStructure = async (trx: Transaction<DB>, id: number, fields: Record<string, any>): Promise<boolean> => {
  const current = await trx.selectFrom('structure').select(['local_id', 'extra']).where('id', '=', String(id)).executeTakeFirst();
  if (!current) return false;
  await writeStructure(trx, id, { ...(current.extra as object), local_id: current.local_id, ...fields });
  return true;
};

export const insertStructure = async (trx: Transaction<DB>, fields: Record<string, any>): Promise<number> => {
  const { id } = await trx.insertInto('structure').values({ local_id: String(fields.local_id), extra: '{}' as any }).returning('id').executeTakeFirstOrThrow();
  await writeStructure(trx, Number(id), fields);
  return Number(id);
};
