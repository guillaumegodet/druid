import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DashboardFamily, DashboardFamilyDef, DashboardTab } from './dashboardNav';
import { FAMILY_ICONS } from './familyIcons';

/**
 * « Explore the analyses » — one card per family at the foot of the overview, with the views
 * of the family as chips and a headline figure when one is immediate (D5 of
 * docs/archive/plan-tableau-de-bord-familles.md). The discovery path for a first visitor.
 */
export const ExploreGrid: React.FC<{
  /** Visible families, overview excluded by the caller. */
  families: DashboardFamilyDef[];
  /** Headline figure of a family (already formatted), optional. */
  figures: Partial<Record<DashboardFamily, { value: string; label: string }>>;
  onNavigate: (tab: DashboardTab) => void;
}> = ({ families, figures, onNavigate }) => {
  const { t } = useLingui();
  if (families.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="section-label px-1"><Trans>Explore the analyses</Trans></h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {families.map((f) => {
          const Icon = FAMILY_ICONS[f.key];
          const figure = figures[f.key];
          const first = f.tabs[0].key;
          return (
            <div key={f.key} className="glass-card-strong p-4 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => onNavigate(first)}
                className="flex items-start gap-3 text-left group"
              >
                <span className="shrink-0 w-10 h-10 rounded-xl grid place-items-center bg-accent/20 text-ink dark:bg-accent/25 dark:text-[#f5f2ea]">
                  <Icon className="w-5 h-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-disp font-bold text-[15px] text-ink dark:text-[#f5f2ea]">
                    {t(f.label)}
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                  </span>
                  <span className="block text-[12px] leading-snug text-muted-light dark:text-[#8f897c]">{t(f.description)}</span>
                </span>
                {figure && (
                  <span className="shrink-0 text-right">
                    <span className="block font-disp font-bold text-[22px] leading-none text-ink dark:text-[#f5f2ea] tabular-nums">{figure.value}</span>
                    <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-muted-lighter dark:text-[#8f897c]">{figure.label}</span>
                  </span>
                )}
              </button>
              {f.tabs.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {f.tabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      title={t(tab.hint)}
                      onClick={() => onNavigate(tab.key)}
                      className="pill px-2.5 py-1 text-[11.5px] bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors cursor-pointer"
                    >
                      {t(tab.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
