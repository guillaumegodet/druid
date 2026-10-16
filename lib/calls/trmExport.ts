// Topics file of the Topic-to-Researcher Match batch (druid-internal docs/plan-funding-calls.md, lot 3): the calls of
// a programme, as collected from their source (lib/calls/collect.ts), written in the topic format of crisalid-agents
// (common/horizon/models.py, `Topic.to_document`) so that `topic_researcher_match.py --topics-file` runs on any
// programme, not only on the Horizon Europe work programmes indexed in OpenSearch. Pure: shared by the export script
// and its tests.
import type { CallStatus, Programme } from './programmes';

/** Format of the file, read by crisalid-agents (scripts/topic_researcher_match.py). */
export const TOPICS_FILE_FORMAT = 'druid-calls/1';

/** A call as the store gives it to the export. */
export interface CallForMatching {
  callId: string;
  subset: string;
  title: string;
  objectives: string;
  scope: string;
  taxonomy: Record<string, string>;
  openingDate: string | null;
  deadlines: string[];
  status: CallStatus;
}

/** A topic of the file, field names of crisalid-agents. */
export interface TopicsFileTopic {
  topic_id: string;
  title: string;
  /** Subset of the call (cluster, scheme, mission…); the subset of the file when the call has none. */
  cluster: string;
  call_id: string | null;
  call_name: string | null;
  destination: string | null;
  type_of_action: string | null;
  opening_date: string | null;
  deadlines: string[];
  expected_outcome: string;
  scope: string;
}

export interface TopicsFile {
  format: typeof TOPICS_FILE_FORMAT;
  programme: string;
  /** Name of the programme, put in the prompts of the batch instead of « Horizon Europe work programme ». */
  programme_label: string;
  /** Label of the run: the subset exported, or the programme id when every subset is. Becomes the `cluster` of the
   * report, hence the subset of the run imported by scripts/import_calls.ts. */
  subset: string;
  exported_at: string;
  topics: TopicsFileTopic[];
}

export interface TopicsFileOptions {
  /** Subset exported (one file per subset, a run per subset); undefined = every call of the programme. */
  subset?: string;
  exportedAt?: string;
}

/** True when the call carries a text the batch can read (ERC and EIC topics only have a scope). */
export const hasMatchingText = (call: Pick<CallForMatching, 'objectives' | 'scope'>): boolean => !!(call.objectives.trim() || call.scope.trim());

const orNull = (v: string | undefined): string | null => (v && v.trim() ? v : null);

/** Topics file of the calls of a programme: calls without text are left out (the batch would match on the title alone). */
export const topicsFileOf = (programme: Programme, calls: readonly CallForMatching[], options: TopicsFileOptions = {}): TopicsFile => {
  const label = options.subset || programme.programmeId;
  const topics = calls
    .filter((c) => (options.subset === undefined || c.subset === options.subset) && hasMatchingText(c))
    .map((c): TopicsFileTopic => ({
      topic_id: c.callId,
      title: c.title,
      cluster: c.subset || label,
      call_id: orNull(c.taxonomy.call),
      call_name: orNull(c.taxonomy.callTitle),
      destination: orNull(c.taxonomy.destination) ?? orNull(c.taxonomy.division),
      type_of_action: orNull(c.taxonomy.typeOfAction),
      opening_date: c.openingDate,
      deadlines: [...c.deadlines],
      expected_outcome: c.objectives,
      scope: c.scope,
    }))
    .sort((a, b) => a.topic_id.localeCompare(b.topic_id));
  return {
    format: TOPICS_FILE_FORMAT,
    programme: programme.programmeId,
    programme_label: programme.name,
    subset: label,
    exported_at: options.exportedAt ?? new Date().toISOString(),
    topics,
  };
};

/** Subsets of the calls that carry a text, sorted ('' when the programme has no partition). */
export const subsetsOf = (calls: readonly CallForMatching[]): string[] =>
  [...new Set(calls.filter(hasMatchingText).map((c) => c.subset))].sort();

/** File name of a topics file: `calls-<programme>[-<subset>].json`, safe for any subset label. */
export const topicsFileName = (programmeId: string, subset?: string): string => {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `calls-${slug(programmeId)}${subset ? `-${slug(subset)}` : ''}.json`;
};
