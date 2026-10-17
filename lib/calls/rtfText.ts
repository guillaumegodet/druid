// Text of an RTF document (the exports of ResearchConnect, lib/calls/researchConnect.ts): paragraphs and table cells
// kept as line breaks and tabs, the destinations that hold no text (fonts, styles, pictures, fields, metadata) skipped.
// Pure, run in the browser: the export (images included, ≈ 1.5 MB) never goes to the server.

/** Destinations whose content is not text of the document. */
const SKIPPED = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata', 'colorschememapping', 'latentstyles', 'datastore',
  'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'mmathPr', 'header', 'footer', 'headerl', 'headerr',
  'headerf', 'footerl', 'footerr', 'footerf', 'fldinst', 'pgdsctbl', 'revtbl', 'filetbl', 'shppict', 'nonshppict', 'bkmkstart', 'bkmkend',
]);

/** Windows-1252 characters of 0x80-0x9f (the rest of the code page is Latin-1). */
const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ',
  0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};
const cp1252 = (byte: number): string => CP1252[byte] ?? String.fromCharCode(byte);

const TOKEN = /\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z'])|([{}])|([^\\{}\r\n]+)|[\r\n]+/g;

export const rtfToText = (rtf: string): string => {
  const out: string[] = [];
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  // Fallback characters still to drop after a \uN (\ucN of them, ANSI text or \'hh).
  let pending = 0;
  for (const m of rtf.matchAll(TOKEN)) {
    const [, word, arg, hex, symbol, brace] = m;
    let text = m[6];
    if (brace === '{') { stack.push({ skip, uc }); continue; }
    if (brace === '}') { ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 }); pending = 0; continue; }
    if (pending > 0 && (text || hex)) {
      if (hex) { pending--; continue; }
      const k = Math.min(pending, text!.length);
      text = text!.slice(k);
      pending -= k;
    }
    if (skip) continue;
    if (word) {
      if (SKIPPED.has(word)) skip = true;
      else if (word === 'uc') uc = Number(arg ?? 1);
      else if (word === 'u') { out.push(String.fromCharCode(((Number(arg) % 65536) + 65536) % 65536)); pending = uc; }
      else if (word === 'par' || word === 'line' || word === 'row' || word === 'sect' || word === 'page') out.push('\n');
      else if (word === 'tab' || word === 'cell') out.push('\t');
      else if (word === 'bullet') out.push('•');
      continue;
    }
    if (symbol) {
      if (symbol === '*') skip = true; // unknown destination: no text
      else if (symbol === '\\' || symbol === '{' || symbol === '}') out.push(symbol);
      else if (symbol === '~') out.push(' ');
      else if (symbol === '-' || symbol === '_') out.push(symbol === '_' ? '-' : '');
      continue;
    }
    if (hex) { out.push(cp1252(parseInt(hex, 16))); continue; }
    if (text) out.push(text);
  }
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};
