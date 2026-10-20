// Researcher pairs (druid-internal `docs/plan-binomes-chercheurs.md`, lot 1): client of /api/network/:slug/pairs
// (server.cjs + rankPairs of scripts/lib/co_network.cjs), computed on the university-wide network.json.

import { YearRange } from './overviewAggregates';
import { LARGE_COLLAB_MAX_AUTHORS } from './interLabNetwork';
import { enumParam, intParam, type ChartParams } from './chartMeta';

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
  counts: {
    new: number; dormant: number; rising: number; steady: number; distant: number; crossPole: number;
    /** Researchers in at least one pair. */
    authors: number;
    /** Researchers of the structure who published over the period, and those among them in a pair / a cross-pole pair. */
    perimeter: number; perimeterEngaged: number; perimeterCrossPole: number;
  };
  /** Pairs per couple of labs / of poles (a = b: within one pole), most pairs first. */
  labMatrix: PairCell[];
  poleMatrix: PairCell[];
  refYear: number | null;
}

export interface PairCell {
  a: string;
  b: string;
  pairs: number;
  new: number;
  dormant: number;
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
  /** Cell of the lab matrix: one researcher in lab A, the other in lab B. */
  labPair?: [string, string] | null;
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
  if (p.labPair) qs.set('labPair', p.labPair.join(','));
  const res = await fetch(`/api/network/${encodeURIComponent(slug)}/pairs?${qs}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as PairsResponse;
}

/**
 * Options of a report block (PAIRS_PARAMS of chartMeta.ts, already sanitized) → request; a missing
 * parameter takes the default of the « Researcher pairs » sub-tab.
 */
export function pairsParamsOf(range: YearRange, params: ChartParams | undefined): PairsParams {
  const poles = enumParam<`${string}|${string}`>(params, 'poles');
  return {
    range,
    relation: poles ?? (enumParam(params, 'relation') === 'pole' ? 'pole' : 'lab'),
    scope: enumParam(params, 'scope') === 'structure' ? 'structure' : 'all',
    membership: enumParam<PairsParams['membership']>(params, 'membership') ?? 'all',
    includePhd: enumParam(params, 'phd') !== 'exclude',
    excludeLarge: enumParam(params, 'large') !== 'include',
    distantOnly: enumParam(params, 'profiles') === 'distant',
    minShared: intParam(params, 'minShared') ?? 2,
  };
}

/** Inverse of pairsParamsOf: the options of the sub-tab as block parameters (« Add to a report »). */
export function pairsChartParams(p: PairsParams): ChartParams {
  const out: ChartParams = {};
  if (p.relation === 'pole') out.relation = 'pole';
  else if (p.relation !== 'lab') out.poles = p.relation;
  if (p.scope !== 'all') out.scope = p.scope;
  if (p.membership !== 'all') out.membership = p.membership;
  if (p.minShared !== 2) out.minShared = p.minShared;
  if (p.distantOnly) out.profiles = 'distant';
  if (!p.includePhd) out.phd = 'exclude';
  if (!p.excludeLarge) out.large = 'include';
  return out;
}
