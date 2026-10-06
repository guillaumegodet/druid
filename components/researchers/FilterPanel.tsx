import React, { useState } from 'react';
import { Search, Filter, Users, Merge, SlidersHorizontal, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { MEMBERSHIP_TYPES, ResearcherStatus } from '../../types';
import { MultiSelectFilter } from './MultiSelectFilter';
import { MEMBERSHIP_LABELS, STATUS_LABELS } from '../../lib/researcherLabels';
import { MEMBERSHIP_NONE } from '../../lib/membershipFilter';
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
  /** Membership type of the primary affiliation (lib/membershipFilter.ts). */
  filterMemberships: string[];
  onMembershipChange: (vals: string[]) => void;
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
  /** Resets every filter (not the search). */
  onClearFilters: () => void;
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

type Option = { value: string; label: string };

/** Toggle chip of the « More filters » panel (one per option, no nested dropdown). */
const ToggleChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`inline-flex items-center h-7 px-3 rounded-full font-disp font-semibold text-[12px] transition-colors ${
      active
        ? 'bg-accent border border-accent-strong text-ink'
        : 'bg-white/60 dark:bg-white/5 border border-white/70 dark:border-white/10 text-muted dark:text-[#c9c3b5] hover:bg-white/90 dark:hover:bg-white/10'
    }`}
  >
    {children}
  </button>
);

/** Section of the « More filters » panel: caption + toggle chips. */
const ChipGroup: React.FC<{ label: string; options: Option[]; selected: string[]; onChange: (vals: string[]) => void }> = ({ label, options, selected, onChange }) => (
  <div>
    <div className="text-[10.5px] font-bold uppercase tracking-[.07em] text-muted-light dark:text-[#8f897c] mb-1.5">{label}</div>
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <ToggleChip
          key={o.value}
          active={selected.includes(o.value)}
          onClick={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
        >
          {o.label}
        </ToggleChip>
      ))}
    </div>
  </div>
);

const dateInput =
  'h-8 px-3 rounded-full bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[12.5px] font-semibold text-ink dark:text-[#f5f2ea] outline-none focus:border-accent-strong transition-colors dark:[color-scheme:dark]';

const ID_KEYS: (keyof IdFilters)[] = ['orcid', 'hal', 'idref', 'scopus'];
const ID_LABELS: Record<keyof IdFilters, string> = { orcid: 'ORCID', hal: 'HAL', idref: 'IdRef', scopus: 'Scopus' };

/** Search bar + filters of the researcher list — extracted from ResearcherList.tsx
 * (lot 3 of the multi-instance architecture plan, refactor sub-lot ResearcherList).
 * One row of the most used filters; the others sit in a collapsible « More filters » panel,
 * whose active values stay visible as removable chips when it is closed. */
export const FilterPanel: React.FC<FilterPanelProps> = ({
  searchTerm, onSearchChange,
  filterStatuses, onStatusChange,
  filterValidation, onValidationChange,
  filterEmployers, onEmployerChange,
  filterLabs, onLabChange,
  filterMemberships, onMembershipChange,
  filterGrades, onGradeChange,
  filterContractTypes, onContractTypeChange,
  filterPoles, onPoleChange,
  filterParcours = [], onParcoursChange, parcoursCount = null,
  filterDateStart, filterDateEnd, onDateStartChange, onDateEndChange,
  idFilters, onIdFiltersChange,
  onClearFilters,
  employers, labs, grades, contractTypes, poles,
  selectedCount, onOpenGroupModal,
  mergeRowIds, onMergeResearchers,
}) => {
  const { t } = useLingui();
  const [moreOpen, setMoreOpen] = useState(false);
  const { depart: nDepart = 0, depart_confirme: nConfirmed = 0, statut_incoherent: nIncoherent = 0, identifiant_suspect: nSuspect = 0 } = parcoursCount || {};
  const hasStatusValidation = hasCapability('HAS_STATUS_VALIDATION');
  const showParcours = !!parcoursCount && !!onParcoursChange;

  const toOptions = (values: string[]): Option[] => values.map((v) => ({ value: v, label: v }));
  const membershipOptions: Option[] = [
    ...MEMBERSHIP_TYPES.map((m) => ({ value: m, label: t(MEMBERSHIP_LABELS[m]) })),
    { value: MEMBERSHIP_NONE, label: t`Not specified` },
  ];
  const validationOptions: Option[] = [
    { value: 'validated', label: t`Validated` },
    { value: 'stale', label: t`Validated (expired)` },
    { value: 'not_validated', label: t`Not validated` },
  ];
  const parcoursOptions: Option[] = [
    { value: 'depart', label: t`Probable departure (${nDepart})` },
    { value: 'depart_confirme', label: t`Confirmed departure (${nConfirmed})` },
    { value: 'statut_incoherent', label: t`Inconsistent status (${nIncoherent})` },
    { value: 'identifiant_suspect', label: t`Identifiers to check (${nSuspect})` },
  ];
  const idOptions: Option[] = ID_KEYS.map((k) => ({ value: k, label: ID_LABELS[k] }));
  const selectedIds = ID_KEYS.filter((k) => idFilters[k]);
  const setSelectedIds = (vals: string[]) =>
    onIdFiltersChange(Object.fromEntries(ID_KEYS.map((k) => [k, vals.includes(k)])) as unknown as IdFilters);

  // Filters of the « More filters » panel, in display order: one removable chip each when active.
  const labelsOf = (options: Option[], selected: string[]) =>
    selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ');
  const hiddenActive: { key: string; label: string; value: string; clear: () => void }[] = [
    ...(hasStatusValidation && filterValidation.length ? [{ key: 'validation', label: t`Validation`, value: labelsOf(validationOptions, filterValidation), clear: () => onValidationChange([]) }] : []),
    ...(showParcours && filterParcours.length ? [{ key: 'parcours', label: t`Career path`, value: labelsOf(parcoursOptions, filterParcours), clear: () => onParcoursChange!([]) }] : []),
    ...(filterContractTypes.length ? [{ key: 'contract', label: t`Employment type`, value: filterContractTypes.join(', '), clear: () => onContractTypeChange([]) }] : []),
    ...(filterPoles.length ? [{ key: 'pole', label: t`Cluster`, value: filterPoles.join(', '), clear: () => onPoleChange([]) }] : []),
    ...(selectedIds.length ? [{ key: 'ids', label: t`Identifiers`, value: labelsOf(idOptions, selectedIds), clear: () => setSelectedIds([]) }] : []),
    ...(filterDateStart || filterDateEnd ? [{ key: 'period', label: t`Period`, value: `${filterDateStart || '…'} → ${filterDateEnd || '…'}`, clear: () => { onDateStartChange(''); onDateEndChange(''); } }] : []),
  ];
  const anyActive = hiddenActive.length > 0 || filterLabs.length > 0 || filterMemberships.length > 0 ||
    filterEmployers.length > 0 || filterGrades.length > 0 || (hasStatusValidation && filterStatuses.length > 0);

  return (
  <div className="space-y-2.5 mb-4">
    {/* Pill search bar + bulk actions */}
    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-light dark:text-[#8f897c]" />
        <input
          type="text"
          className="w-full h-10 rounded-full bg-white/85 dark:bg-white/10 border border-white/90 dark:border-white/15 pl-11 pr-5 text-[14px] text-ink dark:text-[#f5f2ea] placeholder:text-muted-lighter dark:placeholder:text-[#8f897c] outline-none focus:border-accent-strong focus:ring-2 focus:ring-accent/40 shadow-pixel-sm transition-colors"
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

    {/* Main filters on one row + « More filters » toggle */}
    <div className="flex flex-wrap items-center gap-1.5">
      <Filter className="w-4 h-4 mr-0.5 text-muted-light dark:text-[#8f897c]" />
      <MultiSelectFilter
        label={t`Lab`}
        title={t`Lab of the primary affiliation`}
        options={toOptions(labs)}
        selected={filterLabs}
        onChange={onLabChange}
      />
      <MultiSelectFilter
        label={t`Membership`}
        title={t`Membership type in the lab of the primary affiliation`}
        options={membershipOptions}
        selected={filterMemberships}
        onChange={onMembershipChange}
      />
      {/* Internal/external status: configurable per instance (HAS_STATUS_VALIDATION). */}
      {hasStatusValidation && (
        <MultiSelectFilter
          label={t`Status`}
          options={Object.values(ResearcherStatus).map((s) => ({ value: s, label: t(STATUS_LABELS[s]) }))}
          selected={filterStatuses}
          onChange={onStatusChange}
        />
      )}
      <MultiSelectFilter
        label={t`Employer`}
        options={toOptions(employers)}
        selected={filterEmployers}
        onChange={onEmployerChange}
      />
      <MultiSelectFilter
        label={t`Grade`}
        options={toOptions(grades)}
        selected={filterGrades}
        onChange={onGradeChange}
      />

      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full font-disp font-semibold text-[12.5px] transition-colors border ${
          moreOpen
            ? 'bg-ink text-white border-ink dark:bg-[#f5f2ea] dark:text-ink dark:border-[#f5f2ea]'
            : 'bg-transparent border-ink/15 dark:border-white/20 text-ink dark:text-[#f5f2ea] hover:bg-white/60 dark:hover:bg-white/10'
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        {moreOpen ? <Trans>Fewer filters</Trans> : <Trans>More filters</Trans>}
        {hiddenActive.length > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-ink text-[11px] font-bold inline-flex items-center justify-center">{hiddenActive.length}</span>
        )}
      </button>

      {/* Active values of the closed panel, removable one by one. */}
      {!moreOpen && hiddenActive.map((f) => (
        <span key={f.key} className="inline-flex items-center gap-1 h-7 pl-3 pr-1 rounded-full bg-accent/25 border border-accent-strong/40 text-[12px] font-semibold text-ink dark:text-[#f5f2ea]" title={`${f.label} · ${f.value}`}>
          <span className="text-ink/60 dark:text-[#c9c3b5]">{f.label}</span>
          <span className="truncate max-w-[180px]">· {f.value}</span>
          <button type="button" onClick={f.clear} aria-label={t`Remove the filter ${f.label}`} className="w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-ink/10 dark:hover:bg-white/10">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}

      {anyActive && (
        <button type="button" onClick={onClearFilters} className="h-8 px-2 text-[12.5px] font-semibold text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] underline-offset-2 hover:underline">
          <Trans>Clear all</Trans>
        </button>
      )}
    </div>

    {/* « More filters » panel: secondary filters as toggle chips */}
    {moreOpen && (
      <div className="rounded-2xl bg-white/55 dark:bg-white/5 border border-white/70 dark:border-white/10 p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {hasStatusValidation && (
          <ChipGroup label={t`Validation`} options={validationOptions} selected={filterValidation} onChange={onValidationChange} />
        )}
        {showParcours && (
          <ChipGroup label={t`Career path`} options={parcoursOptions} selected={filterParcours} onChange={onParcoursChange!} />
        )}
        <ChipGroup label={t`Employment type`} options={toOptions(contractTypes)} selected={filterContractTypes} onChange={onContractTypeChange} />
        <ChipGroup label={t`Cluster`} options={toOptions(poles)} selected={filterPoles} onChange={onPoleChange} />
        <ChipGroup label={t`Identifiers present`} options={idOptions} selected={selectedIds} onChange={setSelectedIds} />
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[.07em] text-muted-light dark:text-[#8f897c] mb-1.5"><Trans>Employment period</Trans></div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="date" aria-label={t`Start of the period`} value={filterDateStart} onChange={e => onDateStartChange(e.target.value)} className={dateInput} />
            <span className="text-muted-faint dark:text-[#8f897c]">→</span>
            <input type="date" aria-label={t`End of the period`} value={filterDateEnd} onChange={e => onDateEndChange(e.target.value)} className={dateInput} />
          </div>
        </div>
      </div>
    )}
  </div>
  );
};
