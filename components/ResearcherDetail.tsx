import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Save, RefreshCw, FileDown, ExternalLink, Database, ShieldCheck, X, Pencil, ImageOff, ClipboardList } from 'lucide-react';
import { Researcher, ResearcherStatus, Affiliation, Structure, StructureLevel, ViewState } from '../types';
import { GristService } from '../lib/gristService';
import { ExportService } from '../lib/exportService';
import { canUseEstablishmentTools, getUserInfo, hasCapability } from '../lib/auth';
import type { ValidationInfo, ValidationScope } from '../lib/validation';
import { Trans, useLingui } from '@lingui/react/macro';
import { STATUS_LABELS, VALIDATION_SCOPE_LABELS } from '../lib/researcherLabels';

// Sub-components
import { GeneralTab } from './researchers/GeneralTab';
import { MediaPresenceSection } from './researchers/MediaPresenceSection';
import { AffiliationHistorySection } from './researchers/AffiliationHistorySection';
import { SuggestionsSection } from './researchers/SuggestionsSection';
import { ValidationMark } from './researchers/StatusBadge';
import { HelpButton } from './HelpButton';
import { VIEW_HELP } from '../lib/helpLinks';
import { gristUiDocUrl } from '../lib/instanceRuntime';
import { fetchLdapPerson, prefillFromLdap } from '../lib/ldapPerson';
import type { LdapLookupOutcome } from './researchers/LdapUidLookup';


/** Status badge overlaid on the hero photo (photo background → opaque pills). */
const heroStatusPill =
  'inline-flex items-center h-7 px-3 rounded-full text-xs font-semibold text-white border border-white/25 backdrop-blur-sm';

/** Props of the ResearcherDetail component */
interface ResearcherDetailProps {
  /** The researcher to display/edit */
  researcher: Researcher;
  /** Callback returning to the list */
  onBack: () => void;
  /** Save callback */
  onSave?: (updated: Researcher) => void;
  /** Save-in-progress state */
  isSaving?: boolean;
  /** Custom callback navigating to the structure record */
  onNavigateToStructure?: (structureId: string) => void;
  /** Grist structures — feeds the Structure/Team dropdowns of the memberships */
  structures?: Structure[];
  /**
   * Validation callback: persists the record's validation layer
   * (date + validator set automatically here, Grist write on the parent side).
   */
  onValidate?: (updated: Researcher) => void;
  /** « Ajouter une équipe… » in the Team menu: opens the creation of a team attached to this lab. */
  onCreateTeam?: (structureName: string) => void;
  /** « Report a correction »: opens the « À traiter › Tâches » form with this researcher
   * prefilled (docs/plan-chantiers-taches.md, lot 2). Admins only — undefined hides the button. */
  onReportTask?: (researcher: Researcher) => void;
  /** Record opened by « Create » of the LDAP arrivals: « Fill from LDAP » runs once on opening. */
  autoLdapLookup?: boolean;
}

/**
 * @component ResearcherDetail
 * @description Detail view allowing full editing of a researcher profile.
 */
export const ResearcherDetail: React.FC<ResearcherDetailProps> = ({ researcher, onBack, onSave, isSaving, onNavigateToStructure, onValidate, structures = [], onCreateTeam, onReportTask, autoLdapLookup }) => {
  const { t } = useLingui();
  // Local state for the form
  const [localResearcher, setLocalResearcher] = useState<Researcher>({...researcher});
  const [affiliations, setAffiliations] = useState<Affiliation[]>(researcher.affiliations || []);

  // Options of the affiliation dropdowns — limited to Grist values.
  // Labs = research structures (level « Unité »); teams = level « Équipe »,
  // with their parent lab to filter the menu by the chosen structure.
  const labOptions = useMemo(
    () => structures
      .filter((s) => s.level === StructureLevel.ENTITE)
      .map((s) => s.acronym || s.officialName)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'fr')),
    [structures]
  );
  const teamOptions = useMemo(
    () => structures
      .filter((s) => s.level === StructureLevel.EQUIPE)
      .map((s) => ({ name: s.acronym || s.officialName, parent: s.parentStructure }))
      .filter((t) => t.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [structures]
  );
  // Employer institutions (Grist table Etablissements, cached on the service side).
  const [employerOptions, setEmployerOptions] = useState<string[]>([]);
  useEffect(() => {
    GristService.fetchInstitutions()
      .then((etabs) => setEmployerOptions(etabs.map((e) => e.name)))
      .catch(() => setEmployerOptions([])); // table unreachable → only « (hors liste) » will remain
  }, []);
  const [groups, setGroups] = useState<string[]>(researcher.groups || []);
  // Medallion: falls back to the initials if the photo (external URL from the lab website) is broken.
  const [photoError, setPhotoError] = useState(false);
  // Photo URL editing (« modifier » icon on the thumbnail): local draft,
  // applied to localResearcher.photoUrl then persisted with « Enregistrer ».
  const [photoEditOpen, setPhotoEditOpen] = useState(false);
  const [photoDraft, setPhotoDraft] = useState(researcher.photoUrl || '');
  const openPhotoEdit = () => { setPhotoDraft(localResearcher.photoUrl || ''); setPhotoEditOpen(true); };
  const applyPhoto = (url: string) => {
    updateField('photoUrl', url.trim());
    setPhotoError(false);
    setPhotoEditOpen(false);
  };
  const photoDraftTrimmed = photoDraft.trim();
  const photoDraftValid = photoDraftTrimmed === '' || /^https?:\/\/\S+$/i.test(photoDraftTrimmed);
  const initials = ((researcher.lastName?.[0] || '') + (researcher.firstName?.[0] || '')).toUpperCase();

  // ─── Validation (manual validation of the record) ──────────────────────────
  const existingValidation = localResearcher.validation;
  const [validationOpen, setValidationOpen] = useState(false);
  const [vStatus, setVStatus] = useState<ResearcherStatus>(existingValidation?.validatedStatus ?? localResearcher.status);
  const [vScope, setVScope] = useState<ValidationScope[]>(
    existingValidation?.validationScope?.length ? existingValidation.validationScope : ['statut', 'rattachement'],
  );
  const [vSource, setVSource] = useState<string>(existingValidation?.validationSource ?? t`Manual validation (Druid)`);
  // Today's date + author: filled in automatically, not editable.
  const today = new Date().toISOString().slice(0, 10);
  const user = getUserInfo();
  const validatedBy = user.preferred_username || user.email || user.name || '';
  // Writing to Grist is only possible if the record has a rowId and is not a local creation.
  // Manual validation: not applicable on an instance without status/validation (HAS_STATUS_VALIDATION).
  const canValidate = hasCapability('HAS_STATUS_VALIDATION') && !!onValidate && !!researcher.gristRowId && !researcher.id.startsWith('NEW-');
  const isValidated = !!existingValidation?.validated;

  const toggleScope = (s: ValidationScope) =>
    setVScope((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  /** Applies (or removes) the validation then delegates the write to the parent. */
  const submitValidation = (validated: boolean) => {
    const validation: ValidationInfo = validated
      ? {
          validated: true,
          validatedStatus: vStatus,
          validationDate: today,
          validationSource: vSource.trim() || undefined,
          validationScope: vScope,
          validatedBy: validatedBy || undefined,
        }
      : { validated: false, validationScope: [] };
    const updated: Researcher = { ...localResearcher, affiliations, groups, validation };
    setLocalResearcher(updated);
    onValidate?.(updated);
    setValidationOpen(false);
  };

  /** Adds an empty affiliation row */
  const handleAddAffiliation = () => {
    setAffiliations([...affiliations, { structureName: '', team: '', startDate: '', isPrimary: affiliations.length === 0 }]);
  };

  /** Removes an affiliation row by index */
  const handleRemoveAffiliation = (index: number) => {
    const newAffiliations = [...affiliations];
    newAffiliations.splice(index, 1);
    setAffiliations(newAffiliations);
  };

  /** Handles the change of an affiliation property */
  const handleAffiliationChange = (index: number, field: keyof Affiliation, value: any) => {
    const newAffiliations = [...affiliations];
    if (field === 'isPrimary' && value === true) {
      newAffiliations.forEach(a => a.isPrimary = false); // Only one primary allowed
    }
    // Structure change → the team of the former lab no longer makes sense
    if (field === 'structureName') {
      newAffiliations[index].team = '';
    }
    // @ts-ignore
    newAffiliations[index][field] = value;
    setAffiliations(newAffiliations);
  };

  /** Helper updating a form field */
  const updateField = (field: string, value: any, subObject?: string) => {
    setLocalResearcher(prev => {
      const copy = { ...prev };
      if (subObject) {
         // @ts-ignore
         copy[subObject] = { ...copy[subObject], [field]: value };
      } else {
         // @ts-ignore
         copy[field] = value;
      }
      return copy;
    });
  };

  /** « Fill from LDAP » (record being created): LDAP entry → civil status, employment, lab. */
  const [autoLookup, setAutoLookup] = useState(!!autoLdapLookup);
  const handleLdapLookup = async (uid: string): Promise<LdapLookupOutcome> => {
    setAutoLookup(false); // a remount of the tab must not fill the record again over the user's edits
    const person = await fetchLdapPerson(uid);
    // The automatic lookup (record opened from the LDAP arrivals) runs on mount, before the employer
    // list has loaded: read it here rather than from the state, or the employer stays empty.
    const options = employerOptions.length ? employerOptions
      : await GristService.fetchInstitutions().then((etabs) => etabs.map((e) => e.name)).catch(() => []);
    const { researcher: next, lab, otherLabs, inferredEmployer } = prefillFromLdap(localResearcher, person, structures, options);
    setLocalResearcher(next);
    const lines = [t`Filled from LDAP: ${next.displayName}.`];
    let tone: LdapLookupOutcome['tone'] = 'ok';
    if (!inferredEmployer && !next.employment.employer) {
      lines.push(t`Employer not deducible from LDAP (hosted account, ambiguous corps): choose it under Employment & contract.`);
      tone = 'warn';
    }
    if (lab) {
      // Only an empty membership is filled: a lab chosen by hand is kept.
      if (!affiliations.some((a) => a.structureName)) {
        setAffiliations(affiliations.length
          ? affiliations.map((a, i) => (i === 0 ? { ...a, structureName: lab, team: '' } : a))
          : [{ structureName: lab, team: '', startDate: '', isPrimary: true }]);
        lines.push(t`Lab: ${lab}.`);
      }
      if (otherLabs.length) lines.push(t`Other labs in LDAP: ${otherLabs.join(', ')} — add them as memberships if relevant.`);
    } else {
      const affectation = person.affectationPrincipaleLabel || t`none`;
      lines.push(t`No known lab among the LDAP affectations (principal: ${affectation}): choose it in Memberships.`);
      tone = 'warn';
    }
    const existing = await GristService.fetchAnnuaireRowsByUid(person.uid).catch(() => []);
    if (existing.length) {
      const labs = existing.map((r) => String(r.fields['LABO'] || '—')).join(', ');
      lines.push(t`This uid already has a directory record (${labs}): check it before creating a duplicate.`);
      tone = 'warn';
    }
    return { tone, lines };
  };

  /** Summary and save */
  const handleSave = () => {
    const updated: Researcher = {
      ...localResearcher,
      affiliations,
      groups
    };
    onSave?.(updated);
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="px-4 md:px-7 py-4 flex-1 overflow-auto">

        {/* Top row: round back button + breadcrumb + pill actions */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={onBack}
              title={t`Back to the list`}
              className="w-11 h-11 flex-shrink-0 rounded-full bg-white/80 dark:bg-white/10 border border-white/90 dark:border-white/15 flex items-center justify-center text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="text-sm text-muted dark:text-[#8f897c] truncate">
              <Trans>People</Trans> <span className="text-muted-faint">/</span>{' '}
              <span className="text-ink dark:text-[#f5f2ea] font-semibold">{researcher.lastName} {researcher.firstName}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {researcher.annuaireUrl && (
              <a
                href={researcher.annuaireUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-pill"
              >
                <ExternalLink className="w-4 h-4" /> <Trans>Directory</Trans>
              </a>
            )}
            {/* Human-facing link to the Grist document (Annuaire table): Grist exposes no stable
                link to a row without the internal section id, so we open the document. */}
            {gristUiDocUrl() && (
              <a
                href={gristUiDocUrl()!}
                target="_blank"
                rel="noopener noreferrer"
                title={t`Open the Grist document (Annuaire table)`}
                className="btn-pill"
              >
                <Database className="w-4 h-4" /> Grist
              </a>
            )}
            {canValidate && (
              <button
                onClick={() => setValidationOpen(true)}
                title={isValidated ? t`Validated record — click to review / unvalidate` : t`Validate this record`}
                className={isValidated ? 'btn-pill-accent' : 'btn-pill'}
              >
                <ShieldCheck className="w-4 h-4" /> {isValidated ? t`Validated record` : t`Validate the record`}
              </button>
            )}
            {onReportTask && !researcher.id.startsWith('NEW-') && (
              <button
                onClick={() => onReportTask(localResearcher)}
                title={t`Create a task to carry out outside Druid for this researcher (IdRef, ORCID, HAL…)`}
                className="btn-pill"
              >
                <ClipboardList className="w-4 h-4" /> <Trans>Report a correction</Trans>
              </button>
            )}
            <HelpButton path={VIEW_HELP[ViewState.RESEARCHER_DETAIL]} pill />
            <button
              onClick={() => ExportService.exportSingleResearcherPDF(localResearcher)}
              className="btn-pill"
            >
              <FileDown className="w-4 h-4" /> <Trans>Export PDF</Trans>
            </button>
            <button onClick={onBack} disabled={isSaving} className="btn-pill disabled:opacity-50">
               <Trans>Cancel</Trans>
            </button>
            {onSave && (
              <button onClick={handleSave} disabled={isSaving} className="btn-pill-dark disabled:opacity-50">
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {researcher.id.startsWith('NEW-') ? t`Create the record` : t`Save`}
              </button>
            )}
          </div>
        </div>

        {/* Body: two balanced columns (left 300px: photo + identifiers;
            right: dark memberships + civil status) then full-width sections.
            GeneralTab uses `display:contents`: its cards are placed in this grid. */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-stretch">

          {/* Hero photo card (or gradient avatar) — status + name overlaid at the bottom */}
          <div className="relative rounded-panel overflow-hidden shadow-soft-lg min-h-[300px] lg:col-start-1 lg:row-start-1">
            {localResearcher.photoUrl && !photoError ? (
              <img
                src={localResearcher.photoUrl}
                alt={`${researcher.lastName} ${researcher.firstName}`}
                referrerPolicy="no-referrer"
                onError={() => setPhotoError(true)}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-[#3b5bdb] to-[#7048e8] flex items-center justify-center">
                <span className="font-disp font-bold text-white/90 text-7xl tracking-tight select-none">{initials || '?'}</span>
              </div>
            )}
            {/* Readability veil + overlaid content */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(20,16,6,.82)] pointer-events-none"></div>
            {/* « modifier » icon → photo URL input */}
            <button
              type="button"
              onClick={openPhotoEdit}
              title={t`Edit photo (URL)`}
              aria-label={t`Edit photo (URL)`}
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white border border-white/30 backdrop-blur-sm flex items-center justify-center transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
            {localResearcher.photoUrl && photoError && (
              <span className="absolute top-3 left-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold text-white bg-[rgba(214,69,69,.85)] border border-white/25" title={localResearcher.photoUrl}>
                <ImageOff className="w-3.5 h-3.5" /> <Trans>Photo unavailable</Trans>
              </span>
            )}
            <div className="absolute left-0 right-0 bottom-0 p-5">
              {/* Internal/external status + validation: configurable per instance (HAS_STATUS_VALIDATION). */}
              {hasCapability('HAS_STATUS_VALIDATION') && (
                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  {researcher.status === ResearcherStatus.INTERNE && <span className={`${heroStatusPill} bg-[rgba(46,160,102,.85)]`}>● {t(STATUS_LABELS[researcher.status])}</span>}
                  {researcher.status === ResearcherStatus.DEPART && <span className={`${heroStatusPill} bg-[rgba(214,69,69,.85)]`}>● {t(STATUS_LABELS[researcher.status])}</span>}
                  {researcher.status === ResearcherStatus.PARTI && <span className={`${heroStatusPill} bg-[rgba(59,91,219,.85)]`}>● {t(STATUS_LABELS[researcher.status])}</span>}
                  {researcher.status === ResearcherStatus.EXTERNE && <span className={`${heroStatusPill} bg-[rgba(224,158,42,.9)]`}>● {t(STATUS_LABELS[researcher.status])}</span>}
                  <ValidationMark validation={researcher.validation} derivedStatus={researcher.derivedStatus} />
                </div>
              )}
              <div className="font-disp text-[22px] leading-tight font-bold text-white tracking-tight">
                {researcher.lastName} {researcher.firstName}
              </div>
              <p className="text-[11px] text-white/70 mt-1">
                <Trans>UID: {researcher.uid || t`not provided`} · Last sync: {researcher.lastSync}</Trans>
              </p>
            </div>
          </div>

          <GeneralTab
            researcher={localResearcher}
            affiliations={affiliations}
            onUpdateField={updateField}
            onAddAffiliation={handleAddAffiliation}
            onRemoveAffiliation={handleRemoveAffiliation}
            onAffiliationChange={handleAffiliationChange}
            onNavigateToStructure={onNavigateToStructure}
            labOptions={labOptions}
            teamOptions={teamOptions}
            onCreateTeam={onCreateTeam}
            employerOptions={employerOptions}
            onLdapLookup={onSave && localResearcher.id.startsWith('NEW-') && hasCapability('HAS_LDAP') && canUseEstablishmentTools() ? handleLdapLookup : undefined}
            ldapAutoRun={autoLookup}
          />
          {/* Career path (docs/plan-parcours-affiliations.md, lot 3): affiliations of the publications,
              ORCID positions, Scopus profile — full width. Needs the server job (Docker instances). */}
          {/* « Suggestions de l'établissement » (lot 5): hidden when there is nothing to suggest. */}
          {hasCapability('HAS_SERVER_JOBS') && !researcher.id.startsWith('NEW-') && (
            <div className="mt-4 lg:col-span-2 lg:col-start-1 empty:hidden">
              <SuggestionsSection researcher={localResearcher} />
            </div>
          )}
          {hasCapability('HAS_SERVER_JOBS') && !researcher.id.startsWith('NEW-') && (
            <div className="mt-4 lg:col-span-2 lg:col-start-1">
              <AffiliationHistorySection researcher={localResearcher} onUpdateField={onSave ? updateField : undefined} />
            </div>
          )}
          {/* Media monitoring: social networks + editable profiles/CV + lab mentions
              — full width (both grid columns). */}
          <div className="mt-4 lg:col-span-2 lg:col-start-1">
            {/* `affiliations` lives in its own state (edited by AffiliationsTable), not yet
                merged into localResearcher (only on save, see handleSave line
                186) — without this merge, the lab used for /api/mentions stays the one from before
                the current edit (code review lot 6b). */}
            <MediaPresenceSection researcher={{ ...localResearcher, affiliations }} onUpdateField={updateField} />
          </div>
        </div>
      </div>

      {/* Photo editing panel (URL → Grist column photo_url, via « Enregistrer ») */}
      {photoEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setPhotoEditOpen(false)}>
          <div
            className="w-full max-w-md rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
              <h3 className="font-disp text-lg font-bold text-ink dark:text-[#f5f2ea] flex items-center gap-2">
                <Pencil className="w-5 h-5" /> <Trans>Profile photo</Trans>
              </h3>
              <button onClick={() => setPhotoEditOpen(false)} className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:bg-ink/5 dark:text-[#8f897c] dark:hover:bg-white/10 transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-[#3b5bdb] to-[#7048e8] flex items-center justify-center">
                  {photoDraftTrimmed && photoDraftValid ? (
                    <img key={photoDraftTrimmed} src={photoDraftTrimmed} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-disp font-bold text-white/90 text-2xl select-none">{initials || '?'}</span>
                  )}
                </div>
                <p className="text-sm text-muted dark:text-[#8f897c]">
                  <Trans>Enter the address (http/https) of a public image: lab page, directory, HAL… Leave empty to fall back to the initials.</Trans>
                </p>
              </div>

              <label className="block">
                <span className="block text-xs text-muted-lighter dark:text-[#8f897c] mb-1"><Trans>Photo URL</Trans></span>
                <input
                  type="url"
                  autoFocus
                  value={photoDraft}
                  onChange={(e) => setPhotoDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && photoDraftValid) applyPhoto(photoDraft); }}
                  placeholder="https://…"
                  className="input-soft"
                />
                {!photoDraftValid && (
                  <span className="block mt-1 text-xs text-[#b23b3b] dark:text-[#f08c8c]"><Trans>The URL must start with http:// or https://.</Trans></span>
                )}
              </label>
              <p className="text-xs text-muted-light dark:text-[#8f897c]">
                <Trans>The change will be written to Grist (photo_url column) when you click “Save”.</Trans>
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-ink/5 dark:border-white/5">
              {localResearcher.photoUrl ? (
                <button
                  onClick={() => applyPhoto('')}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-full font-disp font-semibold text-sm bg-[rgba(214,69,69,.14)] text-[#b23b3b] hover:bg-[rgba(214,69,69,.22)] dark:text-[#f08c8c] transition-colors"
                >
                  <Trans>Remove photo</Trans>
                </button>
              ) : <span />}
              <div className="flex gap-2.5">
                <button onClick={() => setPhotoEditOpen(false)} className="btn-pill h-10"><Trans>Cancel</Trans></button>
                <button onClick={() => applyPhoto(photoDraft)} disabled={!photoDraftValid} className="btn-pill-dark h-10 disabled:opacity-50">
                  <Trans>Apply</Trans>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Validation panel (manual validation → Grist columns) */}
      {validationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setValidationOpen(false)}>
          <div
            className="w-full max-w-md rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
              <h3 className="font-disp text-lg font-bold text-ink dark:text-[#f5f2ea] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#1f7a4d] dark:text-[#5fd39a]" /> <Trans>Validate the record</Trans>
              </h3>
              <button onClick={() => setValidationOpen(false)} className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:bg-ink/5 dark:text-[#8f897c] dark:hover:bg-white/10 transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-muted dark:text-[#8f897c]">
                {researcher.lastName} {researcher.firstName}
              </p>

              {/* Validated status */}
              <label className="block">
                <span className="block text-xs text-muted-lighter dark:text-[#8f897c] mb-1"><Trans>Validated status</Trans></span>
                <select
                  value={vStatus}
                  onChange={(e) => setVStatus(e.target.value as ResearcherStatus)}
                  className="input-soft"
                >
                  {Object.values(ResearcherStatus).map((s) => (
                    <option key={s} value={s}>{t(STATUS_LABELS[s])}</option>
                  ))}
                </select>
              </label>

              {/* Validation scope */}
              <div>
                <span className="block text-xs text-muted-lighter dark:text-[#8f897c] mb-1"><Trans>Scope</Trans></span>
                <div className="mt-1 flex gap-4">
                  {(['statut', 'rattachement'] as ValidationScope[]).map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-[#f5f2ea] cursor-pointer">
                      <input type="checkbox" checked={vScope.includes(s)} onChange={() => toggleScope(s)} className="w-4 h-4 rounded accent-ink dark:accent-accent" />
                      {t(VALIDATION_SCOPE_LABELS[s])}
                    </label>
                  ))}
                </div>
              </div>

              {/* Source */}
              <label className="block">
                <span className="block text-xs text-muted-lighter dark:text-[#8f897c] mb-1"><Trans>Source</Trans></span>
                <input
                  type="text"
                  value={vSource}
                  onChange={(e) => setVSource(e.target.value)}
                  placeholder={t`E.g. 2026 lab survey, HR list…`}
                  className="input-soft"
                />
              </label>

              {/* Automatic fields (read-only) */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-white/60 dark:bg-white/5 border border-ink/10 dark:border-white/10 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]"><Trans>Date (auto)</Trans></div>
                  <div className="font-semibold text-ink dark:text-[#f5f2ea]">{today}</div>
                </div>
                <div className="rounded-xl bg-white/60 dark:bg-white/5 border border-ink/10 dark:border-white/10 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]"><Trans>Validated by (auto)</Trans></div>
                  <div className="font-semibold text-ink dark:text-[#f5f2ea] truncate" title={validatedBy}>{validatedBy || '—'}</div>
                </div>
              </div>

              {isValidated && existingValidation?.validationDate && (
                <p className="text-xs text-muted-light dark:text-[#8f897c]">
                  {existingValidation.validatedBy
                    ? t`Already validated on ${existingValidation.validationDate} by ${existingValidation.validatedBy}.`
                    : t`Already validated on ${existingValidation.validationDate}.`}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-ink/5 dark:border-white/5">
              {isValidated ? (
                <button
                  onClick={() => submitValidation(false)}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-full font-disp font-semibold text-sm bg-[rgba(214,69,69,.14)] text-[#b23b3b] hover:bg-[rgba(214,69,69,.22)] dark:text-[#f08c8c] transition-colors"
                >
                  <Trans>Unvalidate</Trans>
                </button>
              ) : <span />}
              <div className="flex gap-2.5">
                <button
                  onClick={() => setValidationOpen(false)}
                  className="btn-pill h-10"
                >
                  <Trans>Cancel</Trans>
                </button>
                <button
                  onClick={() => submitValidation(true)}
                  disabled={isSaving}
                  className="btn-pill-dark h-10 disabled:opacity-50"
                >
                  {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {isValidated ? t`Revalidate` : t`Validate`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
