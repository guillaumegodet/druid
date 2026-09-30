import React from 'react';
import { Search, Filter, Users, Merge } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { ResearcherStatus } from '../../types';
import { MultiSelectFilter } from './MultiSelectFilter';
import { STATUS_LABELS } from '../../lib/researcherLabels';
import type { IdFilters } from '../../hooks/useResearcherFilters';
import { canWrite, hasCapability } from '../../lib/auth';

interface FilterPanelProps {
  searchTerm: string;
  onSearchChange: (val: string) => void;
  filterStatuses: string[];
  onStatusChange: (vals: string[]) => void;
  filterValidation: string[];
  onValidationChange: (vals: string[]) => void;
  filterEmployers: string[];
  onEmployerChange: (vals: string[]) => void;
  filterLabs: string[];
  onLabChange: (vals: string[]) => void;
  filterGrades: string[];
  onGradeChange: (vals: string[]) => void;
  filterContractTypes: string[];
  onContractTypeChange: (vals: string[]) => void;
  filterPoles: string[];
  onPoleChange: (vals: string[]) => void;
  /** « Career path » filter (docs/plan-parcours-affiliations.md, lot 4); counts null = hidden. */
  filterParcours?: string[];
  onParcoursChange?: (vals: string[]) => void;
  parcoursCount?: Record<string, number> | null;
  filterDateStart: string;
  filterDateEnd: string;
  onDateStartChange: (val: string) => void;
  onDateEndChange: (val: string) => void;
  idFilters: IdFilters;
  onIdFiltersChange: (filters: IdFilters) => void;
  employers: string[];
  labs: string[];
  grades: string[];
  contractTypes: string[];
  poles: string[];
  selectedCount: number;
  onOpenGroupModal: () => void;
  /** Assisted merge (docs/archive/plan-fusion-doublons.md, lot 2): exactly two Grist records
   * selected — null if the selection does not lend itself to it (button disabled). */
  mergeRowIds: [number, number] | null;
  onMergeResearchers?: (rowIds: [number, number]) => void;
}

/** Inactive identifier filter pill. */
const idPillOff =
  'bg-white/60 dark:bg-white/5 border border-white/70 dark:border-white/10 text-muted-light dark:text-[#8f897c] hover:bg-white/90 dark:hover:bg-white/10';
/** Common base of the identifier filter pills. */
const idPillBase = 'inline-flex items-center gap-1.5 h-10 px-4 rounded-full font-disp font-semibold text-[13px] transition-colors';

/** Search bar + filters of the researcher list — extracted from ResearcherList.tsx
 * (lot 3 of the multi-instance architecture plan, refactor sub-lot ResearcherList). */
export const FilterPanel: React.FC<FilterPanelProps> = ({
  searchTerm, onSearchChange,
  filterStatuses, onStatusChange,
  filterValidation, onValidationChange,
  filterEmployers, onEmployerChange,
  filterLabs, onLabChange,
  filterGrades, onGradeChange,
  filterContractTypes, onContractTypeChange,
  filterPoles, onPoleChange,
  filterParcours = [], onParcoursChange, parcoursCount = null,
  filterDateStart, filterDateEnd, onDateStartChange, onDateEndChange,
  idFilters, onIdFiltersChange,
  employers, labs, grades, contractTypes, poles,
  selectedCount, onOpenGroupModal,
  mergeRowIds, onMergeResearchers,
}) => {
  const { t } = useLingui();
  const { depart: nDepart = 0, depart_confirme: nConfirmed = 0, statut_incoherent: nIncoherent = 0, identifiant_suspect: nSuspect = 0 } = parcoursCount || {};
  return (
  <div className="space-y-3 mb-4">
    {/* Pill search bar + bulk actions */}
    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-light dark:text-[#8f897c]" />
        <input
          type="text"
          className="w-full h-12 rounded-full bg-white/85 dark:bg-white/10 border border-white/90 dark:border-white/15 pl-12 pr-5 text-[15px] text-ink dark:text-[#f5f2ea] placeholder:text-muted-lighter dark:placeholder:text-[#8f897c] outline-none focus:border-accent-strong focus:ring-2 focus:ring-accent/40 shadow-pixel-sm transition-colors"
          placeholder={t`Search for a researcher, a lab, an identifier…`}
          value={searchTerm}
          onChange={e => onSearchChange(e.target.value)}
        />
      </div>
      {/* Bulk actions write to Grist (groups, merge): none on a read-only instance. */}
      {selectedCount > 0 && canWrite() && (
        <div className="flex items-center gap-2.5">
          <button onClick={onOpenGroupModal} className="btn-pill h-10">
            <Users className="w-3.5 h-3.5" /> <Trans>Group</Trans>
          </button>
          <button
            disabled={!mergeRowIds}
            onClick={() => mergeRowIds && onMergeResearchers?.(mergeRowIds)}
            title={mergeRowIds ? t`Merge the two selected records` : t`Select exactly two Grist records to merge`}
            className={`btn-pill h-10 ${mergeRowIds ? '' : 'opacity-50 cursor-not-allowed'}`}
          >
            <Merge className="w-3.5 h-3.5" /> <Trans context="noun">Merge</Trans>
          </button>
        </div>
      )}
    </div>

    {/* Pill filters */}
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="w-4 h-4 text-muted-light dark:text-[#8f897c]" />

      {/* Internal/external status + validation: configurable per instance (HAS_STATUS_VALIDATION). */}
      {hasCapability('HAS_STATUS_VALIDATION') && (
        <>
          <MultiSelectFilter
            label={t`STATUS`}
            options={Object.values(ResearcherStatus).map((s) => ({ value: s, label: t(STATUS_LABELS[s]).toUpperCase() }))}
            selected={filterStatuses}
            onChange={onStatusChange}
          />
          <MultiSelectFilter
            label={t`VALIDATION`}
            options={[
              { value: 'validated',     label: t`VALIDATED` },
              { value: 'stale',         label: t`VALIDATED (EXPIRED)` },
              { value: 'not_validated', label: t`NOT VALIDATED` },
            ]}
            selected={filterValidation}
            onChange={onValidationChange}
          />
        </>
      )}
      {parcoursCount && onParcoursChange && (
        <MultiSelectFilter
          label={t`CAREER PATH`}
          options={[
            { value: 'depart', label: t`PROBABLE DEPARTURE (${nDepart})` },
            { value: 'depart_confirme', label: t`CONFIRMED DEPARTURE (${nConfirmed})` },
            { value: 'statut_incoherent', label: t`INCONSISTENT STATUS (${nIncoherent})` },
            { value: 'identifiant_suspect', label: t`IDENTIFIERS TO CHECK (${nSuspect})` },
          ]}
          selected={filterParcours}
          onChange={onParcoursChange}
        />
      )}
      <MultiSelectFilter
        label={t`EMPLOYER`}
        options={employers.map(e => ({ value: e, label: e }))}
        selected={filterEmployers}
        onChange={onEmployerChange}
      />
      <MultiSelectFilter
        label={t`LAB (PRIMARY AFFIL.)`}
        options={labs.map(l => ({ value: l, label: l }))}
        selected={filterLabs}
        onChange={onLabChange}
      />
      <MultiSelectFilter
        label={t`GRADE / RANK`}
        options={grades.map(g => ({ value: g, label: g }))}
        selected={filterGrades}
        onChange={onGradeChange}
      />
      <MultiSelectFilter
        label={t`EMPLOYMENT TYPE`}
        options={contractTypes.map(c => ({ value: c, label: c }))}
        selected={filterContractTypes}
        onChange={onContractTypeChange}
      />
      <MultiSelectFilter
        label={t`CLUSTER`}
        options={poles.map(p => ({ value: p, label: p }))}
        selected={filterPoles}
        onChange={onPoleChange}
      />
    </div>

    {/* Identifier filters + period */}
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[.06em] text-muted-light dark:text-[#8f897c] mr-1"><Trans>Identifiers:</Trans></span>

        <label className="cursor-pointer">
          <input type="checkbox" checked={idFilters.orcid} onChange={e => onIdFiltersChange({ ...idFilters, orcid: e.target.checked })} className="hidden" />
          <span className={`${idPillBase} ${idFilters.orcid ? 'bg-orcid text-ink border border-orcid' : idPillOff}`}>
            iD ORCID
          </span>
        </label>

        <label className="cursor-pointer">
          <input type="checkbox" checked={idFilters.hal} onChange={e => onIdFiltersChange({ ...idFilters, hal: e.target.checked })} className="hidden" />
          <span className={`${idPillBase} ${idFilters.hal ? 'bg-ink text-white border border-ink dark:bg-[#f5f2ea] dark:text-ink dark:border-[#f5f2ea]' : idPillOff}`}>
            HAL
          </span>
        </label>

        <label className="cursor-pointer">
          <input type="checkbox" checked={idFilters.idref} onChange={e => onIdFiltersChange({ ...idFilters, idref: e.target.checked })} className="hidden" />
          <span className={`${idPillBase} ${idFilters.idref ? 'bg-accent border border-accent-strong text-ink' : idPillOff}`}>
            IdRef
          </span>
        </label>

        <label className="cursor-pointer">
          <input type="checkbox" checked={idFilters.scopus} onChange={e => onIdFiltersChange({ ...idFilters, scopus: e.target.checked })} className="hidden" />
          <span className={`${idPillBase} ${idFilters.scopus ? 'bg-scopus text-white border border-scopus' : idPillOff}`}>
            Scopus
          </span>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[.06em] text-muted-light dark:text-[#8f897c]"><Trans>Dates:</Trans></span>
        <input
          type="date"
          value={filterDateStart}
          onChange={e => onDateStartChange(e.target.value)}
          className="h-10 px-4 rounded-full bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] outline-none focus:border-accent-strong transition-colors dark:[color-scheme:dark]"
        />
        <span className="text-muted-faint dark:text-[#8f897c]">→</span>
        <input
          type="date"
          value={filterDateEnd}
          onChange={e => onDateEndChange(e.target.value)}
          className="h-10 px-4 rounded-full bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] outline-none focus:border-accent-strong transition-colors dark:[color-scheme:dark]"
        />
      </div>
    </div>
  </div>
  );
};
