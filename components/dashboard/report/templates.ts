// Report templates (docs/plan-mes-rapports.md § 5): a template turns a few parameters (structure,
// period, scope, sometimes a country) into a full report definition — « two clicks » from the
// creation dialog. The result is an ordinary report: every block stays editable. The template
// id and parameters are kept in the definition (information only, no live link).

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { datasetFeatures, missingFeatures, scopeFeatures, trivialFiltersOf } from '../chartMeta';
import { buildPartnerCatalog } from '../collabAggregates';
import { LARGE_COLLAB_AUTHORS } from '../partnerKpis';
import type { PubFilters } from '../publicationFilters';
import { visibleTabKeys } from '../tabAvailability';
import type { DashboardDataset } from '../types';
import { newBlockId, type ReportBlock, type ReportDefinition, type ReportPeriod } from './definition';
import { REPORT_SECTIONS } from './reportCatalog';

/** Parameters a template asks for, in form order. */
export type TemplateParam = 'structure' | 'period' | 'perimetre' | 'country' | 'partners';

export interface TemplateInput {
  name: string;
  slug: string;
  period: ReportPeriod;
  perimetre: 'affiliation' | 'effectifs';
  /** ISO-2 partner country (international collaborations), empty = all countries. */
  country?: string;
  /** Partner institutions (catalog keys: ROR, else `<scope>:<name>`) — collaboration template. */
  partners?: string[];
  lang: 'fr' | 'en';
}

/** What a template may read about the chosen structure. */
export interface TemplateEnv {
  /** Unfiltered dataset of the structure (null: unknown → every chart is kept). */
  dataset: DashboardDataset | null;
  /** Tabs the admin hid for this structure (druid_tabs_hidden). */
  hiddenTabs: string[];
}

export interface ReportTemplate {
  id: string;
  label: MessageDescriptor;
  description: MessageDescriptor;
  params: TemplateParam[];
  /** Needs the structure's data to choose its charts (the dialog loads it first). */
  needsDataset: boolean;
  build: (input: TemplateInput, env: TemplateEnv) => ReportDefinition;
}

/** Relative period of every template by default (decision R6). */
export const DEFAULT_PERIOD: ReportPeriod = { kind: 'relative', lastYears: 5, includeCurrent: false };

const section = (title: MessageDescriptor): ReportBlock => ({ id: newBlockId(), kind: 'section', title: i18n._(title) });
const chart = (chartId: string): ReportBlock => ({ id: newBlockId(), kind: 'chart', chartId });
const kpis = (setId: string): ReportBlock => ({ id: newBlockId(), kind: 'kpis', setId });

/** Keeps the charts the structure can show and that stay meaningful under the report filters. */
function usable(ids: string[], env: TemplateEnv, filters: PubFilters): string[] {
  const features = env.dataset ? scopeFeatures(datasetFeatures(env.dataset), filters) : null;
  return ids.filter((id) =>
    (!features || missingFeatures(id, features).length === 0) && trivialFiltersOf(id, filters).length === 0);
}

const base = (t: ReportTemplate, input: TemplateInput, filters: PubFilters, blocks: ReportBlock[], extra: Record<string, unknown> = {}): ReportDefinition => ({
  schemaVersion: 1,
  name: input.name.trim(),
  description: '',
  templateId: t.id,
  templateParams: extra,
  context: { slug: input.slug, perimetre: input.perimetre, period: input.period, filters },
  blocks,
  lang: input.lang,
});

const blank: ReportTemplate = {
  id: 'blank',
  label: msg`Empty report`,
  description: msg`Start from scratch and add charts, key figures and text yourself.`,
  params: ['structure', 'period', 'perimetre'],
  needsDataset: false,
  build(input) {
    const { templateId: _id, templateParams: _p, ...def } = base(blank, input, {}, []);
    return def;
  },
};

/**
 * « Bilan de structure »: one section per visible dashboard tab with its charts (same catalog as
 * the former PDF wizard), key figures at the top of the overview and impact sections.
 */
const structureReport: ReportTemplate = {
  id: 'structure',
  label: msg`Structure report`,
  description: msg`Every tab of the dashboard of a structure: output, collaborations, impact, journals, funding, teams…`,
  params: ['structure', 'period', 'perimetre'],
  needsDataset: true,
  build(input, env) {
    const visible = new Set(visibleTabKeys(REPORT_SECTIONS.map((s) => s.tab), {
      hidden: env.hiddenTabs,
      hasAxes: (env.dataset?.strategicAxes.length ?? 1) > 0,
      hasBenchmark: false,
    }));
    const blocks: ReportBlock[] = [];
    for (const s of REPORT_SECTIONS) {
      if (!visible.has(s.tab)) continue;
      const ids = usable(s.ids, env, {});
      if (!ids.length) continue;
      blocks.push(section(s.title));
      if (s.tab === 'overview') blocks.push(kpis('overview'));
      if (s.tab === 'impact') blocks.push(kpis('impact'));
      blocks.push(...ids.map(chart));
    }
    return base(structureReport, input, {}, blocks);
  },
};

/**
 * « Collaborations internationales »: weight and evolution of international co-publications,
 * partner countries and institutions, themes and impact of those co-publications — optionally
 * restricted to one partner country.
 */
const internationalReport: ReportTemplate = {
  id: 'international',
  label: msg`International collaborations`,
  description: msg`Share and evolution of international co-publications, partner countries and institutions, themes and impact — optionally for one country.`,
  params: ['structure', 'period', 'perimetre', 'country'],
  needsDataset: true,
  build(input, env) {
    const country = input.country?.trim().toUpperCase() || undefined;
    // Report filters: the partner country if any. The themes and impact sections are further
    // restricted to international co-publications (block filters added to the report ones).
    const filters: PubFilters = country ? { country } : {};
    const intlOnly = { filters: { international: true } };
    const pick = (ids: string[]) => usable(ids, env, filters).map(chart);
    const intlBlock = (b: ReportBlock): ReportBlock =>
      b.kind === 'chart' || b.kind === 'kpis' ? { ...b, override: intlOnly } : b;
    const blocks: ReportBlock[] = [
      section(msg`Overview`),
      ...pick(['international-vs-national', 'pourcentage-international', 'collab-typologie', 'collab-typologie-evolution']),
      section(msg`Partner countries`),
      ...pick(['carte-monde', 'top-pays', 'evolution-pays', 'pays-annees', 'zone-ue', 'ue-par-annee']),
      section(msg`Partner institutions`),
      ...pick(['top-partenaires', 'carte-flux', 'flux-sankey', 'sunburst-partenariats', 'reseau-equipes-organismes']),
      section(msg`Themes of international co-publications`),
      ...pick(['domaines', 'top-sous-domaines', 'top-mots-cles']).map(intlBlock),
      section(msg`Impact of international co-publications`),
      intlBlock(kpis('impact')),
      ...pick(['distribution-fwci', 'top-par-annee', 'quartiles-scimago', 'acces-ouvert']).map(intlBlock),
    ];
    // Drop the sections left empty by the filters or the structure.
    const kept = blocks.filter((b, i) => b.kind !== 'section' || (blocks[i + 1] && blocks[i + 1].kind !== 'section'));
    return base(internationalReport, input, filters, kept, country ? { country } : {});
  },
};

/**
 * « Collaboration avec une université ou un groupe » (plan § 5.2, former Ottawa plan): the report
 * scope is the co-publications with the chosen institutions (partnerKeys filter). Large
 * collaborations count in the volumes but are left out of the impact blocks (D2); the footer says
 * « internal working document » (D7); the annex lists the co-publications (D6).
 */
const partnerReport: ReportTemplate = {
  id: 'partner',
  label: msg`Collaboration with a university or group`,
  description: msg`Co-publications with one or several institutions: key figures, impact against a comparable reference, themes, people and labs involved, per-university breakdown, list of publications.`,
  params: ['structure', 'period', 'perimetre', 'partners'],
  needsDataset: true,
  build(input, env) {
    const keys = [...new Set(input.partners ?? [])];
    const filters: PubFilters = { partnerKeys: keys };
    const catalog = env.dataset ? buildPartnerCatalog(env.dataset.publications) : [];
    const nameOf = new Map(catalog.map((c) => [c.key, c.name]));
    const names = keys.map((k) => nameOf.get(k) ?? k.replace(/^(international|national):/, ''));
    const scopeList = keys
      .map((k, i) => (/^0[a-z0-9]{8}$/.test(k) ? `${names[i]} (ROR ${k})` : names[i]))
      .join(', ');
    const lab = env.dataset?.lab ?? input.slug;
    const partnersLabel = names.join(', ');
    // Impact blocks: large collaborations left out (their filters add to the partner filter).
    const noLarge = (b: ReportBlock): ReportBlock =>
      b.kind === 'chart' || b.kind === 'kpis' ? { ...b, override: { filters: { maxAuthors: LARGE_COLLAB_AUTHORS } } } : b;
    const pick = (ids: string[]) => usable(ids, env, filters).map(chart);
    const about: ReportBlock = {
      id: newBlockId(),
      kind: 'text',
      markdown: [
        i18n._(msg`Co-publications of ${lab} with ${partnersLabel}.`),
        '',
        `- ${i18n._(msg`Partner scope: ${scopeList}.`)}`,
        `- ${i18n._(msg`Publications with more than ${LARGE_COLLAB_AUTHORS} authors (large consortia) are counted in the volumes but left out of the impact indicators and charts.`)}`,
        `- ${i18n._(msg`The impact reference is the international co-publications of ${lab} in the same subfields, weighted like the collaboration.`)}`,
      ].join('\n'),
    };
    const blocks: ReportBlock[] = [
      about,
      section(msg`Key figures`),
      kpis('partner'),
      noLarge(kpis('partner-impact')),
      section(msg`Overview`),
      ...pick(['publications-par-annee', 'types-publications', 'acces-ouvert', 'domaines', 'top-sous-domaines', 'top-mots-cles']),
      section(msg`Journals and impact`),
      ...pick(['top-revues']),
      ...pick(['quartiles-scimago', 'distribution-fwci', 'top-par-annee']).map(noLarge),
      section(msg`People and labs involved`),
      ...pick(['labos-classement', 'equipes-repartition', 'chercheurs-classement']),
      ...(keys.length >= 2
        ? [section(msg`Breakdown by university`), ...pick(['partner-breakdown-top', 'partner-breakdown-evolution'])]
        : []),
      section(msg`Other partners in these co-publications`),
      ...pick(['top-pays', 'top-partenaires', 'carte-monde']),
      section(msg`Annex`),
      { id: newBlockId(), kind: 'table', tableId: 'publications' },
    ];
    const kept = blocks.filter((b, i) => b.kind !== 'section' || (blocks[i + 1] && blocks[i + 1].kind !== 'section'));
    return {
      ...base(partnerReport, input, filters, kept, { partners: keys }),
      description: i18n._(msg`Co-publications of ${lab} with ${partnersLabel}.`),
      footerNote: i18n._(msg`Internal working document`),
    };
  },
};

export const REPORT_TEMPLATES: ReportTemplate[] = [partnerReport, structureReport, internationalReport, blank];

export const templateById = (id: string): ReportTemplate | undefined => REPORT_TEMPLATES.find((t) => t.id === id);

/** Partner countries of a dataset, most frequent first (country parameter). */
export function partnerCountries(dataset: DashboardDataset | null): string[] {
  if (!dataset) return [];
  const counts = new Map<string, number>();
  for (const p of dataset.publications) for (const cc of new Set(p.countries)) counts.set(cc, (counts.get(cc) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([cc]) => cc);
}

/**
 * New report from an instance template (a report published by a super admin, lot 6): same
 * blocks, filters and texts, on the chosen structure, period and scope. Blocks pinned to another
 * structure (override) keep it. Block ids are renewed; the source is recorded as templateId.
 */
export function instantiateReportTemplate(source: ReportDefinition, sourceId: number, input: TemplateInput): ReportDefinition {
  return {
    ...source,
    name: input.name.trim(),
    templateId: `report:${sourceId}`,
    templateParams: {},
    context: { ...source.context, slug: input.slug, period: input.period, perimetre: input.perimetre },
    blocks: source.blocks.map((b) => ({ ...b, id: newBlockId() })),
    lang: input.lang,
  };
}
