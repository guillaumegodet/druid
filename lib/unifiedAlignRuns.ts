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

/** Same shape as the /api/.../progress and /api/sync-idref-progress routes. */
export interface UnifiedRunProgress {
  running: boolean;
  total?: number;
  done?: number;
  error?: string;
  mode?: string;
}

const label = (src: UnifiedAlignSource): string => (src === 'idref' ? 'IdRef' : ALIGN_SOURCE_META[src].label);

const triggerUrl = (src: UnifiedAlignSource, mode: AlignMode, labo?: string, group?: AlignGroup): string => {
  const q = new URLSearchParams();
  if (labo) q.set('labo', labo);
  if (group) q.set('group', group);
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
  opts: { labo?: string; group?: AlignGroup; onProgress?: (src: UnifiedAlignSource, p: UnifiedRunProgress) => void; pollIntervalMs?: number } = {},
): Promise<Partial<Record<UnifiedAlignSource, UnifiedRunProgress>>> {
  const { labo, group, onProgress, pollIntervalMs = 2000 } = opts;
  const results: Partial<Record<UnifiedAlignSource, UnifiedRunProgress>> = {};

  await Promise.all(sources.map(async (src) => {
    if (src === 'idref' && mode !== 'search') return;   // out of scope (plan §5): never triggered
    const lbl = label(src);
    const report = (p: UnifiedRunProgress) => { results[src] = p; onProgress?.(src, p); };
    report({ running: true, total: 0, done: 0 });
    try {
      const trig = await fetch(triggerUrl(src, mode, labo, group));
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
