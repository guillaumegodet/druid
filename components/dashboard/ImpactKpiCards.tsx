import React from 'react';
import { Activity, Award, Trophy, Gauge } from 'lucide-react';
import { ImpactKpis } from './impactAggregates';
import { KpiCard, KpiCardData } from './KpiCards';
import { useVizTheme } from './EChartCard';
import { useLingui } from '@lingui/react/macro';
import { numberLocale } from '../../lib/i18n';

/** KPI row of the Impact tab (ported from the mockups, Druid 2026 style). */
export const ImpactKpiCards: React.FC<{ kpis: ImpactKpis }> = ({ kpis }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();

  const cards: KpiCardData[] = [
    {
      label: tr`Known FWCI`,
      value: kpis.nbFwci.toLocaleString(numberLocale()),
      hint: kpis.pctFwci != null ? tr`${kpis.pctFwci}% of the corpus` : undefined,
      icon: <Activity className="w-5 h-5" />,
      color: t.series[0],
    },
    {
      label: tr`Top 10% most cited`,
      value: kpis.nbTop10.toLocaleString(numberLocale()),
      hint: kpis.pctTop10 != null ? `${kpis.pctTop10} %` : undefined,
      icon: <Award className="w-5 h-5" />,
      color: t.series[5],
    },
    {
      label: tr`Top 1% most cited`,
      value: kpis.nbTop1.toLocaleString(numberLocale()),
      hint: kpis.pctTop1 != null ? `${kpis.pctTop1} %` : undefined,
      icon: <Trophy className="w-5 h-5" />,
      color: t.series[4],
    },
    {
      label: tr`Mean FWCI`,
      value: kpis.fwciMean != null ? kpis.fwciMean.toFixed(2) : '—',
      hint: tr`World reference = 1.00`,
      icon: <Gauge className="w-5 h-5" />,
      color: t.series[6],
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <KpiCard key={c.label} {...c} />
      ))}
    </div>
  );
};
