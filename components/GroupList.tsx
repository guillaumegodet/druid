
import React, { useState, useMemo } from 'react';
import { useCompactHeader } from '../hooks/useCompactHeader';
import { Search, Layers, ChevronDown, ChevronRight, XCircle, Trash2, Plus, UserPlus, X, Loader2, Fingerprint } from 'lucide-react';
import { Group, Researcher, ViewState } from '../types';
import { GristService } from '../lib/gristService';
import { GroupDashboardSection } from './groups/GroupDashboardSection';
import { AuthorResolveModal } from './groups/AuthorResolveModal';
import { isHarvestable } from './groups/groupDashboardApi';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../lib/apiErrors';
import { HelpButton } from './HelpButton';
import { VIEW_HELP } from '../lib/helpLinks';

/** Props of the GroupList component */
interface GroupListProps {
  /** Reference to the researcher list to manage members */
  researchers: Researcher[];
  /** Function updating group membership at the global level */
  setResearchers: React.Dispatch<React.SetStateAction<Researcher[]>>;
  /** Opens the dashboard section on a slug (the group's dashboard). */
  onOpenDashboard: (slug: string) => void;
}

/**
 * @component GroupList
 * @description Management UI for functional groups (e.g. Conseil Scientifique).
 * Membership is persisted in the `groupes` column of the Grist Annuaire
 * (names separated by « | »); a group exists through its members. Will serve as
 * the basis for generating per-group dashboards (harvesting the
 * members' publications).
 */
export const GroupList: React.FC<GroupListProps> = ({ researchers, setResearchers, onOpenDashboard }) => {
  const { t } = useLingui();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  /** Member without ORCID currently being identified in OpenAlex (modal). */
  const [resolveTarget, setResolveTarget] = useState<Researcher | null>(null);

  // Quick member additions
  const [addingMemberToGroup, setAddingMemberToGroup] = useState<string | null>(null);
  const [memberSearchTerm, setMemberSearchTerm] = useState('');

  /** Groups created in this session but still empty (not persisted while memberless). */
  const [draftGroups, setDraftGroups] = useState<string[]>([]);

  /** Group list = union of persisted memberships and the session's drafts */
  const groups: Group[] = useMemo(() => {
    const allNames = new Set<string>(draftGroups);
    researchers.forEach(r => r.groups.forEach(g => allNames.add(g)));
    return Array.from(allNames).map(name => ({ name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [researchers, draftGroups]);

  /** Real-time head count of each group */
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    researchers.forEach(r => {
      r.groups.forEach(gName => { counts[gName] = (counts[gName] || 0) + 1; });
    });
    return counts;
  }, [researchers]);

  /**
   * Persists the modified memberships to Grist (grouped PATCH on the single
   * `groupes` column), with optimistic state update and rollback
   * on failure.
   */
  const persistGroups = async (updates: Array<{ id: string; groups: string[] }>) => {
    const prev = researchers;
    const byId = new Map(updates.map(u => [u.id, u.groups]));
    setResearchers(rs => rs.map(r => (byId.has(r.id) ? { ...r, groups: byId.get(r.id)! } : r)));
    setSaving(true);
    try {
      await GristService.updateResearcherGroups(
        updates
          .map(u => ({ gristRowId: prev.find(r => r.id === u.id)?.gristRowId ?? NaN, groups: u.groups }))
          .filter(u => u.gristRowId && !Number.isNaN(u.gristRowId)),
      );
    } catch (e) {
      setResearchers(prev);
      window.alert(e instanceof Error ? apiErrorText(e) : t`Error saving groups.`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateGroup = () => {
    const name = newGroupName.trim();
    if (name && !groups.some(g => g.name === name)) {
      setDraftGroups(prev => [...prev, name]);
      setExpandedGroup(name);
    }
    setNewGroupName(''); setIsCreateModalOpen(false);
  };

  /** Deletes a group and removes it from every researcher profile (Grist included) */
  const handleDeleteGroup = (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(t`Delete the group “${groupName}”?`)) return;
    const affected = researchers
      .filter(r => r.groups.includes(groupName))
      .map(r => ({ id: r.id, groups: r.groups.filter(g => g !== groupName) }));
    if (affected.length > 0) void persistGroups(affected);
    setDraftGroups(prev => prev.filter(g => g !== groupName));
    if (expandedGroup === groupName) setExpandedGroup(null);
  };

  /** Removes a specific member from a group */
  const handleRemoveMember = (researcher: Researcher, groupName: string) => {
    void persistGroups([{ id: researcher.id, groups: researcher.groups.filter(g => g !== groupName) }]);
  };

  /** Adds a member through the quick search */
  const handleAddMember = (researcher: Researcher, groupName: string) => {
    if (!researcher.groups.includes(groupName)) {
      void persistGroups([{ id: researcher.id, groups: [...researcher.groups, groupName] }]);
      // The group is now carried by a member: the local draft is no longer needed.
      setDraftGroups(prev => prev.filter(g => g !== groupName));
    }
    setAddingMemberToGroup(null); setMemberSearchTerm('');
  };

  /** Returns the current members of a group */
  const getGroupMembers = (groupName: string) => researchers.filter(r => r.groups.includes(groupName));

  /** Filters the researchers eligible for quick addition */
  const getCandidatesForGroup = (groupName: string) => {
    return researchers
      .filter(r => !r.groups.includes(groupName))
      .filter(r => r.displayName.toLowerCase().includes(memberSearchTerm.toLowerCase()))
      .slice(0, 5);
  };

  const { compact, onScrollCapture } = useCompactHeader();
  return (
    <div className="flex flex-col h-full relative" onScrollCapture={onScrollCapture}>
      {/* OpenAlex identification modal (members without ORCID) */}
      {resolveTarget && (
        <AuthorResolveModal
          researcher={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={(updated) =>
            setResearchers((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))
          }
        />
      )}

      {/* Creation modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 p-7 w-full max-w-md">
             <h3 className="font-disp text-xl font-bold tracking-tight text-ink dark:text-[#f5f2ea] mb-4"><Trans>New group</Trans></h3>
             <input
               type="text"
               autoFocus
               className="input-soft mb-3"
               value={newGroupName}
               onChange={(e) => setNewGroupName(e.target.value)}
               placeholder={t`Group name…`}
             />
             <p className="text-[12.5px] text-muted-light dark:text-[#8f897c] mb-6">
               <Trans>The group will be kept as soon as it has at least one member.</Trans>
             </p>
             <div className="flex justify-end gap-3">
               <button onClick={() => setIsCreateModalOpen(false)} className="btn-pill"><Trans>Cancel</Trans></button>
               <button onClick={handleCreateGroup} className="btn-pill-dark"><Trans>Create</Trans></button>
             </div>
          </div>
        </div>
      )}

      <header className="page-header px-4 md:px-7 pt-5 pb-2 flex flex-col md:flex-row md:items-end justify-between gap-4" data-compact={compact || undefined}>
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="font-disp text-3xl md:text-[38px] font-bold tracking-tight text-ink dark:text-[#f5f2ea]">
              <Trans>Functional groups</Trans>
            </h2>
            <span className="count-badge">
               {groups.length}
            </span>
            <HelpButton path={VIEW_HELP[ViewState.GROUPS_LIST]} />
            {saving && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-light dark:text-[#8f897c]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> <Trans>Saving…</Trans>
              </span>
            )}
          </div>
          <p className="page-header-sub text-[15px] text-muted dark:text-[#8f897c] mt-1">
            <Trans>Cross-cutting selections of researchers (scientific council, projects, cohorts…)</Trans>
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="btn-pill-dark self-start md:self-auto"
        >
          <Plus className="w-4 h-4" /> <Trans>New</Trans>
        </button>
      </header>

      <div className="px-4 md:px-7 py-4 flex-1 overflow-auto" data-page-scroll>
        <div className="relative max-w-md w-full mb-4">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-light" />
          <input
            type="text"
            className="w-full h-12 pl-12 pr-5 rounded-full bg-white/85 dark:bg-white/10 border border-white/90 dark:border-white/15 text-[15px] text-ink dark:text-[#f5f2ea] placeholder:text-muted-lighter dark:placeholder:text-[#8f897c] outline-none focus:border-accent-strong focus:ring-2 focus:ring-accent/40 transition-all shadow-soft"
            placeholder={t`Search for a group…`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="w-12 border-b border-ink/5 dark:border-white/5"></th>
                  <th className="px-6 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] border-b border-ink/5 dark:border-white/5"><Trans>Group</Trans></th>
                  <th className="px-6 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] border-b border-ink/5 dark:border-white/5"><Trans>Members</Trans></th>
                  <th className="w-12 border-b border-ink/5 dark:border-white/5"></th>
                </tr>
              </thead>
              <tbody>
                {groups.filter(g => g.name.toLowerCase().includes(searchTerm.toLowerCase())).map((group) => {
                  const isExpanded = expandedGroup === group.name;
                  return (
                    <React.Fragment key={group.name}>
                      <tr
                        className={`hover:bg-accent/10 cursor-pointer transition-colors border-b border-ink/5 dark:border-white/5 ${isExpanded ? 'bg-accent/15' : ''}`}
                        onClick={() => setExpandedGroup(isExpanded ? null : group.name)}
                      >
                        <td className="px-6 py-4 text-muted-light dark:text-[#8f897c]">{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-accent/25 dark:bg-accent/20 text-ink dark:text-accent flex items-center justify-center shrink-0">
                              <Layers className="w-4 h-4" />
                            </div>
                            <span className="font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea]">{group.name}</span>
                            {draftGroups.includes(group.name) && (
                              <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/10 dark:border-white/10 text-[11px] font-semibold text-muted-light dark:text-[#8f897c]">
                                <Trans>Draft</Trans>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-xs font-semibold text-ink dark:text-[#e7e2d6]">
                            <Plural value={groupCounts[group.name] || 0} one="# member" other="# members" />
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={e => handleDeleteGroup(group.name, e)} className="text-muted-faint hover:text-[#d64545] transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-cream-50/50 dark:bg-white/[.03]">
                          <td colSpan={4} className="px-6 md:px-12 py-6 border-b border-ink/5 dark:border-white/5">
                             <div className="flex items-center justify-between mb-4 border-b border-ink/10 dark:border-white/10 pb-2">
                                <h4 className="section-label"><Trans>Member list</Trans></h4>
                                <button
                                  onClick={() => setAddingMemberToGroup(group.name)}
                                  className="text-[13px] font-disp font-semibold text-[#1f7a4d] dark:text-[#5fd39a] flex items-center gap-1.5 hover:underline"
                                >
                                  <UserPlus className="w-3.5 h-3.5" /> <Trans>Add a member</Trans>
                                </button>
                             </div>

                             {addingMemberToGroup === group.name && (
                               <div className="mb-4 p-4 rounded-card bg-white/80 dark:bg-white/5 border border-ink/5 dark:border-white/10 shadow-soft">
                                 <div className="flex items-center gap-2 mb-2">
                                   <Search className="w-3.5 h-3.5 text-muted-light" />
                                   <input
                                     autoFocus
                                     type="text"
                                     className="flex-1 text-[13px] border-b border-ink/15 dark:border-white/15 bg-transparent p-1 text-ink dark:text-[#f5f2ea] placeholder:text-muted-lighter outline-none focus:border-accent-strong transition-colors"
                                     placeholder={t`Search for a name…`}
                                     value={memberSearchTerm}
                                     onChange={(e) => setMemberSearchTerm(e.target.value)}
                                   />
                                   <button onClick={() => setAddingMemberToGroup(null)}><X className="w-4 h-4 text-muted-faint" /></button>
                                 </div>
                                 <div className="space-y-1">
                                    {getCandidatesForGroup(group.name).map(cand => (
                                      <button
                                        key={cand.id}
                                        onClick={() => handleAddMember(cand, group.name)}
                                        className="w-full text-left p-2 rounded-xl text-[13px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-accent/15 transition-colors flex items-center justify-between group/cand"
                                      >
                                        <span>{cand.displayName}</span>
                                        <Plus className="w-3 h-3 opacity-0 group-hover/cand:opacity-100" />
                                      </button>
                                    ))}
                                    {memberSearchTerm && getCandidatesForGroup(group.name).length === 0 && (
                                      <p className="text-[12px] text-muted-light dark:text-[#8f897c] p-2 italic"><Trans>No result.</Trans></p>
                                    )}
                                 </div>
                               </div>
                             )}

                             <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {getGroupMembers(group.name).map(m => (
                                  <div key={m.id} className="rounded-card bg-white/80 dark:bg-white/5 border border-ink/5 dark:border-white/10 shadow-soft p-3 flex justify-between items-center gap-2 group/member">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#f0a8c0] to-[#e76f9a] text-white font-disp font-bold flex items-center justify-center text-xs shrink-0">
                                        {m.displayName.charAt(0)}
                                      </div>
                                      <div className="min-w-0">
                                        <span className="block text-[13px] font-semibold text-ink dark:text-[#e7e2d6] truncate">{m.displayName}</span>
                                        {/* Harvestability: ORCID, confirmed author ID, or to be identified */}
                                        {m.identifiers.orcid ? (
                                          <span className="text-[11px] text-[#1f7a4d] dark:text-[#5fd39a]">✓ ORCID</span>
                                        ) : m.identifiers.openalexId ? (
                                          <span className="text-[11px] text-[#1f7a4d] dark:text-[#5fd39a]">✓ <Trans>OpenAlex author</Trans></span>
                                        ) : (
                                          <button
                                            onClick={() => setResolveTarget(m)}
                                            title={t`No ORCID: identify their OpenAlex author profile (search limited to their lab)`}
                                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#b06a00] dark:text-[#e0a33c] hover:underline"
                                          >
                                            <Fingerprint className="w-3 h-3" /> <Trans>Identify the author</Trans>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleRemoveMember(m, group.name)}
                                      className="text-muted-faint hover:text-[#d64545] transition-colors shrink-0"
                                    >
                                      <XCircle className="w-4 h-4" />
                                    </button>
                                  </div>
                                ))}
                                {getGroupMembers(group.name).length === 0 && (
                                  <p className="col-span-3 text-center py-4 text-[13px] text-muted-light dark:text-[#8f897c] italic">
                                    <Trans>No member in this group</Trans>
                                  </p>
                                )}
                             </div>

                             <GroupDashboardSection
                               groupName={group.name}
                               members={getGroupMembers(group.name)}
                               onOpenDashboard={onOpenDashboard}
                             />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
