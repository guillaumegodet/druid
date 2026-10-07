// Key figures of the « Pays » sub-tab (docs/plan-collaboration-pays.md § 2, blocks A and I), from
// aggregateCountryFocus. Same labels as the partner collaboration (partnerKpis.ts) where they mean
// the same thing.

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { numberLocale } from '../../lib/i18n';
import type { CountryFocus } from './countryAggregates';
import type { KpiItem } from './kpiItems';
import { impactComparisonItems, LARGE_COLLAB_AUTHORS } from './partnerKpis';
import type { PubFilters } from './publicationFilters';

const fmt = (n: number) => n.toLocaleString(numberLocale());
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)} %` : '—');

/** Volume, weight, rank, trend, bilateral share, people and labs of the collaboration with a country. */
export function countryKpiItems(f: CountryFocus, listFilters: PubFilters = { country: f.cc }): KpiItem[] {
  const items: KpiItem[] = [
    { key: 'copubs', label: i18n._(msg`Co-publications`), value: fmt(f.total), filter: listFilters },
  ];
  if (f.shareOfInternational != null) {
    items.push({
      key: 'intl-share',
      label: i18n._(msg`Share of the international co-publications`),
      value: `${f.shareOfInternational.toLocaleString(numberLocale())} %`,
      hint: `${fmt(f.total)} / ${fmt(f.international)}`,
    });
  }
  if (f.rank) {
    items.push({
      key: 'rank',
      label: i18n._(msg`Rank among the partner countries`),
      value: `${f.rank.rank}`,
      hint: i18n._(msg`of ${fmt(f.rank.of)} countries`),
    });
  }
  const trend = f.trend;
  if (trend && trend.change != null) {
    const span = (x: { start: number; end: number }) => (x.start === x.end ? String(x.start) : `${x.start}–${x.end}`);
    items.push({
      key: 'trend',
      label: i18n._(msg`Trend`),
      value: `${trend.change > 0 ? '+' : ''}${trend.change} %`,
      hint: `${span(trend.first)} : ${fmt(trend.a)} → ${span(trend.second)} : ${fmt(trend.b)}`,
    });
  }
  if (f.total > 0) {
    items.push({
      key: 'bilateral',
      label: i18n._(msg`Bilateral co-publications`),
      value: pct(f.bilateral, f.total),
      hint: i18n._(msg`${fmt(f.bilateral)} without another foreign country`),
    });
  }
  items.push({ key: 'researchers', label: i18n._(msg`Researchers involved`), value: fmt(f.researchers.count) });
  if (f.units.kind) {
    items.push({
      key: 'labs',
      label: f.units.kind === 'labs' ? i18n._(msg`Labs involved`) : i18n._(msg`Teams involved`),
      value: fmt(f.units.count),
      hint: f.units.without ? i18n._(msg`${fmt(f.units.without)} publications without identified lab`) : undefined,
    });
  }
  if (f.total > 0) {
    items.push({ key: 'open', label: i18n._(msg`Open access`), value: pct(f.openAccess, f.total), hint: `${fmt(f.openAccess)} / ${fmt(f.total)}` });
    items.push({
      key: 'large',
      label: i18n._(msg`Large collaborations`),
      value: pct(f.large, f.total),
      hint: i18n._(msg`${fmt(f.large)} publications with more than ${LARGE_COLLAB_AUTHORS} authors`),
    });
  }
  return items;
}

/** Impact of the co-publications vs the other international co-publications of the same subfields. */
export const countryImpactItems = (f: CountryFocus): KpiItem[] => impactComparisonItems(f.impact);
