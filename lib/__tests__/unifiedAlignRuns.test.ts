import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runUnifiedAlign } from '../unifiedAlignRuns';

// pollIntervalMs: 0 everywhere — no need for fake timers, a real setTimeout(0) resolves
// immediately in Node's event loop, and each test lets the polling loop run only one
// round (the mock answers `running:false` on the first /progress).

const jsonResponse = (body: any, ok = true, status = ok ? 200 : 500) => ({
  ok, status, json: async () => body,
});

describe('runUnifiedAlign (docs/plan-alignement-unifie.md, lot 1)', () => {
  let calls: string[];
  beforeEach(() => { calls = []; });

  it('triggers the requested sources in parallel on the right routes, with labo/group', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/trigger')) return jsonResponse({ started: true });
      return jsonResponse({ running: false, total: 3, done: 3 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await runUnifiedAlign(['orcid', 'hal'], 'search', { labo: 'GEPEA', group: 'personnel', pollIntervalMs: 0 });

    expect(calls.some((u) => u === '/api/align/orcid/trigger?labo=GEPEA&group=personnel&mode=search')).toBe(true);
    expect(calls.some((u) => u === '/api/align/hal/trigger?labo=GEPEA&group=personnel&mode=search')).toBe(true);
    expect(results.orcid).toEqual({ running: false, total: 3, done: 3 });
    expect(results.hal).toEqual({ running: false, total: 3, done: 3 });
    vi.unstubAllGlobals();
  });

  it('IdRef: legacy route /api/sync-idref-trigger, mode forced to "align"', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/api/sync-idref-trigger')) return jsonResponse({ started: true });
      return jsonResponse({ running: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    await runUnifiedAlign(['idref'], 'search', { pollIntervalMs: 0 });

    expect(calls[0]).toBe('/api/sync-idref-trigger?mode=align');
    expect(calls[1]).toBe('/api/sync-idref-progress');
    vi.unstubAllGlobals();
  });

  it('IdRef ignored in "verify" mode (out of scope, plan §5): no call, no entry in the results', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('/trigger') ? jsonResponse({ started: true }) : jsonResponse({ running: false })));
    vi.stubGlobal('fetch', fetchMock);

    const results = await runUnifiedAlign(['idref', 'orcid'], 'verify', { pollIntervalMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2); // orcid only (trigger + 1 progress)
    expect(results.idref).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('409 (run already in progress): no error, switches to tracking', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/trigger')) return jsonResponse({ error: 'déjà en cours' }, false, 409);
      return jsonResponse({ running: false, done: 5, total: 5 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await runUnifiedAlign(['orcid'], 'search', { pollIntervalMs: 0 });

    expect(results.orcid).toEqual({ running: false, done: 5, total: 5 });
    vi.unstubAllGlobals();
  });

  it('polls several rounds before the end, onProgress notified at each tick', async () => {
    let n = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/trigger')) return jsonResponse({ started: true });
      n++;
      return n < 3 ? jsonResponse({ running: true, done: n, total: 5 }) : jsonResponse({ running: false, done: 5, total: 5 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const seen: any[] = [];

    const results = await runUnifiedAlign(['hal'], 'search', { pollIntervalMs: 0, onProgress: (src, p) => seen.push([src, p]) });

    expect(results.hal).toEqual({ running: false, done: 5, total: 5 });
    expect(seen.filter(([src]) => src === 'hal')).toHaveLength(4); // initial state + 3 poll rounds
    vi.unstubAllGlobals();
  });

  it('trigger error: resolved as {running:false, error}, does not fail the other sources', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/align/orcid/trigger')) return jsonResponse({ error: 'API injoignable' }, false, 500);
      if (url.includes('/trigger')) return jsonResponse({ started: true });
      return jsonResponse({ running: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await runUnifiedAlign(['orcid', 'hal'], 'search', { pollIntervalMs: 0 });

    expect(results.orcid?.running).toBe(false);
    expect(results.orcid?.error).toContain('API injoignable');
    expect(results.hal).toEqual({ running: false });
    vi.unstubAllGlobals();
  });

  it('error reported by the progress: resolved as {running:false, error}', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/trigger')) return jsonResponse({ started: true });
      return jsonResponse({ running: false, error: 'Script interrompu (code 1)' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await runUnifiedAlign(['openalex'], 'search', { pollIntervalMs: 0 });

    expect(results.openalex?.error).toContain('Script interrompu');
    vi.unstubAllGlobals();
  });
});
