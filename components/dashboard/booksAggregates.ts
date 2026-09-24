// Aggregations of the « Ouvrages » (books) tab (chapters & monographs) — ported
// from the SoVisu+ mockups (booksAggregates.ts). Series colors are assigned
// at render time by slot of the validated palette, in this fixed order.

import { DashboardPublication } from './types';
import { CountItem, YearRange } from './overviewAggregates';

/** Publication types considered as « ouvrages » (books), fixed order (= color slot). */
export const BOOK_TYPES = [
  'Chapitre de livre',
  'Monographie',
  "Direction/coordination d'ouvrage",
  'Coordination',
];

export interface BooksAggregates {
  byType: CountItem[];
  years: number[];
  series: { name: string; slot: number; data: number[] }[];
  total: number;
}

export function aggregateBooks(
  pubs: DashboardPublication[],
  range: YearRange,
): BooksAggregates {
  const bookKeys = new Set(BOOK_TYPES);
  const inRange = pubs.filter(
    (p) =>
      typeof p.year === 'number' &&
      p.year >= range.start &&
      p.year <= range.end &&
      p.pubType != null &&
      bookKeys.has(p.pubType),
  );

  const typeCount = new Map<string, number>();
  const years = Array.from(new Set(inRange.map((p) => p.year as number))).sort((a, b) => a - b);
  const yearTypeCount = new Map<string, Map<number, number>>();

  for (const p of inRange) {
    const type = p.pubType as string;
    typeCount.set(type, (typeCount.get(type) ?? 0) + 1);
    if (!yearTypeCount.has(type)) yearTypeCount.set(type, new Map());
    const ym = yearTypeCount.get(type)!;
    ym.set(p.year as number, (ym.get(p.year as number) ?? 0) + 1);
  }

  const byType: CountItem[] = BOOK_TYPES.filter((b) => typeCount.has(b))
    .map((b) => ({ key: b, count: typeCount.get(b) ?? 0 }))
    .sort((a, b) => b.count - a.count);

  const series = BOOK_TYPES.map((b, slot) => ({ name: b, slot, data: [] as number[] }))
    .filter((s) => typeCount.has(s.name))
    .map((s) => ({
      ...s,
      data: years.map((y) => yearTypeCount.get(s.name)?.get(y) ?? 0),
    }));

  return { byType, years, series, total: inRange.length };
}
