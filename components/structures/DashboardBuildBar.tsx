import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CircleStop, RefreshCw } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import type { StructureAlignOverview, StructureAlignRow } from '../../lib/structures/alignView';
import { PixelBtn } from '../researchers/alignAtoms';

/**
 * First build of the dashboards of a tenant (druid-internal docs/plan-druid-saas.md, lot 3 c): the provisioning no
 * longer chains the ETL after the first alignment pass (its candidates are not confirmed yet, the ETL would harvest
 * nothing), the establishment starts it here once its labs carry a confirmed OpenAlex id or HAL collection. The
 * nightly refreshes of the runner take over after a first successful build. Job = `etl.build` through /api/jobs.
 */

interface JobView {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress?: { step?: string; total?: number; done?: number; lab?: string; built?: number; failed?: number } | null;
  finishedAt?: string | null;
  createdAt?: string;
  cancelRequested?: boolean;
  error?: string | null;
}

/** A lab the ETL can harvest: a confirmed OpenAlex institution or HAL collection (the RNSR alone only reaches a BSO
 *  dump, rarely published for a lab). */
export const isLabReadyForEtl = (row: StructureAlignRow): boolean =>
  !!(row.cells.openalex?.existing.length || row.cells.hal_collection?.existing.length);

const live = (j: JobView | null) => !!j && (j.status === 'queued' || j.status === 'running');

export const DashboardBuildBar: React.FC<{ overview: StructureAlignOverview; onToast: (text: string) => void }> = ({ overview, onToast }) => {
  const { t } = useLingui();
  const [job, setJob] = useState<JobView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const ready = useMemo(() => overview.rows.filter(isLabReadyForEtl).length, [overview]);
  const total = overview.rows.length;

  const refresh = async () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    try {
      const r = await fetch('/api/jobs?limit=30');
      if (!r.ok) return;
      const d = await r.json() as { jobs?: JobView[] };
      const last = (d.jobs || []).find((j) => j.type === 'etl.build') || null;
      setJob(last);
      if (live(last)) pollRef.current = window.setTimeout(refresh, 4000);
    } catch { /* the bar stays as it was; the next action reloads it */ } finally { setLoaded(true); }
  };
  useEffect(() => { refresh(); return () => { if (pollRef.current) window.clearTimeout(pollRef.current); }; }, []);

  const start = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'etl.build', params: {} }) });
      if (!r.ok && r.status !== 409) {
        const d = await r.json().catch(() => ({}));
        onToast(apiErrorText(new Error(d.error || `HTTP ${r.status}`)) || `HTTP ${r.status}`);
        return;
      }
      if (r.ok) onToast(t`Dashboard build queued.`);
      await refresh();
    } finally { setBusy(false); }
  };
  const stop = async () => {
    if (!job) return;
    await fetch(`/api/jobs/${job.id}/cancel`, { method: 'POST' }).catch(() => {});
    await refresh();
  };

  const p = job?.progress || {};
  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(numberLocale()) : '');
  let state: string;
  if (!loaded) state = '';
  else if (!job) state = t`Not built yet.`;
  else if (job.status === 'queued') state = t`Build queued…`;
  else if (job.status === 'running') state = p.total ? t`Building: ${p.done ?? 0}/${p.total} lab(s)${p.lab ? ` (${p.lab})` : ''}…` : t`Building…`;
  else if (job.status === 'done') state = t`Built on ${when(job.finishedAt)}: ${p.built ?? 0} dashboard(s), ${p.failed ?? 0} lab(s) failed.`;
  else if (job.status === 'cancelled') state = t`Last build stopped on ${when(job.finishedAt)}.`;
  else state = t`Last build failed on ${when(job.finishedAt)}: ${job.error || ''}`;
  const running = live(job);

  return (
    <div className="flex flex-wrap items-center gap-3 mx-4 md:mx-7 mb-4 px-4 py-3 rounded-card bg-white/60 dark:bg-white/5 border border-ink/10 dark:border-white/10 text-[13px]">
      <BarChart3 className="w-4 h-4 shrink-0 text-muted dark:text-[#8f897c]" />
      <div className="flex-1 min-w-[220px]">
        <div className="font-semibold text-ink dark:text-[#f5f2ea]">
          {t`Dashboards: ${ready} of ${total} lab(s) ready`}
        </div>
        <div className="text-[12px] text-muted dark:text-[#8f897c]">
          {ready === 0
            ? t`Accept at least one OpenAlex identifier or HAL collection (strong candidates below) before building the dashboards: the bibliometric ETL harvests the confirmed values only.`
            : t`A lab is ready when its OpenAlex identifier or HAL collection is confirmed; the others are left out until then.`}
          {state && <> · <span className={job?.status === 'failed' ? 'text-[#b3441f] dark:text-[#e08a6a] font-semibold' : 'font-semibold'}>{state}</span></>}
        </div>
      </div>
      {running && (
        <button type="button" onClick={stop} disabled={!!job?.cancelRequested} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-ink/15 dark:border-white/15 text-[11px] font-semibold hover:bg-white/70 dark:hover:bg-white/10">
          <CircleStop className="w-3 h-3" /> {t`Stop`}
        </button>
      )}
      <PixelBtn onClick={start} disabled={busy || running || ready === 0} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong"
        title={t`Harvests the publications of the ready labs (OpenAlex, HAL, BSO) and builds their dashboards; several minutes per lab`}>
        {running || busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
        {job?.status === 'done' ? t`Rebuild the dashboards` : t`Build the dashboards`}
      </PixelBtn>
    </div>
  );
};
