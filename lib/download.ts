// File downloads triggered from the browser: the generic blob download and the CSV exports of the dashboard tabs.

/** Quotes a CSV cell (RFC 4180) when it holds a comma, a double quote or a line break. */
export const csvCell = (v: string | number | null | undefined): string => {
  const s = (v ?? '').toString();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

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

/**
 * Downloads a comma-separated file: a header line then data lines already joined (cells through `csvCell`), separated
 * by `\n`. `bom` prefixes a UTF-8 byte order mark, so that Excel reads the accents.
 */
export function saveCsv(fileName: string, header: string, lines: string[], { bom = false } = {}): void {
  const parts = [[header, ...lines].join('\n')];
  if (bom) parts.unshift('\ufeff');
  downloadBlob(new Blob(parts, { type: 'text/csv;charset=utf-8' }), fileName);
}
