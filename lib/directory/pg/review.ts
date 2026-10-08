// Alignment reviews on PostgreSQL (druid-internal docs/plan-migration-postgresql.md, lot 6 d): the rows of
// alignment_candidate, presented to the alignment diffs (lib/directory/alignments.ts) as the review records they read
// — one per Grist review table Alignement_<source>: uid_dyna, candidate column, Decision, Note, dates and the source's
// own columns (kept in `payload` by the import) — and the review writes of a rejection applied back to them.
import { sql, Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import type { GristRecord } from '../gristMapping';
import type { UnifiedAlignSource } from '../alignments';

/** Candidate column of each review table. */
export const REVIEW_ID_COLUMN: Record<UnifiedAlignSource, string> = {
  idref: 'PPN_candidat', orcid: 'ORCID_candidat', hal: 'IdHAL_candidat', openalex: 'OpenAlex_candidat', scopus: 'Scopus_candidat',
};
/** Review fields with a column of their own (the others live in `payload`). */
const MAPPED = new Set(['uid_dyna', 'Annuaire_id', 'Decision', 'Note', 'Pousse_le', 'Applique', 'Date_application']);

const day = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/**
 * Review records of a source. The person is named as the review tables name it: its uid, or `g<record id>` for a
 * person without uid (its first membership), the record id going into Annuaire_id.
 */
export const readReviewRecords = async (db: any, source: UnifiedAlignSource): Promise<GristRecord[]> => {
  const rows = await sql<any>`
    SELECT a.*, p.uid, (SELECT min(m.id) FROM membership m WHERE m.person_id = a.person_id) AS record_id
    FROM alignment_candidate a JOIN person p ON p.id = a.person_id
    WHERE a.source = ${source} ORDER BY a.id`.execute(db);
  const idColumn = REVIEW_ID_COLUMN[source];
  return rows.rows.map((r: any) => {
    const payload = (r.payload || {}) as Record<string, any>;
    const recordId = r.record_id === null ? 0 : Number(r.record_id);
    return {
      id: Number(r.id),
      fields: {
        ...payload,
        uid_dyna: r.uid || (recordId ? `g${recordId}` : ''),
        Annuaire_id: recordId,
        [idColumn]: r.candidate_id,
        Decision: r.decision,
        Note: r.note ?? '',
        Pousse_le: r.pushed_on ?? payload.Pousse_le ?? '',
        Applique: !!r.applied,
        Date_application: r.applied_on ?? payload.Date_application ?? '',
      },
    };
  });
};

/** Person named by a review record: its uid, `g<record id>`, else Annuaire_id. */
const personOf = async (trx: Transaction<DB>, fields: Record<string, any>): Promise<string | null> => {
  const uid = String(fields.uid_dyna ?? '').trim();
  const g = /^g(\d+)$/.exec(uid);
  const recordId = g ? Number(g[1]) : uid ? null : Number(fields.Annuaire_id) || null;
  if (uid && !g) {
    const p = await trx.selectFrom('person').select('id').where(sql`lower(uid)`, '=', uid.toLowerCase()).executeTakeFirst();
    if (p) return p.id;
  }
  const id = recordId ?? (Number(fields.Annuaire_id) || null);
  if (!id) return null;
  const m = await trx.selectFrom('membership').select('person_id').where('id', '=', String(id)).executeTakeFirst();
  return m?.person_id ?? null;
};

/** Applies the review writes of a rejection (alignRejectWrites / idrefRejectWrites): new rows, decision changes. */
export const writeReview = async (trx: Transaction<DB>, source: UnifiedAlignSource,
  writes: { toCreate: Record<string, any>[]; toPatch: { id: number; fields: Record<string, any> }[] }): Promise<{ created: number[]; patched: number[] }> => {
  const idColumn = REVIEW_ID_COLUMN[source];
  const created: number[] = [];
  for (const fields of writes.toCreate) {
    const personId = await personOf(trx, fields);
    if (!personId) continue;
    const payload = Object.fromEntries(Object.entries(fields).filter(([k, v]) => !MAPPED.has(k) && k !== idColumn && v !== '' && v !== null && v !== undefined));
    const values = {
      decision: String(fields.Decision || 'À traiter'), note: fields.Note ? String(fields.Note) : null,
      pushed_on: day(fields.Pousse_le), applied: fields.Applique === true, applied_on: day(fields.Date_application),
    };
    const { id } = await trx.insertInto('alignment_candidate')
      .values({ person_id: personId, source, candidate_id: String(fields[idColumn] ?? '').trim(), payload: JSON.stringify(payload) as any, ...values })
      .onConflict((oc) => oc.columns(['person_id', 'source', 'candidate_id']).doUpdateSet({ decision: values.decision, note: values.note, applied_on: values.applied_on }))
      .returning('id').executeTakeFirstOrThrow();
    created.push(Number(id));
  }
  for (const p of writes.toPatch) {
    const set: Record<string, any> = {};
    if ('Decision' in p.fields) set.decision = String(p.fields.Decision);
    if ('Date_application' in p.fields) set.applied_on = day(p.fields.Date_application);
    if ('Note' in p.fields) set.note = p.fields.Note ? String(p.fields.Note) : null;
    if ('Applique' in p.fields) set.applied = p.fields.Applique === true;
    if (Object.keys(set).length) await trx.updateTable('alignment_candidate').set(set).where('id', '=', String(p.id)).execute();
  }
  return { created, patched: writes.toPatch.map((p) => p.id) };
};
