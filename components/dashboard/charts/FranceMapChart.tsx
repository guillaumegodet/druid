import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  useVizTheme,
  useWorldMap,
} from '../EChartCard';
import { Trans, useLingui } from '@lingui/react/macro';

interface Point {
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  value: number;
}

/** Map of French partner institutions (world basemap framed on France). */
export const FranceMapChart: React.FC<{ points: Point[] }> = ({ points }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const ready = useWorldMap();

  const option = useMemo(() => {
    const max = points.reduce((m, p) => Math.max(m, p.value), 1);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number[]; data: { city?: string | null } }) =>
          `${p.name}${p.data?.city ? ` (${p.data.city})` : ''} : ${p.value?.[2] ?? 0}`,
        ...baseTooltip(t),
      },
      geo: {
        map: 'world',
        roam: true,
        // Framing on mainland France (the basemap remains the Natural Earth world map)
        boundingCoords: [
          [-5.5, 51.5],
          [9.8, 41.2],
        ],
        itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder },
        emphasis: { label: { show: false }, itemStyle: { areaColor: t.grid } },
      },
      series: [
        {
          type: 'scatter',
          coordinateSystem: 'geo',
          symbolSize: (val: number[]) => 6 + (val[2] / max) * 30,
          itemStyle: {
            color: t.series[3],
            opacity: 0.8,
            borderColor: t.surface,
            borderWidth: 1,
          },
          data: points.map((p) => ({
            name: p.name,
            city: p.city,
            value: [p.lon, p.lat, p.value],
          })),
        },
      ],
    };
  }, [points, t]);

  if (!ready) {
    return (
      <div className="glass-card h-[520px] flex items-center justify-center text-sm text-muted-light dark:text-[#8f897c]">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> <Trans>Loading the map…</Trans>
      </div>
    );
  }

  return (
    <EChartCard
      title={tr`Map of French partner institutions`}
      subtitle={tr`Dot size ∝ number of co-publications`}
      option={option}
      exportName="carte-france"
      height={520}
    />
  );
};
