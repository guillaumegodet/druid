// « Ajouter à un rapport » (docs/plan-mes-rapports.md, lot 4): adds the clicked dashboard chart to
// one of the reports the user may edit, or to a new report. When the report scope differs from
// the dashboard view, the user chooses whether the chart follows the report or keeps the view.

import React, { useEffect, useMemo, useState } from 'react';
import { Check, FilePlus2, RefreshCw, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import {
  appendBlock,
  chartBlockFor,
  newReportFromChart,
  scopeDifferences,
  type AdditionMode,
  type ChartCapture,
} from '../dashboard/report/addToReport';
import { REPORT_LIMITS } from '../dashboard/report/definition';
import { resolvePeriod } from '../dashboard/report/restrictDataset';
import { reportsBackend, type ReportSummary, type StoredReport } from '../dashboard/report/reportsApi';

const NEW = -1;

export const AddToReportDialog: React.FC<{
  capture: ChartCapture;
  chartTitle: string;
  onClose: () => void;
  onOpenReport?: (id: number) => void;
}> = ({ capture, chartTitle, onClose, onOpenReport }) => {
  const { t, i18n } = useLingui();
  const backend = reportsBackend();
  const [targets, setTargets] = useState<ReportSummary[] | null>(null);
  const [targetId, setTargetId] = useState<number>(NEW);
  const [target, setTarget] = useState<StoredReport | null>(null);
  const [newName, setNewName] = useState(() => t`Report — ${capture.slug}`);
  const [mode, setMode] = useState<AdditionMode>('report');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Reports the user may edit: their own and those shared with them as editor.
  useEffect(() => {
    backend.list()
      .then((l) => {
        const editable = [...l.mine, ...l.shared.filter((r) => r.role === 'editor')];
        setTargets(editable);
        if (editable.length) setTargetId(editable[0].id);
      })
      .catch((e) => { setTargets([]); setError(apiErrorText(e)); });
  }, [backend]);

  // The chosen report, to compare its scope with the dashboard view.
  useEffect(() => {
    setTarget(null);
    if (targetId === NEW) return;
    let cancelled = false;
    backend.get(targetId)
      .then((r) => {
        if (cancelled) return;
        setTarget(r);
        // Same structure: the chart most likely belongs to the report scope; else keep the view.
        if (r.definition) setMode(r.definition.context.slug === capture.slug ? 'report' : 'dashboard');
      })
      .catch((e) => { if (!cancelled) setError(apiErrorText(e)); });
    return () => { cancelled = true; };
  }, [targetId, backend, capture.slug]);

  const diff = useMemo(
    () => (target?.definition ? scopeDifferences(target.definition, capture) : null),
    [target, capture],
  );
  const differs = diff != null && Object.values(diff).some(Boolean);
  const full = !!target?.definition && target.definition.blocks.length >= REPORT_LIMITS.maxBlocks;

  const viewLabel = `${capture.slug} · ${capture.range.start === capture.range.end ? capture.range.start : `${capture.range.start}–${capture.range.end}`} · ${capture.perimetre === 'effectifs' ? t`Headcount` : t`Affiliation`}`;
  const reportLabel = (() => {
    const d = target?.definition;
    if (!d) return '';
    const r = resolvePeriod(d.context.period);
    return `${d.context.slug} · ${r.start === r.end ? r.start : `${r.start}–${r.end}`} · ${d.context.perimetre === 'effectifs' ? t`Headcount` : t`Affiliation`}`;
  })();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (targetId === NEW) {
        const r = await backend.create(newReportFromChart(capture, newName, i18n.locale === 'en' ? 'en' : 'fr'));
        setDone({ id: r.id, name: r.name });
      } else if (target?.definition) {
        const def = appendBlock(target.definition, chartBlockFor(target.definition, capture, differs ? mode : 'report'));
        const r = await backend.update(target.id, { definition: def, expectedUpdatedAt: target.updatedAt });
        setDone({ id: r.id, name: r.name });
      }
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && targets != null && (targetId === NEW ? !!newName.trim() : !!target?.definition && !full);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card-strong w-full max-w-lg p-5 flex flex-col gap-4 bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-disp font-bold text-xl text-ink dark:text-[#f5f2ea]"><Trans>Add to a report</Trans></h2>
            <p className="text-sm text-muted dark:text-[#c3beb0]">{chartTitle} — {viewLabel}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t`Close`} className="p-1.5 rounded-lg hover:bg-ink/5 dark:hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <>
            <p className="flex items-center gap-2 text-sm text-ink dark:text-[#f5f2ea]">
              <Check className="w-4 h-4 text-pixel-teal" /> <Trans>Added to « {done.name} ».</Trans>
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn-pill h-9 px-4 text-[13px]"><Trans>Back to the dashboard</Trans></button>
              {onOpenReport && (
                <button type="button" onClick={() => onOpenReport(done.id)} className="btn-pill-dark h-9 px-4 text-[13px]">
                  <Trans>Open the report</Trans>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {targets == null ? (
              <div className="flex items-center gap-2 text-sm text-muted-light dark:text-[#8f897c]">
                <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading your reports…</Trans>
              </div>
            ) : (
              <fieldset className="flex flex-col gap-1 max-h-60 overflow-auto">
                {targets.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer rounded-md px-2 py-1 hover:bg-ink/5 dark:hover:bg-white/5">
                    <input type="radio" name="target" checked={targetId === r.id} onChange={() => setTargetId(r.id)} />
                    <span className="truncate">{r.name}</span>
                    {r.role === 'editor' && <span className="text-xs text-muted-light">({t`by ${r.owner}`})</span>}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md px-2 py-1 hover:bg-ink/5 dark:hover:bg-white/5">
                  <input type="radio" name="target" checked={targetId === NEW} onChange={() => setTargetId(NEW)} />
                  <FilePlus2 className="w-4 h-4 text-muted-light" /> <Trans>New report</Trans>
                </label>
              </fieldset>
            )}

            {targetId === NEW && (
              <input
                className="input-soft"
                value={newName}
                maxLength={200}
                onChange={(e) => setNewName(e.target.value)}
                aria-label={t`Report name`}
              />
            )}

            {targetId !== NEW && differs && (
              <fieldset className="flex flex-col gap-1.5 text-sm">
                <legend className="text-xs font-semibold text-muted dark:text-[#c3beb0] mb-1">
                  {diff?.filters
                    ? <Trans>The report covers {reportLabel}, with filters.</Trans>
                    : <Trans>The report covers {reportLabel}.</Trans>}
                </legend>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="mode" className="mt-1" checked={mode === 'report'} onChange={() => setMode('report')} />
                  <span><Trans>Follow the report scope</Trans> <span className="text-muted-light">— <Trans>the chart is recomputed on the report structure, years and filters</Trans></span></span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="mode" className="mt-1" checked={mode === 'dashboard'} onChange={() => setMode('dashboard')} />
                  <span><Trans>Keep what the dashboard shows</Trans> <span className="text-muted-light">— {viewLabel}</span></span>
                </label>
              </fieldset>
            )}

            {full && <p className="text-sm text-[#b23b3b] dark:text-[#f08c8c]"><Trans>This report already holds the maximum number of blocks.</Trans></p>}
            {error && <p className="text-sm text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn-pill h-9 px-4 text-[13px]"><Trans>Cancel</Trans></button>
              <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="btn-pill-dark h-9 px-4 text-[13px] disabled:opacity-40">
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
                <Trans>Add</Trans>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
