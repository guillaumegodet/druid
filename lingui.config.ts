import { defineConfig } from '@lingui/cli';

/**
 * LinguiJS configuration (same tool as SoVisu+).
 * - Source strings in the code are in English (`sourceLocale: 'en'`, since
 *   2026-09-23): the en catalog is filled automatically, only the fr catalog
 *   needs translating.
 * - The `.po` catalogs are compiled on the fly by @lingui/vite-plugin:
 *   no `lingui compile` step is needed at build time.
 */
export default defineConfig({
  locales: ['fr', 'en'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/locales/{locale}/messages',
      include: ['<rootDir>'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/scripts/**', '**/*.test.*', '**/help/**'],
    },
  ],
  format: 'po',
  orderBy: 'origin',
});
