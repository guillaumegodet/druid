import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvCell, saveCsv } from '../download';

describe('csvCell', () => {
  it('leaves plain values as they are', () => {
    expect(csvCell('Nantes')).toBe('Nantes');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(0)).toBe('0');
  });

  it('turns null and undefined into an empty cell', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes cells holding a comma, a double quote or a line break', () => {
    expect(csvCell('Dupont, Martin')).toBe('"Dupont, Martin"');
    expect(csvCell('the "best" journal')).toBe('"the ""best"" journal"');
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
  });

  it('does not quote semicolons (comma-separated files)', () => {
    expect(csvCell('a;b')).toBe('a;b');
  });
});

describe('saveCsv', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Captures the blob and the file name of the download, without a DOM. */
  const capture = () => {
    const out: { blob?: Blob; fileName?: string; clicked: boolean } = { clicked: false };
    const anchor = { href: '', download: '', click: () => { out.clicked = true; out.fileName = anchor.download; }, remove: () => {} };
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: () => {} } });
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { out.blob = b; return 'blob:x'; }, revokeObjectURL: () => {} });
    vi.stubGlobal('window', { setTimeout: () => 0 });
    return out;
  };

  it('writes the header then the lines, separated by \\n, without a BOM by default', async () => {
    const out = capture();
    saveCsv('list.csv', 'a,b', ['1,2', '3,"x, y"']);
    expect(out.clicked).toBe(true);
    expect(out.fileName).toBe('list.csv');
    expect(out.blob!.type).toBe('text/csv;charset=utf-8');
    expect(await out.blob!.text()).toBe('a,b\n1,2\n3,"x, y"');
  });

  it('prefixes a UTF-8 BOM on request', async () => {
    const out = capture();
    saveCsv('list.csv', 'a', ['é'], { bom: true });
    const bytes = new Uint8Array(await out.blob!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
