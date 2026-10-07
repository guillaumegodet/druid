// Composition of the PDF report from the ReportRenderer captures: cover
// page, global methodological note, sections (one per tab), one block per
// chart with its description, its method/caveats notes (chartDocs) and its
// interactive /embed link.

import { buildEmbedUrl, ShareScope } from '../EChartCard';
import { EMBEDDABLE_IDS } from '../embedIds';
import { chartDoc, methodologyNote } from './chartDocs';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { loadReportFonts } from './fonts';
import { ReportPdf } from './pdfDoc';
import { CapturedChart } from './ReportRenderer';

export interface ReportMeta {
  /** Acronym of the structure (dataset.lab). */
  lab: string;
  /** Full name (dataset.name). */
  name: string;
  /** Current scope + period — cover page and /embed links. */
  scope: ShareScope;
  scopeLabel: string;
  /** Corpus publications within the period (after scoping). */
  publicationCount: number;
}

export interface ReportSectionContent {
  title: string;
  charts: CapturedChart[];
}

export async function generateReportPdf(
  sections: ReportSectionContent[],
  meta: ReportMeta,
): Promise<void> {
  const fonts = await loadReportFonts();
  const pdf = new ReportPdf(fonts);
  const { start, end } = meta.scope.range;
  const periodLabel = start === end ? String(start) : `${start} – ${end}`;

  pdf.cover({
    lab: meta.lab,
    name: meta.name,
    periodLabel,
    scopeLabel: meta.scopeLabel,
    publicationCount: meta.publicationCount,
    generatedAt: new Date(),
    sourceLine:
      i18n._(msg`Source: Druid / druid-biblio (CRISalid, OpenAlex, HAL, French Open Science Monitor). Document generated automatically from the bibliometric dashboard — the “interactive version” links open each chart with the same filters.`),
  });

  pdf.sectionTitle(i18n._(msg`Methodological note`));
  for (const para of methodologyNote()) pdf.paragraph(para);

  for (const section of sections) {
    if (!section.charts.length) continue;
    pdf.sectionTitle(section.title);
    for (const c of section.charts) {
      const doc = chartDoc(c.id);
      pdf.chartBlock({
        title: c.title,
        subtitle: c.subtitle,
        png: c.png,
        pxWidth: c.pxWidth,
        pxHeight: c.pxHeight,
        description: doc?.description,
        method: doc?.methode,
        caveats: doc?.limites,
        link: EMBEDDABLE_IDS.has(c.id) ? buildEmbedUrl(meta.scope, c.id) : undefined,
      });
    }
  }

  pdf.finalize(`${meta.lab} · ${periodLabel} · ${i18n._(msg`scope`)} ${meta.scopeLabel.toLowerCase()}`);
  pdf.save(`rapport_${meta.scope.slug}_${start}-${end}.pdf`);
}
