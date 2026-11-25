// Run: docker run --rm -v "$PWD":/app -w /app node:20-slim node scripts/tests/instance-config.cjs
// Harness: validation of the instance registry instances/<slug>/instance.json
// (scripts/instances/instanceConfig.cjs, docs/plan-architecture-multi-instances.md, lot 5 a).
const path = require('path');
const { buildRegistry, parseInstanceConfig, publicRepoErrors, selectDeploymentInstances, viteEnvFromConfig, compareEnvWithConfig, DEFAULT_GRIST_API_BASE } = require(path.join(__dirname, '../instances/instanceConfig.cjs'));

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'ok ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`}`);
};
/** True when one of the errors contains `fragment`. */
const rejects = (raw, fragment, opts) => {
  const r = parseInstanceConfig(raw, opts);
  return !r.ok && r.errors.some((e) => e.includes(fragment));
};

const publicDemo = () => ({
  slug: 'demo',
  label: 'Demo University',
  target: 'cloudflare',
  domains: ['druid-demo.pages.dev'],
  access: 'public',
  readOnly: true,
  storage: 'postgres',
});
const privateCloudflare = () => ({
  slug: 'school',
  label: 'School',
  target: 'cloudflare',
  domains: ['druid-school.pages.dev'],
  access: 'cloudflare-access',
  readOnly: false,
  storage: 'postgres',
  features: { news: true, newsletter: true },
  admins: ['admin@example.org'],
  secrets: ['ILAAS_API_KEY'],
});
const docker = () => ({
  slug: 'univ',
  label: 'University',
  target: 'docker',
  domains: ['druid.example.org'],
  access: 'keycloak',
  readOnly: false,
  grist: { docId: 'CCCCCCCCCCCCCCCCCCCCCC', extraDocIds: ['DDDDDDDDDDDDDDDDDDDDDD'] },
  capabilities: { HAS_LDAP: true, HAS_BENCHMARK: false },
  secrets: ['GRIST_API_KEY', 'LDAP_BIND_PASSWORD'],
});

// Cloudflare instances are on PostgreSQL only (druid-internal docs/plan-migration-postgresql.md, lot 12 a); a Grist
// document only remains on target "docker" (the nightly read-only copy of Nantes).
const postgresDemo = publicDemo;

// ── valid configurations ─────────────────────────────────────────────────────
{
  const r = parseInstanceConfig(publicDemo(), { folder: 'demo' });
  check('public demo is valid', r.ok, true);
  check('public demo: storage, no grist block', [r.config.storage, r.config.grist], ['postgres', null]);
  check('defaults: features off', r.config.features, { news: false, newsletter: false, network: false });
  check('defaults: no admins, no secrets, no mailto, no deployment', [r.config.admins, r.config.secrets, r.config.openalexMailto, r.config.deployment], [[], [], null, null]);
  check('public demo passes the public rules', publicRepoErrors(publicDemo()), []);
  check('public demo: no Vite variable', viteEnvFromConfig(r.config), {});
}
check('Cloudflare: storage grist refused (lot 12 a)', rejects({ ...publicDemo(), storage: 'grist', grist: { docId: 'AAAAAAAAAAAAAAAAAAAAAA' }, secrets: ['GRIST_API_KEY'] }, 'serves PostgreSQL only'), true);
check('Cloudflare: storage defaults to grist, hence refused without storage', rejects({ ...publicDemo(), storage: undefined }, 'serves PostgreSQL only'), true);
check('Cloudflare: publicRead no longer exists', rejects({ ...publicDemo(), storage: 'grist', grist: { docId: 'AAAAAAAAAAAAAAAAAAAAAA', publicRead: true } }, 'publicRead'), true);
check('storage grist needs the grist block', rejects({ ...docker(), grist: undefined }, 'storage "grist" needs the grist block'), true);
check('storage postgres excludes the grist block', rejects({ ...publicDemo(), grist: { docId: 'AAAAAAAAAAAAAAAAAAAAAA' } }, 'excludes the grist block'), true);
check('storage postgres has no Grist key', rejects({ ...postgresDemo(), secrets: ['GRIST_API_KEY'] }, 'does not use the GRIST_API_KEY secret'), true);
check('storage postgres: private writable instance with news and newsletter is valid (lot 10 d)', parseInstanceConfig(privateCloudflare()).ok, true);
check('unknown storage is rejected', rejects({ ...publicDemo(), storage: 'sqlite' }, 'storage'), true);
check('postgres.schema in the shared database (lot 10 e)', parseInstanceConfig({ ...postgresDemo(), postgres: { schema: 'i_demo_2' } }).config.postgres, { schema: 'i_demo_2' });
check('postgres block absent by default', parseInstanceConfig(postgresDemo()).config.postgres, null);
check('postgres.schema needs the i_ prefix', rejects({ ...postgresDemo(), postgres: { schema: 't_demo' } }, 'postgres.schema'), true);
check('postgres block requires storage postgres', rejects({ ...docker(), postgres: { schema: 'i_demo' } }, 'requires storage "postgres"'), true);

{
  const r = parseInstanceConfig(docker());
  check('docker instance with expected capabilities is valid', r.ok, true);
  check('docker: default storage grist, Grist API base by default', [r.config.storage, r.config.grist.apiBase], ['grist', DEFAULT_GRIST_API_BASE]);
  check('docker: a Grist doc needs GRIST_API_KEY', rejects({ ...docker(), secrets: [] }, 'GRIST_API_KEY'), true);
}
check('private Cloudflare instance is valid', parseInstanceConfig(privateCloudflare()).ok, true);
for (const slug of ['demo', 'demo-2']) {
  const repo = path.join(__dirname, '..', '..', 'instances', slug, 'instance.json');
  const raw = JSON.parse(require('fs').readFileSync(repo, 'utf8'));
  check(`instances/${slug}/instance.json is valid`, parseInstanceConfig(raw, { folder: slug }).ok, true);
  check(`instances/${slug}/instance.json passes the public rules`, publicRepoErrors(raw), []);
}

// ── schema ───────────────────────────────────────────────────────────────────
check('unknown key refused', rejects({ ...publicDemo(), theme: 'blue' }, 'theme'), true);
check('bad slug refused', rejects({ ...publicDemo(), slug: 'Demo_1' }, 'slug'), true);
check('slug must equal its folder', rejects(publicDemo(), 'differs from its folder', { folder: 'demo-2' }), true);
check('empty domains refused', rejects({ ...publicDemo(), domains: [] }, 'domains'), true);
check('URL instead of host refused', rejects({ ...publicDemo(), domains: ['https://x.pages.dev'] }, 'domains.0'), true);
check('bad Grist doc id refused', rejects({ ...docker(), grist: { docId: 'short' } }, 'grist.docId'), true);
check('unknown capability refused', rejects({ ...docker(), capabilities: { HAS_FOO: true } }, 'HAS_FOO'), true);
check('secret value instead of name refused', rejects({ ...privateCloudflare(), secrets: ['ILAAS_API_KEY', 'abc123'] }, 'secrets.1'), true);
check('invalid admin e-mail refused', rejects({ ...privateCloudflare(), admins: ['not-an-email'] }, 'admins.0'), true);

// ── cross-field rules ────────────────────────────────────────────────────────
check('public access requires readOnly', rejects({ ...publicDemo(), readOnly: false }, 'access "public" requires readOnly'), true);
check('readOnly instance has no admin', rejects({ ...publicDemo(), access: 'cloudflare-access', admins: ['a@example.org'] }, 'no administrator'), true);
check('admins only with Cloudflare Access', rejects({ ...docker(), admins: ['a@example.org'] }, 'admins only apply'), true);
check('no Keycloak on Cloudflare', rejects({ ...privateCloudflare(), access: 'keycloak', admins: [] }, 'not available on target "cloudflare"'), true);
check('structural capability not settable on Cloudflare', rejects({ ...privateCloudflare(), capabilities: { HAS_LDAP: true } }, 'HAS_LDAP'), true);
check('tunable capability settable on Cloudflare', parseInstanceConfig({ ...privateCloudflare(), capabilities: { HAS_STATUS_VALIDATION: true } }).ok, true);
check('deployment accepted on Cloudflare', parseInstanceConfig({ ...publicDemo(), deployment: 'druid-saas' }).config.deployment, 'druid-saas');
check('deployment must be a Pages project name', rejects({ ...publicDemo(), deployment: 'Druid SaaS' }, 'deployment'), true);
check('deployment only on Cloudflare', rejects({ ...docker(), deployment: 'druid-saas' }, 'deployment only exists'), true);
check('news only on Cloudflare', rejects({ ...docker(), features: { news: true, newsletter: false } }, 'news/newsletter'), true);
check('network feature only on Cloudflare', rejects({ ...docker(), features: { network: true } }, 'news/newsletter/network'), true);
check('network feature accepted on a public demo', parseInstanceConfig({ ...publicDemo(), features: { network: true } }).config.features, { news: false, newsletter: false, network: true });

// ── public repository rules ──────────────────────────────────────────────────
check('public repo: writable instance refused', publicRepoErrors(privateCloudflare()).length > 0, true);
check('public repo: admins refused', publicRepoErrors({ ...publicDemo(), admins: ['a@example.org'] }).some((e) => e.includes('no admins')), true);
check('public repo: a Grist instance refused', publicRepoErrors({ ...publicDemo(), storage: 'grist', grist: { docId: 'AAAAAAAAAAAAAAAAAAAAAA' } }).some((e) => e.includes('PostgreSQL database')), true);
check('public repo: non-object refused', publicRepoErrors(null), ['not a JSON object']);

// ── build: VITE_* variables and Pages variables overriding the registry (lot 5 b) ──
{
  const demo = parseInstanceConfig(publicDemo()).config;
  const school = parseInstanceConfig(privateCloudflare()).config;
  check('no vite env without a Grist document', [viteEnvFromConfig(demo), viteEnvFromConfig(school)], [{}, {}]);
  check('no Pages variable: nothing to report', compareEnvWithConfig(school, {}), []);
  check('empty Pages variable ignored', compareEnvWithConfig(school, { INSTANCE_LABEL: '' }), []);
  check('same values are redundant', compareEnvWithConfig(demo, { READ_ONLY: 'TRUE', INSTANCE_LABEL: 'Demo University' })
    .map((r) => `${r.name}:${r.status}`), ['INSTANCE_LABEL:same', 'READ_ONLY:same']);
  check('Grist variables of the former Pages projects are no longer compared', compareEnvWithConfig(demo, { VITE_GRIST_DOC_ID: 'x', GRIST_API_BASE: 'y' }), []);
  check('differing value reported with both values', compareEnvWithConfig(school, { INSTANCE_LABEL: 'Other' }),
    [{ name: 'INSTANCE_LABEL', status: 'differs', detail: ' (environment "Other", instance.json "School")' }]);
  check('READ_ONLY=false on a writable instance is redundant', compareEnvWithConfig(school, { READ_ONLY: 'false' })[0].status, 'same');
  check('admins compared as a set, case-insensitive', compareEnvWithConfig(school, { ADMIN_EMAILS: ' Admin@Example.org ,admin@example.org' })[0].status, 'same');
  const adminDiff = compareEnvWithConfig(school, { ADMIN_EMAILS: 'other@example.org' })[0];
  check('differing admins: values never printed', [adminDiff.status, adminDiff.detail], ['differs', '']);
}

// ── registry of the Functions: single and shared deployments (lot 6 b) ──────
{
  const demo = parseInstanceConfig(publicDemo()).config;
  const school = parseInstanceConfig(privateCloudflare()).config;
  const demo2 = parseInstanceConfig({ ...publicDemo(), slug: 'demo-2', domains: ['demo-2.example.org'] }).config;
  const single = buildRegistry([school], { mode: 'single' });
  check('single: default slug and hosts', [single.ok, single.registry.defaultSlug, single.registry.byHost], [true, 'school', { 'druid-school.pages.dev': 'school' }]);
  const multi = buildRegistry([demo, demo2], { mode: 'multi' });
  check('multi: no default slug, one host per domain', [multi.ok, multi.registry.defaultSlug, multi.registry.byHost],
    [true, null, { 'druid-demo.pages.dev': 'demo', 'demo-2.example.org': 'demo-2' }]);
  check('multi: instances keyed by slug', Object.keys(multi.registry.instances), ['demo', 'demo-2']);
  const clash = buildRegistry([demo, { ...demo2, domains: ['druid-demo.pages.dev'] }], { mode: 'multi' });
  check('multi: a domain claimed twice is refused', [clash.ok, clash.errors], [false, ['domain druid-demo.pages.dev claimed by both "demo" and "demo-2"']]);
  check('multi: an instance listed twice is refused', buildRegistry([demo, demo], { mode: 'multi' }).errors, ['instance "demo" listed twice']);
  check('single: one instance only', buildRegistry([demo, demo2], { mode: 'single' }).errors, ['mode "single" takes exactly one instance']);
  check('no instance refused', buildRegistry([], { mode: 'multi' }).errors, ['no instance']);
  check('docker target refused', buildRegistry([parseInstanceConfig(docker()).config], { mode: 'single' }).errors.some((e) => e.includes('not "cloudflare"')), true);
}

// ── shared deployment selected by DRUID_DEPLOYMENT (lot 7 a, F3) ──────────────
{
  const saas = (folder) => ({ folder, source: 'instances/', raw: { slug: folder, deployment: 'druid-saas' } });
  const priv = (folder, dep = 'druid-saas') => ({ folder, source: 'private', raw: { slug: folder, deployment: dep } });
  check('deployment: instances that declare it, sorted', selectDeploymentInstances([
    saas('demo-2'), saas('demo'), { folder: 'centrale', source: 'private', raw: { slug: 'centrale' } }, priv('acme'), priv('other', 'druid-other'),
  ], 'druid-saas'), { ok: true, slugs: ['acme', 'demo', 'demo-2'] });
  check('deployment: none declared is an error', selectDeploymentInstances([saas('demo')], 'druid-other').errors, ['no instance declares deployment "druid-other"']);
  check('deployment: same folder in two sources refused', selectDeploymentInstances([saas('demo'), priv('demo', null)], 'druid-saas').errors,
    ['instance "demo" exists in several sources (instances/, private)']);
  check('deployment: same folder elsewhere, not claimed, ignored', selectDeploymentInstances([saas('demo'), priv('x', null), { folder: 'x', source: 'instances/', raw: {} }], 'druid-saas').slugs, ['demo']);
  check('deployment: invalid name', selectDeploymentInstances([saas('demo')], 'Druid SaaS').ok, false);
  check('deployment: non-object instance.json ignored', selectDeploymentInstances([saas('demo'), { folder: 'y', source: 'instances/', raw: null }], 'druid-saas').slugs, ['demo']);
}

// ── career path (affiliationHistory, docs/archive/plan-parcours-affiliations.md D2) ──────
{
  check('affiliationHistory: null by default', parseInstanceConfig(docker()).config.affiliationHistory, null);
  const ah = { local: { ids: { openalex: ['I100'], ror: ['0abcdef00'] }, names: ['University'] }, site: { names: ['University Hospital'] }, area: { cities: ['Univtown'] } };
  const r = parseInstanceConfig({ ...docker(), affiliationHistory: ah });
  check('affiliationHistory: valid, defaults filled', r.ok && [r.config.affiliationHistory.neutral, r.config.affiliationHistory.thresholds, r.config.affiliationHistory.local.ids.ror], [{ ids: {}, names: [] }, {}, ['0abcdef00']]);
  check('affiliationHistory: unknown identifier type rejected', rejects({ ...docker(), affiliationHistory: { local: { ids: { orcid: ['x'] } } } }, 'affiliationHistory.local.ids'), true);
  check('affiliationHistory: unknown threshold rejected', rejects({ ...docker(), affiliationHistory: { thresholds: { lagg: 2 } } }, 'affiliationHistory.thresholds'), true);
}

console.log(ko ? `\n${ko} failure(s)` : '\nAll good.');
process.exit(ko ? 1 : 0);
