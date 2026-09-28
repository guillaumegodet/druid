// Catalog of the PDF report generator: for each dashboard tab, the ORDERED
// list of dataviz to include (ids = exportName, same keys as
// EMBED_CHARTS/EMBEDDABLE_IDS — the report reuses the isolated components of
// the embed registry). A tab missing from here (list, media monitoring, admin,
// benchmark — its charts depend on a peer group chosen in session, not only
// on publications+range, cf. embedIds.ts) cannot be exported as a report.
// « funders » and « sources » joined the list on 2026-09-17 (omission with
// no design rationale, review lot 10).
// ⚠️ Keep in sync with embedIds.ts / embedRegistry.tsx.

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
export interface ReportSection {
  /** DashboardPage tab key (Tab). */
  tab: string;
  /** Section title in the PDF (= tab label), translatable. */
  title: MessageDescriptor;
  /** Chart ids, in the tab's display order. */
  ids: string[];
}

export const REPORT_SECTIONS: ReportSection[] = [
  {
    tab: 'overview',
    title: msg`Overview`,
    ids: [
      'publications-par-annee', 'langues', 'types-publications', 'acces-ouvert',
      'top-mots-cles', 'top-sous-domaines', 'domaines',
    ],
  },
  {
    tab: 'collaborations',
    title: msg`Collaborations`,
    ids: [
      'collab-typologie', 'collab-typologie-evolution',
      'collab-structure-top', 'collab-structure-evolution', 'collab-structure-domaines',
      'collab-structure-sous-disciplines', 'collab-structure-sankey',
      'collab-nu-top', 'collab-nu-evolution', 'collab-nu-domaines', 'collab-nu-sous-disciplines',
      'collab-nu-sankey',
      'collab-national-top', 'collab-national-evolution', 'carte-france',
      'international-vs-national', 'pourcentage-international',
      'carte-monde', 'carte-flux', 'top-pays', 'pays-annees', 'evolution-pays',
      'zone-ue', 'ue-par-annee',
      'top-partenaires', 'flux-sankey', 'sunburst-partenariats',
      'reseau-equipes-organismes',
    ],
  },
  {
    tab: 'impact',
    title: msg`Impact and citations`,
    ids: [
      'quartiles-scimago', 'top-par-annee', 'distribution-fwci',
      'impact-fwci-sous-structure', 'impact-top-sous-structure',
      'impact-fwci-equipe', 'impact-top-equipe',
      'impact-fwci-chercheur', 'impact-top-chercheur',
    ],
  },
  {
    tab: 'books',
    title: msg`Books`,
    ids: ['ouvrages-par-annee', 'ouvrages-types'],
  },
  {
    tab: 'journals',
    title: msg`Journals`,
    ids: ['top-revues', 'acces-revues', 'acces-revues-barres', 'acces-revues-evolution'],
  },
  {
    tab: 'apc',
    title: msg`APC monitoring`,
    ids: ['apc-evolution', 'apc-par-revue', 'apc-elsevier-par-labo'],
  },
  {
    // Visible tab with charts already in EMBEDDABLE_IDS/EMBED_CHARTS — was missing from here
    // although nothing excludes it by design (review lot 10): FundersTab.tsx display order.
    tab: 'funders',
    title: msg`Funding`,
    ids: ['funders-top', 'funders-categories', 'funders-evolution', 'funders-par-labo'],
  },
  {
    tab: 'themes',
    title: msg`Strategic axes`,
    ids: ['axes-repartition', 'axes-barres', 'axes-evolution', 'axes-types'],
  },
  {
    tab: 'charte',
    title: msg`Signature charter`,
    ids: ['charte-conformite', 'charte-scores', 'charte-evolution', 'charte-criteres', 'charte-equipes'],
  },
  {
    tab: 'teams',
    title: msg`Teams`,
    ids: [
      'equipes-repartition', 'equipes-evolution', 'equipes-types', 'radar-disciplinaire',
      'heatmap-disciplinaire',
    ],
  },
  {
    tab: 'phd',
    title: msg`PhD students`,
    ids: ['doctorants-repartition', 'doctorants-evolution', 'doctorants-classement'],
  },
  {
    tab: 'researchers',
    title: msg`Researchers`,
    ids: ['chercheurs-classement'],
  },
  {
    tab: 'network',
    title: msg`Network`,
    ids: ['reseau-cosignatures'],
  },
  {
    // Same finding as 'funders' above (review lot 10): SourcesTab.tsx display order.
    tab: 'sources',
    title: msg`Sources`,
    ids: [
      'sources-repartition', 'sources-recouvrements', 'sources-evolution',
      'sources-harvester-detail', 'sources-openalex-lookup',
    ],
  },
];
