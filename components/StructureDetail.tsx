import React, { useState } from 'react';
import { ArrowLeft, Save, ExternalLink, RefreshCw, BarChart3 } from 'lucide-react';
import { Structure, ViewState } from '../types';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

// Sub-components
import { IdentificationTab } from './structures/IdentificationTab';
import { IdentifiersTab } from './structures/IdentifiersTab';
import { ClassificationTab } from './structures/ClassificationTab';
import { GovernanceTab } from './structures/GovernanceTab';
import { indexByLocalId, parentFromInclusions } from '../lib/structureHierarchy';
import { LifecycleTab } from './structures/LifecycleTab';
import { HelpButton } from './HelpButton';
import { VIEW_HELP } from '../lib/helpLinks';

interface StructureDetailProps {
  structure: Structure;
  /** All structures (for the selector of participations in other research structures) */
  allStructures?: Structure[];
  onBack: () => void;
  onSave?: (updated: Structure) => void;
  isSaving?: boolean;
  /** druid-biblio slug if this structure has a bibliometric dashboard */
  dashboardSlug?: string | null;
  /** Opens the « Tableau de bord » section preselected on this slug */
  onOpenDashboard?: (slug: string) => void;
  /** « Nouvelle structure » page: editable level, « Créer » button, no dashboard. */
  isNew?: boolean;
}

enum Tab {
  GENERAL = 'general',
  IDENTIFIERS = 'identifiers',
  CLASSIFICATION = 'classification',
  GOVERNANCE = 'governance',
  LIFECYCLE = 'lifecycle',
}

const TAB_LABELS: Record<Tab, MessageDescriptor> = {
  [Tab.GENERAL]: msg`Identification`,
  [Tab.IDENTIFIERS]: msg`Identifiers & links`,
  [Tab.CLASSIFICATION]: msg`Missions & topics`,
  [Tab.GOVERNANCE]: msg`Memberships`,
  // Ported from docker/druid-demo (lot 3) on 2026-09-18 — not connected to Grist, see
  // LifecycleTab.tsx and docs/archive/plan-fusion-demo-2026-09.md.
  [Tab.LIFECYCLE]: msg`Lifecycle and lineage`,
};

export const StructureDetail: React.FC<StructureDetailProps> = ({ structure, allStructures = [], onBack, onSave, isSaving = false, dashboardSlug, onOpenDashboard, isNew = false }) => {
  const { t } = useLingui();
  const [activeTab, setActiveTab] = useState<Tab>(Tab.GENERAL);
  const [localStructure, setLocalStructure] = useState<Structure>({ ...structure });

  const handleSave = () => {
    if (onSave) {
      onSave(localStructure);
    }
  };

  const updateField = (field: keyof Structure, value: any) => {
    setLocalStructure(prev => {
      const next = { ...prev, [field]: value };
      // The hierarchical parent follows the inclusions (lib/structureHierarchy.ts); the
      // previous value stays as fallback while no inclusion resolves.
      if (field === 'inclusions' || field === 'level') {
        next.parentStructure = parentFromInclusions(next, indexByLocalId(allStructures)) || prev.parentStructure;
      }
      return next;
    });
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case Tab.GENERAL:
        return <IdentificationTab structure={localStructure} onUpdateField={updateField} isNew={isNew} onOpenMemberships={() => setActiveTab(Tab.GOVERNANCE)} />;
      case Tab.IDENTIFIERS:
        return <IdentifiersTab structure={localStructure} onUpdateField={updateField} />;
      case Tab.CLASSIFICATION:
        return <ClassificationTab structure={localStructure} onUpdateField={updateField} />;
      case Tab.GOVERNANCE:
        return <GovernanceTab structure={localStructure} allStructures={allStructures} onUpdateField={updateField} />;
      case Tab.LIFECYCLE:
        return <LifecycleTab structure={localStructure} onUpdateField={updateField} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      <header className="px-4 md:px-7 pt-5 pb-2 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} disabled={isSaving} className="w-11 h-11 shrink-0 rounded-full bg-white/80 dark:bg-white/10 border border-white/90 dark:border-white/15 flex items-center justify-center text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors disabled:opacity-50">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-disp text-2xl md:text-3xl font-bold tracking-tight text-ink dark:text-[#f5f2ea]">{localStructure.acronym || (isNew ? t`New structure` : '')}</h2>
              <span className="inline-flex items-center h-7 px-3 rounded-full bg-accent/25 dark:bg-accent/15 text-ink dark:text-accent text-xs font-bold">{localStructure.type || '—'}</span>
            </div>
            <p className="text-[14px] text-muted dark:text-[#8f897c] mt-0.5 truncate">
               {localStructure.officialName}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
            <HelpButton path={VIEW_HELP[ViewState.STRUCTURE_DETAIL]} pill />
            {!isNew && dashboardSlug && onOpenDashboard && (
              <button
                onClick={() => onOpenDashboard(dashboardSlug)}
                title={t`Open this structure's bibliometric dashboard`}
                className="btn-pill"
              >
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline"><Trans>Dashboard</Trans></span>
              </button>
            )}
            {localStructure.website && (
              <a
                href={localStructure.website}
                target="_blank"
                rel="noreferrer"
                className="btn-pill"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline"><Trans>Website</Trans></span>
              </a>
            )}
            {onSave && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="btn-pill-dark disabled:opacity-50"
              >
                 {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                 {isSaving ? t({ message: `Saving…`, context: "in progress" }) : isNew ? t`Create` : t`Save`}
              </button>
            )}
        </div>
      </header>

      <div className="px-4 md:px-7 py-4 flex-1 overflow-auto">
         <div className="inline-flex max-w-full items-center gap-1 p-1.5 rounded-full bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 shadow-soft mb-5 overflow-x-auto">
           {Object.values(Tab).map((tab) => (
             <button
               key={tab}
               onClick={() => setActiveTab(tab)}
               className={`px-5 py-2 rounded-full font-disp font-semibold text-sm whitespace-nowrap transition-colors ${
                 activeTab === tab
                 ? 'bg-ink text-white dark:bg-accent dark:text-ink shadow-nav-active'
                 : 'text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]'
               }`}
             >
               {t(TAB_LABELS[tab])}
             </button>
           ))}
        </div>

        <div className="glass-card min-h-[500px] p-6 md:p-9">
           {renderTabContent()}
        </div>
      </div>
    </div>
  );
};
