import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { SortKey, SortConfig } from '../../hooks/useResearcherFilters';

interface SortableHeaderProps {
  label: string;
  sortKey: SortKey;
  sortConfig: SortConfig | null;
  onSort: (key: SortKey) => void;
}

/** Sortable column header — extracted from ResearcherList.tsx (lot 3 of the
 * multi-instance architecture plan, refactor sub-lot ResearcherList). */
export const SortableHeader: React.FC<SortableHeaderProps> = ({ label, sortKey, sortConfig, onSort }) => {
  const isActive = sortConfig?.key === sortKey;
  return (
    <th
      scope="col"
      className="px-5 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] cursor-pointer group hover:text-ink dark:hover:text-[#f5f2ea] transition-colors select-none border-b border-ink/5 dark:border-white/5"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {isActive && sortConfig?.direction === 'desc'
            ? <ArrowDown className="w-3.5 h-3.5" />
            : <ArrowUp className="w-3.5 h-3.5" />}
        </span>
      </div>
    </th>
  );
};
