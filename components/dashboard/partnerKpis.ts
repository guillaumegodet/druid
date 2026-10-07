// Key figures of a collaboration with a partner institution or group (docs/plan-mes-rapports.md
// § 5.2, « Collaboration avec une université » template): computed on the co-publications (the
// block dataset restricted by partnerKeys) and compared with the whole corpus of the structure.
//
// Impact reference (archived plan-rapport-collaboration-partenaire § 0, point 4): co-publications
// with a foreign partner are expected to be more cited than the structure's average, and the
// field mix matters (Ottawa: cardiology). The co-publications are therefore compared with the
// structure's own INTERNATIONAL co-publications of the same subfields, reweighted by the subfield
// mix of the collaboration — not with the raw corpus.

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { numberLocale } from '../../lib/i18n';
import { buildPartnerCatalog, unitsOfDataset } from './collabAggregates';
import type { KpiItem } from './kpiItems';
import { countryLabel } from './labels';
import type { YearRange } from './overviewAggregates';
import type { PubFilters } from './publicationFilters';
import type { DashboardDataset, DashboardPublication } from './types';

/** Threshold of « large collaborations » (decision D2, same as PartnerBreakdownSection). */
export const LARGE_COLLAB_AUTHORS = 50;
/** Reference publications needed for a subfield to enter the comparable reference. */
const MIN_REFERENCE = 5;
/** Open access statuses (OpenAlex oa_status), shared with the country focus. */
export const OPEN_STATUSES = new Set(['diamond', 'gold', 'green', 'hybrid', 'bronze']);

const fmt = (n: number) => n.toLocaleString(numberLocale());
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
const inRange = (pubs: DashboardPublication[], r: YearRange) =>
  pubs.filter((p) => typeof p.year === 'number' && p.year >= r.start && p.year <= r.end);

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Co-publications of the first and the second half of the period (the middle year of an odd period is left out). */
export function halfTrend(pubs: DashboardPublication[], r: YearRange) {
  const years = r.end - r.start + 1;
  const half = Math.floor(years / 2);
  if (half < 1) return null;
  const first = { start: r.start, end: r.start + half - 1 };
  const second = { start: r.end - half + 1, end: r.end };
  const a = inRange(pubs, first).length;
  const b = inRange(pubs, second).length;
  return { first, second, a, b, change: a > 0 ? Math.round(((b - a) / a) * 100) : null };
}

/**
 * Rank of a partner among the partners of the structure of the same kind (foreign or French —
 * a foreign university ranked among French labs and hospitals would read oddly), and in its country.
 */
export function partnerRank(source: DashboardPublication[], key: string) {
  const all = buildPartnerCatalog(source);
  const entry = all.find((c) => c.key === key);
  if (!entry) return null;
  const catalog = all.filter((c) => c.scope === entry.scope);
  const i = catalog.findIndex((c) => c.key === key);
  const sameCountry = entry.countryCode ? catalog.filter((c) => c.countryCode === entry.countryCode) : [];
  return {
    name: entry.name,
    scope: entry.scope,
    rank: i + 1,
    of: catalog.length,
    countryCode: entry.countryCode ?? null,
    countryRank: entry.countryCode ? sameCountry.findIndex((c) => c.key === key) + 1 : null,
  };
}

export interface ImpactComparison {
  fwciMedian: number | null;
  top10Share: number | null;
  withFwci: number;
  /** Reference reweighted by the subfield mix of the co-publications (null when too thin). */
  refFwciMedian: number | null;
  refTop10Share: number | null;
  /** Share of the co-publications (with FWCI) whose subfield entered the reference. */
  coverage: number;
}

/**
 * Impact of the co-publications vs the international co-publications of the structure in the
 * same subfields (primary subfield = first OpenAlex subfield), large collaborations excluded
 * from both sides when `maxAuthors` is set.
 */
export function compareImpact(
  copubs: DashboardPublication[],
  source: DashboardPublication[],
  r: YearRange,
  maxAuthors?: number,
): ImpactComparison {
  const keep = (p: DashboardPublication) =>
    typeof p.fwci === 'number' && (maxAuthors == null || typeof p.authorCount !== 'number' || p.authorCount <= maxAuthors);
  const co = inRange(copubs, r).filter(keep);
  const ref = inRange(source, r).filter((p) => p.isInternational === true && keep(p));
  const primary = (p: DashboardPublication) => p.subfields[0] ?? '';
  const top10 = (ps: DashboardPublication[]) => (ps.length ? ps.filter((p) => p.isTop10Percent === true).length / ps.length : null);

  const refBySubfield = new Map<string, DashboardPublication[]>();
  for (const p of ref) refBySubfield.set(primary(p), [...(refBySubfield.get(primary(p)) ?? []), p]);
  const weights = new Map<string, number>();
  for (const p of co) weights.set(primary(p), (weights.get(primary(p)) ?? 0) + 1);

  let covered = 0;
  let fwciSum = 0;
  let top10Sum = 0;
  for (const [sf, w] of weights) {
    const rs = refBySubfield.get(sf);
    if (!sf || !rs || rs.length < MIN_REFERENCE) continue;
    covered += w;
    fwciSum += w * (median(rs.map((p) => p.fwci as number)) ?? 0);
    top10Sum += w * (top10(rs) ?? 0);
  }
  return {
    fwciMedian: median(co.map((p) => p.fwci as number)),
    top10Share: top10(co),
    withFwci: co.length,
    refFwciMedian: covered > 0 ? fwciSum / covered : null,
    refTop10Share: covered > 0 ? top10Sum / covered : null,
    coverage: co.length ? covered / co.length : 0,
  };
}

export interface PartnerKpiContext {
  /** Whole corpus of the structure in the block scope (no filter). */
  source: DashboardDataset | null;
  filters: PubFilters;
}

/** Volume, trend, rank, people and labs of the collaboration. */
export function partnerKpiItems(dataset: DashboardDataset, range: YearRange, ctx: PartnerKpiContext): KpiItem[] {
  const pubs = inRange(dataset.publications, range);
  const n = pubs.length;
  const items: KpiItem[] = [{ key: 'copubs', label: i18n._(msg`Co-publications`), value: fmt(n) }];

  const trend = halfTrend(dataset.publications, range);
  if (trend && trend.change != null) {
    const { first, second } = trend;
    const span = (x: YearRange) => (x.start === x.end ? String(x.start) : `${x.start}–${x.end}`);
    items.push({
      key: 'trend',
      label: i18n._(msg`Trend`),
      value: `${trend.change > 0 ? '+' : ''}${trend.change} %`,
      hint: `${span(first)} : ${fmt(trend.a)} → ${span(second)} : ${fmt(trend.b)}`,
    });
  }

  const key = ctx.filters.partnerKeys?.[0];
  const rank = key && ctx.source ? partnerRank(inRange(ctx.source.publications, range), key) : null;
  if (rank) {
    const country = rank.countryCode ? countryLabel(rank.countryCode, ctx.source!.countryNames) : null;
    const rankHint = rank.scope === 'international'
      ? i18n._(msg`of ${fmt(rank.of)} foreign partners`)
      : i18n._(msg`of ${fmt(rank.of)} French partners`);
    items.push({
      key: 'rank',
      label: (ctx.filters.partnerKeys?.length ?? 0) > 1 ? i18n._(msg`Rank of ${rank.name}`) : i18n._(msg`Partner rank`),
      value: `${rank.rank}`,
      hint: country && rank.countryRank ? `${rankHint} · ${i18n._(msg`${rank.countryRank} in ${country}`)}` : rankHint,
    });
  }

  const researchers = new Set(pubs.flatMap((p) => p.authorIds));
  items.push({ key: 'researchers', label: i18n._(msg`Researchers involved`), value: fmt(researchers.size) });

  const units = unitsOfDataset(dataset);
  if (units.kind) {
    const labs = new Set(pubs.flatMap(units.of));
    const withoutLab = pubs.filter((p) => units.of(p).length === 0).length;
    items.push({
      key: 'labs',
      label: units.kind === 'labs' ? i18n._(msg`Labs involved`) : i18n._(msg`Teams involved`),
      value: fmt(labs.size),
      hint: withoutLab ? i18n._(msg`${fmt(withoutLab)} publications without identified lab`) : undefined,
    });
  }

  const open = pubs.filter((p) => OPEN_STATUSES.has(p.oaStatus ?? '')).length;
  const openPct = pct(open, n);
  if (openPct != null) items.push({ key: 'open', label: i18n._(msg`Open access`), value: `${openPct} %`, hint: `${fmt(open)} / ${fmt(n)}` });

  const large = pubs.filter((p) => typeof p.authorCount === 'number' && p.authorCount > LARGE_COLLAB_AUTHORS).length;
  const largePct = pct(large, n);
  if (largePct != null) {
    items.push({
      key: 'large',
      label: i18n._(msg`Large collaborations`),
      value: `${largePct} %`,
      hint: i18n._(msg`${fmt(large)} publications with more than ${LARGE_COLLAB_AUTHORS} authors`),
    });
  }
  return items;
}

/** Impact of the co-publications compared with the comparable reference. */
export function partnerImpactItems(dataset: DashboardDataset, range: YearRange, ctx: PartnerKpiContext): KpiItem[] {
  return impactComparisonItems(compareImpact(dataset.publications, ctx.source?.publications ?? [], range, ctx.filters.maxAuthors));
}

/** Key figures of an impact comparison (partner and country collaborations). */
export function impactComparisonItems(c: ImpactComparison): KpiItem[] {
  const two = (x: number | null) => (x == null ? '—' : x.toLocaleString(numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const share = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`);
  const ref = (text: string) => i18n._(msg`reference: ${text}`);
  return [
    {
      key: 'fwci-median',
      label: i18n._(msg`Median FWCI`),
      value: two(c.fwciMedian),
      hint: c.refFwciMedian != null ? ref(two(c.refFwciMedian)) : undefined,
    },
    {
      key: 'top10-share',
      label: i18n._(msg`Top 10% share`),
      value: share(c.top10Share),
      hint: c.refTop10Share != null ? ref(share(c.refTop10Share)) : undefined,
    },
    {
      key: 'fwci-known',
      label: i18n._(msg`Known FWCI`),
      value: fmt(c.withFwci),
      hint: c.refFwciMedian != null
        ? i18n._(msg`${Math.round(c.coverage * 100)}% compared with the reference`)
        : i18n._(msg`reference too thin`),
    },
  ];
}
