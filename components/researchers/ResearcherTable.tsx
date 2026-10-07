import React, { useState } from 'react';
import { RefreshCw, MoreHorizontal, PlaneTakeoff } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Researcher } from '../../types';
import { ResearcherIcons } from './ResearcherIcons';
import { PresenceBadge } from './PresenceBadge';
import { SortableHeader } from './SortableHeader';
import { hasCapability } from '../../lib/auth';
import type { SortKey, SortConfig } from '../../hooks/useResearcherFilters';
import { affiliationHistoryKey } from '../../lib/affiliationHistory';

/** Avatar gradients (purely decorative, chosen from the initial). */
const AVATAR_GRADIENTS = [
  'from-[#f0a8c0] to-[#e76f9a] text-white',
  'from-[#8ec5ff] to-[#4f8ef7] text-white',
  'from-[#ffd18e] to-[#f7a94f] text-[#5b3d12]',
  'from-[#b8e0c2] to-[#5cb98a] text-[#12492f]',
  'from-[#c9b6ff] to-[#7048e8] text-white',
];
const avatarGradient = (name: string) =>
  AVATAR_GRADIENTS[(name.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length];

/** List medallion: the researcher's photo if present (Grist photo_url),
 * otherwise a gradient badge with the initial. Falls back to the initial if the image is broken. */
const ListAvatar: React.FC<{ person: Researcher }> = ({ person }) => {
  const [photoError, setPhotoError] = useState(false);
  if (person.photoUrl && !photoError) {
    return (
      <img
        src={person.photoUrl}
        alt={person.displayName}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setPhotoError(true)}
        className="h-11 w-11 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className={`h-11 w-11 rounded-full bg-gradient-to-br ${avatarGradient(person.displayName)} flex items-center justify-center font-disp font-bold text-base flex-shrink-0`}>
      {person.displayName.charAt(0)}
    </div>
  );
};

interface ResearcherTableProps {
  researchers: Researcher[];
  selectedIds: Set<string>;
  isAllSelected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onSelectResearcher: (r: Researcher) => void;
  loading: boolean;
  sortedCount: number;
  sortConfig: SortConfig | null;
  onSort: (key: SortKey) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Keys (uid_dyna / g<rowId>) of the records with a probable departure (career path, lot 4). */
  departureKeys?: Set<string> | null;
}

/** Table + pagination of the researcher list — extracted from ResearcherList.tsx (lot 3 of the
 * multi-instance architecture plan, refactor sub-lot ResearcherList). */
export const ResearcherTable: React.FC<ResearcherTableProps> = ({
  researchers, selectedIds, isAllSelected, onToggleSelect, onToggleSelectAll,
  onSelectResearcher, loading, sortedCount, sortConfig, onSort,
  currentPage, totalPages, onPageChange, departureKeys = null,
}) => {
  const { t } = useLingui();
  return (
  <>
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr>
            <th className="px-5 py-4 w-10 border-b border-ink/5 dark:border-white/5">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-ink dark:accent-accent"
                checked={isAllSelected}
                onChange={onToggleSelectAll}
              />
            </th>
            <SortableHeader label={t`Identity`} sortKey="displayName" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label={t({ message: `Affiliation`, context: "membership" })} sortKey="structureName" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label={t`Employer`} sortKey="employer" sortConfig={sortConfig} onSort={onSort} />
            <th className="px-5 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] border-b border-ink/5 dark:border-white/5"><Trans>Identifiers</Trans></th>
            {/* Presence + LDAP account + validation: configurable per instance (HAS_STATUS_VALIDATION) —
                irrelevant for an instance that only enters its present staff (Centrale). */}
            {hasCapability('HAS_STATUS_VALIDATION') && <SortableHeader label={t`Presence`} sortKey="status" sortConfig={sortConfig} onSort={onSort} />}
            <th className="relative px-5 py-4 border-b border-ink/5 dark:border-white/5" />
          </tr>
        </thead>
        <tbody>
          {researchers.map(person => (
            <tr
              key={person.id}
              className={`cursor-pointer border-b border-ink/5 dark:border-white/5 group transition-colors hover:bg-accent/10 ${selectedIds.has(person.id) ? 'bg-accent/15' : ''}`}
              onClick={() => onSelectResearcher(person)}
            >
              <td className="px-5 py-4" onClick={e => { e.stopPropagation(); onToggleSelect(person.id); }}>
                <input type="checkbox" className="w-4 h-4 rounded accent-ink dark:accent-accent" checked={selectedIds.has(person.id)} readOnly />
              </td>
              <td className="px-5 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <ListAvatar person={person} />
                  <div className="ml-3.5">
                    <div className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-1.5">
                      {person.displayName}
                      {departureKeys?.has(affiliationHistoryKey(person) || '') && (
                        <span title={t`Probable departure (career path)`} aria-label={t`Probable departure (career path)`} className="inline-flex">
                          <PlaneTakeoff className="w-3.5 h-3.5 text-[#ab7f10] dark:text-[#e0b04a]" aria-hidden />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-light dark:text-[#8f897c]">{person.employment.internalTypology || '—'}</div>
                  </div>
                </div>
              </td>
              <td className="px-5 py-4">
                {person.affiliations.find(a => a.isPrimary)?.structureName ? (
                  <div className="inline-flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-[13px] font-semibold text-ink dark:text-[#e7e2d6]">
                      <span className="w-2 h-2 rounded-full bg-[#7048e8] dark:bg-[#9a7bff] flex-shrink-0"></span>
                      {person.affiliations.find(a => a.isPrimary)?.structureName}
                    </span>
                    {/* Several teams possible (« A|B » in Grist) → one badge per team. */}
                    {String(person.affiliations.find(a => a.isPrimary)?.team || '').split('|').map((tm) => tm.trim()).filter(Boolean).map((tm) => (
                      <span key={tm} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-[13px] font-medium text-[#4b473e] dark:text-[#c9c4b6]">
                        <span className="w-2 h-2 rounded-full bg-[#0ca678] dark:bg-[#63e6be] flex-shrink-0"></span>
                        {tm}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[13px] text-muted-faint dark:text-[#8f897c]">—</span>
                )}
              </td>
              <td className="px-5 py-4 text-[13.5px] font-medium text-[#4b473e] dark:text-[#e7e2d6]">
                {person.employment.employer && !/^non renseign/i.test(person.employment.employer)
                  ? person.employment.employer
                  : <span className="text-muted-faint dark:text-[#8f897c] font-normal" title={t`Employer not specified`}>—</span>}
              </td>
              <td className="px-5 py-4"><ResearcherIcons identifiers={person.identifiers} /></td>
              {hasCapability('HAS_STATUS_VALIDATION') && <td className="px-5 py-4"><PresenceBadge presence={person.presence} ldapAccount={person.ldapAccount} validation={person.validation} derivedPresence={person.derivedPresence} /></td>}
              <td className="px-5 py-4 text-right">
                <button className="text-muted-faint hover:text-ink dark:text-[#8f897c] dark:hover:text-[#f5f2ea] transition-colors">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {loading && (
        <div className="p-20 flex flex-col items-center justify-center gap-4">
          <RefreshCw className="w-8 h-8 text-ink dark:text-accent animate-spin" />
          <p className="text-muted dark:text-[#8f897c]"><Trans>Synchronising with Grist…</Trans></p>
        </div>
      )}
      {!loading && sortedCount === 0 && (
        <div className="p-20 text-center text-muted dark:text-[#8f897c]"><Trans>No researcher found.</Trans></div>
      )}
    </div>

    {!loading && totalPages > 1 && (
      <div className="px-5 py-4 flex items-center justify-between border-t border-ink/5 dark:border-white/5">
        <div className="text-sm text-muted dark:text-[#8f897c]">
          <Trans>Page <span className="font-bold text-ink dark:text-[#f5f2ea]">{currentPage}</span> / <span className="font-bold text-ink dark:text-[#f5f2ea]">{totalPages}</span></Trans>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="h-9 px-4 rounded-full font-disp font-semibold text-sm bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 disabled:opacity-40 transition-colors"
          >
            ← <Trans>Prev.</Trans>
          </button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum = i + 1;
              if (totalPages > 5 && currentPage > 3) {
                pageNum = currentPage - 2 + i;
                if (pageNum > totalPages - 4) pageNum = totalPages - 4 + i;
              }
              if (pageNum > totalPages) return null;
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`w-9 h-9 rounded-full font-disp font-semibold text-sm transition-colors ${currentPage === pageNum ? 'bg-ink text-white dark:bg-accent dark:text-ink' : 'bg-white/60 dark:bg-white/10 text-muted dark:text-[#8f897c] hover:bg-white dark:hover:bg-white/15'}`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="h-9 px-4 rounded-full font-disp font-semibold text-sm bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 disabled:opacity-40 transition-colors"
          >
            <Trans context="short">Next</Trans> →
          </button>
        </div>
      </div>
    )}
  </>
  );
};
