// Client-side grouping of the matches of the « European calls » tab (druid-internal docs/plan-eu-calls.md,
// lot 3): by topic for the « Topics » view, by researcher for the « Researchers » view. Pure, shared with the tests.
import type { MatchOverall } from './trm';

export type FeedbackVerdict = 'relevant' | 'not_relevant' | 'already_applying';

export interface EuTopic {
  topicId: string;
  cluster: string;
  title: string;
  callId: string;
  destination: string;
  deadlines: string[];
  summary: string;
  /** French translation of the summary, '' when not translated. */
  summaryFr?: string;
}

export interface EuMatch {
  pairId: string;
  topicId: string;
  uid: string;
  personName: string;
  units: string[];
  score: number;
  overall: MatchOverall;
  justification: string;
  /** French translation of the justification, '' when not translated. */
  justificationFr?: string;
  publications: { uid: string; title: string; year: number | null; relevant: boolean; reason: string }[];
  /** Opinions given on the pair: counts per verdict, and the verdict of the current user. */
  feedback: Partial<Record<FeedbackVerdict, number>>;
  mine: FeedbackVerdict | null;
}

export interface TopicWithMatches extends EuTopic {
  matches: EuMatch[];
  /** Next deadline not yet passed at `today`, or null when every deadline has passed. */
  nextDeadline: string | null;
}

export interface ResearcherMatches {
  uid: string;
  personName: string;
  matches: (EuMatch & { topic: EuTopic })[];
}

const OVERALL_RANK: Record<MatchOverall, number> = { strong: 0, plausible: 1, weak: 2, none: 3 };

/** Strongest first, then by score. */
export const compareMatches = (a: EuMatch, b: EuMatch): number =>
  OVERALL_RANK[a.overall] - OVERALL_RANK[b.overall] || b.score - a.score || a.personName.localeCompare(b.personName);

export const nextDeadlineOf = (deadlines: string[], today: string): string | null =>
  [...deadlines].sort().find((d) => d >= today) ?? null;

/**
 * Topics with their matches, limited to `uids` when given (the researchers of the structure shown). Topics whose
 * deadlines have all passed are kept only with `includePast`. Sorted by next deadline, then by number of matches.
 */
export function topicsWithMatches(
  topics: EuTopic[], matches: EuMatch[], options: { uids?: Set<string> | null; today: string; includePast?: boolean },
): TopicWithMatches[] {
  const byTopic = new Map<string, EuMatch[]>();
  for (const m of matches) {
    if (options.uids && !options.uids.has(m.uid)) continue;
    const list = byTopic.get(m.topicId) ?? [];
    list.push(m);
    byTopic.set(m.topicId, list);
  }
  return topics
    .map((t) => ({ ...t, matches: (byTopic.get(t.topicId) ?? []).sort(compareMatches), nextDeadline: nextDeadlineOf(t.deadlines, options.today) }))
    .filter((t) => options.includePast || t.nextDeadline !== null || t.deadlines.length === 0)
    .sort((a, b) =>
      (a.nextDeadline ?? '9999').localeCompare(b.nextDeadline ?? '9999') || b.matches.length - a.matches.length || a.title.localeCompare(b.title));
}

/** Matches grouped by researcher (limited to `uids` when given), most matches first; within a researcher, strongest
 * first. A match whose topic is unknown is dropped. */
export function matchesByResearcher(topics: EuTopic[], matches: EuMatch[], uids?: Set<string> | null): ResearcherMatches[] {
  const topicOf = new Map(topics.map((t) => [t.topicId, t]));
  const byUid = new Map<string, ResearcherMatches>();
  for (const m of matches) {
    if (uids && !uids.has(m.uid)) continue;
    const topic = topicOf.get(m.topicId);
    if (!topic) continue;
    const entry = byUid.get(m.uid) ?? { uid: m.uid, personName: m.personName, matches: [] };
    entry.matches.push({ ...m, topic });
    byUid.set(m.uid, entry);
  }
  return [...byUid.values()]
    .map((r) => ({ ...r, matches: r.matches.sort(compareMatches) }))
    .sort((a, b) => b.matches.length - a.matches.length || a.personName.localeCompare(b.personName));
}

/** Directory uids of the researchers shown (records without uid are outside the graph, hence never matched). */
export const uidsOf = (researchers: { uid?: string }[]): Set<string> =>
  new Set(researchers.map((r) => r.uid).filter((u): u is string => !!u));
