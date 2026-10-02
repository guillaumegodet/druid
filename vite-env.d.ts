/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Build-time fallbacks of the instance settings sent by /api/me (lib/instanceRuntime.ts).
  readonly VITE_GRIST_DOC_ID?: string
  /** Public Grist API read directly by the browser (read-only instance, e.g.
   * https://grist.numerique.gouv.fr/api); unset = through the /api/grist proxy. */
  readonly VITE_GRIST_PUBLIC_BASE_URL?: string
  /** Grist web interface hosting the doc (default https://grist.numerique.gouv.fr). */
  readonly VITE_GRIST_UI_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Lingui catalogs imported via @lingui/vite-plugin (see lib/i18n.ts).
declare module '*.po' {
  import type { Messages } from '@lingui/core'
  export const messages: Messages
}
