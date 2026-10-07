import React, { useEffect, useMemo, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import { PubFilters } from './publicationFilters';
import { aggregateCountryFocus, countryOptions } from './countryAggregates';
import { countryImpactItems, countryKpiItems } from './countryKpis';
import { aggregateImpact } from './impactAggregates';
import { LARGE_COLLAB_AUTHORS } from './partnerKpis';
import { KpiGrid } from './KpiCards';
import { CountryTrendChart } from './charts/CountryTrendChart';
import { TopCountriesChart } from './charts/TopCountriesChart';
import { RankBarChart } from './charts/TeamCharts';
import { FwciHistogramChart } from './charts/FwciHistogramChart';
import { QuartileChart } from './charts/QuartileChart';
import { numberLocale } from '../../lib/i18n';

// URL parameters of the sub-tab (shareable link, docs/plan-collaboration-pays.md § 2).
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
 * « Pays » sub-tab of the Collaborations tab (docs/plan-collaboration-pays.md, lot 2): the
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
  const listFilters: PubFilters = { country: cc, ...(maxAuthors ? { maxAuthors } : {}) };
  const open = onOpenList ? (extra: PubFilters = {}) => onOpenList({ ...listFilters, ...extra }) : undefined;
  const country = focus.label;
  const unitsTitle = focus.units.kind === 'teams' ? t`Teams involved` : t`Labs involved`;
  const hasAuthorCount = dataset.publications.some((p) => typeof p.authorCount === 'number');
  const hasParents = focus.pubs.some((p) => p.partnerInstitutions.some((o) => o.cc === cc && o.parent));
  const inOptions = options.some((o) => o.cc === cc);

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea]">
          <Globe2 className="w-4 h-4" />
          <span className="font-semibold"><Trans>Partner country</Trans></span>
          <select
            className="input-soft !w-auto py-1.5 pr-7 text-sm cursor-pointer"
            value={cc}
            onChange={(e) => setPicked(e.target.value)}
          >
            {!inOptions && <option value={cc}>{country} (0)</option>}
            {options.map((o) => (
              <option key={o.cc} value={o.cc}>
                {o.label} ({fmt(o.count)})
              </option>
            ))}
          </select>
        </label>
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
        <>
          <KpiGrid
            items={countryKpiItems(focus, listFilters)}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
            onOpenList={onOpenList}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CountryTrendChart data={focus.byYear} country={country} />
            <TopCountriesChart
              data={focus.topCountries.map((c) => ({
                iso2: c.cc,
                fr: c.label,
                echarts: dataset.countryNames[c.cc]?.echarts ?? '',
                eu: dataset.countryNames[c.cc]?.eu ?? false,
                count: c.count,
              }))}
              top={focus.topCountries.length}
              highlight={cc}
              title={t`Rank of ${country} among the partner countries`}
              exportName="pays-rang"
              height={Math.max(280, focus.topCountries.length * 24 + 40)}
            />
          </div>

          <h3 className={sectionTitle}><Trans>Institutions of {country}</Trans></h3>
          <RankBarChart
            title={t`Partner institutions in ${country}`}
            subtitle={groupAffiliates ? t`Hospitals and institutes counted with their university` : undefined}
            exportName="pays-etablissements"
            data={focus.institutions.map((i) => ({
              label: i.name,
              count: i.count,
              teams: i.affiliates.length
                ? [t`with ${i.affiliates.slice(0, 3).join(', ')}${i.affiliates.length > 3 ? '…' : ''}`]
                : i.city ? [i.city] : [],
            }))}
            colorSlot={3}
            height={Math.max(280, focus.institutions.length * 26 + 60)}
            onItemClick={
              open
                ? (name) => {
                    const inst = focus.institutions.find((i) => i.name === name);
                    if (inst) open({ partnerKeys: inst.partnerKeys });
                  }
                : undefined
            }
          />

          <h3 className={sectionTitle}><Trans>Labs and researchers involved</Trans></h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {focus.units.kind && (
              <RankBarChart
                title={unitsTitle}
                subtitle={t`A co-publication counts for each lab of its authors`}
                exportName="pays-labos"
                data={focus.units.top.map((u) => ({ label: u.key, count: u.count, teams: [] }))}
                colorSlot={2}
                height={Math.max(280, focus.units.top.length * 26 + 60)}
              />
            )}
            <RankBarChart
              title={t`Researchers involved`}
              exportName="pays-chercheurs"
              // The label already carries the labs (« Name (LAB) »).
              data={focus.researchers.top.map((r) => ({ ...r, teams: [] }))}
              colorSlot={1}
              height={Math.max(280, focus.researchers.top.length * 26 + 60)}
              onItemSelect={open ? (item) => item.id != null && open({ authorId: item.id }) : undefined}
            />
          </div>

          <h3 className={sectionTitle}><Trans>Impact</Trans></h3>
          <p className={note}>
            <Trans>
              Publications with more than {LARGE_COLLAB_AUTHORS} authors are left out. The reference is the other international co-publications of the structure in the same subfields, weighted like the co-publications with {country}.
            </Trans>
          </p>
          <KpiGrid items={countryImpactItems(focus)} className="grid grid-cols-1 sm:grid-cols-3 gap-3" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FwciHistogramChart data={impact.fwciHistogram} />
            <QuartileChart data={impact.quartiles} onSelect={open ? (quartile) => open({ quartile }) : undefined} />
          </div>
        </>
      )}
    </div>
  );
};
