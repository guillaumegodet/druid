// A topic of the Funding & Tenders portal from its public JSON (`…/data/topicDetails/<id>.json`): official title,
// call, dates, description split into objectives and scope, budget — the text of a call for the thematic matching
// (druid-internal docs/plan-funding-calls.md, lot 2). Also used after a TRM import to replace the titles parsed from
// the work programme PDFs, which carry word splits (« Ne xt generation »). Parsing kept pure for the tests.
import { dateOfMs, datesOfMs, htmlToText, portalStatus, splitDescription } from './ftPortal';
import type { CallStatus } from './programmes';

export const PORTAL_TOPIC_JSON = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';

export interface PortalBudget {
  minContribution?: number;
  maxContribution?: number;
  expectedGrants?: number;
  /** Indicative budget per year, in euros. */
  byYear?: Record<string, number>;
}

export interface PortalTopic {
  topicId: string;
  title: string;
  callTitle: string;
  callIdentifier: string;
  /** Deadlines, 'YYYY-MM-DD' (UTC). */
  deadlines: string[];
  openingDate: string | null;
  status: CallStatus;
  /** Expected outcome (Horizon) or the whole description for the other programmes, as text. */
  objectives: string;
  scope: string;
  conditions: string;
  keywords: string[];
  typesOfAction: string[];
  budget: PortalBudget;
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

const budgetOf = (details: Record<string, unknown>): PortalBudget => {
  const item = details.budgetOverviewJSONItem as { budgetTopicActionMap?: Record<string, unknown[]> } | undefined;
  const first = Object.values(item?.budgetTopicActionMap ?? {}).flat()[0] as Record<string, unknown> | undefined;
  if (!first) return {};
  const byYear: Record<string, number> = {};
  for (const [y, v] of Object.entries((first.budgetYearMap as Record<string, unknown>) ?? {})) {
    const n = num(v);
    if (n) byYear[y] = n;
  }
  const out: PortalBudget = {};
  const min = num(first.minContribution); if (min) out.minContribution = min;
  const max = num(first.maxContribution); if (max) out.maxContribution = max;
  const grants = num(first.expectedGrants); if (grants) out.expectedGrants = grants;
  if (Object.keys(byYear).length) out.byYear = byYear;
  return out;
};

/** Parses the portal answer; null when it does not describe the topic. */
export const parsePortalTopic = (topicId: string, body: unknown): PortalTopic | null => {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const details = (root?.TopicDetails ?? root) as Record<string, unknown> | null;
  const title = str(details?.title);
  if (!details || !title) return null;
  const actions = Array.isArray(details.actions) ? (details.actions as Record<string, unknown>[]) : [];
  const first = actions[0];
  const { objectives, scope } = splitDescription(str(details.description) ? String(details.description) : '');
  return {
    topicId, title, callTitle: str(details.callTitle), callIdentifier: str(details.callIdentifier),
    deadlines: datesOfMs(details.deadlineDates ?? first?.deadlineDates),
    openingDate: dateOfMs(details.plannedOpeningDateLong ?? first?.plannedOpeningDate),
    status: portalStatus(first?.status ?? details.status),
    objectives, scope,
    conditions: htmlToText(String(details.conditions ?? '')),
    keywords: (Array.isArray(details.keywords) ? details.keywords : []).map(str).filter(Boolean),
    typesOfAction: (Array.isArray(details.topicActions) ? details.topicActions : []).map((a) => str((a as { abbreviation?: unknown })?.abbreviation)).filter(Boolean),
    budget: budgetOf(details),
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

/** Portal topics of `topicIds`, a few requests at a time; topics the portal does not know are left out. */
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
