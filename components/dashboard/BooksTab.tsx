import React, { useMemo } from 'react';
import { DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { aggregateBooks } from './booksAggregates';
import { PubFilters } from './publicationFilters';
import { PublicationTypesChart } from './charts/PublicationTypesChart';
import { BooksByYearChart } from './charts/BooksByYearChart';
import { Trans, useLingui } from '@lingui/react/macro';

/** « Ouvrages » tab — chapters & monographs (ported from the SoVisu+ mockups). */
export const BooksTab: React.FC<{
  publications: DashboardPublication[];
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ publications, range, onOpenList }) => {
  const { t } = useLingui();
  const agg = useMemo(() => aggregateBooks(publications, range), [publications, range]);

  if (agg.total === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>No chapter, monograph or edited book over the period.</Trans>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <PublicationTypesChart
        data={agg.byType}
        title={t`Book types`}
        exportName="ouvrages-types"
        onSelect={onOpenList ? (key) => key !== 'unknown' && onOpenList({ pubType: key }) : undefined}
      />
      <BooksByYearChart years={agg.years} series={agg.series} />
    </div>
  );
};
