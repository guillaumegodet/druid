import { describe, expect, it } from 'vitest';
import { pairAuthorKey, pairKeyOf, withFeedback, type PairFeedback } from '../pairs/feedback';

// Opinions on the suggested connections (druid-internal `docs/plan-binomes-chercheurs.md`, lot 4). Fictitious names.

describe('pair keys', () => {
  it('uses the Druid record id, else the normalized name', () => {
    expect(pairAuthorKey({ uid: 'rivet-a', label: 'Ana Rivet' })).toBe('u:rivet-a');
    expect(pairAuthorKey({ label: '  Ben   Losier ' })).toBe('n:ben losier');
  });

  it('does not depend on the order of the researchers', () => {
    const a = { uid: 'rivet-a', label: 'Ana Rivet' };
    const b = { label: 'Ben Losier' };
    expect(pairKeyOf(a, b)).toBe(pairKeyOf(b, a));
    expect(pairKeyOf(a, b)).toBe('n:ben losier|u:rivet-a');
  });
});

describe('withFeedback', () => {
  it('attaches the opinions and moves the pairs the viewer set aside last', () => {
    const items = [{ key: 'k1' }, { key: 'k2' }, { key: 'k3' }, { key: 'k4' }];
    const feedback = new Map<string, PairFeedback>([
      ['k1', { counts: { not_relevant: 1 }, mine: 'not_relevant' }],
      ['k2', { counts: { relevant: 2 }, mine: null }],
      ['k3', { counts: { already_in_contact: 1, relevant: 1 }, mine: 'already_in_contact' }],
    ]);
    const out = withFeedback(items, feedback);
    expect(out.map((s) => s.key)).toEqual(['k2', 'k4', 'k1', 'k3']);
    expect(out[0].feedback.counts).toEqual({ relevant: 2 });
    expect(out[1].feedback).toEqual({ counts: {}, mine: null });
  });
});
