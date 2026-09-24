import React, { useMemo } from 'react';
import { Layers, Database, Sparkles, SearchX } from 'lucide-react';
import { DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { aggregateSources } from './sourcesAggregates';
import { PubFilters } from './publicationFilters';
import { KpiCard } from './KpiCards';
import { useVizTheme } from './EChartCard';
import { TeamDonutChart, StackedAreaChart, RankBarChart } from './charts/TeamCharts';
import { numberLocale } from '../../lib/i18n';
import { Trans, useLingui } from '@lingui/react/macro';

/** « Sources » tab — provenance of the corpus: coverage of the CRISalid
 *  harvester (IKG graph, harvesting per researcher) compared with the ETL's
 *  classic sources (BSO, OpenAlex by affiliation, HAL by collection). */
export const SourcesTab: React.FC<{
  publications: DashboardPublication[];
  range: YearRange;
  /** Opens the pre-filtered publication list (click on an overlap bar). */
  onOpenList?: (filters: PubFilters) => void;
}> = ({ publications, range, onOpenList }) => {
  const agg = useMemo(() => aggregateSources(publications, range), [publications, range]);
  const t = useVizTheme();
  const { t: tr } = useLingui();

  if (agg.total === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>
          Provenance data is not yet available for this structure: rerun the harvest (CRISalid source enabled) then the dashboard export from the administration page.
        </Trans>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={tr`Publications (period)`}
          value={agg.total.toLocaleString(numberLocale())}
          hint={agg.missing > 0 ? tr`${agg.missing} without known provenance` : undefined}
          icon={<Layers className="w-5 h-5" />}
          color={t.series[0]}
        />
        <KpiCard
          label={tr`Seen by the CRISalid harvester`}
          value={agg.inCrisalid.toLocaleString(numberLocale())}
          hint={agg.inCrisalidPct != null ? tr`${agg.inCrisalidPct}% of the corpus` : undefined}
          icon={<Database className="w-5 h-5" />}
          color={t.series[1]}
        />
        <KpiCard
          label={tr`Exclusive to the harvester`}
          value={agg.crisalidOnly.toLocaleString(numberLocale())}
          hint={tr`absent from BSO/OpenAlex/HAL`}
          icon={<Sparkles className="w-5 h-5" />}
          color={t.series[2]}
        />
        <KpiCard
          label={tr`Not seen by the harvester`}
          value={agg.classicOnly.toLocaleString(numberLocale())}
          hint={tr`still to be harvested on the CRISalid side`}
          icon={<SearchX className="w-5 h-5" />}
          color={t.series[3]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TeamDonutChart
          title={tr`Main source of records`}
          subtitle={tr`“winning” source of the merge (priority CRISalid > BSO > OpenAlex > HAL)`}
          exportName="sources-repartition"
          data={agg.bySourceDb}
        />
        <RankBarChart
          title={tr`Overlaps between sources`}
          subtitle={
            onOpenList
              ? tr`source combinations in which each publication was seen — clicking a bar opens the filtered list`
              : tr`source combinations in which each publication was seen`
          }
          exportName="sources-recouvrements"
          data={agg.combos}
          colorSlot={1}
          height={320}
          onItemClick={onOpenList ? (label) => onOpenList({ sourceCombo: label }) : undefined}
        />
        <StackedAreaChart
          title={tr`Coverage by year`}
          exportName="sources-evolution"
          data={agg.evolution}
        />
        <TeamDonutChart
          title={tr`Sub-sources of the CRISalid harvester`}
          subtitle={tr`a publication may count in several harvested sources`}
          exportName="sources-harvester-detail"
          data={agg.harvesterDetail}
        />
        <RankBarChart
          title={tr`OpenAlex diagnosis of harvester records`}
          subtitle={tr`records whose main source is the harvester — “structure not credited” = affiliation corrections to request`}
          exportName="sources-openalex-lookup"
          data={agg.lookup}
          colorSlot={4}
          height={280}
        />
      </div>
    </div>
  );
};
