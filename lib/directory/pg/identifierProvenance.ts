// Provenance of the identifiers (lot 4 b of druid-internal `docs/plan-maj-chercheurs.md`): which source brought each
// value of person_identifier, and the « Rejeté » decision a removal typed in the record leaves for the alignments.
// person_identifier stays the list the record shows; this module only records (person_identifier_source) and reads.
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import type { IdentifierSourceDetail } from '../../../types';

/** Identifiers whose provenance is kept. */
export const PROVENANCE_SCHEMES = ['orcid', 'idref', 'idhal', 'idhal_i', 'scopus', 'openalex'] as const;
const TRACKED = new Set<string>(PROVENANCE_SCHEMES);

/** Alignment source (alignment_candidate.source) whose candidates are values of the scheme. */
export const ALIGN_SOURCE_OF_SCHEME: Record<string, string> = {
  orcid: 'orcid', idref: 'idref', idhal_i: 'hal', scopus: 'scopus', openalex: 'openalex',
};

/** Sync traces a write carries (`<Source>_derniere_maj`): the alignment it applies. */
const TRACE = /^(IdRef|HAL|ORCID|OpenAlex|Scopus|LDAP)_derniere_maj$/;

/** Author of the transaction (druid.actor) and whether it is a person (not a job, an import script, the tables view). */
export const actorOf = async (trx: Transaction<DB>): Promise<{ actor: string | null; human: boolean }> => {
  const actor = (await sql<{ actor: string | null }>`SELECT nullif(current_setting('druid.actor', true), '') AS actor`.execute(trx)).rows[0]?.actor ?? null;
  return { actor, human: !!actor && actor !== 'server' && !/^[a-z_-]+:/.test(actor) };
};

/**
 * Source of the identifiers a write brings: the one its caller names (an import, the LDAP), else the alignment whose
 * trace the write carries (`align:orcid`…), else `manual` for a person and `job` for a script.
 */
export const identifierSourceOf = (fieldKeys: Iterable<string>, explicit: string | undefined, human: boolean): string => {
  if (explicit) return explicit;
  for (const k of fieldKeys) {
    const m = TRACE.exec(k);
    if (m && m[1] !== 'LDAP') return `align:${m[1].toLowerCase()}`;
  }
  return human ? 'manual' : 'job';
};

/** Records that `source` brought or confirmed these values (a confirmation only moves observed_at). */
export const recordIdentifierValues = async (trx: Transaction<DB>, personId: string, scheme: string, values: string[], source: string,
  by: string | null, importBatchId?: string | null): Promise<void> => {
  if (!TRACKED.has(scheme)) return;
  const now = new Date().toISOString();
  for (const value of [...new Set(values.map((v) => String(v).trim()).filter(Boolean))]) {
    await trx.insertInto('person_identifier_source')
      .values({ person_id: personId, scheme, value, source, asserted_by: by, asserted_at: now, observed_at: now, import_batch_id: importBatchId ?? null } as any)
      .onConflict((oc) => oc.columns(['person_id', 'scheme', 'value', 'source']).doUpdateSet({ observed_at: now } as any))
      .execute();
  }
};

/**
 * A value removed from the record by a person is « Rejeté » for the alignment of its source: the alignments stop
 * proposing it and the automatic writers (sync_openalex, sync_hal) stop writing it back. Only for a removal typed in
 * the record (pg/commands.ts): a batch applying alignment proposals may remove values a later run must be able to
 * restore (case of 2026-11-13, plan § Lot 4).
 */
export const rememberRemovedIdentifiers = async (trx: Transaction<DB>, personId: string, scheme: string, removed: string[], by: string): Promise<number> => {
  const source = ALIGN_SOURCE_OF_SCHEME[scheme];
  if (!source) return 0;
  let n = 0;
  for (const value of [...new Set(removed.map((v) => String(v).trim()).filter(Boolean))]) {
    await trx.insertInto('alignment_candidate')
      .values({ person_id: personId, source, candidate_id: value, decision: 'Rejeté', note: 'Retiré dans la fiche', decided_by: by, decided_at: new Date().toISOString(), payload: JSON.stringify({}) } as any)
      .onConflict((oc) => oc.columns(['person_id', 'source', 'candidate_id']).doUpdateSet({
        decision: 'Rejeté', note: 'Retiré dans la fiche', decided_by: by, decided_at: new Date().toISOString(),
      } as any))
      .execute();
    n++;
  }
  return n;
};

/** A value typed again in the record by a person: its « Rejeté » is lifted (the person changed their mind). */
export const liftRejection = async (trx: Transaction<DB>, personId: string, scheme: string, values: string[]): Promise<void> => {
  const source = ALIGN_SOURCE_OF_SCHEME[scheme];
  if (!source || !values.length) return;
  await trx.deleteFrom('alignment_candidate').where('person_id', '=', personId).where('source', '=', source)
    .where('candidate_id', 'in', values).where('decision', '=', 'Rejeté').execute();
};

/** Identifiers of a person with their sources, and the values set aside (« Rejeté », « Identité mêlée »). */
export const readIdentifierSources = async (db: Transaction<DB> | any, personId: string): Promise<Record<string, IdentifierSourceDetail[]>> => {
  const [current, provenance, decisions] = await Promise.all([
    db.selectFrom('person_identifier').select(['scheme', 'value', 'is_primary']).where('person_id', '=', personId)
      .where('scheme', 'in', [...PROVENANCE_SCHEMES]).execute(),
    db.selectFrom('person_identifier_source').select(['scheme', 'value', 'source', 'asserted_by', 'asserted_at', 'observed_at'])
      .where('person_id', '=', personId).orderBy('asserted_at').execute(),
    db.selectFrom('alignment_candidate').select(['source', 'candidate_id', 'decision', 'decided_by', 'decided_at'])
      .where('person_id', '=', personId).where('decision', 'in', ['Rejeté', 'Identité mêlée']).execute(),
  ]);
  const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);
  const out: Record<string, IdentifierSourceDetail[]> = {};
  const entry = (scheme: string, value: string): IdentifierSourceDetail => {
    out[scheme] ??= [];
    let e = out[scheme].find((x) => x.value === value);
    if (!e) { e = { value, shown: false, primary: false, sources: [], setAside: null }; out[scheme].push(e); }
    return e;
  };
  for (const c of current) Object.assign(entry(c.scheme, c.value), { shown: true, primary: !!c.is_primary });
  for (const p of provenance) {
    entry(p.scheme, p.value).sources.push({ source: p.source, by: p.asserted_by ?? null, at: iso(p.asserted_at)!, lastSeen: iso(p.observed_at)! });
  }
  for (const d of decisions) {
    const scheme = Object.keys(ALIGN_SOURCE_OF_SCHEME).find((s) => ALIGN_SOURCE_OF_SCHEME[s] === d.source);
    if (scheme) entry(scheme, d.candidate_id).setAside = { decision: d.decision, by: d.decided_by ?? null, at: iso(d.decided_at) };
  }
  for (const list of Object.values(out)) list.sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.shown) - Number(a.shown) || a.value.localeCompare(b.value));
  return out;
};
