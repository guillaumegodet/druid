import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gristDocId, gristUiDocUrl, setInstanceInfo } from '../instanceRuntime';

beforeEach(() => {
  setInstanceInfo(null);
  vi.stubEnv('VITE_GRIST_DOC_ID', 'envDoc');
  vi.stubEnv('VITE_GRIST_UI_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('instanceRuntime', () => {
  it('falls back on the build-time variables without an instance block', () => {
    expect(gristDocId()).toBe('envDoc');
    expect(gristUiDocUrl()).toBe('https://grist.numerique.gouv.fr/envDoc');
  });

  it('prefers the instance block of /api/me', () => {
    setInstanceInfo({ slug: 'ecole', label: 'École', gristDocId: 'runDoc', gristPublicBaseUrl: null, gristUiUrl: 'https://grist.example.org/' });
    expect(gristDocId()).toBe('runDoc');
    expect(gristUiDocUrl()).toBe('https://grist.example.org/runDoc');
  });

  it('no doc: no Grist link', () => {
    vi.stubEnv('VITE_GRIST_DOC_ID', '');
    expect(gristUiDocUrl()).toBeNull();
  });
});
