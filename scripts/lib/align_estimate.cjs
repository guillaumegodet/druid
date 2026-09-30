/**
 * align_estimate.cjs — cost of an alignment run and Elsevier quota left, for the launch window of
 * the unified alignment page (docs/plan-recherche-alignement-maitrisee.md, lot 2). Pure: the route
 * /api/align/estimate of server.cjs reads the Annuaire, the caches and the progress files.
 */
'use strict';

/**
 * API calls per processed record, measured on the runs of September 2026. Scopus counts per
 * Elsevier API pool (weekly quota per key): Author Search then Author Retrieval of the candidates
 * in search mode; retrievals by batches of 25 ids in verify mode (sync_scopus.cjs VERIFY_BATCH).
 * The other sources have no quota of their own: `requests` only says how long a run takes.
 */
const ALIGN_COST = {
  idref: { search: { requests: 10 } },
  orcid: { search: { requests: 3 }, verify: { requests: 1 } },
  hal: { search: { requests: 3 }, verify: { requests: 1 } },
  openalex: { search: { requests: 3 }, verify: { requests: 1 } },
  scopus: { search: { search: 1.7, author: 1.8 }, verify: { author: 0.04 } },
};

/** Weekly limit of each Elsevier API pool, per key. */
const ELSEVIER_WEEKLY = 5000;

/** Calls a run of `n` records costs, per pool (rounded up). */
function runCost(source, mode, n) {
  const unit = (ALIGN_COST[source] || {})[mode] || {};
  return Object.fromEntries(Object.entries(unit).map(([pool, c]) => [pool, Math.ceil(c * n)]));
}

/**
 * Elsevier calls the alignment may still spend this week, per pool (`search`, `author`), from the
 * latest known quota among `snapshots` (progress files of the Scopus alignment and of the career-path
 * job: `{ quota: { <pool>: { remaining, limit, reset, key? } }, finishedAt|startedAt }`). Key 1 keeps
 * `reserve1` of its limit (SoVisu+ harvester); key 2 is used in full. A quota whose reset date has
 * passed counts as full again. Key 2 is assumed untouched while the last answer came from key 1.
 * @returns {{ keys: number, reserve1: number, pools: Record<string, { available: number, remaining: number|null, key: number, reset: string|null, asOf: string|null }> }}
 */
function scopusBudget({ snapshots = [], keyCount = 1, reserve1 = 0.3, today = new Date().toISOString().slice(0, 10), weekly = ELSEVIER_WEEKLY } = {}) {
  const stamp = (s) => String(s.finishedAt || s.startedAt || '');
  const sorted = snapshots.filter((s) => s && s.quota).sort((a, b) => stamp(b).localeCompare(stamp(a)));
  const keep1 = Math.floor(weekly * reserve1);
  const pools = {};
  for (const pool of ['search', 'author']) {
    const snap = sorted.find((s) => s.quota[pool]);
    const q = snap ? snap.quota[pool] : null;
    const key2Full = keyCount > 1 ? weekly : 0;
    let available;
    if (!q || (q.reset && q.reset < today)) available = weekly - keep1 + key2Full;
    else if (q.key === 2) available = Math.max(0, q.remaining);
    else available = Math.max(0, q.remaining - keep1) + key2Full;
    pools[pool] = { available, remaining: q ? q.remaining : null, key: q ? (q.key || 1) : 1, reset: q ? q.reset || null : null, asOf: snap ? stamp(snap) || null : null };
  }
  return { keys: keyCount, reserve1, pools };
}

/** Largest number of records the Scopus budget covers in `mode` (Infinity when nothing is metered). */
function affordable(budget, mode) {
  const unit = ALIGN_COST.scopus[mode] || {};
  let n = Infinity;
  for (const [pool, c] of Object.entries(unit)) {
    const avail = budget.pools[pool] ? budget.pools[pool].available : 0;
    if (c > 0) n = Math.min(n, Math.floor(avail / c));
  }
  return n;
}

module.exports = { ALIGN_COST, ELSEVIER_WEEKLY, runCost, scopusBudget, affordable };
