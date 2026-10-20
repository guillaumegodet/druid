// Researcher pairs (druid-internal `docs/plan-binomes-chercheurs.md`, lot 1): client of /api/network/:slug/pairs
// (server.cjs + rankPairs of scripts/lib/co_network.cjs), computed on the university-wide network.json.

import { YearRange } from './overviewAggregates';
import { LARGE_COLLAB_MAX_AUTHORS } from './interLabNetwork';

/** How a lab of the author is known (network.json v3): directory member, associate, or publications only. */
export type PairMembership = 'stat' | 'assoc' | 'pubs';
export type PairTrend = 'new' | 'rising' | 'steady' | 'dormant';

export interface PairAuthor {
  id: number;
  label: string;
  /** Labs kept by the membership filter. */
  labs: string[];
  poles: string[];
  phd: boolean;
  m?: Record<string, PairMembership>;
  /** Druid record of the researcher, when the directory join found a single person. */
  uid?: string;
}

export interface ResearcherPair {
  a: PairAuthor;
  b: PairAuthor;
  /** Joint publications over the period. */
  shared: number;
  /** Part of each researcher's publications of the period (null = unknown). */
  share: [number | null, number | null];
  first: number;
  last: number;
  trend: PairTrend;
  /** 1 − cosine of the OpenAlex field profiles, outside the joint publications (null = unknown). */
  distance: number | null;
  crossPole: boolean;
  subfields: string[];
}

export interface PairsResponse {
  source: string;
  generatedAt: string;
  version: number;
  /** Labs of the current structure (null = the whole university). */
  structureLabs: string[] | null;
  poles: { acronym: string; name: string }[];
  coverage: { authors: number; resolvedAuthors: number; signatures: number; resolvedSignatures: number };
  restricted: boolean;
  pairs: ResearcherPair[];
  total: number;
  counts: { new: number; dormant: number; rising: number; steady: number; distant: number; crossPole: number; authors: number };
  refYear: number | null;
}

/** « Distant profiles » threshold (DISTANT_PROFILES of co_network.cjs, decision D10). */
export const DISTANT_PROFILES = 0.5;

/** Which pairs: different labs, different poles, or a couple of poles (`A|B`). */
export type PairRelation = 'lab' | 'pole' | `${string}|${string}`;

export interface PairsParams {
  range: YearRange;
  relation: PairRelation;
  scope: 'all' | 'structure';
  distantOnly: boolean;
  membership: 'all' | 'associates' | 'members';
  includePhd: boolean;
  excludeLarge: boolean;
  minShared: number;
}

export async function fetchPairs(slug: string, p: PairsParams, signal?: AbortSignal): Promise<PairsResponse | null> {
  const qs = new URLSearchParams({
    from: String(p.range.start),
    to: String(p.range.end),
    minShared: String(p.minShared),
    scope: p.scope,
    membership: p.membership,
    phd: p.includePhd ? '1' : '0',
    limit: '2000',
  });
  if (p.excludeLarge) qs.set('maxAuthors', String(LARGE_COLLAB_MAX_AUTHORS));
  if (p.relation === 'pole') qs.set('crossPole', '1');
  else if (p.relation !== 'lab') qs.set('poles', p.relation.split('|').join(','));
  if (p.distantOnly) qs.set('minDistance', String(DISTANT_PROFILES));
  const res = await fetch(`/api/network/${encodeURIComponent(slug)}/pairs?${qs}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as PairsResponse;
}
