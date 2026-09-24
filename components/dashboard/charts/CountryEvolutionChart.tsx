import React, { useMemo, useState } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import { useLingui } from '@lingui/react/macro';
import { CountryName, DashboardPublication } from '../types';
import { YearRange } from '../overviewAggregates';
import { aggregateCountryEvolution } from '../internationalAggregates';

/**
 * Evolution of the main partner countries — one line per country (number of
 * shared publications per year), adjustable number of countries (3 to 8, the
 * validated categorical palette does not cycle beyond that).
 */
export const CountryEvolutionChart: React.FC<{
  publications: DashboardPublication[];
  range: YearRange;
  countryNames: Record<string, CountryName>;
  defaultN?: number;
  /** D3: publications already filtered by period (cf. InternationalAggregates.inRange). */
  inRange?: DashboardPublication[];
}> = ({ publications, range, countryNames, defaultN = 6, inRange }) => {
  const t = useVizTheme();
  const { t: tr, i18n } = useLingui();
  const [topN, setTopN] = useState(defaultN);

  const data = useMemo(
    () => aggregateCountryEvolution(publications, range, countryNames, topN, inRange),
    [publications, range, countryNames, topN, inRange, i18n.locale],
  );

  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', ...baseTooltip(t) },
      legend: {
        type: 'scroll',
        bottom: 0,
        data: data.series.map((s) => s.name),
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
      color: t.series,
      xAxis: { ...baseCategoryAxis(t), data: data.years.map(String) },
      yAxis: baseValueAxis(t),
      series: data.series.map((s) => ({
        name: s.name,
        type: 'line',
        smooth: false,
        showSymbol: true,
        symbolSize: 7,
        lineStyle: { width: 2 },
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        emphasis: { focus: 'series' },
        data: s.data,
      })),
    }),
    [data, t, tr],
  );

  const selector = (
    <label className="flex items-center gap-1.5 text-xs text-muted dark:text-[#c3beb0] mr-2">
      {tr`Countries:`}
      <select
        className="input-soft !w-auto !py-1 !px-2 text-xs font-semibold cursor-pointer"
        value={topN}
        onChange={(e) => setTopN(Number(e.target.value))}
      >
        {[3, 4, 5, 6, 7, 8].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <EChartCard
      title={tr`Evolution of the main partner countries`}
      subtitle={tr`Shared publications per year, for the main countries (excluding France)`}
      option={option}
      exportName="evolution-pays"
      headerExtra={selector}
      height={360}
    />
  );
};
