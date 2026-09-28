// Identifiers of the publicly embeddable dataviz. SOURCE OF TRUTH for the
// « Partager » (share) button of EChartCard: a chart whose exportName is not
// listed here does not show the button (its /embed URL would not resolve).
// ⚠️ Keep in sync with the keys of EMBED_CHARTS (embedRegistry.tsx) —
// separate file to avoid a circular import EChartCard ↔ registry.

export const EMBEDDABLE_IDS = new Set<string>([
  // Overview
  'publications-par-annee', 'langues', 'types-publications', 'acces-ouvert', 'domaines',
  // Collaborations — international
  'international-vs-national', 'pourcentage-international', 'carte-monde',
  'carte-flux', 'top-pays', 'pays-annees', 'zone-ue', 'ue-par-annee',
  'top-partenaires', 'flux-sankey', 'sunburst-partenariats', 'evolution-pays',
  'reseau-equipes-organismes',
  // Collaborations — typology / structure / NU / national
  'collab-typologie', 'collab-typologie-evolution',
  'collab-structure-top', 'collab-structure-evolution', 'collab-structure-domaines',
  'collab-structure-sous-disciplines', 'collab-structure-sankey',
  'collab-nu-top', 'collab-nu-evolution', 'collab-nu-domaines', 'collab-nu-sous-disciplines',
  'collab-nu-sankey', 'carte-france',
  'collab-national-top', 'collab-national-evolution',
  // Impact
  'quartiles-scimago', 'top-par-annee', 'distribution-fwci',
  'impact-fwci-sous-structure', 'impact-top-sous-structure', 'impact-fwci-equipe',
  'impact-top-equipe', 'impact-fwci-chercheur', 'impact-top-chercheur',
  // Books
  'ouvrages-types', 'ouvrages-par-annee',
  // Journals
  'top-revues', 'acces-revues', 'acces-revues-barres', 'acces-revues-evolution',
  // APC tracking
  'apc-evolution', 'apc-par-revue', 'apc-elsevier-par-labo',
  // Funding (funders / projects)
  'funders-top', 'funders-categories', 'funders-par-labo', 'funders-evolution',
  // Keywords / Axes
  'top-mots-cles', 'top-sous-domaines',
  'axes-repartition', 'axes-barres', 'axes-evolution', 'axes-types',
  // Signature charter
  'charte-conformite', 'charte-scores', 'charte-evolution', 'charte-criteres',
  'charte-equipes',
  // Teams / PhD students / Researchers / Network
  'equipes-repartition', 'equipes-evolution', 'equipes-types', 'radar-disciplinaire',
  'heatmap-disciplinaire',
  'doctorants-repartition', 'doctorants-evolution', 'doctorants-classement',
  'chercheurs-classement', 'reseau-cosignatures',
  // Sources / coverage (CRISalid harvester vs BSO/OpenAlex/HAL)
  'sources-repartition', 'sources-recouvrements', 'sources-evolution',
  'sources-harvester-detail', 'sources-openalex-lookup',
]);

/**
 * Key-figure rows a report `kpis` block can show (kpiItems.ts, KPI_SETS).
 * ⚠️ Keep in sync with the keys of KPI_SETS.
 */
export const KPI_SET_IDS = new Set<string>(['overview', 'impact']);
