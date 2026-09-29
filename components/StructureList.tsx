import React, { useState, useMemo } from 'react';
import { useCompactHeader } from '../hooks/useCompactHeader';
import { Search, FileDown, ArrowRight, Filter, Merge, Trash2, ArrowUp, ArrowDown, Users, CheckCircle, Network, RefreshCw, Building, Plus, CornerDownRight } from 'lucide-react';
import { Structure, StructureStatus, StructureLevel, ViewState } from '../types';
import { POLE_LAB_MAPPING } from '../lib/mappings';
import { ExportService } from '../lib/exportService';
import { useUrlState } from '../hooks/useUrlState';
import { Trans, useLingui } from '@lingui/react/macro';
import { LEVEL_LABELS, LEVEL_LONG_LABELS, STRUCTURE_STATUS_LABELS } from '../lib/structureLabels';
import { HelpButton } from './HelpButton';
import { VIEW_HELP } from '../lib/helpLinks';

/** Props of the StructureList component */
interface StructureListProps {
  /** List of structures to display */
  structures: Structure[];
  /** Callback when a structure is selected to view the detail */
  onSelectStructure: (s: Structure) => void;
  /** Indicates that a Grist sync is in progress */
  loading?: boolean;
  /** Manual sync callback (forced re-read from Grist) */
  onManualSync?: () => void;
  /** Callback importing structures from LDAP (opens the review page) */
  onLdapImport?: () => void;
  /** Opens the « Nouvelle structure » page */
  onCreate?: () => void;
}

/** Allowed sort keys for structures */
type SortKey = 'identity' | 'supervisors' | 'level' | 'status';

/** Common class of the filter selects (pills) */
const filterSelectCls = 'h-10 px-4 rounded-full bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] outline-none focus:border-accent-strong transition-colors cursor-pointer';

/**
 * @component StructureList
 * @description Main view of research structures (labs, units, teams).
 */
export const StructureList: React.FC<StructureListProps> = ({ structures, onSelectStructure, loading = false, onManualSync, onLdapImport, onCreate }) => {
  const { t } = useLingui();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'dataviz'>('list');

  // Active filters
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterSupervisor, setFilterSupervisor] = useState<string>('ALL');
  const [filterPole, setFilterPole] = useState<string>('ALL');

  // Sync with the URL
  const { setUrlState } = useUrlState(
    {
      search: '',
      level: 'ALL',
      status: 'ALL',
      supervisor: 'ALL',
      pole: 'ALL',
      mode: 'list'
    },
    (newState) => {
      if (newState.search !== undefined) setSearchTerm(newState.search || '');
      if (newState.level !== undefined) setFilterLevel(newState.level || 'ALL');
      if (newState.status !== undefined) setFilterStatus(newState.status || 'ALL');
      if (newState.supervisor !== undefined) setFilterSupervisor(newState.supervisor || 'ALL');
      if (newState.pole !== undefined) setFilterPole(newState.pole || 'ALL');
      if (newState.mode !== undefined) setViewMode((newState.mode as 'list' | 'dataviz') || 'list');
    }
  );

  // URL update on state changes
  const updateViewMode = (val: 'list' | 'dataviz') => { setViewMode(val); setUrlState({ mode: val }); };
  const updateSearch = (val: string) => { setSearchTerm(val); setUrlState({ search: val }); };
  const updateLevel = (val: string) => { setFilterLevel(val); setUrlState({ level: val }); };
  const updateStatus = (val: string) => { setFilterStatus(val); setUrlState({ status: val }); };
  const updateSupervisor = (val: string) => { setFilterSupervisor(val); setUrlState({ supervisor: val }); };
  const updatePole = (val: string) => { setFilterPole(val); setUrlState({ pole: val }); };

  // Virtual pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const supervisors = useMemo(() => Array.from(new Set(structures.flatMap(s => s.supervisors))).sort(), [structures]);
  const poles = useMemo(() => Object.keys(POLE_LAB_MAPPING), []);

  const filteredStructures = useMemo(() => {
    return structures.filter(s => {
      const matchesSearch =
        s.officialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.acronym.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.rnsrId.toLowerCase().includes(searchTerm.toLowerCase());
      const levelString = String(s.level);
      const matchesLevel = filterLevel === 'ALL' || levelString === filterLevel;
      const matchesStatus = filterStatus === 'ALL' || s.status === filterStatus;
      const matchesSupervisor = filterSupervisor === 'ALL' || s.supervisors.includes(filterSupervisor);
      const matchesPole = filterPole === 'ALL' || s.cluster === filterPole;
      return matchesSearch && matchesLevel && matchesStatus && matchesSupervisor && matchesPole;
    });
  }, [structures, searchTerm, filterLevel, filterStatus, filterSupervisor, filterPole]);

  const sortedStructures = useMemo(() => {
    if (!sortConfig) return filteredStructures;
    return [...filteredStructures].sort((a, b) => {
      let aValue = '', bValue = '';
      switch (sortConfig.key) {
        case 'identity': aValue = a.acronym || ''; bValue = b.acronym || ''; break;
        case 'supervisors': aValue = a.supervisors[0] || ''; bValue = b.supervisors[0] || ''; break;
        case 'level': aValue = String(a.level) || ''; bValue = String(b.level) || ''; break;
        case 'status': aValue = a.status || ''; bValue = b.status || ''; break;
        default: return 0;
      }
      return sortConfig.direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    });
  }, [filteredStructures, sortConfig]);

  const paginatedStructures = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedStructures.slice(start, start + pageSize);
  }, [sortedStructures, currentPage]);

  const totalPages = Math.ceil(sortedStructures.length / pageSize);

  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const isAllSelected = paginatedStructures.length > 0 && paginatedStructures.every(s => selectedIds.has(s.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      const newSelected = new Set(selectedIds);
      paginatedStructures.forEach(s => newSelected.delete(s.id));
      setSelectedIds(newSelected);
    } else {
      const newSelected = new Set(selectedIds);
      paginatedStructures.forEach(s => newSelected.add(s.id));
      setSelectedIds(newSelected);
    }
  };

  const levelChip = (label: string, dotColor: string) => (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-[12px] font-semibold text-ink dark:text-[#e7e2d6] whitespace-nowrap">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }}></span>
      {label}
    </span>
  );

  const getLevelBadge = (level: string | number) => {
    const strLvl = String(level);
    switch(strLvl) {
      case StructureLevel.ETABLISSEMENT:
      case 'ETABLISSEMENT':
      case '4':
        return levelChip(t(LEVEL_LABELS[StructureLevel.ETABLISSEMENT]), '#7048e8');
      case StructureLevel.ENTITE:
      case 'ENTITE':
      case '2':
        return levelChip(t(LEVEL_LABELS[StructureLevel.ENTITE]), '#3b5bdb');
      case StructureLevel.INTERMEDIAIRE:
      case 'INTERMEDIAIRE':
      case '3':
        return levelChip(t(LEVEL_LABELS[StructureLevel.INTERMEDIAIRE]), '#20a4a4');
      case StructureLevel.EQUIPE:
      case 'EQUIPE':
      case '1':
        return levelChip(t(LEVEL_LABELS[StructureLevel.EQUIPE]), '#2ea066');
      default: return levelChip(strLvl, '#9a9486');
    }
  };

  const getStatusBadge = (status: string) => {
    const isActive = status === 'ACTIVE' || status === StructureStatus.ACTIVE;
    const label = STRUCTURE_STATUS_LABELS[status as StructureStatus];
    return (
      <span className={isActive
        ? 'status-pill-internal'
        : 'inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-semibold bg-[rgba(59,91,219,.12)] text-[#3b5bdb] dark:bg-[rgba(59,91,219,.25)] dark:text-[#9db1f2]'}>
        {isActive ? <CheckCircle className="w-3 h-3" /> : ''}
        {label ? t(label) : status}
      </span>
    );
  };

  /** CSV / Excel export rows (translated column headers). */
  const exportRows = () =>
    sortedStructures.map(s => ({
      [t`Acronym`]: s.acronym,
      [t`Name`]: s.officialName,
      [t`Supervising bodies`]: s.supervisors.join('|'),
      [t`Status`]: s.status,
    }));

  const SortableHeader = ({ label, sortKey }: { label: string, sortKey: SortKey }) => {
    const isActive = sortConfig?.key === sortKey;
    return (
      <th
        scope="col"
        className="px-6 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] cursor-pointer group hover:text-ink dark:hover:text-[#f5f2ea] transition-colors select-none border-b border-ink/5 dark:border-white/5"
        onClick={() => handleSort(sortKey)}
      >
        <div className="flex items-center gap-1">
          {label}
          <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            {isActive && sortConfig?.direction === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
          </span>
        </div>
      </th>
    );
  };

  const { compact, onScrollCapture } = useCompactHeader();
  return (
    <div className="flex flex-col h-full relative" onScrollCapture={onScrollCapture}>

      <header className="page-header px-4 md:px-7 pt-5 pb-2 flex flex-col md:flex-row md:items-end justify-between gap-4" data-compact={compact || undefined}>
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="font-disp text-3xl md:text-[38px] font-bold tracking-tight text-ink dark:text-[#f5f2ea]">
              <Trans>Research structures</Trans>
            </h2>
            <span className="count-badge">
               {sortedStructures.length}
            </span>
            <HelpButton path={VIEW_HELP[ViewState.STRUCTURES_LIST]} />
          </div>
          <p className="page-header-sub text-[15px] text-muted dark:text-[#8f897c] mt-1">
            <Trans>Directory of labs and teams</Trans>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onCreate && (
            <button onClick={onCreate} disabled={loading} className="btn-pill disabled:opacity-60" title={t`Create a structure (team, unit, faculty, institution) in Grist`}>
              <Plus className="w-4 h-4" /> <Trans>New structure</Trans>
            </button>
          )}
          <div className="relative group/export">
            <button className="btn-pill">
              <FileDown className="w-4 h-4" /> <Trans>Export</Trans>
            </button>
            <div className="absolute right-0 mt-2 w-48 glass-card-strong rounded-card shadow-soft-lg z-20 overflow-hidden opacity-0 invisible group-hover/export:opacity-100 group-hover/export:visible transition-all">
               <button
                onClick={() => ExportService.exportToCSV(exportRows(), 'structures_druid')}
                className="w-full text-left px-4 py-3 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-accent/15 transition-colors border-b border-ink/5 dark:border-white/5"
               >
                 CSV
               </button>
               <button
                onClick={() => ExportService.exportToExcel(exportRows(), 'structures_druid')}
                className="w-full text-left px-4 py-3 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-accent/15 transition-colors"
               >
                 Excel (.xlsx)
               </button>
            </div>
          </div>
          <div className="relative">
            <button onClick={() => setShowSyncMenu(!showSyncMenu)} disabled={loading} className="btn-pill-dark disabled:opacity-60 disabled:cursor-not-allowed">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <Trans>Synchronise</Trans>
            </button>
            {showSyncMenu && (
              <div className="absolute right-0 mt-2 w-72 glass-card-strong rounded-card shadow-soft-lg z-20 overflow-hidden">
                <button
                  onClick={() => { setShowSyncMenu(false); onManualSync?.(); }}
                  className="w-full text-left px-4 py-3 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-accent/15 border-b border-ink/5 dark:border-white/5 flex items-center gap-2.5 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 text-[#3b5bdb] ${loading ? 'animate-spin' : ''}`} />
                  <Trans>Force Grist refresh</Trans>
                </button>
                {/* LDAP import: only on instances with the HAS_LDAP capability (decided in App.tsx) —
                    absent on Cloudflare. The export to SoVisu+ (structures.csv) lives in Administration. */}
                {onLdapImport && (
                <button
                  onClick={() => { setShowSyncMenu(false); onLdapImport(); }}
                  className="w-full text-left px-4 py-3 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-accent/15 flex items-center gap-2.5 transition-colors"
                >
                  <Building className="w-4 h-4 text-[#1f7a4d]" />
                  <Trans>Import from LDAP</Trans>
                </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="px-4 md:px-7 py-4 flex-1 overflow-auto" data-page-scroll>
        {/* List / Dataviz toggle tabs — pills */}
        <div className="inline-flex items-center gap-1 p-1.5 rounded-full bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 shadow-soft mb-4">
          {([
            { key: 'list', label: t`List`, Icon: Building },
            { key: 'dataviz', label: t`Charts`, Icon: Network },
          ] as const).map(({ key, label, Icon }) => {
            const active = viewMode === key;
            return (
              <button
                key={key}
                onClick={() => updateViewMode(key)}
                aria-pressed={active}
                title={key === 'list' ? t`List view (table)` : t`Chart view (structure hierarchy)`}
                className={`flex items-center gap-2 px-5 py-2 rounded-full font-disp font-semibold text-sm transition-colors ${
                  active
                    ? 'bg-ink text-white dark:bg-accent dark:text-ink shadow-nav-active'
                    : 'text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]'
                }`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            );
          })}
        </div>

        {viewMode === 'dataviz' ? (
          <div className="glass-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-ink/5 dark:border-white/5">
              <span className="section-label">
                <Trans>Structure hierarchy (inclusions / participations)</Trans>
              </span>
              <a
                href="/api/structures-hierarchy.html?force=1"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[13px] font-disp font-semibold text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors"
                title={t`Open full screen / regenerate from the current structures.csv`}
              >
                <RefreshCw className="w-3 h-3" /> <Trans>Full screen</Trans>
              </a>
            </div>
            <iframe
              src="/api/structures-hierarchy.html"
              title={t`Structure hierarchy`}
              className="w-full bg-white"
              style={{ height: 'calc(100vh - 230px)', minHeight: '480px', border: 'none' }}
            />
          </div>
        ) : (
        <>
          {/* Search + filters as pills */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-light" />
              <input
                type="text"
                className="w-full h-12 pl-12 pr-5 rounded-full bg-white/85 dark:bg-white/10 border border-white/90 dark:border-white/15 text-[15px] text-ink dark:text-[#f5f2ea] placeholder:text-muted-lighter dark:placeholder:text-[#8f897c] outline-none focus:border-accent-strong focus:ring-2 focus:ring-accent/40 transition-all shadow-soft"
                placeholder={t`Search for a structure, an acronym, an RNSR…`}
                value={searchTerm}
                onChange={(e) => updateSearch(e.target.value)}
              />
            </div>

            <Filter className="w-4 h-4 text-muted-lighter hidden md:block" />
            <select
              value={filterLevel}
              onChange={(e) => updateLevel(e.target.value)}
              className={filterSelectCls}
            >
              <option value="ALL">{t`All levels`}</option>
              {[StructureLevel.ETABLISSEMENT, StructureLevel.INTERMEDIAIRE, StructureLevel.ENTITE, StructureLevel.EQUIPE].map((lvl) => (
                <option key={lvl} value={lvl}>{t(LEVEL_LONG_LABELS[lvl])}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => updateStatus(e.target.value)}
              className={filterSelectCls}
            >
              <option value="ALL">{t`All statuses`}</option>
              {Object.values(StructureStatus).map((st) => (
                <option key={st} value={st}>{t(STRUCTURE_STATUS_LABELS[st])}</option>
              ))}
            </select>
            <select
              value={filterSupervisor}
              onChange={(e) => updateSupervisor(e.target.value)}
              className={`${filterSelectCls} max-w-[200px]`}
            >
              <option value="ALL">{t`All supervising bodies`}</option>
              {supervisors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={filterPole}
              onChange={(e) => updatePole(e.target.value)}
              className={filterSelectCls}
            >
              <option value="ALL">{t`All clusters`}</option>
              {poles.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                 {/* Structure merge: not implemented (no click handler) → disabled. */}
                 <button disabled title={t`Organisation merge: not available`} className="btn-pill-accent h-10 opacity-50 cursor-not-allowed">
                    <Merge className="w-3.5 h-3.5" /> <Trans>Merge ({selectedIds.size})</Trans>
                 </button>
                 {/* Structure deletion: not implemented (no click handler) → disabled,
                     same convention as the Fusionner button above (code review lot 7b: the button was
                     rendered active while doing nothing on click, with no indication). */}
                 <button disabled title={t`Structure deletion: not available`} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[rgba(214,69,69,.14)] text-[#b23b3b] opacity-50 cursor-not-allowed">
                    <Trash2 className="w-4 h-4" />
                 </button>
              </div>
            )}
          </div>

          {/* Table in a large glass card */}
          <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="px-6 py-4 w-10 border-b border-ink/5 dark:border-white/5">
                    <input type="checkbox" className="rounded border-ink/20 dark:border-white/20 text-ink focus:ring-accent" checked={isAllSelected} onChange={toggleSelectAll} />
                  </th>
                  <SortableHeader label={t`Structure`} sortKey="identity" />
                  <th className="px-6 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] border-b border-ink/5 dark:border-white/5"><Trans>IDs</Trans></th>
                  <SortableHeader label={t`Supervising bodies`} sortKey="supervisors" />
                  <SortableHeader label={t`Level`} sortKey="level" />
                  <SortableHeader label={t`Status`} sortKey="status" />
                  <th className="px-6 py-4 border-b border-ink/5 dark:border-white/5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedStructures.map((s) => (
                  <tr key={s.id} className={`hover:bg-accent/10 cursor-pointer border-b border-ink/5 dark:border-white/5 group transition-colors ${selectedIds.has(s.id) ? 'bg-accent/15' : ''}`} onClick={() => onSelectStructure(s)}>
                    <td className="px-6 py-4" onClick={(e) => { e.stopPropagation(); toggleSelect(s.id); }}>
                       <input type="checkbox" className="rounded border-ink/20 dark:border-white/20 text-ink focus:ring-accent" checked={selectedIds.has(s.id)} readOnly />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-xl bg-accent/25 dark:bg-accent/20 text-ink dark:text-accent flex items-center justify-center shrink-0">
                           <Network className="w-5 h-5" />
                        </div>
                        <div className="ml-4 min-w-0">
                          <span className="font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea]">{s.acronym}</span>
                          {/* Team: parent lab (parent_structure) as a breadcrumb, clickable → lab record. */}
                          {String(s.level) === StructureLevel.EQUIPE && s.parentStructure && (() => {
                            const lab = structures.find((x) => x.acronym.toUpperCase() === String(s.parentStructure).toUpperCase() && String(x.level) === StructureLevel.ENTITE);
                            return (
                              <button
                                onClick={(e) => { e.stopPropagation(); if (lab) onSelectStructure(lab); }}
                                title={lab ? t`Team of lab ${lab.acronym} — open its record` : t`Parent lab “${s.parentStructure}” not found in the list`}
                                className={`ml-2 inline-flex items-center gap-1 align-middle px-2 py-0.5 rounded-full text-[11px] font-bold ${lab ? 'bg-[rgba(46,160,102,.14)] text-[#1f7a4d] dark:text-[#5fd39a] hover:bg-[rgba(46,160,102,.26)]' : 'bg-[rgba(224,158,42,.18)] text-[#8a5a00] dark:text-[#f0c266] cursor-default'} transition-colors`}
                              >
                                <CornerDownRight className="w-3 h-3" /> {s.parentStructure}
                              </button>
                            );
                          })()}
                          <span className="block text-[12px] text-muted-light dark:text-[#8f897c] line-clamp-1">{s.officialName}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {s.rnsrId && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-muted dark:text-[#8f897c]">RNSR</span>
                            <span className="text-[11px] font-mono text-muted dark:text-[#8f897c]">{s.rnsrId}</span>
                          </div>
                        )}
                        {s.rorId && (
                          <div className="flex items-center gap-1.5">
                             <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[rgba(59,91,219,.1)] dark:bg-[rgba(59,91,219,.25)] border border-[rgba(59,91,219,.2)] text-[#3b5bdb] dark:text-[#9db1f2]">ROR</span>
                             <span className="text-[11px] font-mono text-muted dark:text-[#8f897c]">{s.rorId}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 items-start">
                        {s.supervisors.map((sup, i) => (
                          <span key={i} className="px-2.5 py-1 text-[11px] font-semibold rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-ink dark:text-[#e7e2d6]">
                             {sup}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs">{getLevelBadge(s.level)}</td>
                    <td className="px-6 py-4">{getStatusBadge(s.status)}</td>
                    <td className="px-6 py-4 text-right">
                       <ArrowRight className="w-5 h-5 text-muted-faint group-hover:text-ink dark:group-hover:text-[#f5f2ea] transition-colors" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {sortedStructures.length === 0 && (
               <div className="p-20 text-center text-muted dark:text-[#8f897c] font-disp font-semibold text-sm"><Trans>No structure found.</Trans></div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="px-6 py-4 flex items-center justify-between border-t border-ink/5 dark:border-white/5">
               <div className="text-sm text-muted dark:text-[#8f897c]">
                 <Trans>Page <span className="font-bold text-ink dark:text-[#f5f2ea]">{currentPage}</span> / <span className="font-bold text-ink dark:text-[#f5f2ea]">{totalPages}</span></Trans>
               </div>
               <div className="flex gap-2">
                 <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="btn-pill h-9 px-4 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ← <Trans>Previous</Trans>
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="btn-pill h-9 px-4 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trans>Next</Trans> →
                  </button>
               </div>
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
};
