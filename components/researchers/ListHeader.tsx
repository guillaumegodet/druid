import React from 'react';
import {
  CheckCircle, RefreshCw, FileDown, ClipboardList, Plus, Globe,
} from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Researcher, ViewState } from '../../types';
import { ExportService } from '../../lib/exportService';
import { canUseEstablishmentTools, hasRole } from '../../lib/auth';
import { HelpButton } from '../HelpButton';
import { VIEW_HELP } from '../../lib/helpLinks';

/** Item of the dropdown menus (export / synchronization). */
const menuItem =
  'w-full text-left px-3.5 py-2.5 rounded-xl text-[13px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-accent/10 flex items-center gap-2 transition-colors';

interface ListHeaderProps {
  count: number;
  /** Reduced banner (page scrolled) — see hooks/useCompactHeader.ts. */
  compact?: boolean;
  loading: boolean;
  onManualSync?: () => void;
  /** « À traiter » section (duplicates + tasks outside Druid) — pill with counter next to
   * « Nouveau »; n = pending duplicates + open tasks. */
  onOpenDuplicates?: () => void;
  duplicatesCount?: number;
  onImportValidation?: () => void;
  /** Import of a lab website directory (lot 8 d): institution right, writable instance. */
  onImportSite?: () => void;
  onNewResearcher?: () => void;
  showSyncMenu: boolean;
  onToggleSyncMenu: () => void;
  onCloseSyncMenu: () => void;
  sortedResearchers: Researcher[];
  onOpenAbesExport: () => void;
}

/** Header (title + `Export`/`Synchroniser`/`Nouveau` actions) of the researcher list — extracted from
 * ResearcherList.tsx (lot 3 of the multi-instance architecture plan, refactor sub-lot
 * ResearcherList). */
export const ListHeader: React.FC<ListHeaderProps> = ({
  count, compact, loading, onManualSync, onImportValidation, onImportSite, onOpenDuplicates, duplicatesCount = 0,
  onNewResearcher, showSyncMenu, onToggleSyncMenu, onCloseSyncMenu, sortedResearchers, onOpenAbesExport,
}) => {
  const { t } = useLingui();

  const exportRows = () =>
    sortedResearchers.map(r => ({
      [t`Name`]: r.displayName,
      [t`Email`]: r.email,
      [t`Status`]: r.status,
      [t`Lab`]: r.affiliations[0]?.structureName || '',
    }));

  return (
    <header className="page-header px-4 md:px-7 pt-6 pb-2 flex flex-col md:flex-row md:items-end justify-between gap-4" data-compact={compact || undefined}>
      <div>
        <div className="flex items-center gap-3.5 flex-wrap">
          <h2 className="font-disp text-3xl md:text-[38px] font-bold tracking-tight text-ink dark:text-[#f5f2ea]">
            <Trans>Research staff</Trans>
          </h2>
          <span className="count-badge">{count}</span>
          <HelpButton path={VIEW_HELP[ViewState.RESEARCHERS_LIST]} />
        </div>
        <p className="page-header-sub text-[15px] text-muted dark:text-[#8f897c] mt-1">
          <Trans>Management and validation of researcher identities</Trans>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative group/export">
          <button className="btn-pill">
            <FileDown className="w-4 h-4" /> <Trans>Export</Trans>
          </button>
          <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-cream-100 dark:bg-[#201e1a] border border-white/60 dark:border-white/10 shadow-soft-lg z-20 p-1.5 opacity-0 invisible group-hover/export:opacity-100 group-hover/export:visible transition-all">
             <button onClick={() => ExportService.exportToCSV(exportRows(), 'chercheurs_druid')} className={menuItem}>
               CSV
             </button>
             <button onClick={() => ExportService.exportToExcel(exportRows(), 'chercheurs_druid')} className={menuItem}>
               Excel (.xlsx)
             </button>
             <button onClick={() => ExportService.exportResearchersPDF(sortedResearchers)} className={menuItem}>
               PDF
             </button>
             <div className="my-1 border-t border-ink/10 dark:border-white/10" />
             <button
              onClick={onOpenAbesExport}
              className={menuItem}
              title={t`Identifiers, affiliations and notes missing from IdRef records, for ABES`}
             >
               <Trans>ABES export (IdRef)</Trans>
             </button>
          </div>
        </div>
        {/* Synchronize menu: institution-wide operations (Grist, LDAP, alignments) —
            admin role AND institution right (hidden for a lab director/manager). */}
        {hasRole('admin') && canUseEstablishmentTools() && (
          <>
            <div className="relative">
              <button onClick={onToggleSyncMenu} className="btn-pill">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <Trans>Synchronise</Trans>
              </button>
              {showSyncMenu && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-cream-100 dark:bg-[#201e1a] border border-white/60 dark:border-white/10 shadow-soft-lg z-20 p-1.5">
                  <button onClick={() => { onCloseSyncMenu(); onManualSync?.(); }} className={menuItem}>
                    <RefreshCw className={`w-4 h-4 text-muted-light dark:text-[#8f897c] ${loading ? 'animate-spin' : ''}`} />
                    <Trans>Force Grist refresh</Trans>
                  </button>
                  {/* Two entries only (docs/archive/plan-reorganisation-sync-ldap.md): alignments
                      are in « Outils d'alignement », duplicates and tasks in the « À traiter » section (pill
                      below), the SoVisu+ export in Administration. */}
                  {onImportValidation && (
                    <button onClick={() => { onCloseSyncMenu(); onImportValidation(); }} className={menuItem}>
                      <CheckCircle className="w-4 h-4 text-[#1f7a4d] dark:text-[#5fd39a]" />
                      <Trans>Import a validated list</Trans>
                    </button>
                  )}
                  {onImportSite && (
                    <button onClick={() => { onCloseSyncMenu(); onImportSite(); }} className={menuItem}>
                      <Globe className="w-4 h-4 text-muted-light dark:text-[#8f897c]" />
                      <Trans>Import a lab website directory</Trans>
                    </button>
                  )}
                </div>
              )}
            </div>
            {onOpenDuplicates && (
              <button onClick={onOpenDuplicates} className="btn-pill" title={t`Duplicates to merge or qualify, and tasks to carry out outside Druid (IdRef, ORCID, HAL…)`}>
                <ClipboardList className={`w-4 h-4 ${duplicatesCount > 0 ? 'text-[#b23b3b] dark:text-[#f08c8c]' : 'text-muted-light dark:text-[#8f897c]'}`} />
                <Trans>To process</Trans>
                {duplicatesCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[rgba(231,111,154,.2)] text-[#b23b3b] dark:text-[#f08c8c] text-[11px] font-bold">{duplicatesCount}</span>}
              </button>
            )}
            {onNewResearcher && (
              <button onClick={onNewResearcher} className="btn-pill-dark">
                <Plus className="w-4 h-4" /> <Trans>New</Trans>
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
};
