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
import { DEFAULT_PERIOD, partnerCountries, REPORT_TEMPLATES, templateById } from '../dashboard/report/templates';
import type { DashboardDataset } from '../dashboard/types';
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
  const [templateId, setTemplateId] = useState(initial?.templateId ?? REPORT_TEMPLATES[0].id);
  const template = templateById(templateId) ?? REPORT_TEMPLATES[0];
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [period, setPeriod] = useState<ReportPeriod>(initial?.period ?? DEFAULT_PERIOD);
  const [perimetre, setPerimetre] = useState<'affiliation' | 'effectifs'>(initial?.perimetre ?? 'affiliation');
  const [country, setCountry] = useState('');
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
  useEffect(() => setCountry(''), [slug]);

  const countries = useMemo(() => partnerCountries(dataset ?? null), [dataset]);
  const countryName = (cc: string) => (dataset ? countryLabel(cc, dataset.countryNames) : cc);

  // Suggested name, until the user types their own.
  const suggestedName = useMemo(() => {
    const label = t(template.label);
    const where = dataset ? dataset.lab : slug;
    const withCountry = template.params.includes('country') && country ? ` — ${countryName(country)}` : '';
    return template.id === 'blank' ? '' : `${label} — ${where}${withCountry}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, dataset, slug, country, t]);
  useEffect(() => {
    if (!nameTouched) setName(suggestedName);
  }, [suggestedName, nameTouched]);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const definition = template.build(
        { name, slug, period, perimetre, country: country || undefined, lang: i18n.locale === 'en' ? 'en' : 'fr' },
        { dataset: dataset ?? null, hiddenTabs: tabsHidden[slug] ?? [] },
      );
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label={t`Template`}>
          {REPORT_TEMPLATES.map((tpl) => {
            const active = tpl.id === template.id;
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
          {template.params.includes('country') && (
            <div className={row}>
              <span className={label}><Trans>Country</Trans></span>
              <select className={selectCls} value={country} onChange={(e) => setCountry(e.target.value)} disabled={!dataset}>
                <option value="">{t`All partner countries`}</option>
                {countries.map((cc) => <option key={cc} value={cc}>{countryName(cc)}</option>)}
              </select>
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
            disabled={saving || waitingData || !name.trim() || !slug}
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
