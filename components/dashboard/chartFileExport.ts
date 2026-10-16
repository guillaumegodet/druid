// Vector exports of a chart card (SVG, PDF): the live chart is drawn on canvas, so the
// current option is replayed once in an off-screen SVG instance (ECharts SSR mode, no DOM),
// then the SVG is turned into a PDF by svg2pdf.js — vector shapes and real text, which
// journals and LaTeX accept where the PNG export is a bitmap.

import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { loadReportFonts } from './report/fonts';

echarts.use([SVGRenderer]);

/**
 * Static variant of an ECharts option, for renderings that must be complete at once (PDF report
 * capture, vector export): no animations nor effects. Essential for mass off-screen rendering
 * — the animated force layout starts on NaN positions and the effect
 * layers (motion blur of `lines`, ripple of `effectScatter`) crash
 * during concurrent resize/dispose (« can't access property 0 »,
 * « drawImage: canvas is empty ») when a whole section is mounted at
 * once. Incidentally, the force layout is computed in one pass
 * (layoutAnimation: false): the `finished` event arrives right away instead
 * of the ReportRenderer's 6 s cap per chart.
 */
export function toStaticOption(option: EChartsCoreOption): EChartsCoreOption {
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

interface LiveGraphData {
  count(): number;
  getItemLayout(i: number): unknown;
}

/**
 * A force layout starts from random positions, and its view is fitted on those starting
 * positions — the settled network usually overflows the card. Replayed as is, the export would
 * show another network; refitted (`layout: 'none'`), the whole of it shrunk. So each node is
 * placed at its on-screen pixel position on an invisible cartesian grid the size of the chart
 * (1 unit = 1 px): the export crops exactly like the screen.
 * The node positions come from the live model (private API, hence the guards).
 */
function pinForceLayouts(chart: echarts.ECharts, option: EChartsCoreOption): EChartsCoreOption {
  const opt = option as Record<string, unknown>;
  const series = opt.series;
  if (!Array.isArray(series)) return option;
  const liveData = (i: number): LiveGraphData | undefined => {
    try {
      return (chart as unknown as { getModel(): { getSeriesByIndex(i: number): { getData(): LiveGraphData } } })
        .getModel().getSeriesByIndex(i).getData();
    } catch {
      return undefined;
    }
  };
  const width = chart.getWidth();
  const height = chart.getHeight();
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const grids = list(opt.grid);
  const xAxes = list(opt.xAxis);
  const yAxes = list(opt.yAxis);
  const pixelGrid = grids.length;
  let pinnedAny = false;

  const out = series.map((s, i) => {
    const serie = s as Record<string, unknown>;
    if (serie?.type !== 'graph' || serie.layout !== 'force') return s;
    const data = liveData(i);
    const nodes = (serie.data ?? serie.nodes) as unknown[] | undefined;
    if (!data || !Array.isArray(nodes) || data.count() !== nodes.length) return s;
    const pinned = nodes.map((n, k) => {
      const xy = data.getItemLayout(k) as number[] | undefined;
      const px = xy ? (chart.convertToPixel({ seriesIndex: i }, xy) as number[] | undefined) : undefined;
      const node = n && typeof n === 'object' ? (n as Record<string, unknown>) : {};
      return { ...node, value: px && Number.isFinite(px[0]) && Number.isFinite(px[1]) ? [px[0], px[1]] : [NaN, NaN] };
    });
    pinnedAny = true;
    const axis = xAxes.length;
    xAxes.push({ type: 'value', gridIndex: pixelGrid, min: 0, max: width, show: false });
    yAxes.push({ type: 'value', gridIndex: pixelGrid, min: 0, max: height, inverse: true, show: false });
    const pinnedSerie: Record<string, unknown> = {
      ...serie, layout: 'none', coordinateSystem: 'cartesian2d', xAxisIndex: axis, yAxisIndex: axis, data: pinned,
    };
    for (const key of ['nodes', 'zoom', 'center', 'roam', 'left', 'top', 'right', 'bottom', 'width', 'height']) {
      delete pinnedSerie[key];
    }
    return pinnedSerie;
  });
  if (!pinnedAny) return option;
  return {
    ...option,
    series: out,
    grid: [...grids, { left: 0, top: 0, width, height, show: false, containLabel: false }],
    xAxis: xAxes,
    yAxis: yAxes,
  };
}

/** SVG markup of the chart as currently displayed (legend selection, zoom/pan, network layout). */
export function renderChartSvg(chart: echarts.ECharts, backgroundColor: string): string {
  const width = chart.getWidth();
  const height = chart.getHeight();
  const option = pinForceLayouts(chart, toStaticOption(chart.getOption() as EChartsCoreOption));
  const svgChart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    svgChart.setOption({ ...option, backgroundColor });
    return svgChart.renderToSVGString();
  } finally {
    svgChart.dispose();
  }
}

/**
 * PDF of an SVG, page size = chart size (pt = px). The brand fonts are embedded under the
 * family name the chart text uses ('Hanken Grotesk'); without them svg2pdf falls back to
 * Helvetica through the `sans-serif` of the font stack.
 */
export async function svgToPdf(svg: string, width: number, height: number): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }, fonts] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
    loadReportFonts(),
  ]);
  const doc = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'pt', format: [width, height] });
  for (const f of fonts ?? []) {
    if (!f.name.startsWith('HankenGrotesk')) continue;
    doc.addFileToVFS(f.file, f.b64);
    const semiBold = f.name === 'HankenGroteskSemiBold';
    // svg2pdf looks a font up by family + style ('normal', 'bold', '600normal'…).
    for (const style of semiBold ? ['bold', '600normal', '500normal'] : ['normal']) {
      doc.addFont(f.file, 'Hanken Grotesk', style);
    }
  }
  // svg2pdf reads `alignment-baseline`, ECharts writes `dominant-baseline`: without the rename
  // every label would sit on its baseline, half a line too high.
  const markup = svg.replace(/dominant-baseline=/g, 'alignment-baseline=');
  const element = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  // svg2pdf measures text through the DOM: the element must be attached while it works.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
  host.appendChild(element);
  document.body.appendChild(host);
  try {
    await svg2pdf(element, doc, { x: 0, y: 0, width, height });
  } finally {
    host.remove();
  }
  return doc.output('blob');
}

/** Triggers the download of a blob under the given file name. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
