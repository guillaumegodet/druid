// Layout engine of the PDF reports (jsPDF): vertical A4 flow with page
// break handling, cover page, sections, chart blocks (title + image +
// interactive link) and paginated footers. Typography and ink colors aligned
// with the 2026 redesign brand guidelines (Helvetica fallback when the TTFs
// in public/fonts/ are unavailable).

import { jsPDF } from 'jspdf';
import { FontData, registerReportFonts } from './fonts';
import { numberLocale } from '../../../lib/i18n';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - 2 * MARGIN;
/** Lower bound of the flow (reserves the footer). */
const BOTTOM = PAGE_H - 20;

const INK: RGB = [28, 27, 25]; // #1c1b19
const INK_SECONDARY: RGB = [111, 106, 94]; // #6f6a5e
const INK_MUTED: RGB = [140, 134, 119]; // #8c8677
const ACCENT: RGB = [244, 210, 74]; // #f4d24a
const RULE: RGB = [231, 227, 216]; // #e7e3d8
const CREAM: RGB = [244, 240, 230]; // #f4f0e6

type RGB = [number, number, number];

/** Line height (mm) for a given font size (pt). */
const lh = (pt: number, ratio = 1.4) => (pt * 25.4 / 72) * ratio;

export interface CoverMeta {
  /** Acronym of the structure (dataset.lab). */
  lab: string;
  /** Full name (dataset.name). */
  name: string;
  periodLabel: string;
  scopeLabel: string;
  publicationCount: number;
  generatedAt: Date;
  sourceLine: string;
}

export class ReportPdf {
  readonly doc: jsPDF;
  private y = MARGIN;
  private readonly custom: boolean;

  constructor(fonts: FontData[] | null) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    this.custom = fonts != null;
    if (fonts) registerReportFonts(this.doc, fonts);
  }

  /** Selects font + size + ink color. */
  private text(kind: 'disp' | 'body' | 'semi', pt: number, color: RGB) {
    const d = this.doc;
    if (this.custom) {
      d.setFont(
        kind === 'disp' ? 'SchibstedGrotesk' : kind === 'semi' ? 'HankenGroteskSemiBold' : 'HankenGrotesk',
        'normal',
      );
    } else {
      d.setFont('helvetica', kind === 'body' ? 'normal' : 'bold');
    }
    d.setFontSize(pt);
    d.setTextColor(...color);
  }

  private ensureSpace(h: number) {
    if (this.y + h > BOTTOM) {
      this.doc.addPage();
      this.y = MARGIN + 4;
    }
  }

  /** Cover page (must be called first). */
  cover(meta: CoverMeta) {
    const d = this.doc;
    d.setFillColor(...CREAM);
    d.rect(0, 0, PAGE_W, PAGE_H, 'F');
    d.setFillColor(...ACCENT);
    d.rect(0, 0, PAGE_W, 5, 'F');

    let y = 72;
    this.text('semi', 11, INK_SECONDARY);
    d.text(i18n._(msg`BIBLIOMETRIC REPORT`).toUpperCase(), MARGIN, y, { charSpace: 0.6 });

    y += 16;
    this.text('disp', 30, INK);
    const labLines = d.splitTextToSize(meta.lab, CONTENT_W) as string[];
    d.text(labLines, MARGIN, y);
    y += labLines.length * lh(30, 1.15);

    if (meta.name && meta.name !== meta.lab) {
      y += 2;
      this.text('body', 13, INK_SECONDARY);
      const nameLines = d.splitTextToSize(meta.name, CONTENT_W) as string[];
      d.text(nameLines, MARGIN, y);
      y += nameLines.length * lh(13);
    }

    y += 10;
    d.setDrawColor(...ACCENT);
    d.setLineWidth(1.2);
    d.line(MARGIN, y, MARGIN + 26, y);

    y += 14;
    const rows: [string, string][] = [
      [i18n._(msg`Period`), meta.periodLabel],
      [i18n._(msg({ message: `Scope`, context: "perimeter" })), meta.scopeLabel],
      [i18n._(msg`Publications`), meta.publicationCount.toLocaleString(numberLocale())],
      [
        i18n._(msg`Generated on`),
        meta.generatedAt.toLocaleDateString(numberLocale(), { day: 'numeric', month: 'long', year: 'numeric' }),
      ],
    ];
    for (const [label, value] of rows) {
      this.text('semi', 10.5, INK_MUTED);
      d.text(label, MARGIN, y);
      this.text('body', 10.5, INK);
      d.text(value, MARGIN + 34, y);
      y += lh(10.5, 1.7);
    }

    this.text('body', 8.5, INK_MUTED);
    const src = d.splitTextToSize(meta.sourceLine, CONTENT_W) as string[];
    d.text(src, MARGIN, PAGE_H - 22);

    d.addPage();
    this.y = MARGIN + 4;
  }

  /** Section title (= tab). Keeps ~55 mm together with the following content. */
  sectionTitle(title: string) {
    this.ensureSpace(14 + 55);
    const d = this.doc;
    this.y += 4;
    d.setFillColor(...ACCENT);
    d.rect(MARGIN, this.y - 4.6, 2.4, 6, 'F');
    this.text('disp', 17, INK);
    d.text(title, MARGIN + 6, this.y);
    this.y += 10;
  }

  /** Body paragraph (methodological note, explanations). */
  paragraph(text: string, opts: { size?: number; color?: RGB } = {}) {
    const d = this.doc;
    const size = opts.size ?? 9.5;
    this.text('body', size, opts.color ?? INK_SECONDARY);
    const lines = d.splitTextToSize(text, CONTENT_W) as string[];
    for (const line of lines) {
      this.ensureSpace(lh(size));
      d.text(line, MARGIN, this.y);
      this.y += lh(size);
    }
    this.y += 2.5;
  }

  /**
   * Unbreakable chart block: title, subtitle, editorial description,
   * image, method/caveats notes (chartDocs) and interactive link.
   */
  chartBlock(block: {
    title: string;
    subtitle?: string;
    png: string;
    pxWidth: number;
    pxHeight: number;
    /** Reading text (chartDocs.description), printed before the image. */
    description?: string;
    /** Computation method (chartDocs.methode), printed below the image. */
    method?: string;
    /** Reading caveats (chartDocs.limites). */
    caveats?: string;
    /** /embed URL of the interactive version (printed below the chart). */
    link?: string;
  }) {
    const d = this.doc;

    this.text('semi', 12, INK);
    const titleLines = d.splitTextToSize(block.title, CONTENT_W) as string[];
    let subLines: string[] = [];
    if (block.subtitle) {
      this.text('body', 8.5, INK_SECONDARY);
      subLines = d.splitTextToSize(block.subtitle, CONTENT_W) as string[];
    }
    let descLines: string[] = [];
    if (block.description) {
      this.text('body', 9.5, INK_SECONDARY);
      descLines = d.splitTextToSize(block.description, CONTENT_W) as string[];
    }
    // Notes below the image: « Méthode — … » then « Limites — … » in small type.
    const notes: string[][] = [];
    this.text('body', 8, INK_MUTED);
    if (block.method) notes.push(d.splitTextToSize(`${i18n._(msg`Method`)} — ${block.method}`, CONTENT_W) as string[]);
    if (block.caveats) notes.push(d.splitTextToSize(`${i18n._(msg`Limitations`)} — ${block.caveats}`, CONTENT_W) as string[]);

    const titleH =
      titleLines.length * lh(12, 1.25) + (subLines.length ? subLines.length * lh(8.5, 1.3) + 1 : 0);
    const descH = descLines.length ? descLines.length * lh(9.5, 1.35) + 1.5 : 0;
    const notesH = notes.reduce((h, ls) => h + ls.length * lh(8, 1.3) + 1.2, 0);
    const linkH = block.link ? lh(7.5) + 1.5 : 0;

    let imgW = CONTENT_W;
    let imgH = CONTENT_W * (block.pxHeight / block.pxWidth);
    // The image is shrunk so that the whole block (texts included) fits on
    // one page — otherwise N-bar rankings would overflow below the footer.
    // 20 mm floor: a block with a lot of text (title/description/method/caveats)
    // can, with long enough text, leave a negative budget — imgW/imgH would become negative
    // and jsPDF would crash or render a corrupted image (review lot 10). The block may then
    // slightly overflow the page rather than breaking the rendering.
    const maxImgH = Math.max(20, BOTTOM - (MARGIN + 4) - titleH - descH - notesH - linkH - 12);
    if (imgH > maxImgH) {
      imgW = imgW * (maxImgH / imgH);
      imgH = maxImgH;
    }
    this.ensureSpace(titleH + descH + 2.5 + imgH + notesH + linkH + 8);

    this.text('semi', 12, INK);
    d.text(titleLines, MARGIN, this.y);
    this.y += titleLines.length * lh(12, 1.25);
    if (subLines.length) {
      this.text('body', 8.5, INK_SECONDARY);
      d.text(subLines, MARGIN, this.y);
      this.y += subLines.length * lh(8.5, 1.3) + 1;
    }
    if (descLines.length) {
      this.text('body', 9.5, INK_SECONDARY);
      d.text(descLines, MARGIN, this.y);
      this.y += descLines.length * lh(9.5, 1.35) + 1.5;
    }

    this.y += 1.5;
    const imgX = MARGIN + (CONTENT_W - imgW) / 2;
    d.setDrawColor(...RULE);
    d.setLineWidth(0.25);
    d.roundedRect(imgX - 1, this.y - 1, imgW + 2, imgH + 2, 1.5, 1.5, 'S');
    d.addImage(block.png, 'PNG', imgX, this.y, imgW, imgH, undefined, 'FAST');
    this.y += imgH + 2;

    for (const ls of notes) {
      this.y += 1.2;
      this.text('body', 8, INK_MUTED);
      d.text(ls, MARGIN, this.y);
      this.y += ls.length * lh(8, 1.3);
    }

    if (block.link) {
      this.y += 1.5;
      this.text('body', 7.5, INK_MUTED);
      d.textWithLink(`${i18n._(msg`Interactive version`)} : ${block.link}`, MARGIN, this.y, { url: block.link });
      this.y += lh(7.5);
    }
    this.y += 6;
  }

  /** Footers (content pages only) — to be called before save(). */
  finalize(footerLeft: string) {
    const d = this.doc;
    const total = d.getNumberOfPages();
    for (let i = 2; i <= total; i++) {
      d.setPage(i);
      d.setDrawColor(...RULE);
      d.setLineWidth(0.25);
      d.line(MARGIN, PAGE_H - 13, PAGE_W - MARGIN, PAGE_H - 13);
      this.text('body', 8, INK_MUTED);
      d.text(footerLeft, MARGIN, PAGE_H - 8.5);
      d.text(i18n._(msg`Page ${i - 1} / ${total - 1}`), PAGE_W - MARGIN, PAGE_H - 8.5, { align: 'right' });
    }
  }

  save(filename: string) {
    this.doc.save(filename);
  }
}
