import React, { useEffect, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { PubFilters } from './publicationFilters';
import { PublicationsListTab } from './PublicationsListTab';

/**
 * Drill-down from a chart (onOpenList): the pre-filtered publication list opens over the
 * current tab, SciVal-style, instead of switching to « Liste des publications ».
 * Its filters are local to the modal; « Open in the tab » hands them over to the tab.
 */
export const PublicationsListModal: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  initialFilters: PubFilters;
  onClose: () => void;
  onOpenInTab: (filters: PubFilters) => void;
}> = ({ dataset, range, initialFilters, onClose, onOpenInTab }) => {
  const { t } = useLingui();
  const [filters, setFilters] = useState<PubFilters>(initialFilters);

  // Capture phase + stopImmediatePropagation: Escape closes the modal only, not the
  // full-screen chart underneath (EChartCard listens to Escape on window too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card-strong w-full max-w-6xl max-h-[90vh] overflow-y-auto bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t`Publication list`}
      >
        <PublicationsListTab
          dataset={dataset}
          range={range}
          filters={filters}
          onFiltersChange={setFilters}
          embedded
          headerActions={
            <>
              <button
                type="button"
                onClick={() => onOpenInTab(filters)}
                title={t`Open in the « Publication list » tab`}
                className="btn-pill px-3 py-1.5 text-[13px]"
              >
                <ArrowUpRight className="w-4 h-4" /> <Trans>Open in the tab</Trans>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t`Close`}
                className="p-1.5 rounded-lg hover:bg-ink/5 dark:hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </>
          }
        />
      </div>
    </div>
  );
};
