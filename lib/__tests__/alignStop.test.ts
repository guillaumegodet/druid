import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Own test file: the stop flag of align_common.cjs is module state (one module instance per file).
const common = createRequire(import.meta.url)('../../scripts/lib/align_common.cjs');

const tmpStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'align-stop-'));
  return { dir, store: common.makeStore({ cachePath: path.join(dir, 'c.json'), progressPath: path.join(dir, 'p.json') }) };
};
const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

afterEach(() => { vi.useRealTimers(); });

describe('scripts/lib/align_common.cjs — « Stop » button and saves along the way', () => {
  it('the cache is saved during the run, at most every 30 s, through the progress writes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    const { dir, store } = tmpStore();
    const cache = store.loadCache();
    cache.a = { status: 'found' };
    store.writeProgress({ running: true, done: 1, total: 3 });
    expect(fs.existsSync(path.join(dir, 'c.json'))).toBe(false);   // < 30 s since the start
    vi.setSystemTime(new Date('2026-09-30T10:00:31Z'));
    cache.b = { status: 'not_found' };
    store.writeProgress({ running: true, done: 2, total: 3 });
    expect(Object.keys(readJson(path.join(dir, 'c.json')))).toEqual(['a', 'b']);
    expect(readJson(path.join(dir, 'p.json'))).toEqual({ running: true, done: 2, total: 3 });
  });

  it('runPool: only a stoppable pool stops starting items; the final progress says `stopped`', async () => {
    const { dir, store } = tmpStore();
    const seen: number[] = [];
    const worker = async (i: number) => { seen.push(i); if (i === 1) common.requestStop(); };
    await common.runPool([0, 1, 2, 3, 4], worker, 1, undefined, { stoppable: true });
    expect(seen).toEqual([0, 1]);
    expect(common.isStopRequested()).toBe(true);
    // Later phases (Grist writes of the processed records) are plain pools: they run in full.
    const after: number[] = [];
    await common.runPool([0, 1, 2], async (i: number) => { after.push(i); }, 2);
    expect(after.sort()).toEqual([0, 1, 2]);
    store.writeProgress({ running: false, done: 2, total: 5 });
    expect(readJson(path.join(dir, 'p.json'))).toEqual({ running: false, done: 2, total: 5, stopped: true });
  });
});
