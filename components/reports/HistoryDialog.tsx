// History of a report (docs/plan-mes-rapports.md § 4.6, lot 9): every PDF generation — when, by
// whom, on which period and how many publications — with the archived PDF when the instance keeps
// them. The owner may share a generation with every reader as a frozen PDF (decision R1); an
// editor may restore the content of a generation (its definition, period fixed as generated).

import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import { parseReportDefinition, type ReportDefinition } from '../dashboard/report/definition';
import type { GenerationHistory, ReportGeneration, ReportsBackend } from '../dashboard/report/reportsApi';

const periodOf = (g: ReportGeneration): string => {
  const p = (g.definitionSnapshot as { context?: { period?: { start?: number; end?: number } } } | null)?.context?.period;
  if (!p?.start) return '—';
  return p.start === p.end ? String(p.start) : `${p.start}–${p.end}`;
};

export const HistoryDialog: React.FC<{
  reportId: number;
  backend: ReportsBackend;
  canEdit: boolean;
  canManage: boolean;
  onRestore: (definition: ReportDefinition) => void;
  onClose: () => void;
}> = ({ reportId, backend, canEdit, canManage, onRestore, onClose }) => {
  const { t } = useLingui();
  const [history, setHistory] = useState<GenerationHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);

  useEffect(() => {
    backend.listGenerations(reportId).then(setHistory).catch((e) => setError(apiErrorText(e)));
  }, [backend, reportId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleShared = async (g: ReportGeneration) => {
    try {
      const updated = await backend.setGenerationShared(reportId, g.id, !g.sharedFrozen);
      setHistory((h) => h && { ...h, generations: h.generations.map((x) => (x.id === g.id ? { ...x, ...updated } : x)) });
    } catch (e) {
      setError(apiErrorText(e));
    }
  };
  const restore = (g: ReportGeneration) => {
    const r = parseReportDefinition(g.definitionSnapshot);
    if (r.ok === true) {
      onRestore(r.value);
      onClose();
    } else {
      setError(t`This version can no longer be restored: its content does not match the current format.`);
    }
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(numberLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card-strong w-full max-w-3xl max-h-[85vh] overflow-auto p-5 flex flex-col gap-3 bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-disp font-bold text-xl text-ink dark:text-[#f5f2ea]"><Trans>History of the report</Trans></h2>
          <button type="button" onClick={onClose} aria-label={t`Close`} className="p-1.5 rounded-lg hover:bg-ink/5 dark:hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        {!history && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-light dark:text-[#8f897c]">
            <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading…</Trans>
          </p>
        )}
        {error && <p className="text-sm text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
        {history && !history.archive && (
          <p className="text-xs text-muted-light dark:text-[#8f897c]">
            <Trans>PDFs are not archived on this instance: the history keeps the date, author and scope of each generation.</Trans>
          </p>
        )}
        {history && history.archive && (
          <p className="text-xs text-muted-light dark:text-[#8f897c]">
            <Trans>The last 20 PDFs of the report are kept, for two years at most.</Trans>
          </p>
        )}
        {history && history.generations.length === 0 && (
          <p className="text-sm text-muted dark:text-[#c3beb0]">
            {canEdit || canManage
              ? <Trans>No PDF generated yet.</Trans>
              : <Trans>No version of this report has been shared as PDF yet.</Trans>}
          </p>
        )}
        {history && history.generations.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted dark:text-[#c3beb0]">
                <th className="py-1 pr-3 font-semibold"><Trans>Generated</Trans></th>
                <th className="py-1 pr-3 font-semibold"><Trans>By</Trans></th>
                <th className="py-1 pr-3 font-semibold"><Trans>Period</Trans></th>
                <th className="py-1 pr-3 font-semibold text-right"><Trans>Publications</Trans></th>
                <th className="py-1 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {history.generations.map((g) => (
                <tr key={g.id} className="border-t border-ink/5 dark:border-white/10 align-middle">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{when(g.generatedAt)}</td>
                  <td className="py-1.5 pr-3">{g.generatedBy}</td>
                  <td className="py-1.5 pr-3">{periodOf(g)}</td>
                  <td className="py-1.5 pr-3 text-right">{g.publicationCount?.toLocaleString(numberLocale()) ?? '—'}</td>
                  <td className="py-1.5">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {g.hasPdf && (
                        <a href={backend.pdfUrl(reportId, g.id)} className="btn-pill h-7 px-2.5 text-[11px]" download>
                          <Download className="w-3.5 h-3.5" /> PDF
                        </a>
                      )}
                      {canManage && g.hasPdf && (
                        <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer" title={t`Readers of the report can download this frozen PDF`}>
                          <input type="checkbox" checked={g.sharedFrozen} onChange={() => void toggleShared(g)} />
                          <Trans>shared with readers</Trans>
                        </label>
                      )}
                      {canEdit && g.definitionSnapshot != null && (confirmRestore === g.id ? (
                        <>
                          <button type="button" className="btn-pill h-7 px-2.5 text-[11px] text-[#b23b3b] dark:text-[#f08c8c]" onClick={() => restore(g)}>
                            <Trans>Replace the current content</Trans>
                          </button>
                          <button type="button" className="btn-pill h-7 px-2.5 text-[11px]" onClick={() => setConfirmRestore(null)}>
                            <Trans>Cancel</Trans>
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn-pill h-7 px-2.5 text-[11px]" onClick={() => setConfirmRestore(g.id)}
                          title={t`Restore the blocks, texts and scope of this version (period fixed as generated)`}>
                          <RotateCcw className="w-3.5 h-3.5" /> <Trans>Restore</Trans>
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
