// Translatable labels of data values (ISO languages, OA statuses).
// Ported from the SoVisu+ mockups (overviewLabels.ts). Declared with `msg` and
// resolved via `i18n._` so they remain usable outside React components
// (publicationFilters.ts); React callers re-render on language change
// through I18nProvider.

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { CountryName } from './types';

export const LANGUAGE_LABELS: Record<string, MessageDescriptor> = {
  fr: msg`French`,
  en: msg`English`,
  es: msg`Spanish`,
  it: msg`Italian`,
  de: msg`German`,
  pl: msg`Polish`,
  lv: msg`Latvian`,
  pt: msg`Portuguese`,
  nl: msg`Dutch`,
  ru: msg`Russian`,
  zh: msg`Chinese`,
  ar: msg`Arabic`,
  unknown: msg({ message: `Undetermined`, context: "feminine" }),
};

export function languageLabel(code: string): string {
  const m = LANGUAGE_LABELS[code];
  return m ? i18n._(m) : code.toUpperCase();
}

export const OA_LABELS: Record<string, MessageDescriptor> = {
  diamond: msg`Diamond`,
  gold: msg`Gold`,
  green: msg`Green`,
  hybrid: msg`Hybrid`,
  bronze: msg`Bronze`,
  closed: msg`Closed access`,
  unknown: msg`Undetermined`,
};

export function oaLabel(status: string): string {
  const m = OA_LABELS[status];
  return m ? i18n._(m) : status;
}

/**
 * Name of a country in the active language. The data only carries the French
 * name (`fr`) and the Natural Earth name (`echarts`); in English we go through
 * `Intl.DisplayNames` (fallback: French name, then ISO code).
 */
export function countryLabel(iso2: string, names: Record<string, CountryName>): string {
  const n = names[iso2];
  if (i18n.locale && i18n.locale !== 'fr') {
    try {
      const d = new Intl.DisplayNames([i18n.locale], { type: 'region' }).of(iso2.toUpperCase());
      if (d && d !== iso2.toUpperCase()) return d;
    } catch {
      /* code not recognized by Intl → fallback */
    }
  }
  return n?.fr ?? iso2;
}
