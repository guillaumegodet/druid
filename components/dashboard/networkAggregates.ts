// Internal co-authorship network — ported from the SoVisu+ mockups
// (networkAggregates.ts). Nodes = internal authors, edges = co-publications.

import { AuthorMeta, DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { TEAM_UNKNOWN } from './structureAggregates';

export interface NetworkNode {
  id: string;
  name: string;
  value: number; // number of publications
  category: number;
  /** Inter-lab mode: `lab` = aggregated node of a lab not expanded (plan-reseau-inter-labos.md, lot 4). */
  kind?: 'author' | 'lab';
  /** Inter-lab mode: labs of the author (several = a bridge between labs). */
  labs?: string[];
}

export interface NetworkLink {
  source: string;
  target: string;
  value: number; // co-publications
  /** Inter-lab mode: the two ends share no lab. */
  cross?: boolean;
}

export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
  categories: { name: string }[];
}

/**
 * Authors below the `minPubs` threshold are dropped for readability.
 * Category (color) = the author's first team.
 */
export function aggregateNetwork(
  pubs: DashboardPublication[],
  authors: AuthorMeta[],
  range: YearRange,
  minPubs = 2,
): NetworkData {
  const inRange = pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );
  const meta = new Map(authors.map((a) => [a.id, a]));

  const pubCount = new Map<number, number>();
  for (const p of inRange) {
    for (const id of new Set(p.authorIds)) {
      pubCount.set(id, (pubCount.get(id) ?? 0) + 1);
    }
  }
  const kept = new Set(
    Array.from(pubCount.entries())
      .filter(([, c]) => c >= minPubs)
      .map(([id]) => id),
  );

  const edge = new Map<string, number>();
  for (const p of inRange) {
    const ids = Array.from(new Set(p.authorIds)).filter((id) => kept.has(id));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = Math.min(ids[i], ids[j]);
        const b = Math.max(ids[i], ids[j]);
        const key = `${a}|${b}`;
        edge.set(key, (edge.get(key) ?? 0) + 1);
      }
    }
  }

  const teamOf = (id: number) => {
    const tms = meta.get(id)?.teams ?? [];
    return tms.length ? tms[0] : TEAM_UNKNOWN;
  };
  const catNames = Array.from(new Set(Array.from(kept).map(teamOf))).sort();
  const catIndex = new Map(catNames.map((c, i) => [c, i]));

  const nodes: NetworkNode[] = Array.from(kept).map((id) => ({
    id: String(id),
    name: meta.get(id)?.label ?? `#${id}`,
    value: pubCount.get(id) ?? 0,
    category: catIndex.get(teamOf(id)) ?? 0,
  }));

  const links: NetworkLink[] = Array.from(edge.entries()).map(([k, v]) => {
    const [a, b] = k.split('|');
    return { source: a, target: b, value: v };
  });

  return { nodes, links, categories: catNames.map((name) => ({ name })) };
}
