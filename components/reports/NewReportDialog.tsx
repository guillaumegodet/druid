// Report creation in two clicks (docs/plan-mes-rapports.md § 4.2 and § 5): pick a template, check
// the pre-filled parameters (structure, period, scope, sometimes a country), create — the editor
// opens on a complete report, every block of which stays editable. Also opened from the
// dashboard (« Rapport PDF » button), pre-filled with the dashboard view.

import React, { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { countryLabel } from '../dashboard/labels';
import type { ReportPeriod } from '../dashboard/report/definition';
import type { ReportsBackend } from '../dashboard/report/reportsApi';
import {
  DEFAULT_PERIOD,
  instantiateReportTemplate,
  datasetPublishers,
  partnerCountries,
  REPORT_TEMPLATES,
  templateById,
} from '../dashboard/report/templates';
import type { ReportSummary } from '../dashboard/report/reportsApi';
import type { DashboardDataset } from '../dashboard/types';
import { buildPartnerCatalog, type PartnerCatalogEntry } from '../dashboard/collabAggregates';
import { consortiumPartnerGroups } from '../dashboard/consortia';
import { PartnerInstitutionPicker } from '../dashboard/PartnerInstitutionPicker';
import { affiliatedPartners } from '../dashboard/report/rorAffiliates';
import { FUNDER_CATEGORIES, FUNDER_CATEGORY_LABELS } from '../dashboard/fundersAggregates';
import { loadDashboardDataset } from '../dashboard/useDashboardData';
import { PerimetreSelect, PeriodInput, selectCls, StructureSelect, useStructureSlugs } from './ReportControls';

export interface NewReportInitial {
  templateId?: string;
  slug?: string;
  period?: ReportPeriod;
  perimetre?: 'affiliation' | 'effectifs';
}

export const NewReportDialog: React.FC<{
  backend: ReportsBackend;
  onClose: () => void;
  onCreated: (id: number) => void;
  initial?: NewReportInitial;
}> = ({ backend, onClose, onCreated, initial }) => {
  const { t, i18n } = useLingui();
  const { slugs, tabsHidden } = useStructureSlugs();
  const [templateId, setTemplateId] = useState(initial?.templateId ?? 'structure');
  // Instance templates: reports published by a super admin (templateId `report:<id>`).
  const [instanceTemplates, setInstanceTemplates] = useState<ReportSummary[]>([]);
  useEffect(() => {
    backend.list().then((l) => setInstanceTemplates(l.templates)).catch(() => setInstanceTemplates([]));
  }, [backend]);
  const instanceTemplate = templateId.startsWith('report:')
    ? instanceTemplates.find((r) => `report:${r.id}` === templateId) ?? null
    : null;
  const template = instanceTemplate ? templateById('blank')! : templateById(templateId) ?? REPORT_TEMPLATES[0];
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [period, setPeriod] = useState<ReportPeriod>(initial?.period ?? DEFAULT_PERIOD);
  const [perimetre, setPerimetre] = useState<'affiliation' | 'effectifs'>(initial?.perimetre ?? 'affiliation');
  const [country, setCountry] = useState('');
  const [funderCat, setFunderCat] = useState('');
  const [publisher, setPublisher] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [dataset, setDataset] = useState<DashboardDataset | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug && slugs.length) setSlug(slugs.includes('univ-nantes') ? 'univ-nantes' : slugs[0]);
  }, [slug, slugs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The structure's data: a template picks the charts it can show (and the partner countries).
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setDataset(undefined);
    loadDashboardDataset(slug)
      .then((d) => { if (!cancelled) setDataset(d); })
      .catch(() => { if (!cancelled) setDataset(null); });
    return () => { cancelled = true; };
  }, [slug]);
  useEffect(() => { setCountry(''); setPartners([]); setPublisher(''); }, [slug]);
  const publishers = useMemo(() => datasetPublishers(dataset ?? null), [dataset]);

  const countries = useMemo(() => partnerCountries(dataset ?? null), [dataset]);
  const countryName = (cc: string) => (dataset ? countryLabel(cc, dataset.countryNames) : cc);

  // Partner institutions (collaboration template): the structure's partner catalog, consortium
  // chips, and the institutions affiliated with the chosen ones (ROR registry, decision D1).
  const [partners, setPartners] = useState<string[]>([]);
  const catalog = useMemo(() => (dataset ? buildPartnerCatalog(dataset.publications) : []), [dataset]);
  const partnerGroups = useMemo(
    () => consortiumPartnerGroups(catalog, dataset?.benchmark?.openalex.ror ?? null),
    [catalog, dataset],
  );
  const [affiliates, setAffiliates] = useState<PartnerCatalogEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    setAffiliates([]);
    if (!partners.length || !template.params.includes('partners')) return;
    affiliatedPartners(partners, catalog).then((a) => { if (!cancelled) setAffiliates(a); });
    return () => { cancelled = true; };
  }, [partners, catalog, template]);
  const partnerName = (key: string) => catalog.find((c) => c.key === key)?.name ?? key;

  // Suggested name, until the user types their own.
  const suggestedName = useMemo(() => {
    if (instanceTemplate) return `${instanceTemplate.name} — ${dataset ? dataset.lab : slug}`;
    const label = t(template.label);
    const where = dataset ? dataset.lab : slug;
    const withCountry = template.params.includes('country') && country ? ` — ${countryName(country)}` : '';
    const withFunder = template.params.includes('funderCategory') && funderCat ? ` — ${t(FUNDER_CATEGORY_LABELS[funderCat])}` : '';
    const withPublisher = template.params.includes('publisher') && publisher ? ` — ${publisher}` : '';
    if (template.params.includes('partners')) {
      const first = partners[0] ? partnerName(partners[0]) : '';
      const more = partners.length > 1 ? ` (+${partners.length - 1})` : '';
      return first ? `${where} × ${first}${more}` : '';
    }
    return template.id === 'blank' ? '' : `${label} — ${where}${withCountry}${withFunder}${withPublisher}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, instanceTemplate, dataset, slug, country, funderCat, publisher, partners, catalog, t]);
  useEffect(() => {
    if (!nameTouched) setName(suggestedName);
  }, [suggestedName, nameTouched]);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const input = {
        name, slug, period, perimetre, country: country || undefined, partners,
        funderCategory: funderCat || undefined, publisher: publisher || undefined,
        lang: i18n.locale === 'en' ? 'en' as const : 'fr' as const,
      };
      let definition;
      if (instanceTemplate) {
        const source = await backend.get(instanceTemplate.id);
        if (!source.definition) throw new Error(source.definitionError ?? '');
        definition = instantiateReportTemplate(source.definition, instanceTemplate.id, input);
      } else {
        definition = template.build(input, { dataset: dataset ?? null, hiddenTabs: tabsHidden[slug] ?? [] });
      }
      const r = await backend.create(definition);
      onCreated(r.id);
    } catch (e) {
      setError(apiErrorText(e));
      setSaving(false);
    }
  };

  const waitingData = template.needsDataset && dataset === undefined;
  const row = 'flex flex-wrap items-center gap-2';
  const label = 'w-24 font-semibold text-ink dark:text-[#f5f2ea]';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card-strong w-full max-w-2xl max-h-[90vh] overflow-auto p-5 flex flex-col gap-4 bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-disp font-bold text-xl text-ink dark:text-[#f5f2ea]"><Trans>New report</Trans></h2>
          <button type="button" onClick={onClose} aria-label={t`Close`} className="p-1.5 rounded-lg hover:bg-ink/5 dark:hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t`Template`}>
          {REPORT_TEMPLATES.map((tpl) => {
            const active = tpl.id === templateId;
            return (
              <button
                key={tpl.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTemplateId(tpl.id)}
                className={`text-left rounded-xl p-3 border transition-colors ${active ? 'border-accent-strong bg-accent/25' : 'border-ink/10 dark:border-white/15 hover:bg-ink/5 dark:hover:bg-white/5'}`}
              >
                <div className="flex items-center gap-1.5 font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea]">
                  {active && <Check className="w-4 h-4" />} {t(tpl.label)}
                </div>
                <div className="text-xs text-muted dark:text-[#c3beb0] mt-1">{t(tpl.description)}</div>
              </button>
            );
          })}
        </div>

        {instanceTemplates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="section-label"><Trans>Templates of the institution</Trans></h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {instanceTemplates.map((r) => {
                const active = `report:${r.id}` === templateId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTemplateId(`report:${r.id}`)}
                    className={`text-left rounded-xl p-3 border transition-colors ${active ? 'border-accent-strong bg-accent/25' : 'border-ink/10 dark:border-white/15 hover:bg-ink/5 dark:hover:bg-white/5'}`}
                  >
                    <div className="flex items-center gap-1.5 font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea]">
                      {active && <Check className="w-4 h-4" />} {r.name}
                    </div>
                    {r.description && <div className="text-xs text-muted dark:text-[#c3beb0] mt-1 line-clamp-2">{r.description}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 text-sm">
          <div className={row}>
            <span className={label}><Trans>Structure</Trans></span>
            <StructureSelect value={slug} onChange={setSlug} />
          </div>
          <div className={row}>
            <span className={label}><Trans>Period</Trans></span>
            <PeriodInput value={period} onChange={setPeriod} />
          </div>
          <div className={row}>
            <span className={label}>{t({ message: `Scope`, context: "perimeter" })}</span>
            <PerimetreSelect value={perimetre} onChange={setPerimetre} />
          </div>
          {template.params.includes('funderCategory') && (
            <div className={row}>
              <span className={label}><Trans>Funders</Trans></span>
              <select className={selectCls} value={funderCat} onChange={(e) => setFunderCat(e.target.value)}>
                <option value="">{t`All funders`}</option>
                {FUNDER_CATEGORIES.map((c) => <option key={c} value={c}>{t(FUNDER_CATEGORY_LABELS[c])}</option>)}
              </select>
            </div>
          )}
          {template.params.includes('publisher') && (
            <div className={row}>
              <span className={label}><Trans>Publisher</Trans></span>
              <select className={selectCls} value={publisher} onChange={(e) => setPublisher(e.target.value)} disabled={!dataset}>
                <option value="">{t`All publishers`}</option>
                {publishers.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )}
          {template.params.includes('country') && (
            <div className={row}>
              <span className={label}><Trans>Country</Trans></span>
              <select className={selectCls} value={country} onChange={(e) => setCountry(e.target.value)} disabled={!dataset}>
                <option value="">{t`Choose a country`}</option>
                {countries.map((cc) => <option key={cc} value={cc}>{countryName(cc)}</option>)}
              </select>
            </div>
          )}
          {template.params.includes('partners') && dataset && (
            <div className="flex flex-col gap-2">
              <PartnerInstitutionPicker
                catalog={catalog}
                selected={partners}
                onChange={setPartners}
                predefinedGroups={partnerGroups}
              />
              {affiliates.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted dark:text-[#c3beb0]">
                    <Trans>Affiliated institutions (ROR) that also co-signed:</Trans>{' '}
                    {affiliates.map((a) => a.name).join(', ')}
                  </span>
                  <button
                    type="button"
                    className="btn-pill h-7 px-2.5 text-[11px]"
                    onClick={() => setPartners((cur) => [...cur, ...affiliates.map((a) => a.key)])}
                  >
                    <Trans>Add them</Trans>
                  </button>
                </div>
              )}
            </div>
          )}
          <label className={row}>
            <span className={label}><Trans>Name</Trans></span>
            <input
              className="input-soft flex-1 min-w-[220px]"
              value={name}
              maxLength={200}
              onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
              placeholder={t`e.g. Collaborations with the University of Ottawa`}
            />
          </label>
        </div>

        {waitingData && (
          <p className="flex items-center gap-2 text-xs text-muted-light dark:text-[#8f897c]">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> <Trans>Loading the structure's data to choose the charts…</Trans>
          </p>
        )}
        {template.needsDataset && dataset === null && (
          <p className="text-xs text-[#9a6b00] dark:text-[#f4d24a]">
            <Trans>No data for this structure: the report will list every chart of the template.</Trans>
          </p>
        )}
        {error && <div className="text-sm text-[#b23b3b] dark:text-[#f08c8c]">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-pill h-9 px-4 text-[13px]"><Trans>Cancel</Trans></button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={
              saving || waitingData || !name.trim() || !slug
              || (template.params.includes('partners') && partners.length === 0)
              || (template.params.includes('country') && !country)
            }
            className="btn-pill-dark h-9 px-4 text-[13px] disabled:opacity-40"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
            <Trans>Create</Trans>
          </button>
        </div>
      </div>
    </div>
  );
};
