#!/usr/bin/env node
// Reloads the database of a fictitious instance at each production build on Cloudflare Pages (druid-internal
// docs/plan-migration-postgresql.md, lot 10 b): migrations (dbmate) then the seed (scripts/.build/seed_demo_pg.cjs,
// bundled by `npm run build:seed`), as the database owner. Last step of `npm run build`; does nothing unless:
//  - CF_PAGES=1 and CF_PAGES_BRANCH is the production branch (`main`): a preview build never touches the database
//    the production deployment reads — or DRUID_SEED_DEMO=1 (a deployment made elsewhere, e.g. GitHub Actions);
//  - DEMO_DATABASE_URL (build secret, role druid_owner) is set: DEMO_DATABASE_URL__<SLUG> per instance on a shared
//    deployment (DRUID_SEED_INSTANCES=demo,demo-2), the plain one for the instance of DRUID_INSTANCE.
// The database of a real instance is never seeded: only the instances with a data file in this repository are known
// to the seed script (instances/demo, instances/demo-2).
const { execFileSync } = require('child_process');
const path = require('path');

const env = process.env;
const log = (m) => console.log(`[seed-demo-on-pages] ${m}`);
const forced = env.DRUID_SEED_DEMO === '1';
if (!forced && !(env.CF_PAGES === '1' && env.CF_PAGES_BRANCH === 'main')) {
  log(env.CF_PAGES === '1' ? `preview build (${env.CF_PAGES_BRANCH || '?'}): database untouched.` : 'not a Cloudflare production build: nothing to seed.');
  process.exit(0);
}
const suffix = (slug) => String(slug).toUpperCase().replace(/[^A-Z0-9]/g, '_');
const slugs = String(env.DRUID_SEED_INSTANCES || env.DRUID_INSTANCE || '').split(',').map((s) => s.trim()).filter(Boolean);
const targets = slugs.map((slug) => ({ slug, url: env[`DEMO_DATABASE_URL__${suffix(slug)}`] || (slugs.length === 1 ? env.DEMO_DATABASE_URL : '') }))
  .filter((t) => t.url);
if (!targets.length) { log('no DEMO_DATABASE_URL for this build: database untouched.'); process.exit(0); }

const root = path.join(__dirname, '..');
const bin = (name) => path.join(root, 'node_modules', '.bin', name);
for (const { slug, url } of targets) {
  log(`${slug}: migrations…`);
  execFileSync(bin('dbmate'), ['--migrations-dir', 'db/migrations', '--no-dump-schema', '--url', url, 'up'], { cwd: root, stdio: 'inherit' });
  log(`${slug}: seed…`);
  execFileSync(process.execPath, [path.join(root, 'scripts', '.build', 'seed_demo_pg.cjs'), '--instance', slug, '--apply'],
    { cwd: root, stdio: 'inherit', env: { ...env, DATABASE_URL: url } });
}
