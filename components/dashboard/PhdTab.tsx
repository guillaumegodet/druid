import React, { useMemo } from 'react';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { aggregatePhd, hasTeams, TEAM_OTHER } from './structureAggregates';
import { PubFilters } from './publicationFilters';
import { TeamDonutChart, StackedAreaChart, RankBarChart } from './charts/TeamCharts';
import { Trans, useLingui } from '@lingui/react/macro';

/** « Doctorants » tab (ported from the SoVisu+ mockups). */
export const PhdTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const { t } = useLingui();
  const { publications, authors } = dataset;
  const agg = useMemo(
    () => aggregatePhd(publications, authors, range),
    [publications, authors, range],
  );
  const openTeam = (team: string, extra?: PubFilters) =>
    onOpenList && team !== TEAM_OTHER ? onOpenList({ team, hasPhd: true, ...extra }) : undefined;

  if (!hasTeams(publications) || agg.totalPhdPubs === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>
          No PhD student publication identified: this tab requires a staff file (with the “doctorant” type) matched to authors in druid-biblio.
        </Trans>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <TeamDonutChart
            title={t`PhD students by team`}
            subtitle={t`Publications involving at least one PhD student`}
            exportName="doctorants-repartition"
            data={agg.byTeam.map((tm) => ({ name: tm.key, value: tm.count }))}
            onSelect={onOpenList ? (name) => openTeam(name) : undefined}
          />
        </div>
        <div className="lg:col-span-3">
          <StackedAreaChart
            title={t`Evolution of PhD student publications`}
            exportName="doctorants-evolution"
            data={agg.byYear}
            onSelect={onOpenList ? (team, year) => openTeam(team, { year }) : undefined}
          />
        </div>
      </div>
      <RankBarChart
        title={t`Publications per PhD student`}
        exportName="doctorants-classement"
        data={agg.byDoctorant}
        colorSlot={6}
        height={Math.max(240, agg.byDoctorant.length * 26 + 60)}
        onItemSelect={
          onOpenList
            ? (item) => item.id != null && onOpenList({ authorId: item.id, hasPhd: true })
            : undefined
        }
      />
    </div>
  );
};
