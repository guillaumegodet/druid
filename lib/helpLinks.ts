/**
 * @file helpLinks.ts
 * @description Context help: which page of the user help centre (help/, published on the
 * « druid-aide » Cloudflare Worker) answers each Druid view, dashboard tab, « À traiter » tab
 * and Administration tab (docs/plan-documentation-utilisateur.md, lot 4).
 *
 * The tables are `Record`s keyed by the view / tab unions: adding a view or a tab without a
 * help link fails the type check. lib/__tests__/helpLinks.test.ts checks that every target
 * page (and anchor) exists in help/src/content/docs, in French and in English.
 *
 * Paths and anchors are the French ones. The English help (docs/plan-aide-anglais.md) lives under
 * /en/ with the same paths but translated headings: helpUrl() maps the anchors through EN_ANCHORS.
 */
import { ViewState } from '../types';
import type { AdminTab } from './auth';
import type { DashboardTab } from '../components/DashboardPage';
import type { TodoTab } from '../components/researchers/TodoPage';

/** Public URL of the help centre, overridable per instance (e.g. a custom domain). */
export const HELP_BASE_URL: string =
  (import.meta.env.VITE_HELP_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://druid-aide.guillaumegodet.workers.dev';

/** Help page (path relative to the help site, optional `#anchor`) of each Druid view. */
export const VIEW_HELP: Record<ViewState, string> = {
  [ViewState.RESEARCHERS_LIST]: '/guides/personnes/rechercher-filtrer/',
  [ViewState.RESEARCHER_DETAIL]: '/guides/personnes/lire-une-fiche/',
  [ViewState.STRUCTURES_LIST]: '/donnees/structures/',
  [ViewState.STRUCTURE_DETAIL]: '/guides/structures-groupes/mettre-a-jour-une-structure/',
  [ViewState.GROUPS_LIST]: '/guides/structures-groupes/creer-un-groupe/',
  [ViewState.UNIFIED_ALIGN]: '/guides/identifiants/aligner-les-identifiants/',
  [ViewState.LDAP_ALIGN]: '/guides/identifiants/aligner-ldap/',
  [ViewState.TASKS]: '/guides/personnes/taches-a-traiter/',
  [ViewState.DASHBOARD]: '/guides/tableau-de-bord/structure-periode-perimetre/',
  [ViewState.REPORTS]: '/guides/rapports/creer-un-rapport/',
  [ViewState.ADMIN]: '/guides/administration/console-etl/',
};

/** Help page of each dashboard tab (takes precedence over VIEW_HELP on the dashboard). */
export const DASHBOARD_TAB_HELP: Record<DashboardTab, string> = {
  overview: '/guides/tableau-de-bord/structure-periode-perimetre/',
  collaborations: '/guides/tableau-de-bord/collaborations/',
  impact: '/donnees/indicateurs/#impact',
  books: '/donnees/indicateurs/#volume-et-profil',
  journals: '/donnees/indicateurs/#quartiles-des-revues',
  apc: '/donnees/indicateurs/#apc',
  funders: '/donnees/indicateurs/',
  themes: '/donnees/indicateurs/',
  benchmark: '/donnees/indicateurs/',
  charte: '/donnees/publications-attribution/#charte-de-signature',
  teams: '/donnees/publications-attribution/#comment-les-auteurs-sont-reconnus',
  phd: '/donnees/publications-attribution/#comment-les-auteurs-sont-reconnus',
  researchers: '/guides/tableau-de-bord/chercheurs-effectifs/',
  network: '/guides/tableau-de-bord/reseau/',
  list: '/guides/tableau-de-bord/liste-des-publications/',
  news: '/guides/veille/nouvelles-publications/',
  sources: '/donnees/sources-des-donnees/#longlet-sources-du-tableau-de-bord',
};

/** Help page of each « À traiter » tab. */
export const TODO_TAB_HELP: Record<TodoTab, string> = {
  doublons: '/guides/personnes/traiter-un-doublon/',
  taches: '/guides/personnes/taches-a-traiter/',
  affiliations: '/guides/corriger/affiliation-fausse/',
  conflits: '/guides/personnes/taches-a-traiter/',
};

/** Help page of each Administration tab. */
export const ADMIN_TAB_HELP: Record<AdminTab, string> = {
  console: '/guides/administration/console-etl/',
  rights: '/guides/administration/donner-des-droits/',
  media: '/guides/veille/sources-medias/',
};

/**
 * English anchor of each French anchor used above whose heading translates differently
 * (an anchor missing here is the same in both languages, e.g. `impact`).
 */
export const EN_ANCHORS: Record<string, string> = {
  'volume-et-profil': 'volume-and-profile',
  'quartiles-des-revues': 'journal-quartiles',
  apc: 'apcs',
  'charte-de-signature': 'signature-charter',
  'comment-les-auteurs-sont-reconnus': 'how-authors-are-recognised',
  'longlet-sources-du-tableau-de-bord': 'the-sources-tab-of-the-dashboard',
};

/**
 * Absolute URL of a help page (path from the tables above; '' or '/' = home page), in the
 * interface language: English pages are served under /en/ with their own anchors.
 */
export const helpUrl = (path = '/', locale = 'fr'): string => {
  const rel = path.startsWith('/') ? path : `/${path}`;
  if (locale !== 'en') return `${HELP_BASE_URL}${rel}`;
  const [page, anchor] = rel.split('#');
  const enAnchor = anchor ? (EN_ANCHORS[anchor] ?? anchor) : '';
  return `${HELP_BASE_URL}/en${page}${enAnchor ? `#${enAnchor}` : ''}`;
};
