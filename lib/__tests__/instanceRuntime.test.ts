import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gristApiBase, gristDocId, gristDocUrl, gristPublicBaseUrl, gristUiDocUrl, setInstanceInfo } from '../instanceRuntime';

beforeEach(() => {
  setInstanceInfo(null);
  vi.stubEnv('VITE_GRIST_DOC_ID', 'envDoc');
  vi.stubEnv('VITE_GRIST_PUBLIC_BASE_URL', '');
  vi.stubEnv('VITE_GRIST_UI_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('instanceRuntime', () => {
  it('falls back on the build-time variables without an instance block', () => {
    expect(gristDocId()).toBe('envDoc');
    expect(gristDocUrl()).toBe('/api/grist/docs/envDoc');
    expect(gristUiDocUrl()).toBe('https://grist.numerique.gouv.fr/envDoc');
    vi.stubEnv('VITE_GRIST_PUBLIC_BASE_URL', 'https://grist.example.org/api/');
    expect(gristDocUrl()).toBe('https://grist.example.org/api/docs/envDoc');
  });

  it('prefers the instance block of /api/me', () => {
    setInstanceInfo({ slug: 'ecole', label: 'École', gristDocId: 'runDoc', gristPublicBaseUrl: null, gristUiUrl: 'https://grist.example.org/' });
    expect(gristDocUrl()).toBe('/api/grist/docs/runDoc');
    expect(gristUiDocUrl()).toBe('https://grist.example.org/runDoc');
  });

  it('a null public base in the block means the proxy, even if the bundle has one', () => {
    vi.stubEnv('VITE_GRIST_PUBLIC_BASE_URL', 'https://grist.example.org/api');
    setInstanceInfo({ gristDocId: 'runDoc', gristPublicBaseUrl: null });
    expect(gristPublicBaseUrl()).toBe('');
    expect(gristApiBase()).toBe('/api/grist');
  });

  it('reads a public doc directly when the block says so', () => {
    setInstanceInfo({ gristDocId: 'pubDoc', gristPublicBaseUrl: 'https://grist.numerique.gouv.fr/api/' });
    expect(gristDocUrl()).toBe('https://grist.numerique.gouv.fr/api/docs/pubDoc');
  });

  it('no doc: no Grist link', () => {
    vi.stubEnv('VITE_GRIST_DOC_ID', '');
    expect(gristUiDocUrl()).toBeNull();
  });
});
