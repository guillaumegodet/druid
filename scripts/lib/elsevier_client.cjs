/**
 * elsevier_client.cjs — shared client of the Elsevier (Scopus) APIs: per-pool throttle, weekly quota
 * tracking, run abort. Extracted from scripts/sync_scopus.cjs on 2026-09-30 without behavior change,
 * so that the career-path job (scripts/sync_affiliation_history.cjs, docs/plan-parcours-affiliations.md)
 * uses the same rules.
 *
 * The APIs answer ONLY through the university proxy (the direct route gets 401: the proxy IP carries
 * the entitlement) — getUrl (align_common.cjs) routes through HTTPS_PROXY.
 * Quotas are weekly and per API pool (Author Search, Author Retrieval, Affiliation, Scopus Search):
 * the client reads x-ratelimit-* and aborts the run when a pool is exhausted, or when the remaining
 * share falls under `reserve` (share of the weekly limit left to the other jobs, decision D9).
 * Backup key (2026-09-30): SCOPUS_API_KEY_2 (+ SCOPUS_INST_TOKEN_2) takes over, pool by pool, once
 * the first key has exhausted a pool — or reached its `reserve` share (key 1 is shared with the SoVisu+
 * harvester, docker/harvester/.env); the run stops only when the last key does.
 */
const { getUrl } = require('./align_common.cjs');

const ELS = 'https://api.elsevier.com/content';

/** API keys of the environment, in order of use: SCOPUS_API_KEY, then the backup SCOPUS_API_KEY_2,
 * each with its optional institution token. Empty variables are left out. */
function envKeys(env = process.env) {
  return [['SCOPUS_API_KEY', 'SCOPUS_INST_TOKEN'], ['SCOPUS_API_KEY_2', 'SCOPUS_INST_TOKEN_2']]
    .map(([key, token]) => ({ apiKey: String(env[key] || '').trim(), instToken: String(env[token] || '').trim() }))
    .filter((k) => k.apiKey);
}

/**
 * @param {object} o
 * @param {string} o.tag           log prefix (« scopus », « parcours »…)
 * @param {object} o.ratePerS      requests per second per pool, e.g. { search: 2, author: 3 }
 * @param {number|number[]} [o.reserve=0] share (0-1) of each weekly limit never consumed by this run:
 *                                 one number for every key, or one per key (missing ⇒ 0). Reaching it
 *                                 moves the pool to the next key; on the last key it stops the run
 * @param {number} [o.rateLimitWaitMs=700] wait after a 429 of rate (Elsevier clears within the second)
 * @param {number} [o.marginMs=40] extra spacing between two requests of a pool
 * @param {{ apiKey: string, instToken?: string }[]} [o.keys] keys in order of use (default: envKeys())
 * @param {Function} [o.getUrlImpl] HTTP layer (tests)
 */
function createElsevierClient({ tag = 'scopus', ratePerS = {}, reserve = 0, rateLimitWaitMs = 700, marginMs = 40, keys = envKeys(), getUrlImpl = getUrl } = {}) {
  const headersOf = keys.map((k) => ({ Accept: 'application/json', 'X-ELS-APIKey': k.apiKey, ...(k.instToken ? { 'X-ELS-Insttoken': k.instToken } : {}) }));
  /** Index of the key in use per pool: a key exhausted on one API may still serve the others. */
  const keyOf = {};
  const keyLabel = (k) => (keys.length > 1 ? ` (key ${k + 1}/${keys.length})` : '');
  const nextSlot = {};
  /** One slot chain per pool: requests of a pool are spaced by 1/rate, pools run independently. */
  async function throttle(pool) {
    const interval = Math.ceil(1000 / (ratePerS[pool] || 2)) + marginMs;
    const now = Date.now();
    const slot = Math.max(now, nextSlot[pool] || 0);
    nextSlot[pool] = slot + interval;
    if (slot > now) await new Promise((res) => setTimeout(res, slot - now));
  }
  /** Remaining weekly quota per API pool, from the x-ratelimit-* headers. */
  const quota = {};
  let aborted = null;
  function abort(reason) {
    if (!aborted) { aborted = reason; console.error(`[${tag}] RUN STOPPED: ${reason}`); }
  }
  const resetDate = (h) => { const t = parseInt(h['x-ratelimit-reset'] || '0', 10); return t ? new Date(t * 1000).toISOString().slice(0, 10) : '?'; };
  const reserveOf = (k) => (Array.isArray(reserve) ? Number(reserve[k]) || 0 : reserve);
  /** Pool exhausted (or at its reserve) on key `k`, the key the request used: switches to the next
   * key (true), or stops the run (false). Concurrent requests answered on key k after the switch
   * find the pool already moved on: they just retry (no second switch, no false stop). */
  function exhausted(pool, k, reason, last = `all ${keys.length} keys exhausted`) {
    if ((keyOf[pool] || 0) > k) return true;
    if (k + 1 < keys.length) {
      keyOf[pool] = k + 1;
      console.warn(`[${tag}] ${reason}${keyLabel(k)} — switching to key ${k + 2}`);
      return true;
    }
    abort(`${reason}${keys.length > 1 ? ` — ${last}` : ''}`);
    return false;
  }
  function trackQuota(pool, h, k) {
    if (!h || h['x-ratelimit-remaining'] === undefined) return;
    if (k < (keyOf[pool] || 0)) return;   // late answer of a key the pool already left
    const remaining = parseInt(h['x-ratelimit-remaining'], 10);
    const limit = parseInt(h['x-ratelimit-limit'] || '0', 10) || 0;
    quota[pool] = { remaining, limit, reset: resetDate(h), ...(keys.length > 1 ? { key: k + 1 } : {}) };
    const share = reserveOf(k);
    if (remaining <= 0) exhausted(pool, k, `weekly Elsevier quota exhausted (${pool} API, reset ${quota[pool].reset})`);
    else if (share > 0 && limit && remaining <= Math.floor(limit * share)) exhausted(pool, k, `weekly Elsevier quota share reached (${pool} API: ${remaining}/${limit} left for the other jobs, reset ${quota[pool].reset})`, `last key (${keys.length}/${keys.length})`);
  }
  /**
   * GET JSON on an Elsevier API. `pool` = quota pool name. Returns the body, `{ notFound: true }` on 404,
   * null on network/HTTP error or once the run is aborted (quota, authorization).
   * `opts.badRequestAsValue`: a 400 returns `{ badRequest: true }` instead of null (a multi-id request
   * holding one invalid id answers 400: the caller splits the batch). `opts.timeout` / `opts.tries`
   * override the defaults (25 s, 5 tries) for heavy pages.
   */
  async function get(pool, path, params, opts = {}) {
    if (aborted || !keys.length) return null;
    await throttle(pool);
    const url = `${ELS}${path}${params ? `?${new URLSearchParams(params)}` : ''}`;
    // One try per key at most: a quota refusal moves the pool to the next key and replays the request.
    for (let attempt = 0; attempt < keys.length && !aborted; attempt++) {
      const k = keyOf[pool] || 0;
      try {
        const r = await getUrlImpl(url, { json: true, withHeaders: true, headers: headersOf[k], timeout: opts.timeout || 25000, tries: opts.tries || 5, noRetry: [400, 401, 403, 404], rateLimitWaitMs });
        trackQuota(pool, r.headers, k);
        return r.body;
      } catch (e) {
        const h = e.headers || {};
        const els = String(h['x-els-status'] || '');
        if (e.status === 404) return { notFound: true };
        if (e.status === 401 || e.status === 403) abort(`HTTP ${e.status} ${els || ''}${keyLabel(k)} — API key refused or IP not entitled (the API must go through the university proxy)`.replace(/\s+/g, ' ').trim());
        else if (/QUOTA_EXCEEDED/i.test(els) || (e.status === 429 && h['x-ratelimit-remaining'] !== undefined && parseInt(h['x-ratelimit-remaining'], 10) <= 0)) {
          if (exhausted(pool, k, `weekly Elsevier quota exhausted (${pool} API${h['x-ratelimit-reset'] ? `, reset ${resetDate(h)}` : ''})`)) continue;
        } else if (e.status === 429) console.warn(`[${tag}] ${path}: rate limit (429) still hit after retries — record marked in error, quota untouched`);
        else if (e.status === 400 && opts.badRequestAsValue) return { badRequest: true };
        else console.warn(`[${tag}] ${path}: ${e.message}`);
        return null;
      }
    }
    return null;
  }
  return { get, quota, abort, aborted: () => aborted, hasKey: keys.length > 0, keyCount: keys.length };
}

module.exports = { createElsevierClient, envKeys, ELS };
