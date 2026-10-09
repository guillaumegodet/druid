// Run: docker run --rm -v "$PWD":/app -w /app -e VITE_GRIST_DOC_ID=docA -e GRIST_API_KEY=k node:20-slim node scripts/tests/service-tokens.cjs
// Service tokens (druid-internal docs/plan-migration-postgresql.md, lot 8 a): parsing of DRUID_SERVICE_TOKENS, routes
// open to a token, refusals, audit lines — through the real server.cjs. Fictitious tokens only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  fingerprintOf, parseServiceTokens, bearerOf, serviceOfToken, serviceMayRequest,
} = require(path.join(__dirname, '../lib/service_tokens.cjs'));

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`}`);
};

const TOKEN = 'test-token-druid-biblio';
const OTHER = 'test-token-media';

// ── Pure functions ──────────────────────────────────────────────────────────
const parsed = parseServiceTokens(` druid-biblio:${fingerprintOf(TOKEN)}, media_watch:${fingerprintOf(OTHER).toUpperCase()},`
  + `Bad Name:${fingerprintOf('x')},raw-token-by-mistake,short:abc,druid-biblio:${fingerprintOf('y')}`);
check('valid entries kept (fingerprint case ignored)', parsed.tokens.map((t) => t.name), ['druid-biblio', 'media_watch']);
check('malformed and duplicate entries reported by position, never by value',
  parsed.rejected, ['entry 3', 'entry 4', 'entry 5', 'entry 6 (duplicate name druid-biblio)']);
check('empty configuration', parseServiceTokens(undefined), { tokens: [], rejected: [] });
check('bearer of the header', [bearerOf(`Bearer ${TOKEN}`), bearerOf(`bearer  ${TOKEN} `), bearerOf('Basic abc'), bearerOf('Bearer a b'), bearerOf('')],
  [TOKEN, TOKEN, '', '', '']);
check('service of a token', [serviceOfToken(parsed.tokens, TOKEN), serviceOfToken(parsed.tokens, OTHER), serviceOfToken(parsed.tokens, 'nope'),
  serviceOfToken(parsed.tokens, '')], ['druid-biblio', 'media_watch', null, null]);
check('routes open to a token', [
  serviceMayRequest('GET', '/api/v1/people'), serviceMayRequest('HEAD', '/api/v1/structures'), serviceMayRequest('GET', '/api/v1/institutions/'),
  serviceMayRequest('POST', '/api/v1/people'), serviceMayRequest('GET', '/api/v1/merges'), serviceMayRequest('GET', '/api/v1/people/rows'),
  serviceMayRequest('GET', '/api/tasks'), serviceMayRequest('GET', '/api/me'),
], [true, true, true, false, false, false, false, false]);

// ── Through the server ──────────────────────────────────────────────────────
const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'druid-service-'));
process.env.DRUID_LOG_DIR = LOG_DIR;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DRUID_SERVICE_TOKENS = `druid-biblio:${fingerprintOf(TOKEN)}`;
const { app } = require(path.join(__dirname, '../../server.cjs'));
const lines = (name) => {
  const file = path.join(LOG_DIR, `${name}.log`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, { token = TOKEN, method = 'GET', headers = {} } = {}) => {
    const resp = await fetch(base + p, { method, redirect: 'manual', headers: { Authorization: `Bearer ${token}`, ...headers } });
    return { status: resp.status, body: await resp.text(), cookie: resp.headers.get('set-cookie') };
  };

  // Past the guards: /api/v1 answers (503 when the server-api.cjs bundle is not built, as in this test).
  const people = await call('/api/v1/people?lab=LAB-A');
  check('valid token reaches the directory API', [401, 403].includes(people.status), false);
  check('no session cookie for a service request', people.cookie, null);
  check('invalid token: 401, no fallback', (await call('/api/v1/people', { token: 'wrong' })).status, 401);
  check('valid token, route not open: 403', (await call('/api/tasks')).status, 403);
  check('valid token, institution tool: 403', (await call('/api/v1/merges')).status, 403);
  check('valid token, write: 403', (await call('/api/v1/people', { method: 'POST' })).status, 403);
  check('valid token, SPA page: 403', (await call('/')).status, 403);
  check('without the header: session guard as before', (await fetch(`${base}/api/v1/people`)).status, 401);
  await new Promise((r) => setTimeout(r, 200));
  server.close();

  const access = lines('access');
  const audit = lines('audit');
  check('access log names the service', access.filter((l) => l.path === '/api/v1/people' && l.user === 'service:druid-biblio').length > 0, true);
  check('refused token audited', audit.filter((l) => l.event === 'service.refused').map((l) => [l.path, l.status, l.user]),
    [['/api/v1/people', 401, null]]);
  check('routes refused to the service audited', audit.filter((l) => l.event === 'access.denied' && l.user === 'service:druid-biblio').length, 4);
  const all = fs.readFileSync(path.join(LOG_DIR, 'access.log'), 'utf8') + fs.readFileSync(path.join(LOG_DIR, 'audit.log'), 'utf8');
  check('no token, fingerprint or query string in the logs', [TOKEN, 'wrong', fingerprintOf(TOKEN), 'LAB-A'].filter((s) => all.includes(s)), []);

  fs.rmSync(LOG_DIR, { recursive: true, force: true });
  console.log(ko ? `${ko} failure(s)` : 'All checks passed');
  process.exit(ko ? 1 : 0);
})();
