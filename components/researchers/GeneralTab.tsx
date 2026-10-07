import React from 'react';
import { Lock, ExternalLink } from 'lucide-react';
import { Researcher, Affiliation } from '../../types';
import { AffiliationsTable, TeamOption } from './AffiliationsTable';
import { GradeSelect } from './GradeSelect';
import { FuzzyDateInput } from './FuzzyDateInput';
import { FteInput } from './FteInput';
import { useFteColumns } from '../../hooks/useFteColumns';
import { LdapUidLookup, LdapLookupOutcome } from './LdapUidLookup';
import { Trans, useLingui } from '@lingui/react/macro';

const LdapFieldLabel: React.FC<{ label: string; fromLdap?: boolean }> = ({ label, fromLdap }) => (
  <div className="flex items-center gap-2 mb-1">
    <label className="block text-xs text-muted-lighter dark:text-[#8f897c]">{label}</label>
    {fromLdap && (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-primary/10 text-primary dark:bg-primary-light/15 dark:text-primary-light">
        <Lock className="w-2.5 h-2.5" />LDAP
      </span>
    )}
  </div>
);

/** « Nantes Université » block (`Pôle`/`Composante`/`ED`/`Localisation`) hidden for now. */
const SHOW_NU_BLOCK = false;

/** Standard field label (light cards). */
const fieldLabel = 'block text-xs text-muted-lighter dark:text-[#8f897c] mb-1';
/** Field of the secondary sections « Emploi & contrat » / « Nantes Université » (muted tints). */
const secInput =
  'w-full box-border h-9 px-3 rounded-xl bg-white/65 dark:bg-white/5 border border-ink/10 dark:border-white/10 text-sm font-medium text-[#4b473e] dark:text-[#e7e2d6] outline-none focus:border-accent-strong focus:ring-2 focus:ring-accent/30 transition-colors';
/** Label of the secondary sections. */
const secLabel = 'block text-xs text-muted-faint dark:text-[#8f897c] mb-1';
/** Researcher identifier field. */
const idInput =
  'w-full box-border rounded-lg bg-cream-50/80 dark:bg-white/10 border border-ink/10 dark:border-white/15 px-2 py-1 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] outline-none focus:border-accent-strong transition-colors';

interface GeneralTabProps {
  researcher: Researcher;
  affiliations: Affiliation[];
  onUpdateField: (field: string, value: any, subObject?: string) => void;
  onAddAffiliation: () => void;
  onRemoveAffiliation: (index: number) => void;
  onAffiliationChange: (index: number, field: keyof Affiliation, value: any) => void;
  onNavigateToStructure?: (structureId: string) => void;
  /** Research structures existing in Grist (acronyms) — Structure menu of the memberships. */
  labOptions?: string[];
  /** Teams existing in Grist — Team menu of the memberships. */
  teamOptions?: TeamOption[];
  /** Employing institutions existing in Grist (Etablissements table) — Employer menu. */
  employerOptions?: string[];
  /** « Ajouter une équipe… » (Team menu) → creation page of a team of the lab. */
  onCreateTeam?: (structureName: string) => void;
  /** « Fill from LDAP » on a record being created (LDAP instances only) — undefined hides it. */
  onLdapLookup?: (uid: string) => Promise<LdapLookupOutcome>;
  /** Runs « Fill from LDAP » on mount (record opened from the LDAP arrivals). */
  ldapAutoRun?: boolean;
}

export const GeneralTab: React.FC<GeneralTabProps> = ({
  researcher,
  affiliations,
  onUpdateField,
  onAddAffiliation,
  onRemoveAffiliation,
  onAffiliationChange,
  onNavigateToStructure,
  labOptions = [],
  teamOptions = [],
  employerOptions = [],
  onCreateTeam,
  onLdapLookup,
  ldapAutoRun = false,
}) => {
  const { t } = useLingui();
  const showFte = useFteColumns();
  return (
    // `contents`: the cards become items of the 2-column grid defined
    // in ResearcherDetail (left col. 300px: photo + identifiers; right col.:
    // memberships + civil status; secondary sections full width below).
    <div className="contents">
       {/* Researcher identifiers — left column, stretches under the photo */}
       <div className="glass-card p-5 flex flex-col lg:col-start-1 lg:row-start-2">
          <div className="section-label mb-4"><Trans>Researcher identifiers</Trans></div>
          <div className="flex-1 flex flex-col gap-2.5">
             {/* ORCID */}
             <div className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-white/5 border border-ink/5 dark:border-white/10">
                <span className="w-9 h-9 rounded-xl bg-orcid text-ink flex items-center justify-center text-[12px] font-extrabold flex-shrink-0">iD</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] text-muted-lighter dark:text-[#8f897c]">ORCID</span>
                    {researcher.identifiers.orcid && (
                      <a href={`https://orcid.org/${researcher.identifiers.orcid}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-[#7a9a24] dark:text-orcid hover:underline">
                        <ExternalLink className="w-3 h-3" /> orcid.org
                      </a>
                    )}
                  </div>
                  <input type="text" value={researcher.identifiers.orcid || ''} onChange={(e) => onUpdateField('orcid', e.target.value, 'identifiers')} className={idInput} />
                </div>
             </div>
             {/* IdRef */}
             <div className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-white/5 border border-ink/5 dark:border-white/10">
                <span className="w-9 h-9 rounded-xl bg-cream-300 text-ink dark:bg-white/10 dark:text-[#e7e2d6] flex items-center justify-center text-[11px] font-extrabold flex-shrink-0">IdR</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] text-muted-lighter dark:text-[#8f897c]">IdRef</span>
                    {researcher.identifiers.idref && (
                      <a href={`https://www.idref.fr/${researcher.identifiers.idref}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-primary dark:text-primary-light hover:underline">
                        <ExternalLink className="w-3 h-3" /> idref.fr
                      </a>
                    )}
                  </div>
                  <input type="text" value={researcher.identifiers.idref || ''} onChange={(e) => onUpdateField('idref', e.target.value, 'identifiers')} className={idInput} />
                </div>
             </div>
             {/* IdHAL */}
             <div className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-white/5 border border-ink/5 dark:border-white/10">
                <span className="w-9 h-9 rounded-xl bg-ink text-white dark:bg-[#f5f2ea] dark:text-ink flex items-center justify-center text-[10px] font-extrabold flex-shrink-0">HAL</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] text-muted-lighter dark:text-[#8f897c]">IdHAL</span>
                    {researcher.identifiers.halId && (
                      <a href={`https://hal.science/search/index/q/*/authIdHal_s/${researcher.identifiers.halId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-muted dark:text-[#8f897c] hover:underline">
                        <ExternalLink className="w-3 h-3" /> hal.science
                      </a>
                    )}
                  </div>
                  <input type="text" value={researcher.identifiers.halId || ''} onChange={(e) => onUpdateField('halId', e.target.value, 'identifiers')} className={idInput} />
                </div>
             </div>
             {/* IdHAL_i (numeric HAL identifier → `idhali` of people.csv for CRISalid) */}
             <div className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-white/5 border border-ink/5 dark:border-white/10">
                <span className="w-9 h-9 rounded-xl bg-ink/80 text-white dark:bg-[#f5f2ea]/80 dark:text-ink flex items-center justify-center text-[9px] font-extrabold flex-shrink-0">HAL<sub className="text-[8px]">i</sub></span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] text-muted-lighter dark:text-[#8f897c]" title={t`HAL numeric identifier (idHal_i)`}>IdHAL_i</span>
                    {researcher.identifiers.halIdNum && (
                      <a href={`https://hal.science/search/index/q/*/authIdHal_i/${researcher.identifiers.halIdNum}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-muted dark:text-[#8f897c] hover:underline">
                        <ExternalLink className="w-3 h-3" /> hal.science
                      </a>
                    )}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={t`Digits only, e.g. 123456`}
                    value={researcher.identifiers.halIdNum || ''}
                    onChange={(e) => onUpdateField('halIdNum', e.target.value.replace(/\D/g, ''), 'identifiers')}
                    className={idInput}
                  />
                </div>
             </div>
             {/* Scopus */}
             <div className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-white/5 border border-ink/5 dark:border-white/10">
                <span className="w-9 h-9 rounded-xl bg-scopus text-white flex items-center justify-center text-[12px] font-extrabold flex-shrink-0">Sc</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] text-muted-lighter dark:text-[#8f897c]">Scopus ID</span>
                    {researcher.identifiers.scopusId && (
                      <a href={`https://www.scopus.com/authid/detail.uri?authorId=${researcher.identifiers.scopusId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-scopus hover:underline">
                        <ExternalLink className="w-3 h-3" /> scopus.com
                      </a>
                    )}
                  </div>
                  <input type="text" value={researcher.identifiers.scopusId || ''} onChange={(e) => onUpdateField('scopusId', e.target.value, 'identifiers')} className={idInput} />
                </div>
             </div>
          </div>
       </div>

       {/* Memberships & history — dark card, right column (top) */}
       <div className="lg:col-start-2 lg:row-start-1 min-w-0">
         <AffiliationsTable
            affiliations={affiliations}
            onAdd={onAddAffiliation}
            onRemove={onRemoveAffiliation}
            onChange={onAffiliationChange}
            onNavigateToStructure={onNavigateToStructure}
            labOptions={labOptions}
            teamOptions={teamOptions}
            onCreateTeam={onCreateTeam}
            employmentEndDate={researcher.employment.endDate || ''}
            onCopyEndDateToEmployment={(d) => onUpdateField('endDate', d, 'employment')}
         />
       </div>

       {/* Civil status — right column (bottom), aligns at the bottom with the identifiers */}
       <div className="glass-card p-5 md:p-6 lg:col-start-2 lg:row-start-2 min-w-0">
         <div className="section-label mb-4"><Trans>Personal details</Trans></div>
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {onLdapLookup && (
              <LdapUidLookup uid={researcher.uid || ''} onUidChange={(v) => onUpdateField('uid', v)} onLookup={onLdapLookup} autoRun={ldapAutoRun} />
            )}
            <div>
              <label className={fieldLabel}><Trans context="honorific">Title</Trans></label>
              <select value={researcher.civility} onChange={(e) => onUpdateField('civility', e.target.value)} className="input-soft">
                <option value="">-</option>
                <option value="F">F</option>
                <option value="M">M</option>
              </select>
            </div>
            <div>
              <label className={fieldLabel}><Trans>Last name</Trans></label>
              <input type="text" value={researcher.lastName} onChange={(e) => onUpdateField('lastName', e.target.value)} className="input-soft" />
            </div>
            <div>
              <label className={fieldLabel}><Trans>First name</Trans></label>
              <input type="text" value={researcher.firstName} onChange={(e) => onUpdateField('firstName', e.target.value)} className="input-soft" />
            </div>
            <div>
              <label className={fieldLabel}><Trans>Nationality</Trans></label>
              <input type="text" value={researcher.nationality || ''} onChange={(e) => onUpdateField('nationality', e.target.value)} className="input-soft" />
            </div>
            <div>
              <LdapFieldLabel label={t`Date of birth`} fromLdap={researcher.ldapFields?.includes('birthDate')} />
              <input
                type="date"
                value={researcher.birthDate || ''}
                onChange={(e) => onUpdateField('birthDate', e.target.value)}
                disabled={researcher.ldapFields?.includes('birthDate')}
                className={`input-soft${researcher.ldapFields?.includes('birthDate') ? ' opacity-60 cursor-not-allowed' : ''}`}
              />
            </div>
            {!onLdapLookup && (
            <div>
              <label className={fieldLabel}><Trans>UID (Dyna)</Trans></label>
              <input
                type="text"
                value={researcher.uid || ''}
                onChange={(e) => onUpdateField('uid', e.target.value)}
                className={`input-soft font-mono ${researcher.id.startsWith('NEW-') ? '' : 'opacity-60'}`}
                readOnly={!researcher.id.startsWith('NEW-')}
              />
            </div>
            )}
            {/* HR staff number (lib/hrId.ts): filled by the LDAP sync or the HR list imports, never typed. */}
            {researcher.hrId && (
            <div>
              <label className={fieldLabel} title={t`HR staff number (Mangue), from LDAP or the HR lists — read-only`}><Trans>Staff number</Trans></label>
              <input type="text" value={researcher.hrId} readOnly className="input-soft font-mono opacity-60" />
            </div>
            )}
         </div>
       </div>

       {/* Emploi & contrat — pleine largeur, style secondaire */}
       <div className="rounded-panel bg-white/40 dark:bg-white/[.03] border border-dashed border-ink/15 dark:border-white/15 p-5 md:p-6 lg:col-span-2 lg:col-start-1 lg:row-start-3">
          <div className="text-xs font-bold uppercase tracking-[.09em] text-muted-faint dark:text-[#8f897c] mb-4"><Trans>Employment & contract</Trans></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div>
               <label className={secLabel}><Trans>Employing institution</Trans></label>
               <select
                 value={researcher.employment.employer}
                 onChange={(e) => onUpdateField('employer', e.target.value, 'employment')}
                 className={secInput}
               >
                 <option value="">{t`— None —`}</option>
                 {researcher.employment.employer && !employerOptions.includes(researcher.employment.employer) && (
                   <option value={researcher.employment.employer}>{t`${researcher.employment.employer} (not in list)`}</option>
                 )}
                 {employerOptions.map((e) => (
                   <option key={e} value={e}>{e}</option>
                 ))}
               </select>
             </div>
             <div>
               <LdapFieldLabel label={t`Grade / Rank`} fromLdap={researcher.employment.ldapFields?.includes('grade')} />
               <GradeSelect
                 value={researcher.employment.grade || ''}
                 onChange={(code) => onUpdateField('grade', code, 'employment')}
                 disabled={researcher.employment.ldapFields?.includes('grade')}
                 className={`${secInput}${researcher.employment.ldapFields?.includes('grade') ? ' opacity-60 cursor-not-allowed' : ''}`}
               />
             </div>
             <div>
               <LdapFieldLabel label={t`Employment type`} fromLdap={researcher.employment.ldapFields?.includes('contractType')} />
               <select
                 value={researcher.employment.contractType || ''}
                 onChange={(e) => onUpdateField('contractType', e.target.value, 'employment')}
                 disabled={researcher.employment.ldapFields?.includes('contractType')}
                 className={`${secInput}${researcher.employment.ldapFields?.includes('contractType') ? ' opacity-60 cursor-not-allowed' : ''}`}
               >
                 <option value="">{t`— Undefined —`}</option>
                 <option value="TITULAIRE">TITULAIRE</option>
                 <option value="CDI UNIVERSITE">CDI UNIVERSITE</option>
                 <option value="CDD UNIVERSITE">CDD UNIVERSITE</option>
                 <option value="APPRENTI">APPRENTI</option>
                 <option value="CHERCHEUR INVITE">CHERCHEUR INVITE</option>
                 <option value="CNRS-INSERM">CNRS-INSERM</option>
                 <option value="DECEDE">DECEDE</option>
                 <option value="DOCTORANT">DOCTORANT</option>
                 <option value="ELU.E ETUDIANT.E">ELU.E ETUDIANT.E</option>
                 <option value="ENSEIGNANT HEBERGE">ENSEIGNANT HEBERGE</option>
                 <option value="MAITRE DE CONFERENCES HONORAIRE">MAITRE DE CONFERENCES HONORAIRE</option>
                 <option value="MEMBRE ASSOCIATION">MEMBRE ASSOCIATION</option>
                 <option value="PERSONNALITE EXTERIEURE">PERSONNALITE EXTERIEURE</option>
                 <option value="PERSONNEL STRUCTURE PARTENAIRE">PERSONNEL STRUCTURE PARTENAIRE</option>
                 <option value="PRESTATAIRE">PRESTATAIRE</option>
                 <option value="PRESTATAIRE INTEGRE">PRESTATAIRE INTEGRE</option>
                 <option value="PROFESSEUR EMERITE">PROFESSEUR EMERITE</option>
                 <option value="RETRAITE">RETRAITE</option>
                 <option value="STAGIAIRE">STAGIAIRE</option>
                 <option value="VACATAIRE">VACATAIRE</option>
               </select>
             </div>
             <div className="grid grid-cols-2 gap-4">
               <div>
                 <label className={secLabel} title={t`Contract / employment dates (Grist employment_* columns), distinct from the lab membership dates entered in the Memberships card. Imprecise dates accepted: YYYY or YYYY-MM.`}><Trans>Employment start</Trans></label>
                 <FuzzyDateInput value={researcher.employment.startDate || ''} onChange={(d) => onUpdateField('startDate', d, 'employment')} className={secInput} wrapperClassName="w-full" />
               </div>
               <div>
                 <label className={secLabel} title={t`Contract / employment end (YYYY, YYYY-MM or YYYY-MM-DD). For an external record (no LDAP state), a past date switches the status to « Left »; with a past membership end as well, « Left » applies even to a validated record.`}><Trans>Employment end</Trans></label>
                 <FuzzyDateInput value={researcher.employment.endDate || ''} onChange={(d) => onUpdateField('endDate', d, 'employment')} className={secInput} wrapperClassName="w-full" />
               </div>
             </div>
             {showFte && (
               <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className={secLabel} title={t`Share of a full-time position (0 to 1, e.g. 0.5). Empty = not provided.`}><Trans>FTE (working time)</Trans></label>
                   <FteInput value={researcher.employment.fte} onChange={(v) => onUpdateField('fte', v, 'employment')} className={secInput} />
                 </div>
                 <div>
                   <label className={secLabel} title={t`Research full-time equivalent (0 to 1): usually 0.5 for a teacher-researcher, 1 for a full-time researcher. Empty = not provided (a default from the grade will be used in the dashboard); 0 = no research time.`}><Trans>Research FTE</Trans></label>
                   <FteInput value={researcher.employment.researchFte} onChange={(v) => onUpdateField('researchFte', v, 'employment')} className={secInput} />
                 </div>
               </div>
             )}
             <div className="flex gap-6 items-end md:col-span-2">
               <div className="flex-1">
                  <label className="flex items-center gap-3 cursor-pointer">
                     <input
                       type="checkbox"
                       checked={!!researcher.nuFields?.hdr}
                       onChange={(e) => onUpdateField('hdr', e.target.checked, 'nuFields')}
                       className="w-4 h-4 rounded accent-ink dark:accent-accent"
                     />
                     <span className="text-[13px] font-semibold text-[#4b473e] dark:text-[#e7e2d6]"><Trans>Accredited to supervise research (HDR)</Trans></span>
                  </label>
               </div>
               {researcher.nuFields?.hdr && (
                 <div className="w-1/3">
                    <label className={secLabel}><Trans>HDR year</Trans></label>
                    <input type="text" value={researcher.nuFields?.hdrYear || ''} onChange={(e) => onUpdateField('hdrYear', e.target.value, 'nuFields')} className={secInput} />
                 </div>
               )}
             </div>
          </div>
       </div>

       {/* Nantes Université (`Pôle` / `Composante` / `ED` / `Localisation`) — hidden for
           now (little use). Set SHOW_NU_BLOCK to true to show it again;
           the nuFields data stays loaded and saved. */}
       {SHOW_NU_BLOCK && (
       <div className="rounded-panel bg-white/40 dark:bg-white/[.03] border border-dashed border-ink/15 dark:border-white/15 p-5 md:p-6 lg:col-span-2 lg:col-start-1 lg:row-start-4">
          <div className="text-xs font-bold uppercase tracking-[.09em] text-muted-faint dark:text-[#8f897c] mb-4">Nantes Université</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
             <div>
                <label className={secLabel}><Trans>Cluster</Trans></label>
                <input type="text" value={researcher.nuFields?.pole || ''} onChange={(e) => onUpdateField('pole', e.target.value, 'nuFields')} className={secInput} />
             </div>
             <div>
                <label className={secLabel}><Trans>Faculty</Trans></label>
                <input type="text" value={researcher.nuFields?.composante || ''} onChange={(e) => onUpdateField('composante', e.target.value, 'nuFields')} className={secInput} />
             </div>
             <div>
                <label className={secLabel}><Trans>Doctoral school</Trans></label>
                <input type="text" value={researcher.nuFields?.doctoralSchool || ''} onChange={(e) => onUpdateField('doctoralSchool', e.target.value, 'nuFields')} className={secInput} />
             </div>
             <div>
                <label className={secLabel}><Trans>Location (site)</Trans></label>
                <input type="text" value={researcher.nuFields?.location || ''} onChange={(e) => onUpdateField('location', e.target.value, 'nuFields')} className={secInput} />
             </div>
          </div>
       </div>
       )}
    </div>
  );
};
