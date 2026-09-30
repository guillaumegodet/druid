import { useState, useMemo, useEffect } from 'react';
import { affiliationHistoryKey, matchesParcoursFilter, parcoursCounts, type AhSignalsByKey } from '../lib/affiliationHistory';
import { Researcher } from '../types';
import { isValidationStale } from '../lib/validation';
import { POLE_LAB_MAPPING, getPoleFromLab } from '../lib/mappings';
import { useUrlState } from './useUrlState';
import { fuzzyDateLowerBound, fuzzyDateUpperBound } from '../lib/dates';

export type SortKey = 'displayName' | 'status' | 'employer' | 'structureName' | 'team';

export interface SortConfig {
  key: SortKey;
  direction: 'asc' | 'desc';
}

export interface IdFilters {
  orcid: boolean;
  hal: boolean;
  idref: boolean;
  scopus: boolean;
}

const PAGE_SIZE = 50;

/**
 * Centralizes all the filtering, sorting and pagination logic of the researcher list.
 * Keeps the filters and the display mode in sync with the URL parameters. Ported from
 * docker/druid-demo/hooks/useResearcherFilters.ts (lot 3 of the multi-instance
 * architecture plan, ResearcherList refactor sub-lot) — adapted on two points where Nantes
 * deliberately diverges:
 *  - « PÔLE » filter (POLE_LAB_MAPPING, Nantes Université scientific grouping) instead of
 *    the demo's « LOCALISATION » filter (Researcher.extra.location, a field that does not
 *    exist on the Nantes side);
 *  - `matchesLab`/`labs` on the PRIMARY affiliation only, as the filter label announces
 *    (« AFFIL. PRINCIPALE ») — the demo matches on any affiliation, a regression fixed on
 *    the Nantes side in review lot 7b (docs/archive/plan-code-review.md).
 */
/** `parcoursSignals`: signals of the career-path job per record key (null = not available on this
 * instance, the « Career path » filter is hidden). */
export function useResearcherFilters(researchers: Researcher[], parcoursSignals: AhSignalsByKey | null = null) {
  // Pole enrichment (derived from the primary lab when missing in Grist) — done here rather
  // than in the calling component so the PÔLE filter and its sort work on the same data.
  const enrichedResearchers = useMemo(() => researchers.map(r => {
    const primaryLab = r.affiliations.find(a => a.isPrimary)?.structureName || r.affiliations[0]?.structureName || '';
    const calculatedPole = getPoleFromLab(primaryLab);
    return { ...r, nuFields: { ...r.nuFields, pole: r.nuFields?.pole || calculatedPole } };
  }), [researchers]);

  const [viewMode, setViewMode] = useState<'list' | 'dashboard'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterValidation, setFilterValidation] = useState<string[]>([]);
  const [filterEmployers, setFilterEmployers] = useState<string[]>([]);
  const [filterLabs, setFilterLabs] = useState<string[]>([]);
  const [filterGrades, setFilterGrades] = useState<string[]>([]);
  const [filterContractTypes, setFilterContractTypes] = useState<string[]>([]);
  const [filterPoles, setFilterPoles] = useState<string[]>([]);
  const [filterParcours, setFilterParcours] = useState<string[]>([]);
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');
  const [idFilters, setIdFilters] = useState<IdFilters>({ orcid: false, hal: false, idref: false, scopus: false });
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const splitFilter = (v: string) => (v ? v.split(',').filter(Boolean) : []);

  const { setUrlState } = useUrlState(
    { search: '', status: '', validation: '', employer: '', lab: '', grade: '', contractType: '', pole: '', parcours: '', mode: 'list' },
    (newState) => {
      if (newState.search !== undefined) setSearchTerm(newState.search || '');
      if (newState.status !== undefined) setFilterStatuses(splitFilter(newState.status || ''));
      if (newState.validation !== undefined) setFilterValidation(splitFilter(newState.validation || ''));
      if (newState.employer !== undefined) setFilterEmployers(splitFilter(newState.employer || ''));
      if (newState.lab !== undefined) setFilterLabs(splitFilter(newState.lab || ''));
      if (newState.grade !== undefined) setFilterGrades(splitFilter(newState.grade || ''));
      if (newState.contractType !== undefined) setFilterContractTypes(splitFilter(newState.contractType || ''));
      if (newState.pole !== undefined) setFilterPoles(splitFilter(newState.pole || ''));
      if (newState.parcours !== undefined) setFilterParcours(splitFilter(newState.parcours || ''));
      if (newState.mode !== undefined) setViewMode((newState.mode as 'list' | 'dashboard') || 'list');
    }
  );

  const employers = useMemo(
    () => Array.from(new Set(enrichedResearchers.map(r => r.employment.employer).filter(Boolean))),
    [enrichedResearchers]
  );
  // PRIMARY affiliation only (see the filter label « LABO (AFFIL. PRINCIPALE) »): also listing
  // the secondary labs here would offer a filter that matchesLab cannot honor the same way
  // (review lot 7b).
  const labs = useMemo(
    () => Array.from(new Set(enrichedResearchers.map(r => r.affiliations.find(a => a.isPrimary)?.structureName).filter(Boolean))) as string[],
    [enrichedResearchers]
  );
  const grades = useMemo(
    () => Array.from(new Set(enrichedResearchers.map(r => r.employment.grade).filter(Boolean))).sort() as string[],
    [enrichedResearchers]
  );
  const contractTypes = useMemo(
    () => Array.from(new Set(enrichedResearchers.map(r => r.employment.contractType).filter(Boolean))).sort() as string[],
    [enrichedResearchers]
  );
  const poles = useMemo(() => Object.keys(POLE_LAB_MAPPING), []);
  const allGroups = useMemo(
    () => Array.from(new Set(enrichedResearchers.flatMap(r => r.groups))).sort(),
    [enrichedResearchers]
  );

  const now = useMemo(() => new Date(), []);

  const matchesValidationFilter = (r: Researcher): boolean => {
    if (filterValidation.length === 0) return true;
    const validated = !!r.validation?.validated;
    const stale = validated && isValidationStale(r.validation, now);
    return filterValidation.some((f) => {
      if (f === 'validated') return validated && !stale;
      if (f === 'not_validated') return !validated;
      if (f === 'stale') return stale;
      return false;
    });
  };

  const filteredResearchers = useMemo(() => enrichedResearchers.filter(r => {
    const primaryLab = r.affiliations.find(a => a.isPrimary)?.structureName || '';
    const matchesSearch =
      r.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      primaryLab.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatuses.length === 0 || filterStatuses.includes(r.status);
    const matchesValidation = matchesValidationFilter(r);
    const matchesEmployer = filterEmployers.length === 0 || filterEmployers.includes(r.employment.employer);
    const matchesLab = filterLabs.length === 0 || filterLabs.includes(primaryLab);
    const matchesGrade = filterGrades.length === 0 || filterGrades.includes(r.employment.grade || '');
    const matchesContractType = filterContractTypes.length === 0 || filterContractTypes.includes(r.employment.contractType || '');
    const matchesPole = filterPoles.length === 0 || filterPoles.includes(r.nuFields?.pole || '');
    // Fuzzy dates (lib/dates.ts): compare on the period bounds so `2026` overlaps the whole year.
    const researcherArrival = fuzzyDateLowerBound(r.employment.startDate) || r.employment.startDate;
    const researcherDeparture = fuzzyDateUpperBound(r.employment.endDate) || r.employment.endDate;
    const matchesPeriod =
      (!filterDateStart || !researcherDeparture || researcherDeparture >= filterDateStart) &&
      (!filterDateEnd || !researcherArrival || researcherArrival <= filterDateEnd);
    const matchesIds =
      (!idFilters.orcid || !!r.identifiers.orcid) &&
      (!idFilters.hal || !!r.identifiers.halId) &&
      (!idFilters.idref || !!r.identifiers.idref) &&
      (!idFilters.scopus || !!r.identifiers.scopusId);
    const key = affiliationHistoryKey(r);
    const matchesParcours = !parcoursSignals || matchesParcoursFilter(key ? parcoursSignals[key] : undefined, filterParcours);
    return matchesSearch && matchesStatus && matchesValidation && matchesEmployer && matchesLab && matchesGrade &&
      matchesContractType && matchesPole && matchesPeriod && matchesIds && matchesParcours;
  }), [enrichedResearchers, searchTerm, filterStatuses, filterValidation, filterEmployers, filterLabs, filterGrades, filterContractTypes, filterPoles, filterDateStart, filterDateEnd, idFilters, now, parcoursSignals, filterParcours]);

  // Counter of the « Career path » filter options, over every record of the list (not the filtered ones).
  const parcoursCount = useMemo(
    () => (parcoursSignals ? parcoursCounts(parcoursSignals, enrichedResearchers.map((r) => affiliationHistoryKey(r))) : null),
    [parcoursSignals, enrichedResearchers],
  );

  const sortedResearchers = useMemo(() => {
    if (!sortConfig) return filteredResearchers;
    return [...filteredResearchers].sort((a, b) => {
      let aVal = '';
      let bVal = '';
      switch (sortConfig.key) {
        case 'displayName': aVal = a.displayName; bVal = b.displayName; break;
        case 'status': aVal = a.status; bVal = b.status; break;
        case 'employer': aVal = a.employment.employer; bVal = b.employment.employer; break;
        case 'structureName':
          aVal = a.affiliations.find(aff => aff.isPrimary)?.structureName || '';
          bVal = b.affiliations.find(aff => aff.isPrimary)?.structureName || '';
          break;
        case 'team':
          aVal = a.affiliations.find(aff => aff.isPrimary)?.team || '';
          bVal = b.affiliations.find(aff => aff.isPrimary)?.team || '';
          break;
        default: return 0;
      }
      return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [filteredResearchers, sortConfig]);

  const paginatedResearchers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedResearchers.slice(start, start + PAGE_SIZE);
  }, [sortedResearchers, currentPage]);

  const totalPages = Math.ceil(sortedResearchers.length / PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatuses, filterValidation, filterEmployers, filterLabs, filterGrades, filterContractTypes, filterPoles, filterDateStart, filterDateEnd, filterParcours]);

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const updateSearch = (val: string) => { setSearchTerm(val); setUrlState({ search: val }); };
  const updateStatuses = (vals: string[]) => { setFilterStatuses(vals); setUrlState({ status: vals.join(',') }); };
  const updateValidation = (vals: string[]) => { setFilterValidation(vals); setUrlState({ validation: vals.join(',') }); };
  const updateEmployers = (vals: string[]) => { setFilterEmployers(vals); setUrlState({ employer: vals.join(',') }); };
  const updateLabs = (vals: string[]) => { setFilterLabs(vals); setUrlState({ lab: vals.join(',') }); };
  const updateGrades = (vals: string[]) => { setFilterGrades(vals); setUrlState({ grade: vals.join(',') }); };
  const updateContractTypes = (vals: string[]) => { setFilterContractTypes(vals); setUrlState({ contractType: vals.join(',') }); };
  const updatePoles = (vals: string[]) => { setFilterPoles(vals); setUrlState({ pole: vals.join(',') }); };
  const updateParcours = (vals: string[]) => { setFilterParcours(vals); setUrlState({ parcours: vals.join(',') }); };
  const updateViewMode = (val: 'list' | 'dashboard') => { setViewMode(val); setUrlState({ mode: val }); };

  return {
    viewMode, updateViewMode,
    searchTerm, updateSearch,
    filterStatuses, updateStatuses,
    filterValidation, updateValidation,
    filterEmployers, updateEmployers,
    filterLabs, updateLabs,
    filterGrades, updateGrades,
    filterContractTypes, updateContractTypes,
    filterPoles, updatePoles,
    filterParcours, updateParcours, parcoursCount,
    filterDateStart, setFilterDateStart,
    filterDateEnd, setFilterDateEnd,
    idFilters, setIdFilters,
    employers, labs, grades, contractTypes, poles, allGroups,
    sortedResearchers, paginatedResearchers, totalPages,
    sortConfig, handleSort,
    currentPage, setCurrentPage,
  };
}
