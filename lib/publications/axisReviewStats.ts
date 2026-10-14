// Curation view of the strategic axes (druid-internal docs/plan-axes-embeddings.md, lot 3): pure helpers over the
// reviews of a structure — index by publication key, progress, agreement with the automatic classification, review
// sample. Shared by the tab and its tests.
import { workKeyOf, type AxisReview, type AxisReviewDecision } from './axisReviews';

export interface ReviewablePublication {
  doi: string | null;
  title: string | null;
  year?: number | null;
  /** Automatic axis as the ETL wrote it (`a|b` possible), null = unclassified. */
  chosenAxe: string | null;
  axeConfidence?: number | null;
}

export type ReviewIndex = Map<string, AxisReview>;

export const indexReviews = (reviews: AxisReview[]): ReviewIndex => new Map(reviews.map((r) => [r.workKey, r]));

export const reviewOf = (index: ReviewIndex, p: ReviewablePublication): AxisReview | undefined => {
  const key = workKeyOf(p);
  return key ? index.get(key) : undefined;
};

/** Automatic axis of a publication (first one when several), `unclassified` when none. */
export const autoAxisOf = (p: ReviewablePublication, unclassified: string): string =>
  (p.chosenAxe ?? '').split('|')[0].trim() || unclassified;

export interface ReviewProgress {
  total: number;
  reviewed: number;
  byDecision: Record<AxisReviewDecision, number>;
  /** Share of the decided reviews (confirmed, corrected, rejected) that confirmed the automatic axis. */
  agreement: number | null;
  /** Per automatic axis: publications, reviewed, confirmed. */
  byAxis: { axis: string; total: number; reviewed: number; confirmed: number }[];
}

export function reviewProgress(pubs: ReviewablePublication[], index: ReviewIndex, axes: string[], unclassified: string): ReviewProgress {
  const byDecision: Record<AxisReviewDecision, number> = { confirmed: 0, corrected: 0, rejected: 0, unsure: 0 };
  const byAxis = new Map<string, { axis: string; total: number; reviewed: number; confirmed: number }>(
    [...axes, unclassified].map((a) => [a, { axis: a, total: 0, reviewed: 0, confirmed: 0 }]));
  let reviewed = 0;
  for (const p of pubs) {
    const axis = autoAxisOf(p, unclassified);
    const row = byAxis.get(axis) ?? { axis, total: 0, reviewed: 0, confirmed: 0 };
    byAxis.set(axis, row);
    row.total += 1;
    const r = reviewOf(index, p);
    if (!r) continue;
    reviewed += 1;
    byDecision[r.decision] += 1;
    row.reviewed += 1;
    if (r.decision === 'confirmed') row.confirmed += 1;
  }
  const decided = byDecision.confirmed + byDecision.corrected + byDecision.rejected;
  return {
    total: pubs.length, reviewed, byDecision, agreement: decided ? byDecision.confirmed / decided : null,
    byAxis: [...byAxis.values()].filter((r) => r.total > 0),
  };
}

/**
 * Review sample: `size` publications not reviewed yet, spread over the automatic axes (unclassified included) and, within
 * an axis, over the confidence levels (lowest first then alternating), so that the reviewers see the doubtful cases as
 * much as the sure ones. Deterministic for a given `seed` (a simple LCG shuffle).
 */
export function reviewSample<T extends ReviewablePublication>(pubs: T[], index: ReviewIndex, size: number, unclassified: string, seed = 1): T[] {
  let state = seed >>> 0 || 1;
  const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const groups = new Map<string, T[]>();
  for (const p of pubs) {
    if (reviewOf(index, p)) continue;
    const axis = autoAxisOf(p, unclassified);
    groups.set(axis, [...(groups.get(axis) ?? []), p]);
  }
  const queues = [...groups.values()].map((list) => {
    const shuffled = [...list].sort(() => rnd() - 0.5);
    // Half of each group taken among the least confident, the other half at random.
    const byConfidence = [...shuffled].sort((a, b) => (a.axeConfidence ?? 1) - (b.axeConfidence ?? 1));
    const low = byConfidence.slice(0, Math.ceil(byConfidence.length / 2));
    const rest = shuffled.filter((p) => !low.includes(p));
    const out: T[] = [];
    while (low.length || rest.length) {
      if (low.length) out.push(low.shift()!);
      if (rest.length) out.push(rest.shift()!);
    }
    return out;
  });
  const out: T[] = [];
  while (out.length < size && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= size) break;
      const p = q.shift();
      if (p) out.push(p);
    }
  }
  return out;
}
