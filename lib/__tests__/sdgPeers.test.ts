import { describe, expect, it } from 'vitest';
import { computePeerRelativeSdgSignature } from '../../components/dashboard/benchmarkAggregates';
import type { DashboardPublication } from '../../components/dashboard/types';

const pub = (year: number, sdgs: number[]) =>
  ({ year, sdgs: sdgs.map((id) => ({ id, score: 0.5 })) } as unknown as DashboardPublication);

describe('computePeerRelativeSdgSignature', () => {
  const pubs = [...Array(12)].map(() => pub(2024, [3])).concat([...Array(4)].map(() => pub(2023, [3, 14])), [pub(2019, [7])]);
  const peers = {
    'own-ror': { fetchedAt: '', openalexId: 'I1', sdgs: { '3': { name: 'Health', count: 999 } } },
    'peer-a': { fetchedAt: '', openalexId: 'I2', sdgs: { '3': { name: 'Health', count: 50 }, '14': { name: 'Water', count: 25 }, 'x': { name: '?', count: 9 } } },
    'peer-b': { fetchedAt: '', openalexId: 'I3', sdgs: { '3': { name: 'Health', count: 25 } } },
  };

  it('compares the local share of each goal with the peer group, own institution excluded', () => {
    const rows = computePeerRelativeSdgSignature(pubs, { start: 2020, end: 2026 }, peers, 'own-ror', 1);
    // Local: 16 pubs with goal 3, 4 with goal 14 → 20 assignments. Peers: 75 × goal 3, 25 × goal 14.
    expect(rows.map((r) => r.id)).toEqual([3, 14]);
    expect(rows[0]).toMatchObject({ id: 3, count: 16, share: 0.8, peerShare: 0.75 });
    expect(rows[0].ratio).toBeCloseTo(0.8 / 0.75, 5);
    expect(rows[1]).toMatchObject({ id: 14, count: 4, share: 0.2, peerShare: 0.25, ratio: 0.8 });
  });

  it('drops the goals under the minimum count and returns nothing without peers', () => {
    expect(computePeerRelativeSdgSignature(pubs, { start: 2020, end: 2026 }, peers, 'own-ror', 10).map((r) => r.id)).toEqual([3]);
    expect(computePeerRelativeSdgSignature(pubs, { start: 2020, end: 2026 }, { 'own-ror': peers['own-ror'] }, 'own-ror')).toEqual([]);
  });
});
