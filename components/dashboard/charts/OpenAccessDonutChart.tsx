import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { CountItem } from '../overviewAggregates';
import { oaColors } from '../palette';
import { oaLabel } from '../labels';
import { useLingui } from '@lingui/react/macro';

/**
 * Open access — donut using the field's conventional colors (diamond, gold,
 * green, hybrid, bronze, closed), mapped onto the validated palette slots.
 */
export const OpenAccessDonutChart: React.FC<{
  data: CountItem[];
  /** Click on a slice (OA status code) — opens the filtered list. */
  onSelect?: (key: string) => void;
}> = ({ data, onSelect }) => {
  const t = useVizTheme();
  const { t: tr, i18n } = useLingui();

  const present = useMemo(() => data.filter((d) => d.count > 0), [data]);
  const option = useMemo(() => {
    const colors = oaColors(t);
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'item', formatter: '{b} : {c} ({d} %)', ...baseTooltip(t) },
      legend: {
        type: 'scroll',
        bottom: 0,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: t.surface, borderWidth: 2 },
          label: { formatter: '{b}\n{d} %', color: t.inkSecondary, fontSize: 11 },
          data: present.map((d) => ({
            name: oaLabel(d.key),
            value: d.count,
            itemStyle: { color: colors[d.key] ?? colors.unknown },
          })),
        },
      ],
    };
  // i18n.locale: OA labels come from labels.ts (outside the macro) → recompute on language change.
  }, [present, t, i18n.locale]);

  return (
    <EChartCard
      title={tr`Open access`}
      option={option}
      exportName="acces-ouvert"
      onSeriesClick={
        onSelect ? (p) => present[p.dataIndex] && onSelect(present[p.dataIndex].key) : undefined
      }
    />
  );
};
