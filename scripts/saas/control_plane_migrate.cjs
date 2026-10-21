// Migrations of the control plane of a multi-tenant deployment (db/saas/migrations, schema `saas`): `npm run
// db:saas:migrate` / `db:saas:rollback`. The URL gets `search_path=saas` whatever its existing query string, so that
// dbmate creates the tables and its schema_migrations in that schema (druid-internal docs/plan-druid-saas.md, lot 1 a).
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const command = process.argv[2] || 'up';
if (!['up', 'rollback', 'status'].includes(command)) {
  console.error('usage: control_plane_migrate.cjs <up|rollback|status>');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL (owner role) is required');
  process.exit(2);
}
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('search_path', 'saas');
const bin = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'dbmate');
const res = spawnSync(bin, ['-u', url.toString(), '--migrations-dir', path.join(__dirname, '..', '..', 'db', 'saas', 'migrations'), '--no-dump-schema', command], { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);
