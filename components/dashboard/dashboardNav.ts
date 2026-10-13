// Two-level navigation of the « Tableau de bord »: seven families of analyses, each holding the
// former flat tabs (docs/archive/plan-tableau-de-bord-familles.md, decisions D1 and D2). The leaf keys
// are unchanged: they stay in the URL (?tab=), in the help links (lib/helpLinks.ts), in the report
// catalog (report/reportCatalog.ts) and in the `druid_tabs_hidden` setting of the config.yaml.
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

export type DashboardTab =
  | 'overview'
  | 'collaborations'
  | 'impact'
  | 'books'
  | 'teams'
  | 'phd'
  | 'staff'
  | 'researchers'
  | 'network'
  | 'journals'
  | 'apc'
  | 'funders'
  | 'themes'
  | 'benchmark'
  | 'charte'
  | 'list'
  | 'news'
  | 'sources';

export type DashboardFamily =
  | 'overview'
  | 'publications'
  | 'impact'
  | 'collaborations'
  | 'people'
  | 'steering'
  | 'watch';

export interface DashboardTabDef {
  key: DashboardTab;
  label: MessageDescriptor;
  /** One-line description shown in the « Explore » cards of the overview. */
  hint: MessageDescriptor;
}

export interface DashboardFamilyDef {
  key: DashboardFamily;
  label: MessageDescriptor;
  /** Short description of the family (tooltip of the pill, « Explore » card). */
  description: MessageDescriptor;
  tabs: DashboardTabDef[];
}

export const DASHBOARD_FAMILIES: DashboardFamilyDef[] = [
  {
    key: 'overview',
    label: msg`Overview`,
    description: msg`Key figures, yearly evolution, publication types, open access and keywords.`,
    tabs: [
      { key: 'overview', label: msg`Overview`, hint: msg`Key figures and the main breakdowns of the corpus.` },
    ],
  },
  {
    key: 'publications',
    label: msg`Publications`,
    description: msg`What is published and where: books, journals, the full list and where the records come from.`,
    tabs: [
      { key: 'books', label: msg`Books`, hint: msg`Monographs, chapters and edited books by year and type.` },
      { key: 'journals', label: msg`Journals`, hint: msg`Publication journals, Scimago quartiles and access at the institution.` },
      { key: 'list', label: msg`Publication list`, hint: msg`Every publication, filterable and exportable as CSV.` },
      { key: 'sources', label: msg`Sources`, hint: msg`Where the publications come from (CRISalid, BSO, OpenAlex, HAL).` },
    ],
  },
  {
    key: 'impact',
    label: msg`Impact`,
    description: msg`Citations, field-normalised impact (FWCI) and comparison with other universities.`,
    tabs: [
      { key: 'impact', label: msg`Impact and citations`, hint: msg`FWCI, top 1 % / 10 %, most cited publications, by team and researcher.` },
      { key: 'benchmark', label: msg`Benchmark`, hint: msg`Position among comparable universities (Leiden ranking, OpenAlex).` },
    ],
  },
  {
    key: 'collaborations',
    label: msg`Collaborations`,
    description: msg`Who the structure publishes with: countries, partner institutions, other labs.`,
    tabs: [
      { key: 'collaborations', label: msg`Partnerships`, hint: msg`National and international co-publications, partner countries and institutions.` },
      { key: 'network', label: msg`Network`, hint: msg`Co-signature network between researchers and labs.` },
    ],
  },
  {
    key: 'people',
    label: msg({ message: 'People', context: 'dashboard family' }),
    description: msg`Who makes up the structure and who publishes: headcount, researchers, teams, PhD students.`,
    tabs: [
      { key: 'staff', label: msg`Directory`, hint: msg`Today's directory: presence, employers, grades, gender balance, identifier coverage.` },
      { key: 'researchers', label: msg`Researchers`, hint: msg`Publication rate per research FTE, age pyramid and most prolific authors.` },
      { key: 'teams', label: msg`Teams`, hint: msg`Production by team, members, disciplinary profile.` },
      { key: 'phd', label: msg`PhD students`, hint: msg`Publications involving PhD students, by team and by year.` },
    ],
  },
  {
    key: 'steering',
    label: msg`Steering`,
    description: msg`Strategy and compliance: strategic axes, funding, publication charges, signature charter.`,
    tabs: [
      { key: 'themes', label: msg`Strategic axes`, hint: msg`Publications matched to the strategic axes of the structure.` },
      { key: 'funders', label: msg`Funding`, hint: msg`Funders and projects cited in the publications.` },
      { key: 'apc', label: msg`APC monitoring`, hint: msg`Article processing charges paid and publisher agreements.` },
      { key: 'charte', label: msg`Signature charter`, hint: msg`Compliance of the affiliations with the signature charter.` },
    ],
  },
  {
    key: 'watch',
    label: msg`Watch`,
    description: msg`Live monitoring: new publications, media mentions, newsletter.`,
    tabs: [
      { key: 'news', label: msg`Watch`, hint: msg`New publications of the last weeks, media mentions and newsletter.` },
    ],
  },
];

/** Every leaf, in navigation order. */
export const DASHBOARD_TABS: DashboardTabDef[] = DASHBOARD_FAMILIES.flatMap((f) => f.tabs);

const FAMILY_OF: Record<DashboardTab, DashboardFamily> = Object.fromEntries(
  DASHBOARD_FAMILIES.flatMap((f) => f.tabs.map((t) => [t.key, f.key])),
) as Record<DashboardTab, DashboardFamily>;

export const isDashboardTab = (value: string | null | undefined): value is DashboardTab =>
  value != null && Object.prototype.hasOwnProperty.call(FAMILY_OF, value);

export const familyOf = (tab: DashboardTab): DashboardFamily => FAMILY_OF[tab];

/**
 * Families to display: those with at least one visible leaf, each reduced to its visible leaves
 * (same order as the catalog). The overview is always visible (tabAvailability).
 */
export function visibleFamilies(visibleTabs: Iterable<DashboardTab>): DashboardFamilyDef[] {
  const keep = new Set(visibleTabs);
  return DASHBOARD_FAMILIES
    .map((f) => ({ ...f, tabs: f.tabs.filter((t) => keep.has(t.key)) }))
    .filter((f) => f.tabs.length > 0);
}
