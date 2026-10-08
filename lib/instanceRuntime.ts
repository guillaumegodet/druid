/**
 * @file instanceRuntime.ts
 * @description Instance settings received at runtime (docs/plan-architecture-multi-instances.md,
 * lot 6 a): the `instance` block of /api/me (functions/api/me.js from instance.json, server.cjs from
 * its environment) instead of values baked into the bundle, so that one build can serve several
 * instances. The build-time variables (VITE_GRIST_DOC_ID, VITE_GRIST_PUBLIC_BASE_URL,
 * VITE_GRIST_UI_URL) remain a fallback while a server does not send the block yet.
 *
 * The browser never calls Grist (domain API /api/v1 since druid-internal docs/plan-migration-postgresql.md, lot 2): the
 * doc id only builds the « open in Grist » link.
 */

export interface InstanceInfo {
  slug: string;
  label: string;
  /** Grist doc of the instance. */
  gristDocId: string;
  /** Public Grist API base still sent by the servers; no longer used by the browser. */
  gristPublicBaseUrl: string | null;
  /** Grist web interface hosting the doc (link « open in Grist »). */
  gristUiUrl: string;
}

const DEFAULT_GRIST_UI_URL = 'https://grist.numerique.gouv.fr';

let runtime: Partial<InstanceInfo> | null = null;

/** Stores the `instance` block of /api/me (absent on an older server: build-time fallback). */
export const setInstanceInfo = (info: Partial<InstanceInfo> | null | undefined): void => {
  runtime = info && typeof info === 'object' ? info : null;
};

const has = <K extends keyof InstanceInfo>(key: K): boolean => !!runtime && key in runtime;

export const gristDocId = (): string =>
  (has('gristDocId') ? runtime!.gristDocId : import.meta.env.VITE_GRIST_DOC_ID) || '';

/** Link to the doc in the Grist web interface, or null without a doc. */
export const gristUiDocUrl = (): string | null => {
  const doc = gristDocId();
  if (!doc) return null;
  const base = (has('gristUiUrl') ? runtime!.gristUiUrl : import.meta.env.VITE_GRIST_UI_URL) || DEFAULT_GRIST_UI_URL;
  return `${String(base).replace(/\/+$/, '')}/${doc}`;
};
