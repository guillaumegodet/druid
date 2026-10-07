import React, { useMemo } from 'react';
import { EChartCard, baseTextStyle, baseTooltip, useVizTheme } from '../EChartCard';

/**
 * Rows × columns heatmap with free labels (single-hue sequential ramp) — e.g. internal labs ×
 * institutions of a partner country (« Pays » sub-tab, block G).
 */
export const MatrixHeatmapChart: React.FC<{
  title: string;
  subtitle?: string;
  exportName: string;
  rows: string[];
  cols: string[];
  cells: { x: number; y: number; v: number }[];
  onCellClick?: (x: number, y: number) => void;
}> = ({ title, subtitle, exportName, rows, cols, cells, onCellClick }) => {
  const t = useVizTheme();

  const option = useMemo(() => {
    const max = cells.reduce((m, c) => Math.max(m, c.v), 0);
    const axis = {
      type: 'category' as const,
      splitArea: { show: true, areaStyle: { color: [t.surface] } },
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
    };
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        position: 'top',
        formatter: (p: { value: [number, number, number] }) => {
          const [x, y, v] = p.value;
          return `${rows[y]} × ${cols[x]} : ${v}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
      xAxis: {
        ...axis,
        data: cols,
        axisLabel: { color: t.inkSecondary, fontSize: 10, rotate: 35, width: 120, overflow: 'truncate' as const, interval: 0 },
      },
      yAxis: {
        ...axis,
        // First row on top.
        inverse: true,
        data: rows,
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 120, overflow: 'truncate' as const, interval: 0 },
      },
      visualMap: {
        min: 0,
        max: max || 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: t.seqRamp },
        textStyle: { color: t.inkSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'heatmap',
          data: cells.map((c) => [c.x, c.y, c.v]),
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
          // Halo: readable on the light and dark cells of the ramp.
          label: { show: true, fontSize: 10, color: t.ink, textBorderColor: t.surface, textBorderWidth: 2 },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' } },
        },
      ],
    };
  }, [rows, cols, cells, t]);

  return (
    <EChartCard
      title={title}
      subtitle={subtitle}
      option={option}
      exportName={exportName}
      height={Math.max(360, rows.length * 34 + 170)}
      onSeriesClick={
        onCellClick
          ? (p) => {
              const c = cells[p.dataIndex];
              if (c) onCellClick(c.x, c.y);
            }
          : undefined
      }
    />
  );
};
