import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { gristClientFromEnv, jobContext, jobStorageFromEnv } from '../directory/jobStorage';
import { createGristReader } from '../directory/repository';

const schema = createRequire(import.meta.url)('../../scripts/lib/tasks_schema.cjs');

type Call = { method: string; path: string; body?: string };

/** Fake Grist REST API: `tables` = existing tables with their columns; every request is recorded. */
const fakeFetch = (tables: Record<string, { id: string; fields: Record<string, any> }[]>) => {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method || 'GET';
    const path = new URL(url).pathname.replace(/^\/api\/docs\/[^/]+/, '');
    calls.push({ method, path, body: init.body });
    let body: unknown = {};
    if (method === 'GET' && path === '/tables') body = { tables: Object.keys(tables).map((id) => ({ id })) };
    else if (method === 'GET' && path.endsWith('/columns')) body = { columns: tables[decodeURIComponent(path.split('/')[2])] || [] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetchImpl };
};

describe('jobStorage (druid-internal docs/plan-migration-postgresql.md, lot 3)', () => {
  it('refuses an environment without document or key', () => {
    expect(() => gristClientFromEnv({ GRIST_API_KEY: 'k' })).toThrow('VITE_GRIST_DOC_ID / GRIST_API_KEY not configured');
    expect(() => gristClientFromEnv({ VITE_GRIST_DOC_ID: 'doc' })).toThrow('not configured');
    expect(() => jobStorageFromEnv({})).toThrow('not configured');
  });

  it('a job has the institution right and reports its writes to onWrite', () => {
    const seen: string[] = [];
    const ctx = jobContext((w) => seen.push(`${w.kind} ${w.table}`));
    expect(ctx.scope).toEqual({ all: true, labAnchors: [] });
    ctx.audit({ table: 'Annuaire', kind: 'update', count: 1 });
    expect(seen).toEqual(['update Annuaire']);
    expect(() => jobContext().audit({ table: 'T', kind: 'create', count: 1 })).not.toThrow();
  });
});

describe('ensureTasksTables: storage client form = former fetch form', () => {
  const run = async (existing: Record<string, { id: string; fields: Record<string, any> }[]>) => {
    const former = fakeFetch(existing);
    const formerCreated = await schema.ensureTasksTables({ apiBase: 'https://grist.test/api', doc: 'doc', headers: {}, fetchImpl: former.fetchImpl });
    const current = fakeFetch(existing);
    const client = createGristReader({ apiBase: 'https://grist.test/api', docId: 'doc', apiKey: 'k', fetch: current.fetchImpl as typeof fetch });
    const created = await schema.ensureTasksTablesWith(client);
    return { former: former.calls, formerCreated, current: current.calls, created };
  };

  it('creates both tables when missing', async () => {
    const r = await run({});
    expect(r.created).toEqual([schema.TASKS_TABLE, schema.EVENTS_TABLE]);
    expect(r.created).toEqual(r.formerCreated);
    expect(r.current).toEqual(r.former);
  });

  it('completes the choices of an existing table, leaves a complete one alone', async () => {
    const outdated = schema.TASKS_COLUMNS.map((c: any) => (c.fields.type === 'Choice'
      ? { id: c.id, fields: { ...c.fields, widgetOptions: JSON.stringify({ choices: [] }) } }
      : c));
    const r = await run({ [schema.TASKS_TABLE]: outdated, [schema.EVENTS_TABLE]: schema.EVENTS_COLUMNS });
    expect(r.created).toEqual([]);
    expect(r.current.filter((c) => c.method !== 'GET')).toHaveLength(1);
    expect(r.current.find((c) => c.method === 'PATCH')?.path).toBe(`/tables/${schema.TASKS_TABLE}/columns`);
    expect(r.current).toEqual(r.former);
  });
});
