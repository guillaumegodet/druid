import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import type { ProgrammeAdminView, CollectionView } from '../../lib/calls/pg';
import { FUNDER_CATEGORY_LABELS } from '../dashboard/fundersAggregates';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(numberLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const nf = (v: number) => v.toLocaleString(numberLocale());

/**
 * @component CallsProgrammesAdmin
 * @description « Administration › Calls for proposals » (docs/plan-funding-calls.md, lot 2): the funding programmes
 * known to the instance, by funder — which ones are collected (active) and matched, how many calls each one holds, when
 * it was last collected — and the log of the collections (nightly job `collect_calls.cjs`). Activating a programme
 * makes the next collection import its calls; deactivating hides its calls from the tab without deleting them.
 */
export const CallsProgrammesAdmin: React.FC = () => {
  const { t } = useLingui();
  const [items, setItems] = useState<ProgrammeAdminView[] | null>(null);
  const [collections, setCollections] = useState<CollectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/calls/admin/programmes', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { setItems(data.items ?? []); setCollections(data.collections ?? []); })
      .catch((e: unknown) => setError(apiErrorText(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const toggle = async (p: ProgrammeAdminView) => {
    setBusy(p.programmeId);
    try {
      const res = await fetch(`/api/calls/admin/programmes/${encodeURIComponent(p.programmeId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !p.active }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((prev) => (prev ?? []).map((x) => (x.programmeId === p.programmeId ? { ...x, active: !p.active } : x)));
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  const byFunder = useMemo(() => {
    const groups = new Map<string, { funderName: string; category: string; items: ProgrammeAdminView[] }>();
    for (const p of items ?? []) {
      const g = groups.get(p.funderId) ?? { funderName: p.funderName, category: p.category, items: [] };
      g.items.push(p);
      groups.set(p.funderId, g);
    }
    return [...groups.values()];
  }, [items]);

  const kindLabel: Record<ProgrammeAdminView['kind'], string> = {
    thematic: t`thematic`, open: t`axes / panels`, eligibility: t`eligibility`, mixed: t`thematic + eligibility`,
  };
  const sourceLabel = (source: string) => (source === 'ft-portal' ? t`Funding & Tenders portal` : source === 'trm-report' ? t`TRM reports` : source);

  if (loading && !items) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted dark:text-[#c3beb0]"><Loader2 className="w-4 h-4 animate-spin" /> <Trans>Loading the programmes…</Trans></div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed max-w-3xl">
          <Trans>
            Funding programmes known to this instance. An active programme has its calls collected by the nightly job and shown in
            the « Calls for proposals » tab; deactivating it hides its calls without deleting them. The matching of the calls to
            the researchers is run apart, programme by programme.
          </Trans>
        </p>
        <button type="button" onClick={load} className="pill px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5 bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> <Trans>Refresh</Trans>
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-[13px]">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {byFunder.map((g) => (
        <section key={g.funderName} className="space-y-2">
          <h3 className="text-[14px] font-semibold text-ink dark:text-[#f5f2ea]">
            {g.funderName}
            <span className="ml-2 text-[12px] font-normal text-muted dark:text-[#c3beb0]">{FUNDER_CATEGORY_LABELS[g.category] ? i18n._(FUNDER_CATEGORY_LABELS[g.category]) : g.category}</span>
          </h3>
          <div className="overflow-x-auto rounded-2xl bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted dark:text-[#c3beb0]">
                  <th className="px-4 py-2 font-semibold"><Trans>Programme</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Matching</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Source</Trans></th>
                  <th className="px-3 py-2 font-semibold text-right"><Trans>Calls</Trans></th>
                  <th className="px-3 py-2 font-semibold text-right"><Trans>Matches</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Last collection</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Active</Trans></th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((p) => (
                  <tr key={p.programmeId} className={`border-t border-white/80 dark:border-white/10 ${p.active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2">
                      <div className="font-semibold text-ink dark:text-[#f5f2ea]">{p.name}</div>
                      <div className="text-[11px] text-muted dark:text-[#c3beb0] inline-flex items-center gap-2">
                        <span>{p.programmeId}</span>
                        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><ExternalLink className="w-3 h-3" /> <Trans>site</Trans></a>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{kindLabel[p.kind]}</td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{sourceLabel(p.source)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink dark:text-[#f5f2ea]" title={t`Open or forthcoming / total`}>
                      {nf(p.openCalls)} <span className="text-muted dark:text-[#c3beb0]">/ {nf(p.calls)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink dark:text-[#f5f2ea]">{nf(p.matches)}</td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0] whitespace-nowrap">{p.lastCollectedAt ? fmtDateTime(p.lastCollectedAt) : <Trans>never</Trans>}</td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={p.active} disabled={busy === p.programmeId} onChange={() => toggle(p)} />
                        <span className="text-[12px] text-muted dark:text-[#c3beb0]">{p.active ? t`collected` : t`off`}</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h3 className="text-[14px] font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Collections</Trans></h3>
        {collections.length === 0 ? (
          <p className="text-[13px] text-muted dark:text-[#c3beb0]"><Trans>No collection yet: the nightly job has not run, or no programme is active.</Trans></p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted dark:text-[#c3beb0]">
                  <th className="px-4 py-2 font-semibold"><Trans>Started</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Source</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Programmes</Trans></th>
                  <th className="px-3 py-2 font-semibold text-right"><Trans>Seen</Trans></th>
                  <th className="px-3 py-2 font-semibold text-right"><Trans>New</Trans></th>
                  <th className="px-3 py-2 font-semibold text-right"><Trans>Updated</Trans></th>
                  <th className="px-3 py-2 font-semibold text-right"><Trans>Texts fetched</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Result</Trans></th>
                </tr>
              </thead>
              <tbody>
                {collections.map((c) => (
                  <tr key={c.id} className="border-t border-white/80 dark:border-white/10">
                    <td className="px-4 py-2 whitespace-nowrap text-ink dark:text-[#f5f2ea]">{fmtDateTime(c.startedAt)}</td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{sourceLabel(c.source)}</td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{c.programmeIds.join(', ')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{nf(c.callsSeen)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{nf(c.callsNew)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{nf(c.callsUpdated)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{nf(c.detailsFetched)}</td>
                    <td className="px-3 py-2">
                      {c.status === 'running' ? <span className="text-muted dark:text-[#c3beb0]"><Trans>running</Trans></span>
                        : c.status === 'failed' ? <span className="text-red-700 dark:text-red-300" title={c.error}><Trans>failed</Trans></span>
                        : <span className="text-emerald-700 dark:text-emerald-300" title={c.error}><Trans>done</Trans>{c.error && <> · <Plural value={c.error.split('\n').length} one="# error" other="# errors" /></>}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
