import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { useLingui } from '@lingui/react/macro';

/** European Union / non-EU — two-segment donut. */
export const EuZoneChart: React.FC<{ data: { ue: number; outsideEu: number } }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'item', formatter: '{b} : {c} ({d} %)', ...baseTooltip(t) },
      legend: { bottom: 0, textStyle: { color: t.inkSecondary, fontSize: 11 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          itemStyle: { borderColor: t.surface, borderWidth: 2 },
          label: { formatter: '{b}\n{d} %', color: t.inkSecondary, fontSize: 11 },
          data: [
            { name: tr`European Union`, value: data.ue, itemStyle: { color: t.series[3] } },
            { name: tr`Outside EU`, value: data.outsideEu, itemStyle: { color: t.series[4] } },
          ],
        },
      ],
    }),
    [data, t, tr],
  );

  return (
    <EChartCard
      title={tr`European Union / outside EU`}
      subtitle={tr`Publications with at least one partner country in the zone`}
      option={option}
      exportName="zone-ue"
      height={300}
    />
  );
};
