// Chart catalog of the report editor: every chart of the registry, grouped by dashboard tab
// (REPORT_SECTIONS order), searchable; charts the structure cannot show (no teams, not
// composite…) are listed greyed out with the reason.

import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { CHART_META, missingFeatures, type DatasetFeature } from '../dashboard/chartMeta';
import { EMBED_CHARTS } from '../dashboard/embedRegistry';
import { REPORT_SECTIONS } from '../dashboard/report/reportCatalog';

export const FEATURE_LABELS: Record<DatasetFeature, MessageDescriptor> = {
  composite: msg`needs a structure with member labs`,
  teams: msg`needs identified teams`,
  axes: msg`needs strategic axes`,
  phd: msg`needs identified PhD students`,
  journalAccess: msg`needs the journal access categories`,
  charte: msg`needs signature charter scores`,
  partnerGroup: msg`needs at least 2 partner institutions in the report filters`,
  country: msg`needs a partner country in the report filters`,
  labs: msg`needs the labs of the publications`,
};

export const ChartPicker: React.FC<{
  features: Set<DatasetFeature> | null;
  onPick: (chartId: string) => void;
  onClose: () => void;
}> = ({ features, onPick, onClose }) => {
  const { t } = useLingui();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return REPORT_SECTIONS.map((s) => ({
      title: t(s.title),
      charts: Object.keys(CHART_META)
        .filter((id) => CHART_META[id].tab === s.tab && EMBED_CHARTS[id])
        .map((id) => ({ id, label: t(EMBED_CHARTS[id].label), missing: features ? missingFeatures(id, features) : [] }))
        .filter((c) => !q || c.label.toLowerCase().includes(q) || c.id.includes(q)),
    })).filter((g) => g.charts.length > 0);
  }, [query, features, t]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card-strong w-full max-w-2xl max-h-[85vh] p-5 flex flex-col gap-3 bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-disp font-bold text-xl text-ink dark:text-[#f5f2ea]"><Trans>Add a chart</Trans></h2>
          <button type="button" onClick={onClose} aria-label={t`Close`} className="p-1.5 rounded-lg hover:bg-ink/5 dark:hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-light" />
          <input
            className="input-soft !pl-9"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t`Search a chart…`}
          />
        </label>
        <div className="overflow-auto flex flex-col gap-3 pr-1">
          {groups.map((g) => (
            <section key={g.title}>
              <h3 className="section-label mb-1">{g.title}</h3>
              <ul className="flex flex-col">
                {g.charts.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={c.missing.length > 0}
                      onClick={() => onPick(c.id)}
                      className="w-full text-left px-2.5 py-1.5 rounded-md text-sm text-ink dark:text-[#f5f2ea] hover:bg-accent/20 dark:hover:bg-accent/15 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                    >
                      {c.label}
                      {c.missing.length > 0 && (
                        <span className="ml-2 text-xs text-muted-light dark:text-[#8f897c]">
                          ({c.missing.map((f) => t(FEATURE_LABELS[f])).join(', ')})
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="text-sm text-muted-light dark:text-[#8f897c]"><Trans>No chart matches.</Trans></p>
          )}
        </div>
      </div>
    </div>
  );
};
