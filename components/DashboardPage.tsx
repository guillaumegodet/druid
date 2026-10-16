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
import { StaffTab } from './dashboard/StaffTab';
import { NetworkTab } from './dashboard/NetworkTab';
import { JournalsTab } from './dashboard/JournalsTab';
import { ApcTab } from './dashboard/ApcTab';
import { FundersTab } from './dashboard/FundersTab';
import { CallsTab } from './dashboard/CallsTab';
import { AxesTab } from './dashboard/AxesTab';
import { BenchmarkTab } from './dashboard/BenchmarkTab';
import { CharteTab } from './dashboard/CharteTab';
import { PublicationsListTab } from './dashboard/PublicationsListTab';
import { PublicationsListModal } from './dashboard/PublicationsListModal';
import { NewsTab } from './dashboard/NewsTab';
import { SourcesTab } from './dashboard/SourcesTab';
import { ExploreGrid } from './dashboard/ExploreGrid';
import { FAMILY_ICONS } from './dashboard/familyIcons';
import {
  DASHBOARD_TABS, DashboardFamily, DashboardTab, familyOf, isDashboardTab, visibleFamilies,
} from './dashboard/dashboardNav';
import { PubFilters } from './dashboard/publicationFilters';
import { AddToReportContext, ShareScopeContext, type AddToReport, type ChartState } from './dashboard/EChartCard';
import { AddToReportDialog } from './reports/AddToReportDialog';
import { sanitizeChartParams } from './dashboard/chartMeta';
import { NewReportDialog } from './reports/NewReportDialog';
import { reportsBackend } from './dashboard/report/reportsApi';
import { hasStaffAttributes } from './dashboard/staffAggregates';
import { getRoles } from '../lib/auth';
import { instanceLabel } from '../lib/instanceRuntime';
import { withDerivedParents } from '../lib/structureHierarchy';
import { Researcher, Structure, ViewState } from '../types';
import { Trans, useLingui } from '@lingui/react/macro';
import { numberLocale } from '../lib/i18n';
import { normalizeAcronym } from '../lib/normalize';
import { fetchDashboardStructures } from '../lib/dashboardSource';
import { researchersOfSlug } from '../lib/staffDirectoryAggregates';
import { HelpButton } from './HelpButton';
import { visibleTabKeys } from './dashboard/tabAvailability';
import { DASHBOARD_TAB_HELP } from '../lib/helpLinks';

export type { DashboardTab } from './dashboard/dashboardNav';

interface DashboardPageProps {
  /** druid-biblio slug to preselect (e.g. from a Structure record); null = default. */
  struct?: string | null;
  /** Druid researchers (Effectifs): « Membres par équipe » links → researcher record, « Directory » view. */
  researchers?: Researcher[];
  /** Druid structures: matches the dashboard slug to a structure for the « Directory » view. */
  structures?: Structure[];
  /** Directory still loading: the « Directory » view waits instead of being hidden (a deep link
   *  ?tab=staff would otherwise fall back to the overview before the records arrive). */
  researchersLoading?: boolean;
  onOpenResearcher?: (r: Researcher) => void;
  /** « Directory » view: opens the People page filtered on the structure (acronym, null = no filter). */
  onOpenPeople?: (labAcronym: string | null) => void;
  /** Admins: opens the ETL console (Administration section) on the current structure. */
  onOpenAdmin?: (slug: string) => void;
  /** « Ajouter à un rapport »: opens the report the chart was added to. */
  onOpenReport?: (id: number) => void;
}

const DEFAULT_STRUCT = 'univ-nantes';

/** Views where the period and scope selectors do not apply (live data). */
const LIVE_TABS: ReadonlySet<DashboardTab> = new Set<DashboardTab>(['news', 'staff']);

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
 *
 * Navigation on two levels since 2026-10-13 (docs/archive/plan-tableau-de-bord-familles.md): seven
 * families of analyses (dashboard/dashboardNav.ts), the active family showing its views as a
 * second row of pills. The URL keeps the leaf key (?tab=journals), so the old links still work.
 */
export const DashboardPage: React.FC<DashboardPageProps> = ({
  struct,
  researchers,
  structures,
  researchersLoading = false,
  onOpenResearcher,
  onOpenPeople,
  onOpenAdmin,
  onOpenReport,
}) => {
  const { t } = useLingui();
  const [slugs, setSlugs] = useState<string[]>([]);
  const [groupSlugs, setGroupSlugs] = useState<string[]>([]);
  // Tabs hidden per structure (druid_tabs_hidden in config.yaml, read live
  // by the server) — editable from the admin without regenerating the data.
  const [tabsHiddenBySlug, setTabsHiddenBySlug] = useState<Record<string, string[]>>({});
  // « Calls for proposals »: shown once calls and their matches are imported (/api/calls/overview; 501 on an
  // instance without PostgreSQL, 404 on an instance without the server).
  const [hasCalls, setHasCalls] = useState(false);
  useEffect(() => {
    fetch('/api/calls/overview', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => setHasCalls(Array.isArray(o?.runs) && o.runs.length > 0))
      .catch(() => setHasCalls(false));
  }, []);
  const [slug, setSlug] = useState<string | null>(struct ?? null);
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [linkCopied, setLinkCopied] = useState(false);
  // Last view opened in each family, so that coming back to a family lands where the user was.
  const lastTabByFamily = useRef<Partial<Record<DashboardFamily, DashboardTab>>>({});
  const goTo = useCallback((next: DashboardTab) => {
    lastTabByFamily.current[familyOf(next)] = next;
    setTab(next);
  }, []);

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
    const requested = p.get('tab');
    // The former console/streamlit/rights tabs live in the Administration
    // section: App.tsx redirects those links before reaching this point.
    if (isDashboardTab(requested)) goTo(requested);
    // The former « European calls » key still opens the tab, renamed « Calls for proposals » (docs/plan-funding-calls.md, lot 1).
    else if (requested === 'eu-calls') goTo('calls');
    const from = Number(p.get('from'));
    const to = Number(p.get('to'));
    if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to >= from) {
      pendingRange.current = { start: from, end: to };
    }
    if (p.get('perimetre') === 'effectifs') pendingScope.current = 'effectifs';
  }, [goTo]);
  // Publication list filters — controllable from the other tabs.
  const [listFilters, setListFilters] = useState<PubFilters>({});

  // Drill-down from a chart: the pre-filtered list opens in a modal over the current tab;
  // the modal can hand its filters over to the « Liste des publications » tab.
  const [drillFilters, setDrillFilters] = useState<PubFilters | null>(null);
  const openList = (filters: PubFilters) => setDrillFilters(filters);
  const closeDrill = useCallback(() => setDrillFilters(null), []);
  const openDrillInTab = useCallback((filters: PubFilters) => {
    setListFilters(filters);
    goTo('list');
    setDrillFilters(null);
  }, [goTo]);

  // Structure change = different corpus, the filters no longer make sense.
  useEffect(() => {
    setListFilters({});
    setDrillFilters(null);
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

  // ── « Directory » view: Druid records of the structure (D3 of the plan). A structure whose
  // acronym matches the slug (and its teams); the institution-wide corpus takes every record;
  // groups and unmatched slugs have no headcount view.
  const staffStructure = useMemo(() => {
    if (!slug) return null;
    const target = normalizeAcronym(slug);
    return (structures ?? []).find((s) => s.acronym && normalizeAcronym(s.acronym) === target) ?? null;
  }, [slug, structures]);
  // Structures enclosing the one shown (lab of a team, pole of a lab…, then the institution of the instance), nearest
  // first: the « Calls » tab tells whether the structure is inside the perimeter of the matching runs.
  const enclosingStructures = useMemo(() => {
    const chain: { slug: string; label: string }[] = [];
    if (staffStructure && structures?.length) {
      const all = withDerivedParents(structures);
      const byAcronym = new Map(all.filter((s) => s.acronym).map((s) => [normalizeAcronym(s.acronym), s]));
      const seen = new Set<string>([normalizeAcronym(staffStructure.acronym)]);
      let parent = all.find((s) => s.id === staffStructure.id)?.parentStructure;
      while (parent && !seen.has(normalizeAcronym(parent))) {
        seen.add(normalizeAcronym(parent));
        const p = byAcronym.get(normalizeAcronym(parent));
        chain.push({ slug: p?.acronym || parent, label: p?.officialName || parent });
        parent = p?.parentStructure;
      }
    }
    const institution = instanceLabel();
    if (institution) chain.push({ slug: '', label: institution });
    return chain;
  }, [staffStructure, structures]);
  const staffResearchers = useMemo(() => {
    if (!slug || !researchers?.length) return null;
    const matched = researchersOfSlug(slug, structures ?? [], researchers);
    if (matched) return matched;
    return slug === DEFAULT_STRUCT && !groupSlugs.includes(slug) ? researchers : null;
  }, [slug, structures, researchers, groupSlugs]);

  // Strategic axes: tab hidden when the structure has no configured axes
  // (strategic_axes in config.yaml, missing for groups in particular).
  // Plus the tabs hidden by the admin (druid_tabs_hidden) —
  // « Vue d'ensemble » always stays visible.
  const hasAxes = (data?.strategicAxes?.length ?? 0) > 0;
  const hasBenchmark = data?.benchmark != null;
  // While the directory loads, keep the view in the catalog (hidden later if nothing matches).
  const hasStaff = (staffResearchers?.length ?? 0) > 0 || (researchersLoading && !(slug && groupSlugs.includes(slug)));
  const families = useMemo(() => {
    const keys = visibleTabKeys(
      DASHBOARD_TABS.map(({ key }) => key),
      { hidden: slug ? tabsHiddenBySlug[slug] ?? [] : [], hasAxes, hasBenchmark, hasStaff, hasCalls },
    );
    return visibleFamilies(keys);
  }, [slug, tabsHiddenBySlug, hasAxes, hasBenchmark, hasStaff, hasCalls]);
  const visibleKeys = useMemo(() => new Set(families.flatMap((f) => f.tabs.map((x) => x.key))), [families]);
  useEffect(() => {
    if (data && !visibleKeys.has(tab)) goTo('overview');
  }, [tab, data, visibleKeys, goTo]);
  const family = familyOf(tab);
  const activeFamily = families.find((f) => f.key === family);

  /** Family pill: the last view opened there, else its first visible view. */
  const openFamily = (key: DashboardFamily) => {
    const def = families.find((f) => f.key === key);
    if (!def) return;
    const remembered = lastTabByFamily.current[key];
    goTo(remembered && def.tabs.some((x) => x.key === remembered) ? remembered : def.tabs[0].key);
  };

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

  // Headline figures of the « Explore » cards (overview): one pass over the period.
  const exploreFigures = useMemo(() => {
    if (!scopedData) return {};
    let pubs = 0; let intl = 0; let intlKnown = 0; let citations = 0;
    for (const p of scopedData.publications) {
      if (p.year == null || p.year < range.start || p.year > range.end) continue;
      pubs++;
      citations += p.citedByCount ?? 0;
      if (p.isInternational != null) { intlKnown++; if (p.isInternational) intl++; }
    }
    const n = (v: number) => v.toLocaleString(numberLocale());
    const out: Partial<Record<DashboardFamily, { value: string; label: string }>> = {
      publications: { value: n(pubs), label: t`publications` },
      impact: { value: n(citations), label: t`citations` },
    };
    if (intlKnown > 0) out.collaborations = { value: `${Math.round((intl / intlKnown) * 100)} %`, label: t`international` };
    const people = staffResearchers?.length ?? scopedData.members?.length ?? 0;
    if (people > 0) out.people = { value: n(people), label: t`members` };
    return out;
  }, [scopedData, range, staffResearchers, t]);

  const copyLink = () => {
    copyToClipboard(window.location.href).then((ok) => {
      if (!ok) return;
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1600);
    });
  };

  // ── PDF report: « Structure report » template of « Mes rapports », pre-filled with the
  // current structure, years and scope (decision R7 of docs/plan-mes-rapports.md, replaces the
  // former 3-step wizard); the report opens in the editor, where the PDF is generated.
  const [reportOpen, setReportOpen] = useState(false);
  // « Ajouter à un rapport » on a chart (docs/plan-mes-rapports.md, lot 4).
  const [addTarget, setAddTarget] = useState<{ chartId: string; title: string; state: ChartState | null } | null>(null);
  const addToReport = useCallback<AddToReport>((chartId, title, state) => setAddTarget({ chartId, title, state }), []);

  const familyBtn = (active: boolean) =>
    `pill flex items-center gap-2 px-4 py-2 text-[13px] font-semibold transition-colors cursor-pointer ${
      active
        ? 'bg-ink text-white dark:bg-accent dark:text-ink shadow-nav-active'
        : 'bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15'
    }`;
  const viewBtn = (active: boolean) =>
    `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
      active
        ? 'bg-accent text-ink shadow-nav-active'
        : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
    }`;

  const isAdmin = getRoles().includes('admin');
  const live = LIVE_TABS.has(tab);

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
          {/* Period and scope do not apply to the live views (media monitoring with its own
              period, directory headcount as of today). */}
          {!live && data && canScopeHeadcount && (
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
          {!live && data && (
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
              title={t`Create a report from this dashboard (editable, then exported as PDF)`}
              className="btn-pill px-3 py-1.5 text-[13px]"
            >
              <FileText className="w-4 h-4" />
              <Trans>PDF report</Trans>
            </button>
          )}
        </div>
      </div>

      {/* Navigation: families, then the views of the active family */}
      <nav aria-label={t`Analyses`} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {families.map((f) => {
            const Icon = FAMILY_ICONS[f.key];
            const active = f.key === family;
            return (
              <button
                key={f.key}
                type="button"
                className={familyBtn(active)}
                aria-current={active ? 'page' : undefined}
                title={t(f.description)}
                onClick={() => openFamily(f.key)}
              >
                <Icon className="w-4 h-4" />
                {t(f.label)}
              </button>
            );
          })}
        </div>
        {activeFamily && activeFamily.tabs.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1" role="tablist">
            {activeFamily.tabs.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={tab === x.key}
                className={viewBtn(tab === x.key)}
                title={t(x.hint)}
                onClick={() => goTo(x.key)}
              >
                {t(x.label)}
              </button>
            ))}
          </div>
        )}
      </nav>

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
            <AddToReportContext.Provider value={addToReport}>
            <ShareScopeContext.Provider value={{ slug, range, perimetre: scope }}>
              {tab === 'overview' && (
                <>
                  <OverviewTab
                    publications={scopedData.publications}
                    range={range}
                    etpr={scopedData.etpr}
                    onOpenList={openList}
                  />
                  <ExploreGrid
                    families={families.filter((f) => f.key !== 'overview')}
                    figures={exploreFigures}
                    onNavigate={goTo}
                  />
                </>
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
              {tab === 'staff' && researchersLoading && !staffResearchers && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-white/80 dark:border-white/15 shadow-soft text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <Trans>Loading the directory…</Trans>
                  </div>
                </div>
              )}
              {tab === 'staff' && staffResearchers && (
                <StaffTab
                  researchers={staffResearchers}
                  structureLabel={scopedData.lab}
                  showAgeGroups={!hasStaffAttributes(scopedData)}
                  onOpenPeople={onOpenPeople ? () => onOpenPeople(staffStructure?.acronym ?? null) : undefined}
                />
              )}
              {tab === 'researchers' && (
                <ResearchersTab dataset={scopedData} range={range} onOpenList={openList} />
              )}
              {tab === 'network' && <NetworkTab dataset={scopedData} range={range} slug={slug} />}
              {tab === 'journals' && (
                <JournalsTab publications={scopedData.publications} range={range} slug={slug} onOpenList={openList} />
              )}
              {tab === 'apc' && <ApcTab dataset={scopedData} range={range} />}
              {tab === 'funders' && <FundersTab dataset={scopedData} range={range} />}
              {tab === 'calls' && (
                <CallsTab
                  researchers={staffResearchers}
                  structureLabel={scopedData.lab}
                  slug={scopedData.slug}
                  enclosing={enclosingStructures}
                  publications={scopedData.publications}
                  onOpenResearcher={onOpenResearcher}
                />
              )}
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
              {drillFilters && (
                <PublicationsListModal
                  dataset={scopedData}
                  range={range}
                  initialFilters={drillFilters}
                  onClose={closeDrill}
                  onOpenInTab={openDrillInTab}
                />
              )}
            </ShareScopeContext.Provider>
            </AddToReportContext.Provider>
          )}
      </>

      {addTarget && slug && (
        <AddToReportDialog
          capture={{
            chartId: addTarget.chartId,
            slug,
            range,
            perimetre: scope,
            filters: addTarget.state?.filters ?? {},
            params: sanitizeChartParams(addTarget.chartId, addTarget.state?.params),
          }}
          chartTitle={addTarget.title}
          onClose={() => setAddTarget(null)}
          onOpenReport={onOpenReport}
        />
      )}

      {reportOpen && slug && (
        <NewReportDialog
          backend={reportsBackend()}
          initial={{
            templateId: 'structure',
            slug,
            period: { kind: 'fixed', start: range.start, end: range.end },
            perimetre: scope,
          }}
          onClose={() => setReportOpen(false)}
          onCreated={(id) => {
            setReportOpen(false);
            onOpenReport?.(id);
          }}
        />
      )}

    </div>
  );
};
