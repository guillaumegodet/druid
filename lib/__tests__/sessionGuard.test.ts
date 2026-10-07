import { afterAll, describe, it, expect, vi, beforeEach } from 'vitest';
import { isApiRequest, installSessionExpiryGuard, resetSessionExpiryGuardForTests } from '../sessionGuard';

const ORIGIN = 'http://druid.example.org';

describe('isApiRequest', () => {
  it('same-origin /api/ calls only', () => {
    expect(isApiRequest('/api/grist/docs/x/tables/Annuaire/records', ORIGIN)).toBe(true);
    expect(isApiRequest(`${ORIGIN}/api/me`, ORIGIN)).toBe(true);
    expect(isApiRequest('/auth/login', ORIGIN)).toBe(false);
    expect(isApiRequest('https://grist.example.org/api/docs/x', ORIGIN)).toBe(false);
  });
});

describe('installSessionExpiryGuard', () => {
  beforeEach(() => resetSessionExpiryGuardForTests());
  afterAll(() => vi.unstubAllGlobals());

  it('a 401 on /api/ calls onExpired once and never settles; other answers pass through', async () => {
    const statuses: Record<string, number> = { '/api/a': 401, '/api/b': 401, '/api/ok': 200, 'https://other.example.org/api/x': 401 };
    const realFetch = vi.fn(async (input: RequestInfo | URL) => new Response('{}', { status: statuses[String(input)] ?? 200 }));
    vi.stubGlobal('window', { fetch: realFetch, location: { origin: ORIGIN } });
    const w = window as unknown as { fetch: typeof fetch };
    const onExpired = vi.fn();
    installSessionExpiryGuard(onExpired);
    installSessionExpiryGuard(onExpired);   // idempotent
    expect((await w.fetch('/api/ok')).status).toBe(200);
    expect((await w.fetch('https://other.example.org/api/x')).status).toBe(401);
    let settled = false;
    w.fetch('/api/a').then(() => { settled = true; });
    w.fetch('/api/b').then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
