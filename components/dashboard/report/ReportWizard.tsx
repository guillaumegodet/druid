// 3-step « Rapport PDF » wizard (phase 2 of the reports project):
// 1. Criteria — period and scope of the corpus, independent of the current
//    dashboard filters (prefilled with them);
// 2. Content — selection of the tabs and charts to include, in catalog
//    order (reportCatalog);
// 3. Preview — off-screen rendering section by section (one ReportRenderer
//    at a time: bounded memory, time cap per section), thumbnails of the
//    captures with the option to discard some, then composition/download.

import { i18n } from '@lingui/core';
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  MinusSquare,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import { DashboardDataset } from '../types';
import { getYearBounds, YearRange } from '../overviewAggregates';
import { YearRangeSelector } from '../YearRangeSelector';
import { EMBED_CHARTS } from '../embedRegistry';
import { REPORT_SECTIONS, ReportSection } from './reportCatalog';
import { CapturedChart, ReportRenderer } from './ReportRenderer';
import { generateReportPdf } from './generateReport';
import { numberLocale } from '../../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';

type Perimetre = 'affiliation' | 'effectifs';

interface ReportWizardProps {
  /** Full dataset (not filtered by scope) of the structure. */
  dataset: DashboardDataset;
  slug: string;
  /** authorIds of the staff members — « Effectifs » scope. */
  memberAuthorIds: Set<number>;
  canScopeHeadcount: boolean;
  /** Keys of the visible dashboard tabs (druid_tabs_hidden, axes…). */
  visibleTabKeys: string[];
  /** Prefilled from the current dashboard state. */
  initialRange: YearRange;
  initialScope: Perimetre;
  onClose: () => void;
}

const STEPS = [msg`Criteria`, msg`Content`, msg`Preview`];

function chartLabel(id: string): string {
  const l = EMBED_CHARTS[id]?.label;
  return l ? i18n._(l) : id;
}

export const ReportWizard: React.FC<ReportWizardProps> = ({
  dataset,
  slug,
  memberAuthorIds,
  canScopeHeadcount,
  visibleTabKeys,
  initialRange,
  initialScope,
  onClose,
}) => {
  const { t } = useLingui();
  const [step, setStep] = useState(0);

  // ── Step 1: criteria ──────────────────────────────────────────────────────
  const [range, setRange] = useState<YearRange>(initialRange);
  const [scope, setScope] = useState<Perimetre>(
    canScopeHeadcount ? initialScope : 'affiliation',
  );

  const scopedDataset = useMemo(() => {
    if (scope !== 'effectifs' || !canScopeHeadcount) return dataset;
    return {
      ...dataset,
      publications: dataset.publications.filter((p) =>
        p.authorIds.some((id) => memberAuthorIds.has(id)),
      ),
    };
  }, [dataset, scope, canScopeHeadcount, memberAuthorIds]);

  const bounds = useMemo(() => getYearBounds(dataset.publications), [dataset]);
  const publicationCount = useMemo(
    () =>
      scopedDataset.publications.filter(
        (p) => p.year != null && p.year >= range.start && p.year <= range.end,
      ).length,
    [scopedDataset, range],
  );

  // ── Step 2: available sections/charts and selection ───────────────────────
  const availableSections = useMemo(
    () => REPORT_SECTIONS.filter((s) => visibleTabKeys.includes(s.tab)),
    [visibleTabKeys],
  );
  // tab → selected ids (catalog order preserved at render time).
  const [selection, setSelection] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(availableSections.map((s) => [s.tab, new Set(s.ids)])),
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const selectedSections = useMemo<ReportSection[]>(
    () =>
      availableSections
        .map((s) => ({ ...s, ids: s.ids.filter((id) => selection[s.tab]?.has(id)) }))
        .filter((s) => s.ids.length > 0),
    [availableSections, selection],
  );
  const selectedCount = selectedSections.reduce((n, s) => n + s.ids.length, 0);

  const toggleChart = (tab: string, id: string) => {
    setSelection((sel) => {
      const ids = new Set(sel[tab]);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { ...sel, [tab]: ids };
    });
  };
  const toggleSection = (s: ReportSection) => {
    setSelection((sel) => ({
      ...sel,
      [s.tab]: sel[s.tab]?.size ? new Set<string>() : new Set(s.ids),
    }));
  };
  const setAll = (on: boolean) => {
    setSelection(
      Object.fromEntries(
        availableSections.map((s) => [s.tab, on ? new Set(s.ids) : new Set<string>()]),
      ),
    );
  };

  // ── Step 3: section-by-section rendering, preview, download ───────────────
  // renderIdx: index of the section being rendered; null = no rendering
  // (preview ready or step not reached). Since criteria/selection are frozen
  // during step 3 (buttons disabled while rendering, going back = reset),
  // the captures stay consistent with the selection.
  const [renderIdx, setRenderIdx] = useState<number | null>(null);
  const [captures, setCaptures] = useState<Record<string, CapturedChart[]>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const rendering = renderIdx != null && renderIdx < selectedSections.length;
  const capturedCount = Object.values<CapturedChart[]>(captures).reduce(
    (n, c) => n + c.length,
    0,
  );

  const startPreview = () => {
    setCaptures({});
    setMissing([]);
    setExcluded(new Set());
    setRenderIdx(0);
    setStep(2);
  };

  const onSectionDone = (section: ReportSection, caps: CapturedChart[], miss: string[]) => {
    setCaptures((c) => ({ ...c, [section.tab]: caps }));
    if (miss.length) setMissing((m) => [...m, ...miss]);
    setRenderIdx((i) => (i == null ? null : i + 1));
  };

  const download = async () => {
    setSaving(true);
    try {
      const sections = selectedSections
        .map((s) => ({
          title: t(s.title),
          charts: (captures[s.tab] ?? []).filter((c) => !excluded.has(c.id)),
        }))
        .filter((s) => s.charts.length > 0);
      await generateReportPdf(sections, {
        lab: dataset.lab,
        name: dataset.name,
        scope: { slug, range, perimetre: scope },
        scopeLabel: scope === 'effectifs' ? t`Headcount` : t`Affiliation`,
        publicationCount,
      });
      onClose();
    } catch (e) {
      console.error('PDF report generation failed', e);
      window.alert(t`PDF report generation failed — see the browser console.`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const finalCount = selectedSections.reduce(
    (n, s) => n + (captures[s.tab] ?? []).filter((c) => !excluded.has(c.id)).length,
    0,
  );

  const iconBtn =
    'shrink-0 p-2 rounded-lg text-muted-light dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors';
  const primaryBtn =
    'btn-pill-dark !h-9 px-4 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed';
  const secondaryBtn = 'btn-pill !h-9 px-4 text-[13px] disabled:opacity-50';
  const label = 'section-label';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card-strong w-full max-w-3xl max-h-[90vh] p-5 flex flex-col gap-4 bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title + step breadcrumb */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
              <Trans>PDF report — {dataset.lab}</Trans>
            </h4>
            <div className="flex items-center gap-1.5 mt-1.5">
              {STEPS.map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-muted-light dark:text-[#8f897c] text-xs">›</span>}
                  <span
                    className={`pill px-2.5 py-0.5 text-[11px] ${
                      i === step
                        ? 'bg-ink text-white dark:bg-accent dark:text-ink'
                        : 'bg-ink/5 dark:bg-white/10 text-muted dark:text-[#c3beb0]'
                    }`}
                  >
                    {i + 1}. {t(s)}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <button type="button" onClick={onClose} className={iconBtn} title={t`Close`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step body */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-4">
          {step === 0 && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className={label}><Trans>Structure</Trans></span>
                <p className="text-sm text-ink dark:text-[#f5f2ea] font-semibold">
                  {dataset.lab}
                  <span className="font-normal text-muted-light dark:text-[#8f897c]"> — {dataset.name}</span>
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={label}><Trans>Period</Trans></span>
                <YearRangeSelector bounds={bounds} range={range} onChange={setRange} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={label}><Trans context="perimeter">Scope</Trans></span>
                {canScopeHeadcount ? (
                  <div className="flex items-center gap-0.5 p-0.5 self-start rounded-full bg-white/60 dark:bg-white/10 border border-white/70 dark:border-white/15">
                    {(
                      [
                        { key: 'affiliation', label: t`Affiliation` },
                        { key: 'effectifs', label: t`Headcount` },
                      ] as const
                    ).map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => setScope(o.key)}
                        className={`pill px-3 py-1 text-xs transition-colors cursor-pointer ${
                          scope === o.key
                            ? 'bg-ink text-white dark:bg-accent dark:text-ink'
                            : 'text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted dark:text-[#c3beb0]">
                    <Trans>Affiliation (this structure's staff is not matched to the corpus).</Trans>
                  </p>
                )}
                <p className="text-xs text-muted-light dark:text-[#8f897c]">
                  <Trans>Affiliation: all publications signed by the structure. Staff: only those with at least one member recognised in the staff list.</Trans>
                </p>
              </div>
              <p className="text-sm text-muted dark:text-[#c3beb0]">
                <Trans>{publicationCount.toLocaleString(numberLocale())} publications in the period</Trans>
                {range.start === range.end ? ` ${range.start}` : ` ${range.start} – ${range.end}`}.
              </p>
            </>
          )}

          {step === 1 && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted dark:text-[#c3beb0]">
                  <Plural value={selectedCount} one="# chart" other="# charts" /> <Trans>in</Trans>{' '}
                  <Plural value={selectedSections.length} one="# section" other="# sections" />
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" className={secondaryBtn} onClick={() => setAll(true)}>
                    <Trans>Select all</Trans>
                  </button>
                  <button type="button" className={secondaryBtn} onClick={() => setAll(false)}>
                    <Trans>Deselect all</Trans>
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                {availableSections.map((s) => {
                  const sel = selection[s.tab] ?? new Set<string>();
                  const SectionIcon =
                    sel.size === 0 ? Square : sel.size === s.ids.length ? CheckSquare : MinusSquare;
                  const isOpen = expanded.has(s.tab);
                  return (
                    <div
                      key={s.tab}
                      className="rounded-xl border border-ink/10 dark:border-white/10 bg-white/50 dark:bg-white/5"
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleSection(s)}
                          className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-[#f5f2ea] cursor-pointer"
                          title={sel.size ? t`Remove the section` : t`Include the whole section`}
                        >
                          <SectionIcon className="w-4 h-4" />
                          {t(s.title)}
                        </button>
                        <span className="text-xs text-muted-light dark:text-[#8f897c]">
                          {sel.size}/{s.ids.length}
                        </span>
                        <button
                          type="button"
                          className={`${iconBtn} !p-1 ml-auto`}
                          onClick={() =>
                            setExpanded((e) => {
                              const next = new Set(e);
                              if (next.has(s.tab)) next.delete(s.tab);
                              else next.add(s.tab);
                              return next;
                            })
                          }
                          title={isOpen ? t`Collapse` : t`Choose the charts`}
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </div>
                      {isOpen && (
                        <div className="px-3 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                          {s.ids.map((id) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => toggleChart(s.tab, id)}
                              className="flex items-center gap-2 py-1 text-[13px] text-left text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea] cursor-pointer"
                            >
                              {sel.has(id) ? (
                                <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <Square className="w-3.5 h-3.5 shrink-0" />
                              )}
                              {chartLabel(id)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {rendering && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-full self-start bg-white/80 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <Trans>Rendering charts — {t(selectedSections[renderIdx!].title)} ({renderIdx! + 1}/{selectedSections.length}),</Trans>{' '}
                  <Plural value={capturedCount} one="# captured" other="# captured" />…
                </div>
              )}
              {!rendering && missing.length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-status-external/10 text-[13px] text-muted dark:text-[#c3beb0]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-status-external" />
                  <span>
                    <Trans>Charts not captured (absent from the report): {missing.map(chartLabel).join(', ')}.</Trans>
                  </span>
                </div>
              )}
              {selectedSections
                .filter((s) => (captures[s.tab] ?? []).length > 0)
                .map((s) => (
                  <div key={s.tab} className="flex flex-col gap-2">
                    <span className={label}>{t(s.title)}</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {(captures[s.tab] ?? []).map((c) => {
                        const off = excluded.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setExcluded((e) => {
                                const next = new Set(e);
                                if (next.has(c.id)) next.delete(c.id);
                                else next.add(c.id);
                                return next;
                              })
                            }
                            title={off ? t`Put back in the report` : t`Leave out of the report`}
                            className={`flex flex-col gap-1.5 p-2 rounded-xl border text-left transition-opacity cursor-pointer ${
                              off
                                ? 'opacity-40 border-ink/10 dark:border-white/10'
                                : 'border-ink/15 dark:border-white/20 bg-white dark:bg-white/5'
                            }`}
                          >
                            <img
                              src={c.png}
                              alt={c.title}
                              className="w-full h-24 object-contain bg-white rounded-lg"
                            />
                            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink dark:text-[#f5f2ea]">
                              {off ? (
                                <Square className="w-3 h-3 shrink-0" />
                              ) : (
                                <CheckSquare className="w-3 h-3 shrink-0" />
                              )}
                              <span className="truncate">{c.title}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>

        {/* Footer: navigation between steps */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-ink/10 dark:border-white/10">
          <span className="text-xs text-muted-light dark:text-[#8f897c]">
            {step === 2
              ? rendering
                ? t`Preparing the preview…`
                : <Plural value={finalCount} one="# chart kept" other="# charts kept" />
              : t`${publicationCount.toLocaleString(numberLocale())} publications · scope ${scope === 'effectifs' ? t`Headcount` : t`Affiliation`}`}
          </span>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                className={secondaryBtn}
                disabled={rendering || saving}
                onClick={() => {
                  if (step === 2) setRenderIdx(null);
                  setStep(step - 1);
                }}
              >
                <Trans>Previous</Trans>
              </button>
            )}
            {step === 0 && (
              <button type="button" className={primaryBtn} onClick={() => setStep(1)}>
                <Trans>Next</Trans>
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                className={primaryBtn}
                disabled={selectedCount === 0}
                onClick={startPreview}
              >
                <Trans>Preview</Trans>
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                className={primaryBtn}
                disabled={rendering || saving || finalCount === 0}
                onClick={download}
              >
                {saving ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {saving ? t`Composing…` : t`Download the PDF`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Off-screen rendering of the current section (one at a time). */}
      {rendering && (
        <ReportRenderer
          key={`${slug}-${scope}-${range.start}-${range.end}-${selectedSections[renderIdx!].tab}`}
          dataset={scopedDataset}
          range={range}
          chartIds={selectedSections[renderIdx!].ids}
          onDone={(caps, miss) => onSectionDone(selectedSections[renderIdx!], caps, miss)}
        />
      )}
    </div>
  );
};
