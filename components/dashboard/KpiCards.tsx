import React from 'react';
import {
  FileText,
  Globe2,
  Languages,
  Euro,
  BookOpen,
  Quote,
  Presentation,
  GraduationCap,
  Activity,
  Award,
  Trophy,
  Gauge,
} from 'lucide-react';
import { OverviewKpis, YearRange } from './overviewAggregates';
import { ImpactKpis } from './impactAggregates';
import { PubFilters } from './publicationFilters';
import { useVizTheme } from './EChartCard';
// Runtime hook (not the macro): only subscribes the cards to locale changes, labels come from i18n._.
import { useLingui } from '@lingui/react';
import { KPI_SETS, KpiItem, impactKpiItems, overviewKpiItems } from './kpiItems';
import { DashboardDataset } from './types';

export interface KpiCardData {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  color: string;
  /** Filter opened on click (card is clickable when defined). */
  filter?: PubFilters;
}

export const KpiCard: React.FC<KpiCardData & { onClick?: () => void }> = ({
  label,
  value,
  hint,
  icon,
  color,
  onClick,
}) => {
  const Tag = onClick ? 'button' : 'div';
  return (
  <Tag
    {...(onClick ? { type: 'button' as const, onClick } : {})}
    className={`relative glass-card-strong overflow-hidden p-4 flex flex-col gap-1.5 min-h-[104px] text-left w-full ${
      onClick ? 'cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-nav-active' : ''
    }`}
  >
    <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color, opacity: 0.85 }} />
    <div className="flex items-start justify-between gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c] leading-snug">
        {label}
      </span>
      <span
        className="shrink-0 w-9 h-9 rounded-xl grid place-items-center"
        style={{ color, backgroundColor: `${color}1f` }}
      >
        {icon}
      </span>
    </div>
    <div className="mt-auto font-disp font-bold text-[28px] leading-none text-ink dark:text-[#f5f2ea]">
      {value}
    </div>
    {hint && (
      <div className="text-xs font-semibold" style={{ color }}>
        {hint}
      </div>
    )}
  </Tag>
  );
};

/** Icon and color slot of each key figure (KpiItem.key, kpiItems.ts). */
const KPI_STYLES: Record<string, { Icon: React.FC<{ className?: string }>; slot: number }> = {
  publications: { Icon: FileText, slot: 0 },
  international: { Icon: Globe2, slot: 5 },
  foreign: { Icon: Languages, slot: 6 },
  apc: { Icon: Euro, slot: 4 },
  french: { Icon: BookOpen, slot: 2 },
  citations: { Icon: Quote, slot: 3 },
  conferences: { Icon: Presentation, slot: 1 },
  phd: { Icon: GraduationCap, slot: 7 },
  'fwci-known': { Icon: Activity, slot: 0 },
  top10: { Icon: Award, slot: 5 },
  top1: { Icon: Trophy, slot: 4 },
  'fwci-mean': { Icon: Gauge, slot: 6 },
};

/** Grid of key-figure cards (tabs and report `kpis` blocks). */
export const KpiGrid: React.FC<{
  items: KpiItem[];
  className: string;
  /** Opens the pre-filtered publication list (clickable cards). */
  onOpenList?: (filters: PubFilters) => void;
}> = ({ items, className, onOpenList }) => {
  const t = useVizTheme();
  return (
    <div className={className}>
      {items.map((it) => {
        const style = KPI_STYLES[it.key] ?? { Icon: FileText, slot: 0 };
        return (
          <KpiCard
            key={it.key}
            label={it.label}
            value={it.value}
            hint={it.hint}
            icon={<style.Icon className="w-5 h-5" />}
            color={t.series[style.slot]}
            onClick={onOpenList && it.filter ? () => onOpenList(it.filter!) : undefined}
          />
        );
      })}
    </div>
  );
};

/** KPI row of the Overview (ported from the mockups, Druid 2026 style). */
export const OverviewKpiCards: React.FC<{
  kpis: OverviewKpis;
  /** Opens the pre-filtered publication list (clickable cards). */
  onOpenList?: (filters: PubFilters) => void;
}> = ({ kpis, onOpenList }) => {
  useLingui();
  return (
    <KpiGrid
      items={overviewKpiItems(kpis)}
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
      onOpenList={onOpenList}
    />
  );
};

/** KPI row of the Impact tab (ported from the mockups, Druid 2026 style). */
export const ImpactKpiCards: React.FC<{ kpis: ImpactKpis }> = ({ kpis }) => {
  useLingui();
  return <KpiGrid items={impactKpiItems(kpis)} className="grid grid-cols-2 lg:grid-cols-4 gap-3" />;
};

/** Key-figure row of a report `kpis` block (KPI_SETS, kpiItems.ts). */
export const KpiSetCards: React.FC<{ setId: string; dataset: DashboardDataset; range: YearRange }> = ({
  setId,
  dataset,
  range,
}) => {
  const { i18n } = useLingui();
  const set = KPI_SETS[setId];
  const items = React.useMemo(
    () => (set ? set.items(dataset, range) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set, dataset, range, i18n.locale],
  );
  return <KpiGrid items={items} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" />;
};
