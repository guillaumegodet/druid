import React, { useMemo, useState } from 'react';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { aggregateNetwork } from './networkAggregates';
import { NetworkChart } from './charts/NetworkChart';
import { Trans } from '@lingui/react/macro';

/** « Réseau » tab — internal co-authorships, with an adjustable publication threshold. */
export const NetworkTab: React.FC<{ dataset: DashboardDataset; range: YearRange }> = ({
  dataset,
  range,
}) => {
  const { publications, authors } = dataset;
  // Large corpora: higher initial threshold to keep the graph readable.
  const defaultMin = publications.length > 10000 ? 8 : 2;
  const [minPubs, setMinPubs] = useState(defaultMin);

  const network = useMemo(
    () => aggregateNetwork(publications, authors, range, minPubs),
    [publications, authors, range, minPubs],
  );

  const slider = (
    <label className="flex items-center gap-2 text-xs text-muted dark:text-[#c3beb0] mr-2">
      <span className="whitespace-nowrap"><Trans>Min. publications: {minPubs}</Trans></span>
      <input
        type="range"
        min={1}
        max={Math.max(10, defaultMin)}
        step={1}
        value={minPubs}
        onChange={(e) => setMinPubs(Number(e.target.value))}
        className="accent-[#7048e8] w-28"
      />
    </label>
  );

  if (network.nodes.length === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>No author above the threshold over the period.</Trans>
      </div>
    );
  }

  return <NetworkChart data={network} headerExtra={slider} />;
};
