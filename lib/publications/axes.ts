// Grist corrections of the strategic axes (collaborative curation of a structure's publications), publications
// side of the storage (D10 of druid-internal docs/plan-migration-postgresql.md). Pure module: the configuration
// and the row mapping are shared by the browser (Axes tab, reports) and the API (/api/v1/axis-corrections).

/** Structures whose axes are curated in Grist: document, table and column of the retained axis. */
export const AXES_GRIST: Record<string, { docId: string; table: string; field: string }> = {
  'ec-nantes': {
    docId: '5aREUrB1kuFAcVY4GTUDfA',
    table: 'Publications_centrale_axes_strategiques2',
    field: 'Axe_Retenu',
  },
};

/** A corrected classification: Grist row, publication keys and retained axis (raw, may be « a|b »). */
export interface AxisCorrectionRow {
  gristId: number;
  doi: string;
  title: string;
  axe: string;
}

/** Correction table rows → corrections (rows without a retained axis are ignored). Pure. */
export function axisCorrectionRows(records: { id: number; fields: Record<string, unknown> }[], field: string): AxisCorrectionRow[] {
  const out: AxisCorrectionRow[] = [];
  for (const rec of records) {
    const axe = String(rec.fields[field] ?? '').trim();
    if (!axe) continue;
    out.push({ gristId: rec.id, doi: String(rec.fields.doi ?? ''), title: String(rec.fields.Titre ?? ''), axe });
  }
  return out;
}
