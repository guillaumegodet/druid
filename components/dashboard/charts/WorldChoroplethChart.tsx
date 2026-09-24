import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  useVizTheme,
  useWorldMap,
} from '../EChartCard';
import { useLingui } from '@lingui/react/macro';
import { CountryItem } from '../internationalAggregates';

/** Choropleth map of partner countries (single-hue sequential ramp). */
export const WorldChoroplethChart: React.FC<{ data: CountryItem[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const ready = useWorldMap();

  const option = useMemo(() => {
    const points = data.filter((d) => d.echarts);
    const max = points.reduce((m, d) => Math.max(m, d.count), 0);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number }) =>
          `${p.name} : ${Number.isNaN(p.value) ? 0 : p.value}`,
        ...baseTooltip(t),
      },
      visualMap: {
        min: 0,
        max: max || 1,
        left: 8,
        bottom: 8,
        calculable: true,
        inRange: { color: t.seqRamp },
        text: ['Plus', 'Moins'],
        textStyle: { color: t.inkSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'map',
          map: 'world',
          roam: true,
          emphasis: { label: { show: false } },
          itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder },
          data: points.map((d) => ({ name: d.echarts, value: d.count })),
        },
      ],
    };
  }, [data, t, tr]);

  if (!ready) {
    return (
      <div className="glass-card h-[480px] flex items-center justify-center text-sm text-muted-light dark:text-[#8f897c]">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Chargement de la carte…
      </div>
    );
  }

  return (
    <EChartCard
      title={tr`Map of partner countries`}
      subtitle={tr`Number of co-signed publications by country (France excluded)`}
      option={option}
      exportName="carte-monde"
      height={440}
    />
  );
};
