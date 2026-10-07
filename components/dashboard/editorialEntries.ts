// Encyclopedia entries « signed » by the editors of the work (docs/archive/plan-collaboration-pays.md,
// lot 1 b). OpenAlex gives the editors of some reference works as the authors of every
// entry: 1 264 entries of a 2023 encyclopedia carried 10 editors from 6 countries, i.e.
// false international collaborations and one editor shown as the most prolific author.
// druid-biblio flags them (`isEditorialEntry`, biblio_etl/editorial.py); entries actually
// written by their authors are not flagged.
//
// Decision D7: they still count in the volumes of the structure (and keep their own type,
// « Notice d'encyclopédie »), but never as collaborations nor in the researcher rankings.

import type { DashboardDataset, DashboardPublication } from './types';

export const isEditorialEntry = (p: Pick<DashboardPublication, 'isEditorialEntry'>): boolean =>
  p.isEditorialEntry === true;

/** False for the editor-signed entries: left out of the per-researcher counts. */
export const countsForResearchers = (p: Pick<DashboardPublication, 'isEditorialEntry'>): boolean =>
  !isEditorialEntry(p);

const NO_COLLABORATION = 'Pas de collaboration';

/**
 * The publication without its collaboration fields: no partner institution, no foreign
 * country, typology « Pas de collaboration ». Done once when the dataset is loaded, so that
 * every tab, filter, report and embed sees the same thing.
 */
export function withoutCollaboration(p: DashboardPublication): DashboardPublication {
  const { nantesPartnersSource: _source, ...rest } = p;
  return {
    ...rest,
    isInternational: false,
    countries: p.countries.filter((cc) => cc === 'FR'),
    partnerInstitutions: [],
    nationalPartners: [],
    nantesPartners: [],
    collabTypes: [NO_COLLABORATION],
  };
}

/** Dataset as served, with the editor-signed entries neutralized (same object if none). */
export function neutralizeEditorialEntries<T extends Pick<DashboardDataset, 'publications'>>(dataset: T): T {
  if (!dataset.publications?.some(isEditorialEntry)) return dataset;
  return {
    ...dataset,
    publications: dataset.publications.map((p) => (isEditorialEntry(p) ? withoutCollaboration(p) : p)),
  };
}
