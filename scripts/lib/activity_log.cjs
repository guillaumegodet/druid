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
const AI_POST = /^\/api\/(help-chat|chat|report-ai|newsletter\/generate|collab-theme\/(select-topics|synthesize))$/;

/**
 * Summary of a Grist write relayed by the proxy: document, table, kind, rows and field names. Pure.
 * `gristPath` = the part after /api/grist/ (e.g. docs/<doc>/tables/Annuaire/records?…).
 */
const gristWriteSummary = (method, gristPath, body) => {
  const clean = String(gristPath || '').split('?')[0];
  const m = clean.match(/^docs\/([^/]+)(?:\/tables\/([^/]+)\/(records|data\/delete|columns))?(?:\/(apply))?/);
  const summary = { doc: m?.[1] || null, table: m?.[2] || null };
  if (m?.[4] === 'apply' || clean.endsWith('/apply')) {
    // User actions: [["UpdateRecord", "Table", id, {fields}], …] — action names, tables, field names.
    const actions = Array.isArray(body) ? body.filter(Array.isArray) : [];
    summary.kind = 'apply';
    summary.actions = [...new Set(actions.map((a) => String(a[0])))].slice(0, 20);
    summary.tables = [...new Set(actions.map((a) => String(a[1] ?? '')).filter(Boolean))].slice(0, 20);
    summary.count = actions.length;
    return summary;
  }
  const sub = m?.[3];
  if (sub === 'data/delete') {
    const ids = Array.isArray(body) ? body : [];
    return { ...summary, kind: 'delete', count: ids.length, rows: ids.slice(0, 50) };
  }
  if (sub === 'columns') {
    const cols = Array.isArray(body?.columns) ? body.columns : [];
    return { ...summary, kind: 'columns', count: cols.length, fields: cols.map((c) => String(c?.id ?? '')).slice(0, 50) };
  }
  const records = Array.isArray(body?.records) ? body.records : [];
  const fields = new Set();
  for (const r of records) for (const k of Object.keys((r && r.fields) || {})) fields.add(k);
  const ids = records.map((r) => r?.id).filter((id) => id !== undefined);
  return {
    ...summary,
    kind: method === 'POST' ? 'add' : method === 'PUT' ? 'upsert' : method === 'DELETE' ? 'delete' : 'update',
    count: records.length,
    ...(ids.length ? { rows: ids.slice(0, 50) } : {}),
    fields: [...fields].slice(0, 80),
  };
};

/**
 * Audit event of a finished request, or null. Pure: { method, path, status, signedIn }.
 * Sign-in/out and exports are logged where they happen (server.cjs), not here.
 */
const auditEventOf = ({ method, path: p, status, signedIn }) => {
  if (status === 403) return 'access.denied';
  if (!signedIn || status === 401) return null;
  if (p.startsWith('/api/grist/')) return method === 'GET' ? null : 'grist.write';
  if (p.startsWith('/api/audit/')) return null;
  if (method === 'GET') {
    if (JOB_GET.test(p)) return 'job.start';
    if (p.startsWith('/api/admin/')) return 'admin.read';
    return null;
  }
  if (!p.startsWith('/api/')) return null;
  if (AI_POST.test(p)) return 'ai.request';
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

module.exports = { createActivityLog, gristWriteSummary, auditEventOf, isQuietPath };
