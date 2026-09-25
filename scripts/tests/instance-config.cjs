// Run: docker run --rm -v "$PWD":/app -w /app node:20-slim node scripts/tests/instance-config.cjs
// Harness: validation of the instance registry instances/<slug>/instance.json
// (scripts/instances/instanceConfig.cjs, docs/plan-architecture-multi-instances.md, lot 5 a).
const path = require('path');
const { parseInstanceConfig, publicRepoErrors, DEFAULT_GRIST_API_BASE } = require(path.join(__dirname, '../instances/instanceConfig.cjs'));

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
  grist: { docId: 'AAAAAAAAAAAAAAAAAAAAAA', publicRead: true },
});
const privateCloudflare = () => ({
  slug: 'school',
  label: 'School',
  target: 'cloudflare',
  domains: ['druid-school.pages.dev'],
  access: 'cloudflare-access',
  readOnly: false,
  grist: { docId: 'BBBBBBBBBBBBBBBBBBBBBB' },
  features: { news: true, newsletter: true },
  admins: ['admin@example.org'],
  secrets: ['GRIST_API_KEY', 'ILAAS_API_KEY'],
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

// ── valid configurations ─────────────────────────────────────────────────────
{
  const r = parseInstanceConfig(publicDemo(), { folder: 'demo' });
  check('public demo is valid', r.ok, true);
  check('defaults: Grist API base', r.config.grist.apiBase, DEFAULT_GRIST_API_BASE);
  check('defaults: features off', r.config.features, { news: false, newsletter: false });
  check('defaults: no admins, no secrets, no mailto', [r.config.admins, r.config.secrets, r.config.openalexMailto], [[], [], null]);
  check('public demo passes the public rules', publicRepoErrors(publicDemo()), []);
}
check('private Cloudflare instance is valid', parseInstanceConfig(privateCloudflare()).ok, true);
check('docker instance with expected capabilities is valid', parseInstanceConfig(docker()).ok, true);
{
  const repo = path.join(__dirname, '..', '..', 'instances', 'demo', 'instance.json');
  const raw = JSON.parse(require('fs').readFileSync(repo, 'utf8'));
  check('instances/demo/instance.json is valid', parseInstanceConfig(raw, { folder: 'demo' }).ok, true);
  check('instances/demo/instance.json passes the public rules', publicRepoErrors(raw), []);
}

// ── schema ───────────────────────────────────────────────────────────────────
check('unknown key refused', rejects({ ...publicDemo(), theme: 'blue' }, 'theme'), true);
check('bad slug refused', rejects({ ...publicDemo(), slug: 'Demo_1' }, 'slug'), true);
check('slug must equal its folder', rejects(publicDemo(), 'differs from its folder', { folder: 'demo-2' }), true);
check('empty domains refused', rejects({ ...publicDemo(), domains: [] }, 'domains'), true);
check('URL instead of host refused', rejects({ ...publicDemo(), domains: ['https://x.pages.dev'] }, 'domains.0'), true);
check('bad Grist doc id refused', rejects({ ...publicDemo(), grist: { docId: 'short', publicRead: true } }, 'grist.docId'), true);
check('unknown capability refused', rejects({ ...docker(), capabilities: { HAS_FOO: true } }, 'HAS_FOO'), true);
check('secret value instead of name refused', rejects({ ...privateCloudflare(), secrets: ['GRIST_API_KEY', 'abc123'] }, 'secrets.1'), true);
check('invalid admin e-mail refused', rejects({ ...privateCloudflare(), admins: ['not-an-email'] }, 'admins.0'), true);

// ── cross-field rules ────────────────────────────────────────────────────────
check('public access requires readOnly', rejects({ ...publicDemo(), readOnly: false, secrets: ['GRIST_API_KEY'] }, 'access "public" requires readOnly'), true);
check('publicRead requires readOnly', rejects({ ...privateCloudflare(), grist: { docId: 'BBBBBBBBBBBBBBBBBBBBBB', publicRead: true } }, 'publicRead requires readOnly'), true);
check('readOnly instance has no admin', rejects({ ...publicDemo(), access: 'cloudflare-access', admins: ['a@example.org'] }, 'no administrator'), true);
check('admins only with Cloudflare Access', rejects({ ...docker(), admins: ['a@example.org'] }, 'admins only apply'), true);
check('no Keycloak on Cloudflare', rejects({ ...privateCloudflare(), access: 'keycloak', admins: [] }, 'not available on target "cloudflare"'), true);
check('structural capability not settable on Cloudflare', rejects({ ...privateCloudflare(), capabilities: { HAS_LDAP: true } }, 'HAS_LDAP'), true);
check('tunable capability settable on Cloudflare', parseInstanceConfig({ ...privateCloudflare(), capabilities: { HAS_STATUS_VALIDATION: true } }).ok, true);
check('extra docs not supported on Cloudflare', rejects({ ...privateCloudflare(), grist: { docId: 'BBBBBBBBBBBBBBBBBBBBBB', extraDocIds: ['DDDDDDDDDDDDDDDDDDDDDD'] } }, 'extraDocIds'), true);
check('private doc needs GRIST_API_KEY', rejects({ ...privateCloudflare(), secrets: [] }, 'GRIST_API_KEY'), true);
check('news only on Cloudflare', rejects({ ...docker(), features: { news: true, newsletter: false } }, 'news/newsletter'), true);

// ── public repository rules ──────────────────────────────────────────────────
check('public repo: writable instance refused', publicRepoErrors(privateCloudflare()).length > 0, true);
check('public repo: admins refused', publicRepoErrors({ ...publicDemo(), admins: ['a@example.org'] }).some((e) => e.includes('no admins')), true);
check('public repo: private doc refused', publicRepoErrors({ ...publicDemo(), grist: { docId: 'AAAAAAAAAAAAAAAAAAAAAA' } }).some((e) => e.includes('publicRead')), true);
check('public repo: non-object refused', publicRepoErrors(null), ['not a JSON object']);

console.log(ko ? `\n${ko} failure(s)` : '\nAll good.');
process.exit(ko ? 1 : 0);
