// Generic charts of the Teams / PhD students / Researchers tabs — ported
// from the SoVisu+ mockups (DonutChart, StackedAreaChart, StackedBarHChart,
// RadarChart, RankBarChart), validated palette of the current theme.

import React, { useMemo } from 'react';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from '../EChartCard';
import {
  StackedByYear,
  StackedByCategory,
  RadarAggregates,
  ResearcherItem,
} from '../structureAggregates';
import { useLingui } from '@lingui/react/macro';

const legendBase = (t: ReturnType<typeof useVizTheme>) => ({
  type: 'scroll' as const,
  bottom: 0,
  textStyle: { color: t.inkSecondary, fontSize: 11 },
  icon: 'circle',
  itemWidth: 10,
  itemHeight: 10,
});

/** Breakdown donut (teams, PhD students…). */
export const TeamDonutChart: React.FC<{
  title: string;
  subtitle?: string;
  exportName: string;
  data: { name: string; value: number; color?: string }[];
  height?: number;
  /** Click on a slice (category name) — e.g. open the filtered list. */
  onSelect?: (name: string) => void;
}> = ({ title, subtitle, exportName, data, height = 320, onSelect }) => {
  const t = useVizTheme();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'item', formatter: '{b} : {c} ({d} %)', ...baseTooltip(t) },
      legend: legendBase(t),
      color: t.series,
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: t.surface, borderWidth: 2 },
          label: { formatter: '{b}\n{d} %', color: t.inkSecondary, fontSize: 11 },
          data: data.map((d) => ({
            name: d.name,
            value: d.value,
            ...(d.color ? { itemStyle: { color: d.color } } : {}),
          })),
        },
      ],
    }),
    [data, t],
  );
  return (
    <EChartCard
      title={title}
      subtitle={subtitle}
      option={option}
      exportName={exportName}
      height={height}
      onSeriesClick={
        onSelect ? (p) => data[p.dataIndex] && onSelect(data[p.dataIndex].name) : undefined
      }
    />
  );
};

/** Stacked evolution per year (one series per team). */
export const StackedAreaChart: React.FC<{
  title: string;
  exportName: string;
  data: StackedByYear;
  /** Explicit palette (one color per series, e.g. stable colors per axis). */
  colors?: string[];
  /** Click on a point (series = team/axis, year) — opens the filtered list. */
  onSelect?: (seriesName: string, year: number) => void;
}> = ({ title, exportName, data, colors, onSelect }) => {
  const t = useVizTheme();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', ...baseTooltip(t) },
      legend: { ...legendBase(t), data: data.series.map((s) => s.name) },
      grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
      color: colors ?? t.series,
      xAxis: {
        type: 'category' as const,
        boundaryGap: false,
        data: data.years.map(String),
        axisLabel: { color: t.inkSecondary, fontSize: 11 },
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
      yAxis: baseValueAxis(t),
      series: data.series.map((s) => ({
        name: s.name,
        type: 'line',
        stack: 'total',
        areaStyle: { opacity: 0.45 },
        lineStyle: { width: 2 },
        emphasis: { focus: 'series' },
        data: s.data,
      })),
    }),
    [data, colors, t],
  );
  return (
    <EChartCard
      title={title}
      option={option}
      exportName={exportName}
      onSeriesClick={
        onSelect && data.years[0] != null
          ? (p) =>
              data.years[p.dataIndex] != null &&
              onSelect(p.seriesName ?? '', data.years[p.dataIndex])
          : undefined
      }
    />
  );
};

/** Stacked horizontal bars (e.g. publication types per team). */
export const StackedBarHChart: React.FC<{
  title: string;
  exportName: string;
  data: StackedByCategory;
  height?: number;
  /** Explicit palette (one color per series). */
  colors?: string[];
  /** Click on a segment (category = team/axis, series = type) — filtered list. */
  onSelect?: (category: string, seriesName: string) => void;
}> = ({ title, exportName, data, height = 320, colors, onSelect }) => {
  const t = useVizTheme();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      legend: { ...legendBase(t), data: data.series.map((s) => s.name) },
      grid: { left: 8, right: 24, top: 8, bottom: 40, containLabel: true },
      color: colors ?? t.series,
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: data.categories,
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 120, overflow: 'truncate' as const },
      },
      series: data.series.map((s) => ({
        name: s.name,
        type: 'bar',
        stack: 'total',
        data: s.data,
        itemStyle: { borderColor: t.surface, borderWidth: 1 },
      })),
    }),
    [data, colors, t],
  );
  return (
    <EChartCard
      title={title}
      option={option}
      exportName={exportName}
      height={height}
      onSeriesClick={
        onSelect
          ? (p) =>
              data.categories[p.dataIndex] != null &&
              onSelect(data.categories[p.dataIndex], p.seriesName ?? '')
          : undefined
      }
    />
  );
};

/** Disciplinary profile of the teams — radar (shares in %). */
export const TeamRadarChart: React.FC<{
  data: RadarAggregates;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  toolbar?: React.ReactNode;
  emptyMessage?: string;
  height?: number;
}> = ({ data, subtitle, headerExtra, toolbar, emptyMessage, height = 420 }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'item', ...baseTooltip(t) },
      legend: { ...legendBase(t), data: data.series.map((s) => s.name) },
      color: t.series,
      radar: {
        indicator: data.indicators.map((i) => ({ name: i.name, max: i.max })),
        radius: '62%',
        axisName: { fontSize: 10, color: t.inkSecondary },
        splitLine: { lineStyle: { color: t.grid } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: t.axis } },
      },
      series: [
        {
          type: 'radar',
          tooltip: { valueFormatter: (v: number) => `${v} %` },
          data: data.series.map((s) => ({
            name: s.name,
            value: s.data,
            areaStyle: { opacity: 0.1 },
            lineStyle: { width: 2 },
          })),
        },
      ],
    }),
    [data, t],
  );
  return (
    <EChartCard
      title={tr`Disciplinary profile of teams`}
      subtitle={subtitle ?? tr`Share of publications by OpenAlex subfield`}
      option={option}
      exportName="radar-disciplinaire"
      height={height}
      headerExtra={headerExtra}
      toolbar={toolbar}
      emptyMessage={emptyMessage}
    />
  );
};

/**
 * Disciplinary profile of the teams — teams × topics heatmap (shares in %),
 * alternative view to the radar: stays readable beyond 5-6 teams or 8 axes,
 * and allows comparing teams on a given topic (column-wise reading).
 * Same RadarAggregates as input (rows = teams, columns = axes).
 */
export const TeamHeatmapChart: React.FC<{
  data: RadarAggregates;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  toolbar?: React.ReactNode;
  emptyMessage?: string;
}> = ({ data, subtitle, headerExtra, toolbar, emptyMessage }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const subjects = data.indicators.map((i) => i.name);
    const teams = data.series.map((s) => s.name);
    const max = Math.max(1, ...data.series.flatMap((s) => s.data));
    const cells = data.series.flatMap((s, y) =>
      s.data.map((v, x) => ({
        value: [x, y, v],
        // Ink-colored text on light cells, surface-colored on dark ones
        // (the label remains a text token, the hue carries the value).
        label: { color: v > max * 0.55 ? t.surface : t.ink },
      })),
    );
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        position: 'top',
        formatter: (p: { value: [number, number, number] }) => {
          const [x, y, v] = p.value;
          return `${teams[y]}<br/>${subjects[x]} : <b>${v} %</b>`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: subjects,
        position: 'top' as const,
        splitArea: { show: true, areaStyle: { color: [t.surface] } },
        axisLabel: {
          color: t.inkSecondary,
          fontSize: 11,
          interval: 0,
          rotate: 30,
          width: 130,
          overflow: 'truncate' as const,
        },
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category' as const,
        data: teams,
        inverse: true,
        splitArea: { show: true, areaStyle: { color: [t.surface] } },
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 140, overflow: 'truncate' as const },
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
      visualMap: {
        min: 0,
        max,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: t.seqRamp },
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        formatter: (v: number) => `${Math.round(v)} %`,
      },
      series: [
        {
          type: 'heatmap',
          data: cells,
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
          label: { show: true, fontSize: 11, formatter: (p: { value: [number, number, number] }) => `${p.value[2]}` },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' } },
        },
      ],
    };
  }, [data, t]);
  const height = Math.max(320, data.series.length * 40 + 170);
  return (
    <EChartCard
      title={tr`Disciplinary profile of teams`}
      subtitle={subtitle}
      option={option}
      exportName="heatmap-disciplinaire"
      height={height}
      headerExtra={headerExtra}
      toolbar={toolbar}
      emptyMessage={emptyMessage}
    />
  );
};

/** Ranking (researchers, PhD students) — horizontal bars, single hue. */
export const RankBarChart: React.FC<{
  title: string;
  subtitle?: string;
  exportName: string;
  data: ResearcherItem[];
  colorSlot?: number;
  height?: number;
  /** Click on a bar (category label) — e.g. open the filtered list. */
  onItemClick?: (label: string) => void;
  /** Click on a bar returning the full item (author id, etc.). */
  onItemSelect?: (item: ResearcherItem) => void;
}> = ({ title, subtitle, exportName, data, colorSlot = 0, height = 460, onItemClick, onItemSelect }) => {
  const t = useVizTheme();
  const sorted = useMemo(() => [...data].sort((a, b) => a.count - b.count), [data]);
  const option = useMemo(() => {
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number; value: number }[]) => {
          const item = sorted[p[0].dataIndex];
          const tm = item.teams?.length ? ` — ${item.teams.join(', ')}` : '';
          return `${item.label}${tm} : ${p[0].value}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 32, top: 8, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.label),
        axisLabel: { color: t.inkSecondary, width: 150, overflow: 'truncate' as const, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => d.count),
          itemStyle: { color: t.series[colorSlot], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
        },
      ],
    };
  }, [sorted, colorSlot, t]);
  const onSeriesClick =
    onItemSelect || onItemClick
      ? (p: { name: string; dataIndex: number }) => {
          if (onItemSelect && sorted[p.dataIndex]) onItemSelect(sorted[p.dataIndex]);
          else if (onItemClick) onItemClick(p.name);
        }
      : undefined;
  return (
    <EChartCard
      title={title}
      subtitle={subtitle}
      option={option}
      exportName={exportName}
      height={height}
      onSeriesClick={onSeriesClick}
    />
  );
};
