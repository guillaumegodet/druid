/**
 * activity_log.cjs — access and audit logs of the server (druid-internal/docs/plan-separation-test-prod-rssi.md,
 * lot 6). One JSON object per line, UTC timestamps, two streams:
 *  - access.log: every request (except static assets and the liveness probe) — who, from where, what, result;
 *  - audit.log: the actions that matter for security — sign-in and sign-out, Grist writes (table, rows, NAMES of
 *    the fields, never their values), data exports, jobs started, administration reads, refusals (403).
 * With a directory (DRUID_LOG_DIR, mounted outside the container and rotated by the host) the lines go to
 * <dir>/access.log and <dir>/audit.log, reopened on SIGHUP after a rotation; without one, to stdout.
 * Never logged: query strings (they may carry names), request bodies, tokens, cookies, keys.
 * Plain CommonJS, no dependency (server.cjs).
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Requests left out of the access log: static files and the probe called every 30 s. */
const isQuietPath = (p) =>
  p.startsWith('/assets/') || p.startsWith('/vendor/') || p.startsWith('/instance-assets/') ||
  p === '/favicon.ico' || p === '/api/health' || /\.(png|svg|ico|webmanifest|woff2?)$/.test(p);

/** GET routes with side effects (they start a background job). */
const JOB_GET = /^\/api\/(sync-[a-z-]+-trigger|tasks\/detect\/trigger)$/;
/** POST routes that call a language model (data sent outside: logged as such). */
const PREVIEW_POST = /^\/api\/v1\/site-imports\/preview$/;
const AI_POST = /^\/api\/(help-chat|chat|report-ai|newsletter\/generate|collab-theme\/(select-topics|synthesize))$/;

/**
 * Audit event of a finished request, or null. Pure: { method, path, status, signedIn, service, serviceRefused }.
 * `service`: request authenticated by a service token (lot 8 a of plan-migration-postgresql.md) — each of its reads
 * is logged (institution-wide data leaving the application); `serviceRefused`: a token that matched no entry.
 * Sign-in/out and exports are logged where they happen (server.cjs), not here.
 */
const auditEventOf = ({ method, path: p, status, signedIn, service = false, serviceRefused = false }) => {
  if (serviceRefused) return 'service.refused';
  if (status === 403) return 'access.denied';
  if (service) return status < 400 ? 'service.read' : null;
  if (!signedIn || status === 401) return null;
  if (p.startsWith('/api/audit/')) return null;
  if (method === 'GET') {
    if (JOB_GET.test(p)) return 'job.start';
    if (p.startsWith('/api/admin/')) return 'admin.read';
    return null;
  }
  if (!p.startsWith('/api/')) return null;
  if (AI_POST.test(p)) return 'ai.request';
  // POST that only computes a plan (site import preview, lot 8 d): a read, not audited like the other reads.
  if (PREVIEW_POST.test(p)) return null;
  return 'api.write';
};

/** Logger writing JSON lines to <dir>/access.log and <dir>/audit.log, or to `out` without a directory. */
const createActivityLog = ({ dir = '', environment = 'production', out = (line) => process.stdout.write(line) } = {}) => {
  const streams = {};
  const open = () => {
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['access', 'audit']) {
      const old = streams[name];
      streams[name] = fs.createWriteStream(path.join(dir, `${name}.log`), { flags: 'a', mode: 0o640 });
      streams[name].on('error', (err) => console.error(`[Log] ${name}.log:`, err.message));
      if (old) old.end();
    }
  };
  open();
  const write = (name, fields) => {
    const line = `${JSON.stringify({ ts: new Date().toISOString(), log: name, env: environment, ...fields })}\n`;
    if (streams[name]) streams[name].write(line);
    else out(line);
  };
  return {
    access: (fields) => write('access', fields),
    audit: (event, fields = {}) => write('audit', { event, ...fields }),
    /** After a rotation by the host (logrotate postrotate → SIGHUP). */
    reopen: open,
    toFiles: !!dir,
  };
};

module.exports = { createActivityLog, auditEventOf, isQuietPath };
