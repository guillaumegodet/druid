import React, { useEffect, useMemo, useState } from 'react';
import { List, LayoutGrid } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { ResearcherDashboard } from './ResearcherDashboard';
import { Researcher, ResearcherStatus } from '../types';
import { GristService } from '../lib/gristService';
import { AbesExportModal } from './researchers/AbesExportModal';
import { useResearcherFilters } from '../hooks/useResearcherFilters';
import { FilterPanel } from './researchers/FilterPanel';
import { ListHeader } from './researchers/ListHeader';
import { useCompactHeader } from '../hooks/useCompactHeader';
import { ResearcherTable } from './researchers/ResearcherTable';
import { GroupModal } from './researchers/GroupModal';
import { apiErrorText } from '../lib/apiErrors';
import { hasCapability } from '../lib/auth';
import { fetchAffiliationSignals, isProbableDeparture, type AhSignalsByKey } from '../lib/affiliationHistory';

/**
 * Props of the ResearcherList component
 */
interface ResearcherListProps {
  /** Full list of researchers */
  researchers: Researcher[];
  /** List update function (used for groups or merges) */
  setResearchers: React.Dispatch<React.SetStateAction<Researcher[]>>;
  /** Callback when a researcher is selected to view the detail */
  onSelectResearcher: (researcher: Researcher) => void;
  /** Creation of a new record */
  onNewResearcher?: () => void;
  /** Data loading state */
  loading?: boolean;
  /** Callback forcing a manual sync */
  onManualSync?: () => void;
  /** Callback actually running the LDAP sync (regenerates the cache) */
  onOpenDuplicates?: () => void;
  duplicatesCount?: number;
  /** Callback exporting to people.csv (SoVisu+) */
  /** Callback running the IdRef alignment (search = missing, verify = check existing) */
  /** Opens the import workshop for a verified list (manual validation) */
  onImportValidation?: () => void;
  onImportSite?: () => void;
  /** Opens the ORCID or HAL alignment page (search = missing, verify = check existing). */
  /** Opens the merge assistant on two records (Grist row numbers) */
  onMergeResearchers?: (rowIds: [number, number]) => void;
}

/**
 * @component ResearcherList
 * @description Displays the interactive table of research staff.
 * Includes text search, advanced multi-criteria filters,
 * multi-column sorting and bulk actions (group, merge).
 *
 * Split into sub-components on 2026-09-18 (lot 3 of the multi-instance
 * architecture plan, ResearcherList refactor sub-lot — ported from
 * docker/druid-demo/components/ResearcherList.tsx, adapted to the Nantes-specific
 * features: `PÔLE` filter instead of `LOCALISATION`, full Synchroniser menu (LDAP, IdRef
 * Qualinka, ORCID/HAL/OpenAlex, SoVisu+, validation import) under institution rights, ABES
 * export, assisted merge, avatars with photo — see docs/archive/plan-fusion-demo-2026-09.md § 2).
 */
export const ResearcherList: React.FC<ResearcherListProps> = ({
  researchers, setResearchers, onSelectResearcher, onNewResearcher,
  loading = false, onManualSync, onOpenDuplicates, duplicatesCount,
  onImportValidation, onImportSite, onMergeResearchers,
}) => {
  const { t } = useLingui();
  // Career-path signals (docs/plan-parcours-affiliations.md, lot 4): server job only; a failure just
  // hides the « Career path » filter.
  const [parcoursSignals, setParcoursSignals] = useState<AhSignalsByKey | null>(null);
  useEffect(() => {
    if (!hasCapability('HAS_SERVER_JOBS')) return;
    let alive = true;
    fetchAffiliationSignals().then((s) => { if (alive) setParcoursSignals(s); }).catch(() => { /* filter hidden */ });
    return () => { alive = false; };
  }, []);
  const departureKeys = useMemo(
    () => (parcoursSignals ? new Set(Object.entries(parcoursSignals).filter(([, types]) => isProbableDeparture(types)).map(([k]) => k)) : null),
    [parcoursSignals],
  );
  const filters = useResearcherFilters(researchers, parcoursSignals);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  // ABES export / IdRef enrichment (docs/plan-export-abes-idref.md) — on the filtered list.
  const [showAbesExport, setShowAbesExport] = useState(false);

  const isAllSelected =
    filters.sortedResearchers.length > 0 &&
    filters.sortedResearchers.every(r => selectedIds.has(r.id));

  /** Exactly two Grist records selected → mergeable pair, otherwise null. */
  const mergeRowIds: [number, number] | null = (() => {
    if (!onMergeResearchers || selectedIds.size !== 2) return null;
    const ids = researchers.filter((r) => selectedIds.has(r.id)).map((r) => r.gristRowId).filter((n): n is number => typeof n === 'number');
    return ids.length === 2 ? [ids[0], ids[1]] : null;
  })();

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filters.sortedResearchers.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filters.sortedResearchers.forEach(r => next.add(r.id));
        return next;
      });
    }
  };

  /** Confirms the bulk addition to a group — writes to Grist (`groupes` column), not
   * only the local state: otherwise the addition was lost on the next sync/reload (code review lot 7b,
   * same write as GroupList.tsx::persistGroups). */
  const handleConfirmGroupAdd = async (groupName: string) => {
    const prev = researchers;
    const toUpdate = prev.filter((r) => selectedIds.has(r.id) && !r.groups.includes(groupName));
    if (!toUpdate.length) { setSelectedIds(new Set()); setIsGroupModalOpen(false); return; }
    setResearchers((rs) => rs.map((r) => (selectedIds.has(r.id) && !r.groups.includes(groupName) ? { ...r, groups: [...r.groups, groupName] } : r)));
    setSelectedIds(new Set());
    setIsGroupModalOpen(false);
    try {
      await GristService.updateResearcherGroups(
        toUpdate
          .map((r) => ({ gristRowId: r.gristRowId ?? NaN, groups: [...r.groups, groupName] }))
          .filter((u) => u.gristRowId && !Number.isNaN(u.gristRowId)),
      );
    } catch (e) {
      setResearchers(prev);
      window.alert(e instanceof Error ? apiErrorText(e) : t`Error saving groups.`);
    }
  };

  const { compact, onScrollCapture } = useCompactHeader();
  return (
    <div className="flex flex-col h-full relative" onScrollCapture={onScrollCapture}>
      {showAbesExport && (
        <AbesExportModal
          researchers={filters.sortedResearchers}
          onApplyPreset={() => {
            // update* (not the raw setters): they also sync the URL — otherwise a reload or
            // a shared link after the ABES preset lost these filters (code review lot 7b).
            filters.setInternalShortcut(true);   // present + home employer
            filters.updateValidation(['validated', 'stale']);
          }}
          onClose={() => setShowAbesExport(false)}
        />
      )}

      <GroupModal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
        onConfirm={handleConfirmGroupAdd}
        selectedCount={selectedIds.size}
        allGroups={filters.allGroups}
      />

      <ListHeader
        compact={compact}
        count={filters.sortedResearchers.length}
        loading={loading}
        onManualSync={onManualSync}
        onOpenDuplicates={onOpenDuplicates}
        duplicatesCount={duplicatesCount}
        onImportValidation={onImportValidation}
        onImportSite={onImportSite}
        onNewResearcher={onNewResearcher}
        showSyncMenu={showSyncMenu}
        onToggleSyncMenu={() => setShowSyncMenu(v => !v)}
        onCloseSyncMenu={() => setShowSyncMenu(false)}
        sortedResearchers={filters.sortedResearchers}
        onOpenAbesExport={() => setShowAbesExport(true)}
      />

      <div className="px-4 md:px-7 py-4 flex-1 overflow-auto" data-page-scroll>
        {/* List / Dataviz toggle as pills */}
        <div className="inline-flex items-center gap-1 bg-white/70 dark:bg-white/10 backdrop-blur-xl border border-white/70 dark:border-white/15 rounded-full p-1 mb-4">
          {([
            { key: 'list', label: t`List`, Icon: List },
            { key: 'dashboard', label: t`Charts`, Icon: LayoutGrid },
          ] as const).map(({ key, label, Icon }) => {
            const active = filters.viewMode === key;
            return (
              <button
                key={key}
                onClick={() => filters.updateViewMode(key)}
                aria-pressed={active}
                title={key === 'list' ? t`List view (table)` : t`Chart view`}
                className={`flex items-center gap-2 px-5 h-9 rounded-full font-disp font-semibold text-sm transition-colors ${
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

        <FilterPanel
          searchTerm={filters.searchTerm}
          onSearchChange={filters.updateSearch}
          filterPresence={filters.filterPresence}
          onPresenceChange={filters.updatePresence}
          filterLdap={filters.filterLdap}
          onLdapChange={filters.updateLdap}
          onInternalShortcut={filters.setInternalShortcut}
          filterValidation={filters.filterValidation}
          onValidationChange={filters.updateValidation}
          filterEmployers={filters.filterEmployers}
          onEmployerChange={filters.updateEmployers}
          filterLabs={filters.filterLabs}
          onLabChange={filters.updateLabs}
          filterMemberships={filters.filterMemberships}
          onMembershipChange={filters.updateMemberships}
          filterGrades={filters.filterGrades}
          onGradeChange={filters.updateGrades}
          filterContractTypes={filters.filterContractTypes}
          onContractTypeChange={filters.updateContractTypes}
          filterPoles={filters.filterPoles}
          onPoleChange={filters.updatePoles}
          filterParcours={filters.filterParcours}
          onParcoursChange={filters.updateParcours}
          parcoursCount={filters.parcoursCount}
          filterDateStart={filters.filterDateStart}
          filterDateEnd={filters.filterDateEnd}
          onDateStartChange={filters.setFilterDateStart}
          onDateEndChange={filters.setFilterDateEnd}
          idFilters={filters.idFilters}
          onIdFiltersChange={filters.setIdFilters}
          onClearFilters={filters.clearFilters}
          employers={filters.employers}
          labs={filters.labs}
          grades={filters.grades}
          contractTypes={filters.contractTypes}
          poles={filters.poles}
          selectedCount={selectedIds.size}
          onOpenGroupModal={() => setIsGroupModalOpen(true)}
          mergeRowIds={mergeRowIds}
          onMergeResearchers={onMergeResearchers}
        />

        <div className="glass-card overflow-hidden">
          {filters.viewMode === 'list' ? (
            <ResearcherTable
              researchers={filters.paginatedResearchers}
              selectedIds={selectedIds}
              isAllSelected={isAllSelected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onSelectResearcher={onSelectResearcher}
              loading={loading}
              sortedCount={filters.sortedResearchers.length}
              sortConfig={filters.sortConfig}
              onSort={filters.handleSort}
              currentPage={filters.currentPage}
              totalPages={filters.totalPages}
              onPageChange={filters.setCurrentPage}
              departureKeys={departureKeys}
            />
          ) : (
            <ResearcherDashboard researchers={filters.sortedResearchers} />
          )}
        </div>
      </div>
    </div>
  );
};
