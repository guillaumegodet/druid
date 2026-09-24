import { i18n, type Messages } from '@lingui/core';

/**
 * @file i18n.ts
 * @description LinguiJS bootstrap: language choice, catalog loading,
 * persistence of the user's choice. Components only use the `Trans` /
 * `useLingui` macros; this module is reserved to `index.tsx` and the
 * language switcher.
 */

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

const STORAGE_KEY = 'druid_locale';
const URL_PARAM = 'lang';

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/**
 * Language to activate, by priority: `?lang=` URL parameter (deep links,
 * /embed page), saved preference, browser language, French.
 */
export function detectLocale(): Locale {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(URL_PARAM);
    if (isLocale(fromUrl)) return fromUrl;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
    const nav = (navigator.language || '').slice(0, 2).toLowerCase();
    if (isLocale(nav)) return nav;
  } catch {
    /* localStorage unavailable (private browsing, sandboxed iframe) */
  }
  return DEFAULT_LOCALE;
}

/** Loads the `.po` catalog (compiled by the Vite plugin) and activates the language. */
export async function activateLocale(locale: Locale): Promise<void> {
  const { messages } = (await import(`../locales/${locale}/messages.po`)) as { messages: Messages };
  i18n.load(locale, messages);
  i18n.activate(locale);
  document.documentElement.lang = locale;
}

/** Switches the language at runtime and remembers the choice. */
export async function setLocale(locale: Locale): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignored */
  }
  await activateLocale(locale);
}

export const currentLocale = (): Locale => (isLocale(i18n.locale) ? i18n.locale : DEFAULT_LOCALE);

/** Locale to pass to `toLocaleString` / `Intl` to format numbers and dates. */
export const numberLocale = (): string => (i18n.locale === 'en' ? 'en-GB' : 'fr-FR');

/** Formats a number in the active language (`1 234` in fr, `1,234` in en). */
export const fmt = (n: number, opts?: Intl.NumberFormatOptions): string =>
  n.toLocaleString(numberLocale(), opts);
