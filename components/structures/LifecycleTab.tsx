import React from 'react';
import { Network, Trash2, History, AlertTriangle } from 'lucide-react';
import { Structure, StructureStatus, LineageType, LineageLink } from '../../types';
import { LineageGraph } from './LineageGraph';
import { Trans, useLingui } from '@lingui/react/macro';

const labelClass = "block text-[11px] font-semibold text-muted-light dark:text-[#8f897c] mb-1";

interface LifecycleTabProps {
  structure: Structure;
  onUpdateField: (field: keyof Structure, value: any) => void;
}

/**
 * « Cycle de vie et filiation » tab — ported from docker/druid-demo (lot 3 of the
 * multi-instance architecture plan) on 2026-09-18, at the product owner's request, even
 * though it is NOT yet wired to Grist on the Nantes side: `updateStructure` (lib/gristService.ts)
 * explicitly ignores the lineage (« table alimentée par structures.csv du directory bridge »)
 * and no Grist column carries it. Entries made here stay in memory
 * (like the other tabs, via onUpdateField) but are lost on refresh as long as
 * this wiring is not built — hence the warning banner below, to be removed
 * the day persistence exists.
 */
export const LifecycleTab: React.FC<LifecycleTabProps> = ({
  structure,
  onUpdateField
}) => {
  const { t } = useLingui();
  const handleLinkChange = (index: number, field: keyof LineageLink, value: any) => {
    const newLinks = [...(structure.historyLinks || [])];
    newLinks[index] = { ...newLinks[index], [field]: value };
    onUpdateField('historyLinks', newLinks);
  };

  const handleAddLink = () => {
    const newLink: LineageLink = {
      relatedStructureId: '',
      relatedStructureName: '',
      type: LineageType.SUCCESSION,
      date: new Date().toISOString().split('T')[0]
    };
    onUpdateField('historyLinks', [...(structure.historyLinks || []), newLink]);
  };

  const handleRemoveLink = (index: number) => {
    const newLinks = [...(structure.historyLinks || [])];
    newLinks.splice(index, 1);
    onUpdateField('historyLinks', newLinks);
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-300">
       <div className="flex items-start gap-3 p-4 rounded-panel border border-[#e09e2a]/40 bg-[#e09e2a]/10 text-[#8a5a00] dark:text-[#f0c674]">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-[13px] leading-relaxed">
            <Trans>
              Tab not yet connected to Grist: the entries below are not saved (nor reloaded). Still to be developed — see docs/archive/plan-fusion-demo-2026-09.md, sub-lot “structure lineage”.
            </Trans>
          </p>
       </div>

       <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 glass-card p-6 h-fit">
             <h3 className="section-label mb-6 border-b border-ink/10 dark:border-white/10 pb-3"><Trans>Current state</Trans></h3>
             <div className="space-y-6">
                <div>
                   <label className={labelClass}><Trans>Unit status</Trans></label>
                   <select
                     value={structure.status}
                     onChange={(e) => onUpdateField('status', e.target.value)}
                     className="input-soft cursor-pointer mt-1"
                   >
                     <option value={StructureStatus.PROJET}>{t`Planned`}</option>
                     <option value={StructureStatus.ACTIVE}>{t`Active`}</option>
                     <option value={StructureStatus.EN_FERMETURE}>{t`Closing`}</option>
                     <option value={StructureStatus.FERMEE}>{t({ message: `Closed`, context: "feminine" })}</option>
                   </select>
                </div>
                <div>
                   <label className={labelClass}><Trans>Creation date</Trans></label>
                   <input
                     type="date"
                     value={structure.creationDate || ''}
                     onChange={(e) => onUpdateField('creationDate', e.target.value)}
                     className="input-soft mt-1 dark:[color-scheme:dark]"
                   />
                </div>
                <div>
                   <label className={labelClass}><Trans>Closure date</Trans></label>
                   <input
                     type="date"
                     value={structure.closeDate || ''}
                     onChange={(e) => onUpdateField('closeDate', e.target.value)}
                     className="input-soft mt-1 dark:[color-scheme:dark]"
                   />
                </div>
             </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
             <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
               <History className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
               <h3 className="section-label"><Trans>Lineage view</Trans></h3>
             </div>
             <LineageGraph currentStructure={structure} />
          </div>
       </div>

       <div className="space-y-6">
           <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
             <Network className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
             <h3 className="section-label"><Trans>Lineage management</Trans></h3>
           </div>
           <div className="glass-card overflow-hidden">
              <table className="min-w-full">
                <thead>
                   <tr>
                      <th className="px-6 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] border-b border-ink/5 dark:border-white/5"><Trans>Type</Trans></th>
                      <th className="px-6 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] border-b border-ink/5 dark:border-white/5"><Trans>Linked structure</Trans></th>
                      <th className="px-6 py-4 text-left text-[11.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] border-b border-ink/5 dark:border-white/5"><Trans>Date</Trans></th>
                      <th className="w-16 border-b border-ink/5 dark:border-white/5"></th>
                   </tr>
                </thead>
                <tbody>
                   {(structure.historyLinks || []).map((link, idx) => (
                      <tr key={idx} className="border-b border-ink/5 dark:border-white/5 hover:bg-accent/10 transition-colors">
                         <td className="px-6 py-4">
                            <select
                              value={link.type}
                              onChange={(e) => handleLinkChange(idx, 'type', e.target.value as LineageType)}
                              className="input-soft cursor-pointer text-[13px]"
                            >
                                <option value={LineageType.SUCCESSION}>{t`Succeeds`}</option>
                                <option value={LineageType.INTEGRATION}>{t`Integration`}</option>
                                <option value={LineageType.FUSION}>{t({ message: `Merge`, context: "noun" })}</option>
                                <option value={LineageType.SCISSION}>{t`Split`}</option>
                            </select>
                         </td>
                         <td className="px-6 py-4">
                            <input
                              type="text"
                              value={link.relatedStructureName}
                              onChange={(e) => handleLinkChange(idx, 'relatedStructureName', e.target.value)}
                              className="input-soft text-[13px]"
                            />
                         </td>
                         <td className="px-6 py-4">
                            <input
                              type="date"
                              value={link.date}
                              onChange={(e) => handleLinkChange(idx, 'date', e.target.value)}
                              className="input-soft text-[13px] dark:[color-scheme:dark]"
                            />
                         </td>
                         <td className="px-4 py-4 text-center">
                            <button onClick={() => handleRemoveLink(idx)} className="text-muted-faint hover:text-[#d64545] transition-colors">
                               <Trash2 className="w-4 h-4" />
                            </button>
                         </td>
                      </tr>
                   ))}
                </tbody>
              </table>
              <div className="p-4 border-t border-ink/5 dark:border-white/5 text-right">
                 <button
                  onClick={handleAddLink}
                  className="btn-pill h-10"
                 >
                   <Trans>+ Add a link</Trans>
                 </button>
              </div>
           </div>
       </div>
    </div>
  );
};
