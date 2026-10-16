// PostgreSQL store of the « Calls for proposals » tab (druid-internal docs/plan-funding-calls.md, lot 1):
// funders and programmes, import of a Topic-to-Researcher Match report (one run per programme, subset and engine, the
// previous run being replaced), reads of the tab, feedback of the users on the pairs. Server side only.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import type { Call, CallMatch, FeedbackVerdict, ProgrammeView } from './aggregate';
import { BUILT_IN_FUNDERS, BUILT_IN_PROGRAMMES, portalTopicUrl, statusFromDeadlines, type Funder, type FunderCategory, type MatchEngine, type Programme, type ProgrammeKind, type ProgrammeRefresh, type CallStatus } from './programmes';
import type { CollectedCall, CollectorStore, StoredCallSummary } from './collect';
import type { MatchOverall, TrmRun } from './trm';
import type { CallForMatching } from './trmExport';

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

/** A programme as the administration lists it: every programme, active or not, with its counts. */
export interface ProgrammeAdminView extends ProgrammeView {
  source: string;
  refresh: ProgrammeRefresh;
  active: boolean;
  calls: number;
  openCalls: number;
  matches: number;
  lastCollectedAt: string | null;
}

export interface CollectionView {
  id: number;
  source: string;
  programmeIds: string[];
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'done' | 'failed';
  callsSeen: number;
  callsNew: number;
  callsUpdated: number;
  detailsFetched: number;
  error: string;
  startedBy: string;
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

  /** Aligns the funders and programmes declared in the code with the table: new ones are inserted with their initial
   * `active`, known ones get their name, kind, url, source, refresh and subset label refreshed — never their `active`,
   * which belongs to the administrator. */
  const syncProgrammes = async (programmes: readonly Programme[] = BUILT_IN_PROGRAMMES, funders: readonly Funder[] = BUILT_IN_FUNDERS): Promise<void> => {
    for (const f of funders) {
      await db.insertInto('funder').values({ funder_id: f.funderId, name: f.name, country: f.country, category: f.category, url: f.url })
        .onConflict((oc) => oc.column('funder_id').doUpdateSet({ name: f.name, country: f.country, category: f.category, url: f.url })).execute();
    }
    for (const p of programmes) {
      const fields = { funder_id: p.funderId, name: p.name, kind: p.kind, url: p.url, source: p.source, refresh: p.refresh, subset_label: p.subsetLabel };
      await db.insertInto('funding_programme').values({ programme_id: p.programmeId, ...fields, active: p.active })
        .onConflict((oc) => oc.column('programme_id').doUpdateSet({ ...fields, updated_at: sql`now()` })).execute();
    }
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
      // A call collected from its source (it has a text) keeps what the collector wrote: the report only brings the
      // summary of the batch. A call known from the report alone (topics parsed from the work programme PDFs) is
      // written from the report.
      const topicIds = run.topics.map((t) => t.topicId);
      const collected = new Set(topicIds.length ? (await trx.selectFrom('funding_call').select('call_id').where('call_id', 'in', topicIds)
        .where((eb) => eb.or([eb('objectives', '<>', ''), eb('scope', '<>', '')])).execute()).map((r) => r.call_id) : []);
      for (const t of run.topics) {
        // A new summary makes the previous translation stale.
        const summaryFr = sql<string>`CASE WHEN funding_call.summary = ${t.summary} THEN funding_call.summary_fr ELSE '' END`;
        if (collected.has(t.topicId)) {
          await trx.updateTable('funding_call').set({ summary: t.summary, summary_fr: summaryFr, updated_at: sql`now()` })
            .where('call_id', '=', t.topicId).execute();
          continue;
        }
        const taxonomy = JSON.stringify({ ...(t.destination ? { destination: t.destination } : {}), ...(t.callIdentifier ? { call: t.callIdentifier } : {}) });
        const values = {
          programme_id: run.programmeId, subset: t.subset, title: t.title, summary: t.summary, taxonomy, deadlines: t.deadlines,
          url: portalTopicUrl(t.topicId), status: statusFromDeadlines(t.deadlines, now),
        };
        await trx.insertInto('funding_call').values({ call_id: t.topicId, ...values })
          .onConflict((oc) => oc.column('call_id').doUpdateSet({ ...values, summary_fr: summaryFr, updated_at: sql`now()` }))
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
    (await db.selectFrom('funding_call as c').innerJoin('funding_programme as p', 'p.programme_id', 'c.programme_id').selectAll('c')
      .where('p.active', '=', true).where('c.review_status', 'in', ['imported', 'validated']).orderBy('c.programme_id').orderBy('c.subset').orderBy('c.call_id').execute()).map((c) => ({
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

  /** Calls of a programme (and subset) with the given statuses, with their texts: input of the topics file of the
   * matching batch (lib/calls/trmExport.ts). Calls waiting for a validation or rejected are left out. */
  const callsForMatching = async (programmeId: string, options: { subset?: string; statuses?: readonly CallStatus[] } = {}): Promise<CallForMatching[]> => {
    let q = db.selectFrom('funding_call')
      .select(['call_id', 'subset', 'title', 'objectives', 'scope', 'taxonomy', 'opening_date', 'deadlines', 'status'])
      .where('programme_id', '=', programmeId).where('review_status', 'in', ['imported', 'validated']);
    if (options.subset !== undefined) q = q.where('subset', '=', options.subset);
    if (options.statuses?.length) q = q.where('status', 'in', [...options.statuses]);
    return (await q.orderBy('call_id').execute()).map((c) => ({
      callId: c.call_id, subset: c.subset, title: c.title, objectives: c.objectives, scope: c.scope, taxonomy: taxonomyOf(c.taxonomy),
      openingDate: dateOnly(c.opening_date), deadlines: c.deadlines, status: c.status as CallStatus,
    }));
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
  // The summary is written by the matching batch, in English whatever the language of the call (an ANR call is in
  // French): every summary without its French version is pending.
  const pendingTranslations = async () => ({
    calls: (await db.selectFrom('funding_call').select(['call_id', 'summary']).where('summary', '<>', '').where('summary_fr', '=', '').execute())
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

  // ── Administration (Administration › Calls for proposals) ─────────────────────────────────────────────────────────
  const programmesAdmin = async (): Promise<ProgrammeAdminView[]> => {
    const rows = await db.selectFrom('funding_programme as p').innerJoin('funder as f', 'f.funder_id', 'p.funder_id')
      .select(['p.programme_id', 'p.name', 'p.kind', 'p.subset_label', 'p.url', 'p.source', 'p.refresh', 'p.active', 'p.last_collected_at', 'f.funder_id', 'f.name as funder_name', 'f.category'])
      .orderBy('f.category').orderBy('f.name').orderBy('p.name').execute();
    const counts = await db.selectFrom('funding_call').select(['programme_id'])
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .select((eb) => eb.fn.count<string>(eb.case().when('status', 'in', ['open', 'forthcoming']).then(1).end()).as('open'))
      .groupBy('programme_id').execute();
    const matches = await db.selectFrom('call_match as m').innerJoin('call_match_run as r', 'r.run_id', 'm.run_id')
      .select('r.programme_id').select((eb) => eb.fn.countAll<string>().as('n')).groupBy('r.programme_id').execute();
    const countOf = new Map(counts.map((c) => [c.programme_id, { calls: Number(c.n), open: Number(c.open) }]));
    const matchesOf = new Map(matches.map((m) => [m.programme_id, Number(m.n)]));
    return rows.map((p) => ({
      programmeId: p.programme_id, name: p.name, kind: p.kind as ProgrammeKind, subsetLabel: p.subset_label, url: p.url,
      funderId: p.funder_id, funderName: p.funder_name, category: p.category as FunderCategory,
      source: p.source, refresh: p.refresh as ProgrammeRefresh, active: p.active,
      calls: countOf.get(p.programme_id)?.calls ?? 0, openCalls: countOf.get(p.programme_id)?.open ?? 0, matches: matchesOf.get(p.programme_id) ?? 0,
      lastCollectedAt: p.last_collected_at ? iso(p.last_collected_at) : null,
    }));
  };

  /** Activates or deactivates a programme; false when unknown. */
  const setProgrammeActive = async (programmeId: string, active: boolean): Promise<boolean> => {
    const r = await db.updateTable('funding_programme').set({ active, updated_at: sql`now()` }).where('programme_id', '=', programmeId).executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  };

  /** Active programmes of a source (what a collector works on), or those named. */
  const programmesOfSource = async (source: string, programmeIds?: string[]): Promise<Programme[]> => {
    let q = db.selectFrom('funding_programme').selectAll().where('source', '=', source);
    q = programmeIds?.length ? q.where('programme_id', 'in', programmeIds) : q.where('active', '=', true);
    return (await q.orderBy('programme_id').execute()).map((p) => ({
      programmeId: p.programme_id, funderId: p.funder_id, name: p.name, kind: p.kind as ProgrammeKind, url: p.url, source: p.source,
      refresh: p.refresh as ProgrammeRefresh, subsetLabel: p.subset_label, active: p.active,
    }));
  };

  const startCollection = async (source: string, programmeIds: string[], startedBy: string): Promise<number> => {
    const r = await db.insertInto('call_collection').values({ source, programme_ids: programmeIds, started_by: startedBy }).returning('id').executeTakeFirstOrThrow();
    return Number(r.id);
  };

  const finishCollection = async (id: number, result: { status: 'done' | 'failed'; seen: number; new: number; updated: number; detailsFetched: number; error: string }, programmeIds: string[]): Promise<void> => {
    await db.updateTable('call_collection').set({
      finished_at: sql`now()`, status: result.status, calls_seen: result.seen, calls_new: result.new, calls_updated: result.updated,
      details_fetched: result.detailsFetched, error: result.error.slice(0, 4000),
    }).where('id', '=', String(id)).execute();
    if (result.status === 'done' && programmeIds.length) {
      await db.updateTable('funding_programme').set({ last_collected_at: sql`now()` }).where('programme_id', 'in', programmeIds).execute();
    }
  };

  const collections = async (limit = 20): Promise<CollectionView[]> =>
    (await db.selectFrom('call_collection').selectAll().orderBy('started_at', 'desc').limit(limit).execute()).map((c) => ({
      id: Number(c.id), source: c.source, programmeIds: c.programme_ids, startedAt: iso(c.started_at), finishedAt: c.finished_at ? iso(c.finished_at) : null,
      status: c.status as CollectionView['status'], callsSeen: c.calls_seen, callsNew: c.calls_new, callsUpdated: c.calls_updated,
      detailsFetched: c.details_fetched, error: c.error, startedBy: c.started_by,
    }));

  // ── Store of the collector (lib/calls/collect.ts) ───────────────────────────────────────────────────────────────────
  const collectorStore: CollectorStore = {
    storedCalls: async (programmeIds: string[]): Promise<StoredCallSummary[]> => {
      if (!programmeIds.length) return [];
      return (await db.selectFrom('funding_call').select(['call_id', 'programme_id', 'title', 'deadlines', 'opening_date', 'status', 'content_hash'])
        .select((eb) => eb.or([eb('objectives', '<>', ''), eb('scope', '<>', '')]).as('has_text'))
        .where('programme_id', 'in', programmeIds).execute())
        .map((c) => ({ callId: c.call_id, programmeId: c.programme_id, title: c.title, deadlines: c.deadlines, openingDate: dateOnly(c.opening_date), status: c.status as CallStatus, hasText: !!c.has_text, contentHash: c.content_hash }));
    },
    upsertCall: async (c: CollectedCall): Promise<'new' | 'updated'> => {
      const existing = await db.selectFrom('funding_call').select('call_id').where('call_id', '=', c.callId).executeTakeFirst();
      const fields = {
        programme_id: c.programmeId, subset: c.subset, scheme: c.scheme, title: c.title, objectives: c.objectives, scope: c.scope,
        taxonomy: JSON.stringify(c.taxonomy), opening_date: c.openingDate, deadlines: c.deadlines, budget: JSON.stringify(c.budget),
        url: c.url, lang: c.lang, content_hash: c.contentHash, status: c.status,
      };
      if (existing) {
        await db.updateTable('funding_call').set({ ...fields, updated_at: sql`now()` }).where('call_id', '=', c.callId).execute();
        return 'updated';
      }
      await db.insertInto('funding_call').values({ call_id: c.callId, ...fields }).execute();
      return 'new';
    },
    updateCallDates: async (callId, status, deadlines, openingDate) => {
      await db.updateTable('funding_call').set({ status, deadlines, opening_date: openingDate, updated_at: sql`now()` }).where('call_id', '=', callId).execute();
    },
    removeCalls: async (callIds: string[]): Promise<number> => {
      if (!callIds.length) return 0;
      const deleted = await db.deleteFrom('funding_call').where('call_id', 'in', callIds)
        .where(({ not, exists, selectFrom }) => not(exists(selectFrom('call_match').select('pair_id').whereRef('call_match.call_id', '=', 'funding_call.call_id'))))
        .executeTakeFirst();
      return Number(deleted.numDeletedRows);
    },
  };

  return {
    importRun, overview, programmes, calls, perimeters, matches, saveFeedback, feedbackRows, callIds, callsForMatching, updateCallsFromSource,
    pendingTranslations, saveTranslations, syncProgrammes, programmesAdmin, setProgrammeActive, programmesOfSource,
    startCollection, finishCollection, collections, collectorStore,
  };
};

export type CallsStore = ReturnType<typeof createCallsStore>;
