// Cloudflare Functions of the Centrale-only routes (news, newsletter) and of « Mes rapports »: they reach the directory
// through the storage of the instance (functions/_lib/storage.js, druid-internal docs/plan-migration-postgresql.md,
// lot 3 d). Moved from scripts/tests/functions-guards.mjs, which runs in plain Node (no TypeScript import).
import fs from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';

// The Functions import the registry written by a Cloudflare build (ignored by git): created empty when absent.
const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by lib/__tests__/functionsCentrale.test.ts: no instance.json.\nexport default null;\n');
}
const { onRequestGet: news } = await import('../../functions/api/news/[slug].js');
const { onRequestPost: newsletterGenerate } = await import('../../functions/api/newsletter/generate.js');
const { onRequestPost: newsletterPost } = await import('../../functions/api/newsletter/post.js');
const { onRequest: reports } = await import('../../functions/api/reports/[[path]].js');

const DOC = 'docCentrale';
const ANNUAIRE = [
  { id: 1, fields: { Prenom: 'Ada', Nom: 'Lovelace', LABO: 'LS2N', Email: 'ada@example.org', LinkedIn: 'https://www.linkedin.com/in/ada-l' } },
  { id: 2, fields: { Prenom: 'Alan', Nom: 'Turing', LABO: 'GEM', Email: '', LinkedIn: '' } },
];
const WORK = {
  id: 'https://openalex.org/W42', title: 'A work', doi: 'https://doi.org/10.1/x', publication_date: '2026-10-01',
  authorships: [{ author: { display_name: 'Ada Lovelace' }, institutions: [{ id: 'https://openalex.org/I4210117005' }] }],
  primary_location: { source: { display_name: 'Journal' } }, abstract_inverted_index: { An: [0], abstract: [1] },
};

/** Upstream stub: Grist (records every call), OpenAlex and ILAAS canned answers. */
let grist: { method: string; path: string; auth?: string; ua?: string; body?: string }[] = [];
let other: string[] = [];
beforeEach(() => {
  grist = []; other = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith('/api/docs/')) {
      const path = u.pathname.replace(/^\/api\/docs\/[^/]+/, '') + u.search;
      grist.push({ method: init.method || 'GET', path: decodeURIComponent(`${u.pathname.split('/')[3]}${path}`), auth: init.headers?.Authorization, ua: init.headers?.['User-Agent'], body: init.body });
      const body = /\/records$/.test(u.pathname) && (init.method || 'GET') === 'POST' ? { records: [{ id: 77 }] }
        : /\/tables\/Annuaire\/records/.test(u.pathname) ? { records: ANNUAIRE }
          : /\/tables$/.test(u.pathname) ? { tables: [{ id: 'Rapports' }, { id: 'Rapports_partages' }, { id: 'Rapports_generations' }] }
            : /\/columns$/.test(u.pathname) ? { columns: [] } : { records: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    other.push(u.hostname);
    if (u.hostname === 'api.openalex.org') return new Response(JSON.stringify({ meta: { count: 1 }, results: [WORK] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"accroche":"Hook","resume":"Brief","post":"Post"}' } }] }), { status: 200 });
  }) as typeof fetch;
});

const req = (path: string, init: RequestInit = {}) => new Request(`https://druid.example.org${path}`, init);
const DEMO_ENV = { DRUID_INSTANCE: 'demo', INSTANCE_LABEL: 'Université de Démonstration', READ_ONLY: 'true', ADMIN_EMAILS: 'a@x.fr', VITE_GRIST_DOC_ID: 'docA' };
const CENTRALE_ENV = { VITE_GRIST_DOC_ID: DOC, GRIST_API_KEY: 'kc', ILAAS_API_KEY: 'ki', ALLOW_ANONYMOUS_WRITES: 'true' };
const post = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('Centrale-only routes on another instance', () => {
  it('answer 404 without any upstream call', async () => {
    expect((await news({ request: req('/api/news/udemo'), params: { slug: 'udemo' }, env: DEMO_ENV })).status).toBe(404);
    expect((await newsletterGenerate({ request: req('/api/newsletter/generate', { method: 'POST', body: '{}' }), env: DEMO_ENV })).status).toBe(404);
    expect((await newsletterPost({ request: req('/api/newsletter/post', { method: 'POST', body: '{}' }), env: DEMO_ENV })).status).toBe(404);
    expect([grist, other]).toEqual([[], []]);
  });
});

describe('storage of the instance (Centrale)', () => {
  const sameClient = () => grist.every((c) => c.path.startsWith(`${DOC}/`) && c.auth === 'Bearer kc' && c.ua === 'Druid-CRISalid-centrale/1.0');

  it('news: staff filter read from the Annuaire', async () => {
    const r = await news({ request: req('/api/news/ls2n'), params: { slug: 'ls2n' }, env: CENTRALE_ENV, waitUntil: () => {} });
    const body = await r.json();
    expect([r.status, body.effectifsFilter, body.items.map((i: any) => i.authors)]).toEqual([200, true, [['Ada Lovelace']]]);
    expect(grist.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${DOC}/tables/Annuaire/records`]);
    expect(sameClient()).toBe(true);
  });

  it('newsletter/generate: existing briefs, Annuaire, then the new brief', async () => {
    const r = await newsletterGenerate({ request: req('/api/newsletter/generate', post({ slug: 'ls2n', limit: 1 })), env: CENTRALE_ENV });
    const body = await r.json();
    expect([r.status, body.created.map((c: any) => [c.id, c.fields.work_id, c.fields.chercheur_nom, c.fields.accroche])]).toEqual([200, [[77, 'W42', 'Ada Lovelace', 'Hook']]]);
    expect(grist.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${DOC}/tables/Newsletter/records?filter={"slug":["ls2n"]}`,
      `GET ${DOC}/tables/Annuaire/records`,
      `POST ${DOC}/tables/Newsletter/records`,
    ]);
    expect(JSON.parse(grist[2].body!).records[0].fields.slug).toBe('ls2n');
    expect(sameClient()).toBe(true);
  });

  it('newsletter/post: LinkedIn mentions from the Annuaire', async () => {
    const r = await newsletterPost({ request: req('/api/newsletter/post', post({ title: 'T', authorNames: ['Ada Lovelace', 'Alan Turing'] })), env: CENTRALE_ENV });
    expect((await r.json()).mentions).toEqual([{ name: 'Ada Lovelace', url: 'https://www.linkedin.com/in/ada-l', handle: '@ada-l' }]);
    expect(grist.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${DOC}/tables/Annuaire/records`]);
    expect(sameClient()).toBe(true);
  });

  it('reports: list through the storage client of the instance', async () => {
    const r = await reports({ request: req('/api/reports'), env: CENTRALE_ENV, params: {} });
    expect(r.status).toBe(200);
    expect(grist.length).toBeGreaterThan(0);
    expect(sameClient()).toBe(true);
  });
});
