import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { CountItem, foldSmallCategories } from '../overviewAggregates';
import { languageLabel } from '../labels';
import { useLingui } from '@lingui/react/macro';

/**
 * Publication languages — part-to-whole donut, ≤ 6 segments (« Autres » fallback),
 * categorical slots in the validated order, 2px surface-colored separation.
 */
export const LanguageDonutChart: React.FC<{
  data: CountItem[];
  /** Click on a slice (language code) — opens the filtered list. */
  onSelect?: (key: string) => void;
}> = ({ data, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const folded = useMemo(() => foldSmallCategories(data, 6), [data]);
  const option = useMemo(() => {
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
      color: t.series,
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: t.surface, borderWidth: 2 },
          label: { formatter: '{b}\n{d} %', color: t.inkSecondary, fontSize: 11 },
          data: folded.map((d) => ({
            name: d.key === '__other__' ? tr({ message: `Other`, context: "plural" }) : languageLabel(d.key),
            value: d.count,
          })),
        },
      ],
    };
  }, [folded, t, tr]);

  return (
    <EChartCard
      title={tr`Publication languages`}
      option={option}
      exportName="langues"
      onSeriesClick={
        onSelect ? (p) => folded[p.dataIndex] && onSelect(folded[p.dataIndex].key) : undefined
      }
    />
  );
};
