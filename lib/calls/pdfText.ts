// Text of a PDF, one line per line of text, for the texts of calls published as PDF (the generic call of the ANR,
// lib/calls/anr.ts parseAapgAxes). pdf.js through unpdf (no system dependency), loaded on demand: server side only.

/** Lines of the text of a PDF, pages separated by a form feed. */
export async function pdfToText(data: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import('unpdf');
  // verbosity 0: errors only (the fonts of the ANR texts make pdf.js warn on every page).
  const pdf = await getDocumentProxy(data, { verbosity: 0 });
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    lines.push('\f');
  }
  await pdf.cleanup();
  return lines.join('\n');
}
