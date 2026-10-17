// Reading of a Topic-to-Researcher Match report (crisalid-agents trm/report.py, `trm-<cluster>-<date>.json`): the
// JSON written by the batch becomes calls, a run and matches of the « Calls for proposals » tab (druid-internal
// docs/plan-funding-calls.md, lot 1; formerly the eu_* tables of docs/archive/plan-eu-calls.md). The report is bound
// to one programme (Horizon Europe unless told otherwise) and its `cluster` is the subset of the run. Pure: shared by
// the import script and its tests.
import { HORIZON_EUROPE } from './programmes';

export type MatchOverall = 'strong' | 'plausible' | 'weak' | 'none';

export interface TrmPublication {
  uid: string;
  title: string;
  year: number | null;
  score: number;
  relevant: boolean;
  reason: string;
}

/** A topic of the report: a call of the programme. */
export interface TrmTopic {
  /** Identifier of the topic (HORIZON-CL4-2026-…), the call id of the tab. */
  topicId: string;
  /** Cluster of the topic, the subset of the programme. */
  subset: string;
  title: string;
  /** Identifier of the call of the work programme the topic belongs to (several topics share one). */
  callIdentifier: string;
  destination: string;
  deadlines: string[];
  summary: string;
}

export interface TrmMatch {
  pairId: string;
  topicId: string;
  /** Person of the CRISalid graph (`local-<uid>` for a person of the directory). */
  personUid: string;
  /** Directory uid (Researcher.uid): the graph uid without its `local-` prefix. */
  uid: string;
  personName: string;
  units: string[];
  score: number;
  rawScore: number;
  overall: MatchOverall;
  justification: string;
  publications: TrmPublication[];
}

export interface TrmRun {
  runId: string;
  programmeId: string;
  /** Cluster of the report. */
  subset: string;
  startedAt: string;
  model: string;
  settings: Record<string, unknown>;
  /** Topics the batch processed without error. */
  topics: TrmTopic[];
  failedTopics: { topicId: string; error: string }[];
  matches: TrmMatch[];
}

const GRAPH_LOCAL_PREFIX = 'local-';
const OVERALLS: readonly MatchOverall[] = ['strong', 'plausible', 'weak', 'none'];

/** Directory uid of a graph person uid: `local-dupont-j` → `dupont-j`; another scheme is kept as is. */
export const directoryUidOf = (personUid: string): string =>
  personUid.startsWith(GRAPH_LOCAL_PREFIX) ? personUid.slice(GRAPH_LOCAL_PREFIX.length) : personUid;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

/** Spaces the PDF extraction inserts inside words (« materia ls ») are not recoverable: only the surrounding
 * whitespace is normalised. */
const cleanText = (v: unknown): string => str(v).replace(/\s+/g, ' ').trim();

const publication = (p: Record<string, unknown>): TrmPublication => ({
  uid: str(p.uid),
  title: cleanText(p.title),
  year: typeof p.year === 'number' ? p.year : null,
  score: num(p.score),
  relevant: p.relevant === true,
  reason: cleanText(p.reason),
});

/**
 * Parses the JSON text of a report. Throws on a report without run id or cluster; a topic in error is listed in
 * `failedTopics` and has no match; a match whose overall is unknown is kept as `none`.
 */
export const parseTrmReport = (text: string, programmeId: string = HORIZON_EUROPE.programmeId): TrmRun => {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const runId = str(raw.run_id);
  const subset = str(raw.cluster);
  if (!runId || !subset) throw new Error('not a TRM report: run_id and cluster are required');
  const settings = (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Record<string, unknown>;
  const topics: TrmTopic[] = [];
  const failedTopics: TrmRun['failedTopics'] = [];
  const matches: TrmMatch[] = [];
  for (const t of (Array.isArray(raw.topics) ? raw.topics : []) as Record<string, unknown>[]) {
    const topicId = str(t.topic_id);
    if (!topicId) continue;
    if (t.error) {
      failedTopics.push({ topicId, error: str(t.error) });
      continue;
    }
    topics.push({
      topicId,
      subset: str(t.cluster, subset) || subset,
      title: cleanText(t.title),
      callIdentifier: str(t.call_id),
      destination: cleanText(t.destination),
      deadlines: strings(t.deadlines),
      summary: cleanText(t.summary),
    });
    for (const m of (Array.isArray(t.researchers) ? t.researchers : []) as Record<string, unknown>[]) {
      const personUid = str(m.person_uid);
      if (!personUid) continue;
      const overall = str(m.overall) as MatchOverall;
      matches.push({
        pairId: str(m.pair_id) || `${topicId}|${personUid}`,
        topicId,
        personUid,
        uid: directoryUidOf(personUid),
        personName: cleanText(m.name),
        units: strings(m.units),
        score: num(m.score),
        rawScore: num(m.raw_score),
        overall: OVERALLS.includes(overall) ? overall : 'none',
        justification: cleanText(m.justification),
        publications: (Array.isArray(m.publications) ? m.publications : [])
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map(publication),
      });
    }
  }
  return {
    runId, programmeId, subset, startedAt: str(raw.started_at), model: str(settings.model), settings, topics, failedTopics, matches,
  };
};
