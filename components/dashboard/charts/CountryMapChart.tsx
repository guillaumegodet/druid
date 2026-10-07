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
import { numberLocale } from '../../../lib/i18n';
import type { CountryMapPoint, GeoBounds } from '../countryAggregates';

/** Institutions named on the map (the others in the tooltip only). */
const LABELLED = 8;

/**
 * Map of the institutions of a partner country (« Pays » sub-tab, block E): world basemap framed on
 * the institutions (countryBounds), the country tinted, dot size ∝ co-publications.
 */
export const CountryMapChart: React.FC<{
  points: CountryMapPoint[];
  bounds: GeoBounds;
  country: string;
  /** Polygon name of the country in the ECharts world map (CountryName.echarts), '' if absent. */
  polygon: string;
  onSelect?: (institution: string) => void;
}> = ({ points, bounds, country, polygon, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const ready = useWorldMap();

  const option = useMemo(() => {
    const max = points.reduce((m, p) => Math.max(m, p.value), 1);
    // Biggest last: drawn on top of the small ones.
    const ordered = [...points].sort((a, b) => a.value - b.value);
    const labelled = new Set(points.slice(0, LABELLED).map((p) => p.name));
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number[]; data: { city?: string | null } }) =>
          `${p.name}${p.data?.city ? ` (${p.data.city})` : ''} : ${(p.value?.[2] ?? 0).toLocaleString(numberLocale())}`,
        ...baseTooltip(t),
      },
      geo: {
        map: 'world',
        roam: true,
        boundingCoords: bounds,
        itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder },
        emphasis: { label: { show: false }, itemStyle: { areaColor: t.grid } },
        regions: polygon ? [{ name: polygon, itemStyle: { areaColor: t.seqRamp[0], borderColor: t.mapBorder } }] : [],
      },
      series: [
        {
          type: 'scatter',
          coordinateSystem: 'geo',
          symbolSize: (val: number[]) => 6 + Math.sqrt(val[2] / max) * 34,
          itemStyle: { color: t.series[4], opacity: 0.75, borderColor: t.surface, borderWidth: 1 },
          label: {
            show: true,
            position: 'right',
            fontSize: 10,
            color: t.ink,
            textBorderColor: t.surface,
            textBorderWidth: 2,
            formatter: (p: { name: string }) => (labelled.has(p.name) ? p.name : ''),
          },
          labelLayout: { hideOverlap: true },
          data: ordered.map((p) => ({ name: p.name, city: p.city, value: [p.lon, p.lat, p.value] })),
        },
      ],
    };
  }, [points, bounds, polygon, t]);

  if (!ready) {
    return (
      <div className="glass-card h-[520px] flex items-center justify-center text-sm text-muted-light dark:text-[#8f897c]">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> <Trans>Loading the map…</Trans>
      </div>
    );
  }

  const ordered = [...points].sort((a, b) => a.value - b.value);
  return (
    <EChartCard
      title={tr`Map of the partner institutions in ${country}`}
      subtitle={tr`Dot size ∝ number of co-publications · drag and zoom to explore`}
      option={option}
      exportName="pays-carte"
      height={520}
      onSeriesClick={onSelect ? (p) => ordered[p.dataIndex] && onSelect(ordered[p.dataIndex].name) : undefined}
    />
  );
};
