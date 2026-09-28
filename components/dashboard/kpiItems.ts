// Key figures of the dashboard as plain values (label, value, hint), shared by
// the KPI cards of the tabs and by the `kpis` blocks of the reports
// (docs/plan-mes-rapports.md § 2): the PDF prints them as a grid, the preview
// renders them as cards. Icons and colors stay in the card components.

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { numberLocale } from '../../lib/i18n';
import { aggregateImpact, type ImpactKpis } from './impactAggregates';
import { aggregateOverview, CONFERENCE_LABEL, type OverviewKpis, type YearRange } from './overviewAggregates';
import { partnerImpactItems, partnerKpiItems, type PartnerKpiContext } from './partnerKpis';
import type { PubFilters } from './publicationFilters';
import type { DashboardDataset } from './types';

export interface KpiItem {
  /** Stable key (icon and color of the card). */
  key: string;
  label: string;
  value: string;
  hint?: string;
  /** Filter of the publication list opened by a click on the card. */
  filter?: PubFilters;
}

const fmt = (n: number) => n.toLocaleString(numberLocale());

export function overviewKpiItems(kpis: OverviewKpis): KpiItem[] {
  const intlHint =
    kpis.intlPct != null
      ? (kpis.intlUnknown > 0 ? i18n._(msg`${kpis.intlPct}% (excluding undetermined)`) : `${kpis.intlPct} %`)
      : undefined;
  return [
    { key: 'publications', label: i18n._(msg`Publications`), value: fmt(kpis.total) },
    {
      key: 'international',
      label: i18n._(msg({ message: `International`, context: "feminine plural" })),
      value: fmt(kpis.intl),
      hint: intlHint,
      filter: { international: true },
    },
    {
      key: 'foreign',
      label: i18n._(msg`In a foreign language`),
      value: fmt(kpis.foreign),
      hint: kpis.foreignPct != null ? `${kpis.foreignPct} %` : undefined,
    },
    {
      key: 'apc',
      label: i18n._(msg`Publications with APC`),
      value: fmt(kpis.apcCount),
      hint: kpis.apcTotalEur > 0 ? `${fmt(Math.round(kpis.apcTotalEur))} EUR` : undefined,
      filter: { hasApc: true },
    },
    {
      key: 'french',
      label: i18n._(msg`In French`),
      value: fmt(kpis.french),
      hint: kpis.frenchPct != null ? `${kpis.frenchPct} %` : undefined,
      filter: { language: 'fr' },
    },
    {
      key: 'citations',
      label: i18n._(msg`Total citations`),
      value: fmt(kpis.citations),
      hint: kpis.citationsPerPub != null
        ? i18n._(msg`${kpis.citationsPerPub.toLocaleString(numberLocale())} / publication`)
        : undefined,
    },
    {
      key: 'conferences',
      label: i18n._(msg`Conference papers`),
      value: fmt(kpis.conf),
      hint: kpis.confPct != null ? `${kpis.confPct} %` : undefined,
      filter: { pubType: CONFERENCE_LABEL },
    },
    {
      key: 'phd',
      label: i18n._(msg`Involving PhD students`),
      value: kpis.phdKnown ? fmt(kpis.phd) : '—',
      hint: kpis.phdKnown ? undefined : i18n._(msg`staff not matched`),
      filter: kpis.phdKnown ? { hasPhd: true } : undefined,
    },
  ];
}

export function impactKpiItems(kpis: ImpactKpis): KpiItem[] {
  return [
    {
      key: 'fwci-known',
      label: i18n._(msg`Known FWCI`),
      value: fmt(kpis.nbFwci),
      hint: kpis.pctFwci != null ? i18n._(msg`${kpis.pctFwci}% of the corpus`) : undefined,
    },
    {
      key: 'top10',
      label: i18n._(msg`Top 10% most cited`),
      value: fmt(kpis.nbTop10),
      hint: kpis.pctTop10 != null ? `${kpis.pctTop10} %` : undefined,
    },
    {
      key: 'top1',
      label: i18n._(msg`Top 1% most cited`),
      value: fmt(kpis.nbTop1),
      hint: kpis.pctTop1 != null ? `${kpis.pctTop1} %` : undefined,
    },
    {
      key: 'fwci-mean',
      label: i18n._(msg`Mean FWCI`),
      value: kpis.fwciMean != null ? kpis.fwciMean.toFixed(2) : '—',
      hint: i18n._(msg`World reference = 1.00`),
    },
  ];
}

export interface KpiSet {
  label: MessageDescriptor;
  /**
   * `dataset` = restricted corpus of the block; `ctx` = the whole corpus of its structure and the
   * block filters, for the sets comparing both (partner rank, impact reference).
   */
  items: (dataset: DashboardDataset, range: YearRange, ctx?: PartnerKpiContext) => KpiItem[];
}

const noContext: PartnerKpiContext = { source: null, filters: {} };

/** Key-figure rows available to report `kpis` blocks. ⚠️ Keys = KPI_SET_IDS (embedIds.ts). */
export const KPI_SETS: Record<string, KpiSet> = {
  overview: {
    label: msg`Key figures — overview`,
    items: (dataset, range) => overviewKpiItems(aggregateOverview(dataset.publications, range).kpis),
  },
  impact: {
    label: msg`Key figures — impact`,
    items: (dataset, range) => impactKpiItems(aggregateImpact(dataset.publications, range).kpis),
  },
  partner: {
    label: msg`Key figures — collaboration`,
    items: (dataset, range, ctx) => partnerKpiItems(dataset, range, ctx ?? noContext),
  },
  'partner-impact': {
    label: msg`Key figures — impact of the collaboration`,
    items: (dataset, range, ctx) => partnerImpactItems(dataset, range, ctx ?? noContext),
  },
};
