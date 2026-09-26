import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, AlertCircle, Link2, Check, FileText, Settings } from 'lucide-react';
import { copyToClipboard } from '../lib/clipboard';
import { useDashboardData } from './dashboard/useDashboardData';
import { getYearBounds, YearRange } from './dashboard/overviewAggregates';
import { YearRangeSelector } from './dashboard/YearRangeSelector';
import { OverviewTab } from './dashboard/OverviewTab';
import { CollaborationsTab } from './dashboard/CollaborationsTab';
import { ImpactTab } from './dashboard/ImpactTab';
import { BooksTab } from './dashboard/BooksTab';
import { TeamsTab } from './dashboard/TeamsTab';
import { PhdTab } from './dashboard/PhdTab';
import { ResearchersTab } from './dashboard/ResearchersTab';
import { NetworkTab } from './dashboard/NetworkTab';
import { JournalsTab } from './dashboard/JournalsTab';
import { ApcTab } from './dashboard/ApcTab';
import { FundersTab } from './dashboard/FundersTab';
import { AxesTab } from './dashboard/AxesTab';
import { BenchmarkTab } from './dashboard/BenchmarkTab';
import { CharteTab } from './dashboard/CharteTab';
import { PublicationsListTab } from './dashboard/PublicationsListTab';
import { NewsTab } from './dashboard/NewsTab';
import { SourcesTab } from './dashboard/SourcesTab';
import { PubFilters } from './dashboard/publicationFilters';
import { ShareScopeContext } from './dashboard/EChartCard';
import { ReportWizard } from './dashboard/report/ReportWizard';
import { getRoles } from '../lib/auth';
import { Researcher, ViewState } from '../types';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { numberLocale } from '../lib/i18n';
import { fetchDashboardStructures } from '../lib/dashboardSource';
import { HelpButton } from './HelpButton';
import { DASHBOARD_TAB_HELP } from '../lib/helpLinks';

interface DashboardPageProps {
  /** druid-biblio slug to preselect (e.g. from a Structure record); null = default. */
  struct?: string | null;
  /** Druid researchers (Effectifs): « Membres par équipe » links → researcher record. */
  researchers?: Researcher[];
  onOpenResearcher?: (r: Researcher) => void;
  /** Admins: opens the ETL console (Administration section) on the current structure. */
  onOpenAdmin?: (slug: string) => void;
}

const DEFAULT_STRUCT = 'univ-nantes';

type Tab =
  | 'overview'
  | 'collaborations'
  | 'impact'
  | 'books'
  | 'teams'
  | 'phd'
  | 'researchers'
  | 'network'
  | 'journals'
  | 'apc'
  | 'funders'
  | 'themes'
  | 'benchmark'
  | 'charte'
  | 'list'
  | 'news'
  | 'sources';

/** Dashboard tab keys (help links: lib/helpLinks.ts DASHBOARD_TAB_HELP). */
export type DashboardTab = Tab;

const NATIVE_TABS: { key: Tab; label: MessageDescriptor }[] = [
  { key: 'overview', label: msg`Overview` },
  { key: 'collaborations', label: msg`Collaborations` },
  { key: 'impact', label: msg`Impact and citations` },
  { key: 'books', label: msg`Books` },
  { key: 'journals', label: msg`Journals` },
  { key: 'apc', label: msg`APC monitoring` },
  { key: 'funders', label: msg`Funding` },
  { key: 'themes', label: msg`Strategic axes` },
  { key: 'benchmark', label: msg`Benchmark` },
  { key: 'charte', label: msg`Signature charter` },
  { key: 'teams', label: msg`Teams` },
  { key: 'phd', label: msg`PhD students` },
  { key: 'researchers', label: msg`Researchers` },
  { key: 'network', label: msg`Network` },
  { key: 'list', label: msg`Publication list` },
  { key: 'news', label: msg`Watch` },
  { key: 'sources', label: msg`Sources` },
];

/**
 * @component DashboardPage
 * @description Bibliometric « Tableau de bord » section, rendered natively
 * in React/ECharts from /api/dashboard/:slug/publications (client-side
 * aggregations, components ported from the SoVisu+ mockups). Purely
 * read-only since 2026-09-10: the ETL console and rights management
 * live in the Administration section (components/admin/AdminPage.tsx);
 * admins reach it through the header's « Configurer » button (current
 * structure preselected). The old ?tab=console|streamlit|rights links
 * are redirected by App.tsx.
 */
export const DashboardPage: React.FC<DashboardPageProps> = ({
  struct,
  researchers,
  onOpenResearcher,
  onOpenAdmin,
}) => {
  const { t } = useLingui();
  const [slugs, setSlugs] = useState<string[]>([]);
  const [groupSlugs, setGroupSlugs] = useState<string[]>([]);
  // Tabs hidden per structure (druid_tabs_hidden in config.yaml, read live
  // by the server) — editable from the admin without regenerating the data.
  const [tabsHiddenBySlug, setTabsHiddenBySlug] = useState<Record<string, string[]>>({});
  const [slug, setSlug] = useState<string | null>(struct ?? null);
  const [tab, setTab] = useState<Tab>('overview');
  const [linkCopied, setLinkCopied] = useState(false);

  // ── Shareable link: the full state (structure/group, tab, period,
  // scope) is reflected in the URL, like the Streamlit did
  // (?struct&tab&from&to&perimetre). Period and scope read from the URL are
  // applied once the data is loaded (« pending » refs).
  const pendingRange = useRef<YearRange | null>(null);
  const pendingScope = useRef<'effectifs' | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get('struct');
    if (s && /^[a-z0-9_-]+$/.test(s)) setSlug(s);
    const t = p.get('tab');
    // The former console/streamlit/rights tabs live in the Administration
    // section: App.tsx redirects those links before reaching this point.
    if (t && NATIVE_TABS.some((n) => n.key === t)) setTab(t as Tab);
    const from = Number(p.get('from'));
    const to = Number(p.get('to'));
    if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to >= from) {
      pendingRange.current = { start: from, end: to };
    }
    if (p.get('perimetre') === 'effectifs') pendingScope.current = 'effectifs';
  }, []);
  // Publication list filters — controllable from the other tabs.
  const [listFilters, setListFilters] = useState<PubFilters>({});

  // Cross-tab link: opens « Liste des publications » pre-filtered.
  const openList = (filters: PubFilters) => {
    setListFilters(filters);
    setTab('list');
  };

  // Structure change = different corpus, the filters no longer make sense.
  useEffect(() => {
    setListFilters({});
  }, [slug]);

  // Reloadable: the ETL console creates structures and changes the hidden tabs.
  const loadStructures = useCallback(() =>
    fetchDashboardStructures()
      .then(({ slugs: list, groups, tabsHidden }) => {
        setSlugs(list);
        setGroupSlugs(groups);
        setTabsHiddenBySlug(tabsHidden);
        setSlug((cur) => cur ?? (list.includes(DEFAULT_STRUCT) ? DEFAULT_STRUCT : list[0] ?? null));
      })
      .catch(() => setSlugs([])), []);
  useEffect(() => {
    void loadStructures();
  }, [loadStructures]);

  // New structure requested from a Structure record.
  useEffect(() => {
    if (struct) setSlug(struct);
  }, [struct]);

  const { data, loading, error } = useDashboardData(slug);

  // ── Corpus scope (like the Streamlit sidebar) ─────────────────────────────
  // « Affiliation » = all publications harvested for the structure;
  // « Effectifs » = only those with at least one author recognized among the
  // staff (members.authorId). Default per structure: filter_to_effectifs.
  const [scope, setScope] = useState<'affiliation' | 'effectifs'>('affiliation');
  const memberAuthorIds = useMemo(
    () =>
      new Set(
        (data?.members ?? [])
          .map((m) => m.authorId)
          .filter((id): id is number => id != null),
      ),
    [data],
  );
  const canScopeHeadcount = memberAuthorIds.size > 0;
  useEffect(() => {
    if (pendingScope.current && memberAuthorIds.size > 0) {
      setScope(pendingScope.current);
    } else {
      setScope(data?.filterToEffectifs && memberAuthorIds.size > 0 ? 'effectifs' : 'affiliation');
    }
    pendingScope.current = null;
    // Reset only on corpus change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.slug]);

  const scopedData = useMemo(() => {
    if (!data || scope !== 'effectifs' || !canScopeHeadcount) return data;
    return {
      ...data,
      publications: data.publications.filter((p) =>
        p.authorIds.some((id) => memberAuthorIds.has(id)),
      ),
    };
  }, [data, scope, canScopeHeadcount, memberAuthorIds]);
  const excluded =
    data && scopedData && scope === 'effectifs'
      ? data.publications.length - scopedData.publications.length
      : 0;

  // Strategic axes: tab hidden when the structure has no configured axes
  // (strategic_axes in config.yaml, missing for groups in particular).
  // Plus the tabs hidden by the admin (druid_tabs_hidden) —
  // « Vue d'ensemble » always stays visible.
  const hasAxes = (data?.strategicAxes?.length ?? 0) > 0;
  const hasBenchmark = data?.benchmark != null;
  const visibleTabs = useMemo(() => {
    const hidden = new Set(slug ? tabsHiddenBySlug[slug] ?? [] : []);
    return NATIVE_TABS.filter(({ key }) =>
      key === 'overview' ||
      (!hidden.has(key) && (key !== 'themes' || hasAxes) && (key !== 'benchmark' || hasBenchmark)));
  }, [slug, tabsHiddenBySlug, hasAxes, hasBenchmark]);
  useEffect(() => {
    if (data && !visibleTabs.some((t) => t.key === tab)) setTab('overview');
  }, [tab, data, visibleTabs]);

  const bounds = useMemo(
    () => getYearBounds(scopedData?.publications ?? []),
    [scopedData],
  );
  const [range, setRange] = useState<YearRange>({ start: bounds.min, end: bounds.max });
  useEffect(() => {
    if (pendingRange.current) {
      // Period requested by the URL, clamped to the corpus actually loaded.
      const r = pendingRange.current;
      pendingRange.current = null;
      setRange({
        start: Math.min(Math.max(bounds.min, r.start), bounds.max),
        end: Math.max(Math.min(bounds.max, r.end), bounds.min),
      });
    } else {
      setRange({ start: bounds.min, end: bounds.max });
    }
  }, [bounds.min, bounds.max]);

  // Writes the state to the URL (shareable deep link), without touching the
  // other parameters managed by the application (?page in particular).
  useEffect(() => {
    if (!data || !slug) return;
    const p = new URLSearchParams(window.location.search);
    p.set('page', ViewState.DASHBOARD);
    p.delete('id');
    p.set('struct', slug);
    p.set('tab', tab);
    p.set('from', String(range.start));
    p.set('to', String(range.end));
    if (scope === 'effectifs') p.set('perimetre', 'effectifs');
    else p.delete('perimetre');
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
  }, [data, slug, tab, range, scope]);

  const copyLink = () => {
    copyToClipboard(window.location.href).then((ok) => {
      if (!ok) return;
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1600);
    });
  };

  // ── PDF report (3-step wizard: criteria / content / preview) ──────────────
  // Prefilled with the current period and scope; works on the unfiltered
  // `data` to leave the scope choice to the wizard.
  const [reportOpen, setReportOpen] = useState(false);

  const tabBtn = (active: boolean) =>
    `pill px-4 py-1.5 text-[13px] transition-colors cursor-pointer ${
      active
        ? 'bg-ink text-white dark:bg-accent dark:text-ink shadow-nav-active'
        : 'bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15'
    }`;

  const isAdmin = getRoles().includes('admin');

  return (
    <div className="h-full flex flex-col gap-4 p-6 overflow-y-auto">
      {/* Header: title + structure + year range */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="font-disp font-bold text-xl text-ink dark:text-[#f5f2ea] leading-tight">
              {data ? t`Dashboard — ${data.lab}` : t`Dashboard`}
            </h2>
            <HelpButton path={DASHBOARD_TAB_HELP[tab]} />
          </div>
          {data && (
            <p className="text-sm text-muted-light dark:text-[#8f897c] truncate">{data.name}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {slugs.length > 1 && (
            <select
              className="input-soft !w-auto py-1.5 pr-7 text-sm font-semibold cursor-pointer"
              value={slug ?? ''}
              onChange={(e) => setSlug(e.target.value)}
              title={t`Structure or group`}
            >
              <optgroup label={t`Structures`}>
                {slugs.filter((s) => !groupSlugs.includes(s)).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </optgroup>
              {groupSlugs.length > 0 && (
                <optgroup label={t`Groups`}>
                  {groupSlugs.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/^groupe-/, '')}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          {isAdmin && onOpenAdmin && slug && !groupSlugs.includes(slug) && (
            <button type="button" className="btn-pill !h-9 px-3 text-xs" onClick={() => onOpenAdmin(slug)} title={t`Open the ETL console on this structure`}>
              <Settings className="w-3.5 h-3.5" /> <Trans>Configure</Trans>
            </button>
          )}
          {/* Period and scope do not apply to the media monitoring tab (live
              OpenAlex data, tab-specific period). */}
          {tab !== 'news' && data && canScopeHeadcount && (
            <div
              className="flex items-center gap-0.5 p-0.5 rounded-full bg-white/60 dark:bg-white/10 border border-white/70 dark:border-white/15"
              title={
                scope === 'effectifs' && excluded > 0
                  ? t`Affiliation: all publications signed by the structure. Staff: only those with at least one member recognised in the staff list (${excluded.toLocaleString(numberLocale())} publications excluded for lack of a match).`
                  : t`Affiliation: all publications signed by the structure. Staff: only those with at least one member recognised in the staff list.`
              }
            >
              {(
                [
                  { key: 'affiliation', label: t`Affiliation` },
                  { key: 'effectifs', label: t`Headcount` },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScope(key)}
                  className={`pill px-3 py-1 text-xs transition-colors cursor-pointer ${
                    scope === key
                      ? 'bg-ink text-white dark:bg-accent dark:text-ink'
                      : 'text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {tab !== 'news' && data && (
            <YearRangeSelector bounds={bounds} range={range} onChange={setRange} />
          )}
          {data && (
            <button
              type="button"
              onClick={copyLink}
              title={t`Copy the link to this view (structure, tab, period, scope)`}
              className="btn-pill px-3 py-1.5 text-[13px]"
            >
              {linkCopied ? <Check className="w-4 h-4 text-pixel-teal" /> : <Link2 className="w-4 h-4" />}
              {linkCopied ? t`Copied!` : t`Copy link`}
            </button>
          )}
          {data && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              title={t`Compose a PDF report (choice of period, scope and charts)`}
              className="btn-pill px-3 py-1.5 text-[13px]"
            >
              <FileText className="w-4 h-4" />
              <Trans>PDF report</Trans>
            </button>
          )}
        </div>
      </div>

      {/* Tab row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleTabs.map(({ key, label }) => (
          <button key={key} type="button" className={tabBtn(tab === key)} onClick={() => setTab(key)}>
            {t(label)}
          </button>
        ))}
      </div>

      <>
          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-white/80 dark:border-white/15 shadow-soft text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <Trans>Loading data…</Trans>
              </div>
            </div>
          )}
          {!loading && error && (
            <div className="glass-card p-6 flex items-start gap-3 text-sm text-muted dark:text-[#c3beb0]">
              <AlertCircle className="w-5 h-5 shrink-0 text-status-external" />
              <div>
                {error === 'no-data' ? (
                  <Trans>
                    This structure's data has not been exported yet (<code className="font-mono text-xs">dashboard.json</code> missing) — rerun the ETL from the administration page.
                  </Trans>
                ) : (
                  <Trans>Error loading data: {error}</Trans>
                )}
              </div>
            </div>
          )}
          {!loading && scopedData && slug && (
            <ShareScopeContext.Provider value={{ slug, range, perimetre: scope }}>
              {tab === 'overview' && (
                <OverviewTab
                  publications={scopedData.publications}
                  range={range}
                  etpr={scopedData.etpr}
                  onOpenList={openList}
                />
              )}
              {tab === 'collaborations' && (
                <CollaborationsTab dataset={scopedData} range={range} onOpenList={openList} />
              )}
              {tab === 'impact' && <ImpactTab dataset={scopedData} range={range} onOpenList={openList} />}
              {tab === 'books' && (
                <BooksTab publications={scopedData.publications} range={range} onOpenList={openList} />
              )}
              {tab === 'teams' && (
                <TeamsTab
                  dataset={scopedData}
                  range={range}
                  researchers={researchers}
                  onOpenResearcher={onOpenResearcher}
                  onOpenList={openList}
                />
              )}
              {tab === 'phd' && <PhdTab dataset={scopedData} range={range} onOpenList={openList} />}
              {tab === 'researchers' && (
                <ResearchersTab dataset={scopedData} range={range} onOpenList={openList} />
              )}
              {tab === 'network' && <NetworkTab dataset={scopedData} range={range} slug={slug} />}
              {tab === 'journals' && (
                <JournalsTab publications={scopedData.publications} range={range} slug={slug} onOpenList={openList} />
              )}
              {tab === 'apc' && <ApcTab dataset={scopedData} range={range} />}
              {tab === 'funders' && <FundersTab dataset={scopedData} range={range} />}
              {tab === 'themes' && <AxesTab dataset={scopedData} range={range} onOpenList={openList} />}
              {tab === 'benchmark' && <BenchmarkTab dataset={scopedData} range={range} />}
              {tab === 'charte' && <CharteTab dataset={scopedData} range={range} onOpenList={openList} />}
              {tab === 'news' && <NewsTab dataset={scopedData} slug={slug} />}
              {tab === 'sources' && (
                <SourcesTab
                  publications={scopedData.publications}
                  range={range}
                  onOpenList={openList}
                />
              )}
              {tab === 'list' && (
                <PublicationsListTab
                  dataset={scopedData}
                  range={range}
                  filters={listFilters}
                  onFiltersChange={setListFilters}
                />
              )}
            </ShareScopeContext.Provider>
          )}
      </>

      {reportOpen && data && slug && (
        <ReportWizard
          dataset={data}
          slug={slug}
          memberAuthorIds={memberAuthorIds}
          canScopeHeadcount={canScopeHeadcount}
          visibleTabKeys={visibleTabs.map((t) => t.key)}
          initialRange={range}
          initialScope={scope}
          onClose={() => setReportOpen(false)}
        />
      )}

    </div>
  );
};
