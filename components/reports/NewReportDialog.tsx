// Creation of an empty report: name, structure, period and scope; the editor opens next.
// Templates (docs/plan-mes-rapports.md § 5) will add their own entries here (lot 5).

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import type { ReportDefinition, ReportPeriod } from '../dashboard/report/definition';
import type { ReportsBackend } from '../dashboard/report/reportsApi';
import { PerimetreSelect, PeriodInput, StructureSelect, useStructureSlugs } from './ReportControls';

export const NewReportDialog: React.FC<{
  backend: ReportsBackend;
  onClose: () => void;
  onCreated: (id: number) => void;
}> = ({ backend, onClose, onCreated }) => {
  const { t, i18n } = useLingui();
  const { slugs } = useStructureSlugs();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [period, setPeriod] = useState<ReportPeriod>({ kind: 'relative', lastYears: 5, includeCurrent: false });
  const [perimetre, setPerimetre] = useState<'affiliation' | 'effectifs'>('affiliation');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug && slugs.length) setSlug(slugs[0]);
  }, [slug, slugs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = async () => {
    setSaving(true);
    setError(null);
    const definition: ReportDefinition = {
      schemaVersion: 1,
      name: name.trim(),
      description: '',
      context: { slug, perimetre, period, filters: {} },
      blocks: [],
      lang: i18n.locale === 'en' ? 'en' : 'fr',
    };
    try {
      const r = await backend.create(definition);
      onCreated(r.id);
    } catch (e) {
      setError(apiErrorText(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card-strong w-full max-w-lg p-5 flex flex-col gap-4 bg-white/95 dark:bg-[#33312c]"
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
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink dark:text-[#f5f2ea]">
          <Trans>Name</Trans>
          <input
            className="input-soft"
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder={t`e.g. Collaborations with the University of Ottawa`}
          />
        </label>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Structure</Trans></span>
            <StructureSelect value={slug} onChange={setSlug} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Period</Trans></span>
            <PeriodInput value={period} onChange={setPeriod} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-semibold text-ink dark:text-[#f5f2ea]">{t({ message: `Scope`, context: "perimeter" })}</span>
            <PerimetreSelect value={perimetre} onChange={setPerimetre} />
          </div>
        </div>
        <p className="text-xs text-muted-light dark:text-[#8f897c]">
          <Trans>The report starts empty: add charts, key figures and text in the editor. Everything stays editable.</Trans>
        </p>
        {error && <div className="text-sm text-[#b23b3b] dark:text-[#f08c8c]">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-pill h-9 px-4 text-[13px]"><Trans>Cancel</Trans></button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={saving || !name.trim() || !slug}
            className="btn-pill-dark h-9 px-4 text-[13px] disabled:opacity-40"
          >
            <Trans>Create</Trans>
          </button>
        </div>
      </div>
    </div>
  );
};
