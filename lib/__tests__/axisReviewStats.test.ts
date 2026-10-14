import { describe, expect, it } from 'vitest';
import type { AxisReview } from '../publications/axisReviews';
import { autoAxisOf, indexReviews, reviewOf, reviewProgress, reviewSample } from '../publications/axisReviewStats';

const NC = 'Autre / Non classé';
const pub = (doi: string, chosenAxe: string | null, axeConfidence?: number) => ({ doi, title: `T ${doi}`, chosenAxe, axeConfidence });
const review = (doi: string, decision: AxisReview['decision'], axes: string[] = []): AxisReview =>
  ({ workKey: `doi:${doi}`, doi, title: '', decision, axes, autoAxis: '', autoConfidence: null, author: 'u', note: '', updatedAt: '' });

describe('reviewProgress', () => {
  it('counts the reviews per decision and per automatic axis', () => {
    const pubs = [pub('1', 'A'), pub('2', 'A|B'), pub('3', null), pub('4', 'B')];
    const index = indexReviews([review('1', 'confirmed'), review('2', 'corrected', ['B']), review('3', 'rejected')]);
    const progress = reviewProgress(pubs, index, ['A', 'B'], NC);
    expect(progress.total).toBe(4);
    expect(progress.reviewed).toBe(3);
    expect(progress.byDecision).toEqual({ confirmed: 1, corrected: 1, rejected: 1, unsure: 0 });
    expect(progress.agreement).toBeCloseTo(1 / 3);
    expect(progress.byAxis).toEqual([
      { axis: 'A', total: 2, reviewed: 2, confirmed: 1 }, { axis: 'B', total: 1, reviewed: 0, confirmed: 0 }, { axis: NC, total: 1, reviewed: 1, confirmed: 0 },
    ]);
    expect(reviewOf(index, pubs[1])?.axes).toEqual(['B']);
    expect(autoAxisOf(pubs[1], NC)).toBe('A');
  });
});

describe('reviewSample', () => {
  it('skips reviewed publications, spreads over the axes and favours low confidence', () => {
    const pubs = [
      ...Array.from({ length: 10 }, (_, i) => pub(`a${i}`, 'A', i / 10)),
      ...Array.from({ length: 10 }, (_, i) => pub(`b${i}`, 'B', i / 10)),
      ...Array.from({ length: 4 }, (_, i) => pub(`n${i}`, null, 0.8)),
    ];
    const index = indexReviews([review('a0', 'confirmed'), review('b0', 'confirmed')]);
    const sample = reviewSample(pubs, index, 6, NC, 42);
    expect(sample).toHaveLength(6);
    expect(sample.map((p) => p.doi)).not.toContain('a0');
    const axes = sample.map((p) => autoAxisOf(p, NC));
    expect(new Set(axes)).toEqual(new Set(['A', 'B', NC]));
    // The first publication taken in A is among the least confident unreviewed ones.
    const firstA = sample.find((p) => p.chosenAxe === 'A')!;
    expect(firstA.axeConfidence!).toBeLessThanOrEqual(0.5);
    expect(reviewSample(pubs, index, 6, NC, 42).map((p) => p.doi)).toEqual(sample.map((p) => p.doi)); // deterministic
    expect(reviewSample(pubs, index, 100, NC).length).toBe(22);
  });
});
