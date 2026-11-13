import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

// Keycloak tokens kept in the session for /api/chat (scripts/lib/kc_session_tokens.cjs): the CRISalid 1.7 agents
// chat API wants the access token of the user, with at least 120 s of life left.
const { tokensFromResponse, freshAccessToken, MIN_TTL_SECONDS } = createRequire(import.meta.url)(
  '../../scripts/lib/kc_session_tokens.cjs',
);

const NOW = 1_800_000_000;
const response = (access: string, refresh: string | undefined, expiresIn = 900, refreshIn = 1800) => ({
  access_token: access,
  refresh_token: refresh,
  expires_in: expiresIn,
  refresh_expires_in: refreshIn,
});

describe('tokensFromResponse', () => {
  it('records absolute expiry dates', () => {
    expect(tokensFromResponse(response('a1', 'r1'), NOW)).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      accessExpiresAt: NOW + 900,
      refreshExpiresAt: NOW + 1800,
    });
  });

  it('has no refresh expiry for an offline token (refresh_expires_in = 0)', () => {
    expect(tokensFromResponse(response('a1', 'r1', 300, 0), NOW).refreshExpiresAt).toBeNull();
  });

  it('rejects a response without access token', () => {
    expect(tokensFromResponse({ error: 'invalid_grant' }, NOW)).toBeNull();
    expect(tokensFromResponse(null, NOW)).toBeNull();
  });
});

describe('freshAccessToken', () => {
  const stored = tokensFromResponse(response('a1', 'r1'), NOW);

  it('keeps a token with enough life left, without refreshing', async () => {
    const refresh = vi.fn();
    const res = await freshAccessToken(stored, refresh, { now: NOW + 900 - MIN_TTL_SECONDS });
    expect(res).toEqual({ accessToken: 'a1', tokens: stored });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes a token about to expire and returns the new record', async () => {
    const refresh = vi.fn().mockResolvedValue(response('a2', 'r2'));
    const now = NOW + 900 - MIN_TTL_SECONDS + 1;
    const res = await freshAccessToken(stored, refresh, { now });
    expect(refresh).toHaveBeenCalledWith('r1');
    expect(res?.accessToken).toBe('a2');
    expect(res?.tokens).toEqual({ accessToken: 'a2', refreshToken: 'r2', accessExpiresAt: now + 900, refreshExpiresAt: now + 1800 });
  });

  it('keeps the previous refresh token when Keycloak sends none', async () => {
    const refresh = vi.fn().mockResolvedValue(response('a2', undefined));
    const res = await freshAccessToken(stored, refresh, { now: NOW + 899 });
    expect(res?.tokens.refreshToken).toBe('r1');
    expect(res?.tokens.refreshExpiresAt).toBe(NOW + 1800);
  });

  it('asks for a new login when the refresh is refused, throws or the refresh token has expired', async () => {
    expect(await freshAccessToken(stored, vi.fn().mockResolvedValue(null), { now: NOW + 899 })).toBeNull();
    expect(await freshAccessToken(stored, vi.fn().mockResolvedValue({ error: 'invalid_grant' }), { now: NOW + 899 })).toBeNull();
    expect(await freshAccessToken(stored, vi.fn().mockRejectedValue(new Error('down')), { now: NOW + 899 })).toBeNull();
    const refresh = vi.fn();
    expect(await freshAccessToken(stored, refresh, { now: NOW + 1800 })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('asks for a new login without tokens (session opened before they were kept)', async () => {
    expect(await freshAccessToken(undefined, vi.fn(), { now: NOW })).toBeNull();
    expect(await freshAccessToken({ ...stored, refreshToken: null }, vi.fn(), { now: NOW + 899 })).toBeNull();
  });
});
