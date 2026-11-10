// Export and deletion of a tenant, pure rules (druid-internal docs/plan-druid-saas.md, lot 6 a-3): names of the
// archives, what a job row says of its export, when a deletion is due, the tombstone, the R2 listing, the libpq
// environment of pg_dump, the removal of a Workers route.
import { describe, expect, it } from 'vitest';
import type { Job } from '../saas/controlPlane';
import { exportBaseName, exportObjectKey, exportViewOf, isDeletionDue, tombstoneOf } from '../saas/lifecycle';
import { createS3AssetStore, deletePrefix, memoryAssetStore, parseListObjects } from '../saas/r2';
import { libpqEnvOf, removeWorkerRoute } from '../saas/runner';

const ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const job = (over: Partial<Job>): Job => ({
  id: ID, tenant_id: 't', type: 'tenant.export', key: 'tenant.export', params: {}, status: 'done', progress: {}, log: null, attempts: 1,
  created_by: 'owner@example.org', created_at: '2026-11-10T10:00:00.000Z', started_at: null, finished_at: '2026-11-10T10:05:00.000Z',
  cancel_requested_at: null, runner: null, ...over,
});

describe('exports', () => {
  it('names the archive after the tenant, the day and the job', () => {
    const at = new Date('2026-11-10T23:30:00Z');
    expect(exportBaseName('mans-universite', ID, at)).toBe('druid-mans-universite-20261110-0f1e2d3c');
    expect(exportObjectKey('mans-universite', ID, at)).toBe('mans-universite/exports/druid-mans-universite-20261110-0f1e2d3c.tar.gz');
  });

  it('is downloadable while done, uploaded, not expired and not purged', () => {
    const now = new Date('2026-11-12T00:00:00Z');
    const progress = { objectKey: 'x/exports/a.tar.gz', fileName: 'a.tar.gz', size: 2048, expiresAt: '2026-11-17T10:00:00.000Z' };
    expect(exportViewOf(job({ progress }), now)).toMatchObject({ available: true, fileName: 'a.tar.gz', size: 2048, expiresAt: '2026-11-17T10:00:00.000Z' });
    expect(exportViewOf(job({ progress }), new Date('2026-11-18T00:00:00Z')).available).toBe(false);
    expect(exportViewOf(job({ progress: { ...progress, purgedAt: '2026-11-17T11:00:00Z' } }), now).available).toBe(false);
    expect(exportViewOf(job({ status: 'running', progress: { step: 'database', pct: 10 } }), now)).toMatchObject({ available: false, fileName: null });
    expect(exportViewOf(job({ status: 'failed', log: 'child 1: pg_dump\nfailed: pg_dump failed (code 1)' }), now).error).toBe('failed: pg_dump failed (code 1)');
  });
});

describe('deletion', () => {
  it('is due once the date is past, on a suspended tenant only', () => {
    const now = new Date('2026-12-10T12:00:00Z');
    expect(isDeletionDue({ status: 'suspended', delete_after: '2026-12-10T11:00:00Z' }, now)).toBe(true);
    expect(isDeletionDue({ status: 'suspended', delete_after: '2026-12-10T13:00:00Z' }, now)).toBe(false);
    expect(isDeletionDue({ status: 'active', delete_after: '2026-12-01T00:00:00Z' }, now)).toBe(false);
    expect(isDeletionDue({ status: 'suspended', delete_after: null }, now)).toBe(false);
  });

  it('frees the slug and the schema name of a deleted tenant', () => {
    expect(tombstoneOf(ID)).toEqual({ slug: 'deleted-0f1e2d3c4b5a', schema: 't_deleted_0f1e2d3c4b5a' });
  });
});

describe('asset store: listing and prefix deletion', () => {
  it('parses a ListObjectsV2 page', () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>t1/a&amp;b.json</Key></Contents><Contents><Key>t1/exports/x.tar.gz</Key></Contents><NextContinuationToken>tok+1</NextContinuationToken></ListBucketResult>`;
    expect(parseListObjects(xml)).toEqual({ keys: ['t1/a&b.json', 't1/exports/x.tar.gz'], next: 'tok+1' });
    expect(parseListObjects('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>')).toEqual({ keys: [], next: null });
  });

  it('follows the continuation token, signs the listing', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      urls.push(String(url));
      expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      const u = new URL(String(url));
      return new Response(u.searchParams.get('continuation-token')
        ? '<r><IsTruncated>false</IsTruncated><Key>t1/b</Key></r>'
        : '<r><IsTruncated>true</IsTruncated><Key>t1/a</Key><NextContinuationToken>n2</NextContinuationToken></r>');
    }) as unknown as typeof fetch;
    const store = createS3AssetStore({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'druid-saas', accessKeyId: 'k', secretAccessKey: 's', fetchImpl });
    expect(await store.list('t1/')).toEqual(['t1/a', 't1/b']);
    expect(urls[0]).toBe('https://acc.r2.cloudflarestorage.com/druid-saas?list-type=2&prefix=t1%2F');
    expect(new URL(urls[1]).searchParams.get('continuation-token')).toBe('n2');
  });

  it('deletes every object of a tenant, and nothing else', async () => {
    const mem = memoryAssetStore();
    for (const k of ['t1/dashboard-data/index.json', 't1/exports/a.tar.gz', 't10/x', 't2/y']) await mem.put(k, new Uint8Array([1]));
    expect(await deletePrefix(mem, 't1/')).toBe(2);
    expect([...mem.objects.keys()].sort()).toEqual(['t10/x', 't2/y']);
    await expect(deletePrefix(mem, '')).rejects.toThrow(/not a tenant prefix/);
    await expect(deletePrefix(mem, 't1')).rejects.toThrow(/not a tenant prefix/);
  });
});

describe('runner helpers', () => {
  it('hands pg_dump its connection through the libpq environment', () => {
    expect(libpqEnvOf('postgres://u%40x:p%2Fw@example.org:6543/druid?sslmode=require')).toEqual({
      PGHOST: 'example.org', PGPORT: '6543', PGUSER: 'u@x', PGPASSWORD: 'p/w', PGDATABASE: 'druid', PGSSLMODE: 'require',
    });
    expect(libpqEnvOf('postgres://u@localhost/d')).toEqual({ PGHOST: 'localhost', PGPORT: '5432', PGUSER: 'u', PGDATABASE: 'd' });
  });

  it('removes the Workers route of a host', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: any, init: any = {}) => {
      calls.push(`${init.method || 'GET'} ${url}`);
      if ((init.method || 'GET') === 'GET') return Response.json({ success: true, result: [{ id: 'r1', pattern: 'a.example.org/*' }, { id: 'r2', pattern: 'b.example.org/*' }] });
      return Response.json({ success: true });
    }) as unknown as typeof fetch;
    const cf = { apiToken: 't', zoneId: 'z', workerName: 'druid-saas' };
    expect(await removeWorkerRoute(cf, 'b.example.org', fetchImpl)).toBe('removed');
    expect(calls[1]).toBe('DELETE https://api.cloudflare.com/client/v4/zones/z/workers/routes/r2');
    expect(await removeWorkerRoute(cf, 'c.example.org', fetchImpl)).toBe('absent');
  });
});
