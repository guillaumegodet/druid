/**
 * align_common.cjs — common foundation of the researcher-identifier alignment scripts
 * (IdRef today, ORCID and HAL to come — see docs/archive/plan-alignement-orcid-hal.md, lot 1).
 *
 * Extracted from scripts/sync_idref.cjs on 2026-09-09 WITHOUT behavior change:
 *   - CLI option parsing (--mode=, --limit=, --labo=, --group=, --concurrency=…);
 *   - text normalization (see pydref.normalize) and PPN extraction;
 *   - HTTP with retry/timeout and concurrency pool;
 *   - Grist access (Annuaire, GET/POST/PATCH, blacklist of a review table);
 *   - cache / progress files (at the app root, bind-mounted — see druid.yaml —
 *     and copied into dist/ for compatibility);
 *   - generic push of the suggestions into a collaborative Grist review table
 *     (upsert by key, decided rows never touched again, purge of obsolete suggestions).
 *
 * Each source script keeps what is specific to it: remote API client,
 * candidate building, scoring, columns/formulas of ITS review table.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const tls = require('tls');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
/** --name=value (the value may contain « = »). */
const getArg = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
/** --flag (no value). */
const hasFlag = (name) => args.includes(`--${name}`);

/**
 * Options common to all alignment scripts (same defaults as sync_idref.cjs).
 * `modes` = list of accepted modes (the first one is the default).
 */
function commonOptions({ modes = ['search', 'verify'], concurrency = 6 } = {}) {
  const rawMode = (getArg('mode', modes[0]) || modes[0]).toLowerCase();
  return {
    mode: modes.includes(rawMode) ? rawMode : modes[0],
    limit: parseInt(getArg('limit', '0'), 10) || 0,                     // 0 = no limit (debug)
    labo: (getArg('labo', '') || '').trim().toUpperCase(),              // `--labo=SIGLE` (`LABO` column)
    group: (getArg('group', '') || '').trim().toLowerCase(),            // personnel | doctorants | hors_recherche
    concurrency: parseInt(getArg('concurrency', String(concurrency)), 10) || concurrency,
    // --push-grist=false: computes without writing to the review table (dry-run/debug).
    pushGrist: (getArg('push-grist', 'true') || 'true').toLowerCase() !== 'false',
    force: hasFlag('force'),
    // `--record=<Grist row>`: one record only, searched again even if already processed (« Search this
    // record » in the drawer of the unified page, docs/plan-recherche-alignement-maitrisee.md, lot 3).
    record: parseInt(getArg('record', '0'), 10) || 0,
  };
}

// ── Text helpers (see pydref.normalize) ───────────────────────────────────────
function stripAccents(w) {
  return w.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normalize(x) {
  if (x === null || x === undefined) return '';
  let s = String(x).replace(/ /g, ' ').replace(/[\u2010-\u2015\u2212]/g, '-');   // Unicode dashes (Jean‐Jacques) → ASCII hyphen
  if (/Ã[\u0080-\u00BF]/.test(s)) { try { s = Buffer.from(s, 'latin1').toString('utf8'); } catch (e) { /* noop */ } }   // mojibake « JÃ©rÃ©mie » (OpenAlex)
  s = s.replace(/\\[`'^"~](\w)/g, '$1');   // LaTeX escapes « St\\'ephane » (OpenAlex)
  s = stripAccents(s).toLowerCase();
  s = s.replace(/[!-/:-@[-`{-~]/g, ' ');   // ASCII punctuation -> space (see delete_punct)
  return s.replace(/\s+/g, ' ').trim();
}
function extractPpn(raw) {
  // e.g. "059384115", "idref059384115", "https://www.idref.fr/059384115" -> "059384115"
  const m = String(raw || '').match(/([0-9]{6,}[0-9X])/i);
  return m ? m[1].toUpperCase() : '';
}
const today = () => new Date().toISOString().slice(0, 10);
/** "https://orcid.org/0000-0001-9900-9062", " 0000-0001-9900-9062" → "0000-0001-9900-9062". */
function extractOrcid(raw) {
  const m = String(raw || '').match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
  return m ? m[1].toUpperCase() : '';
}
/** ISO 7064 mod 11-2 check of the last character of an ORCID. */
function isValidOrcid(orcid) {
  const digits = String(orcid || '').replace(/-/g, '');
  if (!/^\d{15}[\dX]$/.test(digits)) return false;
  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + parseInt(digits[i], 10)) * 2;
  const check = (12 - (total % 11)) % 11;
  return (check === 10 ? 'X' : String(check)) === digits[15];
}

/** Tokens of a normalized name (accents/punctuation removed, lowercase). */
const nameTokens = (s) => normalize(String(s || '').replace(/\\[`'^"~](\w)/g, '$1').replace(/['’]/g, '')).split(' ').filter(Boolean);   // St\'ephane → Stephane ; GUYONVARC'H = GUYONVARCH
/**
 * Compares the name of an Annuaire record (first name + last name) with the name of a remote candidate.
 *  - 'exact'   : same tokens (in any order);
 *  - 'partial' : all last-name tokens present and one of the two sets included
 *                in the other (compound first name, middle name, particle…);
 *  - null      : no match.
 */
function nameMatch(queryFirst, queryLast, candidateFullName) {
  const q = new Set(nameTokens(`${queryFirst || ''} ${queryLast || ''}`));
  const c = new Set(nameTokens(candidateFullName));
  if (!q.size || !c.size) return null;
  const lastToks = nameTokens(queryLast || '');
  if (lastToks.length && !lastToks.every((t) => c.has(t))) return null;
  const qInC = [...q].every((t) => c.has(t));
  const cInQ = [...c].every((t) => q.has(t));
  if (qInC && cInQ) return 'exact';
  if (qInC || (cInQ && c.size >= 2)) return 'partial';
  return null;
}

/**
 * Suspected mixed identity from the name forms (OpenAlex plan § 8.2): a form carries a full first name
 * (≥ 3 letters, not an initial) foreign to the reference name — the first form (profile display_name)
 * and the record's first name if provided — e.g. « J. Mark Blanchard » under « Julien Blanchard ». Middle names
 * (« Lamine Hamida » under « Mohamed Lamine Hamida ») do not count. Returns [reference, form] or null.
 * A signal, never a decision.
 */
function heterogeneousFirstNames(lastName, forms, firstName = '') {
  // Two « equivalent » tokens: identical, or common prefix ≥ 4 letters (Alexandre / Alexander, Jean / Jeanne),
  // or edit distance ≤ 1 (Kristof / Kristoff). Last-name variants (Arakelyan / Arakelian) are
  // excluded by the same rule applied to the last-name tokens.
  const prefixLen = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  const editLe1 = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
    return d + (a.length - i) + (b.length - j) <= 1;
  };
  const same = (a, b) => a === b || prefixLen(a, b) >= 4 || editLe1(a, b);
  const lastToks = nameTokens(lastName);
  const firstToks = (f) => nameTokens(f).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !lastToks.some((l) => same(t, l)));
  const list = (forms || []).filter(Boolean);
  if (!list.length) return null;
  const ref = [...firstToks(list[0]), ...firstToks(firstName)];
  if (!ref.length) return null;
  for (const f of list.slice(1)) {
    const toks = firstToks(f);
    if (toks.length && !toks.some((t) => ref.some((r) => same(t, r)))) return [list[0], f];
  }
  return null;
}

// ── Outgoing proxy (FortiGate) ───────────────────────────────────────────────
// The container has no direct access to some hosts (api.archives-ouvertes.fr → « [FTG]
// Page Web Bloquée » 403 page) but the university proxy serves them. `fetch` (undici) ignores the
// HTTPS_PROXY/NO_PROXY variables: we tunnel ourselves (CONNECT) via https.request, without dependency.
// Env: HTTPS_PROXY (or https_proxy / HTTP_PROXY), NO_PROXY (list of suffixes), see druid.yaml.
function proxyFor(hostname) {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return null;
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const h = hostname.toLowerCase();
  if (noProxy.some((n) => n === '*' || h === n || h.endsWith(n.startsWith('.') ? n : `.${n}`))) return null;
  try { return new URL(raw); } catch (e) { return null; }
}
class ConnectProxyAgent extends https.Agent {
  constructor(proxy) { super({ keepAlive: false }); this.proxy = proxy; }
  createConnection(options, cb) {
    const target = `${options.host}:${options.port || 443}`;
    const req = http.request({
      host: this.proxy.hostname, port: this.proxy.port || 3128, method: 'CONNECT', path: target, headers: { Host: target },
    });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return cb(new Error(`Proxy CONNECT ${res.statusCode}`)); }
      cb(null, tls.connect({ socket, servername: options.host }));
    });
    req.once('error', cb);
    req.end();
  }
}
const proxyAgents = new Map();
function agentFor(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') return null;
  const proxy = proxyFor(u.hostname);
  if (!proxy) return null;
  const key = proxy.href;
  if (!proxyAgents.has(key)) proxyAgents.set(key, new ConnectProxyAgent(proxy));
  return proxyAgents.get(key);
}
/** GET via https.request (proxy path) → { status, text }. */
function httpsGet(url, { headers = {}, timeout = 8000, agent } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, retryAfter: res.headers['retry-after'], location: res.headers['location'], text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ── HTTP with retry (see pydref.get_url: delay 200ms, tries 5) ───────────────
// 429 (rate limit, e.g. OpenAlex 10 req/s): wait `Retry-After` if provided, otherwise 2 s × attempt —
// the 200 ms linear backoff was not enough (LS2N run of 2026-09-11: ~20% of records in error).
// Redirects (301/302/307/308): `redirect: 'follow'` (default) follows them — including on the proxy path,
// where https.request does not do it on its own, unlike fetch —; `redirect: 'manual'` raises a fatal
// error carrying `.redirect` (absolute URL) and `.status`, so that the caller can spot a moved resource
// (e.g. merged IdRef authority record: www.idref.fr/<old PPN> → 301 to the PPN that replaces it).
// `rateLimitWaitMs` (default 2 s) is the wait after a 429 without Retry-After: APIs with a known
// per-second limit (Elsevier) pass a shorter value, since their 429 clears within the second.
// `withHeaders: true` (Scopus, whose weekly quotas are only visible in the x-ratelimit-* headers)
// returns `{ status, headers, body }` instead of the bare body, and the thrown errors carry
// `.headers` (plain object, lower-case keys) when a response was received.
const REDIRECT_STATUSES = [301, 302, 307, 308];
const MAX_REDIRECTS = 5;
const plainHeaders = (h) => (h && typeof h.entries === 'function' ? Object.fromEntries(h.entries()) : (h || {}));
async function getUrl(url, { json = false, tries = 5, delay = 200, timeout = 8000, headers = {}, noRetry = [404], redirect = 'follow', withHeaders = false, rateLimitWaitMs = 2000 } = {}) {
  let lastErr;
  let wait = 0;
  let hops = 0;
  const wrap = (status, hdrs, body) => (withHeaders ? { status, headers: plainHeaders(hdrs), body } : body);
  const onRedirect = (location) => {
    if (!location) return false;
    const target = new URL(location, url).href;
    if (redirect === 'manual') {
      lastErr = new Error(`HTTP redirect → ${target}`);
      lastErr.fatal = true; lastErr.redirect = target; lastErr.status = 301;
      throw lastErr;
    }
    if (++hops > MAX_REDIRECTS) { lastErr = new Error('too many redirects'); lastErr.fatal = true; throw lastErr; }
    url = target;
    return true;
  };
  const onStatus = (status, retryAfter, hdrs) => {
    lastErr = new Error(`HTTP ${status}`);
    lastErr.status = status;
    lastErr.headers = plainHeaders(hdrs);
    if (noRetry.includes(status)) { lastErr.fatal = true; throw lastErr; }
    if (status === 429) {
      const ra = parseFloat(retryAfter) || 0;
      // Long Retry-After (e.g. OpenAlex daily budget exhausted: ~50,000 s): no point waiting, we bail out.
      if (ra > 30) { lastErr = new Error(`HTTP 429 (retry-after ${Math.round(ra)}s)`); lastErr.fatal = true; lastErr.retryAfter = ra; throw lastErr; }
      wait = Math.max(wait, ra * 1000, rateLimitWaitMs);
    }
  };
  for (let attempt = 0; attempt < tries; attempt++) {
    wait = 0;
    try {
      const hdrs = { 'User-Agent': 'Druid-CRISalid/1.0', ...headers };
      const agent = agentFor(url);
      if (agent) {
        // Host served through the FortiGate proxy (CONNECT tunnel) — same contract as the fetch path.
        const r = await httpsGet(url, { headers: hdrs, timeout, agent });
        if (REDIRECT_STATUSES.includes(r.status) && onRedirect(r.location)) { attempt--; continue; }
        if (r.status !== 200) onStatus(r.status, r.retryAfter, r.headers);
        else { return wrap(r.status, r.headers, json ? JSON.parse(r.text) : r.text); }
      } else {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        const r = await fetch(url, { signal: ctrl.signal, headers: hdrs, redirect: redirect === 'manual' ? 'manual' : 'follow' });
        clearTimeout(t);
        if (REDIRECT_STATUSES.includes(r.status) && onRedirect(r.headers.get('location'))) { attempt--; continue; }
        if (r.status !== 200) onStatus(r.status, r.headers.get('retry-after'), r.headers);
        else { return wrap(r.status, r.headers, json ? await r.json() : await r.text()); }
      }
    } catch (e) { lastErr = e; if (e.fatal) throw e; }
    await new Promise((res) => setTimeout(res, Math.max(delay * (attempt + 1), wait * (attempt + 1))));
  }
  throw lastErr || new Error('request failed');
}

// ── Stop on request ──────────────────────────────────────────────────────────
// « Stop » button of the alignment page: the server sends SIGTERM to the script. The first signal
// stops the main loop from starting new records (runPool `stoppable`); the records in progress
// finish, then the script ends as usual (cache, progress `stopped: true`, Grist writes of what was
// processed). A second signal exits at once. Installed by makeStore when a script of scripts/ is the
// main module — never in server.cjs, nor in a test runner that requires a script.
let stopRequested = false;
let stopHandlerInstalled = false;
const requestStop = () => {
  if (!stopRequested) console.warn('[align] stop requested: finishing the records in progress, then saving');
  stopRequested = true;
};
function installStopHandler() {
  const main = (require.main && require.main.filename) || '';
  if (stopHandlerInstalled || !/[\\/]scripts[\\/][^\\/]+\.cjs$/.test(main)) return;
  stopHandlerInstalled = true;
  process.on('SIGTERM', () => {
    if (stopRequested) process.exit(143);
    requestStop();
  });
}
const isStopRequested = () => stopRequested;

// ── Simple concurrency pool ──────────────────────────────────────────────────
/** `opts.stoppable`: no new item once a stop was requested (main loop of a script only — the
 * later phases, Grist writes of the processed records, must still run in full). */
async function runPool(items, worker, concurrency, onTick, { stoppable = false } = {}) {
  let idx = 0, done = 0;
  const results = new Array(items.length);
  async function next() {
    while (idx < items.length && !(stoppable && stopRequested)) {
      const i = idx++;
      try { results[i] = await worker(items[i], i); } catch (e) { results[i] = { error: e.message }; }
      done++;
      if (onTick) onTick(done, results[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

// ── Grist ─────────────────────────────────────────────────────────────────────
// Every read and write goes through the storage client of the jobs (scripts/lib/storage.cjs: the Grist client of
// the domain API, druid-internal docs/plan-migration-postgresql.md, lot 3) — no direct call to the Grist API here.
const storage = require('./storage.cjs');
const DOC = process.env.VITE_GRIST_DOC_ID;

/** The storage client (configuration checked on each use: VITE_GRIST_DOC_ID / GRIST_API_KEY). */
const grist = () => storage.grist();

/** Rows of a table; `filter` = Grist filter (column → accepted values). Missing table → error. */
const gristRecords = (table, filter) => grist().records(table, filter);
const gristTableIds = () => grist().tableIds();
const gristColumns = (table) => grist().columns(table);
const gristAddColumns = (table, columns) => grist().addColumns(table, columns);
const gristUpdateColumns = (table, columns) => grist().updateColumns(table, columns);

/** Writes in batches of 100 (practical limit of the Grist API). */
async function gristCreateRecords(table, rows) {
  const client = grist();
  for (let i = 0; i < rows.length; i += 100) {
    await client.addRecords(table, rows.slice(i, i + 100).map((fields) => ({ fields })));
  }
}
async function gristPatchRecords(table, records) {
  const client = grist();
  for (let i = 0; i < records.length; i += 100) await client.updateRecords(table, records.slice(i, i + 100));
}
/**
 * PATCH Annuaire in batches, grouped by column signature (same set of fields per
 * request, see GristService.applyIdrefUpdates). `records` = [{ id, fields }].
 */
async function gristPatchGrouped(table, records) {
  const groups = new Map();
  for (const rec of records) {
    const sig = Object.keys(rec.fields).sort().join(',');
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(rec);
  }
  for (const group of groups.values()) await gristPatchRecords(table, group);
  return records.length;
}
/**
 * Traceability fields of a direct write into the Annuaire (same convention as the
 * IdRef/LDAP reviews): Data_source += source, `<source>_derniere_maj`, `<source>_champs_modifies`,
 * dated line in Commentaires. `cur` = { dataSource, commentaires } of the record.
 */
function withTrace(source, cur, fields, noteLabel = '') {
  const day = today();
  const done = Object.keys(fields);
  const out = { ...fields };
  const src = String(cur.dataSource || '');
  const parts = src.split(/[|,]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!parts.includes(source.toUpperCase())) out.Data_source = src ? `${src}|${source}` : source;
  out[`${source}_derniere_maj`] = day;
  out[`${source}_champs_modifies`] = done.join('|');
  const note = `[${day}] MAJ ${source}${noteLabel ? ` (${noteLabel})` : ''}: ${done.join(', ')}`;
  const com = String(cur.commentaires || '');
  out.Commentaires = com ? `${com}\n${note}` : note;
  return out;
}
async function gristDeleteRecords(table, ids) {
  if (ids.length) await grist().deleteRecords(table, ids);
}

/**
 * Reads the Annuaire table and projects it into a shape common to all alignments.
 * Each script then applies its own filters (uid required or not, empty target…).
 *  - `key`: cache key (uid_dyna, otherwise `g<rowId>` for records without LDAP identity —
 *    same convention as sync_idref_qualinka.cjs / GristService.computeIdrefAlignDiff).
 */
async function fetchAnnuaire() {
  const records = await gristRecords('Annuaire');
  return (records || []).map((rec) => {
    const f = rec.fields;
    return {
      recId: rec.id,
      uid: f.uid_dyna || '',
      key: f.uid_dyna || `g${rec.id}`,
      first: f.Prenom || '',
      last: f.Nom || '',
      email: f.Email || '',
      idref: f.IdRef || '',
      orcid: f.ORCID || '',
      idhal: f.IdHAL || '',
      idhalI: f.IdHAL_i || '',
      idhalSelonIdref: f.IdHAL_selon_IdRef || '',
      scopus: f.ID_SCOPUS || '',
      // OpenAlex alignment (docs/archive/plan-alignement-openalex.md): reviewed list of A-ids (pipe-separated)
      // + isolated manual choice of the group dashboards (AuthorResolveModal, legacy column).
      openalexIds: f.OpenAlex_ids || '',
      openalexManual: f.openalex_author_id || '',
      labo: f.LABO || '',
      typeEmploi: f.TYPE_EMPLOI || '',
      libTypeEmploi: f.LIB_TYPE_EMPLOI || '',
      statut: f.statut_dyna || '',
      dataSource: f.Data_source || '',
      commentaires: f.Commentaires || '',
    };
  });
}

/** PhD student (TYPE_EMPLOI) — « Doctorants » tab of the alignment pages. */
const isDoctorantEmployment = (p) => String(p.typeEmploi || '').trim().toUpperCase() === 'DOCTORANT';
/** Staff without statutory research duty (HR label LIB_TYPE_EMPLOI « Personnel [non] titulaire
 * n'ayant pas d'obligation statutaire de recherche ») — « Sans obligation de recherche » tab. Like the
 * PhD students: may have researcher identifiers, but the alignment is a low priority. */
const isHorsRechercheEmployment = (p) => /n'ayant pas d'obligation statutaire de recherche/i.test(String(p.libTypeEmploi || '').replace(/[’‘]/g, "'"));
/** Alignment group of a record: 'doctorants' (TYPE_EMPLOI, takes precedence) > 'hors_recherche' > 'personnel'.
 * Same logic as alignGroupOf in lib/gristService.ts (front-end side). */
const alignGroupOf = (p) => (isDoctorantEmployment(p) ? 'doctorants' : isHorsRechercheEmployment(p) ? 'hors_recherche' : 'personnel');
const ALIGN_GROUPS = ['personnel', 'doctorants', 'hors_recherche'];

/** Common filters --labo / --group / --limit, in that order (identical to sync_idref.cjs). */
function applyTargetFilters(targets, { labo = '', group = '', limit = 0 } = {}) {
  let out = targets;
  if (labo) out = out.filter((p) => String(p.labo || '').trim().toUpperCase() === labo);
  if (ALIGN_GROUPS.includes(group)) out = out.filter((p) => alignGroupOf(p) === group);
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

// ── Review table decisions ───────────────────────────────────────────────────
// « À traiter » → « Validé » / « Rejeté » / « Identité mêlée ». The third one (OpenAlex plan § 8) marks a
// remote profile that mixes several people: neither written to the Annuaire nor a definitive blacklist — a
// ticket to untangle at the source (Note, Signale_le), never proposed again nor purged while it stays in that state.
const DECISION_TODO = 'À traiter';
const DECISION_MIXED = 'Identité mêlée';
const DECISIONS = [DECISION_TODO, 'Validé', 'Rejeté', DECISION_MIXED];
const isDecided = (d) => d === 'Validé' || d === 'Rejeté' || d === DECISION_MIXED;
const DECISION_CHOICE_OPTIONS = {
  'À traiter': { fillColor: '#FFE5B4', textColor: '#000000' },
  'Validé': { fillColor: '#C7F0C2', textColor: '#000000' },
  'Rejeté': { fillColor: '#F2C2C2', textColor: '#000000' },
  'Identité mêlée': { fillColor: '#D9C8F5', textColor: '#000000' },
};
/** Formula of the « Identité mêlée » button (Action Button widget) of a review table. */
function melerFormula(table) {
  return [
    `if $Decision != "${DECISION_TODO}":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `return {"button": "Identité mêlée", "description": "Profil qui mélange plusieurs personnes pour %s : ni validé ni rejeté, à démêler à la source (renseigner Note et Signale_le)" % $Nom_annuaire, "actions": [["UpdateRecord", "${table}", $id, {"Decision": "${DECISION_MIXED}", "Date_application": today}]]}`,
  ].join('\n');
}
/**
 * Common decision columns of a review table: `Decision` (Choice with 4 values), `Note`,
 * `Signale_le` (date of the correction request to the source) and the `Meler_action` button.
 * `Valider_action` / `Rejeter_action` remain specific to each source.
 */
function reviewDecisionColumns(table) {
  const text = (id, label) => ({ id, fields: { label, type: 'Text' } });
  return [
    {
      id: 'Decision',
      fields: { label: 'Décision', type: 'Choice', widgetOptions: JSON.stringify({ choices: DECISIONS, choiceOptions: DECISION_CHOICE_OPTIONS }) },
    },
    text('Note', 'Note (identité mêlée : qui possède quoi)'),
    text('Signale_le', 'Signalé à la source le'),
    { id: 'Meler_action', fields: { label: 'Identité mêlée (action)', type: 'Any', isFormula: true, formula: melerFormula(table) } },
  ];
}

/**
 * Decided rows of a review table, by `uid::identifier` key: { id, decision, note, signaleLe, fields }.
 * `idColumn` = candidate column (e.g. PPN_candidat), `normId` = identifier normalization
 * (e.g. extractPpn). Missing table → empty Map (first run).
 */
async function loadReviewDecisions(table, idColumn, normId = (v) => String(v || '').trim()) {
  const out = new Map();
  try {
    const records = await gristRecords(table);
    for (const r of records) {
      const decision = String(r.fields.Decision || '');
      if (!isDecided(decision)) continue;
      out.set(`${r.fields.uid_dyna || ''}::${normId(r.fields[idColumn])}`, { id: r.id, decision, note: r.fields.Note || '', signaleLe: r.fields.Signale_le || '', fields: r.fields });
    }
  } catch (e) { /* review table missing */ }
  return out;
}
/**
 * Blacklist of a review table: `uid::identifier` pairs not to propose again — « Rejeté » and
 * « Identité mêlée » (a mixed profile is neither validated nor proposed again until it is untangled).
 */
async function loadRejected(table, idColumn, normId = (v) => String(v || '').trim()) {
  const rejected = new Set();
  for (const [key, d] of await loadReviewDecisions(table, idColumn, normId)) {
    if (d.decision === 'Rejeté' || d.decision === DECISION_MIXED) rejected.add(key);
  }
  return rejected;
}

/**
 * Pushes suggestions into a collaborative Grist review table.
 *  - creates the table if needed (`columns` = full definition, Valider/Rejeter formulas included);
 *  - `desired`: Map key → fields of the row (key = `uid::identifier`, see `keyOf`);
 *  - `keyOf(rec)`: rebuilds that key from an existing row of the table;
 *  - upsert: missing row → created « À traiter »; « Validé »/« Rejeté » row → never touched again;
 *    pending row → refreshed;
 *  - purge of the pending rows that are no longer proposed, or whose Annuaire target
 *    (`targetField`, e.g. IdRef) is now filled in. `targetField` omitted (multi-valued target,
 *    e.g. OpenAlex_ids: a non-empty target can still be enriched) → only the first rule applies.
 */
/**
 * Creates a review table if it does not exist yet (`columns` = full definition). Returns true when
 * it was created. Called by pushReview, and at the start of every run by the scripts whose table
 * must exist before any push (the UI blacklist writes — « Mauvais candidat » — need it, and the
 * push mode is no longer run systematically since 2026-09-21).
 */
async function ensureReviewTable(table, columns) {
  if ((await gristTableIds()).includes(table)) return false;
  await grist().addTables([{ id: table, columns }]);
  return true;
}

async function pushReview({ table, columns, desired, keyOf, targetField }) {
  const day = today();
  const tableCreated = await ensureReviewTable(table, columns);

  const [revRecs, annRecs] = await Promise.all([gristRecords(table), gristRecords('Annuaire')]);
  const targetByUid = {};
  for (const rec of annRecs) {
    const u = rec.fields.uid_dyna;
    const v = targetField ? String(rec.fields[targetField] || '').trim() : '';
    if (u && !(u in targetByUid)) targetByUid[u] = v;
    targetByUid[`g${rec.id}`] = v;   // records without uid_dyna: cache key g<rowId>
  }

  const existing = new Map();
  for (const rec of revRecs) {
    existing.set(keyOf(rec), { id: rec.id, decision: String(rec.fields.Decision || ''), uid: rec.fields.uid_dyna || '' });
  }

  const toCreate = [];
  const toPatch = [];
  let skipped = 0;
  for (const [key, row] of desired) {
    const ex = existing.get(key);
    if (!ex) toCreate.push({ ...row, Decision: 'À traiter', Applique: false, Date_application: '', Pousse_le: day });
    else if (isDecided(ex.decision)) skipped++;
    else toPatch.push({ id: ex.id, fields: { ...row, Pousse_le: day } });
  }
  const toDelete = [];
  for (const [key, ex] of existing) {
    if (ex.decision !== 'À traiter' && ex.decision !== '') continue;
    if (!desired.has(key) || (targetByUid[ex.uid] || '').length > 0) toDelete.push(ex.id);
  }

  await gristCreateRecords(table, toCreate);
  await gristPatchRecords(table, toPatch);
  await gristDeleteRecords(table, toDelete);

  return { created: toCreate.length, refreshed: toPatch.length, skipped, purged: toDelete.length, tableCreated };
}

// ── Cache / progress files ───────────────────────────────────────────────────
/**
 * Cache (key = Annuaire key) and progress of a source. The files live at the app
 * root (bind-mounted, see druid.yaml); the copy into dist/ is kept for compatibility with
 * the old deployments (server.cjs now serves the root first).
 */
/** Minimum spacing of the cache saves made during a run (see writeProgress). */
const CACHE_SAVE_EVERY_MS = 30000;

function makeStore({ cachePath, progressPath }) {
  const progress = getArg('progress', progressPath);   // overridable (--progress=), see qualinka
  installStopHandler();
  // The cache object handed out by loadCache, filled in place by the script: saved along the
  // way, so that a stop or a crash keeps what was already paid for (API quotas).
  let live = null;
  let lastSave = Date.now();
  const writeCache = (cache) => {
    const json = JSON.stringify(cache, null, 2);
    fs.writeFileSync(cachePath, json);
    try { if (fs.existsSync('dist')) fs.writeFileSync(`dist/${cachePath}`, json); } catch (e) { /* noop */ }
    lastSave = Date.now();
  };
  return {
    cachePath,
    progressPath: progress,
    loadCache() {
      try { live = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) { live = {}; }
      return live;
    },
    writeCache,
    writeProgress(p) {
      if (p && p.running && live && Date.now() - lastSave >= CACHE_SAVE_EVERY_MS) {
        try { writeCache(live); } catch (e) { console.warn(`[align] cache save failed: ${e.message}`); }
      }
      const out = p && !p.running && stopRequested ? { ...p, stopped: true } : p;
      try { fs.writeFileSync(progress, JSON.stringify(out)); } catch (e) { /* noop */ }
    },
  };
}

module.exports = {
  getArg, hasFlag, commonOptions,
  stripAccents, normalize, extractPpn, extractOrcid, isValidOrcid, today, nameTokens, nameMatch, heterogeneousFirstNames,
  getUrl, runPool, proxyFor, isStopRequested, requestStop,
  DOC, grist, gristRecords, gristTableIds, gristColumns, gristAddColumns, gristUpdateColumns,
  gristCreateRecords, gristPatchRecords, gristPatchGrouped, gristDeleteRecords, withTrace,
  fetchAnnuaire, isDoctorantEmployment, isHorsRechercheEmployment, alignGroupOf, ALIGN_GROUPS, applyTargetFilters, loadRejected, loadReviewDecisions, ensureReviewTable, pushReview,
  DECISION_TODO, DECISION_MIXED, DECISIONS, DECISION_CHOICE_OPTIONS, isDecided, reviewDecisionColumns, melerFormula,
  makeStore,
};
