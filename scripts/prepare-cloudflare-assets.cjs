#!/usr/bin/env node
// Copies the static assets specific to a Cloudflare instance into public/ before the Vite
// build, only when Cloudflare Pages is doing the build (CF_PAGES=1, set automatically by
// Cloudflare). The instance is chosen by DRUID_INSTANCE (Pages build variable, default
// `centrale` so that the existing Centrale project needs no change); its files live under
// instances/<slug>/ (docs/plan-instance-demo-cloudflare.md, lot A1):
//  - the alignment caches (instances/<slug>/<slug>-*_cache.json);
//  - the dashboard exports (instances/<slug>/dashboard-data/ → public/dashboard-data/,
//    read by lib/dashboardSource.ts when /api/dashboard-* does not exist — no druid-biblio
//    backend on Pages).
// The instance registry instances/<slug>/instance.json (docs/plan-architecture-multi-instances.md,
// lot 5 b) is validated here — an invalid file fails the build — and turned into:
//  - .env.production.local: the VITE_* build variables it implies (a Pages variable keeps priority;
//    fallback only since lot 6 a — the front reads its instance from /api/me);
//  - functions/_generated/registry.js: the registry of the Functions (functions/_lib/instance.js),
//    `null` when the instance has no instance.json yet (the Functions then keep reading their
//    Pages variables).
// Pages variables that duplicate a registry field are listed in the build log (same / overrides).
//
// Shared deployment (docs/plan-architecture-multi-instances.md, lot 6 b): DRUID_INSTANCES=a,b lists
// several instances served by one Pages project, chosen at runtime by request host (`domains` of
// each instance.json, all required). Nothing instance-specific goes into the bundle or public/: no
// .env.production.local and no asset copy (a file of public/ is served on every host — assets of a
// shared deployment move behind a Function, lot 6 D5).
// Instances with personal data (Centrale) are not in this repository: when instances/<slug>/
// does not exist here, the folder <slug>/ of the PRIVATE repository INSTANCES_REPO (default
// guillaumegodet/druid-instances) is shallow-cloned with the INSTANCES_REPO_TOKEN build secret
// (fine-grained token, read-only Contents on that repository) — docs/plan-instance-demo-cloudflare.md,
// lot B1. The demo (fictitious data) stays in instances/demo/.
// Centrale files contain real PII (names/PPN/ORCID, named staff in dashboard.json):
// never copy them for a Docker build (Nantes), which would otherwise serve them as a
// fallback from dist/ as long as no Nantes run has produced its own cache at the app root
// (see docs/archive/plan-fusion-centrale-2026-09.md, route /<cache>.json in server.cjs).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildRegistry, parseInstanceConfig, viteEnvFromConfig, compareEnvWithConfig } = require('./instances/instanceConfig.cjs');

if (process.env.CF_PAGES !== '1') {
  console.log('[prepare-cloudflare-assets] CF_PAGES not set: Docker/Nantes build, nothing to copy.');
  process.exit(0);
}

const fail = (msg) => {
  console.error(`[prepare-cloudflare-assets] ${msg}`);
  process.exit(1);
};

const SLUG_RE = /^[a-z0-9-]+$/;
const shared = !!(process.env.DRUID_INSTANCES || '').trim();
const slugs = shared
  ? [...new Set(process.env.DRUID_INSTANCES.split(',').map((x) => x.trim()).filter(Boolean))]
  : [(process.env.DRUID_INSTANCE || 'centrale').trim()];
for (const slug of slugs) if (!SLUG_RE.test(slug)) fail(`invalid instance slug: "${slug}" (expected [a-z0-9-]+)`);
if (shared && process.env.DRUID_INSTANCE) console.warn('[prepare-cloudflare-assets] DRUID_INSTANCE ignored: DRUID_INSTANCES is set (shared deployment)');

/** Clone of the private instances repository, made once, on first need. */
let privateClone = null;
const privateRepoDir = (slug) => {
  if (privateClone) return privateClone;
  const token = process.env.INSTANCES_REPO_TOKEN;
  const repo = process.env.INSTANCES_REPO || 'guillaumegodet/druid-instances';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`invalid INSTANCES_REPO: "${repo}"`);
  // Fail loudly: a typo in the slug or a missing secret would otherwise deploy a site
  // without data; a failed build keeps the previous deployment online.
  if (!token) fail(`instance "${slug}" is not in instances/ and INSTANCES_REPO_TOKEN is not set`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'druid-instances-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', `https://x-access-token:${token}@github.com/${repo}.git`, dir], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    // Never print the clone URL: it carries the token.
    const detail = String(err.stderr || '').split(token).join('***').trim();
    fail(`cannot clone ${repo} (token expired or without access?): ${detail}`);
  }
  console.log(`[prepare-cloudflare-assets] instance data from ${repo}`);
  privateClone = dir;
  return dir;
};

/** Folder of an instance: local, otherwise from the private instances repository. */
const resolveInstanceDir = (slug) => {
  const local = path.join(__dirname, '..', 'instances', slug);
  if (fs.existsSync(local)) return local;
  const remote = path.join(privateRepoDir(slug), slug);
  if (!fs.existsSync(remote)) fail(`unknown instance "${slug}": no ${slug}/ folder in the instances repository`);
  return remote;
};

/** Validated instance.json of an instance, or null when its folder has none yet. */
const loadConfig = (slug, dir) => {
  const file = path.join(dir, 'instance.json');
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`${slug}/instance.json is not valid JSON: ${err.message}`);
  }
  const result = parseInstanceConfig(raw, { folder: slug });
  if (!result.ok) fail(`invalid ${slug}/instance.json:\n  - ${result.errors.join('\n  - ')}`);
  if (result.config.target !== 'cloudflare') fail(`${slug}/instance.json has target "${result.config.target}", not "cloudflare"`);
  return result.config;
};

const dirs = Object.fromEntries(slugs.map((slug) => [slug, resolveInstanceDir(slug)]));
const configs = slugs.map((slug) => {
  const config = loadConfig(slug, dirs[slug]);
  if (!config && shared) fail(`${slug}/instance.json is required on a shared deployment (DRUID_INSTANCES)`);
  if (!config) console.warn('[prepare-cloudflare-assets] no instance.json: configuration from the Pages variables only');
  return config;
});
console.log(`[prepare-cloudflare-assets] ${shared ? 'shared deployment, instances' : 'instance'}: ${slugs.join(', ')}`);

let registry = null;
if (configs[0]) {
  const built = buildRegistry(configs, { mode: shared ? 'multi' : 'single' });
  if (!built.ok) fail(`invalid registry:\n  - ${built.errors.join('\n  - ')}`);
  registry = built.registry;
}
const generatedDir = path.join(__dirname, '..', 'functions', '_generated');
fs.rmSync(generatedDir, { recursive: true, force: true });   // also drops the instance.js of lot 5
fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(path.join(generatedDir, 'registry.js'),
  `// Generated by scripts/prepare-cloudflare-assets.cjs (${slugs.join(', ')}${registry ? '' : ', no instance.json'}) — do not edit.\n`
  + `export default ${JSON.stringify(registry, null, 2)};\n`);
console.log('[prepare-cloudflare-assets] functions/_generated/registry.js written');

const envFile = path.join(__dirname, '..', '.env.production.local');
if (shared) {
  fs.rmSync(envFile, { force: true });
  const settings = compareEnvWithConfig(configs[0], process.env).map(({ name }) => name);
  if (settings.length) console.warn(`[prepare-cloudflare-assets] ignored on a shared deployment (settings come from each instance.json): ${settings.join(', ')}`);
  console.log('[prepare-cloudflare-assets] shared deployment: no instance asset copied into public/');
  process.exit(0);
}

const instance = slugs[0];
const srcDir = dirs[instance];
const destDir = path.join(__dirname, '..', 'public');
if (registry) {
  const config = registry.instances[instance];
  const viteEnv = viteEnvFromConfig(config);
  fs.writeFileSync(envFile,
    `# Generated by scripts/prepare-cloudflare-assets.cjs from instances/${instance}/instance.json\n`
    + Object.entries(viteEnv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  console.log(`[prepare-cloudflare-assets] .env.production.local: ${Object.keys(viteEnv).join(', ')}`);
  for (const { name, status, detail } of compareEnvWithConfig(config, process.env)) {
    if (status === 'same') console.warn(`[prepare-cloudflare-assets] Pages variable ${name} repeats instance.json: remove it from the Pages dashboard`);
    else console.warn(`[prepare-cloudflare-assets] Pages variable ${name} overrides instance.json${detail}: move its value into instance.json, then remove it`);
  }
}
// No Qualinka cache: the Cloudflare instances have no Qualinka engine (HAS_QUALINKA false), their
// unified view reads the search entries of idref_align_cache.json.
const CACHES = ['idref_align_cache', 'orcid_align_cache', 'hal_align_cache', 'openalex_align_cache', 'scopus_align_cache'];
const mapping = Object.fromEntries(CACHES.map((name) => [`${instance}-${name}.json`, `${name}.json`]));

for (const [src, dest] of Object.entries(mapping)) {
  const srcPath = path.join(srcDir, src);
  const destPath = path.join(destDir, dest);
  if (!fs.existsSync(srcPath)) {
    console.warn(`[prepare-cloudflare-assets] missing, skipped: ${srcPath}`);
    continue;
  }
  fs.copyFileSync(srcPath, destPath);
  console.log(`[prepare-cloudflare-assets] ${src} -> public/${dest}`);
}

const dashboardSrc = path.join(srcDir, 'dashboard-data');
const dashboardDest = path.join(destDir, 'dashboard-data');
if (fs.existsSync(dashboardSrc)) {
  fs.rmSync(dashboardDest, { recursive: true, force: true });
  fs.cpSync(dashboardSrc, dashboardDest, { recursive: true });
  console.log('[prepare-cloudflare-assets] dashboard-data/ -> public/dashboard-data/');
} else {
  console.warn(`[prepare-cloudflare-assets] missing, skipped: ${dashboardSrc}`);
}
