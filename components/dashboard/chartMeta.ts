// Report metadata of the embeddable charts (docs/plan-mes-rapports.md § 9.2):
// for each id of EMBED_CHARTS, the dashboard tab it belongs to, the dataset
// features it needs, the filters that make it degenerate, whether it names
// people, and its own parameters. Kept apart from embedRegistry.tsx (which
// pulls ECharts and every chart component) so that plain modules — URL
// decoding, report validation, tests — can read it.
// ⚠️ Keep the keys in sync with EMBEDDABLE_IDS (embedIds.ts) — checked by
// lib/__tests__/reportScope.test.ts.

import { hasSubStructures, unitsOfDataset } from './collabAggregates';
import type { PubFilters } from './publicationFilters';
import { TEAM_UNKNOWN } from './structureAggregates';
import type { DashboardDataset } from './types';

/**
 * Dataset features a chart needs to show something meaningful. A report block
 * whose chart lacks one is shown as « not available for this structure ».
 */
export type DatasetFeature =
  /** Composite structure: publications carry member labs (sousStructures). */
  | 'composite'
  /** Lab dashboard with identified teams. */
  | 'teams'
  /** Strategic axes configured and classified by the ETL. */
  | 'axes'
  /** PhD students identified among the authors. */
  | 'phd'
  /** NU journal access categories (journalAccess). */
  | 'journalAccess'
  /** Signature charter scores. */
  | 'charte'
  /**
   * Labs known for the publications: member labs of a composite structure, or the labs of the
   * authors in an institution export (unitsOfDataset).
   */
  | 'labs'
  /**
   * Not a dataset property: the block filters name a group of at least 2 partner institutions
   * (partnerKeys) — the per-university breakdown needs it (scopeFeatures).
   */
  | 'partnerGroup'
  /** Not a dataset property: the block filters name a partner country (pays-* charts, scopeFeatures). */
  | 'country'
  /** Regions (province, state) of the partner institutions — exports since 2026-10-07. */
  | 'regions';

/**
 * Parameter of a chart: an integer between `min` and `max`, or one of `values`.
 * A missing value means the chart's usual default. (Flat shape rather than a
 * tagged union: the non-strict tsconfig narrows it poorly.)
 */
export interface ChartParamDef {
  key: string;
  min?: number;
  max?: number;
  /** Allowed values of an enumerated parameter (min/max ignored). */
  values?: string[];
  /** Omitted when the chart computes its default from the data (e.g. network threshold). */
  default?: number | string;
}

export type ChartParams = Record<string, number | string>;

export interface ChartMeta {
  /** DashboardPage tab (same keys as REPORT_SECTIONS). */
  tab: string;
  requires?: DatasetFeature[];
  /**
   * Filters under which the chart degenerates (e.g. share of international
   * publications once restricted to one foreign partner): the report editor
   * warns, templates do not offer it. Signalled, never blocked.
   */
  trivialUnder?: (keyof PubFilters)[];
  /** Names people: warning in the sharing dialog, excluded from any future public link. */
  nominative?: boolean;
  /** Coverage diagnosis: only offered by the « structure report » template. */
  technical?: boolean;
  params?: ChartParamDef[];
}

const FOREIGN_SUBSET: (keyof PubFilters)[] = [
  'international', 'country', 'partnerInstitution', 'partnerKeys',
];
const CHARTE_PARAMS: ChartParamDef[] = [{ key: 'thresholdPct', min: 0, max: 100, default: 75 }];
const LEVEL_PARAM: ChartParamDef = { key: 'level', values: ['subfield', 'topic'], default: 'subfield' };
/** Hospitals and institutes folded under their university (pays-* institution charts). */
const GROUP_PARAM: ChartParamDef = { key: 'group', values: ['separate', 'grouped'], default: 'separate' };
const country = (extra: Partial<ChartMeta> = {}): ChartMeta => ({
  tab: 'collaborations', requires: ['country'], ...extra,
});
const charte = (extra: Partial<ChartMeta> = {}): ChartMeta => ({
  tab: 'charte', requires: ['charte'], params: CHARTE_PARAMS, ...extra,
});

export const CHART_META: Record<string, ChartMeta> = {
  // ── Overview
  'publications-par-annee': { tab: 'overview' },
  langues: { tab: 'overview' },
  'types-publications': { tab: 'overview' },
  'acces-ouvert': { tab: 'overview' },
  'top-mots-cles': { tab: 'overview' },
  'top-sous-domaines': { tab: 'overview' },
  domaines: { tab: 'overview', trivialUnder: ['domain'] },
  // ── Collaborations — international
  'international-vs-national': { tab: 'collaborations', trivialUnder: FOREIGN_SUBSET },
  'pourcentage-international': { tab: 'collaborations', trivialUnder: FOREIGN_SUBSET },
  'carte-monde': { tab: 'collaborations' },
  'carte-flux': { tab: 'collaborations' },
  'top-pays': { tab: 'collaborations' },
  'pays-annees': { tab: 'collaborations' },
  'evolution-pays': {
    tab: 'collaborations',
    trivialUnder: ['country'],
    params: [{ key: 'n', min: 3, max: 8, default: 6 }],
  },
  'zone-ue': { tab: 'collaborations', trivialUnder: ['country'] },
  'ue-par-annee': { tab: 'collaborations', trivialUnder: ['country'] },
  'top-partenaires': { tab: 'collaborations' },
  'flux-sankey': { tab: 'collaborations' },
  'sunburst-partenariats': { tab: 'collaborations' },
  'reseau-equipes-organismes': { tab: 'collaborations' },
  // ── Collaborations — typology / structure / NU / national
  'collab-typologie': { tab: 'collaborations', trivialUnder: FOREIGN_SUBSET },
  'collab-typologie-evolution': { tab: 'collaborations', trivialUnder: FOREIGN_SUBSET },
  'collab-structure-top': { tab: 'collaborations', requires: ['composite'] },
  'collab-structure-evolution': { tab: 'collaborations', requires: ['composite'] },
  'collab-structure-domaines': { tab: 'collaborations', requires: ['composite'] },
  'collab-structure-sous-disciplines': { tab: 'collaborations', requires: ['composite'] },
  'collab-structure-sankey': { tab: 'collaborations', requires: ['composite'] },
  'collab-nu-top': { tab: 'collaborations' },
  'collab-nu-evolution': { tab: 'collaborations' },
  'collab-nu-domaines': { tab: 'collaborations' },
  'collab-nu-sous-disciplines': { tab: 'collaborations' },
  'collab-nu-sankey': { tab: 'collaborations' },
  // Per-university breakdown of a partner group (plan-mes-rapports lot 7, « Collaboration avec une
  // université » template): the institutions are read from the block filters (partnerKeys).
  'partner-breakdown-top': { tab: 'collaborations', requires: ['partnerGroup'] },
  'partner-breakdown-evolution': { tab: 'collaborations', requires: ['partnerGroup'] },
  // One partner country (« By country » sub-tab, docs/archive/plan-collaboration-pays.md lot 5): the country
  // is read from the block filters.
  'pays-evolution': country(),
  'pays-rang': country(),
  'pays-carte': country(),
  'pays-etablissements': country({ params: [GROUP_PARAM] }),
  'pays-regions': country({ requires: ['country', 'regions'] }),
  'pays-labos': country({ requires: ['country', 'labs'] }),
  'pays-chercheurs': country({ nominative: true, trivialUnder: ['authorId'] }),
  'pays-matrice': country({ requires: ['country', 'labs'], params: [GROUP_PARAM] }),
  'pays-domaines': country({ trivialUnder: ['domain'] }),
  'pays-sous-disciplines': country({ trivialUnder: ['subfield'] }),
  'pays-specialisation': country({ trivialUnder: ['subfield', 'domain'] }),
  'pays-financeurs': country({ trivialUnder: ['funder'] }),
  'pays-bilateral': country(),
  'pays-pays-tiers': country(),
  'pays-langues': country({ trivialUnder: ['language'] }),
  'collab-national-top': { tab: 'collaborations' },
  'collab-national-evolution': { tab: 'collaborations' },
  'carte-france': { tab: 'collaborations' },
  // ── Impact
  'quartiles-scimago': { tab: 'impact' },
  'top-par-annee': { tab: 'impact' },
  'distribution-fwci': { tab: 'impact' },
  'impact-fwci-sous-structure': { tab: 'impact', requires: ['composite'] },
  'impact-top-sous-structure': { tab: 'impact', requires: ['composite'] },
  'impact-fwci-equipe': { tab: 'impact', requires: ['teams'] },
  'impact-top-equipe': { tab: 'impact', requires: ['teams'] },
  'impact-fwci-chercheur': { tab: 'impact', nominative: true },
  'impact-top-chercheur': { tab: 'impact', nominative: true },
  // ── Books
  'ouvrages-types': { tab: 'books', trivialUnder: ['pubType'] },
  'ouvrages-par-annee': { tab: 'books', trivialUnder: ['pubType'] },
  // ── Journals
  'top-revues': {
    tab: 'journals',
    trivialUnder: ['journal'],
    params: [{ key: 'n', min: 5, max: 50, default: 20 }],
  },
  'acces-revues': { tab: 'journals', requires: ['journalAccess'], trivialUnder: ['journal', 'journalAccess'] },
  'acces-revues-barres': { tab: 'journals', requires: ['journalAccess'], trivialUnder: ['journal', 'journalAccess'] },
  'acces-revues-evolution': { tab: 'journals', requires: ['journalAccess'], trivialUnder: ['journal', 'journalAccess'] },
  // ── APC tracking
  'apc-evolution': { tab: 'apc' },
  'apc-par-revue': { tab: 'apc' },
  'apc-elsevier-par-labo': { tab: 'apc', requires: ['composite'] },
  // ── Funding
  'funders-top': { tab: 'funders', trivialUnder: ['funder'] },
  'funders-categories': { tab: 'funders', trivialUnder: ['funderCategory', 'funder'] },
  'funders-evolution': { tab: 'funders' },
  'funders-par-labo': { tab: 'funders', requires: ['composite'] },
  // ── Strategic axes
  'axes-repartition': { tab: 'themes', requires: ['axes'], trivialUnder: ['axe'] },
  'axes-barres': { tab: 'themes', requires: ['axes'], trivialUnder: ['axe'] },
  'axes-evolution': { tab: 'themes', requires: ['axes'], trivialUnder: ['axe'] },
  'axes-types': { tab: 'themes', requires: ['axes'], trivialUnder: ['axe'] },
  // ── Signature charter
  'charte-conformite': charte({ trivialUnder: ['charterCompliant'] }),
  'charte-scores': charte(),
  'charte-evolution': charte({ trivialUnder: ['charterCompliant'] }),
  'charte-criteres': charte(),
  'charte-equipes': charte({ requires: ['charte', 'teams'] }),
  // ── Teams / PhD students / Researchers / Network
  'equipes-repartition': { tab: 'teams', requires: ['teams'], trivialUnder: ['team'] },
  'equipes-evolution': { tab: 'teams', requires: ['teams'], trivialUnder: ['team'] },
  'equipes-types': { tab: 'teams', requires: ['teams'], trivialUnder: ['team'] },
  'labos-classement': { tab: 'teams', requires: ['labs'], trivialUnder: ['sousStructure'] },
  'radar-disciplinaire': { tab: 'teams', requires: ['teams'], params: [LEVEL_PARAM] },
  'heatmap-disciplinaire': { tab: 'teams', requires: ['teams'], params: [LEVEL_PARAM] },
  'doctorants-repartition': { tab: 'phd', requires: ['phd'] },
  'doctorants-evolution': { tab: 'phd', requires: ['phd'] },
  'doctorants-classement': { tab: 'phd', requires: ['phd'], nominative: true },
  'chercheurs-classement': { tab: 'researchers', nominative: true, trivialUnder: ['authorId'] },
  'reseau-cosignatures': {
    tab: 'network',
    nominative: true,
    params: [{ key: 'minPubs', min: 1, max: 50 }],
  },
  // ── Sources / coverage
  'sources-repartition': { tab: 'sources', technical: true },
  'sources-recouvrements': { tab: 'sources', technical: true },
  'sources-evolution': { tab: 'sources', technical: true },
  'sources-harvester-detail': { tab: 'sources', technical: true },
  'sources-openalex-lookup': { tab: 'sources', technical: true },
};

/** Features actually present in a dataset (compare with ChartMeta.requires). */
export function datasetFeatures(dataset: DashboardDataset): Set<DatasetFeature> {
  const pubs = dataset.publications;
  const out = new Set<DatasetFeature>();
  if (hasSubStructures(pubs)) out.add('composite');
  if (pubs.some((p) => p.teams.some((t) => t && t !== TEAM_UNKNOWN))) out.add('teams');
  if (dataset.strategicAxes.length > 0 && pubs.some((p) => p.chosenAxe)) out.add('axes');
  if (pubs.some((p) => p.hasPhd)) out.add('phd');
  if (pubs.some((p) => p.journalAccess != null)) out.add('journalAccess');
  if (pubs.some((p) => p.charte?.score != null)) out.add('charte');
  if (unitsOfDataset(dataset).kind === 'labs') out.add('labs');
  if (pubs.some((p) => p.partnerInstitutions.some((o) => o.region))) out.add('regions');
  return out;
}

/** Dataset features plus those given by the block filters (partnerGroup, country). */
export function scopeFeatures(features: Set<DatasetFeature>, filters: PubFilters): Set<DatasetFeature> {
  const out = new Set(features);
  if ((filters.partnerKeys?.length ?? 0) >= 2) out.add('partnerGroup');
  if (filters.country) out.add('country');
  return out;
}

/** Features a chart needs and the dataset lacks (empty = available). */
export function missingFeatures(chartId: string, features: Set<DatasetFeature>): DatasetFeature[] {
  return (CHART_META[chartId]?.requires ?? []).filter((f) => !features.has(f));
}

/** Active filters under which the chart degenerates (empty = meaningful). */
export function trivialFiltersOf(chartId: string, filters: PubFilters): (keyof PubFilters)[] {
  return (CHART_META[chartId]?.trivialUnder ?? []).filter((k) => {
    const v = filters[k];
    return Array.isArray(v) ? v.length > 0 : v != null && v !== false && v !== '';
  });
}

/**
 * Chart parameters for rendering: known keys only, integers rounded and
 * clamped to their bounds, enumerated values kept only when allowed.
 */
export function sanitizeChartParams(
  chartId: string,
  raw: Record<string, unknown> | null | undefined,
): ChartParams {
  const out: ChartParams = {};
  if (!raw) return out;
  for (const def of CHART_META[chartId]?.params ?? []) {
    const v = raw[def.key];
    if (def.values) {
      if (typeof v === 'string' && def.values.includes(v)) out[def.key] = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[def.key] = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, Math.round(v)));
    }
  }
  return out;
}

/** Integer parameter of a sanitized set (undefined when absent). */
export function intParam(params: ChartParams | undefined, key: string): number | undefined {
  const v = params?.[key];
  return typeof v === 'number' ? v : undefined;
}

/** Enumerated parameter of a sanitized set (undefined when absent). */
export function enumParam<T extends string>(params: ChartParams | undefined, key: string): T | undefined {
  const v = params?.[key];
  return typeof v === 'string' ? (v as T) : undefined;
}
