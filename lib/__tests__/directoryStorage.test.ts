import { describe, expect, it } from 'vitest';
import { purgeStoredDirectory } from '../directoryStorage';

describe('purgeStoredDirectory', () => {
  it('removes the former on-disk copies of the directory and keeps the other settings', () => {
    const store = new Map<string, string>([
      ['druid_researchers_cache_v2', '[{"lastName":"X"}]'],
      ['druid_structures_cache', '[]'],
      ['druid_researchers_updated_at', '1'],
      ['theme', 'dark'],
    ]);
    (globalThis as any).localStorage = {
      removeItem: (k: string) => store.delete(k),
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    purgeStoredDirectory();
    expect([...store.keys()]).toEqual(['theme']);
  });

  it('does not throw when storage is unavailable', () => {
    (globalThis as any).localStorage = { removeItem: () => { throw new Error('blocked'); } };
    expect(() => purgeStoredDirectory()).not.toThrow();
  });
});
