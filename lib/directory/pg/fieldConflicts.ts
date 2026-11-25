// « To process › Source conflicts » (druid-internal `docs/plan-maj-chercheurs.md`, lot 2 d): the fields merged by source
// whose manual correction a source contradicts since it was made, and the three ways to settle one — keep the
// correction, go back to the sources, type another value. PostgreSQL only; admin routes of server.cjs.
import { withActor, type Db } from '../../db/client';
import { ApiError } from '../errors';
import { FieldValueError, MANUAL_SOURCE, MERGED_FIELDS, type DivergenceKind } from '../fieldMerge';
import { correctFieldValue, dropFieldCorrection, keepFieldCorrection, listFieldConflicts } from './fieldValues';

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

  /** Settles one conflict, audited under `actor`. */
  async resolve(input: { personId?: unknown; field?: unknown; action?: unknown; value?: unknown }, actor: string): Promise<void> {
    const personId = typeof input.personId === 'string' ? input.personId : '';
    const field = typeof input.field === 'string' ? input.field : '';
    const action = input.action as FieldConflictAction;
    if (!/^[0-9a-f-]{36}$/i.test(personId) || !MERGED_FIELDS.includes(field) || !['keep', 'drop', 'correct'].includes(action)) {
      throw new ApiError(400, 'Invalid source conflict decision');
    }
    try {
      await withActor(db, actor, async (trx) => {
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
