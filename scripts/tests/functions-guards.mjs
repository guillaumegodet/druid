// Run: docker run --rm -v "$PWD":/app -w /app node:20-slim node scripts/tests/functions-guards.mjs
// Harness for the Pages Functions: Grist proxy guard (functions/api/grist/[[path]].js) and
// shape of /api/me (functions/api/me.js). No network: the guards are called directly.
import fs from 'node:fs';
import { createRequire } from 'node:module';

// The Functions import the registry written by a Cloudflare build (functions/_generated/, ignored by
// git). Absent here, it is created empty (`null`: no instance.json) so that the handlers below run
// on their Pages variables only; a leftover of a local Cloudflare build is refused, since the
// handler checks would then depend on that instance.
const GENERATED = new URL('../../functions/_generated/instance.js', import.meta.url);
if (!fs.existsSync(GENERATED)) {
  fs.mkdirSync(new URL('.', GENERATED), { recursive: true });
  fs.writeFileSync(GENERATED, '// Written by scripts/tests/functions-guards.mjs: no instance.json.\nexport default null;\n');
} else if (!/^export default null;$/m.test(fs.readFileSync(GENERATED, 'utf8'))) {
  console.error('functions/_generated/instance.js comes from a local Cloudflare build: delete functions/_generated/ first');
  process.exit(1);
}

const { gristGuard, onRequest: gristProxy } = await import('../../functions/api/grist/[[path]].js');
const { buildUser, parseAdminEmails, capabilitiesFor, onRequest: me } = await import('../../functions/api/me.js');
const { resolveInstance } = await import('../../functions/_lib/instance.js');
const { onRequestGet: news } = await import('../../functions/api/news/[slug].js');
const { onRequestPost: newsletterGenerate } = await import('../../functions/api/newsletter/generate.js');
const { onRequestPost: newsletterPost } = await import('../../functions/api/newsletter/post.js');
const { parseInstanceConfig } = createRequire(import.meta.url)('../instances/instanceConfig.cjs');

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (attendu ${JSON.stringify(want)})`}`);
};
const DOC = 'docA';
const guard = (method, path, opts = {}) => {
  const r = gristGuard({
    method, path, doc: DOC, hasIdentity: opts.identity ?? true,
    allowAnonymousWrites: opts.anon ?? false, readOnly: opts.readOnly ?? false, tableIdOfBody: () => opts.tables ?? [],
  });
  return r ? r.status : 'RELAY';
};

check('GET racine doc', guard('GET', `docs/${DOC}`), 'RELAY');
check('GET liste tables', guard('GET', `docs/${DOC}/tables`), 'RELAY');
check('GET records', guard('GET', `docs/${DOC}/tables/Annuaire/records`), 'RELAY');
check('GET table inconnue (lecture libre)', guard('GET', `docs/${DOC}/tables/Secret/records`), 'RELAY');
check('GET autre doc', guard('GET', `docs/docZ/tables/Annuaire/records`), 403);
check('GET orgs', guard('GET', 'orgs'), 403);
check('GET sql', guard('GET', `docs/${DOC}/sql`), 403);
check('POST sql', guard('POST', `docs/${DOC}/sql`), 403);
check('GET attachments', guard('GET', `docs/${DOC}/attachments`), 403);
check('DELETE doc', guard('DELETE', `docs/${DOC}`), 405);
check('DELETE records', guard('DELETE', `docs/${DOC}/tables/Annuaire/records`), 405);
check('PUT records', guard('PUT', `docs/${DOC}/tables/Annuaire/records`), 405);
check('PATCH racine doc', guard('PATCH', `docs/${DOC}`), 403);
check('PATCH Annuaire records', guard('PATCH', `docs/${DOC}/tables/Annuaire/records`), 'RELAY');
check('POST Annuaire records', guard('POST', `docs/${DOC}/tables/Annuaire/records`), 'RELAY');
check('POST data/delete', guard('POST', `docs/${DOC}/tables/Annuaire/data/delete`), 'RELAY');
check('POST colonnes Annuaire', guard('POST', `docs/${DOC}/tables/Annuaire/columns`), 'RELAY');
check('PATCH table (definition)', guard('PATCH', `docs/${DOC}/tables/Annuaire`), 403);
check('PATCH unlisted table', guard('PATCH', `docs/${DOC}/tables/Secret/records`), 403);
check('POST creation of a listed table', guard('POST', `docs/${DOC}/tables`, { tables: ['Fusions_log'] }), 'RELAY');
check('POST creation of an unlisted table', guard('POST', `docs/${DOC}/tables`, { tables: ['Autre'] }), 403);
check('POST table creation with empty body', guard('POST', `docs/${DOC}/tables`, { tables: [] }), 403);
check('PATCH without Access identity', guard('PATCH', `docs/${DOC}/tables/Annuaire/records`, { identity: false }), 403);
check('PATCH without identity, local dev', guard('PATCH', `docs/${DOC}/tables/Annuaire/records`, { identity: false, anon: true }), 'RELAY');
check('GET without identity', guard('GET', `docs/${DOC}/tables/Annuaire/records`, { identity: false }), 'RELAY');
// Read-only instance (public demo): reads relayed, every write refused before anything else
check('read-only: GET records', guard('GET', `docs/${DOC}/tables/Annuaire/records`, { identity: false, readOnly: true }), 'RELAY');
check('read-only: PATCH with Access identity', guard('PATCH', `docs/${DOC}/tables/Annuaire/records`, { readOnly: true }), 403);
check('read-only: overrides ALLOW_ANONYMOUS_WRITES', guard('POST', `docs/${DOC}/tables/Annuaire/records`, { identity: false, anon: true, readOnly: true }), 403);
check('read-only: table creation', guard('POST', `docs/${DOC}/tables`, { tables: ['Fusions_log'], readOnly: true }), 403);
check('read-only: other doc still 403', guard('GET', `docs/docZ/tables/Annuaire/records`, { readOnly: true }), 403);
check('doc not configured', gristGuard({ method: 'GET', path: `docs/${DOC}`, doc: '', hasIdentity: true, allowAnonymousWrites: false, tableIdOfBody: () => [] })?.status, 403);

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
  grist: { docId: '', apiBase: 'https://grist.numerique.gouv.fr/api' },
  features: { news: true, newsletter: true }, admins: [], openalexMailto: null, fromRegistry: false,
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
  [{ slug: 'demo', label: demoReg.label, readOnly: true }, { docId: demoReg.grist.docId, apiBase: 'https://grist.numerique.gouv.fr/api' },
    { news: false, newsletter: false }, [], true]);
const privReg = parseInstanceConfig({
  slug: 'ecole', label: 'École fictive', target: 'cloudflare', domains: ['ecole.example.org'], access: 'cloudflare-access',
  readOnly: false, grist: { docId: 'docEcole0001', apiBase: 'https://grist.example.org/api/' },
  capabilities: { HAS_STATUS_VALIDATION: true }, features: { news: true, newsletter: false },
  admins: ['Admin@Example.org'], openalexMailto: 'veille@example.org', secrets: ['GRIST_API_KEY'],
}).config;
const ecole = resolveInstance({}, privReg);
check('registry only: private instance', [ecole.slug, ecole.readOnly, ecole.statusValidation, ecole.grist, ecole.features, ecole.admins, ecole.openalexMailto],
  ['ecole', false, true, { docId: 'docEcole0001', apiBase: 'https://grist.example.org/api' }, { news: true, newsletter: false }, ['admin@example.org'], 'veille@example.org']);
check('registry only: capabilities', [capabilitiesFor(ecole).HAS_STATUS_VALIDATION, capabilitiesFor(ecole).READ_ONLY, capabilitiesFor(ecole).HAS_LDAP], [true, false, false]);

// Registry + Pages variables: a present, non-empty variable overrides its field
const over = resolveInstance({
  INSTANCE_LABEL: 'Autre nom', READ_ONLY: 'true', SHOW_STATUS_VALIDATION: 'false', ADMIN_EMAILS: 'c@example.org',
  OPENALEX_MAILTO: 'autre@example.org', VITE_GRIST_DOC_ID: 'docOverride1', GRIST_API_BASE: 'https://g.example.org/api',
}, privReg);
check('registry + variables: overrides', [over.label, over.readOnly, over.statusValidation, over.admins, over.openalexMailto, over.grist],
  ['Autre nom', true, false, ['c@example.org'], 'autre@example.org', { docId: 'docOverride1', apiBase: 'https://g.example.org/api' }]);
check('registry + variables: READ_ONLY=false overrides readOnly true', resolveInstance({ READ_ONLY: 'false' }, demoReg).readOnly, false);
const blank = resolveInstance({ INSTANCE_LABEL: '', READ_ONLY: ' ', ADMIN_EMAILS: '', VITE_GRIST_DOC_ID: '' }, privReg);
check('registry + empty variables: registry kept', [blank.label, blank.readOnly, blank.admins, blank.grist.docId], ['École fictive', false, ['admin@example.org'], 'docEcole0001']);
check('registry: features not overridable by the slug', resolveInstance({ DRUID_INSTANCE: 'centrale' }, demoReg).features, { news: false, newsletter: false });

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
const meCentrale = await asJson(await me({ request: req('/api/me', { headers: { 'Cf-Access-Authenticated-User-Email': 'a@x.fr' } }), env: { ADMIN_EMAILS: 'a@x.fr' } }));
check('/api/me Centrale unchanged: admin', [meCentrale.body.roles, meCentrale.body.capabilities.READ_ONLY], [['user', 'admin'], false]);

const proxy = (method, path, env, body) => gristProxy({
  request: req(`/api/grist/${path}?limit=1`, { method, body }), env, params: { path: path.split('/') },
});
upstream = null;
let r = await proxy('GET', `docs/${DOC}/tables/Annuaire/records`, DEMO_ENV);
check('proxy demo without key: GET relayed without Authorization', [r.status, upstream?.init.headers.Authorization, upstream?.url.endsWith('?limit=1')], [200, undefined, true]);
check('proxy demo: User-Agent names the instance', upstream?.init.headers['User-Agent'], 'Druid-CRISalid-demo/1.0');
upstream = null;
r = await proxy('PATCH', `docs/${DOC}/tables/Annuaire/records`, DEMO_ENV, '{"records":[]}');
check('proxy demo: PATCH refused, nothing sent upstream', [r.status, upstream], [403, null]);
r = await proxy('GET', `docs/${DOC}/tables/Annuaire/records`, { VITE_GRIST_DOC_ID: DOC });
check('proxy Centrale without key: still a configuration error', r.status, 500);
upstream = null;
r = await proxy('GET', `docs/${DOC}/tables/Annuaire/records`, { VITE_GRIST_DOC_ID: DOC, GRIST_API_KEY: 'k' });
check('proxy Centrale with key: Authorization sent', upstream?.init.headers.Authorization, 'Bearer k');

// Centrale-only routes answer 404 on another instance (no upstream call)
upstream = null;
r = await news({ request: req('/api/news/udemo'), params: { slug: 'udemo' }, env: DEMO_ENV });
check('news on demo: 404', [r.status, upstream], [404, null]);
r = await newsletterGenerate({ request: req('/api/newsletter/generate', { method: 'POST', body: '{}' }), env: DEMO_ENV });
check('newsletter/generate on demo: 404', r.status, 404);
r = await newsletterPost({ request: req('/api/newsletter/post', { method: 'POST', body: '{}' }), env: DEMO_ENV });
check('newsletter/post on demo: 404', r.status, 404);

console.log(ko ? `\n${ko} KO` : '\nAll OK');
process.exit(ko ? 1 : 0);
