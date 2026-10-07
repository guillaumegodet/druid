// Charts of the « By country » sub-tab, shared by the tab (CountrySection, with clicks opening the
// publication list) and the embed registry (reports, /embed: no click) — docs/plan-collaboration-pays.md,
// lot 5. Each takes the country focus (aggregateCountryFocus) and an optional `open` callback adding
// its own filter to the country one.

import React from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { CountryFocus } from './countryAggregates';
import type { PubFilters } from './publicationFilters';
import type { CountryName } from './types';
import { CountryTrendChart } from './charts/CountryTrendChart';
import { TopCountriesChart } from './charts/TopCountriesChart';
import { RankBarChart, TeamDonutChart } from './charts/TeamCharts';
import { CountryMapChart } from './charts/CountryMapChart';
import { MatrixHeatmapChart } from './charts/MatrixHeatmapChart';
import { SpecializationChart } from './charts/SpecializationChart';
import { CountryFundersChart } from './charts/CountryFundersChart';
import { LanguageDonutChart } from './charts/LanguageDonutChart';

export interface CountryChartProps {
  focus: CountryFocus;
  countryNames: Record<string, CountryName>;
  /** Hospitals and institutes folded under their university (subtitle of the institution charts). */
  groupAffiliates?: boolean;
  /** Opens the publication list with the country filter plus `extra`. */
  open?: (extra?: PubFilters) => void;
}

const asCountryItems = (rows: { cc: string; label: string; count: number }[], names: Record<string, CountryName>) =>
  rows.map((c) => ({ iso2: c.cc, fr: c.label, echarts: names[c.cc]?.echarts ?? '', eu: names[c.cc]?.eu ?? false, count: c.count }));

/** Filter of a lab / team in the publication list, when the export carries them on the publications. */
export const unitFilter = (focus: CountryFocus, unit: string): PubFilters | null =>
  focus.units.filterKey === 'team' ? { team: unit }
    : focus.units.filterKey === 'sousStructure' ? { sousStructure: unit }
      : null;

const unitsTitle = (focus: CountryFocus) =>
  focus.units.kind === 'teams' ? i18n._(msg`Teams involved`) : i18n._(msg`Labs involved`);

export const CountryEvolution: React.FC<CountryChartProps> = ({ focus }) => (
  <CountryTrendChart data={focus.byYear} country={focus.label} />
);

export const CountryRank: React.FC<CountryChartProps> = ({ focus, countryNames }) => (
  <TopCountriesChart
    data={asCountryItems(focus.topCountries, countryNames)}
    top={focus.topCountries.length}
    highlight={focus.cc}
    title={i18n._(msg`Rank of ${focus.label} among the partner countries`)}
    exportName="pays-rang"
    height={Math.max(280, focus.topCountries.length * 24 + 40)}
  />
);

export const CountryMap: React.FC<CountryChartProps> = ({ focus, countryNames, open }) =>
  focus.bounds ? (
    <CountryMapChart
      points={focus.mapPoints}
      bounds={focus.bounds}
      country={focus.label}
      polygon={countryNames[focus.cc]?.echarts ?? ''}
      onSelect={open ? (partnerInstitution) => open({ partnerInstitution }) : undefined}
    />
  ) : null;

export const CountryInstitutions: React.FC<CountryChartProps> = ({ focus, groupAffiliates, open }) => (
  <RankBarChart
    title={i18n._(msg`Partner institutions in ${focus.label}`)}
    subtitle={groupAffiliates ? i18n._(msg`Hospitals and institutes counted with their university`) : undefined}
    exportName="pays-etablissements"
    data={focus.institutions.map((i) => ({
      label: i.name,
      count: i.count,
      teams: i.affiliates.length
        ? [i18n._(msg`with ${i.affiliates.slice(0, 3).join(', ')}${i.affiliates.length > 3 ? '…' : ''}`)]
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
);

export const CountryUnits: React.FC<CountryChartProps> = ({ focus, open }) =>
  focus.units.kind ? (
    <RankBarChart
      title={unitsTitle(focus)}
      subtitle={i18n._(msg`A co-publication counts for each lab of its authors`)}
      exportName="pays-labos"
      data={focus.units.top.map((u) => ({ label: u.key, count: u.count, teams: [] }))}
      colorSlot={2}
      height={Math.max(280, focus.units.top.length * 26 + 60)}
      onItemClick={open && focus.units.filterKey ? (unit) => open(unitFilter(focus, unit) ?? {}) : undefined}
    />
  ) : null;

export const CountryResearchers: React.FC<CountryChartProps> = ({ focus, open }) => (
  <RankBarChart
    title={i18n._(msg`Researchers involved`)}
    exportName="pays-chercheurs"
    // The label already carries the labs (« Name (LAB) »).
    data={focus.researchers.top.map((r) => ({ ...r, teams: [] }))}
    colorSlot={1}
    height={Math.max(280, focus.researchers.top.length * 26 + 60)}
    onItemSelect={open ? (item) => item.id != null && open({ authorId: item.id }) : undefined}
  />
);

export const CountryMatrix: React.FC<CountryChartProps> = ({ focus, open }) =>
  focus.matrix.cells.length > 0 ? (
    <MatrixHeatmapChart
      title={i18n._(msg`Who works with whom`)}
      subtitle={
        focus.units.kind === 'teams'
          ? i18n._(msg`Co-publications between the main teams and the main institutions of ${focus.label}`)
          : i18n._(msg`Co-publications between the main labs and the main institutions of ${focus.label}`)
      }
      exportName="pays-matrice"
      rows={focus.matrix.units}
      cols={focus.matrix.institutions}
      cells={focus.matrix.cells}
      onCellClick={
        open
          ? (x, y) => {
              const inst = focus.institutions[x];
              if (inst) open({ partnerKeys: inst.partnerKeys, ...(unitFilter(focus, focus.matrix.units[y]) ?? {}) });
            }
          : undefined
      }
    />
  ) : null;

export const CountryDomains: React.FC<CountryChartProps> = ({ focus, open }) => (
  <TeamDonutChart
    title={i18n._(msg`Domains of the co-publications`)}
    exportName="pays-domaines"
    data={focus.domains.map((d) => ({ name: d.key, value: d.count }))}
    onSelect={open ? (domain) => open({ domain }) : undefined}
  />
);

export const CountrySubfields: React.FC<CountryChartProps> = ({ focus, open }) => (
  <RankBarChart
    title={i18n._(msg`Main subfields`)}
    exportName="pays-sous-disciplines"
    data={focus.topSubfields.map((s) => ({ label: s.key, count: s.count, teams: [] }))}
    colorSlot={5}
    height={Math.max(320, focus.topSubfields.length * 26 + 60)}
    onItemClick={open ? (subfield) => open({ subfield }) : undefined}
  />
);

export const CountrySpecialization: React.FC<CountryChartProps> = ({ focus, open }) => (
  <SpecializationChart
    data={focus.specialization}
    country={focus.label}
    minCount={focus.specializationMin}
    onSelect={open ? (subfield) => open({ subfield }) : undefined}
  />
);

export const CountryFunders: React.FC<CountryChartProps> = ({ focus, open }) => (
  <CountryFundersChart data={focus.funders} country={focus.label} onSelect={open ? (funder) => open({ funder }) : undefined} />
);

export const CountryBilateral: React.FC<CountryChartProps> = ({ focus }) => (
  <TeamDonutChart
    title={i18n._(msg`Bilateral or with other countries`)}
    exportName="pays-bilateral"
    data={[
      { name: i18n._(msg`${focus.label} only`), value: focus.bilateral },
      { name: i18n._(msg`With other foreign countries`), value: focus.multilateral },
    ]}
  />
);

export const CountryThirdCountries: React.FC<CountryChartProps> = ({ focus, countryNames }) => (
  <TopCountriesChart
    data={asCountryItems(focus.thirdCountries, countryNames)}
    top={focus.thirdCountries.length}
    title={i18n._(msg`Other countries of the multilateral co-publications`)}
    exportName="pays-pays-tiers"
    height={320}
  />
);

export const CountryLanguages: React.FC<CountryChartProps> = ({ focus, open }) => (
  <LanguageDonutChart
    data={focus.languages}
    title={i18n._(msg`Languages of the co-publications`)}
    exportName="pays-langues"
    onSelect={open ? (language) => open({ language }) : undefined}
  />
);
