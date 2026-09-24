// Off-screen rendering of a PDF report's dataviz: mounts the isolated
// components of the embed registry (EMBED_CHARTS) in an invisible fixed-width
// container, forced light theme, waits for the ECharts renders to settle
// (« finished » event — maps load their GeoJSON asynchronously, force graphs
// never « finish » → maximum delay per chart), then rasterizes each instance
// to a high-resolution PNG via getDataURL().

import React, { useEffect, useMemo, useRef } from 'react';
import {
  EmbedModeContext,
  ForcedVizThemeContext,
  ReportCapture,
  ReportCaptureContext,
  ReportChartHandle,
} from '../EChartCard';
import { EMBED_CHARTS } from '../embedRegistry';
import { DashboardDataset } from '../types';
import { YearRange } from '../overviewAggregates';

export interface CapturedChart {
  id: string;
  title: string;
  subtitle?: string;
  /** Data-URL PNG (pixelRatio 2, fond blanc). */
  png: string;
  pxWidth: number;
  pxHeight: number;
}

/** Render width (px) — close to the dashboard's full width. */
const CHART_WIDTH = 1100;
/** Quiet time required after the last « finished » to consider a render stable. */
const SETTLE_MS = 700;
/** Cap per chart (force graphs: the animation never stops). */
const MAX_CHART_MS = 6000;
/** Global cap: beyond it, capture what is ready and report the rest. */
const MAX_TOTAL_MS = 45000;

interface Entry {
  handle: ReportChartHandle;
  registeredAt: number;
  lastFinished: number;
  onFinished: () => void;
}

interface ReportRendererProps {
  dataset: DashboardDataset;
  range: YearRange;
  /** EMBED_CHARTS ids to render, in report order. */
  chartIds: string[];
  /** Captures in chartIds order + ids not rendered (unknown component, failure). */
  onDone: (captures: CapturedChart[], missing: string[]) => void;
}

export const ReportRenderer: React.FC<ReportRendererProps> = ({
  dataset,
  range,
  chartIds,
  onDone,
}) => {
  const entriesRef = useRef(new Map<string, Entry>());
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const validIds = useMemo(() => chartIds.filter((id) => EMBED_CHARTS[id]), [chartIds]);

  const capture = useMemo<ReportCapture>(
    () => ({
      register: (id, handle) => {
        const entry: Entry = {
          handle,
          registeredAt: performance.now(),
          lastFinished: 0,
          onFinished: () => {
            entry.lastFinished = performance.now();
          },
        };
        handle.chart.on('finished', entry.onFinished);
        entriesRef.current.set(id, entry);
      },
      unregister: (id) => {
        const e = entriesRef.current.get(id);
        if (e) e.handle.chart.off('finished', e.onFinished);
        entriesRef.current.delete(id);
      },
    }),
    [],
  );

  useEffect(() => {
    const start = performance.now();
    const timer = window.setInterval(() => {
      if (doneRef.current) return;
      const now = performance.now();
      const entries = entriesRef.current;
      const settled = validIds.every((id) => {
        const e = entries.get(id);
        // Not mounted yet (map waiting for its GeoJSON…): give it
        // 2 × MAX_CHART_MS from the start, then give up on it (missing).
        if (!e) return now - start > MAX_CHART_MS * 2;
        if (now - e.registeredAt > MAX_CHART_MS) return true;
        return e.lastFinished > 0 && now - e.lastFinished > SETTLE_MS;
      });
      if (!settled && now - start < MAX_TOTAL_MS) return;
      doneRef.current = true;
      window.clearInterval(timer);

      const captures: CapturedChart[] = [];
      const missing: string[] = chartIds.filter((id) => !EMBED_CHARTS[id]);
      for (const id of validIds) {
        const e = entries.get(id);
        if (!e) {
          missing.push(id);
          continue;
        }
        try {
          captures.push({
            id,
            title: e.handle.title,
            subtitle: e.handle.subtitle,
            png: e.handle.chart.getDataURL({
              type: 'png',
              pixelRatio: 2,
              backgroundColor: '#ffffff',
            }),
            pxWidth: e.handle.chart.getWidth(),
            pxHeight: e.handle.chart.getHeight(),
          });
        } catch (err) {
          console.warn(`Report: could not capture « ${id} »`, err);
          missing.push(id);
        }
      }
      onDoneRef.current(captures, missing);
    }, 250);
    return () => window.clearInterval(timer);
  }, [chartIds, validIds]);

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: -CHART_WIDTH - 400,
        width: CHART_WIDTH,
        pointerEvents: 'none',
      }}
    >
      <ForcedVizThemeContext.Provider value="light">
        <EmbedModeContext.Provider value={true}>
          <ReportCaptureContext.Provider value={capture}>
            {validIds.map((id) => {
              const { Chart } = EMBED_CHARTS[id];
              return (
                <div key={id} style={{ width: CHART_WIDTH, marginBottom: 16 }}>
                  <Chart dataset={dataset} range={range} />
                </div>
              );
            })}
          </ReportCaptureContext.Provider>
        </EmbedModeContext.Provider>
      </ForcedVizThemeContext.Provider>
    </div>
  );
};
