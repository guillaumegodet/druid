// Curation of the strategic axes (druid-internal docs/plan-axes-embeddings.md, lot 2): the decision of a user on the
// automatic classification of a publication. Pure module shared by the browser (Axes tab) and the API
// (/api/v1/axis-reviews): publication key, decisions, effective axis.
import { normTitle } from '../normalize';

export const AXIS_REVIEW_DECISIONS = ['confirmed', 'corrected', 'rejected', 'unsure'] as const;
export type AxisReviewDecision = typeof AXIS_REVIEW_DECISIONS[number];

export interface AxisReview {
  workKey: string;
  doi: string;
  title: string;
  decision: AxisReviewDecision;
  /** Retained axes, principal first; empty for rejected and unsure. */
  axes: string[];
  autoAxis: string;
  autoConfidence: number | null;
  author: string;
  note: string;
  updatedAt: string;
}

/** What a reviewer sends; the key, the author and the date are set server side. */
export interface AxisReviewInput {
  workKey: string;
  doi?: string;
  title?: string;
  decision: AxisReviewDecision;
  axes?: string[];
  autoAxis?: string;
  autoConfidence?: number | null;
  note?: string;
}

/** DOI without its resolver prefix, lowercase. */
export const normalizeDoi = (doi: string | null | undefined): string =>
  String(doi ?? '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:/, '');

/**
 * Key of a publication across ETL runs: its DOI when it has one, else its normalised title (the rule of the Grist
 * corrections, axesCorrections.findAxisCorrection). Empty when the publication has neither.
 */
export const workKeyOf = (p: { doi?: string | null; title?: string | null }): string => {
  const doi = normalizeDoi(p.doi);
  if (doi) return `doi:${doi}`;
  const title = normTitle(p.title ?? '');
  return title ? `title:${title}` : '';
};

/** Axis the charts count once a review is taken into account: the retained axis, « unclassified » for a rejected
 * publication, the automatic axis for a confirmation or a doubt. */
export const effectiveAxisOf = (review: AxisReview | undefined, autoAxis: string | null, unclassified: string): string => {
  if (!review) return autoAxis || unclassified;
  if (review.decision === 'corrected') return review.axes[0] || unclassified;
  if (review.decision === 'rejected') return unclassified;
  return autoAxis || unclassified;
};

/** Validity of an input: a correction names at least one axis, the other decisions carry none. */
export const normalizeReviewInput = (input: AxisReviewInput): AxisReviewInput | null => {
  if (!input.workKey || !AXIS_REVIEW_DECISIONS.includes(input.decision)) return null;
  const axes = (input.axes ?? []).map((a) => a.trim()).filter(Boolean);
  if (input.decision === 'corrected' && !axes.length) return null;
  return { ...input, axes: input.decision === 'corrected' || input.decision === 'confirmed' ? axes : [], note: (input.note ?? '').slice(0, 2000) };
};
