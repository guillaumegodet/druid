// Registry of embeddable charts: public identifier (= the chart's exportName,
// stable — it appears in shared URLs, do not rename) → label + component
// recomputing its aggregates from the dataset.
// Druid equivalent of the SoVisu+ mockups' embedRegistry.tsx.

import React, { useMemo } from 'react';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useVizTheme } from './EChartCard';
import { DashboardDataset } from './types';
import { YearRange, aggregateOverview } from './overviewAggregates';
import { axeOfPub, type PubFilters } from './publicationFilters';
import {
  aggregateInternational,
  aggregateFlows,
  aggregateFlowMap,
  aggregateCountryHeatmap,
} from './internationalAggregates';
import { aggregateImpact } from './impactAggregates';
import { aggregateBooks } from './booksAggregates';
import { aggregateSources } from './sourcesAggregates';
import {
  aggregateTeams,
  aggregateTeamRadar,
  aggregateResearchers,
  aggregatePhd,
} from './structureAggregates';
import { aggregateNetwork } from './networkAggregates';
import {
  aggregateJournals,
  aggregateKeywords,
  aggregateAxes,
  aggregateCharte,
  accessLabel,
  JOURNAL_ACCESS_COLORS,
} from './phase4Aggregates';
import { TopJournalsChart } from './charts/TopJournalsChart';
import {
  CharteScoresChart,
  CharteRateChart,
  CharteCriteresChart,
  CharteTeamsChart,
} from './CharteTab';
import { AccessBarChart, AccessibleEvolutionChart } from './JournalsTab';
import { ApcYearlyChart, ApcByJournalChart, aggregateApc } from './ApcTab';
import {
  FundersTopChart,
  FundersCategoryChart,
  FundersByLaboChart,
  FundersYearChart,
} from './FundersTab';
import { aggregateFunders, aggregateCategoryByLabo } from './fundersAggregates';
import {
  aggregateCollabTypology,
  aggregateInternalCollab,
  aggregateNationalCollab,
  aggregatePartnerBreakdown,
  buildPartnerCatalog,
  internalLabsOf,
} from './collabAggregates';
import { TEAM_UNKNOWN } from './structureAggregates';
import { FranceMapChart } from './charts/FranceMapChart';
import { aggregateTeamOrgNetwork } from './internationalAggregates';
import { CountryEvolutionChart } from './charts/CountryEvolutionChart';
import { TeamOrgNetworkChart } from './charts/TeamOrgNetworkChart';

import { YearlyEvolutionChart } from './charts/YearlyEvolutionChart';
import { LanguageDonutChart } from './charts/LanguageDonutChart';
import { PublicationTypesChart } from './charts/PublicationTypesChart';
import { OpenAccessDonutChart } from './charts/OpenAccessDonutChart';
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
import { QuartileChart } from './charts/QuartileChart';
import { TopByYearChart } from './charts/TopByYearChart';
import { FwciHistogramChart } from './charts/FwciHistogramChart';
import { BooksByYearChart } from './charts/BooksByYearChart';
import {
  TeamDonutChart,
  StackedAreaChart,
  StackedBarHChart,
  TeamRadarChart,
  TeamHeatmapChart,
  RankBarChart,
} from './charts/TeamCharts';
import { NetworkChart } from './charts/NetworkChart';
import { FwciMeanByGroupChart, TopByGroupChart } from './charts/ImpactGroupCharts';
import { impactRowsByGrouping, type ImpactGrouping } from './impactAggregates';
import { aggregateDomains } from './phase4Aggregates';
import {
  InternalCollabDomainsChart,
  InternalCollabSankeyChart,
  InternalCollabSubfieldsChart,
  TypologyDonutChart,
  TypologyEvolutionChart,
} from './CollaborationsTab';
import { axisColorOf } from './AxesTab';
import { ApcByLaboChart, aggregateDealByLabo } from './ApcTab';
import { enumParam, intParam, type ChartParams } from './chartMeta';
import type { TeamRadarLevel } from './structureAggregates';

export interface EmbedChartProps {
  dataset: DashboardDataset;
  range: YearRange;
  /**
   * Chart parameters declared in CHART_META (chartMeta.ts), already sanitized;
   * a missing key means the chart's usual default.
   */
  params?: ChartParams;
  /**
   * Filters the dataset was restricted with (already applied): only read by the charts that
   * need the partner group itself (partner-breakdown-*).
   */
  filters?: PubFilters;
}

/** Charter threshold as a fraction (tab default: 75 %). */
const charteSeuilOf = (p: EmbedChartProps) => (intParam(p.params, 'thresholdPct') ?? 75) / 100;

/** Compliant / non-compliant donut in the current theme colors. */
const CharteConformiteDonut: React.FC<{ conformes: number; analysable: number }> = ({
  conformes,
  analysable,
}) => {
  const t = useVizTheme();
  return (
    <TeamDonutChart
      title={i18n._(msg`Corpus compliance`)}
      exportName="charte-conformite"
      data={[
        { name: i18n._(msg({ message: `Compliant`, context: "plural" })), value: conformes, color: t.series[2] },
        { name: i18n._(msg({ message: `Non-compliant`, context: "plural" })), value: analysable - conformes, color: t.series[7] },
      ]}
    />
  );
};

type Entry = { label: MessageDescriptor; Chart: React.FC<EmbedChartProps> };

const useOverview = ({ dataset, range }: EmbedChartProps) =>
  useMemo(() => aggregateOverview(dataset.publications, range), [dataset, range]);
const useIntl = ({ dataset, range }: EmbedChartProps) =>
  useMemo(
    () => aggregateInternational(dataset.publications, range, dataset.countryNames),
    [dataset, range],
  );
const useImpact = ({ dataset, range }: EmbedChartProps) =>
  useMemo(() => aggregateImpact(dataset.publications, range), [dataset, range]);
const useBooks = ({ dataset, range }: EmbedChartProps) =>
  useMemo(() => aggregateBooks(dataset.publications, range), [dataset, range]);
const useTeams = ({ dataset, range }: EmbedChartProps) =>
  useMemo(() => aggregateTeams(dataset.publications, range), [dataset, range]);
const useSources = ({ dataset, range }: EmbedChartProps) =>
  useMemo(() => aggregateSources(dataset.publications, range), [dataset, range]);
const useFunders = ({ dataset, range }: EmbedChartProps) =>
  useMemo(() => aggregateFunders(dataset.publications, range), [dataset, range]);

/** Axis aggregates + the tab's axis colors (config order, gray for « Autre »). */
const useAxes = ({ dataset, range }: EmbedChartProps) => {
  const t = useVizTheme();
  const axes = useMemo(() => dataset.strategicAxes.map((a) => a.name), [dataset.strategicAxes]);
  const d = useMemo(
    () => aggregateAxes(dataset.publications, range, axes, axeOfPub),
    [dataset.publications, range, axes],
  );
  const colorOf = useMemo(() => axisColorOf(t, axes), [t, axes]);
  return { d, colorOf, seriesColors: d.axeNames.map(colorOf) };
};
const useInternalCollab = ({ dataset, range }: EmbedChartProps, scope: 'structure' | 'nu') =>
  useMemo(
    () => aggregateInternalCollab(
      dataset.publications,
      range,
      scope === 'structure' ? internalLabsOf : (x) => x.nantesPartners,
    ),
    [dataset, range, scope],
  );
/** « Impact par équipe ou chercheur » charts, one registry entry per grouping (= the tab's exportNames). */
const impactGroupEntries = (
  grouping: ImpactGrouping,
  suffix: string,
  labels: { fwci: MessageDescriptor; top: MessageDescriptor },
): Record<string, Entry> => ({
  [`impact-fwci-${suffix}`]: {
    label: labels.fwci,
    Chart: (p) => {
      const rows = useMemo(
        () => impactRowsByGrouping(p.dataset.publications, p.dataset.authors, p.range, grouping),
        [p.dataset, p.range],
      );
      return <FwciMeanByGroupChart rows={rows} exportName={`impact-fwci-${suffix}`} />;
    },
  },
  [`impact-top-${suffix}`]: {
    label: labels.top,
    Chart: (p) => {
      const rows = useMemo(
        () => impactRowsByGrouping(p.dataset.publications, p.dataset.authors, p.range, grouping),
        [p.dataset, p.range],
      );
      return <TopByGroupChart rows={rows} exportName={`impact-top-${suffix}`} />;
    },
  },
});
/**
 * Per-university breakdown of the partner group named by the block filters (partnerKeys). The
 * dataset is already restricted (hyper-authored papers included or not by the block filters).
 */
const usePartnerBreakdown = ({ dataset, range, filters }: EmbedChartProps) =>
  useMemo(() => {
    const keys = filters?.partnerKeys ?? [];
    return aggregatePartnerBreakdown(
      dataset.publications, range, keys, dataset.authors, buildPartnerCatalog(dataset.publications),
    );
  }, [dataset, range, filters?.partnerKeys]);
/** Publications per member lab of a composite structure, plus those with no identified lab. */
const useLabRanking = ({ dataset, range }: EmbedChartProps) =>
  useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of dataset.publications) {
      if (typeof p.year !== 'number' || p.year < range.start || p.year > range.end) continue;
      const labs = Array.from(new Set(p.sousStructures.filter(Boolean)));
      for (const lab of labs.length ? labs : [TEAM_UNKNOWN]) counts.set(lab, (counts.get(lab) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([lab, count]) => ({ label: lab === TEAM_UNKNOWN ? i18n._(msg`No lab identified`) : lab, count, teams: [] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);
  }, [dataset, range]);

export const EMBED_CHARTS: Record<string, Entry> = {
  // ── Overview
  'publications-par-annee': {
    label: msg`Publications per year`,
    Chart: (p) => <YearlyEvolutionChart data={useOverview(p).byYear} />,
  },
  langues: {
    label: msg`Publication languages`,
    Chart: (p) => <LanguageDonutChart data={useOverview(p).byLanguage} />,
  },
  'types-publications': {
    label: msg`Publication types`,
    Chart: (p) => <PublicationTypesChart data={useOverview(p).byType} />,
  },
  'acces-ouvert': {
    label: msg`Open access`,
    Chart: (p) => <OpenAccessDonutChart data={useOverview(p).byOa} />,
  },
  // ── International
  'international-vs-national': {
    label: msg`International vs national`,
    Chart: (p) => <IntlVsNationalChart data={useIntl(p).intlByYear} />,
  },
  'pourcentage-international': {
    label: msg`Share of international publications`,
    Chart: (p) => <IntlPercentChart data={useIntl(p).intlPctByYear} />,
  },
  'carte-monde': {
    label: msg`Map of partner countries`,
    Chart: (p) => <WorldChoroplethChart data={useIntl(p).byCountry} />,
  },
  'carte-flux': {
    label: msg`Partnership flow map`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateFlowMap(p.dataset.publications, p.range, p.dataset.countryNames, p.dataset.lab),
        [p.dataset, p.range],
      );
      return <FlowMapChart data={d} />;
    },
  },
  'top-pays': {
    label: msg`Top partner countries`,
    Chart: (p) => <TopCountriesChart data={useIntl(p).byCountry} />,
  },
  'pays-annees': {
    label: msg`Partner countries by year`,
    Chart: (p) => {
      const { byCountry, inRange } = useIntl(p);
      const heatmap = useMemo(
        () => aggregateCountryHeatmap(inRange, byCountry),
        [inRange, byCountry],
      );
      return <CountryHeatmapChart data={heatmap} />;
    },
  },
  'zone-ue': {
    label: msg`European Union / outside EU`,
    Chart: (p) => <EuZoneChart data={useIntl(p).euZone} />,
  },
  'ue-par-annee': {
    label: msg`EU / outside EU by year`,
    Chart: (p) => <EuByYearChart data={useIntl(p).euByYear} />,
  },
  'top-partenaires': {
    label: msg`Top partner organisations`,
    Chart: (p) => <TopPartnersChart data={useIntl(p).topPartners} />,
  },
  'flux-sankey': {
    label: msg`Flows team → country → organisation`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateFlows(p.dataset.publications, p.range, p.dataset.countryNames, p.dataset.lab),
        [p.dataset, p.range],
      );
      return <SankeyChart nodes={d.sankey.nodes} links={d.sankey.links} />;
    },
  },
  'sunburst-partenariats': {
    label: msg`Breakdown of partnerships`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateFlows(p.dataset.publications, p.range, p.dataset.countryNames, p.dataset.lab),
        [p.dataset, p.range],
      );
      return <SunburstChart data={d.sunburst} />;
    },
  },
  // ── Impact
  'quartiles-scimago': {
    label: msg`Scimago quartiles (SJR)`,
    Chart: (p) => <QuartileChart data={useImpact(p).quartiles} />,
  },
  'top-par-annee': {
    label: msg`Top 1% / 10% publications`,
    Chart: (p) => <TopByYearChart data={useImpact(p).topByYear} />,
  },
  'distribution-fwci': {
    label: msg`FWCI distribution`,
    Chart: (p) => <FwciHistogramChart data={useImpact(p).fwciHistogram} />,
  },
  ...impactGroupEntries('sousStructure', 'sous-structure', {
    fwci: msg`Mean FWCI by sub-structure`,
    top: msg`Top 1% / 10% by sub-structure`,
  }),
  ...impactGroupEntries('team', 'equipe', { fwci: msg`Mean FWCI by team`, top: msg`Top 1% / 10% by team` }),
  ...impactGroupEntries('researcher', 'chercheur', {
    fwci: msg`Mean FWCI by researcher`,
    top: msg`Top 1% / 10% by researcher`,
  }),
  // ── Books
  'ouvrages-types': {
    label: msg`Book types`,
    Chart: (p) => (
      <PublicationTypesChart data={useBooks(p).byType} title={i18n._(msg`Book types`)} exportName="ouvrages-types" />
    ),
  },
  'ouvrages-par-annee': {
    label: msg`Books per year`,
    Chart: (p) => {
      const d = useBooks(p);
      return <BooksByYearChart years={d.years} series={d.series} />;
    },
  },
  // ── Teams / PhD students / Researchers / Network
  'equipes-repartition': {
    label: msg`Breakdown by team`,
    Chart: (p) => (
      <TeamDonutChart
        title={i18n._(msg`Breakdown by team`)}
        exportName="equipes-repartition"
        data={useTeams(p).byTeam.map((tm) => ({ name: tm.key, value: tm.count }))}
      />
    ),
  },
  'equipes-evolution': {
    label: msg`Evolution by team`,
    Chart: (p) => (
      <StackedAreaChart title={i18n._(msg`Evolution by team`)} exportName="equipes-evolution" data={useTeams(p).byYear} />
    ),
  },
  'equipes-types': {
    label: msg`Types by team`,
    Chart: (p) => (
      <StackedBarHChart title={i18n._(msg`Types by team`)} exportName="equipes-types" data={useTeams(p).byType} />
    ),
  },
  'radar-disciplinaire': {
    label: msg`Disciplinary profile of teams`,
    Chart: (p) => {
      const level = enumParam<TeamRadarLevel>(p.params, 'level') ?? 'subfield';
      const d = useMemo(
        () => aggregateTeamRadar(p.dataset.publications, p.range, { level }),
        [p.dataset, p.range, level],
      );
      return <TeamRadarChart data={d} />;
    },
  },
  'heatmap-disciplinaire': {
    label: msg`Disciplinary heatmap of teams`,
    Chart: (p) => {
      const level = enumParam<TeamRadarLevel>(p.params, 'level') ?? 'subfield';
      // Same series cap as the heatmap view of the Teams tab (more readable than the radar).
      const d = useMemo(
        () => aggregateTeamRadar(p.dataset.publications, p.range, { level, maxSeries: 12 }),
        [p.dataset, p.range, level],
      );
      return <TeamHeatmapChart data={d} />;
    },
  },
  'doctorants-repartition': {
    label: msg`PhD students by team`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregatePhd(p.dataset.publications, p.dataset.authors, p.range),
        [p.dataset, p.range],
      );
      return (
        <TeamDonutChart
          title={i18n._(msg`PhD students by team`)}
          exportName="doctorants-repartition"
          data={d.byTeam.map((tm) => ({ name: tm.key, value: tm.count }))}
        />
      );
    },
  },
  'doctorants-evolution': {
    label: msg`Evolution of PhD student publications`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregatePhd(p.dataset.publications, p.dataset.authors, p.range),
        [p.dataset, p.range],
      );
      return (
        <StackedAreaChart
          title={i18n._(msg`Evolution of PhD student publications`)}
          exportName="doctorants-evolution"
          data={d.byYear}
        />
      );
    },
  },
  'doctorants-classement': {
    label: msg`Publications per PhD student`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregatePhd(p.dataset.publications, p.dataset.authors, p.range),
        [p.dataset, p.range],
      );
      return (
        <RankBarChart
          title={i18n._(msg`Publications per PhD student`)}
          exportName="doctorants-classement"
          data={d.byDoctorant}
          colorSlot={6}
          height={Math.max(240, d.byDoctorant.length * 26 + 60)}
        />
      );
    },
  },
  'chercheurs-classement': {
    label: msg`Most prolific researchers`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateResearchers(p.dataset.publications, p.dataset.authors, p.range),
        [p.dataset, p.range],
      );
      return (
        <RankBarChart
          title={i18n._(msg`Most prolific researchers`)}
          exportName="chercheurs-classement"
          data={d}
          colorSlot={3}
          height={Math.max(280, d.length * 26 + 60)}
        />
      );
    },
  },
  'reseau-cosignatures': {
    label: msg`Co-authorship network`,
    Chart: (p) => {
      // Same initial threshold as the Network tab, computed on the (possibly restricted) corpus.
      const minPubs = intParam(p.params, 'minPubs') ?? (p.dataset.publications.length > 10000 ? 8 : 2);
      const d = useMemo(
        () => aggregateNetwork(p.dataset.publications, p.dataset.authors, p.range, minPubs),
        [p.dataset, p.range, minPubs],
      );
      return <NetworkChart data={d} />;
    },
  },
  // ── Journals / Keywords / Axes / Charter (phase 4)
  'top-revues': {
    label: msg`Most frequent journals`,
    Chart: (p) => {
      const d = useMemo(() => aggregateJournals(p.dataset.publications, p.range), [p.dataset, p.range]);
      return <TopJournalsChart rows={d.rows} defaultN={intParam(p.params, 'n')} />;
    },
  },
  'acces-revues': {
    label: msg`Journal access at Nantes Université`,
    Chart: (p) => {
      const d = useMemo(() => aggregateJournals(p.dataset.publications, p.range), [p.dataset, p.range]);
      return (
        <TeamDonutChart
          title={i18n._(msg`Journal access at Nantes Université`)}
          exportName="acces-revues"
          data={d.byAccess.map((a) => ({
            name: accessLabel(a.key),
            value: a.count,
            color: JOURNAL_ACCESS_COLORS[a.key] ?? '#9E9E9E',
          }))}
          height={340}
        />
      );
    },
  },
  'top-mots-cles': {
    label: msg`Main keywords`,
    Chart: (p) => {
      const d = useMemo(() => aggregateKeywords(p.dataset.publications, p.range), [p.dataset, p.range]);
      return (
        <RankBarChart
          title={i18n._(msg`Main keywords`)}
          exportName="top-mots-cles"
          data={d.topTopics.map((k) => ({ label: k.key, count: k.count, teams: [] }))}
          colorSlot={0}
          height={Math.max(280, d.topTopics.length * 24 + 60)}
        />
      );
    },
  },
  'top-sous-domaines': {
    label: msg`Main subfields`,
    Chart: (p) => {
      const d = useMemo(() => aggregateKeywords(p.dataset.publications, p.range), [p.dataset, p.range]);
      return (
        <RankBarChart
          title={i18n._(msg`Main subfields`)}
          exportName="top-sous-domaines"
          data={d.topSubfields.map((k) => ({ label: k.key, count: k.count, teams: [] }))}
          colorSlot={3}
          height={Math.max(280, d.topSubfields.length * 24 + 60)}
        />
      );
    },
  },
  domaines: {
    label: msg`OpenAlex domains`,
    Chart: (p) => {
      const d = useMemo(() => aggregateDomains(p.dataset.publications, p.range), [p.dataset, p.range]);
      return (
        <TeamDonutChart
          title={i18n._(msg`OpenAlex domains`)}
          subtitle={i18n._(msg`A publication may belong to several domains`)}
          exportName="domaines"
          data={d.map((x) => ({ name: x.key, value: x.count }))}
        />
      );
    },
  },
  // Strategic axes: ETL classification only (Grist corrections are applied
  // in the authenticated tab, not in public embeds).
  'axes-repartition': {
    label: msg`Breakdown by strategic axis`,
    Chart: (p) => {
      const { d, colorOf } = useAxes(p);
      return (
        <TeamDonutChart
          title={i18n._(msg`Breakdown by strategic axis`)}
          exportName="axes-repartition"
          data={d.byAxe.map((a) => ({ name: a.key, value: a.count, color: colorOf(a.key) }))}
        />
      );
    },
  },
  'axes-barres': {
    label: msg`Publications by axis`,
    Chart: (p) => {
      const { d } = useAxes(p);
      return (
        <RankBarChart
          title={i18n._(msg`Publications by axis`)}
          exportName="axes-barres"
          data={d.byAxe.map((a) => ({ label: a.key, count: a.count, teams: [] }))}
          colorSlot={0}
          height={Math.max(260, d.byAxe.length * 34 + 80)}
        />
      );
    },
  },
  'axes-evolution': {
    label: msg`Yearly evolution by strategic axis`,
    Chart: (p) => {
      const { d, seriesColors } = useAxes(p);
      return (
        <StackedAreaChart
          title={i18n._(msg`Yearly evolution by strategic axis`)}
          exportName="axes-evolution"
          data={d.byYear}
          colors={seriesColors}
        />
      );
    },
  },
  'axes-types': {
    label: msg`Publication types by strategic axis`,
    Chart: (p) => {
      const { d, seriesColors } = useAxes(p);
      return (
        <StackedBarHChart
          title={i18n._(msg`Publication types by strategic axis`)}
          exportName="axes-types"
          data={d.byType}
          colors={seriesColors}
        />
      );
    },
  },
  'charte-conformite': {
    label: msg`Corpus compliance (signature charter)`,
    Chart: (p) => {
      const seuil = charteSeuilOf(p);
      const d = useMemo(
        () => aggregateCharte(p.dataset.publications, p.range, seuil),
        [p.dataset, p.range, seuil],
      );
      return (
        <CharteConformiteDonut conformes={d.conformes} analysable={d.analysable} />
      );
    },
  },
  'charte-scores': {
    label: msg`Distribution of compliance scores`,
    Chart: (p) => {
      const seuil = charteSeuilOf(p);
      const d = useMemo(
        () => aggregateCharte(p.dataset.publications, p.range, seuil),
        [p.dataset, p.range, seuil],
      );
      return <CharteScoresChart data={d.scoreHistogram} thresholdPct={intParam(p.params, 'thresholdPct') ?? 75} />;
    },
  },
  'charte-evolution': {
    label: msg`Compliance rate per year`,
    Chart: (p) => {
      const seuil = charteSeuilOf(p);
      const d = useMemo(
        () => aggregateCharte(p.dataset.publications, p.range, seuil),
        [p.dataset, p.range, seuil],
      );
      return <CharteRateChart data={d.rateByYear} />;
    },
  },
  'charte-criteres': {
    label: msg`Presence rate by criterion`,
    Chart: (p) => {
      const seuil = charteSeuilOf(p);
      const d = useMemo(
        () => aggregateCharte(p.dataset.publications, p.range, seuil),
        [p.dataset, p.range, seuil],
      );
      return <CharteCriteresChart data={d.byCritere} />;
    },
  },
  'charte-equipes': {
    label: msg`Compliance rate by team`,
    Chart: (p) => {
      const seuil = charteSeuilOf(p);
      const d = useMemo(
        () => aggregateCharte(p.dataset.publications, p.range, seuil),
        [p.dataset, p.range, seuil],
      );
      return <CharteTeamsChart data={d.byTeam} />;
    },
  },
  'acces-revues-barres': {
    label: msg`Publications by access category`,
    Chart: (p) => {
      const d = useMemo(() => aggregateJournals(p.dataset.publications, p.range), [p.dataset, p.range]);
      return <AccessBarChart data={d.byAccess} />;
    },
  },
  'acces-revues-evolution': {
    label: msg`Share of publications accessible at NU per year`,
    Chart: (p) => {
      const d = useMemo(() => aggregateJournals(p.dataset.publications, p.range), [p.dataset, p.range]);
      return <AccessibleEvolutionChart data={d.accessibleByYear} />;
    },
  },
  'apc-evolution': {
    label: msg`Total APC cost per year`,
    Chart: (p) => {
      const d = useMemo(() => aggregateApc(p.dataset.publications, p.range), [p.dataset, p.range]);
      return <ApcYearlyChart data={d.byYear} />;
    },
  },
  'apc-elsevier-par-labo': {
    label: msg`Elsevier APCs by lab`,
    Chart: (p) => {
      const d = useMemo(() => aggregateDealByLabo(p.dataset.publications, p.range), [p.dataset, p.range]);
      return <ApcByLaboChart data={d} />;
    },
  },
  'apc-par-revue': {
    label: msg`Mean APC cost per journal`,
    Chart: (p) => {
      const d = useMemo(() => aggregateApc(p.dataset.publications, p.range), [p.dataset, p.range]);
      return <ApcByJournalChart data={d.byJournal} />;
    },
  },
  // ── Funding (funders / projects) ─────────────────────────────────────────
  'funders-top': {
    label: msg`Main funders`,
    Chart: (p) => <FundersTopChart data={useFunders(p).topFunders} />,
  },
  'funders-categories': {
    label: msg`Breakdown by funder category`,
    Chart: (p) => <FundersCategoryChart data={useFunders(p).byCategory} />,
  },
  'funders-evolution': {
    label: msg`Funded publications per year`,
    Chart: (p) => <FundersYearChart data={useFunders(p).byYear} />,
  },
  'funders-par-labo': {
    label: msg`Breakdown of funders by lab`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateCategoryByLabo(p.dataset.publications, p.range),
        [p.dataset, p.range],
      );
      return <FundersByLaboChart data={d} />;
    },
  },
  'collab-structure-evolution': {
    label: msg`Internal co-publications per year`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateInternalCollab(p.dataset.publications, p.range, internalLabsOf),
        [p.dataset, p.range],
      );
      return (
        <YearlyEvolutionChart data={d.byYear} title={i18n._(msg`Internal co-publications per year`)} exportName="collab-structure-evolution" colorSlot={2} />
      );
    },
  },
  'collab-nu-evolution': {
    label: msg`Co-publications with NU labs per year`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateInternalCollab(p.dataset.publications, p.range, (x) => x.nantesPartners),
        [p.dataset, p.range],
      );
      return (
        <YearlyEvolutionChart data={d.byYear} title={i18n._(msg`Co-publications with NU labs per year`)} exportName="collab-nu-evolution" colorSlot={2} />
      );
    },
  },
  'collab-national-evolution': {
    label: msg`National co-publications per year`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateNationalCollab(p.dataset.publications, p.range),
        [p.dataset, p.range],
      );
      return (
        <YearlyEvolutionChart data={d.byYear} title={i18n._(msg`National co-publications per year`)} exportName="collab-national-evolution" colorSlot={3} />
      );
    },
  },
  // ── Collaborations (phase 5)
  'collab-typologie': {
    label: msg`Collaboration types`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateCollabTypology(p.dataset.publications, p.range),
        [p.dataset, p.range],
      );
      return <TypologyDonutChart data={d.byCategory} subtitle={i18n._(msg`Broadest category per publication`)} />;
    },
  },
  'collab-typologie-evolution': {
    label: msg`Evolution of collaboration types`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateCollabTypology(p.dataset.publications, p.range),
        [p.dataset, p.range],
      );
      return <TypologyEvolutionChart data={d.byYear} />;
    },
  },
  'collab-structure-domaines': {
    label: msg`Domains of internal co-publications`,
    Chart: (p) => <InternalCollabDomainsChart agg={useInternalCollab(p, 'structure')} idPrefix="collab-structure" />,
  },
  'collab-structure-sous-disciplines': {
    label: msg`Subfields of internal co-publications`,
    Chart: (p) => <InternalCollabSubfieldsChart agg={useInternalCollab(p, 'structure')} idPrefix="collab-structure" />,
  },
  'collab-structure-sankey': {
    label: msg`Internal collaboration topics by lab`,
    Chart: (p) => <InternalCollabSankeyChart agg={useInternalCollab(p, 'structure')} idPrefix="collab-structure" />,
  },
  'collab-nu-domaines': {
    label: msg`Domains of co-publications with NU labs`,
    Chart: (p) => <InternalCollabDomainsChart agg={useInternalCollab(p, 'nu')} idPrefix="collab-nu" />,
  },
  'collab-nu-sous-disciplines': {
    label: msg`Subfields of co-publications with NU labs`,
    Chart: (p) => <InternalCollabSubfieldsChart agg={useInternalCollab(p, 'nu')} idPrefix="collab-nu" />,
  },
  'collab-nu-sankey': {
    label: msg`Collaboration topics with NU labs`,
    Chart: (p) => <InternalCollabSankeyChart agg={useInternalCollab(p, 'nu')} idPrefix="collab-nu" />,
  },
  'collab-structure-top': {
    label: msg`Most co-signing labs of the structure`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateInternalCollab(p.dataset.publications, p.range, internalLabsOf),
        [p.dataset, p.range],
      );
      return (
        <RankBarChart
          title={i18n._(msg`Most co-signing labs (within the structure)`)}
          exportName="collab-structure-top"
          data={d.topLabs.map((l) => ({ label: l.key, count: l.count, teams: [] }))}
          colorSlot={2}
          height={Math.max(280, d.topLabs.length * 26 + 60)}
        />
      );
    },
  },
  'collab-nu-top': {
    label: msg`Most co-signing Nantes Université labs`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateInternalCollab(p.dataset.publications, p.range, (x) => x.nantesPartners),
        [p.dataset, p.range],
      );
      return (
        <RankBarChart
          title={i18n._(msg`Most co-signing Nantes Université labs`)}
          exportName="collab-nu-top"
          data={d.topLabs.map((l) => ({ label: l.key, count: l.count, teams: [] }))}
          colorSlot={2}
          height={Math.max(280, d.topLabs.length * 26 + 60)}
        />
      );
    },
  },
  'carte-france': {
    label: msg`Map of French partner institutions`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateNationalCollab(p.dataset.publications, p.range),
        [p.dataset, p.range],
      );
      return <FranceMapChart points={d.mapPoints} />;
    },
  },
  'evolution-pays': {
    label: msg`Evolution of the main partner countries`,
    Chart: (p) => (
      <CountryEvolutionChart
        publications={p.dataset.publications}
        range={p.range}
        countryNames={p.dataset.countryNames}
        defaultN={intParam(p.params, 'n')}
      />
    ),
  },
  'reseau-equipes-organismes': {
    label: msg`Network teams ↔ foreign organisations`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateTeamOrgNetwork(p.dataset.publications, p.range),
        [p.dataset, p.range],
      );
      return <TeamOrgNetworkChart data={d} />;
    },
  },
  'collab-national-top': {
    label: msg`Most co-signing French institutions`,
    Chart: (p) => {
      const d = useMemo(
        () => aggregateNationalCollab(p.dataset.publications, p.range),
        [p.dataset, p.range],
      );
      return (
        <RankBarChart
          title={i18n._(msg`Most co-signing institutions`)}
          exportName="collab-national-top"
          data={d.topInstitutions.map((i) => ({ label: i.key, count: i.count, teams: [] }))}
          colorSlot={3}
          height={Math.max(280, d.topInstitutions.length * 26 + 60)}
        />
      );
    },
  },
  // ── Partner group / labs involved (« Collaboration avec une université » template) ──
  'partner-breakdown-top': {
    label: msg`Co-publications by university`,
    Chart: (p) => {
      const d = usePartnerBreakdown(p);
      return (
        <RankBarChart
          title={i18n._(msg`Co-publications by university`)}
          subtitle={i18n._(msg`A publication co-signed by several of them counts for each`)}
          exportName="partner-breakdown-top"
          data={d.entries.map((e) => ({ label: e.name, count: e.total, teams: [] }))}
          colorSlot={4}
          height={Math.max(240, d.entries.length * 28 + 60)}
        />
      );
    },
  },
  'partner-breakdown-evolution': {
    label: msg`Yearly trend by university`,
    Chart: (p) => (
      <StackedAreaChart
        title={i18n._(msg`Yearly trend by university`)}
        exportName="partner-breakdown-evolution"
        data={usePartnerBreakdown(p).byYearStacked}
      />
    ),
  },
  'labos-classement': {
    label: msg`Labs involved`,
    Chart: (p) => {
      const d = useLabRanking(p);
      return (
        <RankBarChart
          title={i18n._(msg`Labs involved`)}
          subtitle={i18n._(msg`Publications per member lab (a co-signed publication counts for each lab)`)}
          exportName="labos-classement"
          data={d}
          colorSlot={2}
          height={Math.max(260, d.length * 26 + 60)}
        />
      );
    },
  },
  // ── Sources / coverage (CRISalid harvester vs BSO/OpenAlex/HAL) ───────────
  'sources-repartition': {
    label: msg`Main source of records`,
    Chart: (p) => (
      <TeamDonutChart
        title={i18n._(msg`Main source of records`)}
        exportName="sources-repartition"
        data={useSources(p).bySourceDb}
      />
    ),
  },
  'sources-recouvrements': {
    label: msg`Overlaps between sources`,
    Chart: (p) => (
      <RankBarChart
        title={i18n._(msg`Overlaps between sources`)}
        exportName="sources-recouvrements"
        data={useSources(p).combos}
        colorSlot={1}
        height={320}
      />
    ),
  },
  'sources-evolution': {
    label: msg`Source coverage by year`,
    Chart: (p) => (
      <StackedAreaChart
        title={i18n._(msg`Coverage by year`)}
        exportName="sources-evolution"
        data={useSources(p).evolution}
      />
    ),
  },
  'sources-harvester-detail': {
    label: msg`Sub-sources of the CRISalid harvester`,
    Chart: (p) => (
      <TeamDonutChart
        title={i18n._(msg`Sub-sources of the CRISalid harvester`)}
        exportName="sources-harvester-detail"
        data={useSources(p).harvesterDetail}
      />
    ),
  },
  'sources-openalex-lookup': {
    label: msg`OpenAlex diagnosis of harvester records`,
    Chart: (p) => (
      <RankBarChart
        title={i18n._(msg`OpenAlex diagnosis of harvester records`)}
        exportName="sources-openalex-lookup"
        data={useSources(p).lookup}
        colorSlot={4}
        height={280}
      />
    ),
  },
};
