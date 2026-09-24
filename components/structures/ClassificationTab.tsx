import React from 'react';
import { Activity, Hash } from 'lucide-react';
import { Structure, StructureMission } from '../../types';
import { Trans, useLingui } from '@lingui/react/macro';
import { MISSION_LABELS } from '../../lib/structureLabels';

interface ClassificationTabProps {
  structure: Structure;
  onUpdateField: (field: keyof Structure, value: any) => void;
}

const inputClass = "input-soft";
const labelClass = "block text-[11px] font-semibold text-muted-light dark:text-[#8f897c] mb-1";

export const ClassificationTab: React.FC<ClassificationTabProps> = ({
  structure,
  onUpdateField
}) => {
  const { t } = useLingui();
  const missionOptions = Object.values(StructureMission).map((m) => (
    <option key={m} value={m}>{t(MISSION_LABELS[m])}</option>
  ));
  return (
    <div className="space-y-10 animate-in fade-in duration-300">
       <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="space-y-6">
             <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
               <Activity className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
               <h3 className="section-label"><Trans>Missions</Trans></h3>
             </div>
             <div className="space-y-4">
               <div>
                 <label className={labelClass}><Trans>Primary mission</Trans></label>
                 <select
                    value={structure.primaryMission}
                    onChange={(e) => onUpdateField('primaryMission', e.target.value)}
                    className={inputClass}
                 >
                    {missionOptions}
                 </select>
               </div>
               <div>
                 <label className={labelClass}><Trans>Secondary mission</Trans></label>
                 <select
                    value={structure.secondaryMission || ''}
                    onChange={(e) => onUpdateField('secondaryMission', e.target.value || null)}
                    className={inputClass}
                 >
                    <option value="">{t({ message: `— None —`, context: "feminine" })}</option>
                    {missionOptions}
                 </select>
               </div>
               <div>
                 <label className={labelClass}><Trans>Campus</Trans></label>
                 <input
                    type="text"
                    value={structure.campus || ''}
                    onChange={(e) => onUpdateField('campus', e.target.value)}
                    className={inputClass}
                    placeholder={t`e.g. Lombarderie campus`}
                 />
               </div>
             </div>
          </div>

          <div className="space-y-6">
             <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
               <Hash className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
               <h3 className="section-label"><Trans>Topics</Trans></h3>
             </div>
             <div className="space-y-4">
               <div>
                 <label className={labelClass}><Trans>ERC panel</Trans></label>
                 <input
                    type="text"
                    value={structure.ercField || ''}
                    onChange={(e) => onUpdateField('ercField', e.target.value)}
                    className={inputClass}
                    placeholder={t`e.g. PE6`}
                 />
               </div>
               <div>
                 <label className={labelClass}><Trans>HCÉRES research areas</Trans></label>
                 <textarea
                    value={structure.hceresAreas || ''}
                    onChange={(e) => onUpdateField('hceresAreas', e.target.value)}
                    rows={3}
                    className={inputClass}
                    placeholder={t`e.g. ST6 | SHS5`}
                 />
               </div>
             </div>
          </div>
       </div>
    </div>
  );
};
