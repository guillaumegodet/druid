import React, { useMemo, useState } from 'react';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import {
  aggregateInternational,
  aggregateFlows,
  aggregateFlowMap,
  aggregateTeamOrgNetwork,
  aggregateCountryHeatmap,
  InternationalAggregates,
} from './internationalAggregates';
import { MarketShareSection } from './MarketShareSection';
import { CountryEvolutionChart } from './charts/CountryEvolutionChart';
import { TeamOrgNetworkChart } from './charts/TeamOrgNetworkChart';
import { IntlVsNationalChart } from './charts/IntlVsNationalChart';
import { IntlPercentChart } from './charts/IntlPercentChart';
import { WorldChoroplethChart } from './charts/WorldChoroplethChart';
import { TopCountriesChart } from './charts/TopCountriesChart';
import { CountryHeatmapChart } from './charts/CountryHeatmapChart';
import { EuZoneChart } from './charts/EuZoneChart';
import { EuByYearChart } from './charts/EuByYearChart';
import { TopPartnersChart } from './charts/TopPartnersChart';
import { FlowMapChart } from './charts/FlowMapChart';
import { SankeyChart } from './charts/SankeyChart';
import { SunburstChart } from './charts/SunburstChart';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">{children}</div>
);

/** Key figures when the tab opens: intl/national evolution, world map,
 * top countries, top partner organizations. */
const InternationalOverview: React.FC<{ agg: InternationalAggregates }> = ({ agg }) => (
  <div className="flex flex-col gap-4">
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <IntlVsNationalChart data={agg.intlByYear} />
      <IntlPercentChart data={agg.intlPctByYear} />
    </div>

    <WorldChoroplethChart data={agg.byCountry} />

    <TopCountriesChart data={agg.byCountry} />

    {agg.topPartners.length > 0 ? (
      <TopPartnersChart data={agg.topPartners} />
    ) : (
      <Empty><Trans>No foreign partner organisation identified over the period.</Trans></Empty>
    )}
  </div>
);

/** More specialized/exploratory views — loaded only on demand (their own
 * aggregates, not computed until this sub-tab is opened). */
const InternationalDetail: React.FC<{ dataset: DashboardDataset; range: YearRange; agg: InternationalAggregates }> = ({
  dataset,
  range,
  agg,
}) => {
  const { i18n } = useLingui();
  const { publications, countryNames, lab } = dataset;
  // i18n.locale: country names are produced by the aggregates → recompute on language change.
  const flows = useMemo(
    () => aggregateFlows(publications, range, countryNames, lab),
    [publications, range, countryNames, lab, i18n.locale],
  );
  const flowMap = useMemo(
    () => aggregateFlowMap(publications, range, countryNames, lab),
    [publications, range, countryNames, lab, i18n.locale],
  );
  const teamOrgNetwork = useMemo(
    () => aggregateTeamOrgNetwork(publications, range),
    [publications, range],
  );
  const heatmap = useMemo(
    () => aggregateCountryHeatmap(agg.inRange, agg.byCountry),
    [agg.inRange, agg.byCountry, i18n.locale],
  );

  return (
    <div className="flex flex-col gap-4">
      {flowMap.points.length > 0 ? (
        <FlowMapChart data={flowMap} />
      ) : (
        <Empty><Trans>No geolocated foreign partner organisation over the period.</Trans></Empty>
      )}

      <CountryHeatmapChart data={heatmap} />

      <CountryEvolutionChart
        publications={publications}
        range={range}
        countryNames={countryNames}
        inRange={agg.inRange}
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <EuZoneChart data={agg.euZone} />
        </div>
        <div className="lg:col-span-3">
          <EuByYearChart data={agg.euByYear} />
        </div>
      </div>

      <MarketShareSection
        publications={publications}
        range={range}
        countryNames={countryNames}
        inRange={agg.inRange}
      />

      {flows.sankey.links.length > 0 && (
        <>
          <SankeyChart nodes={flows.sankey.nodes} links={flows.sankey.links} />
          <SunburstChart data={flows.sunburst} />
        </>
      )}

      {teamOrgNetwork.links.length > 0 && <TeamOrgNetworkChart data={teamOrgNetwork} />}
    </div>
  );
};

const VIEWS: { key: 'overview' | 'detail'; label: MessageDescriptor }[] = [
  { key: 'overview', label: msg`Overview` },
  { key: 'detail', label: msg`Explore further` },
];

/**
 * « Collaborations internationales » tab (ported from the SoVisu+ mockups).
 * Split into two views (2026-09-03, cf. the Collaborations pages re-split
 * scenario): the page had become slow to load — two redundant world maps
 * (WorldChoroplethChart and the MapLibre prototype WorldCollabMap, removed),
 * and several heavy aggregates (flows/flowMap/teamOrgNetwork) computed
 * systematically even when their charts stayed out of view. Only `agg`
 * (aggregateInternational) is shared between the two views; the rest is
 * computed only if « Approfondir » is open (conditional mounting, like the
 * CollaborationsTab sub-tabs).
 * The search by partner institution now lives in its own sub-tab
 * (« Institutions partenaires », CollaborationsTab.tsx) — it used to be
 * mounted twice (here and in Nationales), each redoing the same costly
 * scan of the corpus.
 */
export const InternationalTab: React.FC<{ dataset: DashboardDataset; range: YearRange }> = ({
  dataset,
  range,
}) => {
  const { t, i18n } = useLingui();
  const { publications, countryNames } = dataset;
  const [view, setView] = useState<'overview' | 'detail'>('overview');

  const agg = useMemo(
    () => aggregateInternational(publications, range, countryNames),
    [publications, range, countryNames, i18n.locale],
  );

  const viewBtn = (active: boolean) =>
    `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
      active
        ? 'bg-accent text-ink shadow-nav-active'
        : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {VIEWS.map(({ key, label }) => (
          <button key={key} type="button" className={viewBtn(view === key)} onClick={() => setView(key)}>
            {t(label)}
          </button>
        ))}
      </div>

      {view === 'overview' && <InternationalOverview agg={agg} />}
      {view === 'detail' && <InternationalDetail dataset={dataset} range={range} agg={agg} />}
    </div>
  );
};
