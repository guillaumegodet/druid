import { normalizeAcronym } from './normalize';
import { purgeStoredDirectory } from './directoryStorage';
import { installReadOnlyFetchGuard } from './readOnly';
import { installSessionExpiryGuard } from './sessionGuard';
import { gristPublicBaseUrl, setInstanceInfo, type InstanceInfo } from './instanceRuntime';

/** Scope resolved server-side from the `groups` claim of the Keycloak token
 * (group tree institution > lab > role, see server.cjs parseDruidAccess)
 * — 'all' for an institution-level right. */
interface DruidAccess {
  isSuperAdmin: boolean;
  /** Cross-cutting `media_admin` role (communications officer): manages the
   * media monitoring sources, without the other super admin rights. */
  isMediaAdmin: boolean;
  /** Generic lab right (`/NantesUniversite/labo_viewer`): scope derived from the
   * user's Annuaire record at login (server.cjs resolveAnnuaireLabs). */
  isLabViewer: boolean;
  /** LABO acronyms found in the Annuaire for this account (generic lab right). */
  annuaireLabs: string[];
  allowedSlugs: 'all' | string[];
}

/** Capabilities derived from the config present on the instance (see
 * docs/plan-architecture-multi-instances.md, lot 1) — replace the former
 * single flag `VITE_HIDE_NANTES_FEATURES` (Centrale/Cloudflare) with one flag
 * per integration, computed server-side (server.cjs / functions/api/me.js)
 * from the environment variables/secrets actually configured. */
export interface DruidCapabilities {
  /** Directory sync from the university LDAP. */
  HAS_LDAP: boolean;
  /** Administration section → « Gestion des droits » tab (Keycloak admin API). */
  HAS_KEYCLOAK_ADMIN: boolean;
  /** ETL console (druid-etl-api) and Python dataviz served by the server
   * (e.g. /api/structures-hierarchy.html) — unavailable on Cloudflare Functions. */
  HAS_ETL_API: boolean;
  /** Chat widget backed by Pipelines/ILAAS (CRISalid assistant). */
  HAS_PIPELINES_CHAT: boolean;
  /** « Aide Druid » tab of the assistant: answers from the help centre pages through ILAAS
   * (/api/help-chat, docs/plan-documentation-utilisateur.md lot 8). */
  HAS_HELP_CHAT: boolean;
  /** Export to the SoVisu+/cdb directory bridge (structures.csv, people.csv). */
  HAS_SOVISU_EXPORT: boolean;
  /** The server runtime can start long-running child scripts
   * (e.g. sync_idref.cjs triggered from /api/sync-idref-trigger) — true on
   * server.cjs/Docker, false on Cloudflare Pages Functions (no child_process). */
  HAS_SERVER_JOBS: boolean;
  /** Benchmark module (external collaboration) — not merged yet (lot 3 of the plan). */
  HAS_BENCHMARK: boolean;
  /** Inter-lab mode of the « Réseau » tab: /api/network of server.cjs, fed by the network.json of
   * druid-biblio (docs/plan-reseau-inter-labos.md) — false on Cloudflare. */
  HAS_NETWORK_API: boolean;
  /** IdRef alignment enriched by the Neo4j context (scripts/sync_idref_qualinka.cjs,
   * `align` mode of /api/sync-idref-trigger) — without it, IdRef alignment remains available
   * through the generic Solr pipeline (scripts/sync_idref.cjs, search/verify modes). */
  HAS_QUALINKA: boolean;
  /** Derived internal/external status + manual validation layer (« Statut » column of the
   * list, filters, reliability panel, import of a curated list). False for an instance
   * that only enters its internal researchers and has no need to validate (Centrale). */
  HAS_STATUS_VALIDATION: boolean;
  /** « À traiter › Tâches » and « Affiliations OpenAlex » tabs, « Report a correction » button
   * (docs/plan-chantiers-taches.md): /api/tasks routes of server.cjs — false on Cloudflare. */
  HAS_TASKS: boolean;
  /** Public read-only instance (demo on Cloudflare, docs/plan-instance-demo-cloudflare.md):
   * the Grist proxy refuses every write and the UI hides editing. Unlike the HAS_* flags it
   * removes features; false everywhere except where READ_ONLY=true is configured. */
  READ_ONLY: boolean;
}

interface UserInfo {
  name: string;
  email: string;
  preferred_username: string;
  roles: string[];
  access: DruidAccess;
  capabilities: DruidCapabilities;
  /** Settings of the instance (lib/instanceRuntime.ts, plan-architecture-multi-instances lot 6 a). */
  instance?: InstanceInfo;
  /** Deployment environment (server DRUID_ENV): `production`, `test`… Absent on Cloudflare = production. */
  environment?: string;
  /** `session` when the server authenticates by session cookie (server.cjs); absent on Cloudflare. */
  auth?: 'session';
}

const EMPTY_ACCESS: DruidAccess = { isSuperAdmin: false, isMediaAdmin: false, isLabViewer: false, annuaireLabs: [], allowedSlugs: [] };
const EMPTY_CAPABILITIES: DruidCapabilities = {
  HAS_LDAP: false,
  HAS_KEYCLOAK_ADMIN: false,
  HAS_ETL_API: false,
  HAS_PIPELINES_CHAT: false,
  HAS_HELP_CHAT: false,
  HAS_SOVISU_EXPORT: false,
  HAS_SERVER_JOBS: false,
  HAS_BENCHMARK: false,
  HAS_NETWORK_API: false,
  HAS_QUALINKA: false,
  HAS_STATUS_VALIDATION: false,
  HAS_TASKS: false,
  READ_ONLY: false,
};

let _userInfo: UserInfo | null = null;

/** Deployment shared by several instances (plan-architecture-multi-instances lot 6 b): /api/me answers 404
 * for a host that no instance declares. A redirection to /auth/login would loop, so the page says it
 * (plain text, before the language catalog is loaded). */
const showUnknownInstance = (): void => {
  const root = document.getElementById('root') ?? document.body;
  const p = document.createElement('p');
  p.style.cssText = 'font-family:sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5';
  p.textContent = `Aucune instance Druid n'est déclarée pour ${window.location.hostname}. — No Druid instance is declared for this address.`;
  root.replaceChildren(p);
};

/** Back to the login, then to the current page (server-side `?next=`). `replace`: the dead page
 *  leaves no history entry, so the back button never lands on the OAuth callback. */
export const redirectToLogin = (): void => {
  window.location.replace(`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
};

export const initKeycloak = (onAuthenticated: () => void): void => {
  fetch('/api/me')
    .then((res) => {
      if (res.status === 404) {
        showUnknownInstance();
        return null;
      }
      if (!res.ok) {
        redirectToLogin();
        return null;
      }
      return res.json() as Promise<UserInfo>;
    })
    .then((data) => {
      if (data) {
        _userInfo = data;
        setInstanceInfo(data.instance);
        // Read-only instance: reject every write before it leaves the browser (lib/readOnly.ts).
        if (data.capabilities?.READ_ONLY) installReadOnlyFetchGuard(gristPublicBaseUrl());
        // Server session lost (deployment, expiry): every /api/… 401 sends the tab back to the login.
        if (data.auth === 'session') installSessionExpiryGuard(redirectToLogin);
        onAuthenticated();
      }
    })
    .catch(() => {
      redirectToLogin();
    });
};

/** Deployment environment of the server (druid-internal/docs/plan-separation-test-prod-rssi.md, lot 1):
 *  anything but `production` shows the environment banner. */
export const getEnvironment = (): string => _userInfo?.environment || 'production';

export const isProductionEnvironment = (): boolean => getEnvironment() === 'production';

export const getRoles = (): string[] => _userInfo?.roles ?? [];

export const hasRole = (role: string): boolean => getRoles().includes(role);

export const getUserInfo = (): UserInfo => _userInfo ?? {
  name: '',
  email: '',
  preferred_username: '',
  roles: [],
  access: EMPTY_ACCESS,
  capabilities: EMPTY_CAPABILITIES,
};

/** Capability of the current instance (independent of the user's rights,
 * see DruidCapabilities) — replaces the `import.meta.env.VITE_HIDE_NANTES_FEATURES` checks. */
export const hasCapability = (flag: keyof DruidCapabilities): boolean =>
  _userInfo?.capabilities?.[flag] ?? false;

/** False on a read-only instance (READ_ONLY capability, public demo): the edit entry points
 * (save, create, merge, validate…) are hidden. */
export const canWrite = (): boolean => !hasCapability('READ_ONLY');

/** Super admin: full access + « Gestion des droits » tab. */
export const isSuperAdmin = (): boolean => _userInfo?.access.isSuperAdmin ?? false;

/** media_admin role (communications officer): access to the media monitoring
 * Sources page, without the other super admin rights. */
export const isMediaAdmin = (): boolean => _userInfo?.access.isMediaAdmin ?? false;

/** Right to manage the media monitoring sources (Sources page). */
export const canAdminMediaSources = (): boolean => isSuperAdmin() || isMediaAdmin();

/** Tabs of the Administration section available to the user (display order). */
export type AdminTab = 'console' | 'rights' | 'media';
export const adminTabsFor = (): AdminTab[] => {
  const tabs: AdminTab[] = [];
  // console/rights assume a server (ETL relay, Keycloak admin API): absent on
  // Cloudflare Functions (Centrale) → tab removed rather than crashing on data that never
  // arrives (see docs/archive/plan-fusion-centrale-2026-09.md, sub-lot 4).
  if (getRoles().includes('admin') && hasCapability('HAS_ETL_API')) tabs.push('console');
  if (isSuperAdmin() && hasCapability('HAS_KEYCLOAK_ADMIN')) tabs.push('rights');
  if (canAdminMediaSources()) tabs.push('media');           // media monitoring sources
  return tabs;
};
/** The « Administration » entry of the bar is visible as soon as one tab is available. */
export const canSeeAdmin = (): boolean => adminTabsFor().length > 0;

/** Generic lab right (lab derived from the Annuaire): for the welcome message. */
export const isLabViewer = (): boolean => _userInfo?.access.isLabViewer ?? false;
export const getAnnuaireLabs = (): string[] => _userInfo?.access.annuaireLabs ?? [];

/** Institution-level right (or super admin): sees everything, unfiltered. */
export const hasFullAccess = (): boolean => _userInfo?.access.allowedSlugs === 'all';

/**
 * "Institution" tools: Structures tab, alignment tools (IdRef, ORCID, HAL,
 * OpenAlex, LDAP candidates) and the Synchroniser menu of the staff list.
 * Reserved to admins and to central services staff (SCD, DR, steering,
 * VP…), i.e. to rights carried at the institution level
 * (`/NantesUniversite/{admin,dashboard_viewer}`). A lab director or manager
 * (`/NantesUniversite/<labo>/dashboard_viewer`) only sees Staff and
 * Dashboard, filtered on their lab (see useDruidData, /api/dashboard-structures).
 */
export const canUseEstablishmentTools = (): boolean => hasFullAccess();

/**
 * Effective scope: is the given acronym/slug visible to the user?
 * `allowedSlugs` holds the Keycloak group anchors (already lowercase, see
 * server.cjs parseDruidAccess); only the Grist acronym side is normalized
 * (accents/case/punctuation, see normalizeAcronym) before comparing.
 */
export const canSeeStructure = (acronymOrSlug: string): boolean => {
  const allowed = _userInfo?.access.allowedSlugs ?? [];
  if (allowed === 'all') return true;
  return allowed.includes(normalizeAcronym(acronymOrSlug));
};

export const logout = (): void => {
  purgeStoredDirectory();
  window.location.href = '/auth/logout';
};
