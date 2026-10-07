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
import { numberLocale } from '../../../lib/i18n';
import type { CountrySpecialization } from '../countryAggregates';

/**
 * Specialization index of the co-publications with a country (« Pays » sub-tab, block H): share of
 * a subfield among them ÷ its share among all the international co-publications. Bars on either
 * side of 1 (reference line); the most over- and under-represented subfields.
 */
export const SpecializationChart: React.FC<{
  data: CountrySpecialization[];
  country: string;
  minCount: number;
  top?: number;
  bottom?: number;
  onSelect?: (subfield: string) => void;
}> = ({ data, country, minCount, top = 10, bottom = 5, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  // Most over-represented first, then the most under-represented (no overlap on short lists).
  const shown = useMemo(() => {
    const head = data.slice(0, top);
    const tail = data.slice(Math.max(top, data.length - bottom)).filter((s) => s.index < 1);
    return [...head, ...tail];
  }, [data, top, bottom]);

  const option = useMemo(() => {
    const rows = [...shown].reverse();
    const pct = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString(numberLocale())} %`;
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const s = rows[p[0].dataIndex];
          return `${s.key}<br/>${tr`Index`} : ${s.index.toLocaleString(numberLocale())}<br/>${tr`${country}: ${s.count} co-publications (${pct(s.share)})`}<br/>${tr`All international co-publications: ${pct(s.refShare)}`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), min: 0 },
      yAxis: {
        ...baseCategoryAxis(t),
        data: rows.map((s) => s.key),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 200, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((s) => ({
            value: s.index,
            itemStyle: { color: s.index >= 1 ? t.series[4] : t.series[3], borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: 'right',
            fontSize: 10,
            color: t.inkSecondary,
            formatter: (p: { value: number }) => p.value.toLocaleString(numberLocale()),
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: t.inkMuted, type: 'dashed' },
            label: { show: false },
            data: [{ xAxis: 1 }],
          },
        },
      ],
    };
  }, [shown, country, t, tr]);

  return (
    <EChartCard
      title={tr`Specialization of the co-publications with ${country}`}
      subtitle={tr`Share of a subfield among them ÷ its share among all the international co-publications (1 = same weight) — subfields with at least ${minCount} co-publications`}
      option={option}
      exportName="pays-specialisation"
      height={Math.max(280, shown.length * 26 + 60)}
      emptyMessage={shown.length ? undefined : tr`Too few co-publications per subfield.`}
      onSeriesClick={onSelect ? (p) => { const s = [...shown].reverse()[p.dataIndex]; if (s) onSelect(s.key); } : undefined}
    />
  );
};
