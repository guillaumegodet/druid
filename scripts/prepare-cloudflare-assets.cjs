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

if (process.env.CF_PAGES !== '1') {
  console.log('[prepare-cloudflare-assets] CF_PAGES not set: Docker/Nantes build, nothing to copy.');
  process.exit(0);
}

const fail = (msg) => {
  console.error(`[prepare-cloudflare-assets] ${msg}`);
  process.exit(1);
};

const instance = (process.env.DRUID_INSTANCE || 'centrale').trim();
if (!/^[a-z0-9-]+$/.test(instance)) fail(`invalid DRUID_INSTANCE: "${instance}" (expected [a-z0-9-]+)`);

/** Folder of the instance: local, otherwise from the private instances repository. */
const resolveInstanceDir = () => {
  const local = path.join(__dirname, '..', 'instances', instance);
  if (fs.existsSync(local)) return local;
  const token = process.env.INSTANCES_REPO_TOKEN;
  const repo = process.env.INSTANCES_REPO || 'guillaumegodet/druid-instances';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`invalid INSTANCES_REPO: "${repo}"`);
  // Fail loudly: a typo in DRUID_INSTANCE or a missing secret would otherwise deploy a site
  // without data; a failed build keeps the previous deployment online.
  if (!token) fail(`instance "${instance}" is not in instances/ and INSTANCES_REPO_TOKEN is not set`);
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
  const remote = path.join(dir, instance);
  if (!fs.existsSync(remote)) fail(`unknown instance "${instance}": no ${instance}/ folder in ${repo}`);
  console.log(`[prepare-cloudflare-assets] instance data from ${repo}`);
  return remote;
};

const srcDir = resolveInstanceDir();
console.log(`[prepare-cloudflare-assets] instance: ${instance}`);
const destDir = path.join(__dirname, '..', 'public');
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
