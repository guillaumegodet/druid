// Report editor (docs/plan-mes-rapports.md § 4.3): context bar (structure, period, scope,
// filters), block list with per-block settings, in-page preview, autosave with conflict
// detection, and PDF generation (off-screen capture by batches, then composition). Readers
// who may not edit see the same page read-only and can duplicate the report.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BarChart3, ChevronDown, ChevronUp, Copy, Eye, EyeOff, FileDown, Gauge, Heading, Plus,
  RefreshCw, Share2, Sparkles, Table2, Trash2, Type, X,
} from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { datasetFeatures, scopeFeatures } from '../dashboard/chartMeta';
import { REPORT_TABLES, tableLabel } from '../dashboard/report/reportTables';
import { AI_TASK_LABELS, generateAiText } from '../dashboard/report/reportAi';
import { getUserInfo } from '../../lib/auth';
import { EMBED_CHARTS } from '../dashboard/embedRegistry';
import { KPI_SETS } from '../dashboard/kpiItems';
import { buildFilterContext, describeFilters, type PubFilters } from '../dashboard/publicationFilters';
import { newBlockId, type ReportBlock, type ReportDefinition } from '../dashboard/report/definition';
import { composeReportPdf } from '../dashboard/report/composeReportPdf';
import { ReportRenderer, type CapturedChart, type RenderItem } from '../dashboard/report/ReportRenderer';
import { errorStatus, type ReportsBackend, type StoredReport } from '../dashboard/report/reportsApi';
import { chartParamDefs, reportSlugs, resolveReport, type ResolvedReport } from '../dashboard/report/resolveReport';
import { useReportDatasets } from '../dashboard/report/useReportDatasets';
import { ChartPicker } from './ChartPicker';
import { PerimetreSelect, PeriodInput, selectCls, StructureSelect } from './ReportControls';
import { ReportPreview } from './ReportPreview';
import { ShareDialog, type ShareCandidate } from './ShareDialog';

type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

/** Charts captured per batch: bounds the number of ECharts instances mounted at once. */
const PDF_BATCH = 6;

interface PdfRun {
  definition: ReportDefinition;
  resolved: ResolvedReport;
  batches: RenderItem[][];
  index: number;
  captures: CapturedChart[];
  missing: string[];
}

export const ReportEditor: React.FC<{
  reportId: number;
  backend: ReportsBackend;
  onBack: () => void;
  onOpenReport: (id: number | null) => void;
  /** People the report can be shared with (suggestions). */
  shareCandidates?: ShareCandidate[];
}> = ({ reportId, backend, onBack, onOpenReport, shareCandidates = [] }) => {
  const { t } = useLingui();
  const [stored, setStored] = useState<StoredReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReportDefinition | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [pdfRun, setPdfRun] = useState<PdfRun | null>(null);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // AI text being generated (one block at a time).
  const [aiRun, setAiRun] = useState<{ blockId: string; done: number; total: number } | null>(null);
  const [aiError, setAiError] = useState<{ blockId: string; message: string } | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(() => {
    setLoadError(null);
    backend.get(reportId)
      .then((r) => {
        setStored(r);
        setDraft(r.definition);
        setSaveState('saved');
        setSaveError(null);
      })
      .catch((e) => setLoadError(apiErrorText(e)));
  }, [backend, reportId]);
  useEffect(load, [load]);

  const canEdit = !!stored && !!draft && (stored.role === 'owner' || stored.role === 'editor');

  // ── Autosave (debounced; refused with 409 when someone else saved in between) ──
  const save = useCallback(async (def: ReportDefinition, base: StoredReport) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveState('saving');
    try {
      const r = await backend.update(reportId, { definition: def, expectedUpdatedAt: base.updatedAt });
      setStored(r);
      setSaveState((s) => (s === 'saving' ? 'saved' : s));
      setSaveError(null);
    } catch (e) {
      setSaveState(errorStatus(e) === 409 ? 'conflict' : 'error');
      setSaveError(apiErrorText(e));
    } finally {
      savingRef.current = false;
    }
  }, [backend, reportId]);
  useEffect(() => {
    if (saveState !== 'pending' || !draft || !stored || !canEdit) return;
    const h = window.setTimeout(() => void save(draft, stored), 1200);
    return () => window.clearTimeout(h);
  }, [saveState, draft, stored, canEdit, save]);

  const edit = (fn: (d: ReportDefinition) => ReportDefinition) => {
    if (!canEdit) return;
    setDraft((d) => (d ? fn(d) : d));
    setSaveState((s) => (s === 'conflict' ? s : 'pending'));
  };
  const editBlocks = (fn: (bs: ReportBlock[]) => ReportBlock[]) => edit((d) => ({ ...d, blocks: fn(d.blocks) }));
  const patchBlock = (id: string, patch: Partial<ReportBlock>) =>
    editBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as ReportBlock) : b)));
  const addBlock = (block: ReportBlock) => {
    editBlocks((bs) => {
      const at = selectedId ? bs.findIndex((b) => b.id === selectedId) : -1;
      return at >= 0 ? [...bs.slice(0, at + 1), block, ...bs.slice(at + 1)] : [...bs, block];
    });
    setSelectedId(block.id);
  };
  const move = (id: string, delta: -1 | 1) =>
    editBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const out = [...bs];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });

  const back = async () => {
    if (saveState === 'pending' && draft && stored && canEdit) await save(draft, stored);
    onBack();
  };
  const duplicate = async () => {
    try {
      const copy = await backend.duplicate(reportId, t`${stored?.name ?? ''} (copy)`);
      onOpenReport(copy.id);
    } catch (e) {
      setSaveError(apiErrorText(e));
    }
  };

  // ── Data and resolution ──
  const slugs = useMemo(() => (draft ? reportSlugs(draft) : []), [draft]);
  const datasets = useReportDatasets(slugs);
  const resolved = useMemo(() => (draft ? resolveReport(draft, datasets) : null), [draft, datasets]);
  const mainDataset = draft ? datasets[draft.context.slug] : undefined;
  const features = useMemo(
    () => (mainDataset && draft ? scopeFeatures(datasetFeatures(mainDataset), draft.context.filters) : null),
    [mainDataset, draft],
  );
  const filterChips = useMemo(() => {
    if (!draft || !mainDataset) return [];
    const chips = describeFilters(draft.context.filters, buildFilterContext(mainDataset));
    return draft.context.filters.q?.trim()
      ? [{ key: 'q' as keyof PubFilters, label: `“${draft.context.filters.q.trim()}”` }, ...chips]
      : chips;
  }, [draft, mainDataset]);
  const removeFilter = (key: keyof PubFilters) =>
    edit((d) => {
      const filters = { ...d.context.filters };
      delete filters[key];
      if (key === 'charterCompliant') delete filters.charteSeuil;
      return { ...d, context: { ...d.context, filters } };
    });

  // ── AI texts (reportAi.ts): the code computes, ILAAS writes; a new text is « not reviewed » ──
  const generateAi = async (blockId: string) => {
    const rb = resolved?.blocks.find((x) => x.block.id === blockId);
    if (!draft || !rb || rb.block.kind !== 'ai' || rb.status !== 'ok' || !rb.dataset) return;
    setAiError(null);
    setAiRun({ blockId, done: 0, total: 1 });
    try {
      const r = await generateAiText(rb.block.task, rb, draft, (p) => setAiRun({ blockId, ...p }));
      patchBlock(blockId, { text: r.text, model: r.model, reviewedBy: undefined, reviewedAt: undefined });
    } catch (e) {
      setAiError({ blockId, message: apiErrorText(e) });
    } finally {
      setAiRun(null);
    }
  };

  // ── PDF ──
  const loadingData = resolved?.blocks.some((rb) => rb.status === 'loading') ?? true;
  const startPdf = () => {
    if (!draft || !resolved) return;
    const items: RenderItem[] = resolved.blocks
      .filter((rb) => !rb.block.hidden && rb.block.kind === 'chart' && rb.status === 'ok' && rb.dataset && rb.scope)
      .map((rb) => ({
        key: rb.block.id,
        chartId: (rb.block as Extract<ReportBlock, { kind: 'chart' }>).chartId,
        dataset: rb.dataset!,
        range: rb.scope!.range,
        params: rb.params,
        filters: rb.scope!.filters,
      }));
    const batches: RenderItem[][] = [];
    for (let i = 0; i < items.length; i += PDF_BATCH) batches.push(items.slice(i, i + PDF_BATCH));
    setPdfMessage(null);
    setPdfRun({ definition: draft, resolved, batches, index: 0, captures: [], missing: [] });
  };
  const onBatchDone = (caps: CapturedChart[], miss: string[]) =>
    setPdfRun((run) => run && { ...run, index: run.index + 1, captures: [...run.captures, ...caps], missing: [...run.missing, ...miss] });
  useEffect(() => {
    if (!pdfRun || pdfRun.index < pdfRun.batches.length) return;
    const run = pdfRun;
    setPdfRun(null);
    (async () => {
      try {
        await composeReportPdf({
          definition: run.definition,
          resolved: run.resolved,
          datasets,
          captures: new Map(run.captures.map((c) => [c.id, c])),
        });
        if (backend.kind === 'server') {
          const s = run.resolved.scope;
          await backend.addGeneration(reportId, {
            definitionSnapshot: {
              ...run.definition,
              context: { ...run.definition.context, period: { kind: 'fixed', start: s.range.start, end: s.range.end } },
            },
            publicationCount: run.resolved.publicationCount ?? undefined,
          }).catch((e) => console.warn('Report: generation not recorded in the history', e));
        }
        setPdfMessage(run.missing.length
          ? t`PDF downloaded — ${run.missing.length} chart(s) could not be captured and were left out.`
          : t`PDF downloaded.`);
      } catch (e) {
        console.error('Report PDF generation failed', e);
        setPdfMessage(t`PDF report generation failed — see the browser console.`);
      }
    })();
  }, [pdfRun, datasets, backend, reportId, t]);

  // ── Render ──
  if (loadError) {
    return (
      <div className="p-6 flex flex-col gap-3">
        <button type="button" onClick={onBack} className="btn-pill h-9 px-3 text-[13px] self-start"><ArrowLeft className="w-4 h-4" /> <Trans>My reports</Trans></button>
        <div className="glass-card p-5 text-sm text-[#b23b3b] dark:text-[#f08c8c]">{loadError}</div>
      </div>
    );
  }
  if (!stored) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading…</Trans>
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="p-6 flex flex-col gap-3">
        <button type="button" onClick={onBack} className="btn-pill h-9 px-3 text-[13px] self-start"><ArrowLeft className="w-4 h-4" /> <Trans>My reports</Trans></button>
        <div className="glass-card p-5 text-sm text-[#b23b3b] dark:text-[#f08c8c]">
          <Trans>This report can no longer be opened: its definition does not match the current format ({stored.definitionError}).</Trans>
        </div>
      </div>
    );
  }

  const selected = draft.blocks.find((b) => b.id === selectedId) ?? null;
  // Sharing: the owner and super admins, on a server backend (not in the browser of a read-only instance).
  const canShare = backend.kind === 'server' && (stored.role === 'owner' || stored.role === 'admin');
  const shareSummary = [
    stored.shares?.length ? t`${stored.shares.length} people` : null,
    stored.visibility === 'instance' ? t`everyone` : null,
    stored.publishedTemplate ? t`template` : null,
  ].filter(Boolean).join(', ');
  const pdfBusy = pdfRun != null;
  const saveLabel: Record<SaveState, string> = {
    saved: t`Saved`,
    pending: t`Unsaved changes…`,
    saving: t`Saving…`,
    error: t`Not saved`,
    conflict: t`Changed elsewhere`,
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 md:px-7 pt-5 pb-3 flex flex-col gap-3 border-b border-ink/5 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void back()} className="btn-pill h-9 px-3 text-[13px]">
            <ArrowLeft className="w-4 h-4" /> <Trans>My reports</Trans>
          </button>
          <input
            className="flex-1 min-w-[220px] bg-transparent font-disp font-bold text-2xl md:text-[28px] text-ink dark:text-[#f5f2ea] outline-none border-b border-transparent focus:border-accent disabled:opacity-100"
            value={draft.name}
            maxLength={200}
            disabled={!canEdit}
            onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
            aria-label={t`Report name`}
          />
          <span className={`text-xs ${saveState === 'error' || saveState === 'conflict' ? 'text-[#b23b3b] dark:text-[#f08c8c]' : 'text-muted-light dark:text-[#8f897c]'}`}>
            {canEdit ? saveLabel[saveState] : t`Read only`}
          </span>
          {canShare && (
            <button type="button" onClick={() => setSharing(true)} className="btn-pill h-9 px-3 text-[13px]" title={t`Share the report`}>
              <Share2 className="w-4 h-4" /> <Trans>Share</Trans>
              {shareSummary && <span className="text-xs text-muted-light dark:text-[#8f897c]">· {shareSummary}</span>}
            </button>
          )}
          <button type="button" onClick={() => void duplicate()} className="btn-pill h-9 px-3 text-[13px]" title={t`Make your own copy`}>
            <Copy className="w-4 h-4" /> <Trans>Duplicate</Trans>
          </button>
          <button
            type="button"
            onClick={startPdf}
            disabled={pdfBusy || loadingData || draft.blocks.length === 0}
            className="btn-pill-dark h-9 px-4 text-[13px] disabled:opacity-40"
          >
            {pdfBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {pdfBusy
              ? t`Rendering charts ${Math.min(pdfRun!.index + 1, pdfRun!.batches.length)}/${Math.max(1, pdfRun!.batches.length)}…`
              : t`Generate the PDF`}
          </button>
        </div>
        <textarea
          className="input-soft text-sm resize-y min-h-[2.5rem]"
          rows={1}
          value={draft.description}
          maxLength={2000}
          disabled={!canEdit}
          placeholder={canEdit ? t`Description (printed on the cover page)` : ''}
          onChange={(e) => edit((d) => ({ ...d, description: e.target.value }))}
        />
        <input
          className="input-soft text-xs"
          value={draft.footerNote ?? ''}
          maxLength={200}
          disabled={!canEdit}
          placeholder={canEdit ? t`Footer note on every PDF page (e.g. Internal working document)` : ''}
          onChange={(e) => edit((d) => ({ ...d, footerNote: e.target.value || undefined }))}
          aria-label={t`Footer note`}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StructureSelect
            value={draft.context.slug}
            disabled={!canEdit}
            onChange={(slug) => edit((d) => ({ ...d, context: { ...d.context, slug } }))}
          />
          <PeriodInput
            value={draft.context.period}
            disabled={!canEdit}
            onChange={(period) => edit((d) => ({ ...d, context: { ...d.context, period } }))}
          />
          <PerimetreSelect
            value={draft.context.perimetre}
            disabled={!canEdit}
            onChange={(perimetre) => edit((d) => ({ ...d, context: { ...d.context, perimetre } }))}
          />
          {filterChips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-accent/25 text-xs font-semibold text-ink dark:text-[#f5f2ea]">
              {c.label}
              {canEdit && (
                <button type="button" onClick={() => removeFilter(c.key)} aria-label={t`Remove this filter`} className="p-0.5 rounded-full hover:bg-ink/10">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
          {resolved?.publicationCount != null && (
            <span className="text-xs text-muted-light dark:text-[#8f897c]">
              <Trans>{resolved.publicationCount} publications</Trans>
            </span>
          )}
        </div>
        {saveState === 'conflict' && (
          <div className="glass-card p-3 text-sm flex flex-wrap items-center gap-3 text-[#b23b3b] dark:text-[#f08c8c]">
            <Trans>This report was changed elsewhere since you opened it; your latest changes are not saved.</Trans>
            <button type="button" onClick={load} className="btn-pill h-8 px-3 text-[12px]"><Trans>Reload the saved version</Trans></button>
          </div>
        )}
        {saveState === 'error' && saveError && (
          <div className="text-sm text-[#b23b3b] dark:text-[#f08c8c]">{saveError}</div>
        )}
        {pdfMessage && <div className="text-sm text-muted dark:text-[#c3beb0]">{pdfMessage}</div>}
      </header>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[340px_1fr]">
        <aside className="overflow-auto p-4 md:pl-7 flex flex-col gap-3 border-r border-ink/5 dark:border-white/10">
          {canEdit && (
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className="btn-pill h-8 text-[12px] justify-center" onClick={() => setPicker(true)}>
                <BarChart3 className="w-3.5 h-3.5" /> <Trans>Chart</Trans>
              </button>
              <button
                type="button"
                className="btn-pill h-8 text-[12px] justify-center"
                onClick={() => addBlock({ id: newBlockId(), kind: 'kpis', setId: 'overview' })}
              >
                <Gauge className="w-3.5 h-3.5" /> <Trans>Key figures</Trans>
              </button>
              <button
                type="button"
                className="btn-pill h-8 text-[12px] justify-center"
                onClick={() => addBlock({ id: newBlockId(), kind: 'section', title: t`New section` })}
              >
                <Heading className="w-3.5 h-3.5" /> <Trans>Section</Trans>
              </button>
              <button
                type="button"
                className="btn-pill h-8 text-[12px] justify-center"
                onClick={() => addBlock({ id: newBlockId(), kind: 'text', markdown: '' })}
              >
                <Type className="w-3.5 h-3.5" /> <Trans>Text</Trans>
              </button>
              <button
                type="button"
                className="btn-pill h-8 text-[12px] justify-center"
                onClick={() => addBlock({ id: newBlockId(), kind: 'table', tableId: 'publications' })}
              >
                <Table2 className="w-3.5 h-3.5" /> <Trans>Publication list</Trans>
              </button>
              <button
                type="button"
                className="btn-pill h-8 text-[12px] justify-center"
                onClick={() => addBlock({ id: newBlockId(), kind: 'ai', task: 'executive' })}
              >
                <Sparkles className="w-3.5 h-3.5" /> <Trans>AI text</Trans>
              </button>
            </div>
          )}
          <ol className="flex flex-col gap-1">
            {draft.blocks.map((b, i) => (
              <li key={b.id}>
                <div
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm cursor-pointer ${selectedId === b.id ? 'bg-accent/30' : 'hover:bg-ink/5 dark:hover:bg-white/5'} ${b.hidden ? 'opacity-50' : ''}`}
                  onClick={() => setSelectedId(b.id)}
                >
                  <BlockIcon block={b} />
                  <span className={`flex-1 truncate ${b.kind === 'section' ? 'font-semibold' : ''}`}>{blockLabel(b, t)}</span>
                  {canEdit && (
                    <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
                      <IconBtn label={t`Move up`} disabled={i === 0} onClick={() => move(b.id, -1)}><ChevronUp className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label={t`Move down`} disabled={i === draft.blocks.length - 1} onClick={() => move(b.id, 1)}><ChevronDown className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label={b.hidden ? t`Show in the PDF` : t`Hide from the PDF`} onClick={() => patchBlock(b.id, { hidden: !b.hidden })}>
                        {b.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </IconBtn>
                      <IconBtn label={t`Delete`} onClick={() => { editBlocks((bs) => bs.filter((x) => x.id !== b.id)); if (selectedId === b.id) setSelectedId(null); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconBtn>
                    </span>
                  )}
                </div>
                {selectedId === b.id && selected && (
                  <BlockSettings
                    block={selected}
                    canEdit={canEdit}
                    onPatch={(p) => patchBlock(b.id, p)}
                    ai={{
                      available: resolved?.blocks.find((x) => x.block.id === b.id)?.status === 'ok',
                      running: aiRun?.blockId === b.id ? aiRun : null,
                      busy: aiRun != null,
                      error: aiError?.blockId === b.id ? aiError.message : null,
                      onGenerate: () => void generateAi(b.id),
                    }}
                  />
                )}
              </li>
            ))}
          </ol>
          {draft.blocks.length === 0 && (
            <p className="text-xs text-muted-light dark:text-[#8f897c]">
              {canEdit ? <Trans>Add a first block with the buttons above.</Trans> : <Trans>This report is empty.</Trans>}
            </p>
          )}
        </aside>
        <main className="overflow-auto p-4 md:pr-7">
          {resolved && <ReportPreview resolved={resolved} selectedId={selectedId} onSelect={setSelectedId} />}
        </main>
      </div>

      {sharing && (
        <ShareDialog
          report={stored}
          definition={draft}
          backend={backend}
          candidates={shareCandidates}
          onClose={() => setSharing(false)}
          // Only the report metadata changed: the draft (possibly with pending edits) is kept.
          onSaved={(r) => setStored(r)}
        />
      )}
      {picker && (
        <ChartPicker
          features={features}
          onClose={() => setPicker(false)}
          onPick={(chartId) => {
            setPicker(false);
            addBlock({ id: newBlockId(), kind: 'chart', chartId });
          }}
        />
      )}
      {pdfRun && pdfRun.index < pdfRun.batches.length && (
        <ReportRenderer key={`pdf-${pdfRun.index}`} items={pdfRun.batches[pdfRun.index]} onDone={onBatchDone} />
      )}
    </div>
  );
};

const IconBtn: React.FC<{ label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({
  label, onClick, disabled, children,
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className="p-1 rounded text-muted-light hover:text-ink hover:bg-ink/10 dark:hover:text-[#f5f2ea] dark:hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
  >
    {children}
  </button>
);

const BlockIcon: React.FC<{ block: ReportBlock }> = ({ block }) => {
  const cls = 'w-4 h-4 shrink-0 text-muted-light';
  if (block.kind === 'chart') return <BarChart3 className={cls} />;
  if (block.kind === 'kpis') return <Gauge className={cls} />;
  if (block.kind === 'section') return <Heading className={cls} />;
  if (block.kind === 'table') return <Table2 className={cls} />;
  if (block.kind === 'ai') return <Sparkles className={cls} />;
  return <Type className={cls} />;
};

type Translate = ReturnType<typeof useLingui>['t'];

function blockLabel(b: ReportBlock, t: Translate): string {
  if (b.kind === 'section') return b.title || t`Untitled section`;
  if (b.kind === 'text') return b.markdown.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 80) || t`Empty text`;
  if (b.kind === 'kpis') return KPI_SETS[b.setId] ? t(KPI_SETS[b.setId].label) : b.setId;
  if (b.kind === 'chart') {
    const entry = EMBED_CHARTS[b.chartId];
    return b.title?.trim() || (entry ? t(entry.label) : b.chartId);
  }
  if (b.kind === 'table') return tableLabel(b.tableId);
  return t(AI_TASK_LABELS[b.task]);
}

/** Generation state of an AI block, handed down by the editor. */
interface AiControls {
  /** The block data is loaded (its scope resolved). */
  available: boolean;
  running: { done: number; total: number } | null;
  /** Another AI text is being generated. */
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
}

/** Settings of the selected block, under its line in the block list. */
const BlockSettings: React.FC<{
  block: ReportBlock;
  canEdit: boolean;
  onPatch: (patch: Partial<ReportBlock>) => void;
  ai: AiControls;
}> = ({ block, canEdit, onPatch, ai }) => {
  const { t } = useLingui();
  const box = 'mt-1 mb-2 ml-6 p-3 rounded-lg bg-white/60 dark:bg-white/5 flex flex-col gap-2 text-sm';
  if (block.kind === 'ai') {
    const reviewed = !!block.reviewedBy;
    return (
      <div className={box}>
        <select className={selectCls} value={block.task} disabled={!canEdit || ai.busy}
          onChange={(e) => onPatch({ task: e.target.value as 'executive' | 'domains' })}>
          <option value="executive">{t(AI_TASK_LABELS.executive)}</option>
          <option value="domains">{t(AI_TASK_LABELS.domains)}</option>
        </select>
        <p className="text-[11px] text-muted-light dark:text-[#8f897c]">
          {block.task === 'domains'
            ? <Trans>Groups the topics of the corpus into major themes, then writes a synthesis per theme; the figures are computed by Druid.</Trans>
            : <Trans>Summary, key points and cooperation leads written from the key figures and the analysis by theme of this report (generate it first).</Trans>}
        </p>
        {canEdit && (
          <button type="button" onClick={ai.onGenerate} disabled={!ai.available || ai.busy}
            className="btn-pill h-8 px-3 text-[12px] self-start disabled:opacity-40">
            {ai.running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {ai.running
              ? t`Writing… ${ai.running.done}/${ai.running.total}`
              : block.text ? t`Regenerate` : t`Generate`}
          </button>
        )}
        {ai.error && <p className="text-xs text-[#b23b3b] dark:text-[#f08c8c]">{ai.error}</p>}
        {block.text !== undefined && (
          <>
            <textarea className="input-soft text-[13px]" rows={10} value={block.text} maxLength={20000} disabled={!canEdit}
              onChange={(e) => onPatch({ text: e.target.value })} aria-label={t`Text`} />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!canEdit}
                onChange={(e) =>
                  onPatch(e.target.checked
                    ? { reviewedBy: getUserInfo().name || getUserInfo().preferred_username, reviewedAt: new Date().toISOString().slice(0, 10) }
                    : { reviewedBy: undefined, reviewedAt: undefined })}
              />
              <Trans>I have reviewed this text (printed in the PDF)</Trans>
            </label>
          </>
        )}
      </div>
    );
  }
  if (block.kind === 'section') {
    return (
      <div className={box}>
        <input className="input-soft" value={block.title} maxLength={300} disabled={!canEdit}
          onChange={(e) => onPatch({ title: e.target.value })} aria-label={t`Section title`} />
      </div>
    );
  }
  if (block.kind === 'text') {
    return (
      <div className={box}>
        <textarea className="input-soft font-mono text-[13px]" rows={8} value={block.markdown} maxLength={20000} disabled={!canEdit}
          onChange={(e) => onPatch({ markdown: e.target.value })} aria-label={t`Text`} />
        <p className="text-[11px] text-muted-light dark:text-[#8f897c]">
          <Trans># heading · - bullet · **bold** · *italic* · [label](https://…) · blank line = new paragraph</Trans>
        </p>
      </div>
    );
  }
  if (block.kind === 'table') {
    return (
      <div className={box}>
        <select className={selectCls} value={block.tableId} disabled={!canEdit} onChange={(e) => onPatch({ tableId: e.target.value })}>
          {Object.keys(REPORT_TABLES).map((id) => <option key={id} value={id}>{tableLabel(id)}</option>)}
        </select>
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted dark:text-[#c3beb0] w-28"><Trans>Max. rows in the PDF</Trans></span>
          <input type="number" className="input-soft !w-24" min={1} max={5000} disabled={!canEdit}
            value={block.limit ?? ''} placeholder="500"
            onChange={(e) => onPatch({ limit: e.target.value === '' ? undefined : Math.max(1, Math.min(5000, Number(e.target.value))) })} />
        </label>
      </div>
    );
  }
  if (block.kind === 'kpis') {
    return (
      <div className={box}>
        <select className={selectCls} value={block.setId} disabled={!canEdit} onChange={(e) => onPatch({ setId: e.target.value })}>
          {Object.entries(KPI_SETS).map(([id, set]) => <option key={id} value={id}>{t(set.label)}</option>)}
        </select>
      </div>
    );
  }
  if (block.kind !== 'chart') return null;
  const params = block.params ?? {};
  const setParam = (key: string, value: number | string | undefined) => {
    const next = { ...params };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    onPatch({ params: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className={box}>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted dark:text-[#c3beb0]"><Trans>Title (optional)</Trans></span>
        <input className="input-soft" value={block.title ?? ''} maxLength={300} disabled={!canEdit}
          placeholder={EMBED_CHARTS[block.chartId] ? t(EMBED_CHARTS[block.chartId].label) : ''}
          onChange={(e) => onPatch({ title: e.target.value || undefined })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted dark:text-[#c3beb0]"><Trans>Note printed under the chart</Trans></span>
        <textarea className="input-soft" rows={3} value={block.note ?? ''} maxLength={20000} disabled={!canEdit}
          onChange={(e) => onPatch({ note: e.target.value || undefined })} />
      </label>
      {chartParamDefs(block.chartId).map((def) => (
        <label key={def.key} className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted dark:text-[#c3beb0] w-28">{paramLabel(def.key, t)}</span>
          {def.values ? (
            <select className={selectCls} value={String(params[def.key] ?? def.default ?? def.values[0])} disabled={!canEdit}
              onChange={(e) => setParam(def.key, e.target.value)}>
              {def.values.map((v) => <option key={v} value={v}>{paramValueLabel(v, t)}</option>)}
            </select>
          ) : (
            <input type="number" className="input-soft !w-24" min={def.min} max={def.max} disabled={!canEdit}
              value={params[def.key] ?? ''} placeholder={def.default != null ? String(def.default) : t`auto`}
              onChange={(e) => setParam(def.key, e.target.value === '' ? undefined : Number(e.target.value))} />
          )}
        </label>
      ))}
      {((block.override && Object.keys(block.override).length > 0) || block.ownFilters) && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted dark:text-[#c3beb0]">
          <Trans>This chart has its own scope (structure, period or filters).</Trans>
          {canEdit && (
            <button type="button" className="btn-pill h-7 px-2 text-[11px]" onClick={() => onPatch({ override: undefined, ownFilters: undefined })}>
              <Plus className="w-3 h-3 rotate-45" /> <Trans>Use the report scope</Trans>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

function paramLabel(key: string, t: Translate): string {
  switch (key) {
    case 'thresholdPct': return t`Compliance threshold (%)`;
    case 'n': return t`Number of items`;
    case 'minPubs': return t`Min. publications`;
    case 'level': return t`Level`;
    default: return key;
  }
}
function paramValueLabel(value: string, t: Translate): string {
  if (value === 'subfield') return t`subfield`;
  if (value === 'topic') return t`topic`;
  return value;
}
