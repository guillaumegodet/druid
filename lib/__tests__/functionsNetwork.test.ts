// Cloudflare Functions of the inter-lab network and the researcher pairs (functions/api/network/[[path]].js,
// functions/api/researchers/[key]/pairs.js) on the network.json shipped with the dashboards of the public demo: read
// through env.ASSETS, gated by the `network` feature of the instance, no database (the opinions are then absent).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/functionsNetwork.test.ts: no instance.json.\nexport default null;\n');
}
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();
const { onRequest: network } = await import('../../functions/api/network/[[path]].js');
const { onRequestGet: researcherPairs } = await import('../../functions/api/researchers/[key]/pairs.js');
const { capabilitiesFor, onRequest: me } = await import('../../functions/api/me.js');
const { resolveInstance } = await import('../../functions/_lib/instance.js');
const { parseInstanceConfig } = createRequire(import.meta.url)('../../scripts/instances/instanceConfig.cjs');

const demoFile = JSON.parse(fs.readFileSync(new URL('../../instances/demo/instance.json', import.meta.url), 'utf8'));
const demo = resolveInstance({}, parseInstanceConfig(demoFile).config);
const withoutNetwork = resolveInstance({}, parseInstanceConfig({ ...demoFile, features: { ...demoFile.features, network: false } }).config);
const NETWORK = fs.readFileSync(new URL('../../instances/demo/dashboard-data/network.json', import.meta.url), 'utf8');

/** Static files of the build, as Pages serves them: the network of the demo, index.html for anything else. */
let assetReads: string[] = [];
const ASSETS = {
  fetch: async (req: Request) => {
    const path = new URL(req.url).pathname;
    assetReads.push(path);
    return path === '/dashboard-data/network.json'
      ? new Response(NETWORK, { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  },
};
const call = (handler: any, path: string, { instance = demo, method = 'GET', body, params = {} }: { instance?: any; method?: string; body?: unknown; params?: Record<string, string> } = {}) =>
  handler({
    request: new Request(`https://druid-demo.example.org${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env: { ASSETS }, params, data: { instance }, waitUntil: () => {},
  });

describe('capabilities of the demo', () => {
  it('declares the network and the calls for proposals', async () => {
    expect([capabilitiesFor(demo).HAS_NETWORK_API, capabilitiesFor(demo).HAS_CALLS, capabilitiesFor(demo).HAS_CALLS_CHAT]).toEqual([true, true, false]);
    expect([capabilitiesFor(withoutNetwork).HAS_NETWORK_API, capabilitiesFor(resolveInstance({})).HAS_NETWORK_API, capabilitiesFor(resolveInstance({})).HAS_CALLS]).toEqual([false, false, false]);
    const r = await call(me, '/api/me');
    const body = await r.json();
    expect([body.capabilities.HAS_NETWORK_API, body.capabilities.HAS_CALLS, body.capabilities.READ_ONLY]).toEqual([true, true, true]);
  });
});

describe('/api/network on the file of the instance', () => {
  it('serves the labs, the graph, the pairs and the suggestions of the institution and of a lab', async () => {
    assetReads = [];
    const meta = await (await call(network, '/api/network/udemo?meta=1')).json();
    expect(meta.labs.map((l: any) => l.acronym).sort()).toEqual(['BIOS', 'LIRA', 'LMD']);
    expect([meta.focus, meta.nodes, meta.restricted]).toEqual([null, [], false]);
    const lab = await (await call(network, '/api/network/lira?labs=bios&minPubs=1')).json();
    expect(lab.focus).toBe('LIRA');
    expect(lab.nodes.length).toBeGreaterThan(10);
    expect(lab.links.length).toBeGreaterThan(10);
    const pairs = await (await call(network, '/api/network/udemo/pairs?minShared=2')).json();
    expect([pairs.source, pairs.version, pairs.structureLabs]).toEqual(['udemo', 5, null]);
    expect(pairs.total).toBeGreaterThan(3);
    expect(pairs.pairs.every((p: any) => !p.a.labs.some((l: string) => p.b.labs.includes(l)))).toBe(true);
    const labPairs = await (await call(network, '/api/network/bios/pairs?scope=structure&crossLab=0')).json();
    expect(labPairs.structureLabs).toEqual(['BIOS']);
    expect(labPairs.pairs.every((p: any) => p.a.labs.includes('BIOS') && p.b.labs.includes('BIOS'))).toBe(true);
    const sugg = await (await call(network, '/api/network/udemo/suggestions?from=2022&to=2026')).json();
    expect([sugg.level, sugg.references, sugg.feedback]).toEqual(['topic', true, false]);
    expect(sugg.suggestions.length).toBeGreaterThan(5);
    expect(sugg.suggestions.some((s: any) => s.references > 0)).toBe(true);
    const pubs = await (await call(network, `/api/network/udemo/publications?a=a:${pairs.pairs[0].a.id}&b=a:${pairs.pairs[0].b.id}`)).json();
    expect(pubs.total).toBe(pairs.pairs[0].shared);
    // One read of the file for the whole isolate.
    expect(assetReads).toEqual(['/dashboard-data/network.json']);
  });

  it('refuses what the network does not know and the writes of a read-only instance', async () => {
    expect((await call(network, '/api/network/Bad%20Slug')).status).toBe(400);
    expect((await call(network, '/api/network/unknown-lab')).status).toBe(404);
    expect((await call(network, '/api/network/udemo/publications?a=x&b=y')).status).toBe(400);
    expect((await call(network, '/api/network/udemo/nothing')).status).toBe(404);
    expect((await call(network, '/api/network/udemo/suggestions/feedback', { method: 'POST', body: { a: 1, b: 2, verdict: 'relevant' } })).status).toBe(403);
  });

  it('answers 404 on an instance without the network feature, without reading any file', async () => {
    assetReads = [];
    expect((await call(network, '/api/network/udemo?meta=1', { instance: withoutNetwork })).status).toBe(404);
    expect((await call(researcherPairs, '/api/researchers/roussel-c/pairs', { instance: withoutNetwork, params: { key: 'roussel-c' } })).status).toBe(404);
    expect(assetReads).toEqual([]);
  });
});

describe('/api/researchers/:key/pairs', () => {
  it('gives the co-authors and the suggested connections of a researcher of the network', async () => {
    const r = await call(researcherPairs, '/api/researchers/roussel-c/pairs', { params: { key: 'roussel-c' } });
    const body = await r.json();
    expect([r.status, body.found, body.feedback]).toEqual([200, true, false]);
    expect(body.observed.length).toBeGreaterThan(0);
    expect(body.observed.every((p: any) => p.a.uid === 'roussel-c' || p.b.uid === 'roussel-c')).toBe(true);
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.feedbackSlug).toBe('lira');
    const unknown = await (await call(researcherPairs, '/api/researchers/nobody-x/pairs', { params: { key: 'nobody-x' } })).json();
    expect(unknown).toEqual({ found: false, observed: [], suggestions: [] });
    expect((await call(researcherPairs, '/api/researchers/bad%20key/pairs', { params: { key: 'bad key' } })).status).toBe(400);
  });
});
