// Aggregations of the « Vue d'ensemble » (overview) tab — ported from the SoVisu+
// mockups (overviewAggregates.ts). Pure client-side computations on the publication set.

import { DashboardPublication } from './types';

export interface YearRange {
  start: number;
  end: number;
}

export const CONFERENCE_LABEL = 'Communication de conférence';
export const JOURNAL_ARTICLE_LABEL = 'Article de revue';

// OpenAlex only provides the USD-normalized value (value_usd), sometimes the journal's
// native currency. Everything is brought back to euros: exact native amount if already in EUR,
// otherwise conversion of the normalized USD at the average rate below. No real-time exchange
// rate (order-of-magnitude dashboard) — adjust this constant if the rate drifts.
export const USD_TO_EUR = 0.92;

/**
 * OpenAlex estimate brought back to €: paid if known, else list price; native EUR
 * kept as is, other currencies converted from the normalized USD. Ignores the publisher
 * agreement (see ApcTab.tsx::bestEurOf for the version that takes it into account).
 * Shared with ApcTab.tsx (which already imports YearRange from here) so that the APC total
 * of the Overview tab and that of the APC tab remain the same value (review lot 8).
 */
export function oaEurOf(p: DashboardPublication): number | null {
  const d = p.apcDetail;
  if (!d) return null;
  const pick = (amount: number | null, currency: string | null, usd: number | null) => {
    if (amount != null && amount > 0 && (currency ?? '').toUpperCase() === 'EUR') return amount;
    if (usd != null) return usd * USD_TO_EUR;
    return null;
  };
  return pick(d.paidAmount, d.paidCurrency, d.paidUsd) ?? pick(d.listAmount, d.listCurrency, d.listUsd);
}

export interface OverviewKpis {
  total: number;
  intl: number;
  intlKnown: number;
  intlUnknown: number;
  intlPct: number | null;
  foreign: number;
  foreignPct: number | null;
  french: number;
  frenchPct: number | null;
  apcCount: number;
  apcTotalEur: number;
  citations: number;
  citationsPerPub: number | null;
  conf: number;
  confPct: number | null;
  phd: number;
  /** Does headcount data exist (otherwise « doctorants » = not computable)? */
  phdKnown: boolean;
  /** RICL ≈ journal articles indexed in Scimago (known quartile). */
  ricl: number;
  /** Span of the observed period (min→max years of the filtered publications). */
  nbYears: number;
}

export interface CountItem {
  key: string;
  count: number;
}

export interface OverviewAggregates {
  kpis: OverviewKpis;
  byYear: { year: number; count: number }[];
  byLanguage: CountItem[];
  byType: CountItem[];
  byOa: CountItem[];
}

/** Stable display order of OA statuses (from most open to closed). */
export const OA_ORDER = ['diamond', 'gold', 'green', 'hybrid', 'bronze', 'closed', 'unknown'];

export function getYearBounds(pubs: DashboardPublication[]): { min: number; max: number } {
  const years = pubs.map((p) => p.year).filter((y): y is number => typeof y === 'number');
  if (years.length === 0) {
    const now = new Date().getUTCFullYear();
    return { min: now, max: now };
  }
  return { min: Math.min(...years), max: Math.max(...years) };
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function tally(values: (string | null | undefined)[]): CountItem[] {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = v && v.trim() ? v : 'unknown';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export function aggregateOverview(
  pubs: DashboardPublication[],
  range: YearRange,
): OverviewAggregates {
  const inRange = pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );

  const total = inRange.length;
  const intl = inRange.filter((p) => p.isInternational === true).length;
  const intlUnknown = inRange.filter(
    (p) => p.isInternational === null || p.isInternational === undefined,
  ).length;
  const intlKnown = total - intlUnknown;
  const foreign = inRange.filter((p) => p.isForeignLanguage).length;
  const french = inRange.filter((p) => p.language === 'fr').length;
  const apcPubs = inRange.filter((p) => p.hasApc);
  // oaEurOf (not raw p.apcAmount): a non-EUR currency mixed into the total would skew the KPI
  // (review lot 8) — same conversion as the APC tab (ApcTab.tsx::aggregateApc).
  const apcTotalEur = apcPubs.reduce((sum, p) => sum + (oaEurOf(p) ?? 0), 0);
  const citations = inRange.reduce((s, p) => s + (p.citedByCount ?? 0), 0);
  const conf = inRange.filter((p) => p.pubType === CONFERENCE_LABEL).length;
  const phd = inRange.filter((p) => p.hasPhd).length;
  // PhD students computable only if headcounts are matched (teams or hasPhd present)
  const phdKnown = pubs.some((p) => p.hasPhd || p.teams.some((tm) => tm && tm !== 'Non identifié'));
  const ricl = inRange.filter(
    (p) => p.pubType === JOURNAL_ARTICLE_LABEL && p.sjrQuartile != null,
  ).length;
  const yearsInRange = inRange
    .map((p) => p.year)
    .filter((y): y is number => typeof y === 'number');
  const nbYears = yearsInRange.length
    ? Math.max(...yearsInRange) - Math.min(...yearsInRange) + 1
    : 0;

  const kpis: OverviewKpis = {
    total,
    intl,
    intlKnown,
    intlUnknown,
    intlPct: pct(intl, intlKnown),
    foreign,
    foreignPct: pct(foreign, total),
    french,
    frenchPct: pct(french, total),
    apcCount: apcPubs.length,
    apcTotalEur,
    citations,
    citationsPerPub: total > 0 ? Math.round((citations / total) * 10) / 10 : null,
    conf,
    confPct: pct(conf, total),
    phd,
    phdKnown,
    ricl,
    nbYears,
  };

  const yearMap = new Map<number, number>();
  for (const p of inRange) {
    if (typeof p.year === 'number') yearMap.set(p.year, (yearMap.get(p.year) ?? 0) + 1);
  }
  const byYear = Array.from(yearMap.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  const byLanguage = tally(inRange.map((p) => p.language));
  const byType = tally(inRange.map((p) => p.pubType));
  const byOa = tally(inRange.map((p) => p.oaStatus)).sort(
    (a, b) => OA_ORDER.indexOf(a.key) - OA_ORDER.indexOf(b.key),
  );

  return { kpis, byYear, byLanguage, byType, byOa };
}

/** Folds the categories beyond `max` into a single « Autres » entry (readable donuts). */
export function foldSmallCategories(items: CountItem[], max = 6, otherKey = '__other__'): CountItem[] {
  if (items.length <= max) return items;
  const kept = items.slice(0, max - 1);
  const other = items.slice(max - 1).reduce((s, it) => s + it.count, 0);
  return [...kept, { key: otherKey, count: other }];
}
