// The small Markdown subset of report text blocks, shared by the editor preview and the PDF:
// `#` / `##` headings, `-` / `*` bullets, paragraphs separated by a blank line, and inline
// `**bold**`, `*italic*`, `[label](url)` — inline marks are flattened into plain runs (jsPDF has
// no rich text; the preview renders the same runs).

export type MdInline = { text: string; bold?: boolean; italic?: boolean; url?: string };
export type MdNode =
  | { kind: 'heading'; level: 1 | 2; inline: MdInline[] }
  | { kind: 'bullets'; items: MdInline[][] }
  | { kind: 'paragraph'; inline: MdInline[] };

const INLINE_RE = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] != null) out.push({ text: m[1], bold: true });
    else if (m[2] != null) out.push({ text: m[2], italic: true });
    else out.push({ text: m[3], url: m[4] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((r) => r.text !== '');
}

export function parseMarkdownLite(md: string): MdNode[] {
  const nodes: MdNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  const flushPara = () => {
    if (para.length) nodes.push({ kind: 'paragraph', inline: parseInline(para.join(' ')) });
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length) nodes.push({ kind: 'bullets', items: bullets.map(parseInline) });
    bullets = [];
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushBullets();
    } else if (heading) {
      flushPara();
      flushBullets();
      nodes.push({ kind: 'heading', level: heading[1].length === 1 ? 1 : 2, inline: parseInline(heading[2]) });
    } else if (bullet) {
      flushPara();
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return nodes;
}

/** Plain text of inline runs (links as « label (url) », for the PDF). */
export const plainText = (inline: MdInline[]): string =>
  inline.map((r) => (r.url && r.url !== r.text ? `${r.text} (${r.url})` : r.text)).join('');
