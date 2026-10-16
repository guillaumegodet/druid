// Collection of the calls of the Funding & Tenders portal into the store (druid-internal docs/plan-funding-calls.md,
// lot 2): the listing is streamed, each topic is mapped to a Druid programme (lib/calls/ftPortal.ts); a topic new to
// the store, or whose listing fields changed, has its text fetched (lib/calls/portal.ts) and is written; the others
// are left alone. Closed topics are not imported when unknown. The store is an interface so that the flow is tested
// with an in-memory one; lib/calls/pg.ts implements it.
import { createHash } from 'crypto';
import { parsePortalListingTopic, portalListingObjects, programmeOfPortalTopic, type PortalListingTopic } from './ftPortal';
import type { PortalTopic } from './portal';
import { statusFromDeadlines, type CallStatus, type Programme } from './programmes';

/** What the collector needs to know of a stored call to decide whether to fetch its text again. */
export interface StoredCallSummary {
  callId: string;
  programmeId: string;
  title: string;
  deadlines: string[];
  openingDate: string | null;
  status: CallStatus;
  /** The text of the call is stored, objectives or scope (a call whose portal page had none is read again until it has
   * one; ERC and EIC topics only have a scope). */
  hasText: boolean;
}

export interface CollectedCall {
  callId: string;
  programmeId: string;
  subset: string;
  scheme: string;
  title: string;
  objectives: string;
  scope: string;
  taxonomy: Record<string, string>;
  openingDate: string | null;
  deadlines: string[];
  budget: Record<string, unknown>;
  url: string;
  status: CallStatus;
  contentHash: string;
  lang: string;
}

export interface CollectorStore {
  /** Calls of the given programmes already stored. */
  storedCalls(programmeIds: string[]): Promise<StoredCallSummary[]>;
  /** Writes a call; says whether it was created or updated. */
  upsertCall(call: CollectedCall): Promise<'new' | 'updated'>;
  /** Status and dates of a call known from the listing alone (its text did not change). */
  updateCallDates(callId: string, status: CallStatus, deadlines: string[], openingDate: string | null): Promise<void>;
  /** Deletes calls that no run matched yet; returns how many were deleted (the others are left in place). */
  removeCalls(callIds: string[]): Promise<number>;
}

export interface CollectStats {
  seen: number;
  new: number;
  updated: number;
  unchanged: number;
  skippedClosed: number;
  /** Undated copies of a dated topic left out (undatedTwins), and how many of them were deleted from the store. */
  skippedTwins: number;
  removedTwins: number;
  detailsFetched: number;
  errors: string[];
}

export interface CollectOptions {
  /** Programmes to collect (active ones of the portal source). */
  programmes: Programme[];
  /** The listing, as chunks of its JSON text. */
  listing: AsyncIterable<string | Uint8Array>;
  /** Text of a topic; null when the portal has none. */
  fetchDetails: (topicId: string) => Promise<PortalTopic | null>;
  store: CollectorStore;
  today: string;
  /** Upper bound of topic texts fetched in one run (a first run fetches hundreds). */
  detailsLimit?: number;
  concurrency?: number;
  log?: (message: string) => void;
}

export const PORTAL_TOPIC_PAGE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';

export const contentHashOf = (objectives: string, scope: string): string =>
  createHash('sha1').update(`${objectives}\n\u0000\n${scope}`).digest('hex');

const sameDates = (a: string[], b: string[]): boolean => a.length === b.length && a.every((d, i) => d === b[i]);

/** Whether the listing says something new about a stored call (title, dates or status). */
export const listingChanged = (stored: StoredCallSummary, topic: PortalListingTopic): boolean =>
  stored.title !== topic.title || !sameDates(stored.deadlines, topic.deadlines)
  || (stored.openingDate ?? null) !== (topic.openingDate ?? null) || stored.status !== topic.status;

/** The stored row of a topic, from the listing and (when the portal gave it) its text. */
export const collectedCallOf = (topic: PortalListingTopic, match: { programmeId: string; subset: string; scheme: string }, details: PortalTopic | null): CollectedCall => {
  const taxonomy: Record<string, string> = {};
  if (topic.callIdentifier) taxonomy.call = topic.callIdentifier;
  if (topic.callTitle) taxonomy.callTitle = topic.callTitle;
  const types = details?.typesOfAction.length ? details.typesOfAction : topic.typesOfAction;
  if (types.length) taxonomy.typeOfAction = types.join(', ');
  const division = topic.divisions.filter((d) => d.includes('.')).sort((a, b) => b.length - a.length)[0];
  if (division) taxonomy.division = division;
  const keywords = details?.keywords.length ? details.keywords : topic.keywords;
  if (keywords.length) taxonomy.keywords = keywords.join(', ');
  const objectives = details?.objectives ?? '';
  const scope = details?.scope ?? '';
  return {
    callId: topic.identifier, programmeId: match.programmeId, subset: match.subset, scheme: match.scheme,
    title: details?.title || topic.title, objectives, scope, taxonomy,
    openingDate: topic.openingDate ?? details?.openingDate ?? null,
    deadlines: topic.deadlines.length ? topic.deadlines : details?.deadlines ?? [],
    budget: (details?.budget ?? {}) as Record<string, unknown>,
    url: `${PORTAL_TOPIC_PAGE}${topic.identifier.toLowerCase()}`,
    status: topic.status, contentHash: contentHashOf(objectives, scope), lang: 'en',
  };
};

/** Identifier of a topic without its year: `HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01` → `HORIZON-EIC-PATHFINDERCHALLENGES-01-01`. */
export const undatedIdentifier = (id: string): string => id.replace(/-(?:19|20)\d{2}-/, '-');

/**
 * Topics of the listing that are an undated copy of a dated one: the portal also lists some topics of a work
 * programme without their year (EIC Pathfinder Challenges 2026), same title, dates and text, as forthcoming, so that
 * the call would show twice. The dated identifier is the one of the call.
 */
export const undatedTwins = (identifiers: Iterable<string>): Set<string> => {
  const ids = new Set(identifiers);
  const twins = new Set<string>();
  for (const id of ids) {
    const undated = undatedIdentifier(id);
    if (undated !== id && ids.has(undated)) twins.add(undated);
  }
  return twins;
};

/** Runs one collection; never throws for a single topic (errors are counted and reported). */
export async function collectFromPortal(options: CollectOptions): Promise<CollectStats> {
  const log = options.log ?? (() => {});
  const stats: CollectStats = { seen: 0, new: 0, updated: 0, unchanged: 0, skippedClosed: 0, skippedTwins: 0, removedTwins: 0, detailsFetched: 0, errors: [] };
  const active = new Set(options.programmes.map((p) => p.programmeId));
  if (!active.size) return stats;
  const stored = new Map((await options.store.storedCalls([...active])).map((c) => [c.callId, c]));
  const seen = new Set<string>();
  const toFetch: { topic: PortalListingTopic; match: { programmeId: string; subset: string; scheme: string }; isNew: boolean }[] = [];

  const listed: { topic: PortalListingTopic; match: { programmeId: string; subset: string; scheme: string } }[] = [];
  for await (const text of portalListingObjects(options.listing)) {
    let topic: PortalListingTopic | null;
    try {
      topic = parsePortalListingTopic(JSON.parse(text));
    } catch (e) {
      stats.errors.push(`unreadable listing object: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (!topic) continue;
    const match = programmeOfPortalTopic(topic);
    if (match && active.has(match.programmeId)) listed.push({ topic, match });
  }
  // Undated copies: never imported, deleted when an earlier collection stored them (unless a run matched them).
  const twins = undatedTwins(listed.map((l) => l.topic.identifier));
  const storedTwins = [...twins].filter((id) => stored.has(id));
  if (storedTwins.length) {
    stats.removedTwins = await options.store.removeCalls(storedTwins);
    for (const id of storedTwins) stored.delete(id);
  }

  for (const { topic, match } of listed) {
    if (twins.has(topic.identifier)) { stats.skippedTwins++; continue; }
    stats.seen++;
    seen.add(topic.identifier);
    const existing = stored.get(topic.identifier);
    if (!existing) {
      if (topic.status === 'closed') { stats.skippedClosed++; continue; }
      toFetch.push({ topic, match, isNew: true });
    } else if (listingChanged(existing, topic) || (!existing.hasText && topic.status !== 'closed')) {
      toFetch.push({ topic, match, isNew: false });
    } else {
      stats.unchanged++;
    }
  }

  const limit = options.detailsLimit ?? Infinity;
  // Texts to fetch, newest calls first; beyond the limit, a changed call still gets its dates and status.
  const queue = toFetch.slice(0, limit);
  for (const item of toFetch.slice(limit)) {
    if (item.isNew) continue;
    await options.store.updateCallDates(item.topic.identifier, item.topic.status, item.topic.deadlines, item.topic.openingDate);
    stats.updated++;
  }
  if (toFetch.length > limit) log(`${toFetch.length - limit} topic(s) left for a later run (details limit ${limit})`);
  const workers = Math.max(1, Math.min(options.concurrency ?? 4, queue.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const details = await options.fetchDetails(item.topic.identifier);
        stats.detailsFetched++;
        const result = await options.store.upsertCall(collectedCallOf(item.topic, item.match, details));
        stats[result]++;
      } catch (e) {
        stats.errors.push(`${item.topic.identifier}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }));

  // Calls stored but gone from the listing: the portal no longer lists them, their dates say what they are.
  for (const c of stored.values()) {
    if (seen.has(c.callId) || c.status === 'closed') continue;
    const status = statusFromDeadlines(c.deadlines, options.today, c.openingDate);
    if (status !== c.status && status !== 'unknown') {
      await options.store.updateCallDates(c.callId, status, c.deadlines, c.openingDate);
      stats.updated++;
    }
  }
  log(`portal: ${stats.seen} topics of the active programmes, ${stats.new} new, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.skippedClosed} closed skipped, ${stats.skippedTwins} undated copies skipped (${stats.removedTwins} deleted), ${stats.detailsFetched} texts fetched, ${stats.errors.length} error(s)`);
  return stats;
}
