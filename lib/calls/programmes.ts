// Vocabulary of the « Calls for proposals » tab (druid-internal docs/plan-funding-calls.md, lot 1): funders,
// programmes and the status of a call, shared by the server store, the import script and the tab. The funder and
// programme declared here are also inserted by the migration 20261015150000_funding_calls.sql; the import makes sure
// they exist before writing calls (an instance may have been created after that migration with an empty table).

/** Categories of the « Funding » tab (components/dashboard/fundersAggregates.ts, FUNDER_CATEGORIES): same values. */
export type FunderCategory = 'ANR' | 'Europe' | 'Recherche nationale' | 'Régional' | 'International' | 'Privé / fondations' | 'Autre';
export const FUNDER_CATEGORIES: readonly FunderCategory[] = ['ANR', 'Europe', 'Recherche nationale', 'Régional', 'International', 'Privé / fondations', 'Autre'];

/** How the calls of a programme are matched to the researchers: by the text of the call (thematic), by axes or
 * panels against the profile of the researcher (open), by career rules (eligibility), or several of these. */
export type ProgrammeKind = 'thematic' | 'open' | 'eligibility' | 'mixed';
export type ProgrammeRefresh = 'daily' | 'weekly' | 'manual';
export type CallStatus = 'forthcoming' | 'open' | 'closed' | 'unknown';
export type MatchEngine = 'trm' | 'profile' | 'eligibility';
export const MATCH_ENGINES: readonly MatchEngine[] = ['trm', 'profile', 'eligibility'];

export interface Funder {
  funderId: string;
  name: string;
  country: string;
  category: FunderCategory;
  url: string;
}

export interface Programme {
  programmeId: string;
  funderId: string;
  name: string;
  kind: ProgrammeKind;
  url: string;
  /** Collector that feeds the programme (trm-report, ft-portal, anr, url-sheet, csv, manual). */
  source: string;
  refresh: ProgrammeRefresh;
  /** What the calls are partitioned by (cluster, axis, panel), '' when they are not; a filter of the tab. */
  subsetLabel: string;
  active: boolean;
}

export const EU_FUNDER: Funder = {
  funderId: 'eu', name: 'Union européenne', country: 'EU', category: 'Europe',
  url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

/** Horizon Europe, fed by the Topic-to-Researcher Match reports of crisalid-agents (lib/calls/trm.ts). */
export const HORIZON_EUROPE: Programme = {
  programmeId: 'horizon-europe', funderId: 'eu', name: 'Horizon Europe', kind: 'thematic',
  url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/programmes/horizon',
  source: 'trm-report', refresh: 'manual', subsetLabel: 'cluster', active: true,
};

export const BUILT_IN_FUNDERS: readonly Funder[] = [EU_FUNDER];
export const BUILT_IN_PROGRAMMES: readonly Programme[] = [HORIZON_EUROPE];

/** Page of a topic on the Funding & Tenders portal. */
export const PORTAL_TOPIC_PAGE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
export const portalTopicUrl = (topicId: string): string => `${PORTAL_TOPIC_PAGE}${topicId.toLowerCase()}`;

/** Status of a call at `today` ('YYYY-MM-DD') from its dates: unknown without deadline, forthcoming before its opening,
 * open while a deadline is ahead, closed after the last one. */
export const statusFromDeadlines = (deadlines: string[], today: string, openingDate?: string | null): CallStatus => {
  if (!deadlines.length) return 'unknown';
  if (openingDate && openingDate > today) return 'forthcoming';
  return deadlines.some((d) => d >= today) ? 'open' : 'closed';
};
