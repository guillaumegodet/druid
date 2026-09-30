import React, { useEffect, useMemo, useState } from 'react';
import { X, RotateCw, RefreshCw, AlertTriangle } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { AlignGroup, AlignMode, UnifiedAlignSource } from '../../lib/gristService';
import {
  fetchAlignEstimate, estimateCost, exceedsBudget, SCOPUS_DEFAULT_LIMIT,
  type AlignEstimate,
} from '../../lib/unifiedAlignRuns';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import { PixelBtn } from './alignAtoms';

/** What the window launches: runUnifiedAlign options. */
export interface AlignLaunchChoice {
  sources: UnifiedAlignSource[];
  force: boolean;
  limits: Partial<Record<UnifiedAlignSource, number>>;
  /** Grist row of one record (« Search this record » in a drawer, not from this window). */
  record?: number;
}

interface Props {
  mode: AlignMode;
  labo?: string;
  group?: AlignGroup;
  /** Sources shown by the unified view, in display order. */
  sources: UnifiedAlignSource[];
  sourceLabel: Record<UnifiedAlignSource, string>;
  onClose: () => void;
  onLaunch: (choice: AlignLaunchChoice) => void;
}

type Scope = 'never' | 'all';

/**
 * Launch window of « Search everywhere » (docs/plan-recherche-alignement-maitrisee.md, lot 2): per
 * source, the records the run would process, a cap and the cost; for Scopus, the Elsevier calls
 * still available this week. A source whose run exceeds that budget is unchecked (decision D4:
 * warn, never block); Scopus is capped at 500 records by default (D3).
 */
export const AlignLaunchModal: React.FC<Props> = ({ mode, labo, group, sources, sourceLabel, onClose, onLaunch }) => {
  const { t } = useLingui();
  const [estimate, setEstimate] = useState<AlignEstimate | null>(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<Scope>('never');
  const [checked, setChecked] = useState<Set<UnifiedAlignSource>>(new Set());
  const [limits, setLimits] = useState<Partial<Record<UnifiedAlignSource, string>>>({ scopus: String(SCOPUS_DEFAULT_LIMIT) });
  const fmt = (n: number) => n.toLocaleString(numberLocale());

  useEffect(() => {
    let alive = true;
    fetchAlignEstimate(mode, labo, group).then((e) => { if (alive) setEstimate(e); }).catch((e) => { if (alive) setError(apiErrorText(e)); });
    return () => { alive = false; };
  }, [mode, labo, group]);

  const shown = useMemo(() => sources.filter((s) => estimate?.sources[s]), [sources, estimate]);
  const countOf = (s: UnifiedAlignSource): number => {
    const e = estimate?.sources[s];
    return e ? (scope === 'all' ? e.eligible : e.pending) : 0;
  };
  const limitOf = (s: UnifiedAlignSource): number => Math.max(0, parseInt(limits[s] || '', 10) || 0);
  const runSize = (s: UnifiedAlignSource): number => (limitOf(s) > 0 ? Math.min(countOf(s), limitOf(s)) : countOf(s));
  const overBudget = (s: UnifiedAlignSource): boolean =>
    s === 'scopus' && !!estimate && exceedsBudget(estimate.sources.scopus?.unit || {}, runSize(s), estimate.scopus.pools);

  // Default selection, recomputed when the estimate or the scope changes: every source with records
  // to process, except a Scopus run beyond the Elsevier budget.
  useEffect(() => {
    if (!estimate) return;
    setChecked(new Set(shown.filter((s) => countOf(s) > 0 && !overBudget(s))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, scope]);

  const toggle = (s: UnifiedAlignSource) => setChecked((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const costText = (s: UnifiedAlignSource): string => {
    const cost = estimateCost(estimate?.sources[s]?.unit || {}, runSize(s));
    if ('requests' in cost) return t`≈ ${fmt(cost.requests)} requests`;
    const parts = [];
    if (cost.search) parts.push(t`${fmt(cost.search)} Author Search`);
    if (cost.author) parts.push(t`${fmt(cost.author)} Author Retrieval`);
    return parts.length ? `≈ ${parts.join(' + ')}` : '—';
  };
  const launch = () => {
    const chosen = shown.filter((s) => checked.has(s) && countOf(s) > 0);
    const lim: Partial<Record<UnifiedAlignSource, number>> = {};
    for (const s of chosen) if (limitOf(s) > 0) lim[s] = limitOf(s);
    onLaunch({ sources: chosen, force: scope === 'all', limits: lim });
  };
  const pools = estimate?.scopus.pools;
  const nothing = !!estimate && !shown.some((s) => checked.has(s) && countOf(s) > 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-4 sm:px-6 pt-5 pb-3 border-b border-ink/5 dark:border-white/5">
          <div>
            <h2 className="font-disp text-lg font-bold text-ink dark:text-[#f5f2ea]">
              {mode === 'verify' ? <Trans>Check the existing identifiers</Trans> : <Trans>Search the missing identifiers</Trans>}
            </h2>
            <p className="text-[12.5px] text-muted dark:text-[#8f897c]">
              {labo ? t`Scope: ${labo}` : t`Scope: all structures`} · {group === 'doctorants' ? t`PhD students` : group === 'hors_recherche' ? t`No research duty` : t`Staff`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-white/70 dark:hover:bg-white/10" aria-label={t`Close`}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-auto px-4 sm:px-6 py-4 space-y-4 text-[13px]">
          {error && <p className="text-[#b3441f] dark:text-[#e08a6a] font-semibold">{error}</p>}
          {!estimate && !error && (
            <p className="flex items-center gap-2 text-muted dark:text-[#8f897c]"><RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Counting the records to process…</Trans></p>
          )}
          {estimate && (
            <>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={scope === 'never'} onChange={() => setScope('never')} />
                  <span><Trans>Only the records never searched (or in error)</Trans></span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
                  <span><Trans>All records of the scope (full rerun)</Trans></span>
                </label>
              </div>
              <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[480px]">
                <thead className="text-[11px] uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                  <tr>
                    <th className="text-left py-1.5"><Trans>Source</Trans></th>
                    <th className="text-right py-1.5"><Trans>To process</Trans></th>
                    <th className="text-right py-1.5"><Trans>Cap</Trans></th>
                    <th className="text-left py-1.5 pl-4"><Trans>Estimated cost</Trans></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => {
                    const e = estimate.sources[s]!;
                    const n = countOf(s);
                    return (
                      <tr key={s} className="border-t border-ink/5 dark:border-white/5 align-top">
                        <td className="py-2">
                          <label className="inline-flex items-center gap-2 font-semibold text-ink dark:text-[#f5f2ea] cursor-pointer">
                            <input type="checkbox" checked={checked.has(s)} disabled={n === 0} onChange={() => toggle(s)} />
                            {sourceLabel[s]}
                          </label>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {fmt(n)}
                          {scope === 'never' && e.eligible > e.pending && (
                            <div className="text-[11px] text-muted-light dark:text-[#8f897c]">{t`${fmt(e.eligible - e.pending)} already searched`}</div>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <input type="number" min={0} step={50} value={limits[s] ?? ''} placeholder={t`none`}
                            onChange={(ev) => setLimits((prev) => ({ ...prev, [s]: ev.target.value }))}
                            className="input-soft !h-8 !py-0 w-24 text-right" aria-label={t`Maximum number of records for ${sourceLabel[s]}`} />
                        </td>
                        <td className="py-2 pl-4">
                          {n > 0 ? costText(s) : '—'}
                          {overBudget(s) && (
                            <div className="flex items-center gap-1 text-[11.5px] font-semibold text-[#b3441f] dark:text-[#e08a6a]">
                              <AlertTriangle className="w-3.5 h-3.5" /> <Trans>Beyond the Elsevier calls available this week — lower the cap</Trans>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              {pools && shown.includes('scopus') && (
                <div className="rounded-2xl bg-white/60 dark:bg-white/5 border border-ink/5 dark:border-white/10 px-4 py-3 text-[12.5px] text-muted dark:text-[#b8b1a3] space-y-1">
                  <p className="font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Scopus — weekly Elsevier quota</Trans></p>
                  <p>{t`Available for the alignment: ${fmt(pools.search?.available ?? 0)} Author Search, ${fmt(pools.author?.available ?? 0)} Author Retrieval — about ${fmt(estimate.scopus.affordable ?? 0)} records.`}</p>
                  <p>
                    {estimate.scopus.keys > 1
                      ? t`Key 1 keeps ${Math.round(estimate.scopus.reserve1 * 100)} % of its quota for the SoVisu+ harvester; the backup key is then used in full.`
                      : t`Key 1 keeps ${Math.round(estimate.scopus.reserve1 * 100)} % of its quota for the SoVisu+ harvester.`}
                    {pools.search?.asOf ? ` ${t`Figures of the last Scopus run (${pools.search.asOf.slice(0, 10)}); quotas reset on ${pools.search.reset ?? '?'}.`}` : ''}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 sm:px-6 py-4 border-t border-ink/5 dark:border-white/5">
          <PixelBtn onClick={onClose}><Trans>Cancel</Trans></PixelBtn>
          <PixelBtn onClick={launch} disabled={!estimate || nothing} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong">
            <RotateCw className="w-4 h-4" /> <Trans>Start</Trans>
          </PixelBtn>
        </div>
      </div>
    </div>
  );
};
