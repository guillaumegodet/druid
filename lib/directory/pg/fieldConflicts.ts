// « To process › Source conflicts » (druid-internal `docs/plan-maj-chercheurs.md`, lot 2 d): the fields merged by source
// whose manual correction a source contradicts since it was made, and the three ways to settle one — keep the
// correction, go back to the sources, type another value. PostgreSQL only; admin routes of server.cjs.
import { sql, type Transaction } from 'kysely';
import { withActor, type DB, type Db } from '../../db/client';
import { ApiError } from '../errors';
import { FieldValueError, MANUAL_SOURCE, MERGED_FIELDS, type DivergenceKind } from '../fieldMerge';
import { correctFieldValue, dropFieldCorrection, keepFieldCorrection, listFieldConflicts, reprojectField } from './fieldValues';
import { PROVENANCE_SCHEMES, listIdentifierConflicts, resolveIdentifierConflict, type IdentifierConflictKind } from './identifierProvenance';

interface FieldConflictItem {
  personId: string;
  /** A directory row of the person, to open the record. */
  recordId: number | null;
  uid: string;
  name: string;
  labs: string[];
  field: string;
  /** Value shown (the manual correction) and its author. */
  value: string | null;
  correctedBy: string | null;
  correctedAt: string | null;
  conflicts: { source: string; value: string; observedAt: string; kind: DivergenceKind }[];
}

type FieldConflictAction = 'keep' | 'drop' | 'correct';

/** An identifier to review (lot 4 b): set aside by a person but brought again by a source, or still shown. */
export interface IdentifierConflictItem {
  personId: string;
  recordId: number | null;
  uid: string;
  name: string;
  labs: string[];
  scheme: string;
  value: string;
  kind: IdentifierConflictKind;
  rejectedBy: string | null;
  rejectedAt: string | null;
  sources: { source: string; at: string }[];
}

/** A file or site import (import_batch of kind `import`) and the values it still brings (case 19 of the plan). */
export interface FieldImportItem {
  id: string;
  /** Source of its values: `site`, `lab_file`… */
  source: string;
  label: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Values of the import still recorded, and the persons they concern (0 once cancelled). */
  values: number;
  persons: number;
  undoneAt: string | null;
  undoneBy: string | null;
}

/** A transaction audited under `actor`; given a transaction (tests, a job chaining steps), runs in it. */
const asActor = async <T>(db: Db, actor: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> => {
  if (!(db as any).isTransaction) return withActor(db, actor, fn);
  await sql`SELECT set_config('druid.actor', ${actor}, true)`.execute(db);
  return fn(db as unknown as Transaction<DB>);
};

export const createFieldConflictsStore = (db: Db) => ({
  async list(): Promise<FieldConflictItem[]> {
    const found: { personId: string; field: string; resolution: Awaited<ReturnType<typeof listFieldConflicts>>[number]['resolution'] }[] = [];
    for (const field of MERGED_FIELDS) {
      for (const c of await listFieldConflicts(db as any, field)) found.push({ personId: c.personId, field, resolution: c.resolution });
    }
    if (!found.length) return [];
    const ids = [...new Set(found.map((f) => f.personId))];
    const [persons, memberships, manual] = await Promise.all([
      db.selectFrom('person').select(['id', 'uid', 'last_name', 'first_name']).where('id', 'in', ids).execute(),
      db.selectFrom('membership').select(['id', 'person_id', 'lab_label']).where('person_id', 'in', ids).orderBy('id').execute(),
      db.selectFrom('person_field_value').select(['person_id', 'field', 'asserted_by', 'asserted_at'])
        .where('person_id', 'in', ids).where('source', '=', MANUAL_SOURCE).execute(),
    ]);
    const personOf = new Map(persons.map((p) => [p.id, p]));
    const manualOf = new Map(manual.map((m) => [`${m.person_id}|${m.field}`, m]));
    return found.map(({ personId, field, resolution }) => {
      const p = personOf.get(personId);
      const rows = memberships.filter((m) => m.person_id === personId);
      const m = manualOf.get(`${personId}|${field}`);
      return {
        personId,
        recordId: rows.length ? Number(rows[0].id) : null,
        uid: p?.uid ?? '',
        name: p ? `${String(p.last_name).toUpperCase()} ${p.first_name ?? ''}`.trim() : personId,
        labs: [...new Set(rows.map((r) => r.lab_label).filter((l): l is string => !!l))],
        field,
        value: resolution.value,
        correctedBy: m?.asserted_by ?? null,
        correctedAt: m?.asserted_at ? new Date(m.asserted_at as any).toISOString() : null,
        conflicts: resolution.conflicts.map((c) => ({ source: c.source, value: c.value, observedAt: c.observedAt, kind: c.kind })),
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.field.localeCompare(b.field));
  },

  /** Identifiers to review, with the record to open. */
  async identifierConflicts(): Promise<IdentifierConflictItem[]> {
    const found = await listIdentifierConflicts(db as any);
    if (!found.length) return [];
    const ids = [...new Set(found.map((f) => f.personId))];
    const [persons, memberships] = await Promise.all([
      db.selectFrom('person').select(['id', 'uid', 'last_name', 'first_name']).where('id', 'in', ids).execute(),
      db.selectFrom('membership').select(['id', 'person_id', 'lab_label']).where('person_id', 'in', ids).orderBy('id').execute(),
    ]);
    const personOf = new Map(persons.map((p) => [p.id, p]));
    return found.map((f) => {
      const p = personOf.get(f.personId);
      const rows = memberships.filter((m) => m.person_id === f.personId);
      return {
        ...f,
        recordId: rows.length ? Number(rows[0].id) : null,
        uid: p?.uid ?? '',
        name: p ? `${String(p.last_name).toUpperCase()} ${p.first_name ?? ''}`.trim() : f.personId,
        labs: [...new Set(rows.map((r) => r.lab_label).filter((l): l is string => !!l))],
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.scheme.localeCompare(b.scheme));
  },

  /** Keeps the rejection of an identifier, or accepts the value; audited under `actor`. */
  async resolveIdentifier(input: { personId?: unknown; scheme?: unknown; value?: unknown; action?: unknown }, actor: string): Promise<void> {
    const personId = typeof input.personId === 'string' ? input.personId : '';
    const scheme = typeof input.scheme === 'string' ? input.scheme : '';
    const value = typeof input.value === 'string' ? input.value.trim() : '';
    const action = input.action as 'keep' | 'accept';
    if (!/^[0-9a-f-]{36}$/i.test(personId) || !(PROVENANCE_SCHEMES as readonly string[]).includes(scheme) || !value || !['keep', 'accept'].includes(action)) {
      throw new ApiError(400, 'Invalid source conflict decision');
    }
    await asActor(db, actor, (trx) => resolveIdentifierConflict(trx, personId, scheme, value, action, actor));
  },

  /** The latest file and site imports, with the values each still brings. */
  async imports(limit = 30): Promise<FieldImportItem[]> {
    const rows = await db.selectFrom('import_batch as b')
      .leftJoin('person_field_value as v', 'v.import_batch_id', 'b.id')
      .select((eb) => ['b.id', 'b.source', 'b.label', 'b.created_at', 'b.created_by', 'b.undone_at', 'b.undone_by',
        eb.fn.count('v.id').as('values'), eb.fn.count('v.person_id').distinct().as('persons')])
      .where('b.kind', '=', 'import')
      .groupBy(['b.id', 'b.source', 'b.label', 'b.created_at', 'b.created_by', 'b.undone_at', 'b.undone_by'])
      .orderBy('b.id', 'desc').limit(limit).execute();
    const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);
    return rows.map((r: any) => ({
      id: String(r.id), source: r.source, label: r.label ?? null, createdAt: iso(r.created_at)!, createdBy: r.created_by ?? null,
      values: Number(r.values), persons: Number(r.persons), undoneAt: iso(r.undone_at), undoneBy: r.undone_by ?? null,
    }));
  },

  /**
   * « Cancel an import »: removes the values the import still brings to the fields merged by source and recomputes the
   * records (the other sources, or a manual correction, give the value again). Its records, memberships and
   * identifiers stay: they are not values by source. Audited under `actor`.
   */
  async undoImport(batchId: unknown, actor: string): Promise<{ values: number; persons: number }> {
    const id = typeof batchId === 'string' && /^\d+$/.test(batchId) ? batchId : '';
    if (!id) throw new ApiError(400, 'Invalid import');
    return asActor(db, actor, async (trx) => {
      const batch = await trx.selectFrom('import_batch').select(['id', 'undone_at']).where('id', '=', id).where('kind', '=', 'import').executeTakeFirst();
      if (!batch) throw new ApiError(404, 'Unknown import');
      if (batch.undone_at) throw new ApiError(409, 'This import was already cancelled');
      const removed = await trx.deleteFrom('person_field_value').where('import_batch_id', '=', id).returning(['person_id', 'field']).execute();
      const pairs = new Map(removed.map((r) => [`${r.person_id}|${r.field}`, r]));
      for (const r of pairs.values()) await reprojectField(trx, r.person_id, r.field);
      await trx.updateTable('import_batch').set({ undone_at: new Date().toISOString(), undone_by: actor } as any).where('id', '=', id).execute();
      return { values: removed.length, persons: new Set(removed.map((r) => r.person_id)).size };
    });
  },

  /** Settles one conflict, audited under `actor`. */
  async resolve(input: { personId?: unknown; field?: unknown; action?: unknown; value?: unknown }, actor: string): Promise<void> {
    const personId = typeof input.personId === 'string' ? input.personId : '';
    const field = typeof input.field === 'string' ? input.field : '';
    const action = input.action as FieldConflictAction;
    if (!/^[0-9a-f-]{36}$/i.test(personId) || !MERGED_FIELDS.includes(field) || !['keep', 'drop', 'correct'].includes(action)) {
      throw new ApiError(400, 'Invalid source conflict decision');
    }
    try {
      await asActor(db, actor, async (trx) => {
        if (action === 'keep') await keepFieldCorrection(trx, personId, field, actor);
        else if (action === 'drop') await dropFieldCorrection(trx, personId, field);
        else await correctFieldValue(trx, personId, field, input.value, actor);
      });
    } catch (e) {
      if (e instanceof FieldValueError) throw new ApiError(400, e.message);
      throw e;
    }
  },
});
