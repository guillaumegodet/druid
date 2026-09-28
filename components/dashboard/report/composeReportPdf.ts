// PDF of a saved report (docs/plan-mes-rapports.md § 4.4): cover with the report's own name,
// description and scope, the global methodological note, then the visible blocks in order —
// sections, text, key figures and the captured charts (with their notes, their scope when it
// departs from the report context, and the /embed link of the interactive version).

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { numberLocale } from '../../../lib/i18n';
import { buildEmbedUrl } from '../EChartCard';
import { EMBEDDABLE_IDS } from '../embedIds';
import { PUBLIC_FORBIDDEN_FILTERS } from '../embedState';
import { KPI_SETS } from '../kpiItems';
import { buildFilterContext, describeFilters } from '../publicationFilters';
import type { DashboardDataset } from '../types';
import { chartDoc, methodologyNote } from './chartDocs';
import type { ReportDefinition } from './definition';
import { loadReportFonts } from './fonts';
import { ReportPdf } from './pdfDoc';
import { DEFAULT_TABLE_LIMIT, REPORT_TABLES, tableLabel } from './reportTables';
import type { CapturedChart } from './ReportRenderer';
import type { BlockScope, ResolvedReport } from './resolveReport';

export const periodLabel = (s: BlockScope): string =>
  s.range.start === s.range.end ? String(s.range.start) : `${s.range.start} – ${s.range.end}`;

export const perimetreLabel = (p: BlockScope['perimetre']): string =>
  p === 'effectifs' ? i18n._(msg`Headcount`) : i18n._(msg`Affiliation`);

/** Human-readable filters of a scope (free-text search included). */
export function filtersLabel(scope: BlockScope, dataset: DashboardDataset | null | undefined): string {
  const chips = dataset ? describeFilters(scope.filters, buildFilterContext(dataset)).map((c) => c.label) : [];
  if (scope.filters.q?.trim()) chips.unshift(`“${scope.filters.q.trim()}”`);
  return chips.join(' · ');
}

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'rapport';

export interface ComposeInput {
  definition: ReportDefinition;
  resolved: ResolvedReport;
  /** Unfiltered dataset of each structure (labels of the structure and of the filters). */
  datasets: Record<string, DashboardDataset | null | undefined>;
  /** Captures keyed by block id. */
  captures: Map<string, CapturedChart>;
}

/** Composes and downloads the PDF; returns the file name. */
export async function composeReportPdf({ definition, resolved, datasets, captures }: ComposeInput): Promise<string> {
  const fonts = await loadReportFonts();
  const pdf = new ReportPdf(fonts);
  const scope = resolved.scope;
  const main = datasets[scope.slug];
  const structureLabel = (slug: string) => {
    const d = datasets[slug];
    return d ? (d.name && d.name !== d.lab ? `${d.lab} — ${d.name}` : d.lab) : slug;
  };

  const rows: [string, string][] = [
    [i18n._(msg`Structure`), structureLabel(scope.slug)],
    [i18n._(msg`Period`), periodLabel(scope)],
    [i18n._(msg({ message: `Scope`, context: "perimeter" })), perimetreLabel(scope.perimetre)],
  ];
  const filters = filtersLabel(scope, main);
  if (filters) rows.push([i18n._(msg`Filters`), filters]);
  if (resolved.publicationCount != null) {
    rows.push([i18n._(msg`Publications`), resolved.publicationCount.toLocaleString(numberLocale())]);
  }
  pdf.reportCover({
    title: definition.name,
    description: definition.description || undefined,
    rows,
    generatedAt: new Date(),
    sourceLine: i18n._(msg`Source: Druid / druid-biblio (OpenAlex, French Open Science Monitor). Document generated automatically from the bibliometric dashboard — the “interactive version” links open each chart with the same filters.`),
  });

  pdf.sectionTitle(i18n._(msg`Methodological note`));
  for (const para of methodologyNote()) pdf.paragraph(para);

  for (const rb of resolved.blocks) {
    const b = rb.block;
    if (b.hidden) continue;
    if (b.kind === 'section') pdf.sectionTitle(b.title);
    else if (b.kind === 'text') pdf.markdown(b.markdown);
    else if (b.kind === 'kpis' && rb.dataset && rb.scope) {
      const set = KPI_SETS[b.setId];
      if (set) {
        pdf.kpiGrid(i18n._(set.label), set.items(rb.dataset, rb.scope.range, { source: rb.source, filters: rb.scope.filters }));
      }
    } else if (b.kind === 'table' && rb.dataset && rb.scope) {
      const table = REPORT_TABLES[b.tableId];
      if (!table) continue;
      const tr = table.build(rb.dataset, rb.scope.range, b.limit ?? DEFAULT_TABLE_LIMIT);
      pdf.simpleTable(
        tableLabel(b.tableId),
        tr.columns.map((c) => i18n._(c.label)),
        tr.columns.map((c) => c.width),
        tr.rows,
        {
          links: tr.links,
          linkColumn: 1,
          note: tr.omitted ? i18n._(msg`${tr.omitted} more rows not printed (limit of the block).`) : undefined,
        },
      );
    } else if (b.kind === 'chart' && rb.scope) {
      const cap = captures.get(b.id);
      if (!cap) continue;
      const s = rb.scope;
      const doc = chartDoc(b.chartId);
      // A block departing from the report context says where its figures come from.
      const context = s.overridden
        ? [s.slug !== scope.slug ? structureLabel(s.slug) : null, periodLabel(s), perimetreLabel(s.perimetre), filtersLabel(s, datasets[s.slug])]
          .filter(Boolean).join(' · ')
        : undefined;
      const publicLink = EMBEDDABLE_IDS.has(b.chartId) && !PUBLIC_FORBIDDEN_FILTERS.some((k) => s.filters[k] != null);
      pdf.chartBlock({
        title: b.title?.trim() || cap.title,
        subtitle: cap.subtitle,
        png: cap.png,
        pxWidth: cap.pxWidth,
        pxHeight: cap.pxHeight,
        description: doc?.description,
        method: doc?.methode,
        caveats: doc?.limites,
        context,
        note: b.note?.trim() || undefined,
        link: publicLink
          ? buildEmbedUrl({ slug: s.slug, range: s.range, perimetre: s.perimetre }, b.chartId, { filters: s.filters, params: rb.params })
          : undefined,
      });
    }
  }

  pdf.finalize(`${definition.name} · ${periodLabel(scope)}`, definition.footerNote?.trim() || undefined);
  const filename = `rapport_${slugify(definition.name)}_${scope.range.start}-${scope.range.end}.pdf`;
  pdf.save(filename);
  return filename;
}
