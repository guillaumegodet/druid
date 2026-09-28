import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, RefreshCw, Search } from 'lucide-react';
import { DashboardDataset, DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { AXE_OTHER, aggregateAxes } from './phase4Aggregates';
import { PubFilters } from './publicationFilters';
import { TeamDonutChart, StackedAreaChart, StackedBarHChart, RankBarChart } from './charts/TeamCharts';
import { useVizTheme } from './EChartCard';
import type { VizTheme } from './palette';
import { numberLocale } from '../../lib/i18n';
import { doiUrl } from '../../lib/doi';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import {
  AXES_GRIST,
  EMPTY_AXIS_INDEX,
  effectiveAxe,
  fetchAxisCorrections,
  findAxisCorrection,
  type AxisCorrection,
  type AxisCorrectionIndex,
} from './axesCorrections';

const PAGE_SIZE = 25;

/**
 * Stable color per axis (config order), gray for « Autre / Non classé » and for an axis that
 * no longer matches the config (stale Grist correction, renamed axis) — without this fallback,
 * indexOf returned -1 and t.series[-1] (undefined) rendered the segment without color (review lot 9c).
 * Shared with the chart registry.
 */
export const axisColorOf = (t: VizTheme, axes: string[]) => (axe: string): string => {
  if (axe === AXE_OTHER) return '#8c8677';
  const idx = axes.indexOf(axe);
  return idx >= 0 ? t.series[idx % t.series.length] : '#8c8677';
};

interface CorrectionsState extends AxisCorrectionIndex {
  loaded: boolean;
  error: string | null;
}

/** Grist corrections of the axes (axesCorrections.ts), loaded when the structure has a correction table. */
function useAxesCorrections(slug: string, enabled: boolean) {
  const cfg = AXES_GRIST[slug];
  const [state, setState] = useState<CorrectionsState>({
    ...EMPTY_AXIS_INDEX,
    loaded: false,
    error: null,
  });

  useEffect(() => {
    if (!cfg || !enabled) {
      setState({ ...EMPTY_AXIS_INDEX, loaded: !cfg, error: null });
      return;
    }
    let cancelled = false;
    fetchAxisCorrections(slug)
      .then((index) => {
        if (!cancelled) setState({ ...(index ?? EMPTY_AXIS_INDEX), loaded: true, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setState({ ...EMPTY_AXIS_INDEX, loaded: true, error: apiErrorText(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, enabled, cfg]);

  const findCorrection = (p: DashboardPublication): AxisCorrection | undefined =>
    findAxisCorrection(state, p);

  const applyLocal = (gristId: number, axe: string) => {
    setState((s) => {
      const upd = (m: Map<string, AxisCorrection>) => {
        const next = new Map(m);
        for (const [k, v] of next) if (v.gristId === gristId) next.set(k, { gristId, axe });
        return next;
      };
      return { ...s, byDoi: upd(s.byDoi), byTitle: upd(s.byTitle) };
    });
  };

  const save = async (gristId: number, axe: string): Promise<string | null> => {
    if (!cfg) return 'not configured';
    const res = await fetch(`/api/grist/docs/${cfg.docId}/tables/${cfg.table}/records`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ id: gristId, fields: { [cfg.field]: axe } }] }),
    });
    if (!res.ok) return `Grist error (${res.status})`;
    applyLocal(gristId, axe);
    return null;
  };

  return { ...state, configured: !!cfg, findCorrection, save };
}

/** Curation table: search, effective axis, per-row Grist correction. */
const CurationTable: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  axes: string[];
  corrections: ReturnType<typeof useAxesCorrections>;
  axeOf: (p: DashboardPublication) => string;
}> = ({ dataset, range, axes, corrections, axeOf }) => {
  const { t } = useLingui();
  const [query, setQuery] = useState('');
  const [axeFilter, setAxeFilter] = useState('__all__');
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState<number | null>(null);
  const [savedFlash, setSavedFlash] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dataset.publications
      .filter((p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end)
      .filter((p) => axeFilter === '__all__' || axeOf(p) === axeFilter)
      .filter(
        (p) =>
          !q ||
          (p.title ?? '').toLowerCase().includes(q) ||
          (p.doi ?? '').toLowerCase().includes(q) ||
          (p.journal ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  }, [dataset.publications, range, query, axeFilter, axeOf]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const matched = useMemo(
    () => rows.filter((p) => corrections.findCorrection(p)).length,
    [rows, corrections],
  );

  const changeAxe = async (p: DashboardPublication, axe: string) => {
    const c = corrections.findCorrection(p);
    if (!c) return;
    setSaving(c.gristId);
    setError(null);
    const err = await corrections.save(c.gristId, axe);
    setSaving(null);
    if (err) setError(err);
    else {
      setSavedFlash(c.gristId);
      window.setTimeout(() => setSavedFlash(null), 1500);
    }
  };

  return (
    <div className="glass-card flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
            <Pencil className="w-4 h-4" /> <Trans>Classification curation</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Trans>
              {rows.length.toLocaleString(numberLocale())} publications · {matched.toLocaleString(numberLocale())} editable (present in the Grist table) — corrections apply immediately to the charts
            </Trans>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input-soft !w-auto py-1.5 pr-7 text-sm cursor-pointer"
            value={axeFilter}
            onChange={(e) => {
              setAxeFilter(e.target.value);
              setPage(0);
            }}
            title={t`Filter by axis`}
          >
            <option value="__all__">{t`All axes`}</option>
            {[...axes, AXE_OTHER].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
            <input
              className="input-soft !w-56 !pl-8 py-1.5 text-sm"
              placeholder={t`Title, DOI or journal…`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="px-5 pb-2 text-xs font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>
      )}

      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
              <th className="px-3 py-2 w-14"><Trans>Year</Trans></th>
              <th className="px-3 py-2"><Trans>Title</Trans></th>
              <th className="px-3 py-2 w-72"><Trans>Selected axis</Trans></th>
              <th className="px-3 py-2 w-72"><Trans>Rationale</Trans></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p, i) => {
              const c = corrections.findCorrection(p);
              const effective = axeOf(p);
              return (
                <tr key={`${p.doi ?? p.title}-${i}`} className="border-t border-ink/5 dark:border-white/5 align-top">
                  <td className="px-3 py-2 font-semibold text-ink dark:text-[#f5f2ea]">{p.year}</td>
                  <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">
                    {p.doi ? (
                      <a href={doiUrl(p.doi) ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">
                        {p.title ?? p.doi}
                      </a>
                    ) : (
                      p.title ?? '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {c ? (
                      <span className="inline-flex items-center gap-1.5">
                        <select
                          className="input-soft !w-60 py-1 text-xs cursor-pointer"
                          value={effective}
                          disabled={saving === c.gristId}
                          onChange={(e) => changeAxe(p, e.target.value)}
                        >
                          {/* Stale axis (config renamed/removed since the Grist correction): without
                              this option, no <option> matches `effective` and the browser
                              wrongly shows the first axis of the list as selected
                              (review lot 9c). */}
                          {effective && !axes.includes(effective) && effective !== AXE_OTHER && (
                            <option value={effective}>{t`${effective} (not in list)`}</option>
                          )}
                          {[...axes, AXE_OTHER].map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                        {saving === c.gristId && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-lighter" />}
                        {savedFlash === c.gristId && <Check className="w-3.5 h-3.5 text-pixel-teal" />}
                      </span>
                    ) : (
                      <span
                        className="text-xs text-muted-light dark:text-[#8f897c]"
                        title={t`Publication absent from the Grist curation table`}
                      >
                        {effective}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-light dark:text-[#8f897c]">
                    {p.axeMotivation ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-ink/5 dark:border-white/5 text-sm text-muted dark:text-[#c3beb0]">
          <button type="button" className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            ← <Trans>Previous</Trans>
          </button>
          <span>
            <Trans>Page {currentPage + 1} / {pageCount}</Trans>
          </span>
          <button type="button" className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>
            <Trans>Next</Trans> →
          </button>
        </div>
      )}
    </div>
  );
};

/** « Axes stratégiques » tab — port of the Streamlit _tab_axes + Grist curation. */
export const AxesTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const axes = useMemo(() => dataset.strategicAxes.map((a) => a.name), [dataset.strategicAxes]);
  const hasAxes = axes.length > 0 && dataset.publications.some((p) => p.chosenAxe);
  const corrections = useAxesCorrections(dataset.slug, hasAxes);

  // Effective axis: Grist correction otherwise ETL classification (1st axis if multiple, like axeOfPub).
  const axeOf = useMemo(() => {
    const index = { byDoi: corrections.byDoi, byTitle: corrections.byTitle };
    return (p: DashboardPublication): string => effectiveAxe(index, p);
  }, [corrections.byDoi, corrections.byTitle]);

  const agg = useMemo(
    () => aggregateAxes(dataset.publications, range, axes, axeOf),
    [dataset.publications, range, axes, axeOf],
  );

  if (!hasAxes) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>
          No strategic axis defined for this structure: fill in<code className="font-mono text-xs mx-1">strategic_axes</code>(names + keywords) in its druid-biblio configuration then rerun the ETL.
        </Trans>
      </div>
    );
  }

  const colorOf = axisColorOf(t, axes);
  const seriesColors = agg.axeNames.map(colorOf);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
        <Trans>
          Axis assigned from OpenAlex topics and the keywords defined in the configuration (≥ 2 matches with a clear lead). Corrections entered below are saved in the Grist curation table and take precedence over the classification.
        </Trans>
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <TeamDonutChart
            title={tr`Breakdown by strategic axis`}
            exportName="axes-repartition"
            data={agg.byAxe.map((a) => ({ name: a.key, value: a.count, color: colorOf(a.key) }))}
            onSelect={onOpenList ? (axe) => onOpenList({ axe }) : undefined}
          />
        </div>
        <div className="lg:col-span-3">
          <RankBarChart
            title={tr`Publications by axis`}
            exportName="axes-barres"
            data={agg.byAxe.map((a) => ({ label: a.key, count: a.count, teams: [] }))}
            colorSlot={0}
            height={Math.max(260, agg.byAxe.length * 34 + 80)}
            onItemClick={onOpenList ? (axe) => onOpenList({ axe }) : undefined}
          />
        </div>
      </div>

      <StackedAreaChart
        title={tr`Yearly evolution by strategic axis`}
        exportName="axes-evolution"
        data={agg.byYear}
        colors={seriesColors}
        onSelect={onOpenList ? (axe, year) => onOpenList({ axe, year }) : undefined}
      />
      <StackedBarHChart
        title={tr`Publication types by strategic axis`}
        exportName="axes-types"
        data={agg.byType}
        colors={seriesColors}
        height={Math.max(320, agg.byType.categories.length * 30 + 90)}
        onSelect={onOpenList ? (axe, type) => onOpenList(type ? { axe, pubType: type } : { axe }) : undefined}
      />

      {/* ── Keywords per axis ── */}
      <div className="glass-card p-5 flex flex-col gap-2">
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
          <Trans>Keywords by strategic axis</Trans>
        </h3>
        {dataset.strategicAxes.map((axe) => (
          <details key={axe.name} className="text-sm">
            <summary className="cursor-pointer font-semibold text-ink dark:text-[#f5f2ea] py-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                style={{ backgroundColor: colorOf(axe.name) }}
              />
              {axe.name}
              {axe.keywords.length === 0 && (
                <span className="text-muted-light dark:text-[#8f897c] font-normal"> <Trans>(no keyword defined)</Trans></span>
              )}
            </summary>
            {axe.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 py-2 pl-5">
                {axe.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="px-2 py-0.5 rounded text-xs text-ink dark:text-[#f5f2ea]"
                    style={{
                      backgroundColor: `${colorOf(axe.name)}22`,
                      borderLeft: `3px solid ${colorOf(axe.name)}`,
                    }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </details>
        ))}
      </div>

      {/* ── Grist curation ── */}
      {corrections.configured ? (
        corrections.error ? (
          <div className="glass-card p-5 text-sm text-muted dark:text-[#c3beb0]">
            <Trans>Grist curation unavailable ({corrections.error}) — the classifications shown are those of the ETL.</Trans>
          </div>
        ) : !corrections.loaded ? (
          <div className="glass-card p-5 flex items-center gap-2 text-sm text-muted-light dark:text-[#8f897c]">
            <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading the Grist curation table…</Trans>
          </div>
        ) : (
          <CurationTable
            dataset={dataset}
            range={range}
            axes={axes}
            corrections={corrections}
            axeOf={axeOf}
          />
        )
      ) : (
        <p className="text-[11px] text-muted-lighter dark:text-[#8f897c] px-1">
          <Trans>Grist curation not configured for this structure (see AXES_GRIST in AxesTab).</Trans>
        </p>
      )}
    </div>
  );
};
