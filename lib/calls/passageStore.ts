// PostgreSQL store of the passages of the open calls and their vectors (druid-internal docs/plan-funding-calls.md, lot
// 7, « My project » assistant): written by scripts/embed_calls.ts, read by the server for the search. Server side only.
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.gen';
import type { CallText, PassageSection, ProjectHit, SearchablePassage } from './projectSearch';

const OPEN = ['open', 'forthcoming'];

export interface StoredPassage {
  idx: number;
  section: PassageSection;
  text: string;
  textHash: string;
  model: string;
  embedding: number[];
}

export const createCallPassageStore = (db: Kysely<DB>) => {
  /** Open and forthcoming calls the tab shows (active programme, validated when added by hand), with their texts. */
  const callsToEmbed = async (): Promise<CallText[]> =>
    (await db.selectFrom('funding_call as c').innerJoin('funding_programme as p', 'p.programme_id', 'c.programme_id')
      .select(['c.call_id', 'c.title', 'c.summary', 'c.objectives', 'c.scope'])
      .where('c.status', 'in', OPEN).where('p.active', '=', true).where('c.review_status', 'in', ['imported', 'validated'])
      .orderBy('c.call_id').execute())
      .map((c) => ({ callId: c.call_id, title: c.title, summary: c.summary, objectives: c.objectives, scope: c.scope }));

  /** Hash and model of the stored passages, by call: what is already embedded. */
  const stored = async (): Promise<Map<string, { idx: number; textHash: string; model: string }[]>> => {
    const out = new Map<string, { idx: number; textHash: string; model: string }[]>();
    for (const r of await db.selectFrom('call_passage').select(['call_id', 'idx', 'text_hash', 'model']).orderBy('call_id').orderBy('idx').execute()) {
      const list = out.get(r.call_id) ?? [];
      list.push({ idx: r.idx, textHash: r.text_hash, model: r.model });
      out.set(r.call_id, list);
    }
    return out;
  };

  /** Replaces the passages of a call. */
  const savePassages = async (callId: string, passages: StoredPassage[]): Promise<void> =>
    db.transaction().execute(async (trx) => {
      await trx.deleteFrom('call_passage').where('call_id', '=', callId).execute();
      if (!passages.length) return;
      await trx.insertInto('call_passage').values(passages.map((p) => ({
        call_id: callId, idx: p.idx, section: p.section, text: p.text, text_hash: p.textHash, model: p.model, embedding: p.embedding,
      }))).execute();
    });

  /** Drops the passages of the calls not in `callIds` (closed, gone); returns the number of calls dropped. */
  const dropExcept = async (callIds: string[]): Promise<number> => {
    let q = db.deleteFrom('call_passage');
    if (callIds.length) q = q.where('call_id', 'not in', callIds);
    const rows = await q.returning('call_id').execute();
    return new Set(rows.map((r) => r.call_id)).size;
  };

  /** Changes when the passages change: the server reloads them then. */
  const version = async (): Promise<string> => {
    const r = await db.selectFrom('call_passage').select([sql<string>`count(*)`.as('n'), sql<string>`max(updated_at)`.as('at')]).executeTakeFirst();
    return `${r?.n ?? 0}|${r?.at ?? ''}`;
  };

  /** Passages of the calls still open, with their vectors (model of the search only: another model is not comparable). */
  const searchable = async (model: string): Promise<SearchablePassage[]> =>
    (await db.selectFrom('call_passage as p').innerJoin('funding_call as c', 'c.call_id', 'p.call_id')
      .innerJoin('funding_programme as g', 'g.programme_id', 'c.programme_id')
      .select(['p.call_id', 'p.section', 'p.text', 'p.embedding'])
      .where('p.model', '=', model).where('c.status', 'in', OPEN).where('g.active', '=', true)
      .where('c.review_status', 'in', ['imported', 'validated']).execute())
      .map((r) => ({ callId: r.call_id, section: r.section as PassageSection, text: r.text, vector: Float32Array.from(r.embedding.map(Number)) }));

  /** What the prompt shows of the calls found, by id. */
  const callsInfo = async (callIds: string[]): Promise<Map<string, Omit<ProjectHit, 'callId' | 'score' | 'similarity' | 'queries' | 'best'>>> => {
    if (!callIds.length) return new Map();
    const rows = await db.selectFrom('funding_call as c')
      .innerJoin('funding_programme as p', 'p.programme_id', 'c.programme_id')
      .innerJoin('funder as f', 'f.funder_id', 'p.funder_id')
      .select(['c.call_id', 'c.title', 'c.title_fr', 'c.summary', 'c.scheme', 'c.deadlines', 'c.status', 'c.url', 'p.name as programme', 'f.name as funder'])
      .where('c.call_id', 'in', callIds).execute();
    return new Map(rows.map((r) => [r.call_id, {
      title: r.title, titleFr: r.title_fr, summary: r.summary, scheme: r.scheme, deadlines: r.deadlines, status: r.status, url: r.url,
      programme: r.programme, funder: r.funder,
    }]));
  };

  return { callsToEmbed, stored, savePassages, dropExcept, version, searchable, callsInfo };
};

export type CallPassageStore = ReturnType<typeof createCallPassageStore>;
