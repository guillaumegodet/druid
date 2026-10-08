// Run: docker run --rm -v "$PWD":/app -w /app node:20-slim node scripts/tests/functions-guards.mjs
// Harness for the Pages Functions: shape of /api/me (functions/api/me.js), instance registry and resolution,
// Centrale-only routes. The domain API (functions/api/v1) imports TypeScript: tested by vitest
// (lib/__tests__/functionsApiV1.test.ts), which took over the security cases of the former Grist proxy. No network: the guards are called directly.
import fs from 'node:fs';
import { createRequire } from 'node:module';

// The Functions import the registry written by a Cloudflare build (functions/_generated/registry.js,
// ignored by git). Absent here, it is created empty (`null`: no instance.json) so that the handlers
// below run on their Pages variables only; a leftover of a local Cloudflare build is refused, since
// the handler checks would then depend on that instance. Registries of single and shared deployments
// are tested through the pure resolveForHost below.
const GENERATED = new URL('../../functions/_generated/registry.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by scripts/tests/functions-guards.mjs: no instance.json.\nexport default null;\n');
} else if (!/^export default null;$/m.test(fs.readFileSync(GENERATED, 'utf8'))) {
  console.error('functions/_generated/registry.js comes from a local Cloudflare build: delete functions/_generated/ first');
  process.exit(1);
}

const { buildUser, parseAdminEmails, capabilitiesFor, onRequest: me } = await import('../../functions/api/me.js');
const { resolveInstance, resolveForHost, publicInstanceInfo, secretOf, secretSuffix, instanceEnv } = await import('../../functions/_lib/instance.js');
const { onRequest: middleware } = await import('../../functions/api/_middleware.js');
const { onRequestGet: news } = await import('../../functions/api/news/[slug].js');
const { onRequestPost: newsletterGenerate } = await import('../../functions/api/newsletter/generate.js');
const { onRequestPost: newsletterPost } = await import('../../functions/api/newsletter/post.js');
const { instanceAssetPath, serveInstanceAsset, denyDirectAccess } = await import('../../functions/_lib/instanceAssets.js');
const { buildRegistry, parseInstanceConfig } = createRequire(import.meta.url)('../instances/instanceConfig.cjs');

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (attendu ${JSON.stringify(want)})`}`);
};
const DOC = 'docA';
// /api/me
const admins = parseAdminEmails(' A@example.org, b@example.org ,, ');
check('parseAdminEmails', admins, ['a@example.org', 'b@example.org']);
const u = buildUser('A@EXAMPLE.org', admins);
check('admin: roles + access', [u.roles, u.access.isSuperAdmin, u.access.allowedSlugs, u.anonymous], [['user', 'admin'], true, 'all', undefined]);
const v = buildUser('c@example.org', admins);
check('user: roles + access', [v.roles, v.access.isSuperAdmin, v.access.allowedSlugs, v.access.isLabViewer], [['user'], false, 'all', false]);
const w = buildUser(null, admins);
check('anonyme', [w.anonymous, w.roles, w.access.isSuperAdmin, w.preferred_username], [true, ['user'], false, 'centrale']);
check('ADMIN_EMAILS missing', buildUser('a@example.org', parseAdminEmails(undefined)).access.isSuperAdmin, false);

check('anonymous, default instance label', w.name, 'Centrale Nantes');

// Instance settings: registry absent = Pages variables and historical defaults
const pick = (i) => ({ slug: i.slug, label: i.label, readOnly: i.readOnly });
check('no registry: defaults', resolveInstance({}), {
  slug: 'centrale', label: 'Centrale Nantes', readOnly: false, statusValidation: false,
  grist: { docId: '', apiBase: 'https://grist.numerique.gouv.fr/api', publicBaseUrl: null },
  features: { news: true, newsletter: true }, admins: [], openalexMailto: null, fromRegistry: false, shared: false,
});
check('no registry: demo variables', pick(resolveInstance({ DRUID_INSTANCE: 'demo', INSTANCE_LABEL: 'Université de Démonstration', READ_ONLY: 'TRUE' })),
  { slug: 'demo', label: 'Université de Démonstration', readOnly: true });
check('no registry: news/newsletter only on centrale', resolveInstance({ DRUID_INSTANCE: 'demo' }).features, { news: false, newsletter: false });
check('no registry: Grist doc from VITE_GRIST_DOC_ID, GRIST_DOC_ID first',
  [resolveInstance({ VITE_GRIST_DOC_ID: 'docV' }).grist.docId, resolveInstance({ VITE_GRIST_DOC_ID: 'docV', GRIST_DOC_ID: 'docG' }).grist.docId], ['docV', 'docG']);
check('no registry: ADMIN_EMAILS', resolveInstance({ ADMIN_EMAILS: ' A@example.org,b@example.org ' }).admins, ['a@example.org', 'b@example.org']);
check('capabilities default', [capabilitiesFor(resolveInstance({})).READ_ONLY, capabilitiesFor(resolveInstance({})).HAS_STATUS_VALIDATION], [false, false]);
check('capabilities from variables', [capabilitiesFor(resolveInstance({ READ_ONLY: 'true' })).READ_ONLY, capabilitiesFor(resolveInstance({ SHOW_STATUS_VALIDATION: 'true' })).HAS_STATUS_VALIDATION], [true, true]);

// Registry only (the demo instance.json of this repository, as validated by the build)
const demoRaw = JSON.parse(fs.readFileSync(new URL('../../instances/demo/instance.json', import.meta.url), 'utf8'));
const demoReg = parseInstanceConfig(demoRaw).config;
const demo = resolveInstance({}, demoReg);
check('registry only: demo', [pick(demo), demo.grist, demo.features, demo.admins, demo.fromRegistry],
  [{ slug: 'demo', label: demoReg.label, readOnly: true },
    { docId: demoReg.grist.docId, apiBase: 'https://grist.numerique.gouv.fr/api', publicBaseUrl: 'https://grist.numerique.gouv.fr/api' },
    { news: false, newsletter: false }, [], true]);
const privReg = parseInstanceConfig({
  slug: 'ecole', label: 'École fictive', target: 'cloudflare', domains: ['ecole.example.org'], access: 'cloudflare-access',
  readOnly: false, grist: { docId: 'docEcole0001', apiBase: 'https://grist.example.org/api/' },
  capabilities: { HAS_STATUS_VALIDATION: true }, features: { news: true, newsletter: false },
  admins: ['Admin@Example.org'], openalexMailto: 'veille@example.org', secrets: ['GRIST_API_KEY'],
}).config;
const ecole = resolveInstance({}, privReg);
check('registry only: private instance', [ecole.slug, ecole.readOnly, ecole.statusValidation, ecole.grist, ecole.features, ecole.admins, ecole.openalexMailto],
  ['ecole', false, true, { docId: 'docEcole0001', apiBase: 'https://grist.example.org/api', publicBaseUrl: null }, { news: true, newsletter: false }, ['admin@example.org'], 'veille@example.org']);
check('registry only: capabilities', [capabilitiesFor(ecole).HAS_STATUS_VALIDATION, capabilitiesFor(ecole).READ_ONLY, capabilitiesFor(ecole).HAS_LDAP], [true, false, false]);

// Registry + Pages variables: a present, non-empty variable overrides its field
const over = resolveInstance({
  INSTANCE_LABEL: 'Autre nom', READ_ONLY: 'true', SHOW_STATUS_VALIDATION: 'false', ADMIN_EMAILS: 'c@example.org',
  OPENALEX_MAILTO: 'autre@example.org', VITE_GRIST_DOC_ID: 'docOverride1', GRIST_API_BASE: 'https://g.example.org/api',
}, privReg);
check('registry + variables: overrides', [over.label, over.readOnly, over.statusValidation, over.admins, over.openalexMailto, over.grist],
  ['Autre nom', true, false, ['c@example.org'], 'autre@example.org', { docId: 'docOverride1', apiBase: 'https://g.example.org/api', publicBaseUrl: null }]);
check('registry + VITE_GRIST_PUBLIC_BASE_URL: public base overridden',
  resolveInstance({ VITE_GRIST_PUBLIC_BASE_URL: 'https://p.example.org/api/' }, privReg).grist.publicBaseUrl, 'https://p.example.org/api');

// Instance block of /api/me (front runtime settings, lot 6 a): nothing private, same for anonymous
check('publicInstanceInfo demo', publicInstanceInfo(demo), {
  slug: 'demo', label: demoReg.label, gristDocId: demoReg.grist.docId,
  gristPublicBaseUrl: 'https://grist.numerique.gouv.fr/api', gristUiUrl: 'https://grist.numerique.gouv.fr',
});
check('publicInstanceInfo private instance: proxy, UI of its Grist', publicInstanceInfo(ecole),
  { slug: 'ecole', label: 'École fictive', gristDocId: 'docEcole0001', gristPublicBaseUrl: null, gristUiUrl: 'https://grist.example.org' });
check('buildUser carries the instance block (user and anonymous)',
  [buildUser('a@example.org', [], undefined, ecole).instance?.gristDocId, buildUser(null, [], undefined, ecole).instance?.gristDocId, Object.keys(buildUser(null, []).instance)],
  ['docEcole0001', 'docEcole0001', ['slug', 'label', 'gristDocId', 'gristPublicBaseUrl', 'gristUiUrl']]);
check('registry + variables: READ_ONLY=false overrides readOnly true', resolveInstance({ READ_ONLY: 'false' }, demoReg).readOnly, false);
const blank = resolveInstance({ INSTANCE_LABEL: '', READ_ONLY: ' ', ADMIN_EMAILS: '', VITE_GRIST_DOC_ID: '' }, privReg);
check('registry + empty variables: registry kept', [blank.label, blank.readOnly, blank.admins, blank.grist.docId], ['École fictive', false, ['admin@example.org'], 'docEcole0001']);
check('registry: features not overridable by the slug', resolveInstance({ DRUID_INSTANCE: 'centrale' }, demoReg).features, { news: false, newsletter: false });

// Host resolution: single and shared deployments (lot 6 b)
const demo2Reg = parseInstanceConfig({ ...demoRaw, slug: 'demo-2', label: 'Démo 2', domains: ['demo-2.example.org'],
  grist: { docId: 'docDemo20002', publicRead: true } }).config;
const multiReg = buildRegistry([demoReg, demo2Reg], { mode: 'multi' }).registry;
const singleReg = buildRegistry([privReg], { mode: 'single' }).registry;
check('shared: each host gets its instance',
  [resolveForHost('druid-demo.pages.dev', {}, multiReg)?.slug, resolveForHost('DEMO-2.example.org.', {}, multiReg)?.slug], ['demo', 'demo-2']);
check('shared: unknown host gets no instance', resolveForHost('other.example.org', {}, multiReg), null);
check('shared: object keys are not hosts', [resolveForHost('__proto__', {}, multiReg), resolveForHost('constructor', {}, multiReg)], [null, null]);
const d2 = resolveForHost('demo-2.example.org', {
  INSTANCE_LABEL: 'X', READ_ONLY: 'false', VITE_GRIST_DOC_ID: 'docOther0001', ADMIN_EMAILS: 'a@example.org', DRUID_INSTANCE: 'centrale',
}, multiReg);
check('shared: variables override nothing', [d2.slug, d2.label, d2.readOnly, d2.grist.docId, d2.admins, d2.shared],
  ['demo-2', 'Démo 2', true, 'docDemo20002', [], true]);
check('single: every host serves the instance, variables still override',
  [resolveForHost('branch.druid-school.pages.dev', {}, singleReg).slug, resolveForHost('any.host', { INSTANCE_LABEL: 'Y' }, singleReg).label, resolveForHost('x', {}, singleReg).shared],
  ['ecole', 'Y', false]);
check('no registry: any host, from the variables', resolveForHost('x', { DRUID_INSTANCE: 'demo' }, null).slug, 'demo');

// Secrets per instance
check('secretSuffix', secretSuffix('demo-2'), 'DEMO_2');
check('shared: own secret only, never the common one',
  [secretOf({ GRIST_API_KEY: 'common', GRIST_API_KEY__DEMO_2: 'k2' }, d2, 'GRIST_API_KEY'), secretOf({ GRIST_API_KEY: 'common' }, d2, 'GRIST_API_KEY')], ['k2', undefined]);
check('single: own secret, then the plain one',
  [secretOf({ GRIST_API_KEY: 'common', GRIST_API_KEY__ECOLE: 'ke' }, ecole, 'GRIST_API_KEY'), secretOf({ GRIST_API_KEY: 'common' }, ecole, 'GRIST_API_KEY')], ['ke', 'common']);
const d2env = instanceEnv({ GRIST_API_KEY: 'common', ILAAS_API_KEY__DEMO_2: 'i2', ILAAS_MODEL: 'm' }, d2);
check('instanceEnv on a shared deployment', [d2env.GRIST_API_KEY, d2env.ILAAS_API_KEY, d2env.ILAAS_MODEL], [undefined, 'i2', 'm']);

// Handlers (no network: fetch is stubbed and records the upstream call)
let upstream = null;
globalThis.fetch = async (url, init) => { upstream = { url: String(url), init }; return new Response('{"records":[]}', { status: 200 }); };
const req = (url, init = {}) => new Request(`https://demo.example${url}`, init);
const asJson = async (res) => ({ status: res.status, body: await res.json() });

const DEMO_ENV = { DRUID_INSTANCE: 'demo', INSTANCE_LABEL: 'Université de Démonstration', READ_ONLY: 'true', ADMIN_EMAILS: 'a@x.fr', VITE_GRIST_DOC_ID: DOC };
const meDemo = await asJson(await me({ request: req('/api/me', { headers: { 'Cf-Access-Authenticated-User-Email': 'a@x.fr' } }), env: DEMO_ENV }));
check('/api/me demo: listed admin is not admin when read-only', [meDemo.body.roles, meDemo.body.access.isSuperAdmin, meDemo.body.capabilities.READ_ONLY], [['user'], false, true]);
const meAnon = await asJson(await me({ request: req('/api/me'), env: DEMO_ENV }));
check('/api/me demo anonymous', [meAnon.body.anonymous, meAnon.body.name, meAnon.body.preferred_username], [true, 'Université de Démonstration', 'demo']);
check('/api/me demo: instance block from the variables', [meAnon.body.instance.gristDocId, meAnon.body.instance.gristPublicBaseUrl], [DOC, null]);
const meCentrale = await asJson(await me({ request: req('/api/me', { headers: { 'Cf-Access-Authenticated-User-Email': 'a@x.fr' } }), env: { ADMIN_EMAILS: 'a@x.fr' } }));
check('/api/me Centrale unchanged: admin', [meCentrale.body.roles, meCentrale.body.capabilities.READ_ONLY], [['user', 'admin'], false]);

// Shared deployment: the middleware hands the host's instance to the handlers (context.data)
{
  let nextCalled = false;
  const c = { request: req('/api/me'), env: { DRUID_INSTANCE: 'demo' }, data: {}, next: async () => { nextCalled = true; return new Response('next'); } };
  await middleware(c);
  check('middleware: instance handed to the handlers', [nextCalled, c.data.instance?.slug], [true, 'demo']);
}
const sharedCall = (handler, host, path, instance, env, init = {}, params = {}) =>
  handler({ request: new Request(`https://${host}${path}`, init), env, params, data: { instance } });
const ecoleShared = resolveInstance({}, privReg, { shared: true });
const meD2 = await asJson(await sharedCall(me, 'demo-2.example.org', '/api/me', d2, { ADMIN_EMAILS: 'a@x.fr' }));
check('shared /api/me: instance block of the host', [meD2.body.instance.slug, meD2.body.instance.gristDocId, meD2.body.capabilities.READ_ONLY], ['demo-2', 'docDemo20002', true]);
// Centrale-only routes answer 404 on another instance (no upstream call)
upstream = null;
let r = await news({ request: req('/api/news/udemo'), params: { slug: 'udemo' }, env: DEMO_ENV });
check('news on demo: 404', [r.status, upstream], [404, null]);
r = await newsletterGenerate({ request: req('/api/newsletter/generate', { method: 'POST', body: '{}' }), env: DEMO_ENV });
check('newsletter/generate on demo: 404', r.status, 404);
r = await newsletterPost({ request: req('/api/newsletter/post', { method: 'POST', body: '{}' }), env: DEMO_ENV });
check('newsletter/post on demo: 404', r.status, 404);

// Per-instance files of a shared deployment (functions/_lib/instanceAssets.js, lot 6 D5)
check('assets: dashboard file of the instance', instanceAssetPath('demo-2', '/dashboard-data/eidemo/dashboard.json.gz'),
  '/instance-assets/demo-2/dashboard-data/eidemo/dashboard.json.gz');
check('assets: alignment cache', instanceAssetPath('demo', '/idref_align_cache.json'), '/instance-assets/demo/idref_align_cache.json');
check('assets: refused paths', ['/dashboard-data/../../demo/x.json', '/dashboard-data/%2e%2e/x.json', '/dashboard-data/a%2F..%2F..%2Fdemo/x.json',
  '/dashboard-data', '/dashboard-data/', '/index.html', '/ldap_status_cache.json', '/instance-assets/demo/idref_align_cache.json', '/dashboard-data/%E0%A4%A']
  .map((p) => instanceAssetPath('demo-2', p)), [null, null, null, null, null, null, null, null, null]);
let assetFetched = null;
const fakeAssets = (files) => ({
  fetch: async (r) => {
    assetFetched = new URL(r.url).pathname;
    return assetFetched in files
      ? new Response(files[assetFetched], { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
});
const ASSET_FILES = { '/instance-assets/demo-2/dashboard-data/index.json': '{"who":"demo-2"}', '/instance-assets/demo/dashboard-data/index.json': '{"who":"demo"}' };
const assetCall = (instance, path, method = 'GET') =>
  serveInstanceAsset({ request: new Request(`https://h.example.org${path}`, { method }), env: { ASSETS: fakeAssets(ASSET_FILES) }, data: { instance } });
r = await assetCall(d2, '/dashboard-data/index.json');
check('assets: each host reads its own copy', [r.status, await r.text(), assetFetched], [200, '{"who":"demo-2"}', '/instance-assets/demo-2/dashboard-data/index.json']);
r = await assetCall(d2, '/dashboard-data/eidemo/news.json');
check('assets: missing file → 404, not the SPA page', r.status, 404);
assetFetched = null;
r = await assetCall(d2, '/dashboard-data/..%2Findex.json');
check('assets: escaping path → 404 without fetching', [r.status, assetFetched], [404, null]);
r = await assetCall(d2, '/dashboard-data/index.json', 'POST');
check('assets: write method → 405', r.status, 405);
r = await denyDirectAccess({ request: new Request('https://h.example.org/instance-assets/demo/dashboard-data/index.json') });
check('assets: direct access to the copies → 404', r.status, 404);

console.log(ko ? `\n${ko} KO` : '\nAll OK');
process.exit(ko ? 1 : 0);
