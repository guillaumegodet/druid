/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GRIST_DOC_ID: string
  /** Public Grist API read directly by the browser (read-only instance, e.g.
   * https://grist.numerique.gouv.fr/api); unset = through the /api/grist proxy. */
  readonly VITE_GRIST_PUBLIC_BASE_URL?: string
  readonly VITE_KEYCLOAK_URL: string
  readonly VITE_KEYCLOAK_REALM: string
  readonly VITE_KEYCLOAK_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Lingui catalogs imported via @lingui/vite-plugin (see lib/i18n.ts).
declare module '*.po' {
  import type { Messages } from '@lingui/core'
  export const messages: Messages
}
