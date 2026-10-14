import { describe, expect, it } from 'vitest';
import { effectiveAxisOf, normalizeDoi, normalizeReviewInput, workKeyOf, type AxisReview } from '../publications/axisReviews';

const review = (partial: Partial<AxisReview>): AxisReview => ({
  workKey: 'doi:10.1/x', doi: '10.1/x', title: 'T', decision: 'confirmed', axes: [], autoAxis: 'A', autoConfidence: 0.8,
  author: 'u', note: '', updatedAt: '', ...partial,
});

describe('workKeyOf', () => {
  it('keys by the DOI without resolver, lowercase, else by the normalised title', () => {
    expect(normalizeDoi('https://doi.org/10.1234/ABC.D')).toBe('10.1234/abc.d');
    expect(workKeyOf({ doi: 'https://doi.org/10.1234/ABC', title: 'x' })).toBe('doi:10.1234/abc');
    expect(workKeyOf({ doi: '', title: 'Électrodes organiques — Li-ion!' })).toBe('title:electrodesorganiquesliion');
    expect(workKeyOf({ doi: null, title: null })).toBe('');
  });
});

describe('effectiveAxisOf', () => {
  it('follows the decision', () => {
    expect(effectiveAxisOf(undefined, 'A', 'NC')).toBe('A');
    expect(effectiveAxisOf(undefined, null, 'NC')).toBe('NC');
    expect(effectiveAxisOf(review({ decision: 'confirmed' }), 'A', 'NC')).toBe('A');
    expect(effectiveAxisOf(review({ decision: 'corrected', axes: ['B', 'C'] }), 'A', 'NC')).toBe('B');
    expect(effectiveAxisOf(review({ decision: 'rejected' }), 'A', 'NC')).toBe('NC');
    expect(effectiveAxisOf(review({ decision: 'unsure' }), 'A', 'NC')).toBe('A');
  });
});

describe('normalizeReviewInput', () => {
  it('requires an axis for a correction and drops the axes of the other decisions', () => {
    expect(normalizeReviewInput({ workKey: 'k', decision: 'corrected', axes: [' B '] })?.axes).toEqual(['B']);
    expect(normalizeReviewInput({ workKey: 'k', decision: 'corrected', axes: [] })).toBeNull();
    expect(normalizeReviewInput({ workKey: 'k', decision: 'rejected', axes: ['B'] })?.axes).toEqual([]);
    expect(normalizeReviewInput({ workKey: '', decision: 'confirmed' })).toBeNull();
    expect(normalizeReviewInput({ workKey: 'k', decision: 'bogus' as never })).toBeNull();
  });
});
