// Official titles of the Horizon Europe topics from the Funding & Tenders portal (public JSON per topic): the titles
// parsed from the work programme PDFs carry word splits (« Ne xt generation », « materia ls ») the extraction cannot
// recover, so the import replaces them by the portal's (docs/plan-eu-calls.md, recette of 2026-10-14).
export const PORTAL_TOPIC_JSON = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';

export interface PortalTopic {
  topicId: string;
  title: string;
  callTitle: string;
  /** Deadlines, 'YYYY-MM-DD' (UTC). */
  deadlines: string[];
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const dateOf = (ms: unknown): string | null => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().slice(0, 10) : null;
};

/** Parses the portal answer; null when it does not describe the topic. */
export const parsePortalTopic = (topicId: string, body: unknown): PortalTopic | null => {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const details = (root?.TopicDetails ?? root) as Record<string, unknown> | null;
  const title = String(details?.title ?? '').replace(/\s+/g, ' ').trim();
  if (!details || !title) return null;
  const raw = Array.isArray(details.deadlineDates) ? details.deadlineDates : [];
  return {
    topicId, title, callTitle: String(details.callTitle ?? '').trim(),
    deadlines: raw.map(dateOf).filter((d): d is string => !!d).sort(),
  };
};

/** One topic from the portal; null when unknown there (404) or unreadable. Never throws on an HTTP error. */
export async function fetchPortalTopic(topicId: string, fetchImpl: Fetch = fetch): Promise<PortalTopic | null> {
  const res = await fetchImpl(`${PORTAL_TOPIC_JSON}${topicId.toLowerCase()}.json`);
  if (!res.ok) return null;
  try {
    return parsePortalTopic(topicId, await res.json());
  } catch {
    return null;
  }
}

/** Portal titles of `topicIds`, a few requests at a time; topics the portal does not know are left out. */
export async function fetchPortalTopics(topicIds: string[], fetchImpl: Fetch = fetch, concurrency = 4): Promise<Map<string, PortalTopic>> {
  const out = new Map<string, PortalTopic>();
  const queue = [...new Set(topicIds)];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const topic = await fetchPortalTopic(id, fetchImpl).catch(() => null);
      if (topic) out.set(id, topic);
    }
  }));
  return out;
}
