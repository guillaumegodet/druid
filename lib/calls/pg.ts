// PostgreSQL store of the « Calls for proposals » tab (druid-internal docs/plan-funding-calls.md, lot 1):
// funders and programmes, import of a Topic-to-Researcher Match report (one run per programme, subset and engine, the
// previous run being replaced), reads of the tab, feedback of the users on the pairs. Server side only.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import type { Call, CallMatch, FeedbackVerdict, ProgrammeView } from './aggregate';
import { BUILT_IN_FUNDERS, BUILT_IN_PROGRAMMES, portalTopicUrl, statusFromDeadlines, type Funder, type FunderCategory, type MatchEngine, type Programme, type ProgrammeKind, type CallStatus } from './programmes';
import type { MatchOverall, TrmRun } from './trm';

type Queryable = Kysely<DB> | Transaction<DB>;

export const FEEDBACK_VERDICTS: readonly FeedbackVerdict[] = ['relevant', 'not_relevant', 'already_applying'];

export interface CallsRunSummary {
  runId: string;
  programmeId: string;
  subset: string;
  engine: MatchEngine;
  /** Perimeter of the engine (structures whose publications carried vectors), '' when not recorded. */
  perimeter: string;
  startedAt: string;
  model: string;
  calls: number;
  failedCalls: number;
  matches: number;
  importedAt: string;
}

export interface CallsOverview {
  runs: CallsRunSummary[];
  calls: number;
  matches: number;
}

export interface ImportReport {
  runId: string;
  programmeId: string;
  subset: string;
  calls: number;
  matches: number;
  /** Run of the same programme and subset this import replaced, if any. */
  replacedRunId: string | null;
  /** With `merge`: run the calls of the report were added to. */
  mergedIntoRunId: string | null;
}

export interface ImportOptions {
  /** The report completes the run already imported for its programme and subset (topics replayed after a failure of
   * the batch): its topics and their matches replace the same topics of that run, the other topics stay. Without a
   * previous run the report is imported as a run of its own. */
  merge?: boolean;
  /** Perimeter the batch was run on (structures whose publications carry vectors), shown by the tab. */
  perimeter?: string;
}

export interface MatchesQuery {
  /** Directory uids the caller may see (lab scope); undefined = every match. */
  uids?: string[];
  callId?: string;
  /** User whose own verdict is reported in `mine`. */
  viewer: string;
}

const iso = (v: Date | string | null | undefined): string => (v instanceof Date ? v.toISOString() : v ?? '');
const dateOnly = (v: Date | string | null | undefined): string | null => (v ? iso(v).slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);
const taxonomyOf = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x != null && x !== '') out[k] = String(x);
  return out;
};

export const createCallsStore = (db: Kysely<DB>) => {
  /** Inserts the funder and the programme when missing (the built-in ones, or those a collector declares). */
  const ensureProgramme = async (trx: Queryable, programme: Programme, funder: Funder): Promise<void> => {
    await trx.insertInto('funder').values({ funder_id: funder.funderId, name: funder.name, country: funder.country, category: funder.category, url: funder.url })
      .onConflict((oc) => oc.column('funder_id').doNothing()).execute();
    await trx.insertInto('funding_programme').values({
      programme_id: programme.programmeId, funder_id: programme.funderId, name: programme.name, kind: programme.kind, url: programme.url,
      source: programme.source, refresh: programme.refresh, subset_label: programme.subsetLabel, active: programme.active,
    }).onConflict((oc) => oc.column('programme_id').doNothing()).execute();
  };

  const importRun = async (run: TrmRun, importedBy: string, options: ImportOptions = {}): Promise<ImportReport> =>
    db.transaction().execute(async (trx) => {
      // One importer at a time: two imports of the same subset would both delete then insert.
      await sql`SELECT pg_advisory_xact_lock(hashtext('druid.calls_import'))`.execute(trx);
      const programme = BUILT_IN_PROGRAMMES.find((p) => p.programmeId === run.programmeId);
      const funder = programme && BUILT_IN_FUNDERS.find((f) => f.funderId === programme.funderId);
      if (programme && funder) await ensureProgramme(trx, programme, funder);
      const previous = await trx.selectFrom('call_match_run').select(['run_id', 'calls', 'failed_calls'])
        .where('programme_id', '=', run.programmeId).where('subset', '=', run.subset).where('engine', '=', 'trm').executeTakeFirst();
      const merge = !!options.merge && !!previous;
      if (previous && !merge) await trx.deleteFrom('call_match_run').where('run_id', '=', previous.run_id).execute();
      const now = today();
      for (const t of run.topics) {
        const taxonomy = JSON.stringify({ ...(t.destination ? { destination: t.destination } : {}), ...(t.callIdentifier ? { call: t.callIdentifier } : {}) });
        const values = {
          programme_id: run.programmeId, subset: t.subset, title: t.title, summary: t.summary, taxonomy, deadlines: t.deadlines,
          url: portalTopicUrl(t.topicId), status: statusFromDeadlines(t.deadlines, now),
        };
        await trx.insertInto('funding_call').values({ call_id: t.topicId, ...values })
          .onConflict((oc) => oc.column('call_id').doUpdateSet({ ...values, updated_at: sql`now()` }))
          .execute();
      }
      let runId = run.runId;
      const perimeter = options.perimeter ?? '';
      if (merge) {
        runId = previous!.run_id;
        const callIds = run.topics.map((t) => t.topicId);
        if (callIds.length) await trx.deleteFrom('call_match').where('run_id', '=', runId).where('call_id', 'in', callIds).execute();
        // The replayed topics were counted as failed by the first run.
        await trx.updateTable('call_match_run').set({
          calls: previous!.calls + run.topics.length, failed_calls: Math.max(0, previous!.failed_calls - run.topics.length),
          imported_at: sql`now()`, imported_by: importedBy, ...(perimeter ? { perimeter } : {}),
        }).where('run_id', '=', runId).execute();
      } else {
        await trx.insertInto('call_match_run').values({
          run_id: runId, programme_id: run.programmeId, subset: run.subset, engine: 'trm', perimeter, started_at: run.startedAt || sql`now()`,
          model: run.model, settings: JSON.stringify(run.settings), calls: run.topics.length, failed_calls: run.failedTopics.length, imported_by: importedBy,
        }).execute();
      }
      // A match of a topic in error cannot exist (the parser drops them); a match of a topic absent from the report is
      // refused by the foreign key, which is what we want.
      for (const m of run.matches) {
        await trx.insertInto('call_match').values({
          pair_id: m.pairId, run_id: runId, call_id: m.topicId, person_uid: m.personUid, uid: m.uid, person_name: m.personName,
          units: m.units, score: m.score, raw_score: m.rawScore, overall: m.overall, justification: m.justification,
          publications: JSON.stringify(m.publications),
        }).execute();
      }
      return {
        runId, programmeId: run.programmeId, subset: run.subset, calls: run.topics.length, matches: run.matches.length,
        replacedRunId: previous && !merge ? previous.run_id : null, mergedIntoRunId: merge ? runId : null,
      };
    });

  const overview = async (): Promise<CallsOverview> => {
    const runs = await db.selectFrom('call_match_run as r')
      .leftJoin('call_match as m', 'm.run_id', 'r.run_id')
      .select(['r.run_id', 'r.programme_id', 'r.subset', 'r.engine', 'r.perimeter', 'r.started_at', 'r.model', 'r.calls', 'r.failed_calls', 'r.imported_at'])
      .select((eb) => eb.fn.count<string>('m.pair_id').as('matches'))
      .groupBy(['r.run_id', 'r.programme_id', 'r.subset', 'r.engine', 'r.perimeter', 'r.started_at', 'r.model', 'r.calls', 'r.failed_calls', 'r.imported_at'])
      .orderBy('r.programme_id').orderBy('r.subset').execute();
    const calls = await db.selectFrom('funding_call').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    return {
      runs: runs.map((r) => ({
        runId: r.run_id, programmeId: r.programme_id, subset: r.subset, engine: r.engine as MatchEngine, perimeter: r.perimeter,
        startedAt: iso(r.started_at), model: r.model, calls: r.calls, failedCalls: r.failed_calls, matches: Number(r.matches), importedAt: iso(r.imported_at),
      })),
      calls: Number(calls.n),
      matches: runs.reduce((n, r) => n + Number(r.matches), 0),
    };
  };

  /** Active programmes with their funder, funders first by category then by name. */
  const programmes = async (): Promise<ProgrammeView[]> =>
    (await db.selectFrom('funding_programme as p').innerJoin('funder as f', 'f.funder_id', 'p.funder_id')
      .select(['p.programme_id', 'p.name', 'p.kind', 'p.subset_label', 'p.url', 'f.funder_id', 'f.name as funder_name', 'f.category'])
      .where('p.active', '=', true).orderBy('f.category').orderBy('f.name').orderBy('p.name').execute())
      .map((p) => ({
        programmeId: p.programme_id, name: p.name, kind: p.kind as ProgrammeKind, subsetLabel: p.subset_label, url: p.url,
        funderId: p.funder_id, funderName: p.funder_name, category: p.category as FunderCategory,
      }));

  const calls = async (): Promise<Call[]> =>
    (await db.selectFrom('funding_call').selectAll().where('review_status', 'in', ['imported', 'validated']).orderBy('programme_id').orderBy('subset').orderBy('call_id').execute()).map((c) => ({
      callId: c.call_id, programmeId: c.programme_id, subset: c.subset, scheme: c.scheme, title: c.title, titleFr: c.title_fr,
      summary: c.summary, summaryFr: c.summary_fr, taxonomy: taxonomyOf(c.taxonomy), openingDate: dateOnly(c.opening_date),
      deadlines: c.deadlines, url: c.url, status: c.status as CallStatus,
    }));

  /** Perimeters of the imported runs (distinct), for the banner of the tab. */
  const perimeters = async (): Promise<string[]> =>
    [...new Set((await db.selectFrom('call_match_run').select('perimeter').orderBy('programme_id').orderBy('subset').execute())
      .map((r) => r.perimeter).filter(Boolean))];

  const matches = async (query: MatchesQuery): Promise<CallMatch[]> => {
    if (query.uids && query.uids.length === 0) return [];
    let q = db.selectFrom('call_match').selectAll();
    if (query.uids) q = q.where('uid', 'in', query.uids);
    if (query.callId) q = q.where('call_id', '=', query.callId);
    const rows = await q.orderBy('call_id').orderBy('score', 'desc').execute();
    if (!rows.length) return [];
    const pairIds = rows.map((r) => r.pair_id);
    const feedback = await db.selectFrom('call_feedback').select(['pair_id', 'author', 'verdict'])
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
      pairId: r.pair_id, callId: r.call_id, uid: r.uid, personName: r.person_name, units: r.units, score: r.score,
      overall: r.overall as MatchOverall, justification: r.justification, justificationFr: r.justification_fr,
      publications: (Array.isArray(r.publications) ? r.publications : []) as CallMatch['publications'],
      eligible: r.eligible, feedback: counts.get(r.pair_id) ?? {}, mine: mine.get(r.pair_id) ?? null,
    }));
  };

  /** Records (or replaces) the verdict of `author` on a pair; false when the pair is unknown. */
  const saveFeedback = async (input: { pairId: string; author: string; verdict: FeedbackVerdict; comment: string }): Promise<boolean> => {
    const known = await db.selectFrom('call_match').select('pair_id').where('pair_id', '=', input.pairId).executeTakeFirst();
    if (!known) return false;
    await db.insertInto('call_feedback').values({ pair_id: input.pairId, author: input.author, verdict: input.verdict, comment: input.comment })
      .onConflict((oc) => oc.columns(['pair_id', 'author']).doUpdateSet({ verdict: input.verdict, comment: input.comment, created_at: sql`now()` }))
      .execute();
    return true;
  };

  /** Ids of the calls of a programme (and subset), to refresh their titles from their source. */
  const callIds = async (programmeId: string, subset?: string): Promise<string[]> => {
    let q = db.selectFrom('funding_call').select('call_id').where('programme_id', '=', programmeId);
    if (subset) q = q.where('subset', '=', subset);
    return (await q.execute()).map((r) => r.call_id);
  };

  /** Replaces the title (and the deadlines when the source gives some) of the calls; returns the number changed. */
  const updateCallsFromSource = async (items: { callId: string; title: string; deadlines: string[] }[]): Promise<number> => {
    let changed = 0;
    const now = today();
    for (const t of items) {
      const result = await db.updateTable('funding_call')
        .set({ title: t.title, ...(t.deadlines.length ? { deadlines: t.deadlines, status: statusFromDeadlines(t.deadlines, now) } : {}), updated_at: sql`now()` })
        .where('call_id', '=', t.callId)
        .where((eb) => eb.or([eb('title', '<>', t.title), ...(t.deadlines.length ? [eb('deadlines', '<>', sql<string[]>`${t.deadlines}::text[]`)] : [])]))
        .executeTakeFirst();
      changed += Number(result.numUpdatedRows);
    }
    return changed;
  };

  /** English texts without a French translation yet (summaries of the calls, justifications of the matches). */
  const pendingTranslations = async () => ({
    calls: (await db.selectFrom('funding_call').select(['call_id', 'summary']).where('summary', '<>', '').where('summary_fr', '=', '').where('lang', '<>', 'fr').execute())
      .map((r) => ({ callId: r.call_id, text: r.summary })),
    matches: (await db.selectFrom('call_match').select(['pair_id', 'justification']).where('justification', '<>', '').where('justification_fr', '=', '').execute())
      .map((r) => ({ pairId: r.pair_id, text: r.justification })),
  });

  const saveTranslations = async (calls: { callId: string; fr: string }[], matches: { pairId: string; fr: string }[]): Promise<void> => {
    for (const c of calls) if (c.fr) await db.updateTable('funding_call').set({ summary_fr: c.fr }).where('call_id', '=', c.callId).execute();
    for (const m of matches) if (m.fr) await db.updateTable('call_match').set({ justification_fr: m.fr }).where('pair_id', '=', m.pairId).execute();
  };

  /** Every opinion given, for the evaluation of the engines (CSV export of the administration). */
  const feedbackRows = async () =>
    (await db.selectFrom('call_feedback as f')
      .leftJoin('call_match as m', 'm.pair_id', 'f.pair_id')
      .leftJoin('call_match_run as r', 'r.run_id', 'm.run_id')
      .select(['f.pair_id', 'f.author', 'f.verdict', 'f.comment', 'f.created_at', 'm.call_id', 'm.person_uid', 'm.overall', 'm.score', 'r.programme_id', 'r.engine'])
      .orderBy('f.created_at').execute())
      .map((r) => ({ ...r, created_at: iso(r.created_at) }));

  return {
    importRun, overview, programmes, calls, perimeters, matches, saveFeedback, feedbackRows, callIds, updateCallsFromSource,
    pendingTranslations, saveTranslations,
  };
};

export type CallsStore = ReturnType<typeof createCallsStore>;
