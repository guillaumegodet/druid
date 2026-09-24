/**
 * Schema of the Grist table `Fusions_log` (log of Annuaire row merges), shared
 * between the app (GristService) and the bulk script `scripts/merge_doublons.ts`.
 * Pure module: no dependency on the Vite environment.
 */
export const MERGE_LOG_TABLE = 'Fusions_log';

export function buildMergeLogColumns() {
  const text = (id: string, label: string) => ({ id, fields: { label, type: 'Text' } });
  const int = (id: string, label: string) => ({ id, fields: { label, type: 'Int' } });
  return [
    text('uid_dyna', 'uid_dyna'),
    text('Nom', 'Nom conservé'),
    int('kept_rowid', 'Ligne conservée (rowId)'),
    int('dropped_rowid', 'Ligne supprimée (rowId)'),
    text('auteur', 'Auteur'),
    text('date', 'Date (ISO)'),
    text('note', 'Note'),
    text('dropped_json', 'Instantané ligne supprimée (JSON)'),
    text('kept_before_json', 'Valeurs précédentes ligne conservée (JSON)'),
    text('kept_patch_json', 'Champs écrits sur la ligne conservée (JSON)'),
    { id: 'restaure', fields: { label: 'Restaurée', type: 'Bool' } },
    int('restored_rowid', 'Ligne restaurée (rowId)'),
  ];
}

/** Builds the log row to write before a merge. */
export function buildMergeLogRow(args: {
  keep: { rowId: number; fields: Record<string, any> };
  drop: { rowId: number; fields: Record<string, any> };
  patch: Record<string, any>;
  author: string;
  note?: string;
  nowIso?: string;
}): Record<string, any> {
  const { keep, drop, patch, author, note = '', nowIso = new Date().toISOString() } = args;
  const before: Record<string, any> = {};
  for (const k of Object.keys(patch)) before[k] = keep.fields[k] ?? null;
  return {
    uid_dyna: String(keep.fields['uid_dyna'] || drop.fields['uid_dyna'] || ''),
    Nom: `${String(patch['Nom'] ?? keep.fields['Nom'] ?? '')} ${String(patch['Prenom'] ?? keep.fields['Prenom'] ?? '')}`.trim(),
    kept_rowid: keep.rowId, dropped_rowid: drop.rowId, auteur: author, date: nowIso, note,
    dropped_json: JSON.stringify(drop.fields), kept_before_json: JSON.stringify(before),
    kept_patch_json: JSON.stringify(patch), restaure: false, restored_rowid: null,
  };
}
