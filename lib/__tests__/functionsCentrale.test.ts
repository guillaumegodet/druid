// Cloudflare Functions of the Centrale-only routes (news, newsletter) and of « Mes rapports »: they reach the directory
// through the storage of the instance (functions/_lib/storage.js, druid-internal docs/plan-migration-postgresql.md,
// lot 3 d; PostgreSQL only since lot 12 a). Moved from scripts/tests/functions-guards.mjs, which runs in plain Node (no TypeScript import).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';

// The Functions import the registry written by a Cloudflare build (ignored by git): created empty when absent.
const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/functionsCentrale.test.ts: no instance.json.\nexport default null;\n');
}
// The driver bundle of the Functions (functions/_generated/pg.js, written by a Cloudflare build): built when absent.
const PG_BUNDLE = new URL('../../functions/_generated/pg.js', import.meta.url);
if (!fs.existsSync(PG_BUNDLE)) await createRequire(import.meta.url)('../../scripts/functions_pg_bundle.cjs').buildFunctionsPg();
const { onRequestGet: news } = await import('../../functions/api/news/[slug].js');
const { onRequestPost: newsletterGenerate } = await import('../../functions/api/newsletter/generate.js');
const { onRequestPost: newsletterPost } = await import('../../functions/api/newsletter/post.js');
const { onRequest: reports } = await import('../../functions/api/reports/[[path]].js');
const { resolveInstance } = await import('../../functions/_lib/instance.js');
const { parseInstanceConfig } = createRequire(import.meta.url)('../../scripts/instances/instanceConfig.cjs');

const WORK: { id: string; [k: string]: unknown } = {
  id: 'https://openalex.org/W42', title: 'A work', doi: 'https://doi.org/10.1/x', publication_date: '2026-10-01',
  authorships: [{ author: { display_name: 'Ada Lovelace' }, institutions: [{ id: 'https://openalex.org/I4210117005' }] }],
  primary_location: { source: { display_name: 'Journal' } }, abstract_inverted_index: { An: [0], abstract: [1] },
};

/** Upstream stub: OpenAlex and ILAAS canned answers; a call to the Grist API (none expected any more) is recorded. */
let grist: string[] = [];
let other: string[] = [];
beforeEach(() => {
  grist = []; other = [];
  globalThis.fetch = (async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith('/api/docs/')) { grist.push(u.pathname); return new Response('{"records":[]}', { status: 200 }); }
    other.push(u.hostname);
    if (u.hostname === 'api.openalex.org') return new Response(JSON.stringify({ meta: { count: 1 }, results: [WORK] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"accroche":"Hook","resume":"Brief","post":"Post"}' } }] }), { status: 200 });
  }) as typeof fetch;
});

const req = (path: string, init: RequestInit = {}) => new Request(`https://druid.example.org${path}`, init);
const DEMO_ENV = { DRUID_INSTANCE: 'demo', INSTANCE_LABEL: 'Université de Démonstration', READ_ONLY: 'true', ADMIN_EMAILS: 'a@x.fr' };
const post = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('Centrale-only routes on another instance', () => {
  it('answer 404 without any upstream call', async () => {
    expect((await news({ request: req('/api/news/udemo'), params: { slug: 'udemo' }, env: DEMO_ENV })).status).toBe(404);
    expect((await newsletterGenerate({ request: req('/api/newsletter/generate', { method: 'POST', body: '{}' }), env: DEMO_ENV })).status).toBe(404);
    expect((await newsletterPost({ request: req('/api/newsletter/post', { method: 'POST', body: '{}' }), env: DEMO_ENV })).status).toBe(404);
    expect([grist, other]).toEqual([[], []]);
  });
});

// Needs DATABASE_URL_APP (druid_app on a migrated database), like the PostgreSQL cases of functionsApiV1.test.ts.
const pgUrl = process.env.DATABASE_URL_APP;
describe.skipIf(!pgUrl)('Centrale-only routes on PostgreSQL through Hyperdrive (lot 10 d)', () => {
  const instance = resolveInstance({}, parseInstanceConfig({
    slug: 'ecole', label: 'École fictive', target: 'cloudflare', domains: ['ecole.example.org'], access: 'cloudflare-access',
    readOnly: false, storage: 'postgres', capabilities: { HAS_STATUS_VALIDATION: false }, features: { news: true, newsletter: true },
    admins: [], openalexMailto: null, secrets: ['ILAAS_API_KEY'],
  }).config);
  const env = { HYPERDRIVE: { connectionString: pgUrl }, ILAAS_API_KEY: 'ki' };
  const ACCESS = { 'Cf-Access-Authenticated-User-Email': 'redaction@example.org' };

  it('newsletter/generate: the brief goes to newsletter_item, never generated twice, no Grist call', async () => {
    // A work id of its own: the database is shared with the other integration tests.
    WORK.id = `https://openalex.org/W${Date.now()}`;
    const workId = WORK.id.split('/').pop() as string;
    const generate = () => newsletterGenerate({
      request: req('/api/newsletter/generate', { ...post({ slug: 'lheea', limit: 1 }), headers: { 'Content-Type': 'application/json', ...ACCESS } }),
      env, data: { instance },
    });
    const { createDb } = await import('../db/client');
    const db = createDb({ connectionString: pgUrl!, max: 1 });
    try {
      const r = await generate();
      const body = await r.json();
      expect([r.status, body.created.map((c: any) => c.fields.work_id)]).toEqual([200, [workId]]);
      const rows = await db.selectFrom('newsletter_item').select(['id', 'slug', 'statut', 'accroche']).where('work_id', '=', workId).execute();
      expect(rows.map((x) => [Number(x.id), x.slug, x.statut, x.accroche])).toEqual([[body.created[0].id, 'lheea', 'genere', 'Hook']]);
      const again = await (await generate()).json();
      expect(again.created).toEqual([]);
      expect(grist).toEqual([]);
    } finally {
      await db.deleteFrom('newsletter_item').where('work_id', '=', workId).execute();
      await db.destroy();
      WORK.id = 'https://openalex.org/W42';
    }
  });

  it('news and newsletter/post read the Annuaire from the database', async () => {
    const n = await news({ request: req('/api/news/lheea'), params: { slug: 'lheea' }, env, data: { instance }, waitUntil: () => {} });
    expect(n.status).toBe(200);
    const p = await newsletterPost({ request: req('/api/newsletter/post', post({ title: 'T', authorNames: ['Nobody Here'] })), env, data: { instance } });
    expect([p.status, (await p.json()).mentions]).toEqual([200, []]);
    expect(grist).toEqual([]);
  });

  it('reports: list from the tables of the database', async () => {
    const r = await reports({ request: req('/api/reports', { headers: ACCESS }), env, params: {}, data: { instance } });
    expect([r.status, Array.isArray((await r.json()).reports ?? [])]).toEqual([200, true]);
    expect(grist).toEqual([]);
  });

  it('without its Hyperdrive binding: 500 for the generation, before any call', async () => {
    const r = await newsletterGenerate({ request: req('/api/newsletter/generate', post({ slug: 'lheea' })), env: { ILAAS_API_KEY: 'ki' }, data: { instance } });
    expect([r.status, (await r.json()).error, grist, other]).toEqual([500, 'HYPERDRIVE binding not configured on Cloudflare', [], []]);
  });
});
