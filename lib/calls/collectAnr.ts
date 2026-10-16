// Collection of the calls of the ANR into the store (druid-internal docs/plan-funding-calls.md, lot 4), the
// counterpart of lib/calls/collect.ts for the website of the agency (lib/calls/anr.ts):
// - specific calls and France 2030: the list of the calls open or announced gives a card per call; the page of each
//   call is read (a few dozen, weekly) and written when its title, dates, state or text changed. A stored call no
//   longer listed is closed (the list only shows the open and announced ones).
// - generic call (AAPG): the page of the latest edition (`/fr/aapg-<year>/`, next year's first) gives the dates and the
//   text of the call (PDF); each research axis becomes a call, kept even once the call is closed — the axes describe
//   the profile of a project for the whole year, until the next edition replaces them.
// The fetches are injected so that the flow is tested without network.
import { aapgPageUrl, aapgTextUrl, ANR_LISTING_URL, parseAapgAxes, parseAnrCallPage, parseAnrListing, type AapgAxis, type AnrCallPage, type AnrListedCall } from './anr';
import { contentHashOf, type CollectedCall, type CollectorStore, type CollectStats, type StoredCallSummary } from './collect';
import { statusFromDeadlines, type Programme } from './programmes';

export interface AnrCollectOptions {
  /** Programmes to collect (anr-aapg, anr-specific, france-2030; the active ones of the source). */
  programmes: Programme[];
  /** HTML of a page; null when the page does not exist (404). Throws on another failure. */
  fetchPage: (url: string) => Promise<string | null>;
  /** Text of a PDF, one line per line of text. */
  fetchPdfText: (url: string) => Promise<string>;
  store: CollectorStore;
  today: string;
  log?: (message: string) => void;
}

/** Fewer axes than this in the text of the generic call means the text was not read properly (57 in 2027). */
export const MIN_AAPG_AXES = 30;

export const anrCallId = (uid: string): string => `ANR-${uid}`;
export const aapgAxisCallId = (year: number, code: string): string => `ANR-AAPG-${year}-${code}`;

const programmeOfCard = (card: AnrListedCall): string | null => {
  if (card.type === 'generic' || /\/aapg-/i.test(card.url)) return null; // collected from its own page
  return card.type === 'france-2030' ? 'france-2030' : 'anr-specific';
};

/** Stored row of a specific or France 2030 call. */
export const anrCollectedCall = (card: AnrListedCall, programmeId: string, page: AnrCallPage): CollectedCall => {
  const scope = page.text || card.abstract;
  const taxonomy: Record<string, string> = {};
  if (card.typeLabel) taxonomy.typeOfAction = card.typeLabel;
  return {
    callId: anrCallId(card.uid), programmeId, subset: '', scheme: '', title: page.title || card.title, objectives: '', scope, taxonomy,
    openingDate: page.openingDate, deadlines: page.deadlines, budget: {}, url: card.url, status: page.status,
    contentHash: contentHashOf('', scope), lang: 'fr',
  };
};

/** Stored row of an axis of the generic call; the axis has no page of its own, its url is the page of the call. */
export const aapgCollectedCall = (year: number, axis: AapgAxis, page: AnrCallPage, url: string): CollectedCall => {
  const taxonomy: Record<string, string> = { call: `AAPG-${year}`, callTitle: page.title, axis: axis.code, domain: axis.domain };
  if (axis.keywords.length) taxonomy.keywords = axis.keywords.join('; ');
  if (axis.ercPanels.length) taxonomy.ercPanels = axis.ercPanels.join(', ');
  if (axis.sdgs.length) taxonomy.sdgs = axis.sdgs.join(', ');
  // The keywords belong to the text the batch and the profile engine read: they name the topics of the axis.
  const scope = axis.keywords.length ? `${axis.description}\n\nMots-clés : ${axis.keywords.join(' ; ')}` : axis.description;
  return {
    callId: aapgAxisCallId(year, axis.code), programmeId: 'anr-aapg', subset: axis.domain, scheme: '',
    title: `Axe ${axis.code} : ${axis.title}`, objectives: '', scope, taxonomy,
    openingDate: page.openingDate, deadlines: page.deadlines, budget: {}, url, status: page.status,
    contentHash: contentHashOf('', scope), lang: 'fr',
  };
};

const sameDates = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((d, i) => d === b[i]);
/** Whether the stored call already says all that the collected one says. */
export const unchanged = (stored: StoredCallSummary | undefined, call: CollectedCall): boolean =>
  !!stored && stored.hasText && stored.title === call.title && stored.status === call.status
  && (stored.openingDate ?? null) === (call.openingDate ?? null) && sameDates(stored.deadlines, call.deadlines)
  && stored.contentHash === call.contentHash;

/** Runs one collection; never throws for a single call (errors are counted and reported). */
export async function collectFromAnr(options: AnrCollectOptions): Promise<CollectStats> {
  const log = options.log ?? (() => {});
  const stats: CollectStats = { seen: 0, new: 0, updated: 0, unchanged: 0, skippedClosed: 0, skippedTwins: 0, removedTwins: 0, detailsFetched: 0, errors: [] };
  const active = new Set(options.programmes.map((p) => p.programmeId));
  if (!active.size) return stats;
  const stored = new Map((await options.store.storedCalls([...active])).map((c) => [c.callId, c]));
  const write = async (call: CollectedCall) => {
    const existing = stored.get(call.callId);
    if (unchanged(existing, call)) { stats.unchanged++; return; }
    if (!existing && call.status === 'closed' && call.programmeId !== 'anr-aapg') { stats.skippedClosed++; return; }
    stats[await options.store.upsertCall(call)]++;
  };

  // Specific calls and France 2030.
  const listed = ['anr-specific', 'france-2030'].filter((p) => active.has(p));
  if (listed.length) {
    const seen = new Set<string>();
    try {
      const html = await options.fetchPage(ANR_LISTING_URL);
      const cards = html ? parseAnrListing(html) : [];
      // The list is never empty in practice: an empty one means that the page changed, not that every call closed.
      if (!cards.length) throw new Error('the list of calls has no card (page changed?)');
      for (const card of cards) {
        const programmeId = programmeOfCard(card);
        if (!programmeId || !active.has(programmeId)) continue;
        stats.seen++;
        seen.add(anrCallId(card.uid));
        try {
          const page = await options.fetchPage(card.url);
          stats.detailsFetched++;
          const parsed = page ? parseAnrCallPage(page, card.url) : null;
          if (!parsed) { stats.errors.push(`${anrCallId(card.uid)}: unreadable page ${card.url}`); continue; }
          await write(anrCollectedCall(card, programmeId, parsed));
        } catch (e) {
          stats.errors.push(`${anrCallId(card.uid)}: ${e instanceof Error ? e.message : e}`);
        }
      }
      // Calls no longer listed: closed (their dates may still be ahead when the agency withdrew an announcement).
      for (const c of stored.values()) {
        if (!listed.includes(c.programmeId) || seen.has(c.callId) || c.status === 'closed') continue;
        await options.store.updateCallDates(c.callId, 'closed', c.deadlines, c.openingDate);
        stats.updated++;
      }
    } catch (e) {
      stats.errors.push(`list of calls: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Generic call: the latest edition published.
  if (active.has('anr-aapg')) {
    const year = Number(options.today.slice(0, 4));
    try {
      let edition: { year: number; page: AnrCallPage; url: string } | null = null;
      for (const y of [year + 1, year]) {
        const html = await options.fetchPage(aapgPageUrl(y));
        const page = html ? parseAnrCallPage(html, aapgPageUrl(y)) : null;
        if (page) { edition = { year: y, page, url: aapgPageUrl(y) }; break; }
      }
      if (!edition) throw new Error(`no page for AAPG ${year + 1} or ${year}`);
      const textUrl = aapgTextUrl(edition.page.documents, edition.year);
      if (!textUrl) throw new Error(`AAPG ${edition.year}: no text of the call among the documents of its page`);
      const axes = parseAapgAxes(await options.fetchPdfText(textUrl));
      stats.detailsFetched++;
      if (axes.length < MIN_AAPG_AXES) throw new Error(`AAPG ${edition.year}: ${axes.length} axes read in ${textUrl} (at least ${MIN_AAPG_AXES} expected)`);
      const ids = new Set<string>();
      for (const axis of axes) {
        stats.seen++;
        const call = aapgCollectedCall(edition.year, axis, edition.page, edition.url);
        ids.add(call.callId);
        await write(call);
      }
      // Axes of an earlier edition: closed once their deadlines are past (the matches made on them stay readable).
      for (const c of stored.values()) {
        if (c.programmeId !== 'anr-aapg' || ids.has(c.callId) || c.status === 'closed') continue;
        const status = statusFromDeadlines(c.deadlines, options.today, c.openingDate);
        if (status === 'closed') { await options.store.updateCallDates(c.callId, status, c.deadlines, c.openingDate); stats.updated++; }
      }
      log(`AAPG ${edition.year}: ${axes.length} axes, ${edition.page.stateLabel || edition.page.status}`);
    } catch (e) {
      stats.errors.push(`AAPG: ${e instanceof Error ? e.message : e}`);
    }
  }
  log(`anr: ${stats.seen} calls seen, ${stats.new} new, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.skippedClosed} closed skipped, ${stats.detailsFetched} pages read, ${stats.errors.length} error(s)`);
  return stats;
}
