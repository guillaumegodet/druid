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
import { parseMarkdownLite, plainText } from './markdownLite';

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

/** Cover of a saved report (« Mes rapports »): its own name and description, free rows. */
export interface ReportCoverMeta {
  title: string;
  description?: string;
  rows: [string, string][];
  generatedAt: Date;
  sourceLine: string;
}

export interface KpiCell {
  label: string;
  value: string;
  hint?: string;
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

  /** Cover page of a saved report (must be called first). */
  reportCover(meta: ReportCoverMeta) {
    const d = this.doc;
    d.setFillColor(...CREAM);
    d.rect(0, 0, PAGE_W, PAGE_H, 'F');
    d.setFillColor(...ACCENT);
    d.rect(0, 0, PAGE_W, 5, 'F');

    let y = 64;
    this.text('semi', 11, INK_SECONDARY);
    d.text(i18n._(msg`BIBLIOMETRIC REPORT`).toUpperCase(), MARGIN, y, { charSpace: 0.6 });

    y += 15;
    this.text('disp', 26, INK);
    const titleLines = d.splitTextToSize(meta.title, CONTENT_W) as string[];
    d.text(titleLines, MARGIN, y);
    y += titleLines.length * lh(26, 1.15);

    if (meta.description) {
      y += 2;
      this.text('body', 11.5, INK_SECONDARY);
      const lines = (d.splitTextToSize(meta.description, CONTENT_W) as string[]).slice(0, 8);
      d.text(lines, MARGIN, y);
      y += lines.length * lh(11.5);
    }

    y += 8;
    d.setDrawColor(...ACCENT);
    d.setLineWidth(1.2);
    d.line(MARGIN, y, MARGIN + 26, y);

    y += 13;
    const rows: [string, string][] = [
      ...meta.rows,
      [
        i18n._(msg`Generated on`),
        meta.generatedAt.toLocaleDateString(numberLocale(), { day: 'numeric', month: 'long', year: 'numeric' }),
      ],
    ];
    for (const [label, value] of rows) {
      this.text('semi', 10.5, INK_MUTED);
      d.text(label, MARGIN, y);
      this.text('body', 10.5, INK);
      const lines = (d.splitTextToSize(value, CONTENT_W - 38) as string[]).slice(0, 4);
      d.text(lines, MARGIN + 38, y);
      y += Math.max(1, lines.length) * lh(10.5, 1.35) + lh(10.5, 0.4);
    }

    this.text('body', 8.5, INK_MUTED);
    const src = d.splitTextToSize(meta.sourceLine, CONTENT_W) as string[];
    d.text(src, MARGIN, PAGE_H - 22);

    d.addPage();
    this.y = MARGIN + 4;
  }

  /** Grid of key figures (4 per row): label, value, hint. */
  kpiGrid(title: string, cells: KpiCell[]) {
    const d = this.doc;
    const cols = 4;
    const gap = 3;
    const w = (CONTENT_W - gap * (cols - 1)) / cols;
    const h = 21;
    const rows = Math.ceil(cells.length / cols);
    this.ensureSpace(lh(12, 1.25) + 3 + Math.min(rows, 2) * (h + gap));
    this.text('semi', 12, INK);
    d.text(title, MARGIN, this.y);
    this.y += lh(12, 1.25) + 1;
    for (let r = 0; r < rows; r++) {
      this.ensureSpace(h + gap);
      cells.slice(r * cols, r * cols + cols).forEach((c, i) => {
        const x = MARGIN + i * (w + gap);
        d.setFillColor(...CREAM);
        d.roundedRect(x, this.y, w, h, 1.5, 1.5, 'F');
        this.text('semi', 7, INK_MUTED);
        d.text((d.splitTextToSize(c.label.toUpperCase(), w - 5) as string[]).slice(0, 2), x + 2.5, this.y + 4.5);
        this.text('disp', 15, INK);
        d.text(c.value, x + 2.5, this.y + 14);
        if (c.hint) {
          this.text('body', 7, INK_SECONDARY);
          d.text((d.splitTextToSize(c.hint, w - 5) as string[])[0], x + 2.5, this.y + 18.5);
        }
      });
      this.y += h + gap;
    }
    this.y += 4;
  }

  /** Text block in the Markdown subset of markdownLite.ts (inline marks flattened). */
  markdown(md: string) {
    const d = this.doc;
    for (const node of parseMarkdownLite(md)) {
      if (node.kind === 'heading') {
        const size = node.level === 1 ? 13 : 11.5;
        this.ensureSpace(lh(size) + 8);
        this.y += 1.5;
        this.text('semi', size, INK);
        for (const line of d.splitTextToSize(plainText(node.inline), CONTENT_W) as string[]) {
          d.text(line, MARGIN, this.y);
          this.y += lh(size, 1.3);
        }
        this.y += 0.8;
      } else if (node.kind === 'bullets') {
        this.text('body', 9.5, INK_SECONDARY);
        for (const item of node.items) {
          const lines = d.splitTextToSize(plainText(item), CONTENT_W - 5) as string[];
          lines.forEach((line, i) => {
            this.ensureSpace(lh(9.5));
            if (i === 0) d.text('•', MARGIN + 1, this.y);
            d.text(line, MARGIN + 5, this.y);
            this.y += lh(9.5);
          });
        }
        this.y += 2;
      } else {
        this.paragraph(plainText(node.inline));
      }
    }
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
    /** Scope of a block departing from the report context (structure, period, filters). */
    context?: string;
    /** Author's note, printed below the image. */
    note?: string;
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

    let contextLines: string[] = [];
    if (block.context) {
      this.text('semi', 8, INK_MUTED);
      contextLines = d.splitTextToSize(block.context, CONTENT_W) as string[];
    }
    let noteLines: string[] = [];
    if (block.note) {
      this.text('body', 9.5, INK);
      noteLines = d.splitTextToSize(block.note, CONTENT_W) as string[];
    }
    const titleH =
      titleLines.length * lh(12, 1.25) + (subLines.length ? subLines.length * lh(8.5, 1.3) + 1 : 0) +
      (contextLines.length ? contextLines.length * lh(8, 1.3) + 1 : 0);
    const noteH = noteLines.length ? noteLines.length * lh(9.5, 1.35) + 2 : 0;
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
    const maxImgH = Math.max(20, BOTTOM - (MARGIN + 4) - titleH - descH - notesH - noteH - linkH - 12);
    if (imgH > maxImgH) {
      imgW = imgW * (maxImgH / imgH);
      imgH = maxImgH;
    }
    this.ensureSpace(titleH + descH + 2.5 + imgH + noteH + notesH + linkH + 8);

    this.text('semi', 12, INK);
    d.text(titleLines, MARGIN, this.y);
    this.y += titleLines.length * lh(12, 1.25);
    if (subLines.length) {
      this.text('body', 8.5, INK_SECONDARY);
      d.text(subLines, MARGIN, this.y);
      this.y += subLines.length * lh(8.5, 1.3) + 1;
    }
    if (contextLines.length) {
      this.text('semi', 8, INK_MUTED);
      d.text(contextLines, MARGIN, this.y);
      this.y += contextLines.length * lh(8, 1.3) + 1;
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

    if (noteLines.length) {
      this.y += 2;
      this.text('body', 9.5, INK);
      d.text(noteLines, MARGIN, this.y);
      this.y += noteLines.length * lh(9.5, 1.35);
    }

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
