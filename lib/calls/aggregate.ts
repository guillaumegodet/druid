// Client-side grouping of the matches of the « Calls for proposals » tab (druid-internal
// docs/plan-funding-calls.md, lot 1): by call for the « Calls » view, by researcher for the « Researchers »
// view, filters by funder and programme. Pure, shared with the tests.
import type { MatchOverall } from './trm';
import type { CallStatus, FunderCategory, ProgrammeKind } from './programmes';
import { normalizeAcronym } from '../normalize';

export type FeedbackVerdict = 'relevant' | 'not_relevant' | 'already_applying';

/** A programme as the tab lists it (joined to its funder). */
export interface ProgrammeView {
  programmeId: string;
  name: string;
  kind: ProgrammeKind;
  subsetLabel: string;
  funderId: string;
  funderName: string;
  category: FunderCategory;
  url: string;
}

export interface Call {
  callId: string;
  programmeId: string;
  subset: string;
  scheme: string;
  title: string;
  /** French rendering of the title, '' when the source is English only. */
  titleFr?: string;
  summary: string;
  /** French translation of the summary, '' when not translated. */
  summaryFr?: string;
  /** Classification fields of the source (destination, call, type of action, panel…). */
  taxonomy: Record<string, string>;
  openingDate: string | null;
  deadlines: string[];
  url: string;
  status: CallStatus;
}

export interface CallMatch {
  pairId: string;
  callId: string;
  uid: string;
  personName: string;
  units: string[];
  score: number;
  overall: MatchOverall;
  justification: string;
  /** French translation of the justification, '' when not translated. */
  justificationFr?: string;
  publications: { uid: string; title: string; year: number | null; relevant: boolean; reason: string }[];
  /** Verdict of the eligibility engine, null when the call has no rules or the engine did not run. */
  eligible: boolean | null;
  /** Opinions given on the pair: counts per verdict, and the verdict of the current user. */
  feedback: Partial<Record<FeedbackVerdict, number>>;
  mine: FeedbackVerdict | null;
}

export interface CallWithMatches extends Call {
  matches: CallMatch[];
  /** Next deadline not yet passed at `today`, or null when every deadline has passed. */
  nextDeadline: string | null;
}

export interface ResearcherMatches {
  uid: string;
  personName: string;
  matches: (CallMatch & { call: Call })[];
}

const OVERALL_RANK: Record<MatchOverall, number> = { strong: 0, plausible: 1, weak: 2, none: 3 };

/** Strongest first, then by score. */
export const compareMatches = (a: CallMatch, b: CallMatch): number =>
  OVERALL_RANK[a.overall] - OVERALL_RANK[b.overall] || b.score - a.score || a.personName.localeCompare(b.personName);

export const nextDeadlineOf = (deadlines: string[], today: string): string | null =>
  [...deadlines].sort().find((d) => d >= today) ?? null;

/** Whether the call still accepts proposals at `today` (a call without any deadline is kept: nothing says it is over). */
export const isOpenAt = (call: { deadlines: string[] }, today: string): boolean =>
  call.deadlines.length === 0 || call.deadlines.some((d) => d >= today);

export interface CallFilters {
  /** Directory uids of the researchers shown; null or undefined = every match. */
  uids?: Set<string> | null;
  today: string;
  /** Keep the calls whose deadlines have all passed. */
  includePast?: boolean;
  /** Programmes to keep (empty = all). */
  programmeIds?: Set<string> | null;
  /** Subset (cluster, axis, panel) to keep, '' = all. */
  subset?: string;
}

const keepCall = (call: Call, f: CallFilters): boolean =>
  (!f.programmeIds || f.programmeIds.size === 0 || f.programmeIds.has(call.programmeId))
  && (!f.subset || call.subset === f.subset)
  && (!!f.includePast || isOpenAt(call, f.today));

/**
 * Calls with their matches, limited to the researchers `uids` when given. Closed calls are kept only with
 * `includePast`. Sorted by next deadline, then by number of matches.
 */
export function callsWithMatches(calls: Call[], matches: CallMatch[], filters: CallFilters): CallWithMatches[] {
  const byCall = new Map<string, CallMatch[]>();
  for (const m of matches) {
    if (filters.uids && !filters.uids.has(m.uid)) continue;
    const list = byCall.get(m.callId) ?? [];
    list.push(m);
    byCall.set(m.callId, list);
  }
  return calls
    .filter((c) => keepCall(c, filters))
    .map((c) => ({ ...c, matches: (byCall.get(c.callId) ?? []).sort(compareMatches), nextDeadline: nextDeadlineOf(c.deadlines, filters.today) }))
    .sort((a, b) =>
      (a.nextDeadline ?? '9999').localeCompare(b.nextDeadline ?? '9999') || b.matches.length - a.matches.length || a.title.localeCompare(b.title));
}

/** Matches grouped by researcher (limited to `uids` when given), most matches first; within a researcher, strongest
 * first. A match whose call is unknown or filtered out is dropped. */
export function matchesByResearcher(calls: Call[], matches: CallMatch[], filters: CallFilters): ResearcherMatches[] {
  const callOf = new Map(calls.filter((c) => keepCall(c, filters)).map((c) => [c.callId, c]));
  const byUid = new Map<string, ResearcherMatches>();
  for (const m of matches) {
    if (filters.uids && !filters.uids.has(m.uid)) continue;
    const call = callOf.get(m.callId);
    if (!call) continue;
    const entry = byUid.get(m.uid) ?? { uid: m.uid, personName: m.personName, matches: [] };
    entry.matches.push({ ...m, call });
    byUid.set(m.uid, entry);
  }
  return [...byUid.values()]
    .map((r) => ({ ...r, matches: r.matches.sort(compareMatches) }))
    .sort((a, b) => b.matches.length - a.matches.length || a.personName.localeCompare(b.personName));
}

/** Directory uids of the researchers shown (records without uid are outside the graph, hence never matched). */
export const uidsOf = (researchers: { uid?: string }[]): Set<string> =>
  new Set(researchers.map((r) => r.uid).filter((u): u is string => !!u));

/** Subsets (clusters, axes…) of the calls of the given programmes, sorted. */
export const subsetsOf = (calls: Call[], programmeIds?: Set<string> | null): string[] =>
  [...new Set(calls.filter((c) => c.subset && (!programmeIds || programmeIds.size === 0 || programmeIds.has(c.programmeId))).map((c) => c.subset))].sort();

/** Programmes of the given funder category (empty = all), in the order given. */
export const programmesOfCategory = (programmes: ProgrammeView[], category: FunderCategory | ''): ProgrammeView[] =>
  programmes.filter((p) => !category || p.category === category);

/**
 * Whether the structure shown belongs to the perimeter an engine was run on (the `perimeter` recorded at import, e.g.
 * « IMN »): a perimeter equal to its slug or acronym, or contained in its label. No recorded perimeter = none known.
 */
export const inPerimeter = (perimeters: string[], structure: { slug: string; label: string }): boolean =>
  perimeters.length === 0 || perimeters.some((s) =>
    normalizeAcronym(s) === normalizeAcronym(structure.slug) || structure.label.toLowerCase().includes(s.toLowerCase()));
