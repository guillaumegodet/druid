// Reading of a Topic-to-Researcher Match report (crisalid-agents trm/report.py, `trm-<cluster>-<date>.json`): the
// JSON written by the batch becomes the rows of eu_topic, eu_topic_match_run and eu_topic_match (druid-internal
// docs/plan-eu-calls.md, lot 2). Pure: shared by the import script and its tests.

export type MatchOverall = 'strong' | 'plausible' | 'weak' | 'none';

export interface TrmPublication {
  uid: string;
  title: string;
  year: number | null;
  score: number;
  relevant: boolean;
  reason: string;
}

export interface TrmTopic {
  topicId: string;
  cluster: string;
  title: string;
  callId: string;
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
  cluster: string;
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
export const parseTrmReport = (text: string): TrmRun => {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const runId = str(raw.run_id);
  const cluster = str(raw.cluster);
  if (!runId || !cluster) throw new Error('not a TRM report: run_id and cluster are required');
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
      cluster: str(t.cluster, cluster) || cluster,
      title: cleanText(t.title),
      callId: str(t.call_id),
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
    runId, cluster, startedAt: str(raw.started_at), model: str(settings.model), settings, topics, failedTopics, matches,
  };
};
