// Charts a report block can show: the embeddable charts (EMBED_CHARTS, drawn from the dataset) and
// the report-only charts (REPORT_ONLY_IDS of embedIds.ts), drawn from the payload of their remote
// source (ChartMeta.remote, remoteSources.ts) — their data come from an authenticated route, so
// they never get a public /embed link. The preview and the PDF capture both render through
// ReportChart, so they cannot disagree.

import React from 'react';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ChartParams } from '../chartMeta';
import { PairMatrixChart } from '../charts/PairMatrixChart';
import { EMBED_CHARTS } from '../embedRegistry';
import type { YearRange } from '../overviewAggregates';
import type { PairsResponse } from '../pairsApi';
import type { PubFilters } from '../publicationFilters';
import type { DashboardDataset } from '../types';

export interface RemoteChartProps {
  /** Payload of the chart's remote source (status 'ok': loaded). */
  remote: unknown;
  range: YearRange;
  params?: ChartParams;
}

type RemoteEntry = { label: MessageDescriptor; Chart: React.FC<RemoteChartProps> };

/** ⚠️ Keys = REPORT_ONLY_IDS (embedIds.ts). */
export const REPORT_ONLY_CHARTS: Record<string, RemoteEntry> = {
  'collab-pairs-poles': {
    label: msg`Researcher pairs by couple of poles`,
    Chart: ({ remote }) => (
      <PairMatrixChart
        cells={(remote as PairsResponse).poleMatrix}
        title={i18n._(msg`Pairs by couple of poles`)}
        subtitle={i18n._(msg`Diagonal: pairs of different labs within a pole`)}
        exportName="collab-pairs-poles"
      />
    ),
  },
  'collab-pairs-labs': {
    label: msg`Researcher pairs by couple of labs`,
    Chart: ({ remote }) => (
      <PairMatrixChart
        cells={(remote as PairsResponse).labMatrix}
        title={i18n._(msg`Pairs by couple of labs`)}
        subtitle={i18n._(msg`Number of pairs, not of publications`)}
        exportName="collab-pairs-labs"
      />
    ),
  },
};

/** The chart id has a component (embeddable or report-only). */
export const hasReportChart = (chartId: string): boolean => !!(EMBED_CHARTS[chartId] ?? REPORT_ONLY_CHARTS[chartId]);

/** Label of a report chart (untranslated descriptor), undefined when unknown. */
export const reportChartLabel = (chartId: string): MessageDescriptor | undefined =>
  (EMBED_CHARTS[chartId] ?? REPORT_ONLY_CHARTS[chartId])?.label;

/** One chart of a report block, from its dataset or from its remote payload. */
export const ReportChart: React.FC<{
  chartId: string;
  dataset: DashboardDataset | null;
  range: YearRange;
  params?: ChartParams;
  filters?: PubFilters;
  source?: DashboardDataset | null;
  remote?: unknown;
}> = ({ chartId, dataset, range, params, filters, source, remote }) => {
  const remoteEntry = REPORT_ONLY_CHARTS[chartId];
  if (remoteEntry) return remote ? <remoteEntry.Chart remote={remote} range={range} params={params} /> : null;
  const entry = EMBED_CHARTS[chartId];
  if (!entry || !dataset) return null;
  return <entry.Chart dataset={dataset} range={range} params={params} filters={filters} source={source} />;
};
