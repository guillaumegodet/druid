// Service tokens: machine clients (druid-biblio ETL, media_watch…) reading the directory through /api/v1 without a
// Keycloak session (druid-internal docs/plan-migration-postgresql.md, lot 8 a).
//
// Configuration: DRUID_SERVICE_TOKENS = comma-separated `<name>:<sha256 hex of the token>` entries. Only the
// fingerprint is stored on the server; the token itself goes to the client (its own secret store). A client sends
// `Authorization: Bearer <token>`. A token reads the institution-wide directory, on a few GET routes only.
//
// New token:  node scripts/lib/service_tokens.cjs new <name>   → prints the token (for the client) and the entry
// (for DRUID_SERVICE_TOKENS). Revocation: remove the entry and restart the server.
const crypto = require('crypto');

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

/** Read routes open to a service token: the lists a client needs to rebuild a lab's staff, nothing else. */
const SERVICE_READ_ROUTES = ['/api/v1/people', '/api/v1/structures', '/api/v1/institutions'];

const fingerprintOf = (token) => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

/**
 * Parses DRUID_SERVICE_TOKENS. Malformed entries are skipped and reported in `rejected` (never their value: an entry
 * holding a raw token by mistake must not end up in the logs).
 */
const parseServiceTokens = (raw) => {
  const tokens = [];
  const rejected = [];
  String(raw || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((entry, i) => {
    const sep = entry.indexOf(':');
    const name = sep > 0 ? entry.slice(0, sep).trim() : '';
    const fingerprint = sep > 0 ? entry.slice(sep + 1).trim().toLowerCase() : '';
    if (!NAME.test(name) || !FINGERPRINT.test(fingerprint)) rejected.push(`entry ${i + 1}`);
    else if (tokens.some((t) => t.name === name)) rejected.push(`entry ${i + 1} (duplicate name ${name})`);
    else tokens.push({ name, fingerprint: Buffer.from(fingerprint, 'hex') });
  });
  return { tokens, rejected };
};

/** Bearer token of the request, '' when the header is absent or of another scheme. */
const bearerOf = (authorization) => {
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(String(authorization || ''));
  return m ? m[1] : '';
};

/** Name of the service whose fingerprint matches `token`, or null. Every entry is compared (constant time). */
const serviceOfToken = (tokens, token) => {
  if (!token) return null;
  const fingerprint = Buffer.from(fingerprintOf(token), 'hex');
  let found = null;
  for (const t of tokens) {
    if (crypto.timingSafeEqual(t.fingerprint, fingerprint) && !found) found = t.name;
  }
  return found;
};

/** A service token may only read the routes of SERVICE_READ_ROUTES (any query string). */
const serviceMayRequest = (method, path) =>
  (method === 'GET' || method === 'HEAD') && SERVICE_READ_ROUTES.includes(String(path).replace(/\/+$/, ''));

/**
 * Express middleware: a request carrying `Authorization: Bearer` is a service request — authenticated by its token
 * (401 otherwise, no fallback to the session) and limited to SERVICE_READ_ROUTES (403). Sets `req.service = { name }`.
 * Requests without that header go through unchanged (browser session).
 */
const serviceTokenGuard = (tokens) => (req, res, next) => {
  const header = req.get('authorization');
  if (!header) return next();
  const name = serviceOfToken(tokens, bearerOf(header));
  if (!name) {
    req.serviceRefused = true;
    return res.status(401).json({ error: 'Invalid service token' });
  }
  req.service = { name };
  if (!serviceMayRequest(req.method, req.path)) return res.status(403).json({ error: 'Route not open to service tokens' });
  next();
};

module.exports = {
  SERVICE_READ_ROUTES, fingerprintOf, parseServiceTokens, bearerOf, serviceOfToken, serviceMayRequest, serviceTokenGuard,
};

if (require.main === module) {
  const [command, name] = process.argv.slice(2);
  if (command !== 'new' || !NAME.test(name || '')) {
    console.error('Usage: node scripts/lib/service_tokens.cjs new <name>   (name: a-z, 0-9, - or _, 40 characters at most)');
    process.exit(2);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  console.log(`Token (give it to the client, shown once):\n  ${token}`);
  console.log(`Entry for DRUID_SERVICE_TOKENS (server):\n  ${name}:${fingerprintOf(token)}`);
}
