import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { estimateCost, exceedsBudget } from '../unifiedAlignRuns';

const { runCost, scopusBudget, affordable, ALIGN_COST } = createRequire(import.meta.url)('../../scripts/lib/align_estimate.cjs');

const snap = (at: string, quota: Record<string, unknown>) => ({ finishedAt: at, quota });

describe('scripts/lib/align_estimate.cjs — cost of a run and Elsevier budget', () => {
  it('runCost rounds up per pool; the client twin agrees', () => {
    expect(runCost('scopus', 'search', 500)).toEqual({ search: 850, author: 900 });
    expect(runCost('orcid', 'search', 10)).toEqual({ requests: 30 });
    expect(runCost('idref', 'verify', 10)).toEqual({});
    expect(estimateCost(ALIGN_COST.scopus.search, 500)).toEqual(runCost('scopus', 'search', 500));
  });

  it('key 1 keeps its reserve, key 2 counts in full; the latest snapshot wins; a passed reset counts as full', () => {
    const today = '2026-09-30';
    // Last answer from key 1: key 1 above its reserve, key 2 assumed untouched.
    const onKey1 = scopusBudget({ snapshots: [snap('2026-09-30T10:00:00Z', { search: { remaining: 3100, limit: 5000, reset: '2026-10-06', key: 1 } })], keyCount: 2, reserve1: 0.3, today });
    expect(onKey1.pools.search.available).toBe(3100 - 1500 + 5000);
    // Last answer from key 2: key 1 already spent down to its reserve.
    const onKey2 = scopusBudget({
      snapshots: [
        snap('2026-09-30T08:00:00Z', { search: { remaining: 4000, limit: 5000, reset: '2026-10-06', key: 1 } }),
        snap('2026-09-30T20:22:04Z', { search: { remaining: 4974, limit: 5000, reset: '2026-10-07', key: 2 } }),
      ],
      keyCount: 2, reserve1: 0.3, today,
    });
    expect(onKey2.pools.search).toMatchObject({ available: 4974, key: 2, reset: '2026-10-07' });
    // No snapshot, or a reset date in the past: full week again.
    expect(scopusBudget({ snapshots: [], keyCount: 1, reserve1: 0.3, today }).pools.author.available).toBe(3500);
    const reset = scopusBudget({ snapshots: [snap('2026-09-20T10:00:00Z', { author: { remaining: 10, limit: 5000, reset: '2026-09-29', key: 1 } })], keyCount: 2, reserve1: 0.3, today });
    expect(reset.pools.author.available).toBe(3500 + 5000);
    // Key 1 under its reserve with a single key: nothing left for the alignment.
    expect(scopusBudget({ snapshots: [snap('2026-09-30T10:00:00Z', { search: { remaining: 1200, limit: 5000, reset: '2026-10-06' } })], keyCount: 1, reserve1: 0.3, today }).pools.search.available).toBe(0);
  });

  it('affordable = records the tightest pool covers; exceedsBudget flags a run beyond it', () => {
    const budget = { pools: { search: { available: 1700 }, author: { available: 9000 } } };
    expect(affordable(budget, 'search')).toBe(1000);
    expect(affordable({ pools: {} }, 'verify')).toBe(0);
    const pools = { search: { available: 1700, remaining: 1700, key: 2, reset: null, asOf: null }, author: { available: 9000, remaining: 9000, key: 1, reset: null, asOf: null } };
    expect(exceedsBudget(ALIGN_COST.scopus.search, 1000, pools)).toBe(false);
    expect(exceedsBudget(ALIGN_COST.scopus.search, 1001, pools)).toBe(true);
    expect(exceedsBudget(ALIGN_COST.orcid.search, 100000, pools)).toBe(false);   // no quota metered
  });
});
