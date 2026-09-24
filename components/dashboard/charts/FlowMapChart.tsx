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
import { FlowMapAggregates } from '../internationalAggregates';

/** Partnership flow map — arcs from the lab to the partner cities. */
export const FlowMapChart: React.FC<{ data: FlowMapAggregates }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const ready = useWorldMap();

  const option = useMemo(() => {
    const max = data.maxValue || 1;
    const width = (v: number) => 1 + Math.round((v / max) * 5);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'item',
        formatter: (p: {
          seriesType: string;
          name: string;
          value: number[];
          data: { value?: number };
        }) => {
          if (p.seriesType === 'lines') return `${p.data?.value ?? ''}`;
          return `${p.name} : ${p.value?.[2] ?? 0}`;
        },
        ...baseTooltip(t),
      },
      geo: {
        map: 'world',
        roam: true,
        itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder },
        emphasis: { label: { show: false }, itemStyle: { areaColor: t.grid } },
      },
      series: [
        {
          name: tr`flows`,
          type: 'lines',
          coordinateSystem: 'geo',
          zlevel: 1,
          effect: { show: true, period: 5, trailLength: 0.4, symbol: 'arrow', symbolSize: 5 },
          lineStyle: { color: t.series[4], opacity: 0.45, curveness: 0.3 },
          data: data.points.map((pt) => ({
            coords: [data.origin.coord, pt.coord],
            value: pt.value,
            lineStyle: { width: width(pt.value) },
          })),
        },
        {
          name: tr`partners`,
          type: 'effectScatter',
          coordinateSystem: 'geo',
          zlevel: 2,
          rippleEffect: { brushType: 'stroke', scale: 3 },
          symbolSize: (val: number[]) => 6 + (val[2] / max) * 22,
          itemStyle: { color: t.series[4] },
          data: data.points.map((pt) => ({ name: pt.name, value: [...pt.coord, pt.value] })),
        },
        {
          name: tr`origin`,
          type: 'scatter',
          coordinateSystem: 'geo',
          zlevel: 3,
          symbol: 'pin',
          symbolSize: 30,
          itemStyle: { color: t.series[3] },
          label: {
            show: true,
            formatter: data.origin.name,
            position: 'right',
            fontSize: 10,
            color: t.ink,
          },
          data: [{ name: data.origin.name, value: [...data.origin.coord, 0] }],
        },
      ],
    };
  }, [data, t, tr]);

  if (!ready) {
    return (
      <div className="glass-card h-[500px] flex items-center justify-center text-sm text-muted-light dark:text-[#8f897c]">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Chargement de la carte…
      </div>
    );
  }

  return (
    <EChartCard
      title={tr`Partnership flow map`}
      subtitle={tr`Arcs towards the cities of geolocated foreign partner organisations`}
      option={option}
      exportName="carte-flux"
      height={460}
    />
  );
};
