// Inter-lab mode of the « Réseau » tab (docs/plan-reseau-inter-labos.md, lots 3 and 4):
// client of /api/network/:slug (server.cjs + scripts/lib/co_network.cjs), fed by the
// university-wide network.json of druid-biblio.

import { NetworkData } from './networkAggregates';
import { DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';

/** Category of the aggregated lab nodes (OTHER_LABS_CATEGORY of co_network.cjs). */
export const OTHER_LABS_CATEGORY = '__other_labs__';
/** « Exclude large collaborations » threshold, same as the partner breakdown of Collaborations. */
export const LARGE_COLLAB_MAX_AUTHORS = 50;

export interface NetworkLab {
  acronym: string;
  slug: string | null;
  /** Authors resolved to this lab in the university corpus. */
  authors: number;
}

export interface InterLabNetworkResponse extends NetworkData {
  /** Composite structure the graph comes from (e.g. univ-nantes). */
  source: string;
  generatedAt: string;
  /** Acronym of the current lab (null on a composite dashboard). */
  focus: string | null;
  labs: NetworkLab[];
  coverage: { authors: number; resolvedAuthors: number; signatures: number; resolvedSignatures: number };
  /** The user only sees the other labs' authors who co-signed with their own lab(s). */
  restricted: boolean;
  /** Author nodes dropped by the server cap. */
  truncated: number;
}

export interface InterLabParams {
  labs: string[];
  range: YearRange;
  minPubs: number;
  crossOnly: boolean;
  aggregateOthers: boolean;
  excludeLarge: boolean;
}

const query = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(p)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();

/** Graph of the requested labs (the current lab is always included by the server). */
export async function fetchInterLabNetwork(
  slug: string,
  params: InterLabParams | null,
  signal?: AbortSignal,
): Promise<InterLabNetworkResponse | null> {
  // null = metadata only (labs + coverage, for the picker).
  const qs = params == null ? 'meta=1' : query({
    labs: params.labs.join(','),
    from: params.range.start,
    to: params.range.end,
    minPubs: params.minPubs,
    maxAuthors: params.excludeLarge ? LARGE_COLLAB_MAX_AUTHORS : undefined,
    crossOnly: params.crossOnly ? 1 : undefined,
    aggregateOthers: params.aggregateOthers ? 1 : undefined,
  });
  const res = await fetch(`/api/network/${encodeURIComponent(slug)}?${qs}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as InterLabNetworkResponse;
}

export interface CommonPublication {
  year: number;
  title: string | null;
  doi: string | null;
  authorCount: number | null;
}

/** Publications behind a link (`a` / `b` = node ids of the graph). */
export async function fetchCommonPublications(
  slug: string,
  a: string,
  b: string,
  range: YearRange,
  excludeLarge: boolean,
  signal?: AbortSignal,
): Promise<{ publications: CommonPublication[]; total: number }> {
  const qs = query({
    a,
    b,
    from: range.start,
    to: range.end,
    maxAuthors: excludeLarge ? LARGE_COLLAB_MAX_AUTHORS : undefined,
  });
  const res = await fetch(`/api/network/${encodeURIComponent(slug)}/publications?${qs}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Labs of the university ranked for the picker: most co-publications with the current
 * structure first (nantesPartners of its own corpus, over the period), then alphabetical.
 */
export function rankLabSuggestions(
  labs: NetworkLab[],
  focus: string | null,
  publications: DashboardPublication[],
  range: YearRange,
): { lab: NetworkLab; copubs: number }[] {
  const counts = new Map<string, number>();
  for (const p of publications) {
    if (typeof p.year !== 'number' || p.year < range.start || p.year > range.end) continue;
    for (const acr of new Set(p.nantesPartners)) counts.set(acr, (counts.get(acr) ?? 0) + 1);
  }
  return labs
    .filter((l) => l.acronym !== focus && l.slug)
    .map((lab) => ({ lab, copubs: counts.get(lab.acronym) ?? 0 }))
    .sort((x, y) => y.copubs - x.copubs || x.lab.acronym.localeCompare(y.lab.acronym));
}
