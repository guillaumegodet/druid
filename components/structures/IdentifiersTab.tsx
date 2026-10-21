import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Fingerprint, Link2, Plus, RefreshCw, X } from 'lucide-react';
import { Structure, StructureLevel } from '../../types';
import { Trans, useLingui } from '@lingui/react/macro';
import { DirectoryApi } from '../../lib/directoryApi';
import { apiErrorText } from '../../lib/apiErrors';
import { hasCapability, canWrite } from '../../lib/auth';
import { numberLocale } from '../../lib/i18n';
import { STRUCTURE_ID_META, type StructureIdType, type StructureIdentifier } from '../../lib/structures/identifiers';

interface IdentifiersTabProps {
  structure: Structure;
  onUpdateField: (field: keyof Structure, value: any) => void;
  /** « New structure » page: the identifiers are typed in the form (written with the record). */
  isNew?: boolean;
}

const inputClass = "input-soft font-mono";
const labelClass = "block text-[11px] font-semibold text-muted-light dark:text-[#8f897c] mb-1";

/** Types shown on the record by level (decision of 2026-10-21): a lab carries the harvesting identifiers, an
 * institution or a grouping its legal and registry ones; a team carries none (the harvesting uses its lab's). */
const RECORD_TYPES: Record<string, StructureIdType[]> = {
  [StructureLevel.ENTITE]: ['rnsr', 'ror', 'hal_struct', 'hal_collection', 'openalex', 'idref', 'wikidata', 'scopus_affil'],
  [StructureLevel.ETABLISSEMENT]: ['uai', 'siret', 'ror', 'idref', 'wikidata', 'isni', 'grid', 'openalex', 'hal_struct', 'scopus_affil'],
  [StructureLevel.INTERMEDIAIRE]: ['uai', 'ror', 'idref', 'wikidata', 'isni', 'hal_struct', 'openalex'],
  [StructureLevel.EQUIPE]: [],
};

/**
 * Identifiers of an existing structure on PostgreSQL (druid-internal docs/plan-druid-saas.md, lot 4 d): the
 * multi-valued list of structure_identifier — primary, source, date of the last check, link to the record — with
 * « add », « remove », « make primary ». The decisions on the alignment candidates stay on the alignment page.
 */
const IdentifierList: React.FC<{ recordId: number; writable: boolean; types: StructureIdType[] }> = ({ recordId, writable, types }) => {
  const { t } = useLingui();
  const [items, setItems] = useState<StructureIdentifier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<StructureIdType | null>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    let alive = true;
    DirectoryApi.structureIdentifiers(recordId).then((v) => { if (alive) setItems(v); }).catch((e) => { if (alive) setError(apiErrorText(e) || String(e)); });
    return () => { alive = false; };
  }, [recordId]);
  const act = async (fn: () => Promise<StructureIdentifier[]>) => {
    setBusy(true);
    try { setItems(await fn()); setError(null); } catch (e) { setError(apiErrorText(e) || String(e)); } finally { setBusy(false); }
  };
  if (error && !items) return <p className="text-[13px] font-semibold text-[#b3441f] dark:text-[#e08a6a]">{error}</p>;
  if (!items) return <div className="flex items-center gap-2 text-muted-faint text-[13px]"><RefreshCw className="w-4 h-4 animate-spin" /> {t`Loading…`}</div>;
  const confirmed = items.filter((i) => i.status === 'confirmed');
  return (
    <div className="space-y-3">
      {error && <p className="text-[12.5px] font-semibold text-[#b3441f] dark:text-[#e08a6a]">{error}</p>}
      {types.map((type) => {
        const meta = STRUCTURE_ID_META[type];
        const values = confirmed.filter((i) => i.type === type);
        if (!values.length && !writable) return null;
        return (
          <div key={type} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5 border-b border-ink/5 dark:border-white/5 last:border-b-0">
            <span className="w-36 shrink-0 text-[11px] font-bold uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c] pt-1">{meta.label}</span>
            <div className="flex-1 min-w-0 space-y-1">
              {values.length === 0 && <span className="text-[12px] text-muted-faint">—</span>}
              {values.map((i) => {
                const bad = i.checkResult && (i.checkResult as any).ok === false;
                return (
                  <div key={i.value} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11.5px] font-bold text-ink dark:text-[#e7e2d6] hover:underline"><Link2 className="w-3 h-3" /> {i.value}</a>
                    {meta.multi && i.isPrimary && values.length > 1 && <span className="px-2 py-0.5 rounded-full bg-ink text-white dark:bg-[#f5f2ea] dark:text-ink text-[10.5px] font-bold"><Trans>primary</Trans></span>}
                    <span className="text-muted-faint text-[11.5px]" title={t`Source of the value`}>{i.source}{i.checkedAt ? ` · ${t`checked on`} ${new Date(i.checkedAt).toLocaleDateString(numberLocale())}` : ''}</span>
                    {bad && <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#8a6113] dark:text-[#f0c266]"><AlertTriangle className="w-3 h-3" /> {(i.checkResult as any).exists === false ? t`record not found` : (i.checkResult as any).closed ? t`closed record` : t`record names something else`}</span>}
                    {writable && (
                      <span className="flex items-center gap-2">
                        {meta.multi && !i.isPrimary && <button type="button" disabled={busy} onClick={() => act(() => DirectoryApi.setPrimaryStructureIdentifier(recordId, type, i.value))} className="text-[11.5px] font-semibold underline text-muted hover:text-ink dark:hover:text-[#f5f2ea] disabled:opacity-50"><Trans>make primary</Trans></button>}
                        <button type="button" disabled={busy} onClick={() => { if (window.confirm(t`Remove ${i.value}? It will not be suggested again by the alignment.`)) act(() => DirectoryApi.removeStructureIdentifier(recordId, type, i.value)); }} className="text-[11.5px] font-semibold underline text-muted hover:text-[#b23b3b] disabled:opacity-50"><Trans>remove</Trans></button>
                      </span>
                    )}
                  </div>
                );
              })}
              {writable && adding === type && (
                <form className="flex items-center gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); if (!value.trim()) return; act(() => DirectoryApi.addStructureIdentifier(recordId, type, value.trim())).then(() => { setValue(''); setAdding(null); }); }}>
                  <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={t`Identifier or URL`} className="input-soft !w-72 h-9 py-1 font-mono text-[12.5px]" />
                  <button type="submit" disabled={busy || !value.trim()} className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-ink text-white dark:bg-accent dark:text-ink text-[12px] font-semibold disabled:opacity-50"><Check className="w-3.5 h-3.5" /> <Trans>Add</Trans></button>
                  <button type="button" onClick={() => { setAdding(null); setValue(''); }} className="inline-flex items-center h-9 px-2 rounded-full border border-ink/15 dark:border-white/15 text-[12px]"><X className="w-3.5 h-3.5" /></button>
                </form>
              )}
            </div>
            {writable && adding !== type && (values.length === 0 || meta.multi) && (
              <button type="button" disabled={busy} onClick={() => { setAdding(type); setValue(''); }} title={t`Add a ${meta.label} identifier`}
                className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-full border border-ink/15 dark:border-white/15 text-[11.5px] font-semibold text-muted hover:text-ink dark:hover:text-[#f5f2ea] hover:bg-white/70 dark:hover:bg-white/10 disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> <Trans>Add</Trans>
              </button>
            )}
          </div>
        );
      })}
      <p className="text-[12px] text-muted-faint pt-1"><Trans>Candidates found by the alignment are reviewed on the Alignment page, Structures tab.</Trans></p>
    </div>
  );
};

export const IdentifiersTab: React.FC<IdentifiersTabProps> = ({
  structure,
  onUpdateField,
  isNew = false,
}) => {
  const { t } = useLingui();
  const ids = structure.identifiers || {};
  const updateId = (key: string, value: string) =>
    onUpdateField('identifiers', { ...ids, [key]: value });
  const recordId = Number(String(structure.id || '').replace(/^S-/, '')) || 0;
  const useList = !isNew && recordId > 0 && hasCapability('HAS_STRUCTURE_IDS');

  return (
    <div className="space-y-10 animate-in fade-in duration-300">
       <div className={`grid grid-cols-1 ${useList ? 'lg:grid-cols-[3fr_2fr]' : 'md:grid-cols-2'} gap-10`}>
          <div className="space-y-6">
             <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
                <Fingerprint className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
                <h3 className="section-label"><Trans>Third-party identifiers</Trans></h3>
             </div>
             {useList && String(structure.level) === StructureLevel.EQUIPE ? (
               <p className="text-[13px] text-muted dark:text-[#8f897c]"><Trans>A team carries no identifier of its own: the publications are harvested through the identifiers of its lab.</Trans></p>
             ) : useList ? <IdentifierList recordId={recordId} writable={canWrite()} types={RECORD_TYPES[String(structure.level)] || RECORD_TYPES[StructureLevel.ENTITE]} /> : (
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
               {!useList && (
               <div>
                  <label className={labelClass}><Trans>HAL collection</Trans></label>
                  <input type="text" value={structure.halCollectionUrl || ''} onChange={(e) => onUpdateField('halCollectionUrl', e.target.value)} className={inputClass} placeholder="https://hal.science/..." />
               </div>
               )}
             </div>
             )}
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
                  <label className={labelClass}><Trans>Bibliographic signature</Trans></label>
                  <textarea value={structure.signature || ''} onChange={(e) => onUpdateField('signature', e.target.value)} rows={3} className="input-soft" placeholder={t`Nantes Université, …`} />
               </div>
             </div>
          </div>
       </div>
    </div>
  );
};

