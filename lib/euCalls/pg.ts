// PostgreSQL store of the « European calls » tab (druid-internal docs/plan-eu-calls.md, lot 2): import of a
// Topic-to-Researcher Match report (one run per cluster, the previous run of the cluster being replaced), reads of
// the tab, feedback of the users on the pairs. Server side only.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import type { EuMatch, EuTopic, FeedbackVerdict } from './aggregate';
import type { MatchOverall, TrmRun } from './trm';

type Queryable = Kysely<DB> | Transaction<DB>;

export const FEEDBACK_VERDICTS: readonly FeedbackVerdict[] = ['relevant', 'not_relevant', 'already_applying'];

export interface EuCallsRunSummary {
  runId: string;
  cluster: string;
  startedAt: string;
  model: string;
  topics: number;
  failedTopics: number;
  matches: number;
  importedAt: string;
}

export interface EuCallsOverview {
  runs: EuCallsRunSummary[];
  topics: number;
  matches: number;
}

export interface ImportReport {
  runId: string;
  cluster: string;
  topics: number;
  matches: number;
  /** Run of the same cluster this import replaced, if any. */
  replacedRunId: string | null;
  /** With `merge`: run of the cluster the topics of the report were added to. */
  mergedIntoRunId: string | null;
}

export interface ImportOptions {
  /** The report completes the run already imported for its cluster (topics replayed after a failure of the batch):
   * its topics and their matches replace the same topics of that run, the other topics stay. Without a previous run
   * the report is imported as a run of its own. */
  merge?: boolean;
}

export interface MatchesQuery {
  /** Directory uids the caller may see (lab scope); undefined = every match. */
  uids?: string[];
  topicId?: string;
  /** User whose own verdict is reported in `mine`. */
  viewer: string;
}

const iso = (v: Date | string | null | undefined): string => (v instanceof Date ? v.toISOString() : v ?? '');

export const createEuCallsStore = (db: Kysely<DB>) => {
  const importRun = async (run: TrmRun, importedBy: string, options: ImportOptions = {}): Promise<ImportReport> =>
    db.transaction().execute(async (trx) => {
      // One importer at a time: two imports of the same cluster would both delete then insert.
      await sql`SELECT pg_advisory_xact_lock(hashtext('druid.eu_calls_import'))`.execute(trx);
      const previous = await trx.selectFrom('eu_topic_match_run').select(['run_id', 'topics', 'failed_topics'])
        .where('cluster', '=', run.cluster).executeTakeFirst();
      const merge = !!options.merge && !!previous;
      if (previous && !merge) await trx.deleteFrom('eu_topic_match_run').where('run_id', '=', previous.run_id).execute();
      for (const t of run.topics) {
        await trx.insertInto('eu_topic')
          .values({ topic_id: t.topicId, cluster: t.cluster, title: t.title, call_id: t.callId, destination: t.destination, deadlines: t.deadlines, summary: t.summary })
          .onConflict((oc) => oc.column('topic_id').doUpdateSet({
            cluster: t.cluster, title: t.title, call_id: t.callId, destination: t.destination, deadlines: t.deadlines, summary: t.summary, updated_at: sql`now()`,
          }))
          .execute();
      }
      let runId = run.runId;
      if (merge) {
        runId = previous!.run_id;
        const topicIds = run.topics.map((t) => t.topicId);
        if (topicIds.length) await trx.deleteFrom('eu_topic_match').where('run_id', '=', runId).where('topic_id', 'in', topicIds).execute();
        // The replayed topics were counted as failed by the first run.
        await trx.updateTable('eu_topic_match_run').set({
          topics: previous!.topics + run.topics.length, failed_topics: Math.max(0, previous!.failed_topics - run.topics.length),
          imported_at: sql`now()`, imported_by: importedBy,
        }).where('run_id', '=', runId).execute();
      } else {
        await trx.insertInto('eu_topic_match_run').values({
          run_id: runId, cluster: run.cluster, started_at: run.startedAt || sql`now()`, model: run.model,
          settings: JSON.stringify(run.settings), topics: run.topics.length, failed_topics: run.failedTopics.length, imported_by: importedBy,
        }).execute();
      }
      // A match of a topic in error cannot exist (the parser drops them); a match of a topic absent from the report is
      // refused by the foreign key, which is what we want.
      for (const m of run.matches) {
        await trx.insertInto('eu_topic_match').values({
          pair_id: m.pairId, run_id: runId, topic_id: m.topicId, person_uid: m.personUid, uid: m.uid, person_name: m.personName,
          units: m.units, score: m.score, raw_score: m.rawScore, overall: m.overall, justification: m.justification,
          publications: JSON.stringify(m.publications),
        }).execute();
      }
      return {
        runId, cluster: run.cluster, topics: run.topics.length, matches: run.matches.length,
        replacedRunId: previous && !merge ? previous.run_id : null, mergedIntoRunId: merge ? runId : null,
      };
    });

  const overview = async (): Promise<EuCallsOverview> => {
    const runs = await db.selectFrom('eu_topic_match_run as r')
      .leftJoin('eu_topic_match as m', 'm.run_id', 'r.run_id')
      .select(['r.run_id', 'r.cluster', 'r.started_at', 'r.model', 'r.topics', 'r.failed_topics', 'r.imported_at'])
      .select((eb) => eb.fn.count<string>('m.pair_id').as('matches'))
      .groupBy(['r.run_id', 'r.cluster', 'r.started_at', 'r.model', 'r.topics', 'r.failed_topics', 'r.imported_at'])
      .orderBy('r.cluster').execute();
    const topics = await db.selectFrom('eu_topic').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    return {
      runs: runs.map((r) => ({
        runId: r.run_id, cluster: r.cluster, startedAt: iso(r.started_at), model: r.model, topics: r.topics, failedTopics: r.failed_topics,
        matches: Number(r.matches), importedAt: iso(r.imported_at),
      })),
      topics: Number(topics.n),
      matches: runs.reduce((n, r) => n + Number(r.matches), 0),
    };
  };

  const topics = async (): Promise<EuTopic[]> =>
    (await db.selectFrom('eu_topic').selectAll().orderBy('cluster').orderBy('topic_id').execute()).map((t) => ({
      topicId: t.topic_id, cluster: t.cluster, title: t.title, callId: t.call_id, destination: t.destination, deadlines: t.deadlines, summary: t.summary,
    }));

  const matches = async (query: MatchesQuery): Promise<EuMatch[]> => {
    if (query.uids && query.uids.length === 0) return [];
    let q = db.selectFrom('eu_topic_match').selectAll();
    if (query.uids) q = q.where('uid', 'in', query.uids);
    if (query.topicId) q = q.where('topic_id', '=', query.topicId);
    const rows = await q.orderBy('topic_id').orderBy('score', 'desc').execute();
    if (!rows.length) return [];
    const pairIds = rows.map((r) => r.pair_id);
    const feedback = await db.selectFrom('eu_topic_feedback').select(['pair_id', 'author', 'verdict'])
      .where('pair_id', 'in', pairIds).execute();
    const counts = new Map<string, Partial<Record<FeedbackVerdict, number>>>();
    const mine = new Map<string, FeedbackVerdict>();
    for (const f of feedback) {
      const verdict = f.verdict as FeedbackVerdict;
      const c = counts.get(f.pair_id) ?? {};
      c[verdict] = (c[verdict] ?? 0) + 1;
      counts.set(f.pair_id, c);
      if (f.author === query.viewer) mine.set(f.pair_id, verdict);
    }
    return rows.map((r) => ({
      pairId: r.pair_id, topicId: r.topic_id, uid: r.uid, personName: r.person_name, units: r.units, score: r.score,
      overall: r.overall as MatchOverall, justification: r.justification,
      publications: (Array.isArray(r.publications) ? r.publications : []) as EuMatch['publications'],
      feedback: counts.get(r.pair_id) ?? {}, mine: mine.get(r.pair_id) ?? null,
    }));
  };

  /** Records (or replaces) the verdict of `author` on a pair; false when the pair is unknown. */
  const saveFeedback = async (input: { pairId: string; author: string; verdict: FeedbackVerdict; comment: string }): Promise<boolean> => {
    const known = await db.selectFrom('eu_topic_match').select('pair_id').where('pair_id', '=', input.pairId).executeTakeFirst();
    if (!known) return false;
    await db.insertInto('eu_topic_feedback').values({ pair_id: input.pairId, author: input.author, verdict: input.verdict, comment: input.comment })
      .onConflict((oc) => oc.columns(['pair_id', 'author']).doUpdateSet({ verdict: input.verdict, comment: input.comment, created_at: sql`now()` }))
      .execute();
    return true;
  };

  /** Ids of every topic known (to refresh their titles from the portal). */
  const topicIds = async (cluster?: string): Promise<string[]> => {
    let q = db.selectFrom('eu_topic').select('topic_id');
    if (cluster) q = q.where('cluster', '=', cluster);
    return (await q.execute()).map((r) => r.topic_id);
  };

  /** Replaces the title (and the deadlines when the portal gives some) of the topics; returns the number changed. */
  const updateTopicsFromPortal = async (topics: { topicId: string; title: string; deadlines: string[] }[]): Promise<number> => {
    let changed = 0;
    for (const t of topics) {
      const result = await db.updateTable('eu_topic')
        .set({ title: t.title, ...(t.deadlines.length ? { deadlines: t.deadlines } : {}), updated_at: sql`now()` })
        .where('topic_id', '=', t.topicId)
        .where((eb) => eb.or([eb('title', '<>', t.title), ...(t.deadlines.length ? [eb('deadlines', '<>', sql<string[]>`${t.deadlines}::text[]`)] : [])]))
        .executeTakeFirst();
      changed += Number(result.numUpdatedRows);
    }
    return changed;
  };

  /** Every opinion given, for the evaluation of the batch (CSV export of the administration). */
  const feedbackRows = async () =>
    (await db.selectFrom('eu_topic_feedback as f')
      .leftJoin('eu_topic_match as m', 'm.pair_id', 'f.pair_id')
      .select(['f.pair_id', 'f.author', 'f.verdict', 'f.comment', 'f.created_at', 'm.topic_id', 'm.person_uid', 'm.overall', 'm.score'])
      .orderBy('f.created_at').execute())
      .map((r) => ({ ...r, created_at: iso(r.created_at) }));

  return { importRun, overview, topics, matches, saveFeedback, feedbackRows, topicIds, updateTopicsFromPortal };
};

export type EuCallsStore = ReturnType<typeof createEuCallsStore>;
