import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';
import { useLingui } from '@lingui/react/macro';
import { SunburstNode } from '../internationalAggregates';

/** Partnership breakdown — team / country / organization sunburst. */
export const SunburstChart: React.FC<{ data: SunburstNode[]; height?: number }> = ({
  data,
  height = 520,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'item', formatter: '{b} : {c}', ...baseTooltip(t) },
      color: t.series,
      series: [
        {
          type: 'sunburst',
          data,
          radius: [0, '95%'],
          sort: undefined,
          emphasis: { focus: 'ancestor' },
          itemStyle: { borderColor: t.surface, borderWidth: 2 },
          levels: [
            {},
            { r0: '0%', r: '38%', label: { rotate: 'tangential', fontSize: 11 } },
            { r0: '38%', r: '68%', label: { fontSize: 10 } },
            {
              r0: '68%',
              r: '72%',
              label: { position: 'outside', fontSize: 9, silent: false, color: t.inkSecondary },
              itemStyle: { borderWidth: 2 },
            },
          ],
        },
      ],
    }),
    [data, t, tr],
  );

  return (
    <EChartCard
      title={tr`Breakdown of partnerships`}
      subtitle={tr`Team / country / organisation (main foreign organisations)`}
      option={option}
      exportName="sunburst-partenariats"
      height={height}
    />
  );
};
