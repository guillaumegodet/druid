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
import { axeOfPub } from './publicationFilters';
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
  internalLabsOf,
} from './collabAggregates';
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
  RankBarChart,
} from './charts/TeamCharts';
import { NetworkChart } from './charts/NetworkChart';

export interface EmbedChartProps {
  dataset: DashboardDataset;
  range: YearRange;
  /**
   * Chart parameters declared in CHART_META (chartMeta.ts), already sanitized;
   * a missing key means the chart's usual default.
   */
  params?: Record<string, number>;
}

/** Charter threshold as a fraction (tab default: 75 %). */
const charteSeuilOf = (p: EmbedChartProps) => (p.params?.thresholdPct ?? 75) / 100;

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
      const d = useMemo(() => aggregateTeamRadar(p.dataset.publications, p.range), [p.dataset, p.range]);
      return <TeamRadarChart data={d} />;
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
      const minPubs = p.params?.minPubs ?? (p.dataset.publications.length > 10000 ? 8 : 2);
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
      return <TopJournalsChart rows={d.rows} defaultN={p.params?.n} />;
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
  // Strategic axes: ETL classification only (Grist corrections are applied
  // in the authenticated tab, not in public embeds).
  'axes-repartition': {
    label: msg`Breakdown by strategic axis`,
    Chart: (p) => {
      const axes = p.dataset.strategicAxes.map((a) => a.name);
      const d = useMemo(
        () => aggregateAxes(p.dataset.publications, p.range, axes, axeOfPub),
        [p.dataset, p.range],
      );
      return (
        <TeamDonutChart
          title={i18n._(msg`Breakdown by strategic axis`)}
          exportName="axes-repartition"
          data={d.byAxe.map((t) => ({ name: t.key, value: t.count }))}
        />
      );
    },
  },
  'axes-evolution': {
    label: msg`Yearly evolution by strategic axis`,
    Chart: (p) => {
      const axes = p.dataset.strategicAxes.map((a) => a.name);
      const d = useMemo(
        () => aggregateAxes(p.dataset.publications, p.range, axes, axeOfPub),
        [p.dataset, p.range],
      );
      return (
        <StackedAreaChart title={i18n._(msg`Yearly evolution by strategic axis`)} exportName="axes-evolution" data={d.byYear} />
      );
    },
  },
  'axes-types': {
    label: msg`Publication types by strategic axis`,
    Chart: (p) => {
      const axes = p.dataset.strategicAxes.map((a) => a.name);
      const d = useMemo(
        () => aggregateAxes(p.dataset.publications, p.range, axes, axeOfPub),
        [p.dataset, p.range],
      );
      return (
        <StackedBarHChart title={i18n._(msg`Publication types by strategic axis`)} exportName="axes-types" data={d.byType} />
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
      return <CharteScoresChart data={d.scoreHistogram} thresholdPct={p.params?.thresholdPct ?? 75} />;
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
      return (
        <TeamDonutChart
          title={i18n._(msg`Collaboration types`)}
          subtitle={i18n._(msg`Broadest category per publication`)}
          exportName="collab-typologie"
          data={d.byCategory.map((c) => ({ name: c.key, value: c.count }))}
        />
      );
    },
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
        defaultN={p.params?.n}
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
