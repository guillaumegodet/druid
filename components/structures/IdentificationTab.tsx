import React from 'react';
import { Building, Layers } from 'lucide-react';
import { Structure, StructureLevel } from '../../types';
import { Trans, useLingui } from '@lingui/react/macro';
import { LEVEL_LONG_LABELS, LEVEL_LABELS } from '../../lib/structureLabels';
import { GristService } from '../../lib/gristService';

interface IdentificationTabProps {
  structure: Structure;
  onUpdateField: (field: keyof Structure, value: any) => void;
  /** Creation: the level becomes editable (it sets generic_type/type on write). */
  isNew?: boolean;
  /** Opens the « Memberships » tab, where the hierarchical parent is actually edited. */
  onOpenMemberships?: () => void;
}

const readOnlyClass = "input-soft bg-cream-300/60 dark:bg-white/5 text-muted dark:text-[#8f897c] cursor-not-allowed";
const labelClass = "block text-[11px] font-semibold text-muted-light dark:text-[#8f897c] mb-1";

export const IdentificationTab: React.FC<IdentificationTabProps> = ({
  structure,
  onUpdateField,
  isNew = false,
  onOpenMemberships,
}) => {
  const { t } = useLingui();
  // Readable label of the level (derived from generic_type on the V2 side, not editable).
  const levelLabel = LEVEL_LONG_LABELS[String(structure.level)];
  return (
    <div className="space-y-10 animate-in fade-in duration-300">
       <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="space-y-6">
             <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
                <Building className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
                <h3 className="section-label"><Trans>Names</Trans></h3>
             </div>
             <div className="space-y-4">
               <div>
                  <label className={labelClass}><Trans>Official name (full)</Trans></label>
                  <input
                    type="text"
                    value={structure.officialName}
                    onChange={(e) => onUpdateField('officialName', e.target.value)}
                    className="input-soft"
                  />
               </div>
               <div>
                  <label className={labelClass}><Trans>Short name / acronym</Trans></label>
                  <input
                    type="text"
                    value={structure.acronym}
                    onChange={(e) => onUpdateField('acronym', e.target.value)}
                    className="input-soft"
                  />
               </div>
               <div>
                  <label className={labelClass}><Trans>Description</Trans></label>
                  <textarea
                    value={structure.description || ''}
                    onChange={(e) => onUpdateField('description', e.target.value)}
                    rows={3}
                    className="input-soft"
                  />
               </div>
               <div>
                  {isNew ? (
                    <>
                      <label className={labelClass}><Trans>Entity code (supannCodeEntite / local_id)</Trans></label>
                      {/* Known institutional code (e.g. supannCodeEntite 1485) → pivot of the structure in cdb / the
                          CRISalid graph (uid local-<code>). Left empty, a D-/T- id is generated on creation (preview). */}
                      <input
                        type="text"
                        value={structure.localId || ''}
                        onChange={(e) => onUpdateField('localId', e.target.value.trim())}
                        placeholder={structure.acronym ? GristService.makeLocalId(structure) : ''}
                        className="input-soft font-mono"
                      />
                      <p className="mt-1 text-[11px] text-muted-light dark:text-[#8f897c]">
                        <Trans>Enter the institution's entity code if it exists (LDAP supannCodeEntite). It cannot be changed afterwards. Left empty, the identifier shown is generated.</Trans>
                      </p>
                    </>
                  ) : (
                    <>
                      <label className={labelClass}><Trans>local_id (supannCodeEntite) — read only</Trans></label>
                      <input
                        type="text"
                        value={structure.localId || ''}
                        readOnly disabled
                        className={`${readOnlyClass} font-mono`}
                      />
                    </>
                  )}
               </div>
             </div>
          </div>

          <div className="space-y-6">
             <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
                <Layers className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
                <h3 className="section-label"><Trans>Typology & codes</Trans></h3>
             </div>
             <div className="space-y-4">
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div>
                      {isNew ? (
                        <>
                          <label className={labelClass}><Trans>Level</Trans></label>
                          <select
                            value={String(structure.level)}
                            onChange={(e) => onUpdateField('level', e.target.value as StructureLevel)}
                            className="input-soft"
                          >
                            {[StructureLevel.EQUIPE, StructureLevel.ENTITE, StructureLevel.INTERMEDIAIRE, StructureLevel.ETABLISSEMENT].map((lv) => (
                              <option key={lv} value={lv}>{t(LEVEL_LONG_LABELS[lv] || LEVEL_LABELS[lv])}</option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <>
                          <label className={labelClass}><Trans>Level (derived — read only)</Trans></label>
                          <input
                            type="text"
                            value={levelLabel ? t(levelLabel) : String(structure.level)}
                            readOnly disabled
                            className={readOnlyClass}
                          />
                        </>
                      )}
                   </div>
                   <div>
                      <label className={labelClass}><Trans>Type</Trans></label>
                      <input
                        type="text"
                        value={structure.type}
                        onChange={(e) => onUpdateField('type', e.target.value)}
                        className="input-soft"
                        placeholder={t`e.g. UMR, UR, EPE`}
                      />
                   </div>
               </div>

               {/* Hierarchical parent: derived from the inclusions of the « Memberships » tab
                   (lib/structureHierarchy.ts) — no longer typed here, the stored parent_structure
                   column only serving as fallback for records without inclusions. */}
               {(String(structure.level) === StructureLevel.EQUIPE || String(structure.level) === StructureLevel.ENTITE) && (
                 <div>
                    <label className={labelClass}>
                      {String(structure.level) === StructureLevel.EQUIPE ? t`Parent lab (derived from memberships — read only)` : t`Parent faculty (derived from memberships — read only)`}
                    </label>
                    <input
                      type="text"
                      value={structure.parentStructure || ''}
                      readOnly disabled
                      className={readOnlyClass}
                      placeholder="—"
                    />
                    {onOpenMemberships && (
                      <button type="button" onClick={onOpenMemberships} className="mt-1 text-[11px] font-semibold text-[#3b5bdb] dark:text-[#8fa3ff] hover:underline">
                        <Trans>Edit in the Memberships tab →</Trans>
                      </button>
                    )}
                 </div>
               )}

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                     <label className={labelClass}><Trans>RNSR / NNS ID (national)</Trans></label>
                     <input
                       type="text"
                       value={structure.rnsrId || ''}
                       onChange={(e) => onUpdateField('rnsrId', e.target.value)}
                       className="input-soft font-mono"
                       placeholder={t`e.g. 201822446V`}
                     />
                  </div>
                  <div>
                     <label className={labelClass}><Trans>Cluster (derived — read only)</Trans></label>
                     <input
                       type="text"
                       value={structure.cluster || ''}
                       readOnly disabled
                       className={readOnlyClass}
                       placeholder="—"
                     />
                  </div>
               </div>
             </div>
          </div>
       </div>
    </div>
  );
};
