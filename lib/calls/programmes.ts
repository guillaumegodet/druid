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

const PORTAL_PROGRAMMES = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/programmes/';
/** Source of every programme of the Funding & Tenders portal (lib/calls/ftPortal.ts). */
export const FT_PORTAL_SOURCE = 'ft-portal';
const portal = (programmeId: string, name: string, slug: string, subsetLabel: string, active: boolean, kind: ProgrammeKind = 'thematic'): Programme => ({
  programmeId, funderId: EU_FUNDER.funderId, name, kind, url: `${PORTAL_PROGRAMMES}${slug}`, source: FT_PORTAL_SOURCE, refresh: 'daily', subsetLabel, active,
});

/** Horizon Europe pillar 2 (clusters CL1-CL6): calls from the portal, matches from the Topic-to-Researcher Match
 * reports of crisalid-agents (lib/calls/trm.ts). */
export const HORIZON_EUROPE: Programme = portal('horizon-europe', 'Horizon Europe', 'horizon', 'cluster', true);

/**
 * Programmes of the Funding & Tenders portal, recognised by lib/calls/ftPortal.ts (programmeOfPortalTopic). Active by
 * default: the first wave of docs/plan-funding-calls.md (D1); the others wait for the administrator (Administration ›
 * Calls for proposals). `active` is the initial value only: the table keeps the administrator's choice.
 */
export const PORTAL_PROGRAMMES_BUILT_IN: readonly Programme[] = [
  HORIZON_EUROPE,
  portal('erc', 'ERC — European Research Council', 'horizon', 'scheme', true, 'mixed'),
  portal('msca', 'MSCA — Marie Skłodowska-Curie Actions', 'horizon', 'scheme', true, 'mixed'),
  portal('eic', 'EIC — European Innovation Council', 'horizon', 'scheme', true),
  portal('horizon-missions', 'Horizon Europe — Missions', 'horizon', 'mission', true),
  portal('horizon-infra', 'Horizon Europe — Research infrastructures', 'horizon', 'destination', true),
  portal('horizon-widera', 'Horizon Europe — Widening participation and ERA', 'horizon', 'destination', true),
  portal('horizon-eie', 'Horizon Europe — European innovation ecosystems', 'horizon', '', false),
  portal('horizon-ju', 'Horizon Europe — Joint undertakings (institutionalised partnerships)', 'horizon', 'partnership', false),
  portal('euratom', 'Euratom', 'euratom', '', false),
  portal('digital-europe', 'Digital Europe', 'digital', '', false),
  portal('life', 'LIFE', 'life', '', false),
  portal('edf', 'European Defence Fund', 'edf', '', false),
  portal('eu4health', 'EU4Health', 'eu4health', '', false),
  portal('cef', 'Connecting Europe Facility', 'cef', '', false),
  portal('erasmus-plus', 'Erasmus+', 'erasmus', '', false),
  portal('creative-europe', 'Creative Europe', 'crea', '', false),
  portal('cerv', 'Citizens, Equality, Rights and Values', 'cerv', '', false),
];

export const BUILT_IN_FUNDERS: readonly Funder[] = [EU_FUNDER];
export const BUILT_IN_PROGRAMMES: readonly Programme[] = PORTAL_PROGRAMMES_BUILT_IN;

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
