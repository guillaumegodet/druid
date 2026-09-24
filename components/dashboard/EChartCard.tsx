import React, { useContext, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../../lib/clipboard';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import {
  BarChart,
  PieChart,
  LineChart,
  MapChart,
  LinesChart,
  ScatterChart,
  EffectScatterChart,
  HeatmapChart,
  SankeyChart,
  SunburstChart,
  GraphChart,
  RadarChart,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  GeoComponent,
  VisualMapComponent,
  MarkLineComponent,
  GraphicComponent,
} from 'echarts/components';
import { RadarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Download, Maximize2, Minimize2, Share2, Copy, Check, ExternalLink, X, Info } from 'lucide-react';
import { chartDoc } from './report/chartDocs';
import { VIZ_DARK, VIZ_LIGHT, VizTheme } from './palette';
import { EMBEDDABLE_IDS } from './embedIds';
import { Trans, useLingui } from '@lingui/react/macro';

echarts.use([
  BarChart, PieChart, LineChart, MapChart, LinesChart, ScatterChart, EffectScatterChart,
  HeatmapChart, SankeyChart, SunburstChart, GraphChart, RadarChart,
  GridComponent, TooltipComponent, LegendComponent, GeoComponent, VisualMapComponent,
  MarkLineComponent, RadarComponent, GraphicComponent, CanvasRenderer,
]);

/** True in the public embed page /embed: hides the Share button. */
export const EmbedModeContext = React.createContext(false);

/**
 * Forced theme (PDF report: off-screen rendering always in light mode, whatever
 * the UI theme). null = follow the `dark` class of <html>.
 */
export const ForcedVizThemeContext = React.createContext<'light' | 'dark' | null>(null);

/**
 * Collects the ECharts instances for the PDF report generator: when this
 * context is provided (ReportRenderer), each card registers its chart
 * under its exportName — the generator waits for the renders to finish then rasterizes
 * via chart.getDataURL(). Title/subtitle accompany the image in the PDF.
 */
export interface ReportChartHandle {
  chart: echarts.ECharts;
  title: string;
  subtitle?: string;
}
export interface ReportCapture {
  register: (id: string, handle: ReportChartHandle) => void;
  unregister: (id: string) => void;
}
export const ReportCaptureContext = React.createContext<ReportCapture | null>(null);

/**
 * Static variant of an ECharts option for PDF report capture:
 * no animations nor effects. Essential for mass off-screen rendering
 * — the animated force layout starts on NaN positions and the effect
 * layers (motion blur of `lines`, ripple of `effectScatter`) crash
 * during concurrent resize/dispose (« can't access property 0 »,
 * « drawImage: canvas is empty ») when a whole section is mounted at
 * once. Incidentally, the force layout is computed in one pass
 * (layoutAnimation: false): the `finished` event arrives right away instead
 * of the ReportRenderer's 6 s cap per chart.
 */
function toStaticOption(option: EChartsCoreOption): EChartsCoreOption {
  const rawSeries = (option as { series?: unknown }).series;
  if (rawSeries == null) return { ...option, animation: false };
  const series = (Array.isArray(rawSeries) ? rawSeries : [rawSeries]).map((s) => {
    if (!s || typeof s !== 'object') return s;
    const serie = s as Record<string, unknown>;
    const out: Record<string, unknown> = { ...serie, animation: false };
    if (serie.type === 'graph' && serie.layout === 'force') {
      out.force = { ...(serie.force as object), layoutAnimation: false };
    }
    if (serie.type === 'lines') {
      out.effect = { ...(serie.effect as object), show: false };
    }
    if (serie.type === 'effectScatter') out.type = 'scatter';
    return out;
  });
  return { ...option, animation: false, series };
}

/**
 * Sharing scope provided by DashboardPage (current structure + year
 * range): when present, each chart of the registry exposes
 * a « Partager » button that builds the matching public /embed URL.
 */
export interface ShareScope {
  slug: string;
  range: { start: number; end: number };
  /** Current corpus scope — carried over into shared links. */
  perimetre?: 'affiliation' | 'effectifs';
}
export const ShareScopeContext = React.createContext<ShareScope | null>(null);

export function buildEmbedUrl(scope: ShareScope, chartId: string): string {
  const u = new URL('/embed', window.location.origin);
  u.searchParams.set('struct', scope.slug);
  u.searchParams.set('chart', chartId);
  u.searchParams.set('from', String(scope.range.start));
  u.searchParams.set('to', String(scope.range.end));
  if (scope.perimetre === 'effectifs') u.searchParams.set('perimetre', 'effectifs');
  return u.toString();
}

const WORLD_MAP = 'world';
let worldMapPromise: Promise<void> | null = null;

/**
 * Loads and registers the world map (public/vendor/world.json, Natural Earth
 * polygons — same names as the `echarts` column of the country labels).
 * Returns true when the map is available.
 */
export function useWorldMap(): boolean {
  const [ready, setReady] = useState(Boolean(echarts.getMap(WORLD_MAP)));
  useEffect(() => {
    if (ready) return;
    worldMapPromise ??= fetch('/vendor/world.json')
      .then((r) => r.json())
      .then((geo) => {
        echarts.registerMap(WORLD_MAP, geo);
      });
    let active = true;
    worldMapPromise
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => console.error('Could not load the world map', e));
    return () => {
      active = false;
    };
  }, [ready]);
  return ready;
}

/** Follows the `dark` class set on <html> by App.tsx (same mechanism as Tailwind). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark')),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function useVizTheme(): VizTheme {
  const forced = useContext(ForcedVizThemeContext);
  const dark = useIsDark();
  return (forced ?? (dark ? 'dark' : 'light')) === 'dark' ? VIZ_DARK : VIZ_LIGHT;
}

/** Option pieces shared by every chart (inks, tooltip, axes). */
export function baseTextStyle(t: VizTheme) {
  return { fontFamily: "'Hanken Grotesk', system-ui, sans-serif", color: t.inkSecondary };
}

export function baseTooltip(t: VizTheme) {
  return {
    backgroundColor: t.tooltipBg,
    borderColor: t.tooltipBorder,
    borderWidth: 1,
    textStyle: { color: t.ink, fontSize: 12, fontFamily: "'Hanken Grotesk', system-ui, sans-serif" },
    extraCssText: 'box-shadow: 0 12px 30px -22px rgba(50,42,15,.5); border-radius: 10px;',
  };
}

export function baseValueAxis(t: VizTheme) {
  return {
    type: 'value' as const,
    axisLabel: { color: t.inkMuted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid } },
  };
}

export function baseCategoryAxis(t: VizTheme) {
  return {
    type: 'category' as const,
    axisLabel: { color: t.inkSecondary, fontSize: 11 },
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
  };
}

interface EChartCardProps {
  title: string;
  subtitle?: string;
  option: EChartsCoreOption;
  /**
   * File name (without extension) of the PNG export. Also serves as identifier
   * in the embed registry (embedRegistry) for the Share button.
   */
  exportName: string;
  height?: number;
  /** Additional controls displayed in the header (e.g. slider, local filter). */
  headerExtra?: React.ReactNode;
  /** Full-width banner between the header and the chart (e.g. input + chips). */
  toolbar?: React.ReactNode;
  /** Replaces the chart with this message (empty state / waiting for input). */
  emptyMessage?: string;
  /** Disables the Share button (chart outside the embed registry). */
  shareable?: boolean;
  /** Click on a series element (bar, donut slice…) — lets the
   * tabs open the pre-filtered publication list. */
  onSeriesClick?: (params: { name: string; seriesName?: string; dataIndex: number }) => void;
}

/** « Méthodologie » dialog: description / method / limits sheet of the
 * chart (chartDocs.ts — the same sheets as in the PDF reports). */
const MethodDialog: React.FC<{
  title: string;
  doc: { description: string; methode: string; limites?: string };
  onClose: () => void;
}> = ({ title, doc, onClose }) => {
  const { t } = useLingui();
  return (
  <div
    className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="glass-card-strong w-full max-w-xl p-5 flex flex-col gap-4 bg-white/95 dark:bg-[#33312c] max-h-[80vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
          <Trans>About “{title}”</Trans>
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-2 rounded-lg text-muted-light dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors"
          title={t`Close`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink dark:text-[#e8e4d8]">
        <div>
          <span className="section-label"><Trans>Description</Trans></span>
          <p className="mt-1">{doc.description}</p>
        </div>
        <div>
          <span className="section-label"><Trans>Method</Trans></span>
          <p className="mt-1">{doc.methode}</p>
        </div>
        {doc.limites && (
          <div>
            <span className="section-label"><Trans>Limitations</Trans></span>
            <p className="mt-1">{doc.limites}</p>
          </div>
        )}
      </div>
    </div>
  </div>
  );
};

/** « Partager » dialog: public URL + iframe snippet, with copy. */
const ShareDialog: React.FC<{ url: string; title: string; onClose: () => void }> = ({
  url,
  title,
  onClose,
}) => {
  const { t } = useLingui();
  const [copied, setCopied] = useState<'url' | 'iframe' | null>(null);
  const iframeSnippet = `<iframe src="${url}" width="720" height="480" style="border:0" title="${title}"></iframe>`;

  const copy = (what: 'url' | 'iframe', text: string) => {
    copyToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    });
  };

  const rowClass = 'flex items-center gap-2';
  const inputClass =
    'input-soft flex-1 !py-1.5 text-xs font-mono truncate';
  const btnClass =
    'shrink-0 p-2 rounded-lg text-muted-light dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card-strong w-full max-w-xl p-5 flex flex-col gap-4 bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
              <Trans>Share “{title}”</Trans>
            </h4>
            <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
              <Trans>Public link: accessible without authentication, with the current filters (structure and year range).</Trans>
            </p>
          </div>
          <button type="button" onClick={onClose} className={btnClass} title={t`Close`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="section-label"><Trans>Direct link</Trans></span>
          <div className={rowClass}>
            <input className={inputClass} readOnly value={url} onFocus={(e) => e.target.select()} />
            <button type="button" className={btnClass} title={t`Copy link`} onClick={() => copy('url', url)}>
              {copied === 'url' ? <Check className="w-4 h-4 text-pixel-teal" /> : <Copy className="w-4 h-4" />}
            </button>
            <a className={btnClass} href={url} target="_blank" rel="noreferrer" title={t`Open in a new tab`}>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="section-label"><Trans>Iframe embed</Trans></span>
          <div className={rowClass}>
            <input
              className={inputClass}
              readOnly
              value={iframeSnippet}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className={btnClass}
              title={t`Copy the embed code`}
              onClick={() => copy('iframe', iframeSnippet)}
            >
              {copied === 'iframe' ? <Check className="w-4 h-4 text-pixel-teal" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Shared chart card of the dashboard: « glass-card » chrome of the
 * 2026 redesign, display title, toolbar (PNG export, full screen).
 * Druid equivalent of the EChart wrapper of the SoVisu+ mockups (without the iframe
 * sharing, which assumes a public route — see phase 4).
 */
export const EChartCard: React.FC<EChartCardProps> = ({
  title,
  subtitle,
  option,
  exportName,
  height = 320,
  headerExtra,
  toolbar,
  emptyMessage,
  shareable = true,
  onSeriesClick,
}) => {
  const { t } = useLingui();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  // Methodology sheet from chartDocs.ts (key = exportName) — ⓘ button when present,
  // including in /embed (methodological transparency of public dataviz).
  const doc = chartDoc(exportName);
  const theme = useVizTheme();
  const embedMode = useContext(EmbedModeContext);
  const shareScope = useContext(ShareScopeContext);
  const reportCapture = useContext(ReportCaptureContext);
  // Button visible only for dataviz that can really be embedded: an
  // exportName missing from the registry would produce a « not found » /embed link.
  const canShare = shareable && !embedMode && shareScope != null && EMBEDDABLE_IDS.has(exportName);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    // A container measured at 0 (unmounting, transient display:none) would produce
    // a view frame with a non-invertible matrix in ECharts (force graphs
    // in particular: matrixInvert → null → cascading TypeError). These empty
    // passes are ignored, the next resize will restore the right size.
    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el || !el.clientWidth || !el.clientHeight) return;
      chart.resize();
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const opt = reportCapture ? toStaticOption(option) : option;
    chartRef.current?.setOption(opt, { notMerge: true, lazyUpdate: true });
  }, [option, reportCapture]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onSeriesClick) return;
    const handler = (p: { name?: unknown; seriesName?: string; dataIndex: number }) =>
      onSeriesClick({ name: String(p.name ?? ''), seriesName: p.seriesName, dataIndex: p.dataIndex });
    chart.on('click', handler);
    return () => {
      if (!chart.isDisposed()) chart.off('click', handler);
    };
  }, [onSeriesClick]);

  // Report mode: exposes the instance to the ReportRenderer collector.
  useEffect(() => {
    if (!reportCapture || !chartRef.current) return;
    reportCapture.register(exportName, { chart: chartRef.current, title, subtitle });
    return () => reportCapture.unregister(exportName);
  }, [reportCapture, exportName, title, subtitle]);

  // Switching to full screen changes the container size after rendering.
  useEffect(() => {
    const id = window.setTimeout(() => chartRef.current?.resize(), 60);
    return () => window.clearTimeout(id);
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const downloadPng = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: theme.tooltipBg });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportName}.png`;
    a.click();
  };

  const toolbarBtn =
    'p-1.5 rounded-lg text-muted-light dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors';

  const wrapperClass = fullscreen
    ? 'fixed inset-0 z-50 flex flex-col p-6 bg-[#f4f0e6] dark:bg-[#201e1a]'
    : 'glass-card flex flex-col';

  return (
    <div className={wrapperClass}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
        <div className="min-w-0">
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] leading-tight truncate">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {headerExtra}
          {doc && (
            <button
              type="button"
              onClick={() => setDocOpen(true)}
              title={t`Methodology (description, method, limitations)`}
              className={toolbarBtn}
            >
              <Info className="w-4 h-4" />
            </button>
          )}
          {canShare && (
            <button type="button" onClick={() => setShareOpen(true)} title={t`Share (public link / iframe)`} className={toolbarBtn}>
              <Share2 className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={downloadPng} title={t`Download as PNG`} className={toolbarBtn}>
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? t`Exit full screen` : t`Full screen`}
            className={toolbarBtn}
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {toolbar && <div className="px-5 pb-2">{toolbar}</div>}
      {emptyMessage && (
        <div className="px-5 pb-5 pt-2 text-sm text-muted-light dark:text-[#8f897c]">{emptyMessage}</div>
      )}
      {/* Container always mounted (single ECharts init) — hidden in empty state,
          the ResizeObserver ignores passes at 0 and re-measures when back. */}
      <div
        ref={containerRef}
        className={`${fullscreen ? 'flex-1 min-h-0 px-2 pb-2' : 'px-2 pb-3'}${emptyMessage ? ' hidden' : ''}`}
        style={fullscreen ? undefined : { height }}
      />
      {shareOpen && shareScope && (
        <ShareDialog
          url={buildEmbedUrl(shareScope, exportName)}
          title={title}
          onClose={() => setShareOpen(false)}
        />
      )}
      {docOpen && doc && <MethodDialog title={title} doc={doc} onClose={() => setDocOpen(false)} />}
    </div>
  );
};
