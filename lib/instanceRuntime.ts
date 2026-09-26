/**
 * @file instanceRuntime.ts
 * @description Instance settings received at runtime (docs/plan-architecture-multi-instances.md,
 * lot 6 a): the `instance` block of /api/me (functions/api/me.js from instance.json, server.cjs from
 * its environment) instead of values baked into the bundle, so that one build can serve several
 * instances. The build-time variables (VITE_GRIST_DOC_ID, VITE_GRIST_PUBLIC_BASE_URL,
 * VITE_GRIST_UI_URL) remain a fallback while a server does not send the block yet.
 *
 * The app renders only after /api/me answered (index.tsx → initKeycloak): every Grist call happens
 * after `setInstanceInfo`.
 */

export interface InstanceInfo {
  slug: string;
  label: string;
  /** Grist doc of the instance: the only one its proxy relays. */
  gristDocId: string;
  /** Public Grist API read directly by the browser (read-only instance with a public doc), or null:
   * every Grist request goes through the /api/grist proxy. */
  gristPublicBaseUrl: string | null;
  /** Grist web interface hosting the doc (link « open in Grist »). */
  gristUiUrl: string;
}

const DEFAULT_GRIST_UI_URL = 'https://grist.numerique.gouv.fr';
const PROXY_BASE = '/api/grist';

let runtime: Partial<InstanceInfo> | null = null;

/** Stores the `instance` block of /api/me (absent on an older server: build-time fallback). */
export const setInstanceInfo = (info: Partial<InstanceInfo> | null | undefined): void => {
  runtime = info && typeof info === 'object' ? info : null;
};

const has = <K extends keyof InstanceInfo>(key: K): boolean => !!runtime && key in runtime;

export const gristDocId = (): string =>
  (has('gristDocId') ? runtime!.gristDocId : import.meta.env.VITE_GRIST_DOC_ID) || '';

/** Public Grist API base, or '' when the instance reads through the proxy. */
export const gristPublicBaseUrl = (): string =>
  ((has('gristPublicBaseUrl') ? runtime!.gristPublicBaseUrl : import.meta.env.VITE_GRIST_PUBLIC_BASE_URL) || '')
    .replace(/\/+$/, '');

/** Base of every Grist API call of the app: the public API when readable directly, else the proxy
 * (which injects the key server-side — never set a public base on a writable instance). */
export const gristApiBase = (): string => gristPublicBaseUrl() || PROXY_BASE;

/** `<API base>/docs/<doc>`: prefix of the Grist calls of the app. */
export const gristDocUrl = (): string => `${gristApiBase()}/docs/${gristDocId()}`;

/** Link to the doc in the Grist web interface, or null without a doc. */
export const gristUiDocUrl = (): string | null => {
  const doc = gristDocId();
  if (!doc) return null;
  const base = (has('gristUiUrl') ? runtime!.gristUiUrl : import.meta.env.VITE_GRIST_UI_URL) || DEFAULT_GRIST_UI_URL;
  return `${String(base).replace(/\/+$/, '')}/${doc}`;
};
