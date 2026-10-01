/**
 * Orchestration of parallel alignment runs (docs/plan-alignement-unifie.md, lot 1).
 * Invents no route: IdRef goes through /api/sync-idref-trigger|progress (legacy route,
 * mode `align` = Qualinka engine), the 3 others through /api/align/:source/trigger|progress —
 * same routes and same contract as runAlign/rerunIdref in App.tsx (trigger, 409 = already
 * running → tracking, polling until running:false). Nothing server-side locks one source
 * against another (plan §0): the requested runs really do run in parallel, each at its own
 * pace — no lockstep, IdRef/HAL are typically much longer than ORCID.
 *
 * Pure fetch/polling logic, no React state: lot 2 (UI) wires `onProgress` to its component
 * state rather than duplicating this loop per source as App.tsx does today for the 4
 * legacy pages.
 */
import { t } from '@lingui/core/macro';
import { apiErrorText, translateApiError } from './apiErrors';
import { ALIGN_SOURCE_META, type AlignGroup, type AlignMode, type UnifiedAlignSource } from './gristService';

/** Remaining weekly Elsevier quota of one API pool (Scopus progress), `key` = key in use (1, 2). */
export interface ElsevierPoolQuota { remaining: number; limit: number; reset: string; key?: number }

/** Same shape as the /api/.../progress and /api/sync-idref-progress routes. */
export interface UnifiedRunProgress {
  running: boolean;
  total?: number;
  done?: number;
  error?: string;
  mode?: string;
  /** Closed by the « Stop » button (scripts/lib/align_common.cjs): `done` < `total`. */
  stopped?: boolean;
  /** Scopus only: remaining quota per API pool (`search`, `author`). */
  quota?: Record<string, ElsevierPoolQuota>;
}

const label = (src: UnifiedAlignSource): string => (src === 'idref' ? 'IdRef' : ALIGN_SOURCE_META[src].label);

interface TriggerScope { labo?: string; group?: AlignGroup; force?: boolean; limit?: number; record?: number }
const triggerUrl = (src: UnifiedAlignSource, mode: AlignMode, { labo, group, force = false, limit = 0, record = 0 }: TriggerScope): string => {
  const q = new URLSearchParams();
  if (labo) q.set('labo', labo);
  if (group) q.set('group', group);
  // Incremental by default (never processed or in error); force = reprocess the scope in full.
  if (force) q.set('force', '1');
  if (limit > 0) q.set('limit', String(limit));
  // One record (Grist row), searched again from its drawer.
  if (record > 0) q.set('record', String(record));
  if (src === 'idref') {
    // Only mode covered by the unified view: plain Qualinka (see plan §5) — the caller must
    // never request idref outside 'search' mode (guard below), but we set it explicitly.
    q.set('mode', 'align');
    return `/api/sync-idref-trigger?${q}`;
  }
  q.set('mode', mode);
  return `/api/align/${src}/trigger?${q}`;
};

const progressUrl = (src: UnifiedAlignSource): string => (src === 'idref' ? '/api/sync-idref-progress' : `/api/align/${src}/progress`);
const stopUrl = (src: UnifiedAlignSource): string => (src === 'idref' ? '/api/sync-idref-stop' : `/api/align/${src}/stop`);

/**
 * Asks the run of a source to stop (« Stop » button): the script finishes the records in progress,
 * saves what it found and closes its progress with `stopped: true` — the polling of
 * runUnifiedAlign then ends normally. Rejects with the server message (no run in progress…).
 */
export async function stopUnifiedRun(src: UnifiedAlignSource): Promise<void> {
  const r = await fetch(stopUrl(src), { method: 'POST' });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(translateApiError(String(d.error || '')) || t`${label(src)} stop failed: ${r.status}`);
  }
}

/**
 * Starts the run of every requested source in parallel and notifies `onProgress` on each tick
 * until all of them are finished (or failed). Never rejects globally: a failed source resolves
 * with `{running:false, error}`, the others carry on.
 *
 * `labo`/`group`: the unified view must always provide them (decision of 2026-09-21, plan §5 —
 * no global run for now); this function does not technically enforce it, it is a calling
 * rule on the UI side (lot 2).
 *
 * IdRef is only triggered in `search` mode — in `verify`, the « Vérifier les identifiants
 * liés » tool stays out of the unified view's scope (plan §5) and is never called from here.
 */
export async function runUnifiedAlign(
  sources: UnifiedAlignSource[],
  mode: AlignMode,
  opts: {
    labo?: string; group?: AlignGroup; onProgress?: (src: UnifiedAlignSource, p: UnifiedRunProgress) => void; pollIntervalMs?: number;
    /** Reprocess the records already searched too (launch window, « full rerun »). */
    force?: boolean;
    /** Maximum number of records per source (launch window; Scopus capped by default). */
    limits?: Partial<Record<UnifiedAlignSource, number>>;
    /** Grist row of one record: that record only, even if already searched (drawer button). */
    record?: number;
  } = {},
): Promise<Partial<Record<UnifiedAlignSource, UnifiedRunProgress>>> {
  const { labo, group, onProgress, pollIntervalMs = 2000, force = false, limits = {}, record = 0 } = opts;
  const results: Partial<Record<UnifiedAlignSource, UnifiedRunProgress>> = {};

  await Promise.all(sources.map(async (src) => {
    if (src === 'idref' && mode !== 'search') return;   // out of scope (plan §5): never triggered
    const lbl = label(src);
    const report = (p: UnifiedRunProgress) => { results[src] = p; onProgress?.(src, p); };
    report({ running: true, total: 0, done: 0 });
    try {
      const trig = await fetch(triggerUrl(src, mode, { labo, group, force, limit: limits[src] || 0, record }));
      // 409 = a run is already in progress for this source: simply switch to tracking
      // (same convention as runAlign/rerunIdref in App.tsx).
      if (!trig.ok && trig.status !== 409) {
        const d = await trig.json().catch(() => ({}));
        throw new Error(d.error || t`${lbl} trigger failed: ${trig.status}`);
      }
      for (;;) {
        await new Promise((r) => { setTimeout(r, pollIntervalMs); });
        const pr = await fetch(progressUrl(src), { cache: 'no-store' });
        const p: UnifiedRunProgress = await pr.json().catch(() => ({ running: false }));
        if (p.error) throw new Error(t`${lbl} alignment: ${translateApiError(p.error)}`);
        report(p);
        if (!p.running) return;
      }
    } catch (err: any) {
      report({ running: false, error: apiErrorText(err) || t`Error during the ${lbl} alignment` });
    }
  }));

  return results;
}

/** Per source, what a run of the launch window would process (GET /api/align/estimate). */
export interface AlignSourceEstimate {
  /** Records of the scope lacking (search) or carrying (verify) the identifier. */
  eligible: number;
  /** Of which never processed in this mode, or in error — what an incremental run takes. */
  pending: number;
  /** API calls per record: `requests` (no quota), or per Elsevier pool (`search`, `author`). */
  unit: Record<string, number>;
}
export interface ElsevierPoolBudget { available: number; remaining: number | null; key: number; reset: string | null; asOf: string | null }
export interface AlignEstimate {
  mode: AlignMode;
  sources: Partial<Record<UnifiedAlignSource, AlignSourceEstimate>>;
  scopus: { keys: number; reserve1: number; pools: Record<string, ElsevierPoolBudget>; affordable: number | null };
}

export async function fetchAlignEstimate(mode: AlignMode, labo?: string, group?: AlignGroup): Promise<AlignEstimate> {
  const q = new URLSearchParams({ mode });
  if (labo) q.set('labo', labo);
  if (group) q.set('group', group);
  const r = await fetch(`/api/align/estimate?${q}`, { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  // An instance without this route answers with the SPA fallback (200 + index.html, unreadable as
  // JSON → {}): treated as a failure rather than an estimate without `sources`.
  if (!r.ok || !d.sources) throw new Error(translateApiError(String(d.error || '')) || t`Estimate failed: ${r.status}`);
  return d as AlignEstimate;
}

/** Default cap of a Scopus run in the launch window (decision D3: ≈ 850 calls per Elsevier API). */
export const SCOPUS_DEFAULT_LIMIT = 500;

/** Calls a run of `n` records costs, per pool (same rounding as scripts/lib/align_estimate.cjs). */
export const estimateCost = (unit: Record<string, number>, n: number): Record<string, number> =>
  Object.fromEntries(Object.entries(unit).map(([pool, c]) => [pool, Math.ceil(c * n)]));

/** Scopus: true when a run of `n` records exceeds the Elsevier calls still available on a pool. */
export const exceedsBudget = (unit: Record<string, number>, n: number, pools: Record<string, ElsevierPoolBudget>): boolean =>
  Object.entries(estimateCost(unit, n)).some(([pool, c]) => pool in pools && c > pools[pool].available);

