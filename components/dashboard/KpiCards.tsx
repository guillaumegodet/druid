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
} from 'lucide-react';
import { CONFERENCE_LABEL, OverviewKpis } from './overviewAggregates';
import { PubFilters } from './publicationFilters';
import { useVizTheme } from './EChartCard';
import { useLingui } from '@lingui/react/macro';
import { numberLocale } from '../../lib/i18n';

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

/** KPI row of the Overview (ported from the mockups, Druid 2026 style). */
export const OverviewKpiCards: React.FC<{
  kpis: OverviewKpis;
  /** Opens the pre-filtered publication list (clickable cards). */
  onOpenList?: (filters: PubFilters) => void;
}> = ({ kpis, onOpenList }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const intlHint =
    kpis.intlPct != null
      ? (kpis.intlUnknown > 0 ? tr`${kpis.intlPct}% (excluding undetermined)` : `${kpis.intlPct} %`)
      : undefined;

  const cards: KpiCardData[] = [
    {
      label: tr`Publications`,
      value: kpis.total.toLocaleString(numberLocale()),
      icon: <FileText className="w-5 h-5" />,
      color: t.series[0],
    },
    {
      label: tr({ message: `International`, context: "feminine plural" }),
      value: kpis.intl.toLocaleString(numberLocale()),
      hint: intlHint,
      icon: <Globe2 className="w-5 h-5" />,
      color: t.series[5],
      filter: { international: true },
    },
    {
      label: tr`In a foreign language`,
      value: kpis.foreign.toLocaleString(numberLocale()),
      hint: kpis.foreignPct != null ? `${kpis.foreignPct} %` : undefined,
      icon: <Languages className="w-5 h-5" />,
      color: t.series[6],
    },
    {
      label: tr`Publications with APC`,
      value: kpis.apcCount.toLocaleString(numberLocale()),
      hint:
        kpis.apcTotalEur > 0
          ? `${Math.round(kpis.apcTotalEur).toLocaleString(numberLocale())} EUR`
          : undefined,
      icon: <Euro className="w-5 h-5" />,
      color: t.series[4],
      filter: { hasApc: true },
    },
    {
      label: tr`In French`,
      value: kpis.french.toLocaleString(numberLocale()),
      hint: kpis.frenchPct != null ? `${kpis.frenchPct} %` : undefined,
      icon: <BookOpen className="w-5 h-5" />,
      color: t.series[2],
      filter: { language: 'fr' },
    },
    {
      label: tr`Total citations`,
      value: kpis.citations.toLocaleString(numberLocale()),
      hint: kpis.citationsPerPub != null ? tr`${kpis.citationsPerPub.toLocaleString(numberLocale())} / publication` : undefined,
      icon: <Quote className="w-5 h-5" />,
      color: t.series[3],
    },
    {
      label: tr`Conference papers`,
      value: kpis.conf.toLocaleString(numberLocale()),
      hint: kpis.confPct != null ? `${kpis.confPct} %` : undefined,
      icon: <Presentation className="w-5 h-5" />,
      color: t.series[1],
      filter: { pubType: CONFERENCE_LABEL },
    },
    {
      label: tr`Involving PhD students`,
      value: kpis.phdKnown ? kpis.phd.toLocaleString(numberLocale()) : '—',
      hint: kpis.phdKnown ? undefined : tr`staff not matched`,
      icon: <GraduationCap className="w-5 h-5" />,
      color: t.series[7],
      filter: kpis.phdKnown ? { hasPhd: true } : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <KpiCard
          key={c.label}
          {...c}
          onClick={onOpenList && c.filter ? () => onOpenList(c.filter!) : undefined}
        />
      ))}
    </div>
  );
};
