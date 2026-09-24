// Brand-guideline fonts (Schibsted Grotesk for headings, Hanken Grotesk for
// body text) embedded in the jsPDF PDFs. The static TTFs are self-hosted in
// public/fonts/; loaded once then cached (base64). On failure (missing file),
// the report falls back to Helvetica.

import { jsPDF } from 'jspdf';

export interface FontData {
  /** Virtual file name in the jsPDF VFS. */
  file: string;
  /** Family exposed to setFont(). */
  name: string;
  b64: string;
}

const FONT_FILES: { file: string; name: string }[] = [
  { file: 'SchibstedGrotesk-Bold.ttf', name: 'SchibstedGrotesk' },
  { file: 'HankenGrotesk-Regular.ttf', name: 'HankenGrotesk' },
  { file: 'HankenGrotesk-SemiBold.ttf', name: 'HankenGroteskSemiBold' },
];

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

let cached: Promise<FontData[] | null> | null = null;

export function loadReportFonts(): Promise<FontData[] | null> {
  cached ??= Promise.all(
    FONT_FILES.map(async ({ file, name }) => ({
      file,
      name,
      b64: await fetchAsBase64(`/fonts/${file}`),
    })),
  ).catch((e) => {
    console.warn('Report fonts unavailable, falling back to Helvetica', e);
    // Do not memoize the failure: a transient miss (FortiGate proxy, cf. docker/CLAUDE.md)
    // must not doom every report to Helvetica for the rest of the session — the next
    // call will retry the fetch (review lot 10).
    cached = null;
    return null;
  });
  return cached;
}

/** Registers the fonts in a jsPDF instance (one VFS per document). */
export function registerReportFonts(doc: jsPDF, fonts: FontData[]): void {
  for (const f of fonts) {
    doc.addFileToVFS(f.file, f.b64);
    doc.addFont(f.file, f.name, 'normal');
  }
}
