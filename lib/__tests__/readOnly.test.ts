import { afterAll, describe, expect, it, vi } from 'vitest';
import { API_ERRORS } from '../apiErrors';
import { READ_ONLY_ERROR, installReadOnlyFetchGuard, isWriteRequest } from '../readOnly';

const ORIGIN = 'https://demo.example';
const GRIST = 'https://grist.numerique.gouv.fr/api';

describe('isWriteRequest', () => {
  it('lets safe methods through', () => {
    for (const m of ['GET', 'get', 'HEAD', 'OPTIONS']) {
      expect(isWriteRequest('/api/grist/docs/d/tables/Annuaire/records', m, ORIGIN, GRIST)).toBe(false);
    }
  });

  it('blocks writes to the app API, relative or absolute', () => {
    expect(isWriteRequest('/api/grist/docs/d/tables/Annuaire/records', 'PATCH', ORIGIN)).toBe(true);
    expect(isWriteRequest(`${ORIGIN}/api/tasks`, 'POST', ORIGIN)).toBe(true);
    expect(isWriteRequest('/api/benchmark/peer-groups/3', 'DELETE', ORIGIN)).toBe(true);
    expect(isWriteRequest('/api/newsletter/generate', 'POST', ORIGIN)).toBe(true);
  });

  it('blocks writes to the Grist API read directly', () => {
    expect(isWriteRequest(`${GRIST}/docs/d/tables/Annuaire/records`, 'POST', ORIGIN, GRIST)).toBe(true);
    expect(isWriteRequest(`${GRIST}/docs/d/tables/Annuaire/records`, 'PATCH', ORIGIN, `${GRIST}/`)).toBe(true);
  });

  it('allows the POST relays that only read', () => {
    expect(isWriteRequest('/api/collab-theme/select-topics', 'POST', ORIGIN)).toBe(false);
    expect(isWriteRequest('/api/benchmark/topic-distribution', 'POST', ORIGIN)).toBe(false);
    expect(isWriteRequest('/api/help-chat', 'POST', ORIGIN)).toBe(false);
  });

  it('ignores other origins and non-API paths', () => {
    expect(isWriteRequest('https://api.openalex.org/works', 'POST', ORIGIN, GRIST)).toBe(false);
    expect(isWriteRequest('/auth/logout', 'POST', ORIGIN)).toBe(false);
    // A look-alike host is not the Grist base.
    expect(isWriteRequest('https://grist.numerique.gouv.fr/apix/docs', 'POST', ORIGIN, GRIST)).toBe(false);
  });

  it('uses the proxy refusal text, declared for translation', () => {
    expect(API_ERRORS.some((d) => d.message === READ_ONLY_ERROR)).toBe(true);
  });
});

describe('installReadOnlyFetchGuard', () => {
  const realFetch = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('window', { fetch: realFetch, location: { origin: ORIGIN } });
  afterAll(() => vi.unstubAllGlobals());

  it('rejects writes before the network and relays reads', async () => {
    installReadOnlyFetchGuard(GRIST);
    installReadOnlyFetchGuard(GRIST); // idempotent: no double wrapping
    const w = window as unknown as { fetch: typeof fetch };
    await expect(w.fetch('/api/grist/docs/d/tables/Annuaire/records', { method: 'PATCH', body: '{}' }))
      .rejects.toThrow(READ_ONLY_ERROR);
    await expect(w.fetch(new Request(`${GRIST}/docs/d/tables/Annuaire/records`, { method: 'POST', body: '{}' })))
      .rejects.toThrow(READ_ONLY_ERROR);
    expect(realFetch).not.toHaveBeenCalled();
    await w.fetch('/api/grist/docs/d/tables/Annuaire/records');
    expect(realFetch).toHaveBeenCalledTimes(1);
  });
});
