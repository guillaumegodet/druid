import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Storage of the career path (scripts/lib/affiliation_history_store.cjs, docs/plan-parcours-affiliations.md lot 2).
const S = createRequire(import.meta.url)('../../scripts/lib/affiliation_history_store.cjs');
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

describe('affiliation_history_store', () => {
  it('accepts uid_dyna / ext_ / g<rowId> keys, rejects paths and empty keys', () => {
    for (const k of ['martin-p', 'ext_moreau-p', 'g123', 'petit.j']) expect(S.isValidKey(k)).toBe(true);
    for (const k of ['', '../etc/passwd', '_index', 'a/b', 'x'.repeat(101)]) expect(S.isValidKey(k)).toBe(false);
  });
  it('entry files never collide with the underscore files and escape odd characters', () => {
    expect(path.basename(S.entryFile('/d', 'martin-p'))).toBe('p-martin-p.json');
    expect(path.basename(S.entryFile('/d', 'a b'))).toBe('p-a~20b.json');
  });
  it('mergeIndex keeps the keys written meanwhile by another run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-'));
    S.writeJsonAtomic(S.indexFile(dir), { a: { v: 1 }, b: { v: 1 } });
    S.mergeIndex(dir, { b: { v: 2 }, c: { v: 2 } });
    expect(S.readJson(S.indexFile(dir), null)).toEqual({ a: { v: 1 }, b: { v: 2 }, c: { v: 2 } });
    S.writeJsonAtomic(S.entryFile(dir, 'a'), { ok: true });
    expect(S.readEntry(dir, 'a')).toEqual({ ok: true });
    expect(S.readEntry(dir, '../a')).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });
  it('refresh: institution scope, or a lab right on the record lab', () => {
    expect(S.canRefresh({ allSlugs: true }, [], norm)).toBe(true);
    expect(S.canRefresh({ labAnchors: ['LABA'] }, ['Lab-A'], norm)).toBe(true);
    expect(S.canRefresh({ labAnchors: ['LABA'] }, ['LAB-B'], norm)).toBe(false);
    expect(S.canRefresh({ labAnchors: [] }, ['LAB-A'], norm)).toBe(false);
  });
});
