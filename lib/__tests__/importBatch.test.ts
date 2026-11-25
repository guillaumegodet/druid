// Batch of a file or site import, opened at the first value it observes (lib/directory/siteImport.ts lazyImportBatch).
import { describe, expect, it, vi } from 'vitest';
import { lazyImportBatch } from '../directory/siteImport';

describe('lazyImportBatch', () => {
  it('opens the batch once, at the first call, and never without a value', async () => {
    const openImportBatch = vi.fn(async () => '42');
    const batch = lazyImportBatch({ openImportBatch }, 'site', 'Site LABX', {});
    expect(openImportBatch).not.toHaveBeenCalled();
    expect(await Promise.all([batch(), batch()])).toEqual(['42', '42']);
    expect(openImportBatch).toHaveBeenCalledTimes(1);
    expect(openImportBatch).toHaveBeenCalledWith('site', 'Site LABX', {});
  });
  it('is null on a storage without batches (Grist)', async () => {
    expect(await lazyImportBatch({}, 'lab_file', 'x', {})()).toBeNull();
  });
});
