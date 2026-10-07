// Grist corrections of the strategic axes, shared by the Axes tab and the
// reports (docs/plan-mes-rapports.md § 9.4): a report must show the corrected
// classification the user sees in the tab, not only the ETL one. The public
// /embed page does not apply them (unauthenticated, no Grist access).
//
// Collaborative curation (cf. the study guillaumegodet/Dataviz —
// studies/202604-centrale-axes): the Grist table holds the corrected
// classification (Axe_Retenu field), editable from the tab via the
// authenticated Grist proxy of server.cjs.

import { axeOfPub } from './publicationFilters';
import type { DashboardDataset, DashboardPublication } from './types';
import { AXES_GRIST, axisCorrectionRows, AxisCorrectionRow } from '../../lib/publications/axes';
import { DirectoryApi } from '../../lib/directoryApi';

// Configuration and row mapping live in lib/publications/axes.ts (shared with the API, migration plan lot 1 b).
export { AXES_GRIST };

/** Title normalization for matching (same rule as the study). */
export function normTitle(s: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface AxisCorrection {
  gristId: number;
  /** Raw Grist value (may be multiple « a|b »). */
  axe: string;
}

/** Index doi (lowercase) and normalized title → Grist record. */
export interface AxisCorrectionIndex {
  byDoi: Map<string, AxisCorrection>;
  byTitle: Map<string, AxisCorrection>;
}

export const EMPTY_AXIS_INDEX: AxisCorrectionIndex = { byDoi: new Map(), byTitle: new Map() };

/** Builds the index from the corrections (DOI in lowercase, normalized title). */
export function indexAxisCorrections(rows: AxisCorrectionRow[]): AxisCorrectionIndex {
  const byDoi = new Map<string, AxisCorrection>();
  const byTitle = new Map<string, AxisCorrection>();
  for (const row of rows) {
    const c = { gristId: row.gristId, axe: row.axe };
    const doi = row.doi.trim().toLowerCase();
    if (doi) byDoi.set(doi, c);
    const nt = normTitle(row.title);
    if (nt) byTitle.set(nt, c);
  }
  return { byDoi, byTitle };
}

/** Builds the index from the Grist records (rows without a corrected axis are ignored). */
export function buildAxisCorrectionIndex(
  records: { id: number; fields: Record<string, unknown> }[],
  field: string,
): AxisCorrectionIndex {
  return indexAxisCorrections(axisCorrectionRows(records, field));
}

export function findAxisCorrection(
  index: AxisCorrectionIndex,
  p: DashboardPublication,
): AxisCorrection | undefined {
  const doi = (p.doi ?? '').toLowerCase();
  return (doi && index.byDoi.get(doi)) || index.byTitle.get(normTitle(p.title)) || undefined;
}

/** Effective axis: Grist correction if any, otherwise the ETL classification (1st axis if multiple). */
export function effectiveAxe(index: AxisCorrectionIndex, p: DashboardPublication): string {
  const c = findAxisCorrection(index, p);
  return axeOfPub(c ? { ...p, chosenAxe: c.axe } : p);
}

/**
 * Dataset whose `chosenAxe` carries the corrections, so that every consumer
 * reading axeOfPub (registry charts, `axe` filter) sees the corrected axes.
 */
export function applyAxisCorrections(
  dataset: DashboardDataset,
  index: AxisCorrectionIndex,
): DashboardDataset {
  if (index.byDoi.size === 0 && index.byTitle.size === 0) return dataset;
  let changed = false;
  const publications = dataset.publications.map((p) => {
    const c = findAxisCorrection(index, p);
    if (!c || c.axe === p.chosenAxe) return p;
    changed = true;
    return { ...p, chosenAxe: c.axe };
  });
  return changed ? { ...dataset, publications } : dataset;
}

/** Loads the corrections of a structure (null when the structure has no correction table), through the
 * domain API (/api/v1/axis-corrections, scoped to the user's structures). */
export async function fetchAxisCorrections(slug: string): Promise<AxisCorrectionIndex | null> {
  if (!AXES_GRIST[slug]) return null;
  return indexAxisCorrections(await DirectoryApi.axisCorrections(slug));
}
