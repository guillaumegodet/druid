#!/usr/bin/env node
// Build identity of Druid (druid-internal/docs/plan-separation-test-prod-rssi.md, lot 1): version,
// commit and date of the build, written to build-info.json at the app root before the Vite build
// (`npm run build`). The same file feeds the bundle (vite.config.ts → __DRUID_BUILD__) and the
// server (server.cjs → /api/me), so the version shown in the app is the one of the deployed image.
//
// Sources, in order:
//  - version: package.json (bumped by the release script, one version per tag);
//  - sha:     GIT_SHA (Docker build ARG, the .git folder is not in the build context),
//             CF_PAGES_COMMIT_SHA (Cloudflare Pages), else `git rev-parse` when a repository is
//             there (local build); a `-dirty` suffix marks a build from uncommitted changes;
//  - builtAt: BUILD_DATE (ISO 8601), else now.
// build-info.json is generated, never committed (.gitignore) nor copied from the build context
// (.dockerignore): it is rewritten at every build.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = 'build-info.json';

const gitSha = (root) => {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    let dirty = false;
    try {
      execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: root, stdio: 'ignore' });
    } catch {
      dirty = true;
    }
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return '';
  }
};

/** Build identity computed from the environment (see header). */
const collectBuildInfo = (root = path.join(__dirname, '..'), env = process.env) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    version: String(pkg.version || '0.0.0'),
    sha: String(env.GIT_SHA || env.CF_PAGES_COMMIT_SHA || gitSha(root) || ''),
    builtAt: String(env.BUILD_DATE || new Date().toISOString()),
  };
};

/** build-info.json written by the build, or the identity computed now when it is missing
 *  (development server, scripts run from a checkout). */
const readBuildInfo = (root = path.join(__dirname, '..')) => {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(root, FILE), 'utf8'));
    if (info && typeof info.version === 'string') return info;
  } catch { /* missing or unreadable: computed below */ }
  return collectBuildInfo(root);
};

module.exports = { collectBuildInfo, readBuildInfo, BUILD_INFO_FILE: FILE };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const info = collectBuildInfo(root);
  fs.writeFileSync(path.join(root, FILE), `${JSON.stringify(info, null, 2)}\n`);
  console.log(`[build-info] Druid ${info.version} (${info.sha || 'no commit'}) built ${info.builtAt}`);
}
