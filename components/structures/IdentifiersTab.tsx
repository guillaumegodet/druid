import React from 'react';
import { Fingerprint, Link2 } from 'lucide-react';
import { Structure } from '../../types';
import { Trans, useLingui } from '@lingui/react/macro';

interface IdentifiersTabProps {
  structure: Structure;
  onUpdateField: (field: keyof Structure, value: any) => void;
}

const inputClass = "input-soft font-mono";
const labelClass = "block text-[11px] font-semibold text-muted-light dark:text-[#8f897c] mb-1";

export const IdentifiersTab: React.FC<IdentifiersTabProps> = ({
  structure,
  onUpdateField
}) => {
  const { t } = useLingui();
  const ids = structure.identifiers || {};
  const updateId = (key: string, value: string) =>
    onUpdateField('identifiers', { ...ids, [key]: value });

  return (
    <div className="space-y-10 animate-in fade-in duration-300">
       <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="space-y-6">
             <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
                <Fingerprint className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
                <h3 className="section-label"><Trans>Third-party identifiers</Trans></h3>
             </div>
             <div className="space-y-4">
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                     <label className={labelClass}><Trans>ROR ID (global)</Trans></label>
                     <input type="text" value={structure.rorId || ''} onChange={(e) => onUpdateField('rorId', e.target.value)} className={inputClass} placeholder={t`e.g. 04z8jg214`} />
                  </div>
                  <div>
                     <label className={labelClass}><Trans>Scopus ID</Trans></label>
                     <input type="text" value={ids.scopusId || ''} onChange={(e) => updateId('scopusId', e.target.value)} className={inputClass} placeholder={t`e.g. 60028048`} />
                  </div>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                     <label className={labelClass}><Trans>UAI code</Trans></label>
                     <input type="text" value={ids.uai || ''} onChange={(e) => updateId('uai', e.target.value)} className={inputClass} placeholder={t`e.g. 0442953W`} />
                  </div>
                  <div>
                     <label className={labelClass}>ISNI</label>
                     <input type="text" value={ids.isni || ''} onChange={(e) => updateId('isni', e.target.value)} className={inputClass} placeholder={t`e.g. 0000 0001 …`} />
                  </div>
               </div>
               <div>
                  <label className={labelClass}>Wikidata</label>
                  <input type="text" value={ids.wikidata || ''} onChange={(e) => updateId('wikidata', e.target.value)} className={inputClass} placeholder={t`e.g. Q123456`} />
               </div>
             </div>
          </div>

          <div className="space-y-6">
             <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
                <Link2 className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
                <h3 className="section-label"><Trans>Links & signature</Trans></h3>
             </div>
             <div className="space-y-4">
               <div>
                  <label className={labelClass}><Trans>Website</Trans></label>
                  <input type="text" value={structure.website || ''} onChange={(e) => onUpdateField('website', e.target.value)} className={inputClass} placeholder="https://..." />
               </div>
               <div>
                  <label className={labelClass}><Trans>HAL collection</Trans></label>
                  <input type="text" value={structure.halCollectionUrl || ''} onChange={(e) => onUpdateField('halCollectionUrl', e.target.value)} className={inputClass} placeholder="https://hal.science/..." />
               </div>
               <div>
                  <label className={labelClass}><Trans>Bibliographic signature</Trans></label>
                  <textarea value={structure.signature || ''} onChange={(e) => onUpdateField('signature', e.target.value)} rows={3} className="input-soft" placeholder={t`Nantes Université, …`} />
               </div>
             </div>
          </div>
       </div>
    </div>
  );
};
