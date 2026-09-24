// Identifiers of the publicly embeddable dataviz. SOURCE OF TRUTH for the
// « Partager » (share) button of EChartCard: a chart whose exportName is not
// listed here does not show the button (its /embed URL would not resolve).
// ⚠️ Keep in sync with the keys of EMBED_CHARTS (embedRegistry.tsx) —
// separate file to avoid a circular import EChartCard ↔ registry.

export const EMBEDDABLE_IDS = new Set<string>([
  // Overview
  'publications-par-annee', 'langues', 'types-publications', 'acces-ouvert',
  // Collaborations — international
  'international-vs-national', 'pourcentage-international', 'carte-monde',
  'carte-flux', 'top-pays', 'pays-annees', 'zone-ue', 'ue-par-annee',
  'top-partenaires', 'flux-sankey', 'sunburst-partenariats', 'evolution-pays',
  'reseau-equipes-organismes',
  // Collaborations — typology / structure / NU / national
  'collab-typologie', 'collab-structure-top', 'collab-structure-evolution',
  'collab-nu-top', 'collab-nu-evolution', 'carte-france',
  'collab-national-top', 'collab-national-evolution',
  // Impact
  'quartiles-scimago', 'top-par-annee', 'distribution-fwci',
  // Books
  'ouvrages-types', 'ouvrages-par-annee',
  // Journals
  'top-revues', 'acces-revues', 'acces-revues-barres', 'acces-revues-evolution',
  // APC tracking
  'apc-evolution', 'apc-par-revue',
  // Funding (funders / projects)
  'funders-top', 'funders-categories', 'funders-par-labo', 'funders-evolution',
  // Keywords / Axes
  'top-mots-cles', 'top-sous-domaines',
  'axes-repartition', 'axes-evolution', 'axes-types',
  // Signature charter
  'charte-conformite', 'charte-scores', 'charte-evolution', 'charte-criteres',
  'charte-equipes',
  // Teams / PhD students / Researchers / Network
  'equipes-repartition', 'equipes-evolution', 'equipes-types', 'radar-disciplinaire',
  'doctorants-repartition', 'doctorants-evolution', 'doctorants-classement',
  'chercheurs-classement', 'reseau-cosignatures',
  // Sources / coverage (CRISalid harvester vs BSO/OpenAlex/HAL)
  'sources-repartition', 'sources-recouvrements', 'sources-evolution',
  'sources-harvester-detail', 'sources-openalex-lookup',
]);
