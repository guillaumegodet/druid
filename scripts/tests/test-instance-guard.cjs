// Run: docker run --rm -v "$PWD":/app -w /app -e DRUID_ENV=test -e VITE_GRIST_DOC_ID=docA -e GRIST_API_KEY=k node:20-slim node scripts/tests/test-instance-guard.cjs
// Non-production instance (plan-separation-test-prod-rssi.md, lot 3): reserved to super admins, nothing public.
const path = require('path');

if ((process.env.DRUID_ENV || 'production') === 'production') {
  console.error('Run with DRUID_ENV=test');
  process.exit(2);
}
const { app, restrictToAdmins } = require(path.join(__dirname, '../../server.cjs'));

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`}`);
};

const guard = (p, user) => new Promise((resolve) => {
  const req = { path: p, session: user ? { user } : {} };
  const res = {
    status(c) { this.code = c; return this; },
    json() { resolve(this.code); },
    type() { return this; },
    send() { resolve(this.code); },
  };
  restrictToAdmins(req, res, () => resolve('NEXT'));
});

(async () => {
  const admin = { access: { isSuperAdmin: true } };
  const viewer = { access: { isSuperAdmin: false, isLabViewer: true } };
  check('super admin: API', await guard('/api/me', admin), 'NEXT');
  check('lab viewer: API refused', await guard('/api/me', viewer), 403);
  check('lab viewer: page refused', await guard('/', viewer), 403);
  check('lab viewer: logout reachable', await guard('/auth/logout', viewer), 'NEXT');
  check('lab viewer: health reachable', await guard('/api/health', viewer), 'NEXT');
  check('anonymous: left to the auth guard', await guard('/api/v1/x', null), 'NEXT');

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = async (p) => (await fetch(base + p, { redirect: 'manual' })).status;
  check('embed not public', await status('/embed'), 302);
  check('public API not public', await status('/api/public/photo?src=nope'), 401);
  check('health still public', await status('/api/health'), 200);
  server.close();

  console.log(ko ? `${ko} failure(s)` : 'All checks passed');
  process.exit(ko ? 1 : 0);
})();
