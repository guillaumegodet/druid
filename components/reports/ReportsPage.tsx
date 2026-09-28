// « Mes rapports » (docs/plan-mes-rapports.md § 4.2): the reports of the user, those shared
// with them and those visible to the whole instance; creation, duplication, deletion; the
// editor opens in place (URL ?page=REPORTS&id=<n>).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, FilePlus2, FileText, RefreshCw, Trash2, Users, Globe2 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import { useCompactHeader } from '../../hooks/useCompactHeader';
import {
  reportsBackend,
  type ReportLists,
  type ReportSummary,
} from '../dashboard/report/reportsApi';
import { ReportEditor } from './ReportEditor';
import { NewReportDialog } from './NewReportDialog';

type ListTab = 'mine' | 'shared' | 'instance';

const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(numberLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const ReportsPage: React.FC<{
  reportId: number | null;
  onOpenReport: (id: number | null) => void;
}> = ({ reportId, onOpenReport }) => {
  const { t } = useLingui();
  const backend = reportsBackend();
  const { compact, onScrollCapture } = useCompactHeader();
  const [lists, setLists] = useState<ReportLists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ListTab>('mine');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const reload = useCallback(() => {
    setError(null);
    backend.list().then(setLists).catch((e) => setError(apiErrorText(e)));
  }, [backend]);
  useEffect(() => {
    if (reportId == null) reload();
  }, [reportId, reload]);

  const rows = useMemo(() => (lists ? lists[tab] : []), [lists, tab]);

  const duplicate = async (r: ReportSummary) => {
    setBusy(r.id);
    try {
      const copy = await backend.duplicate(r.id, t`${r.name} (copy)`);
      onOpenReport(copy.id);
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (id: number) => {
    setBusy(id);
    try {
      await backend.remove(id);
      setConfirmDelete(null);
      reload();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (reportId != null) {
    return <ReportEditor reportId={reportId} backend={backend} onBack={() => onOpenReport(null)} onOpenReport={onOpenReport} />;
  }

  const tabCls = (active: boolean) =>
    `inline-flex items-center gap-2 h-10 px-4 rounded-full font-disp text-[13px] font-semibold transition-colors ${active ? 'bg-accent border border-accent-strong text-ink' : 'bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-muted dark:text-[#8f897c] hover:bg-white dark:hover:bg-white/15'}`;
  const count = (n: number | undefined) =>
    n ? <span className="px-1.5 py-0.5 rounded-full bg-ink/10 dark:bg-white/15 text-[11px] font-bold">{n}</span> : null;

  return (
    <div className="flex flex-col h-full" onScrollCapture={onScrollCapture}>
      <header className="page-header px-4 md:px-7 pt-6 pb-2" data-compact={compact || undefined}>
        <div className="page-header-top flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <FileText className="page-header-icon w-7 h-7 text-[#3b5bdb] dark:text-[#91a7ff]" />
            <div>
              <h1 className="font-disp text-3xl md:text-[38px] font-bold tracking-tight text-ink dark:text-[#f5f2ea] leading-none">
                <Trans>My reports</Trans>
              </h1>
              <p className="page-header-sub text-[15px] text-muted dark:text-[#8f897c] mt-1.5">
                {backend.kind === 'browser'
                  ? <Trans>Reports built from the dashboard charts — kept in this browser on this read-only instance</Trans>
                  : <Trans>Reports built from the dashboard charts, saved, shareable and exportable as PDF</Trans>}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setCreating(true)} className="btn-pill-dark h-10 px-4 text-[13px]">
            <FilePlus2 className="w-4 h-4" /> <Trans>New report</Trans>
          </button>
        </div>
        {backend.kind === 'server' && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setTab('mine')} className={tabCls(tab === 'mine')}>
              <FileText className="w-4 h-4" /> <Trans>My reports</Trans> {count(lists?.mine.length)}
            </button>
            <button onClick={() => setTab('shared')} className={tabCls(tab === 'shared')}>
              <Users className="w-4 h-4" /> <Trans>Shared with me</Trans> {count(lists?.shared.length)}
            </button>
            <button onClick={() => setTab('instance')} className={tabCls(tab === 'instance')}>
              <Globe2 className="w-4 h-4" /> <Trans>Visible to everyone</Trans> {count(lists?.instance.length)}
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto px-4 md:px-7 pb-8">
        {error && (
          <div className="glass-card p-4 mb-3 text-sm text-[#b23b3b] dark:text-[#f08c8c]">{error}</div>
        )}
        {!lists && !error && (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-light dark:text-[#8f897c]">
            <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading…</Trans>
          </div>
        )}
        {lists && rows.length === 0 && (
          <div className="glass-card p-6 text-sm text-muted dark:text-[#c3beb0]">
            {tab === 'mine' ? (
              <Trans>No report yet. Create one, then add charts, key figures and text; its PDF is generated in one click.</Trans>
            ) : tab === 'shared' ? (
              <Trans>No report has been shared with you.</Trans>
            ) : (
              <Trans>No report is visible to everyone on this instance.</Trans>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id} className="glass-card p-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => onOpenReport(r.id)} className="flex-1 min-w-[240px] text-left cursor-pointer">
                  <div className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">{r.name}</div>
                  {r.description && (
                    <div className="text-sm text-muted dark:text-[#c3beb0] line-clamp-2">{r.description}</div>
                  )}
                  <div className="text-xs text-muted-light dark:text-[#8f897c] mt-1 flex flex-wrap gap-x-3">
                    <span><Trans>Updated {formatDate(r.updatedAt)}</Trans></span>
                    {r.lastGeneratedAt && <span><Trans>Last PDF {formatDate(r.lastGeneratedAt)}</Trans></span>}
                    {tab !== 'mine' && <span><Trans>by {r.owner}</Trans></span>}
                    {tab === 'shared' && <span>{r.role === 'editor' ? t`can edit` : t`read only`}</span>}
                    {tab === 'mine' && r.visibility === 'instance' && <span><Trans>visible to everyone</Trans></span>}
                    {tab === 'mine' && !!r.shareCount && <span><Trans>shared with {r.shareCount}</Trans></span>}
                  </div>
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void duplicate(r)}
                    disabled={busy === r.id}
                    title={t`Duplicate`}
                    className="btn-pill h-8 px-3 text-[12px] disabled:opacity-40"
                  >
                    <Copy className="w-3.5 h-3.5" /> <Trans>Duplicate</Trans>
                  </button>
                  {r.role === 'owner' && (confirmDelete === r.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void remove(r.id)}
                        disabled={busy === r.id}
                        className="btn-pill h-8 px-3 text-[12px] text-[#b23b3b] dark:text-[#f08c8c]"
                      >
                        <Trans>Confirm deletion</Trans>
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="btn-pill h-8 px-3 text-[12px]">
                        <Trans>Cancel</Trans>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(r.id)}
                      title={t`Delete`}
                      className="btn-pill h-8 w-8 justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && (
        <NewReportDialog
          backend={backend}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onOpenReport(id);
          }}
        />
      )}
    </div>
  );
};
