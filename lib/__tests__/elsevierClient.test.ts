import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const { createElsevierClient, envKeys } = createRequire(import.meta.url)('../../scripts/lib/elsevier_client.cjs');

type Call = { url: string; key: string };
const quotaHeaders = (remaining: number, limit = 5000) => ({ 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-limit': String(limit), 'x-ratelimit-reset': '1791244800' });
const refused = () => Object.assign(new Error('HTTP 429'), { status: 429, headers: { 'x-els-status': 'QUOTA_EXCEEDED - Quota Exceeded' } });

/** Fake HTTP layer: `answer(key, callIndex)` returns headers or throws, per API key. */
function fakeHttp(answer: (key: string, n: number) => Record<string, string>) {
  const calls: Call[] = [];
  const getUrlImpl = async (url: string, o: { headers: Record<string, string> }) => {
    const key = o.headers['X-ELS-APIKey'];
    calls.push({ url, key });
    return { status: 200, headers: answer(key, calls.length), body: { ok: key } };
  };
  return { calls, getUrlImpl };
}
const client = (keys: string[], getUrlImpl: unknown, extra: Record<string, unknown> = {}) =>
  createElsevierClient({ tag: 'test', ratePerS: { search: 1000, author: 1000 }, marginMs: 0, keys: keys.map((apiKey) => ({ apiKey })), getUrlImpl, ...extra });

describe('scripts/lib/elsevier_client.cjs — backup API key', () => {
  it('envKeys: first key, then the backup one with its own token; empty variables left out', () => {
    expect(envKeys({ SCOPUS_API_KEY: 'k1', SCOPUS_INST_TOKEN: '', SCOPUS_API_KEY_2: 'k2', SCOPUS_INST_TOKEN_2: 't2' }))
      .toEqual([{ apiKey: 'k1', instToken: '' }, { apiKey: 'k2', instToken: 't2' }]);
    expect(envKeys({ SCOPUS_API_KEY: 'k1', SCOPUS_API_KEY_2: ' ' })).toEqual([{ apiKey: 'k1', instToken: '' }]);
    expect(envKeys({})).toEqual([]);
  });

  it('a pool exhausted on key 1 (headers) moves to key 2; the other pools stay on key 1', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { calls, getUrlImpl } = fakeHttp((key) => (key === 'k1' ? quotaHeaders(0) : quotaHeaders(4000)));
    const c = client(['k1', 'k2'], getUrlImpl);
    await c.get('search', '/search/author', { q: 'a' });   // answered by k1, which is now empty
    await c.get('search', '/search/author', { q: 'b' });
    await c.get('author', '/author/author_id/1');
    expect(calls.map((x) => x.key)).toEqual(['k1', 'k2', 'k1']);
    expect(c.aborted()).toBeNull();
    expect(c.quota.search).toMatchObject({ remaining: 4000, key: 2 });
    expect(c.keyCount).toBe(2);
    warn.mockRestore();
  });

  it('a QUOTA_EXCEEDED refusal replays the request with key 2; the run stops once the last key is exhausted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: Call[] = [];
    let k2Left = 1;
    const getUrlImpl = async (url: string, o: { headers: Record<string, string> }) => {
      const key = o.headers['X-ELS-APIKey'];
      calls.push({ url, key });
      if (key === 'k1' || k2Left <= 0) throw refused();
      k2Left--;
      return { status: 200, headers: quotaHeaders(10), body: { ok: key } };
    };
    const c = client(['k1', 'k2'], getUrlImpl);
    expect(await c.get('search', '/search/author', { q: 'a' })).toEqual({ ok: 'k2' });
    expect(await c.get('search', '/search/author', { q: 'b' })).toBeNull();
    expect(calls.map((x) => x.key)).toEqual(['k1', 'k2', 'k2']);
    expect(c.aborted()).toMatch(/all 2 keys exhausted/);
    warn.mockRestore(); err.mockRestore();
  });

  it('concurrent requests refused on key 1 switch once and all retry on key 2 (no false « all keys exhausted »)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: string[] = [];
    const getUrlImpl = async (_url: string, o: { headers: Record<string, string> }) => {
      const key = o.headers['X-ELS-APIKey'];
      calls.push(key);
      await new Promise((r) => { setTimeout(r, 5); });   // the three requests are in flight together
      if (key === 'k1') throw refused();
      return { status: 200, headers: quotaHeaders(4990), body: { ok: key } };
    };
    const c = client(['k1', 'k2'], getUrlImpl);
    const out = await Promise.all([1, 2, 3].map((i) => c.get('search', '/search/author', { q: String(i) })));
    expect(out).toEqual([{ ok: 'k2' }, { ok: 'k2' }, { ok: 'k2' }]);
    expect(c.aborted()).toBeNull();
    expect(calls.filter((k) => k === 'k2')).toHaveLength(3);
    expect(c.quota.search).toMatchObject({ remaining: 4990, key: 2 });
    warn.mockRestore(); err.mockRestore();
  });

  it('reserve: reaching the share of a key moves the pool to the next key; on the last key it stops the run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Key 1 shared with the harvester: 30 % kept; key 2 used in full (sync_scopus.cjs, decision D1).
    const low = fakeHttp((key) => (key === 'k1' ? quotaHeaders(1400, 5000) : quotaHeaders(100, 5000)));
    const perKey = client(['k1', 'k2'], low.getUrlImpl, { reserve: [0.3, 0] });
    await perKey.get('search', '/search/author');   // k1 answers with 28 % left ⇒ under its 30 % share
    await perKey.get('search', '/search/author');   // k2, 2 % left but no share of its own
    await perKey.get('search', '/search/author');
    expect(low.calls.map((x) => x.key)).toEqual(['k1', 'k2', 'k2']);
    expect(perKey.aborted()).toBeNull();
    // One share for every key: the last key stops the run once at its share.
    const both = client(['k1', 'k2'], fakeHttp(() => quotaHeaders(100, 5000)).getUrlImpl, { reserve: 0.1 });
    await both.get('search', '/search/author');
    expect(both.aborted()).toBeNull();
    await both.get('search', '/search/author');
    expect(both.aborted()).toMatch(/quota share reached .* last key \(2\/2\)/);
    // One key: stops at its share, as before the backup key.
    const one = client(['k1'], fakeHttp(() => quotaHeaders(100, 5000)).getUrlImpl, { reserve: 0.1 });
    await one.get('search', '/search/author');
    expect(one.aborted()).toMatch(/quota share reached/);
    const none = client([], low.getUrlImpl);
    expect(none.hasKey).toBe(false);
    expect(await none.get('search', '/search/author')).toBeNull();
    warn.mockRestore(); err.mockRestore();
  });
});
