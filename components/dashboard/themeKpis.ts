// Key figures of the « Analyse des financements » and « Analyse des revues » templates
// (docs/plan-mes-rapports.md § 5.4 and § 5.5, lot 10). Same contract as partnerKpis.ts: computed
// on the block dataset, compared when useful with the whole corpus of the structure (ctx.source).

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { numberLocale } from '../../lib/i18n';
import { funderCategory, fundersOf, hasFunding } from './fundersAggregates';
import type { KpiItem } from './kpiItems';
import { aggregateOverview, type YearRange } from './overviewAggregates';
import { median, type PartnerKpiContext } from './partnerKpis';
import { aggregateCharte, aggregateJournals } from './phase4Aggregates';
import type { DashboardDataset, DashboardPublication } from './types';

const OPEN = new Set(['diamond', 'gold', 'green', 'hybrid', 'bronze']);
/** Exported document type of journal articles (data value). */
const ARTICLE_TYPE = 'Article de revue';
const fmt = (n: number) => n.toLocaleString(numberLocale());
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
const two = (x: number | null) =>
  x == null ? '—' : x.toLocaleString(numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inRange = (pubs: DashboardPublication[], r: YearRange) =>
  pubs.filter((p) => typeof p.year === 'number' && p.year >= r.start && p.year <= r.end);
const fwcis = (pubs: DashboardPublication[]) => pubs.flatMap((p) => (typeof p.fwci === 'number' ? [p.fwci] : []));
const top10Share = (pubs: DashboardPublication[]) => {
  const known = pubs.filter((p) => typeof p.fwci === 'number');
  return known.length ? known.filter((p) => p.isTop10Percent === true).length / known.length : null;
};

/**
 * Funding: coverage (share of the corpus acknowledging a funder — funding data are declarative
 * and partial), ANR / European funding, and the impact of funded publications against the
 * structure's publications that acknowledge no funder.
 */
export function fundingKpiItems(dataset: DashboardDataset, range: YearRange, ctx: PartnerKpiContext): KpiItem[] {
  const pubs = inRange(dataset.publications, range);
  const funded = pubs.filter(hasFunding);
  const whole = inRange(ctx.source?.publications ?? dataset.publications, range);
  // Impact compared on journal articles only: half of the unfunded publications of univ-nantes have a
  // FWCI of 0 (chapters, conference papers, « Autre »), which made the comparison meaningless
  // (median 1.29 vs 0.00; articles: 1.56 vs 0.62 — checked on the real corpus, 2026-09-28).
  const fundedArticles = funded.filter((p) => p.pubType === ARTICLE_TYPE);
  const unfunded = whole.filter((p) => !hasFunding(p) && p.pubType === ARTICLE_TYPE);
  const coverage = pct(whole.filter(hasFunding).length, whole.length);
  const funders = new Set(funded.flatMap(fundersOf));
  const inCategory = (cat: string) => funded.filter((p) => fundersOf(p).some((n) => funderCategory(n) === cat)).length;
  const share = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`);
  const ref = (text: string) => i18n._(msg`articles without funder: ${text}`);
  return [
    {
      key: 'funded',
      label: i18n._(msg`Funded publications`),
      value: fmt(funded.length),
      hint: coverage != null ? i18n._(msg`${coverage}% of the corpus acknowledges a funder`) : undefined,
      filter: { funded: true },
    },
    { key: 'funders', label: i18n._(msg`Distinct funders`), value: fmt(funders.size) },
    { key: 'anr', label: i18n._(msg`ANR-funded`), value: fmt(inCategory('ANR')), filter: { funderCategory: 'ANR' } },
    { key: 'europe', label: i18n._(msg`European funding`), value: fmt(inCategory('Europe')), filter: { funderCategory: 'Europe' } },
    {
      key: 'fwci-funded',
      label: i18n._(msg`Median FWCI of funded articles`),
      value: two(median(fwcis(fundedArticles))),
      hint: unfunded.length ? ref(two(median(fwcis(unfunded)))) : undefined,
    },
    {
      key: 'top10-funded',
      label: i18n._(msg`Top 10% share of funded articles`),
      value: share(top10Share(fundedArticles)),
      hint: unfunded.length ? ref(share(top10Share(unfunded))) : undefined,
    },
  ];
}

/** Journals: where the structure publishes, quartiles, open access, NU access, APC, charter. */
export function journalsKpiItems(dataset: DashboardDataset, range: YearRange): KpiItem[] {
  const pubs = inRange(dataset.publications, range);
  const j = aggregateJournals(dataset.publications, range);
  const withQuartile = pubs.filter((p) => p.sjrQuartile);
  const q1 = pct(withQuartile.filter((p) => p.sjrQuartile === 'Q1').length, withQuartile.length);
  const open = pct(pubs.filter((p) => OPEN.has(p.oaStatus ?? '')).length, pubs.length);
  const overview = aggregateOverview(dataset.publications, range).kpis;
  const charte = aggregateCharte(dataset.publications, range);
  const items: KpiItem[] = [
    {
      key: 'journals',
      label: i18n._(msg`Distinct journals`),
      value: fmt(j.nbJournals),
      hint: j.topJournal ? i18n._(msg`most frequent: ${j.topJournal.name}`) : undefined,
    },
    {
      key: 'q1',
      label: i18n._(msg`Q1 journals`),
      value: q1 != null ? `${q1} %` : '—',
      hint: i18n._(msg`of the ${fmt(withQuartile.length)} publications with a quartile`),
      filter: { quartile: 'Q1' },
    },
    { key: 'open', label: i18n._(msg`Open access`), value: open != null ? `${open} %` : '—' },
  ];
  if (j.hasAccessData) {
    const accessible = pct(j.nbAccessible, j.nbPubs);
    items.push({ key: 'accessible', label: i18n._(msg`Accessible at NU`), value: accessible != null ? `${accessible} %` : '—' });
    items.push({ key: 'national-licence', label: i18n._(msg`National licence (ISTEX)`), value: fmt(j.lnPubs), filter: { licenceNationale: true } });
  }
  items.push({
    key: 'apc',
    label: i18n._(msg`Publications with APC`),
    value: fmt(overview.apcCount),
    hint: overview.apcTotalEur > 0 ? `${fmt(Math.round(overview.apcTotalEur))} EUR` : undefined,
    filter: { hasApc: true },
  });
  if (charte.analysable > 0) {
    items.push({
      key: 'charter',
      label: i18n._(msg`Signature charter compliance`),
      value: `${Math.round((charte.conformes / charte.analysable) * 100)} %`,
      hint: i18n._(msg`of the ${fmt(charte.analysable)} analysable publications`),
    });
  }
  return items;
}
