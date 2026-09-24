import React, { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { DashboardPublication } from './types';
import { aggregateOverview, OverviewKpis, YearRange } from './overviewAggregates';
import { PubFilters } from './publicationFilters';
import { OverviewKpiCards } from './KpiCards';
import { KeywordCloud } from './KeywordCloud';
import { YearlyEvolutionChart } from './charts/YearlyEvolutionChart';
import { LanguageDonutChart } from './charts/LanguageDonutChart';
import { PublicationTypesChart } from './charts/PublicationTypesChart';
import { OpenAccessDonutChart } from './charts/OpenAccessDonutChart';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { numberLocale } from '../../lib/i18n';

interface Props {
  publications: DashboardPublication[];
  range: YearRange;
  /** Research FTE entered in the structure configuration (null = section hidden). */
  etpr?: number | null;
  /** Opens the pre-filtered publication list (clickable KPIs and charts). */
  onOpenList?: (filters: PubFilters) => void;
}

/**
 * « Output per research FTE per year » ratios (as in the Streamlit:
 * RICL ≈ journal articles indexed in Scimago; intl. conf. = all conference
 * papers, since the data does not distinguish national/international).
 */
const EtprSection: React.FC<{ kpis: OverviewKpis; etpr: number }> = ({ kpis, etpr }) => {
  const { t } = useLingui();
  if (!kpis.nbYears || !etpr) return null;
  const ricl = kpis.ricl / etpr / kpis.nbYears;
  const conf = kpis.conf / etpr / kpis.nbYears;
  const cell = (label: string, value: number, detail: React.ReactNode) => (
    <div className="glass-card-strong p-4 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
          {label}
        </span>
        <Gauge className="w-4 h-4 text-muted-lighter dark:text-[#8f897c]" />
      </div>
      <div className="font-disp font-bold text-[26px] leading-none text-ink dark:text-[#f5f2ea]">
        {value.toLocaleString(numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="text-xs text-muted-light dark:text-[#8f897c]">{detail}</div>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <h3 className="section-label px-1"><Trans>Output per research FTE per year</Trans></h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cell(
          t`RICL / research FTE / year`,
          ricl,
          <>{kpis.ricl.toLocaleString(numberLocale())} RICL · {etpr.toLocaleString(numberLocale())} ETPR · <Plural value={kpis.nbYears} one="# year" other="# years" /></>,
        )}
        {cell(
          t`Intl. conf. / research FTE / year`,
          conf,
          <>{kpis.conf.toLocaleString(numberLocale())} {t`conf.`} · {etpr.toLocaleString(numberLocale())} ETPR · <Plural value={kpis.nbYears} one="# year" other="# years" /></>,
        )}
      </div>
      <p className="text-[11px] text-muted-lighter dark:text-[#8f897c] px-1">
        <Trans>
          RICL = journal articles indexed in Scimago (proxy for “international peer-reviewed journal”); conference papers do not distinguish national / international. Research FTE entered in the structure configuration.
        </Trans>
      </p>
    </div>
  );
};

/** « Vue d'ensemble » tab: KPIs, research-FTE ratios, 4 charts, keyword cloud. */
export const OverviewTab: React.FC<Props> = ({ publications, range, etpr, onOpenList }) => {
  const aggregates = useMemo(
    () => aggregateOverview(publications, range),
    [publications, range],
  );

  // Aggregated (« Autres ») or non-filterable categories: do not open a list.
  const skip = (key: string) => key === '__other__' || key === 'unknown';

  return (
    <div className="flex flex-col gap-4">
      <OverviewKpiCards kpis={aggregates.kpis} onOpenList={onOpenList} />
      {etpr != null && etpr > 0 && <EtprSection kpis={aggregates.kpis} etpr={etpr} />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <YearlyEvolutionChart
          data={aggregates.byYear}
          onSelect={onOpenList ? (year) => onOpenList({ year }) : undefined}
        />
        <LanguageDonutChart
          data={aggregates.byLanguage}
          onSelect={onOpenList ? (key) => !skip(key) && onOpenList({ language: key }) : undefined}
        />
        <PublicationTypesChart
          data={aggregates.byType}
          onSelect={onOpenList ? (key) => !skip(key) && onOpenList({ pubType: key }) : undefined}
        />
        <OpenAccessDonutChart
          data={aggregates.byOa}
          onSelect={onOpenList ? (key) => !skip(key) && onOpenList({ oaStatus: key }) : undefined}
        />
      </div>
      <KeywordCloud
        publications={publications}
        range={range}
        onSelect={onOpenList ? (word) => onOpenList({ q: word }) : undefined}
      />
    </div>
  );
};
