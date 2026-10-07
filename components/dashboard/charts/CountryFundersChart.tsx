import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import { useLingui } from '@lingui/react/macro';
import type { CountryFunder, FunderOrigin } from '../countryAggregates';

const ORIGINS: FunderOrigin[] = ['country', 'europe', 'france', 'other', 'unknown'];
const ORIGIN_SLOT: Record<FunderOrigin, number> = { country: 4, europe: 3, france: 0, other: 5, unknown: -1 };

/**
 * Main funders acknowledged by the co-publications with a country, colored by origin (« Pays »
 * sub-tab, block J). One stacked series per origin so that the legend names them.
 */
export const CountryFundersChart: React.FC<{
  data: CountryFunder[];
  country: string;
  onSelect?: (funder: string) => void;
}> = ({ data, country, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const rows = useMemo(() => [...data].sort((a, b) => a.count - b.count), [data]);

  const option = useMemo(() => {
    const label: Record<FunderOrigin, string> = {
      country: country,
      europe: tr`Europe`,
      france: tr`France`,
      other: tr`Other countries`,
      unknown: tr`Unknown country`,
    };
    const present = ORIGINS.filter((o) => rows.some((r) => r.origin === o));
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'item', ...baseTooltip(t) },
      legend: {
        bottom: 0,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: 8, right: 36, top: 8, bottom: 36, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: rows.map((r) => r.name),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 220, overflow: 'truncate' as const },
      },
      series: present.map((o) => ({
        name: label[o],
        type: 'bar',
        stack: 'funders',
        data: rows.map((r) => (r.origin === o ? r.count : null)),
        itemStyle: { color: ORIGIN_SLOT[o] >= 0 ? t.series[ORIGIN_SLOT[o]] : t.inkMuted, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
      })),
    };
  }, [rows, country, t, tr]);

  return (
    <EChartCard
      title={tr`Main funders of the co-publications with ${country}`}
      subtitle={tr`Funders acknowledged by the publications — not the funding of the partners`}
      option={option}
      exportName="pays-financeurs"
      height={Math.max(300, rows.length * 26 + 80)}
      emptyMessage={rows.length ? undefined : tr`No funder acknowledged by these co-publications.`}
      onSeriesClick={onSelect ? (p) => rows[p.dataIndex] && onSelect(rows[p.dataIndex].name) : undefined}
    />
  );
};
