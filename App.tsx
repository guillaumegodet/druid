
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from './lib/apiErrors';
import { Sidebar } from './components/Sidebar';
import { ResearcherList } from './components/ResearcherList';
import { ResearcherDetail } from './components/ResearcherDetail';
import { StructureList } from './components/StructureList';
import { StructureDetail } from './components/StructureDetail';
import { GroupList } from './components/GroupList';
// Loaded on demand: this section bundles ECharts (~1 MB), useless to the rest of the app.
const DashboardPage = React.lazy(() =>
  import('./components/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
// Administration section (ETL console, rights, media sources) — admins only.
const ReportsPage = React.lazy(() =>
  import('./components/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const AdminPage = React.lazy(() =>
  import('./components/admin/AdminPage').then((m) => ({ default: m.AdminPage }))
);
import type { AdminTab } from './lib/auth';
import { ViewState, Researcher, Structure, ResearcherStatus, StructureLevel } from './types';
import { GristService, NEW_STRUCTURE_ID, LdapDiff, StructuresLdapDiff, IdrefCandidate, AlignMode, AlignCandidate, DECISION_MIXED, ReviewDecision, AlignGroup, UnifiedAlignDiff, UnifiedAlignSource, UNIFIED_ALIGN_SOURCES, PersonAlignUpdate, unifiedCandidateId, DuplicatesDiff } from './lib/gristService';
import { runUnifiedAlign, stopUnifiedRun, UnifiedRunProgress } from './lib/unifiedAlignRuns';
import { useDruidData } from './hooks/useDruidData';
import { isSuperAdmin, hasFullAccess, canUseEstablishmentTools, isLabViewer, hasCapability, canWrite } from './lib/auth';
import { useUrlState } from './hooks/useUrlState';
import { MainLayout } from './components/layout/MainLayout';
import { ChatWidget } from './components/ChatWidget';
import { TodoPage, type TodoTab } from './components/researchers/TodoPage';
import { useImportConflicts } from './hooks/useImportConflicts';
import { TaskForm } from './components/researchers/TaskForm';
import { useTasks } from './hooks/useTasks';
import type { Task } from './lib/tasks';
import { MergeResearchersModal } from './components/researchers/MergeResearchersModal';
import type { AlignLaunchChoice } from './components/researchers/AlignLaunchModal';
import { getUserInfo } from './lib/auth';
import { UnifiedAlignPage } from './components/researchers/UnifiedAlignPage';
import type { LdapCandProgress } from './components/researchers/LdapCandidatesPage';
import { LdapAlignPage, LdapAlignMode } from './components/researchers/LdapAlignPage';
import type { LdapDeparture } from './lib/ldapMoves';
import type { LdapRunProgress } from './components/researchers/LdapVerifyPanel';
import { LdapCandidatesDiff, LdapResolved } from './lib/gristService';
import { StructuresLdapReview } from './components/structures/StructuresLdapReview';
import { ValidationImportReview } from './components/researchers/ValidationImportReview';
import { ValidationDiff, ValidationScope, ValidationInfo } from './lib/validation';
import { fetchDashboardStructures } from './lib/dashboardSource';

/**
 * @component App
 * @description Main entry point of the Druid application.
 */
function App() {
  const { t } = useLingui();
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.RESEARCHERS_LIST);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) return savedTheme === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const toggleTheme = () => setDarkMode(!darkMode);

  // Data loading delegated to the dedicated hook
  const { 
    researchers, 
    setResearchers, 
    structures, 
    loading, 
    error, 
    setError, 
    setLoading, 
    refreshData 
  } = useDruidData();

  const [selectedResearcher, setSelectedResearcher] = useState<Researcher | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<Structure | null>(null);
  const [ldapDiff, setLdapDiff] = useState<LdapDiff | null>(null);
  /** Merge assistant: the two Annuaire rows (Grist rowIds) being merged. */
  const [mergeRowIds, setMergeRowIds] = useState<[number, number] | null>(null);
  const [mergesRefreshKey, setFusionsRefreshKey] = useState(0);

  /** After a merge/restore: reload the data and, if the LDAP review page is open, its diff. */
  const afterMergeChange = async () => {
    setFusionsRefreshKey((k) => k + 1);
    await refreshData();
    if (ldapDiff) {
      try { setLdapDiff(await GristService.computeLdapDiff()); } catch (e) { console.warn('LDAP diff recompute after merge:', e); }
    }
    if (dupDiff) {
      try { setDupDiff(await GristService.computeDuplicatesDiff()); } catch (e) { console.warn('Duplicates recompute after merge:', e); }
    }
  };
  const [structDiff, setStructDiff] = useState<StructuresLdapDiff | null>(null);
  // Unified alignment page (docs/plan-alignement-unifie.md): aggregates IdRef/ORCID/HAL/OpenAlex
  // into one view per person — state separate from the 4 legacy pages (kept, see plan §5).
  const [unifiedDiff, setUnifiedDiff] = useState<UnifiedAlignDiff | null>(null);
  const [unifiedMode, setUnifiedMode] = useState<AlignMode>('search');
  const [unifiedApplying, setUnifiedApplying] = useState(false);
  const unifiedDirtyRef = useRef(false);
  const [unifiedProgress, setUnifiedProgress] = useState<Partial<Record<UnifiedAlignSource, UnifiedRunProgress>> | null>(null);
  const isUnifiedRunning = (p: typeof unifiedProgress) => !!p && UNIFIED_ALIGN_SOURCES.some((s) => p[s]?.running);
  // LDAP affiliation (candidates by email for records without a uid)
  const [ldapCandDiff, setLdapCandDiff] = useState<LdapCandidatesDiff | null>(null);
  const [ldapCandProgress, setLdapCandProgress] = useState<LdapCandProgress | null>(null);
  const [ldapCandApplying, setLdapCandApplying] = useState(false);
  // Two-tab LDAP alignment (docs/archive/plan-reorganisation-sync-ldap.md, lot 2): `ldapDiff`
  // (LDAP ↔ Annuaire comparison) feeds the « Vérifier les existants » tab.
  const [ldapMode, setLdapMode] = useState<LdapAlignMode>('search');
  /** Page the researcher form returns to (save or back): the LDAP page when « Create » of its
   * « Arrivées et départs » tab opened the form, the list otherwise. */
  const [detailReturnView, setDetailReturnView] = useState<ViewState>(ViewState.RESEARCHERS_LIST);
  // « Mark as left » clicked row after row: the researchers are reloaded once the admin pauses.
  const departuresRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (currentView !== ViewState.RESEARCHER_DETAIL && currentView !== ViewState.LDAP_ALIGN) setDetailReturnView(ViewState.RESEARCHERS_LIST);
  }, [currentView]);
  const handleMarkDeparted = async (d: LdapDeparture, accountLabel: string) => {
    if (!d.researcher.uid) return;
    await GristService.markLdapDeparted(d.researcher.uid, d.since, accountLabel);
    if (departuresRefreshTimer.current) clearTimeout(departuresRefreshTimer.current);
    departuresRefreshTimer.current = setTimeout(() => { refreshData(); }, 5000);
  };
  const [ldapProgress, setLdapProgress] = useState<LdapRunProgress | null>(null);
  const [ldapApplying, setLdapApplying] = useState(false);
  const loadLdapDiff = async () => {
    try { setLdapDiff(await GristService.computeLdapDiff()); }
    catch (err: any) { setError(apiErrorText(err) || t`Error computing the LDAP diff`); }
  };
  // « Doublons » page (lot 3): uid_dyna groups computed on the Annuaire alone. The counter of the
  // pill in the Personnel header comes from the already loaded `researchers` (a uid shared by ≥ 2
  // ungrouped records = pending duplicate, qualified multi-affiliations being already merged
  // into a single record by groupQualifiedRows) — no fetch, no run.
  const [dupDiff, setDupDiff] = useState<DuplicatesDiff | null>(null);
  const [dupLoading, setDupLoading] = useState(false);
  const loadDupDiff = async () => {
    try { setDupLoading(true); setDupDiff(await GristService.computeDuplicatesDiff()); }
    catch (err: any) { setError(apiErrorText(err) || t`Error searching for duplicates`); }
    finally { setDupLoading(false); }
  };
  const duplicatesCount = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of researchers) if (r.uid) seen.set(r.uid, (seen.get(r.uid) || 0) + 1);
    let n = 0;
    for (const c of seen.values()) if (c > 1) n++;
    return n;
  }, [researchers]);
  // « À traiter » section (docs/plan-chantiers-taches.md, lot 2): duplicates + tasks tabs, admin-only.
  // The task list is loaded once for admins (the pill counts the open ones); `?tab=` in the URL.
  const tasksEnabled = isSuperAdmin() && hasCapability('HAS_TASKS');
  const tasksState = useTasks(tasksEnabled);
  const conflictsState = useImportConflicts(tasksEnabled);
  // Conflicts settled one by one: the researchers are reloaded once the admin pauses.
  const conflictsRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterConflictResolved = () => {
    conflictsState.reload();
    if (conflictsRefreshTimer.current) clearTimeout(conflictsRefreshTimer.current);
    conflictsRefreshTimer.current = setTimeout(() => { refreshData(); }, 8000);
  };
  const openConflictRecord = (record: number, uid: string) => {
    const r = researchers.find((res) => res.gristRowId === record) || (uid ? researchers.find((res) => res.uid === uid) : undefined);
    if (!r) { setError(t`Researcher not found in the loaded scope`); return; }
    handleResearcherSelect(r);
  };
  const [todoTab, setTodoTab] = useState<TodoTab>('doublons');
  const [taskForm, setTaskForm] = useState<{ researcher: Researcher | null } | null>(null);
  const openTodo = (tab?: TodoTab) => {
    setViewAndUrl(ViewState.TASKS);
    if (tab) { setTodoTab(tab); setUrlState({ tab }); }
  };
  /** Opens the Druid record of a task's researcher (Grist row id first, uid_dyna fallback). */
  const openTaskResearcher = (task: Task) => {
    const r = researchers.find((res) => (task.chercheur ? res.gristRowId === task.chercheur : false))
      || (task.uid_dyna ? researchers.find((res) => res.uid === task.uid_dyna) : undefined);
    if (!r) { setError(t`Researcher of the task not found in the loaded scope`); return; }
    handleResearcherSelect(r);
  };
  const [validationImportOpen, setValidationImportOpen] = useState(false);
  // « Tableau de bord » section (druid-biblio): available slugs + preselected structure.
  const [dashboardSlugs, setDashboardSlugs] = useState<string[]>([]);
  const [dashboardStruct, setDashboardStruct] = useState<string | null>(null);
  // Report open in the « Mes rapports » editor (null = the list).
  const [reportId, setReportId] = useState<number | null>(null);

  useEffect(() => {
    fetchDashboardStructures()
      .then((d) => setDashboardSlugs(d.slugs))
      .catch(() => setDashboardSlugs([]));
  }, []);

  /** druid-biblio slug matching a structure acronym (alphanumeric comparison). */
  const dashboardSlugFor = (acronym?: string): string | null => {
    const norm = (s: string) =>
      s.toLowerCase().replace(/\u00b2/g, '2').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    if (!acronym) return null;
    const target = norm(acronym);
    if (!target) return null;
    return dashboardSlugs.find((slug) => norm(slug) === target) ?? null;
  };

  /** Opens the dashboard section on a given structure. */
  const openDashboardFor = (slug: string) => {
    setDashboardStruct(slug);
    setViewAndUrl(ViewState.DASHBOARD);
  };

  // Administration section: requested tab + structure to preselect
  // in the ETL console (from the URL or the dashboard's « Configurer » button).
  const [adminTab, setAdminTab] = useState<AdminTab | null>(null);
  const [adminStruct, setAdminStruct] = useState<string | null>(null);
  const openAdmin = (tab: AdminTab, struct: string | null = null) => {
    setAdminTab(tab);
    setAdminStruct(struct);
    setViewAndUrl(ViewState.ADMIN);
  };

  // Sync with the URL (on load and on the browser's back/forward: `urlVersion` then
  // re-runs the record selection below).
  const [urlVersion, setUrlVersion] = useState(0);
  const { setUrlState } = useUrlState(
    { page: ViewState.RESEARCHERS_LIST, id: null, tab: null },
    (newState) => {
      setUrlVersion((v) => v + 1);
      // Legacy « Doublons » page URL → « À traiter » section, Doublons tab.
      if (String(newState.page) === 'DUPLICATES') { setCurrentView(ViewState.TASKS); setTodoTab('doublons'); return; }
      if (newState.page === ViewState.TASKS && (newState.tab === 'doublons' || newState.tab === 'taches' || newState.tab === 'affiliations' || newState.tab === 'conflits')) setTodoTab(newState.tab);
      if (newState.page === ViewState.REPORTS) {
        const n = Number(newState.id);
        setReportId(Number.isInteger(n) && n > 0 ? n : null);
      }
      if (newState.page) setCurrentView(newState.page as ViewState);
    }
  );
  // People a report can be shared with: login ids are the Annuaire uid on Keycloak instances,
  // the e-mail behind Cloudflare Access (then the logged-in id itself is an e-mail).
  const shareCandidates = useMemo(() => {
    const byEmail = getUserInfo().preferred_username.includes('@');
    return researchers
      .map((r) => ({ id: (byEmail ? r.email : r.uid) ?? '', label: r.displayName }))
      .filter((c) => c.id);
  }, [researchers]);
  const openReport = (id: number | null) => {
    setReportId(id);
    setCurrentView(ViewState.REPORTS);
    setUrlState({ page: ViewState.REPORTS, id: id == null ? null : String(id) }, { push: true });
  };

  // Effect selecting the entity when an ID is present in the URL (once the data is loaded)
  useEffect(() => {
    if (loading) return;
    
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const page = params.get('page');

    // Shared links: ?page=ADMIN&tab=… (+ struct), and the former dashboard tabs
    // (console/streamlit/rights, before the Administration section of 2026-09-10).
    const tab = params.get('tab');
    const legacyAdminTab: AdminTab | null =
      tab === 'console' || tab === 'streamlit' ? 'console' : tab === 'rights' ? 'rights' : null;
    if (page === ViewState.ADMIN && (tab === 'console' || tab === 'rights' || tab === 'media')) {
      setAdminTab(tab);
      setAdminStruct(params.get('struct'));
    } else if (page === ViewState.DASHBOARD && legacyAdminTab) {
      openAdmin(legacyAdminTab, params.get('struct'));
    }

    if (id && page === ViewState.RESEARCHER_DETAIL && researchers.length > 0) {
      // public id = uid (uid_dyna) or ext_<name>-<initial>; backward compat for old ?id=G-<rowId> URLs
      const r = researchers.find(res => res.id === id)
        || (id.startsWith('G-') ? researchers.find(res => String(res.gristRowId) === id.slice(2)) : undefined);
      // `researchers` is already filtered by rights (see useDruidData): an id
      // outside the scope (or nonexistent) matches nothing → fall back to the list
      // rather than leaving an empty record displayed.
      if (r) setSelectedResearcher(r); else setViewAndUrl(ViewState.RESEARCHERS_LIST, false);
    } else if (id && page === ViewState.STRUCTURE_DETAIL && structures.length > 0) {
      const s = structures.find(st => st.id === id);
      if (s) setSelectedStructure(s); else setViewAndUrl(ViewState.STRUCTURES_LIST, false);
    }
  }, [loading, researchers, structures, urlVersion]);

  // Unified alignment page: (re)loads the aggregated diff on opening and on mode change —
  // no heavy run here (see rerunUnifiedAlign), same contract as the 4 legacy pages.
  useEffect(() => {
    if (currentView !== ViewState.UNIFIED_ALIGN) return;
    if (isUnifiedRunning(unifiedProgress)) return;
    loadUnifiedDiff(unifiedMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, unifiedMode]);
  useEffect(() => {
    if (currentView !== ViewState.UNIFIED_ALIGN && unifiedDirtyRef.current) {
      unifiedDirtyRef.current = false;
      refreshData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  // LDAP alignment page: loads both comparisons on entry (cache reads, no heavy
  // run) — candidates (missing tab) and LDAP ↔ Annuaire diff (existing tab + list
  // « uid LDAP sans fiche » of the missing tab).
  useEffect(() => {
    if (currentView !== ViewState.LDAP_ALIGN) return;
    if (!ldapCandProgress?.running) {
      GristService.computeLdapCandidatesDiff()
        .then(setLdapCandDiff)
        .catch((err) => setError(apiErrorText(err) || t`Error reading LDAP candidates`));
    }
    if (!ldapProgress?.running && !ldapDiff) loadLdapDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);
  // « À traiter › Doublons » tab: recomputes the groups on every entry (Annuaire read, no run).
  useEffect(() => {
    if (currentView === ViewState.TASKS && todoTab === 'doublons') loadDupDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, todoTab]);

  // Rights management: Groups restricted to the super admin; the list of
  // Structures + alignment tools (LDAP, IdRef, ORCID, HAL, OpenAlex)
  // restricted to institution-level rights (see lib/auth.canUseEstablishmentTools).
  // The Sidebar already hides their nav entries; this guard covers direct access
  // by URL (?page=GROUPS_LIST…). The record of one's own structure
  // (STRUCTURE_DETAIL) remains accessible with lab-level rights.
  useEffect(() => {
    // « À traiter » (duplicates + tasks): admins only (decision of 2026-09-23), like /api/tasks.
    const superAdminOnly: ViewState[] = [ViewState.GROUPS_LIST, ViewState.TASKS];
    const establishmentOnly: ViewState[] = [ViewState.STRUCTURES_LIST, ViewState.UNIFIED_ALIGN, ViewState.LDAP_ALIGN];
    if ((superAdminOnly.includes(currentView) && !isSuperAdmin()) ||
        (establishmentOnly.includes(currentView) && !canUseEstablishmentTools()) ||
        (currentView === ViewState.LDAP_ALIGN && !hasCapability('HAS_LDAP'))) {
      setViewAndUrl(ViewState.RESEARCHERS_LIST, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  /** Reruns the LDAP search server-side then reloads the diff (polling). */
  const rerunLdapCandidates = async () => {
    try {
      setError('');
      setLdapCandProgress({ running: true, total: 0, done: 0, matched: 0 });
      const trig = await fetch('/api/sync-ldap-candidates-trigger');
      if (!trig.ok && trig.status !== 409) {
        const d = await trig.json().catch(() => ({}));
        throw new Error(d.error || t`LDAP search trigger failed: ${trig.status}`);
      }
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const pr = await fetch('/api/sync-ldap-candidates-progress', { cache: 'no-store' });
        const p = await pr.json().catch(() => ({ running: false }));
        setLdapCandProgress(p);
        if (p.error) throw new Error(`Recherche LDAP: ${p.error}`);
        if (!p.running) break;
      }
      const diff = await GristService.computeLdapCandidatesDiff();
      setLdapCandDiff(diff);
    } catch (err: any) {
      setLdapCandProgress((prev) => (prev ? { ...prev, running: false } : prev));
      setError(apiErrorText(err) || t`Error during the LDAP search`);
    }
  };

  /** Applies the affiliation of resolved entries (writes uid_dyna + extra fields). */
  const handleApplyLdapCandidates = async (entries: LdapResolved[]) => {
    try {
      setLdapCandApplying(true);
      const { updated, skippedDuplicates } = await GristService.applyLdapCandidates(entries);
      setError('');
      await refreshData();
      const diff = await GristService.computeLdapCandidatesDiff();
      setLdapCandDiff(diff);
      const skippedMsg = skippedDuplicates.length
        ? t`\n${skippedDuplicates.length} skipped: uid already carried by another row of the same lab (${skippedDuplicates.map((s) => `${s.uid} → G-${s.existingRowId}`).join(', ')}) — use “Merge”.`
        : '';
      alert(t`LDAP attachment: ${updated} record(s) attached (uid_dyna written to Grist).${skippedMsg}`);
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error attaching LDAP records`);
      // Batched writes: a partial failure has already written the previous batches to Grist (code
      // review lot 6a, finding 1) — without this resync, the review stayed displayed as if NOTHING had
      // been written, inviting a redundant re-apply of rows already up to date.
      if (err.updated) {
        await refreshData();
        try { setLdapCandDiff(await GristService.computeLdapCandidatesDiff()); } catch { /* stale diff, will retry on next load */ }
        alert(t`LDAP attachment interrupted after ${err.updated} record(s) written — ${apiErrorText(err)}`);
      }
    } finally {
      setLdapCandApplying(false);
    }
  };

  const handleResearcherSelect = (researcher: Researcher, returnView: ViewState = ViewState.RESEARCHERS_LIST) => {
    setSelectedResearcher(researcher);
    setDetailReturnView(returnView);
    setCurrentView(ViewState.RESEARCHER_DETAIL);
    setUrlState({ page: ViewState.RESEARCHER_DETAIL, id: researcher.id }, { push: true });
  };

  const handleStructureSelect = (structure: Structure) => {
    setSelectedStructure(structure);
    setCurrentView(ViewState.STRUCTURE_DETAIL);
    setUrlState({ page: ViewState.STRUCTURE_DETAIL, id: structure.id }, { push: true });
  };

  /** Navigates to a page. `push` adds a history entry (back button); redirects of the
   *  guards (record not found, missing rights) replace the current one instead. */
  const setViewAndUrl = (view: ViewState, push = true) => {
    setCurrentView(view);
    if (view === ViewState.REPORTS) setReportId(null); // the menu opens the list
    setUrlState({ page: view, id: null }, { push });
  };

  /** New record; with `ldapUid` (« Create » of the LDAP arrivals) the form fills itself from LDAP
   * and returns to the LDAP page. */
  const handleNewResearcher = (ldapUid?: string) => {
    const newResearcher: Researcher = {
      id: `NEW-${Date.now()}`,
      uid: ldapUid || '',
      lastName: '',
      firstName: '',
      displayName: 'Nouveau personnel',
      email: '',
      nationality: '',
      birthDate: '',
      status: ResearcherStatus.EXTERNE,
      employment: {
        employer: '',
        contractType: '',
        grade: '',
        internalTypology: '',
        startDate: '',
        endDate: '',
      },
      affiliations: [
        {
          structureName: '',
          team: '',
          startDate: '',
          isPrimary: true
        }
      ],
      groups: [],
      identifiers: {},
      nuFields: {},
      lastSync: new Date().toISOString().split('T')[0],
      civility: ''
    };
    setSelectedResearcher(newResearcher);
    setDetailReturnView(ldapUid ? ViewState.LDAP_ALIGN : ViewState.RESEARCHERS_LIST);
    setCurrentView(ViewState.RESEARCHER_DETAIL);
  };

  /** Outbound flow to SoVisu+ (Administration): regenerates the two cdb files — structures.csv
   *  first (from Grist), then people.csv, whose main_research_structure points at the structures'
   *  local_id. Stops at the first failure so people.csv never references a structure missing from
   *  structures.csv. */
  const handleSyncToSovisu = async () => {
    try {
      setLoading(true);
      setError('');
      const sRes = await fetch('/api/sync-structures-csv', { method: 'POST' });
      const sData = await sRes.json();
      if (!sRes.ok) throw new Error(sData.error || t`Server error`);
      const pRes = await fetch('/api/sync-sovisuplus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ researchers, structures }),
      });
      const pData = await pRes.json();
      if (!pRes.ok) throw new Error(pData.error || t`Server error`);
      alert(t`SoVisu+ files updated: ${sData.count} structures (structures.csv), ${pData.count} people (people.csv)${pData.skipped ? t`, ${pData.skipped} skipped (no uid)` : ''}.`);
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error synchronizing with SoVisu+`);
    } finally {
      setLoading(false);
    }
  };

  /** « Vérifier les existants » tab: regenerates the LDAP cache server-side (background job,
   *  ~93,000 accounts, see docs/plan-architecture-multi-instances.md) then recomputes the diff. */
  const rerunLdapVerify = async () => {
    if (!hasCapability('HAS_SERVER_JOBS')) {
      setError(t`LDAP synchronization: unavailable on this instance (no server job) — the comparison on the existing cache can still be viewed.`);
      return;
    }
    try {
      setError('');
      setLdapProgress({ running: true, total: 0, done: 0 });
      const trig = await fetch('/api/sync-ldap-trigger');
      // 409 = a run is already in progress: simply switch to tracking.
      if (!trig.ok && trig.status !== 409) {
        const d = await trig.json().catch(() => ({}));
        throw new Error(d.error || t`LDAP synchronization trigger failed: ${trig.status}`);
      }
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const pr = await fetch('/api/sync-ldap-progress', { cache: 'no-store' });
        const p = await pr.json().catch(() => ({ running: false }));
        setLdapProgress(p);
        if (p.error) throw new Error(`Synchronisation LDAP: ${p.error}`);
        if (!p.running) break;
      }
      setLdapProgress(null);
      await loadLdapDiff();
    } catch (err: any) {
      setLdapProgress(null);
      setError(apiErrorText(err) || t`Error during the LDAP synchronization`);
    }
  };

  const handleApplyLdap = async (ids: string[]) => {
    if (!ldapDiff) return;
    try {
      setLdapApplying(true);
      const { updated } = await GristService.applyLdapUpdates(ldapDiff, ids);
      setError('');
      await refreshData();
      await loadLdapDiff();
      alert(t`LDAP update applied: ${updated} record(s) written to Grist.`);
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error writing the LDAP updates`);
      // Batched writes: a partial failure has already written the previous batches to Grist (code
      // review lot 6a, finding 1) — without this resync, the review stayed displayed as if NOTHING had
      // been written, inviting a redundant re-apply of rows already up to date.
      if (err.updated) {
        await refreshData();
        try { setLdapDiff(await GristService.computeLdapDiff()); } catch { /* stale diff, will retry on next load */ }
        alert(t`LDAP write interrupted after ${err.updated} record(s) written — ${apiErrorText(err)}`);
      }
    } finally {
      setLdapApplying(false);
    }
  };

  // Import of a verified list: sets the validation layer (status/affiliation)
  // on the matched records and persists the dedicated columns in Grist (grouped PATCH).
  const handleApplyValidation = async (
    diff: ValidationDiff,
    opts: { source: string; date: string; scope: ValidationScope[] },
  ) => {
    try {
      setLoading(true);
      const byId = new Map(diff.matched.map((m) => [m.researcherId, m]));
      const coversStatus = opts.scope.includes('statut');
      const entries = researchers
        .filter((r) => byId.has(r.id) && r.gristRowId)
        .map((r) => {
          const m = byId.get(r.id)!;
          const validation: ValidationInfo = {
            validated: true,
            validatedStatus: coversStatus ? m.newStatus : r.validation?.validatedStatus,
            validationDate: opts.date,
            validationSource: opts.source,
            validationScope: opts.scope,
          };
          return { gristRowId: r.gristRowId!, validation };
        });
      await GristService.applyValidation(entries);
      setError('');
      setValidationImportOpen(false);
      await refreshData();
      alert(t`Validation applied: ${entries.length} record(s) written to Grist.`);
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error applying the validations`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Validation of a record from the detail view: writes only the validation
   * columns to Grist (date + validator already set by the record) without leaving
   * the view, and updates the local state to refresh badge/filter immediately.
   */
  const handleValidateResearcher = async (updated: Researcher) => {
    if (!updated.gristRowId) {
      setError(t`This record has no Grist row: validation impossible.`);
      return;
    }
    try {
      setLoading(true);
      await GristService.applyValidation([
        { gristRowId: updated.gristRowId, validation: updated.validation ?? { validated: false, validationScope: [] } },
      ]);
      setSelectedResearcher(updated);
      setResearchers((prev) => prev.map((r) => (r.id === updated.id ? { ...r, validation: updated.validation } : r)));
      setError('');
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error validating the record`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveResearcher = async (updatedResearcher: Researcher) => {
    try {
      setLoading(true);
      if (updatedResearcher.id.startsWith('NEW-')) {
        await GristService.createResearcher(updatedResearcher);
      } else {
        await GristService.updateResearcher(updatedResearcher);
      }
      await refreshData(); // Refresh to see the new record
      if (detailReturnView === ViewState.LDAP_ALIGN) setViewAndUrl(ViewState.LDAP_ALIGN, false);
      else setCurrentView(ViewState.RESEARCHERS_LIST);
      setDetailReturnView(ViewState.RESEARCHERS_LIST);
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error while saving`);
    } finally {
      setLoading(false);
    }
  };

  const handleStructuresLdapImport = async () => {
    try {
      setLoading(true);
      setError('');
      // Triggers + polls /api/sync-structures-ldap-progress (lot 2, same pattern as handleSyncLdap).
      try {
        const trig = await fetch('/api/sync-structures-ldap-trigger');
        if (!trig.ok && trig.status !== 409) {
          const d = await trig.json().catch(() => ({}));
          console.warn('Sync structures LDAP:', d.error || trig.status);
        } else {
          for (;;) {
            await new Promise((r) => setTimeout(r, 2000));
            const pr = await fetch('/api/sync-structures-ldap-progress', { cache: 'no-store' });
            const p = await pr.json().catch(() => ({ running: false }));
            if (p.error) { console.warn('Sync structures LDAP:', p.error); break; }
            if (!p.running) break;
          }
        }
      } catch (e) {
        console.warn('LDAP structures sync endpoint unreachable, diff on the existing cache.');
      }
      const diff = await GristService.computeStructuresLdapDiff();
      setStructDiff(diff);
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error computing the LDAP structures diff`);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyStructuresLdap = async (updateIds: string[], createKeys: string[]) => {
    if (!structDiff) return;
    try {
      setLoading(true);
      const { updated, created } = await GristService.applyStructuresLdapUpdates(structDiff, updateIds, createKeys);
      setError('');
      setStructDiff(null);
      await refreshData();
      alert(t`LDAP structures: ${updated} updated, ${created} created in Grist.`);
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error writing the LDAP structures`);
    } finally {
      setLoading(false);
    }
  };

  /** « Nouvelle structure » page (list button, or « Ajouter une équipe… » from a researcher record:
   *  level « Équipe » + lab prefilled). Unsaved changes of the originating record are lost. */
  const handleCreateStructure = (init: Partial<Structure> = {}) => {
    setSelectedStructure(GristService.blankStructure(init));
    setCurrentView(ViewState.STRUCTURE_DETAIL);
    setUrlState({ page: ViewState.STRUCTURE_DETAIL, id: null }, { push: true });
  };

  const handleSaveStructure = async (updatedStructure: Structure) => {
    try {
      setLoading(true);
      if (updatedStructure.id === NEW_STRUCTURE_ID) await GristService.createStructure(updatedStructure, structures);
      else await GristService.updateStructure(updatedStructure);
      await refreshData(); // Refresh data
      setCurrentView(ViewState.STRUCTURES_LIST);
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error saving the structure`);
    } finally {
      setLoading(false);
    }
  };


  /** « Identité mêlée »: same review row as a rejection, with the « Identité mêlée » decision and a note (who owns what). */
  const askMixedNote = (displayName: string, candidateId: string): string | null =>
    window.prompt(t`Profile ${candidateId} flagged “Mixed identity” for ${displayName}.\nNote (optional): who owns what, what should be split…`, '');
  /** Loads the flat unified diff (re-reads the 4 caches + Annuaire via computeUnifiedAlignDiff,
   *  NO heavy run). Used when opening the page, on mode change, and after each
   *  apply. */
  const loadUnifiedDiff = async (mode: AlignMode) => {
    try {
      setError('');
      setUnifiedDiff(await GristService.computeUnifiedAlignDiff(UNIFIED_ALIGN_SOURCES, mode));
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error loading the unified view`);
    }
  };
  /** « Rechercher partout »: runs runUnifiedAlign (lot 1) on the 4 sources in parallel, tracks
   *  the aggregated progress, reloads the diff at the end. `labo`/`group`: always provided by
   *  UnifiedAlignPage (never a global run, see docs/plan-alignement-unifie.md §5). */
  const rerunUnifiedAlign = async (mode: AlignMode, labo?: string, group?: AlignGroup, choice?: AlignLaunchChoice) => {
    if (!hasCapability('HAS_SERVER_JOBS')) {
      setError(t`Unified alignment: unavailable on this instance (no server job to launch a run) — the review of already computed candidates can still be viewed.`);
      return;
    }
    try {
      setError('');
      setUnifiedProgress({});
      await runUnifiedAlign(choice?.sources ?? UNIFIED_ALIGN_SOURCES, mode, {
        labo, group, force: choice?.force, limits: choice?.limits, record: choice?.record,
        onProgress: (src, p) => setUnifiedProgress((prev) => ({ ...prev, [src]: p })),
      });
      setUnifiedProgress(null);
      await loadUnifiedDiff(mode);
    } catch (err: any) {
      setUnifiedProgress(null);
      setError(apiErrorText(err) || t`Error during the unified alignment`);
    }
  };
  /** Applies the updates already grouped per record (buildUnifiedUpdates, in UnifiedAlignPage).
   *  Unlike handleApplyAlign/handleApplyIdref (row-by-row in-memory removal), we simply
   *  reload the diff: a unified row can mix several sources, so a surgical removal
   *  would be much more complex for an uncertain gain (lot 5, to revisit if the
   *  reload turns out to be too slow in practice). */
  const handleApplyUnified = async (updates: PersonAlignUpdate[]): Promise<number> => {
    try {
      setUnifiedApplying(true);
      const { updated } = await GristService.applyUnifiedUpdates(updates);
      setError('');
      unifiedDirtyRef.current = true;
      await loadUnifiedDiff(unifiedMode);
      return updated;
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error writing (unified view)`);
      return 0;
    } finally {
      setUnifiedApplying(false);
    }
  };
  /** Rejection / mixed identity from the unified view: same per-source blacklist as the legacy
   *  pages (Alignement_IdRef for IdRef, Alignement_<SOURCE> otherwise), then removal of the candidate
   *  IN MEMORY (no reload: the selections in progress would be lost). */
  const handleRejectUnifiedCandidate = async (
    src: UnifiedAlignSource, row: { id: string; uid: string; displayName: string; labo?: string },
    candidate: AlignCandidate | IdrefCandidate, candidateCount = 1, decision: ReviewDecision = 'Rejeté', note = '',
  ): Promise<boolean> => {
    try {
      setUnifiedApplying(true);
      if (src === 'idref') await GristService.rejectIdrefCandidates([{ uid: row.uid, displayName: row.displayName, labo: row.labo, candidateCount, candidate: candidate as IdrefCandidate }], decision, note);
      else await GristService.rejectAlignCandidates(src, [{ id: row.id, uid: row.uid, displayName: row.displayName, labo: row.labo, candidateCount, candidate: candidate as AlignCandidate }], decision, note);
      setError('');
      const candId = unifiedCandidateId(src, candidate);
      setUnifiedDiff((prev) => {
        if (!prev) return prev;
        const rows = prev.rows.map((r) => {
          if (r.id !== row.id || !r.sources[src]) return r;
          const cell = { ...r.sources[src]! };
          cell.fill = cell.fill?.filter((f) => unifiedCandidateId(src, f.candidate) !== candId);
          const cands = cell.ambiguous?.candidates.filter((c) => unifiedCandidateId(src, c) !== candId);
          cell.ambiguous = cands?.length ? { candidates: cands } : undefined;
          cell.status = cell.fill?.length ? 'strong' : cell.ambiguous ? 'ambiguous' : cell.arbitrate ? 'arbitrate' : cell.redirection ? 'redirect' : cell.conflicts?.length ? 'conflict' : cell.existing?.length ? 'present' : 'not_found';
          return { ...r, sources: { ...r.sources, [src]: cell } };
        });
        return { ...prev, rows };
      });
      return true;
    } catch (err: any) {
      setError(apiErrorText(err) || t`Error rejecting the candidate`);
      return false;
    } finally {
      setUnifiedApplying(false);
    }
  };
  const handleMixedUnifiedCandidate = async (src: UnifiedAlignSource, row: { id: string; uid: string; displayName: string; labo?: string }, candidate: AlignCandidate | IdrefCandidate, candidateCount = 1): Promise<boolean> => {
    const note = askMixedNote(row.displayName || row.uid, unifiedCandidateId(src, candidate));
    if (note === null) return false;
    return handleRejectUnifiedCandidate(src, row, candidate, candidateCount, DECISION_MIXED, note);
  };
  const renderContent = () => {
    // Read-only instance (READ_ONLY, public demo): the edit entry points are not passed down, so
    // the views hide their buttons; lib/readOnly.ts rejects any write that would remain.
    const writable = canWrite();
    switch (currentView) {
      case ViewState.RESEARCHERS_LIST:
        return (
          <ResearcherList 
            researchers={researchers}
            setResearchers={setResearchers}
            onSelectResearcher={handleResearcherSelect}
            onNewResearcher={writable ? () => handleNewResearcher() : undefined}
            loading={loading}
            onManualSync={() => refreshData()}
            onOpenDuplicates={isSuperAdmin() ? () => openTodo() : undefined}
            duplicatesCount={duplicatesCount + tasksState.openCount + conflictsState.openCount}
            onMergeResearchers={writable ? (rowIds) => setMergeRowIds(rowIds) : undefined}
            onImportValidation={writable && hasCapability('HAS_STATUS_VALIDATION') ? () => setValidationImportOpen(true) : undefined}
          />
        );
      case ViewState.RESEARCHER_DETAIL:
        if (!selectedResearcher) return null;
        return (
          <ResearcherDetail
            researcher={selectedResearcher}
            structures={structures}
            onBack={() => { setViewAndUrl(detailReturnView); setDetailReturnView(ViewState.RESEARCHERS_LIST); }}
            autoLdapLookup={detailReturnView === ViewState.LDAP_ALIGN && selectedResearcher.id.startsWith('NEW-') && !!selectedResearcher.uid}
            onSave={writable ? handleSaveResearcher : undefined}
            onValidate={writable ? handleValidateResearcher : undefined}
            isSaving={loading}
            onNavigateToStructure={(id) => {
              const st = structures.find(s => s.id === id);
              if (st) {
                handleStructureSelect(st);
              }
            }}
            onCreateTeam={writable ? (lab) => handleCreateStructure({ level: StructureLevel.EQUIPE, type: 'TEAM', parentStructure: lab }) : undefined}
            onReportTask={tasksEnabled ? (r) => setTaskForm({ researcher: r }) : undefined}
          />
        );
      case ViewState.STRUCTURES_LIST:
        return <StructureList structures={structures} onSelectStructure={handleStructureSelect} loading={loading} onManualSync={() => refreshData()} onLdapImport={hasCapability('HAS_LDAP') ? handleStructuresLdapImport : undefined} onCreate={writable ? () => handleCreateStructure() : undefined} />;
      case ViewState.STRUCTURE_DETAIL:
        if (!selectedStructure) return null;
        return (
          <StructureDetail
            structure={selectedStructure}
            allStructures={structures}
            onBack={() => setViewAndUrl(ViewState.STRUCTURES_LIST)}
            onSave={writable ? handleSaveStructure : undefined}
            isSaving={loading}
            dashboardSlug={dashboardSlugFor(selectedStructure.acronym)}
            onOpenDashboard={openDashboardFor}
            isNew={selectedStructure.id === NEW_STRUCTURE_ID}
          />
        );
      case ViewState.GROUPS_LIST:
        return (
          <GroupList
            researchers={researchers}
            setResearchers={setResearchers}
            onOpenDashboard={openDashboardFor}
          />
        );
      case ViewState.UNIFIED_ALIGN:
        return (
          <UnifiedAlignPage
            diff={unifiedDiff}
            mode={unifiedMode}
            onModeChange={(m) => { setUnifiedDiff(null); setUnifiedMode(m); }}
            progress={unifiedProgress}
            applying={unifiedApplying}
            onRerunAll={rerunUnifiedAlign}
            onStop={stopUnifiedRun}
            onApply={writable ? handleApplyUnified : undefined}
            onRejectCandidate={writable ? handleRejectUnifiedCandidate : undefined}
            onMixedCandidate={writable ? handleMixedUnifiedCandidate : undefined}
          />
        );
      case ViewState.LDAP_ALIGN:
        return (
          <LdapAlignPage
            mode={ldapMode}
            onModeChange={setLdapMode}
            candDiff={ldapCandDiff}
            candProgress={ldapCandProgress}
            candApplying={ldapCandApplying}
            onRerunCandidates={rerunLdapCandidates}
            onApplyCandidates={handleApplyLdapCandidates}
            onMerge={(rowIds) => setMergeRowIds(rowIds)}
            ldapDiff={ldapDiff}
            ldapProgress={ldapProgress}
            ldapApplying={ldapApplying}
            onRerunLdap={rerunLdapVerify}
            onApplyLdap={handleApplyLdap}
            researchers={researchers}
            structures={structures}
            onCreateFromLdap={writable ? (uid) => handleNewResearcher(uid) : undefined}
            onOpenResearcher={(r) => handleResearcherSelect(r, ViewState.LDAP_ALIGN)}
            onMarkDeparted={writable ? handleMarkDeparted : undefined}
          />
        );
      case ViewState.TASKS:
        return (
          <TodoPage
            tab={todoTab}
            onTabChange={(tab) => { setTodoTab(tab); setUrlState({ tab }); }}
            duplicatesCount={duplicatesCount}
            tasksOpenCount={tasksState.openCount}
            withTasks={tasksEnabled}
            conflictTables={conflictsState.tables}
            onOpenConflictRecord={openConflictRecord}
            onConflictsResolved={afterConflictResolved}
            onOpenConsole={hasCapability('HAS_ETL_API') ? (slug) => openAdmin('console', slug) : undefined}
            duplicates={{
              diff: dupDiff,
              loading: dupLoading,
              onRefresh: loadDupDiff,
              onMerge: (rowIds) => setMergeRowIds(rowIds),
              onRestored: () => { afterMergeChange(); },
              mergesRefreshKey,
              onQualify: async ({ rowIds, principalRowId, mode, endDate }) => {
                try {
                  const user = getUserInfo();
                  await GristService.qualifyDoublon({ rowIds, principalRowId, mode, endDate, author: user.preferred_username || user.name || 'druid' });
                  await afterMergeChange();
                } catch (e: any) { setError(apiErrorText(e) || t`Qualification error`); }
              },
              onUnqualify: async (rowIds) => {
                try { await GristService.unqualifyDoublon(rowIds); await afterMergeChange(); }
                catch (e: any) { setError(apiErrorText(e) || t`Requalification error`); }
              },
              onOpenResearcher: (gristRowId) => {
                // Opens the Druid record of the clicked Annuaire row (identified by its Grist row
                // number, the only safe identifier when the uid is shared).
                const r = researchers.find((res) => res.gristRowId === gristRowId);
                if (!r) { setError(t`Grist row ${gristRowId} not found in the loaded scope`); return; }
                handleResearcherSelect(r);
              },
            }}
            tasks={{
              state: tasksState,
              researchers,
              me: getUserInfo().preferred_username,
              onNewTask: () => setTaskForm({ researcher: null }),
              onOpenResearcher: openTaskResearcher,
              onMerge: (rowIds) => setMergeRowIds(rowIds),
            }}
          />
        );
      case ViewState.DASHBOARD:
        return (
          <React.Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-sm font-semibold text-muted-light dark:text-[#8f897c]">
                <Trans>Loading dashboard…</Trans>
              </div>
            }
          >
            <DashboardPage
              struct={dashboardStruct}
              researchers={researchers}
              onOpenResearcher={handleResearcherSelect}
              onOpenAdmin={(slug) => openAdmin('console', slug)}
              onOpenReport={(id) => openReport(id)}
            />
          </React.Suspense>
        );
      case ViewState.REPORTS:
        return (
          <React.Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-sm font-semibold text-muted-light dark:text-[#8f897c]">
                <Trans>Loading…</Trans>
              </div>
            }
          >
            <ReportsPage reportId={reportId} onOpenReport={openReport} shareCandidates={shareCandidates} />
          </React.Suspense>
        );
      case ViewState.ADMIN:
        return (
          <React.Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-sm font-semibold text-muted-light dark:text-[#8f897c]">
                <Trans>Loading…</Trans>
              </div>
            }
          >
            <AdminPage initialTab={adminTab} struct={adminStruct} onOpenDashboard={openDashboardFor}
              onSyncToSovisu={hasCapability('HAS_SOVISU_EXPORT') ? handleSyncToSovisu : undefined} syncingSovisu={loading} />
          </React.Suspense>
        );
      default:
        return <div><Trans>View not found</Trans></div>;
    }
  };

  return (
    <MainLayout
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      error={error}
      onErrorDismiss={() => setError('')}
      sidebar={
        <Sidebar 
          currentView={currentView} 
          onChangeView={setViewAndUrl} 
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          isDarkMode={darkMode}
          toggleTheme={toggleTheme}
        />
      }
    >
      {!loading && !hasFullAccess() && structures.length === 0 && researchers.length === 0 && (
        <div className="glass-card p-4 mb-4 text-sm text-ink dark:text-[#f5f2ea]">
          {isLabViewer() ? (
            <Trans>
              Your account has a “lab” right, but no directory record carries your identifier with a current laboratory — contact an administrator to have your record updated.
            </Trans>
          ) : (
            <Trans>
              No scope has been assigned to you in Druid yet — contact an administrator to attach you to a structure (Keycloak group <code className="font-mono text-xs">labo_viewer</code>, or <code className="font-mono text-xs">dashboard_viewer</code> under your lab).
            </Trans>
          )}
        </div>
      )}
      {renderContent()}
      {mergeRowIds && (
        <MergeResearchersModal
          rowIds={mergeRowIds}
          onClose={() => setMergeRowIds(null)}
          onMerged={({ keptRowId, droppedRowId }) => {
            setMergeRowIds(null);
            if (selectedResearcher?.gristRowId === droppedRowId) setViewAndUrl(ViewState.RESEARCHERS_LIST);
            afterMergeChange();
            console.info(`[Fusion] G-${droppedRowId} absorbed into G-${keptRowId}`);
          }}
        />
      )}
      {taskForm && (
        <TaskForm
          researchers={researchers}
          initialResearcher={taskForm.researcher}
          onClose={() => setTaskForm(null)}
          onSubmit={async (input) => { await tasksState.create(input); if (currentView !== ViewState.TASKS) openTodo('taches'); }}
        />
      )}
      {structDiff && (
        <StructuresLdapReview diff={structDiff} applying={loading} onApply={handleApplyStructuresLdap} onClose={() => setStructDiff(null)} />
      )}
      {validationImportOpen && (
        <ValidationImportReview
          researchers={researchers}
          applying={loading}
          onApply={handleApplyValidation}
          onClose={() => setValidationImportOpen(false)}
        />
      )}
      {isUnifiedRunning(unifiedProgress) && (
        <div className="fixed bottom-4 right-24 z-50 flex items-center gap-3 px-5 py-3 rounded-full bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-white/80 dark:border-white/15 shadow-soft text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
          <span className="w-3.5 h-3.5 border-2 border-ink dark:border-accent border-t-transparent rounded-full animate-spin" />
          <Trans>Unified alignment: {UNIFIED_ALIGN_SOURCES.filter((s) => unifiedProgress?.[s]?.running).length} source(s) running</Trans>
        </div>
      )}
      <ChatWidget />
    </MainLayout>
  );
}

export default App;
