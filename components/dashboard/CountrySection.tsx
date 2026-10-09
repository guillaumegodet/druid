import React, { useEffect, useMemo, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { PubFilters } from './publicationFilters';
import { aggregateCountryFocus, countryOptions } from './countryAggregates';
import { CountryPicker } from './CountryPicker';
import { countryImpactItems, countryKpiItems } from './countryKpis';
import { aggregateImpact } from './impactAggregates';
import { LARGE_COLLAB_AUTHORS } from './partnerKpis';
import { KpiGrid } from './KpiCards';
import { ChartStateContext, type ChartState } from './EChartCard';
import { FwciHistogramChart } from './charts/FwciHistogramChart';
import { QuartileChart } from './charts/QuartileChart';
import {
  CountryBilateral, CountryDomains, CountryEvolution, CountryFunders, CountryInstitutions, CountryLanguages,
  CountryMap, CountryMatrix, CountryRank, CountryResearchers, CountrySpecialization, CountrySubfields,
  CountryRegions, CountryThirdCountries, CountryUnits, type CountryChartProps,
} from './CountryCharts';
import { numberLocale } from '../../lib/i18n';

// URL parameters of the sub-tab (shareable link, docs/archive/plan-collaboration-pays.md § 2).
const readUrlState = () => {
  const p = new URLSearchParams(window.location.search);
  const cc = (p.get('cc') ?? '').toUpperCase();
  return {
    cc: /^[A-Z]{2}$/.test(cc) ? cc : null,
    excludeLarge: p.get('large') === '0',
    groupAffiliates: p.get('affil') === '1',
  };
};
const writeUrlState = (s: { cc: string; excludeLarge: boolean; groupAffiliates: boolean } | null) => {
  const p = new URLSearchParams(window.location.search);
  for (const k of ['cc', 'large', 'affil']) p.delete(k);
  if (s) {
    p.set('cc', s.cc);
    if (s.excludeLarge) p.set('large', '0');
    if (s.groupAffiliates) p.set('affil', '1');
  }
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}`);
};

const sectionTitle = 'font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] px-1';
const note = 'text-xs text-muted-light dark:text-[#8f897c] px-1';

/**
 * « Pays » sub-tab of the Collaborations tab (docs/archive/plan-collaboration-pays.md, lot 2): the
 * collaboration with ONE partner country — key figures, yearly trend, rank among the partner
 * countries, institutions of the country, internal labs and researchers, impact.
 */
export const CountrySection: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const { t, i18n } = useLingui();
  const initial = useMemo(readUrlState, []);
  const options = useMemo(
    () => countryOptions(dataset.publications, range, dataset.countryNames),
    // Country labels follow the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset.publications, range, dataset.countryNames, i18n.locale],
  );
  const [picked, setPicked] = useState<string | null>(initial.cc);
  const [excludeLarge, setExcludeLarge] = useState(initial.excludeLarge);
  const [groupAffiliates, setGroupAffiliates] = useState(initial.groupAffiliates);
  // Default: the first partner country of the period.
  const cc = picked ?? options[0]?.cc ?? null;

  useEffect(() => {
    if (cc) writeUrlState({ cc, excludeLarge, groupAffiliates });
  }, [cc, excludeLarge, groupAffiliates]);
  useEffect(() => () => writeUrlState(null), []);

  const maxAuthors = excludeLarge ? LARGE_COLLAB_AUTHORS : undefined;
  const focus = useMemo(
    () => (cc ? aggregateCountryFocus(dataset, range, cc, { maxAuthors, groupAffiliates }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, range, cc, maxAuthors, groupAffiliates, i18n.locale],
  );
  // Impact charts: large collaborations always left out (D2).
  const impact = useMemo(
    () =>
      focus
        ? aggregateImpact(
            focus.pubs.filter((p) => typeof p.authorCount !== 'number' || p.authorCount <= LARGE_COLLAB_AUTHORS),
            range,
          )
        : null,
    [focus, range],
  );

  if (!options.length || !cc || !focus || !impact) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>No international co-publication over the period.</Trans>
      </div>
    );
  }

  const fmt = (n: number) => n.toLocaleString(numberLocale());
  const pctOf = (n: number) => (focus.total ? `${Math.round((n / focus.total) * 100)} %` : '—');
  const listFilters: PubFilters = { country: cc, ...(maxAuthors ? { maxAuthors } : {}) };
  const open = onOpenList ? (extra: PubFilters = {}) => onOpenList({ ...listFilters, ...extra }) : undefined;
  const country = focus.label;
  const hasAuthorCount = dataset.publications.some((p) => typeof p.authorCount === 'number');
  const hasParents = focus.pubs.some((p) => p.partnerInstitutions.some((o) => o.cc === cc && o.parent));
  const chartProps: CountryChartProps = { focus, countryNames: dataset.countryNames, groupAffiliates, open };
  // « Add to a report »: the country and options go with the chart; impact without large collaborations (D2).
  const chartState: ChartState = { filters: listFilters, params: groupAffiliates ? { group: 'grouped' } : {} };
  const impactState: ChartState = { filters: { country: cc, maxAuthors: LARGE_COLLAB_AUTHORS } };

  return (
    <div className="flex flex-col gap-4">
      {/* relative z-10: the country list opens over the cards below (each glass card is its own stacking context). */}
      <div className="glass-card p-4 flex flex-wrap items-center gap-x-5 gap-y-3 relative z-10">
        <div className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea]">
          <Globe2 className="w-4 h-4" />
          <span className="font-semibold"><Trans>Partner country</Trans></span>
          <CountryPicker
            options={options}
            value={cc}
            valueLabel={country}
            countryNames={dataset.countryNames}
            onChange={setPicked}
          />
        </div>
        {hasAuthorCount && (
          <label className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-current w-3.5 h-3.5"
              checked={excludeLarge}
              onChange={(e) => setExcludeLarge(e.target.checked)}
            />
            <Trans>{"Exclude large collaborations (> "}{LARGE_COLLAB_AUTHORS} authors)</Trans>
          </label>
        )}
        {hasParents && (
          <label className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-current w-3.5 h-3.5"
              checked={groupAffiliates}
              onChange={(e) => setGroupAffiliates(e.target.checked)}
            />
            <Trans>Group hospitals and institutes with their university</Trans>
          </label>
        )}
        {open && focus.total > 0 && (
          <button
            type="button"
            onClick={() => open()}
            className="pill px-3 py-1.5 text-xs bg-accent text-ink shadow-nav-active cursor-pointer sm:ml-auto"
          >
            <Trans>View the {fmt(focus.total)} publications</Trans>
          </button>
        )}
      </div>

      {focus.total === 0 ? (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>No co-publication with {country} over the period.</Trans>
        </div>
      ) : (
        <ChartStateContext.Provider value={chartState}>
          <KpiGrid
            items={countryKpiItems(focus, listFilters)}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
            onOpenList={onOpenList}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CountryEvolution {...chartProps} />
            <CountryRank {...chartProps} />
          </div>

          <h3 className={sectionTitle}><Trans>Institutions of {country}</Trans></h3>
          <div className={`grid grid-cols-1 ${focus.bounds ? 'xl:grid-cols-2' : ''} gap-4`}>
            <CountryMap {...chartProps} />
            <CountryInstitutions {...chartProps} />
          </div>
          <CountryRegions {...chartProps} />

          <h3 className={sectionTitle}><Trans>Labs and researchers involved</Trans></h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CountryUnits {...chartProps} />
            <CountryResearchers {...chartProps} />
          </div>
          <CountryMatrix {...chartProps} />

          <h3 className={sectionTitle}><Trans>Themes</Trans></h3>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2">
              <CountryDomains {...chartProps} />
            </div>
            <div className="lg:col-span-3">
              <CountrySubfields {...chartProps} />
            </div>
          </div>
          <CountrySpecialization {...chartProps} />

          <h3 className={sectionTitle}><Trans>Impact</Trans></h3>
          <p className={note}>
            <Trans>
              Publications with more than {LARGE_COLLAB_AUTHORS} authors are left out. The reference is the other international co-publications of the structure in the same subfields, weighted like the co-publications with {country}.
            </Trans>
          </p>
          <KpiGrid items={countryImpactItems(focus)} className="grid grid-cols-1 sm:grid-cols-3 gap-3" />
          <ChartStateContext.Provider value={impactState}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <FwciHistogramChart data={impact.fwciHistogram} />
              <QuartileChart data={impact.quartiles} onSelect={open ? (quartile) => open({ quartile }) : undefined} />
            </div>
          </ChartStateContext.Provider>

          <h3 className={sectionTitle}><Trans>Funding</Trans></h3>
          <p className={note}>
            <Trans>
              {fmt(focus.funded)} co-publications acknowledge at least one funder ({pctOf(focus.funded)}): {fmt(focus.funderOrigins.country)} a funder of {country}, {fmt(focus.funderOrigins.europe)} a European one, {fmt(focus.funderOrigins.france)} a French one.
            </Trans>
          </p>
          <CountryFunders {...chartProps} />

          <h3 className={sectionTitle}><Trans>Other countries and languages</Trans></h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <CountryBilateral {...chartProps} />
            <CountryThirdCountries {...chartProps} />
            <CountryLanguages {...chartProps} />
          </div>
        </ChartStateContext.Provider>
      )}
    </div>
  );
};
