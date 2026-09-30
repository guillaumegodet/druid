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
 */
const { getUrl } = require('./align_common.cjs');

const ELS = 'https://api.elsevier.com/content';

/**
 * @param {object} o
 * @param {string} o.tag           log prefix (« scopus », « parcours »…)
 * @param {object} o.ratePerS      requests per second per pool, e.g. { search: 2, author: 3 }
 * @param {number} [o.reserve=0]   share (0-1) of each weekly limit never consumed by this run
 * @param {number} [o.rateLimitWaitMs=700] wait after a 429 of rate (Elsevier clears within the second)
 * @param {number} [o.marginMs=40] extra spacing between two requests of a pool
 */
function createElsevierClient({ tag = 'scopus', ratePerS = {}, reserve = 0, rateLimitWaitMs = 700, marginMs = 40, apiKey = process.env.SCOPUS_API_KEY || '', instToken = process.env.SCOPUS_INST_TOKEN || '' } = {}) {
  const headers = { Accept: 'application/json', 'X-ELS-APIKey': apiKey, ...(instToken ? { 'X-ELS-Insttoken': instToken } : {}) };
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
  function trackQuota(pool, h) {
    if (!h || h['x-ratelimit-remaining'] === undefined) return;
    const remaining = parseInt(h['x-ratelimit-remaining'], 10);
    const limit = parseInt(h['x-ratelimit-limit'] || '0', 10) || 0;
    quota[pool] = { remaining, limit, reset: resetDate(h) };
    if (remaining <= 0) abort(`weekly Elsevier quota exhausted (${pool} API, reset ${quota[pool].reset})`);
    else if (reserve > 0 && limit && remaining <= Math.floor(limit * reserve)) abort(`weekly Elsevier quota share reached (${pool} API: ${remaining}/${limit} left for the other jobs, reset ${quota[pool].reset})`);
  }
  /**
   * GET JSON on an Elsevier API. `pool` = quota pool name. Returns the body, `{ notFound: true }` on 404,
   * null on network/HTTP error or once the run is aborted (quota, authorization).
   * `opts.badRequestAsValue`: a 400 returns `{ badRequest: true }` instead of null (a multi-id request
   * holding one invalid id answers 400: the caller splits the batch). `opts.timeout` / `opts.tries`
   * override the defaults (25 s, 5 tries) for heavy pages.
   */
  async function get(pool, path, params, opts = {}) {
    if (aborted || !apiKey) return null;
    await throttle(pool);
    const url = `${ELS}${path}${params ? `?${new URLSearchParams(params)}` : ''}`;
    try {
      const r = await getUrl(url, { json: true, withHeaders: true, headers, timeout: opts.timeout || 25000, tries: opts.tries || 5, noRetry: [400, 401, 403, 404], rateLimitWaitMs });
      trackQuota(pool, r.headers);
      return r.body;
    } catch (e) {
      const h = e.headers || {};
      const els = String(h['x-els-status'] || '');
      if (e.status === 404) return { notFound: true };
      if (e.status === 401 || e.status === 403) abort(`HTTP ${e.status} ${els || ''} — API key refused or IP not entitled (the API must go through the university proxy)`.trim());
      else if (/QUOTA_EXCEEDED/i.test(els) || (e.status === 429 && h['x-ratelimit-remaining'] !== undefined && parseInt(h['x-ratelimit-remaining'], 10) <= 0)) abort(`weekly Elsevier quota exhausted (${pool} API${h['x-ratelimit-reset'] ? `, reset ${resetDate(h)}` : ''})`);
      else if (e.status === 429) console.warn(`[${tag}] ${path}: rate limit (429) still hit after retries — record marked in error, quota untouched`);
      else if (e.status === 400 && opts.badRequestAsValue) return { badRequest: true };
      else console.warn(`[${tag}] ${path}: ${e.message}`);
      return null;
    }
  }
  return { get, quota, abort, aborted: () => aborted, hasKey: !!apiKey };
}

module.exports = { createElsevierClient, ELS };
