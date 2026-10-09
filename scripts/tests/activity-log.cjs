// Run: docker run --rm -v "$PWD":/app -w /app -e VITE_GRIST_DOC_ID=docA -e GRIST_API_KEY=k node:20-slim node scripts/tests/activity-log.cjs
// Access and audit logs (plan-separation-test-prod-rssi.md, lot 6): what is logged, and what never is.
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'druid-logs-'));
process.env.DRUID_LOG_DIR = LOG_DIR;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
const { auditEventOf, isQuietPath } = require(path.join(__dirname, '../lib/activity_log.cjs'));

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`}`);
};

// ── Audit events ────────────────────────────────────────────────────────────
const ev = (method, p, status, signedIn = true) => auditEventOf({ method, path: p, status, signedIn });
check('read of the domain API: not audited', ev('GET', '/api/v1/people', 200), null);
check('write through the domain API', ev('PUT', '/api/v1/people/12', 200), 'api.write');
check('refusal', ev('GET', '/api/v1/merges', 403), 'access.denied');
check('refusal, anonymous', ev('POST', '/api/tasks', 403, false), 'access.denied');
check('job started by GET', ev('GET', '/api/sync-ldap-trigger', 200), 'job.start');
check('job progress: not audited', ev('GET', '/api/sync-ldap-progress', 200), null);
check('administration read', ev('GET', '/api/admin/rights/users', 200), 'admin.read');
check('call to a language model', ev('POST', '/api/report-ai', 200), 'ai.request');
check('other write', ev('POST', '/api/sync-sovisuplus', 200), 'api.write');
check('site import preview: a read', ev('POST', '/api/v1/site-imports/preview', 200), null);
check('site import application', ev('POST', '/api/v1/site-imports/apply', 200), 'api.write');
check('anonymous 401: not audited', ev('POST', '/api/tasks', 401, false), null);
check('export report: logged by its route', ev('POST', '/api/audit/export', 204), null);
// Service tokens (plan-migration-postgresql.md lot 8 a): every read is audited, refusals too.
const svc = (method, p, status, extra) => auditEventOf({ method, path: p, status, signedIn: true, service: true, ...extra });
check('service read', svc('GET', '/api/v1/people', 200), 'service.read');
check('service read failed: not audited', svc('GET', '/api/v1/people', 502), null);
check('service on a closed route', svc('GET', '/api/tasks', 403), 'access.denied');
check('unknown service token', auditEventOf({ method: 'GET', path: '/api/v1/people', status: 401, signedIn: false, serviceRefused: true }), 'service.refused');
check('static files are quiet', [isQuietPath('/assets/index.js'), isQuietPath('/api/health'), isQuietPath('/api/me')], [true, true, false]);

// ── Through the server ──────────────────────────────────────────────────────
const { app, activity } = require(path.join(__dirname, '../../server.cjs'));
const lines = (name) => {
  const file = path.join(LOG_DIR, `${name}.log`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
(async () => {
  check('logs go to files', activity.toFiles, true);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/health`);
  await fetch(`${base}/api/me?nom=Dupont&token=abc`, { headers: { Cookie: 'connect.sid=s%3Asecret', Authorization: 'Bearer abc' } });
  await fetch(`${base}/auth/callback?code=c&state=s`, { redirect: 'manual' });
  await new Promise((r) => setTimeout(r, 200));
  server.close();

  const access = lines('access');
  const audit = lines('audit');
  check('probe not in the access log', access.some((l) => l.path === '/api/health'), false);
  const me = access.find((l) => l.path === '/api/me');
  check('request logged with status, method, anonymous user', me && [me.method, me.status, me.user, me.env], ['GET', 401, null, 'production']);
  check('request id and timing', !!(me && /^[0-9a-f]{12}$/.test(me.req) && Number.isFinite(me.ms) && me.ts), true);
  check('failed sign-in audited', audit.some((l) => l.event === 'auth.login_failed' && l.reason === 'invalid_state'), true);
  const all = fs.readFileSync(path.join(LOG_DIR, 'access.log'), 'utf8') + fs.readFileSync(path.join(LOG_DIR, 'audit.log'), 'utf8');
  check('no query string, cookie or token in the logs', ['Dupont', 'token=', 'secret', 'Bearer', 'connect.sid'].filter((s) => all.includes(s)), []);

  // Rotation: the files are reopened on demand (SIGHUP in production).
  fs.renameSync(path.join(LOG_DIR, 'audit.log'), path.join(LOG_DIR, 'audit.log.1'));
  activity.reopen();
  activity.audit('test.rotation', {});
  await new Promise((r) => setTimeout(r, 100));
  check('new file after reopen', lines('audit').map((l) => l.event), ['test.rotation']);

  fs.rmSync(LOG_DIR, { recursive: true, force: true });
  console.log(ko ? `${ko} failure(s)` : 'All checks passed');
  process.exit(ko ? 1 : 0);
})();
