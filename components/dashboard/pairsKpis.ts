// Key figures and table of the researcher pairs (druid-internal `docs/plan-binomes-chercheurs.md`, lots 2
// and 2b), computed from a /pairs response: shared by the « Researcher pairs » sub-tab and the report
// blocks (`kpis` set and `table` « pairs »), so that both show the same figures.

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { numberLocale } from '../../lib/i18n';
import type { KpiItem } from './kpiItems';
import { DISTANT_PROFILES, type PairAuthor, type PairTrend, type PairsResponse } from './pairsApi';

const fmt = (n: number) => n.toLocaleString(numberLocale());

export function pairsKpiItems(r: PairsResponse): KpiItem[] {
  const c = r.counts;
  const share = (n: number) =>
    c.perimeter ? i18n._(msg`${Math.round((n / c.perimeter) * 100)}% of the ${fmt(c.perimeter)} publishing researchers`) : undefined;
  return [
    { key: 'pairs-active', label: i18n._(msg`Active pairs`), value: fmt(r.total - c.dormant), hint: i18n._(msg`joint publication in the last three years`) },
    { key: 'pairs-new', label: i18n._(msg`New pairs`), value: fmt(c.new), hint: i18n._(msg`first joint publication in the last three years`) },
    { key: 'pairs-dormant', label: i18n._(msg`Dormant pairs`), value: fmt(c.dormant), hint: i18n._(msg`nothing joint for three years`) },
    { key: 'pairs-cross-pole', label: i18n._(msg`Between poles`), value: fmt(c.crossPole) },
    { key: 'pairs-distant', label: i18n._(msg`Distant profiles`), value: fmt(c.distant), hint: i18n._(msg`distance ≥ ${DISTANT_PROFILES}`) },
    {
      key: 'pairs-researchers',
      label: r.structureLabs ? i18n._(msg`Researchers of the structure in a pair`) : i18n._(msg`Researchers in a pair`),
      value: fmt(c.perimeterEngaged),
      hint: share(c.perimeterEngaged),
    },
    ...(r.poles.length > 0 ? [{
      key: 'pairs-cross-pole-researchers',
      label: i18n._(msg`Researchers in a cross-pole pair`),
      value: fmt(c.perimeterCrossPole),
      hint: share(c.perimeterCrossPole),
    }] : []),
  ];
}

export const pairTrendLabel = (trend: PairTrend): string => {
  switch (trend) {
    case 'new': return i18n._(msg`New`);
    case 'rising': return i18n._(msg`Rising`);
    case 'steady': return i18n._(msg`Steady`);
    default: return i18n._(msg`Dormant`);
  }
};

/** « Name (labs) » of one researcher of a pair, as printed in a report table. */
export const pairAuthorLabel = (a: PairAuthor): string => (a.labs.length ? `${a.label} (${a.labs.join(', ')})` : a.label);
