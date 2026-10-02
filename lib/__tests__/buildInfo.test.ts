import { describe, expect, it } from 'vitest';
import { shortSha, versionDetails, versionLabel } from '../buildInfo';

// Short fake commit: a 40-character hex string would trip the publication guard (secret-like).
const SHA = 'a1b2c3d4e5f6';

describe('buildInfo', () => {
  it('shortens the commit and keeps the dirty marker', () => {
    expect(shortSha(SHA)).toBe('a1b2c3d');
    expect(shortSha(`${SHA}-dirty`)).toBe('a1b2c3d-dirty');
    expect(shortSha('')).toBe('');
  });

  it('shows the version alone for a release', () => {
    expect(versionLabel({ version: '1.2.0', sha: SHA, builtAt: '' })).toBe('v1.2.0');
  });

  it('adds the commit when the version does not identify the code', () => {
    expect(versionLabel({ version: '0.0.0', sha: SHA, builtAt: '' })).toBe('v0.0.0 · a1b2c3d');
    expect(versionLabel({ version: '1.2.0', sha: `${SHA}-dirty`, builtAt: '' })).toBe('v1.2.0 · a1b2c3d-dirty');
    expect(versionLabel({ version: '0.0.0', sha: '', builtAt: '' })).toBe('v0.0.0');
  });

  it('details version, commit and build date', () => {
    expect(versionDetails({ version: '1.2.0', sha: SHA, builtAt: '2026-10-02T09:15:42.000Z' }))
      .toBe('Druid v1.2.0 · a1b2c3d · 2026-10-02 09:15 UTC');
  });
});
