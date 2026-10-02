// Run: docker run --rm -v "$PWD":/app -w /app -e VITE_GRIST_DOC_ID=docA -e GRIST_API_KEY=k node:20-slim node scripts/tests/server-guards.cjs
// Harness for the lot 1 fixes (server.cjs review of 2026-09-16, points 2, 3, 7, 10):
// anti-CSRF guard, OAuth callback, progress files, csvEscape.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, rejectCrossSite, safeReturnTo, csvEscape, runningProgress, settleProgress, startBackgroundRun } =
  require(path.join(__dirname, '../../server.cjs'));

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (attendu ${JSON.stringify(want)})`}`);
};

// ── Point 3: rejectCrossSite (isolated middleware) ──────────────────────────
const csrf = (method, p, headers = {}) => new Promise((resolve) => {
  const req = { method, path: p, get: (h) => headers[h.toLowerCase()] };
  const res = { status(c) { this.code = c; return this; }, json() { resolve(this.code); } };
  rejectCrossSite(req, res, () => resolve('NEXT'));
});
(async () => {
  check('GET /api same-origin', await csrf('GET', '/api/me', { 'sec-fetch-site': 'same-origin' }), 'NEXT');
  check('GET /api typed URL (none)', await csrf('GET', '/api/me', { 'sec-fetch-site': 'none' }), 'NEXT');
  check('GET cross-site trigger', await csrf('GET', '/api/sync-ldap-trigger', { 'sec-fetch-site': 'cross-site' }), 403);
  check('GET same-site trigger (subdomain)', await csrf('GET', '/api/sync-ldap-trigger', { 'sec-fetch-site': 'same-site' }), 403);
  check('POST /api cross-site', await csrf('POST', '/api/sync-sovisuplus', { 'sec-fetch-site': 'cross-site' }), 403);
  check('POST /api without headers (curl)', await csrf('POST', '/api/sync-sovisuplus', {}), 'NEXT');
  check('POST /api Origin = host (vieux navigateur)', await csrf('POST', '/api/grist/x', { origin: 'http://druid.local', host: 'druid.local' }), 'NEXT');
  check('POST /api Origin ≠ host', await csrf('POST', '/api/grist/x', { origin: 'http://evil.example', host: 'druid.local' }), 403);
  check('POST /api invalid Origin', await csrf('POST', '/api/grist/x', { origin: 'null', host: 'druid.local' }), 403);
  check('GET page SPA cross-site (lien externe)', await csrf('GET', '/structures', { 'sec-fetch-site': 'cross-site' }), 'NEXT');
  check('GET /api/public cross-site', await csrf('GET', '/api/public/photo', { 'sec-fetch-site': 'cross-site' }), 'NEXT');

  // ── Point 2: OAuth callback (full app, ephemeral port, no session) ────────
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = async (p, opts) => (await fetch(base + p, { redirect: 'manual', ...opts })).status;
  check('callback without state', await status('/auth/callback?code=abc'), 400);
  check('callback state without session (undefined === undefined before)', await status('/auth/callback?code=abc&state=xyz'), 400);
  check('callback state tableau', await status('/auth/callback?code=abc&state=a&state=b'), 400);
  // Requested page kept across the login (back button / shared links, 2026-09-30).
  const location = async (p) => (await fetch(base + p, { redirect: 'manual' })).headers.get('location');
  check('guard keeps the requested page', await location('/?page=TASKS&tab=taches'), '/auth/login?next=%2F%3Fpage%3DTASKS%26tab%3Dtaches');
  check('guard on / without next', await location('/'), '/auth/login');
  check('returnTo local path', safeReturnTo('/?page=TASKS&tab=taches'), '/?page=TASKS&tab=taches');
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/auth/callback?code=x', undefined, ['/x']]) {
    check(`returnTo rejects ${JSON.stringify(bad)}`, safeReturnTo(bad), '/');
  }
  // Liveness probe (plan-separation-test-prod-rssi lot 1): public, and says nothing about the build.
  const health = await fetch(base + '/api/health');
  check('health without session', health.status, 200);
  check('health body', await health.json(), { status: 'ok' });
  check('me without session', await status('/api/me'), 401);
  // Security headers (lot 7): framing refused except for the embed pages, no X-Powered-By.
  const hdr = (await fetch(base + '/api/health')).headers;
  check('security headers', [hdr.get('x-content-type-options'), hdr.get('x-frame-options'), hdr.get('x-powered-by'), hdr.get('referrer-policy')],
    ['nosniff', 'SAMEORIGIN', null, 'strict-origin-when-cross-origin']);
  check('embed pages can be framed', (await fetch(base + '/embed/x', { redirect: 'manual' })).headers.get('x-frame-options'), null);
  check('sync-sovisuplus without session', await status('/api/sync-sovisuplus', { method: 'POST' }), 401);
  check('sync-ldap-trigger without session', await status('/api/sync-ldap-trigger'), 401);
  check('newsletter/generate without session', await status('/api/newsletter/generate', { method: 'POST' }), 401);
  check('affiliation-history without session', await status('/api/researchers/abc/affiliation-history'), 401);
  check('affiliation-history refresh without session', await status('/api/researchers/abc/affiliation-history/refresh', { method: 'POST' }), 401);
  check('photo proxy forbidden host', await status('/api/public/photo?src=http://crisalid-neo4j:7474/'), 403);
  check('photo proxy invalid src', await status('/api/public/photo?src=nope'), 400);
  server.close();

  // ── Point 7: progress files ───────────────────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'druid-progress-'));
  const pf = path.join(dir, 'p.json');
  check('runningProgress missing', runningProgress(pf), null);
  fs.writeFileSync(pf, 'pas du json');
  check('runningProgress illisible', runningProgress(pf), null);
  fs.writeFileSync(pf, JSON.stringify({ running: false, done: 3 }));
  check('runningProgress finished', runningProgress(pf), null);
  check('settleProgress already finished', settleProgress(pf, 'x'), false);
  fs.writeFileSync(pf, JSON.stringify({ running: true, mode: 'search', total: 10, done: 2 }));
  check('runningProgress en cours', runningProgress(pf)?.done, 2);
  check('settleProgress en cours', settleProgress(pf, 'Interrompu'), true);
  const settled = JSON.parse(fs.readFileSync(pf, 'utf8'));
  check('settleProgress keeps the fields + error', [settled.running, settled.mode, settled.done, settled.error, !!settled.finishedAt], [false, 'search', 2, 'Interrompu', true]);

  // Child that dies without writing its progress (the « mot de passe LDAP absent » case)
  // startBackgroundRun calls child.unref() (in prod the server keeps the loop alive): here we re-ref
  // so that the harness waits for the child to exit instead of stopping before.
  const waitExit = (child) => { child.ref(); return new Promise((r) => child.on('exit', () => setImmediate(r))); };
  let child = startBackgroundRun('test', pf, { mode: 'verify' }, ['-e', 'process.exit(2)']);
  check('startBackgroundRun writes running:true before the spawn', runningProgress(pf)?.mode, 'verify');
  await waitExit(child);
  let p = JSON.parse(fs.readFileSync(pf, 'utf8'));
  check('child died without writing → closed', [p.running, p.error], [false, 'Script interrompu (code 2)']);
  // Child that closes its own progress: the server does not rewrite it
  child = startBackgroundRun('test', pf, {}, ['-e', `require('fs').writeFileSync(${JSON.stringify(pf)}, JSON.stringify({ running: false, done: 5 }))`]);
  await waitExit(child);
  p = JSON.parse(fs.readFileSync(pf, 'utf8'));
  check('child closes by itself → unchanged', [p.running, p.done, p.error], [false, 5, undefined]);
  // Child exited with 0 without closing
  child = startBackgroundRun('test', pf, {}, ['-e', '0']);
  await waitExit(child);
  p = JSON.parse(fs.readFileSync(pf, 'utf8'));
  check('child exited 0 without closing → closed', [p.running, p.error], [false, 'Script terminé sans clore sa progression']);
  fs.rmSync(dir, { recursive: true, force: true });

  // ── Point 10: csvEscape ───────────────────────────────────────────────────
  check('csvEscape simple', csvEscape('Dupont'), 'Dupont');
  check('csvEscape vide/null', [csvEscape(null), csvEscape(undefined), csvEscape('')], ['', '', '']);
  check('csvEscape virgule', csvEscape('a,b'), '"a,b"');
  check('csvEscape guillemets', csvEscape('a"b'), '"a""b"');
  check('csvEscape LF', csvEscape('a\nb'), '"a\nb"');
  check('csvEscape CR seul', csvEscape('a\rb'), '"a\rb"');
  check('csvEscape CRLF', csvEscape('a\r\nb'), '"a\r\nb"');

  console.log(ko ? `\n${ko} KO` : '\nAll OK');
  process.exit(ko ? 1 : 0);
})();
