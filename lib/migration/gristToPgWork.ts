// Grist → PostgreSQL import of the work tables (druid-internal docs/plan-migration-postgresql.md, lot 5 b): tasks and
// their events, merge log, alignment reviews, directory import arbitrations, reports (shares, generations), benchmark
// peer lists. Pure, like gristToPg.ts: the people are those of the directory transformation (stable ids), found again
// through their Grist row (Ref:Annuaire / Annuaire_id) or their uid. Same rules: nothing dropped silently, every case
// a report entry (row ids and columns only).
import type { GristRecord } from '../directory/gristMapping';
import type { DirectoryRows, Issue, IssueCode } from './gristToPg';

export interface TaskRow {
  legacy_grist_id: number; key: string | null; type: string; base: string | null; channel: string | null; title: string;
  description: string | null; person_id: string | null; membership_id: number | null; uid: string | null; person_name: string | null; lab: string | null;
  link: string | null; status: string; assignee: string | null; priority: string; origin: string | null;
  created_by: string | null; created_at: string | null; taken_by: string | null; taken_at: string | null;
  waiting_reason: string | null; done_by: string | null; done_at: string | null; resolution: string | null;
  verified_at: string | null; extra: Record<string, unknown>;
}
export interface TaskEventRow { legacy_grist_id: number; at: string | null; author: string | null; action: string; detail: string | null; extra: Record<string, unknown>; $task: number }
export interface MergeLogRow {
  legacy_grist_id: number; uid: string | null; kept_person_id: string | null; dropped_snapshot: unknown; kept_before: unknown;
  kept_patch: unknown; author: string | null; note: string | null; merged_at: string | null; restored: boolean;
  restored_person_id: string | null; legacy_kept_rowid: number | null; legacy_dropped_rowid: number | null;
  legacy_restored_rowid: number | null; extra: Record<string, unknown>;
}
export interface AlignmentRow {
  legacy_grist_id: number; person_id: string; source: string; candidate_id: string; score: number | null; payload: Record<string, unknown>;
  decision: string; note: string | null; pushed_on: string | null; applied: boolean; applied_on: string | null;
}
export interface ImportBatchRow { legacy_table: string; source: string; label: string | null }
export interface ImportRowRow {
  legacy_grist_id: number; person_id: string | null; membership_id: number | null; person_label: string | null; lab: string | null; family: string | null;
  field: string; current_value: string | null; imported_value: string | null; imported_json: unknown; remark: string | null;
  choice: string | null; other_value: string | null; resolved_at: string | null; resolved_by: string | null;
  extra: Record<string, unknown>; $batch: string;
}
export interface ReportRow {
  legacy_grist_id: number; owner: string; name: string; description: string | null; template_id: string | null;
  definition: unknown; visibility: string; published_template: boolean; created_at: string | null; updated_at: string | null;
  deleted_at: string | null; extra: Record<string, unknown>;
}
export interface ReportShareRow { legacy_grist_id: number; grantee: string; role: string; granted_by: string | null; granted_at: string | null; $report: number }
export interface ReportGenerationRow {
  legacy_grist_id: number; generated_at: string | null; generated_by: string | null; definition_snapshot: unknown;
  publication_count: number | null; data_date: string | null; ai_texts: unknown; pdf_ref: string | null; shared_frozen: boolean;
  extra: Record<string, unknown>; $report: number;
}
export interface PeerGroupRow { legacy_grist_id: number; owner: string; name: string; rors: string[]; updated_at: string | null }

export interface WorkRows {
  task: TaskRow[]; task_event: TaskEventRow[]; merge_log: MergeLogRow[]; alignment_candidate: AlignmentRow[];
  import_batch: ImportBatchRow[]; import_row: ImportRowRow[]; report: ReportRow[]; report_share: ReportShareRow[];
  report_generation: ReportGenerationRow[]; benchmark_peer_group: PeerGroupRow[];
}

/** Grist tables of the work domain; `Arbitrage_*` are found by name (one per directory import). */
export interface GristWorkInput {
  Taches: GristRecord[] | null;
  Taches_evenements: GristRecord[] | null;
  Fusions_log: GristRecord[] | null;
  Alignement_IdRef: GristRecord[] | null;
  Alignement_HAL: GristRecord[] | null;
  Alignement_ORCID: GristRecord[] | null;
  Alignement_OpenAlex: GristRecord[] | null;
  Alignement_Scopus: GristRecord[] | null;
  Rapports: GristRecord[] | null;
  Rapports_partages: GristRecord[] | null;
  Rapports_generations: GristRecord[] | null;
  BenchmarkPeerGroups: GristRecord[] | null;
  arbitrations: Record<string, GristRecord[]>;
}
export const WORK_TABLES = ['Taches', 'Taches_evenements', 'Fusions_log', 'Alignement_IdRef', 'Alignement_HAL', 'Alignement_ORCID',
  'Alignement_OpenAlex', 'Alignement_Scopus', 'Rapports', 'Rapports_partages', 'Rapports_generations', 'BenchmarkPeerGroups'] as const;
export const isArbitrationTable = (t: string) => /^Arbitrage_[A-Za-z0-9_]+$/.test(t);

const ALIGNMENT_SOURCES: Record<string, { source: string; candidate: string }> = {
  Alignement_IdRef: { source: 'idref', candidate: 'PPN_candidat' },
  Alignement_HAL: { source: 'hal', candidate: 'IdHAL_candidat' },
  Alignement_ORCID: { source: 'orcid', candidate: 'ORCID_candidat' },
  Alignement_OpenAlex: { source: 'openalex', candidate: 'OpenAlex_candidat' },
  Alignement_Scopus: { source: 'scopus', candidate: 'Scopus_candidat' },
};
/** Columns of a review table with a normalized home; the formulas (links, action buttons) are recomputed. */
const ALIGNMENT_MAPPED = new Set(['uid_dyna', 'Annuaire_id', 'Decision', 'Note', 'Pousse_le', 'Applique', 'Date_application']);
const ALIGNMENT_DERIVED = /^(Lien.*|Valider_action|Rejeter_action|Meler_action)$/;

const TASK_STATUSES = ['a_faire', 'en_cours', 'en_attente', 'fait', 'abandonnee', 'resolue_auto'];
const PRIORITIES = ['basse', 'normale', 'haute'];

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const text = (v: unknown): string | null => (isEmpty(v) ? null : String(v).trim());
/** Free text (a note) kept as typed, the spaces around included. */
const freeText = (v: unknown): string | null => (isEmpty(v) ? null : String(v));
const isTechnical = (c: string) => c === 'manualSort' || c.startsWith('gristHelper_');

export const transformWork = (input: GristWorkInput, directory: DirectoryRows): { rows: WorkRows; issues: Issue[]; source: Record<string, number> } => {
  const issues: Issue[] = [];
  const issue = (code: IssueCode, table: string, rows: number[], columns?: string[], detail?: string) => {
    issues.push({ code, table, rows, ...(columns ? { columns } : {}), ...(detail ? { detail } : {}) });
  };
  const source: Record<string, number> = {};
  for (const t of WORK_TABLES) {
    source[t] = input[t] ? input[t]!.length : 0;
    if (!input[t]) issue('table_missing', t, []);
  }
  for (const [t, r] of Object.entries(input.arbitrations)) source[t] = r.length;

  // People: Annuaire row → person (memberships keep their row), uid → person.
  const personOfRow = new Map(directory.membership.map((m) => [m.legacy_grist_id, m.person_id]));
  const personOfUid = new Map(directory.person.filter((p) => p.uid).map((p) => [p.uid!, p.id]));
  const personOf = (rowId: unknown): string | null => (typeof rowId === 'number' && rowId > 0 ? personOfRow.get(rowId) ?? null : null);
  /** The membership of an Annuaire row (its id is the row id), when the row was imported. */
  const membershipOf = (rowId: unknown): number | null => (personOf(rowId) ? rowId as number : null);
  const personOfKey = (uid: unknown): string | null => {
    const u = String(uid ?? '').trim().toLowerCase();
    const g = /^g(\d+)$/.exec(u);
    return g ? personOf(Number(g[1])) : (u ? personOfUid.get(u) ?? null : null);
  };

  /** Value of a timestamp column: ISO text → itself; unreadable → null, raw in extra. */
  const timestamp = (extra: Record<string, unknown>, table: string, rowId: number, col: string, v: unknown): string | null => {
    if (isEmpty(v)) return null;
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return v.trim();
    if (typeof v === 'number' && v > 0) return new Date(v * 1000).toISOString();
    extra[col] = v;
    issue('work_value_kept_in_extra', table, [rowId], [col]);
    return null;
  };
  const day = (extra: Record<string, unknown>, table: string, rowId: number, col: string, v: unknown): string | null => {
    if (isEmpty(v)) return null;
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s.slice(0, 10)))) return s.slice(0, 10);
    extra[col] = v;
    issue('work_value_kept_in_extra', table, [rowId], [col]);
    return null;
  };
  const json = (extra: Record<string, unknown>, table: string, rowId: number, col: string, v: unknown): unknown => {
    if (isEmpty(v)) return null;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { extra[col] = v; issue('work_value_kept_in_extra', table, [rowId], [col]); return null; }
  };
  /** Columns of a row the import does not know: kept in `extra`, reported once per table and column. */
  const unknownCols = new Map<string, number[]>();
  const keepUnknown = (table: string, r: GristRecord, known: Set<string>, extra: Record<string, unknown>) => {
    for (const [c, v] of Object.entries(r.fields || {})) {
      if (known.has(c) || isTechnical(c) || isEmpty(v)) continue;
      extra[c] = v;
      const k = `${table}|${c}`;
      if (!unknownCols.has(k)) unknownCols.set(k, []);
      unknownCols.get(k)!.push(r.id);
    }
  };
  const byId = (records: GristRecord[] | null) => [...(records || [])].sort((a, b) => a.id - b.id);

  // Tasks.
  const TASK_COLS = new Set(['cle', 'type', 'base', 'canal', 'titre', 'description', 'chercheur', 'uid_dyna', 'nom', 'labo', 'lien', 'statut',
    'assignee', 'priorite', 'origine', 'cree_par', 'cree_le', 'pris_par', 'pris_le', 'attente_motif', 'fait_par', 'fait_le', 'resolution', 'verifie_le']);
  const task: TaskRow[] = [];
  const keys = new Set<string>();
  for (const r of byId(input.Taches)) {
    const f = r.fields || {};
    const extra: Record<string, unknown> = {};
    keepUnknown('Taches', r, TASK_COLS, extra);
    let key = text(f.cle);
    if (key && keys.has(key)) { extra.cle = key; key = null; issue('work_duplicate', 'Taches', [r.id], ['cle']); }
    if (key) keys.add(key);
    // The record of a task is its `chercheur` reference only (a task without it is shown « without record » today);
    // its uid stays in task.uid.
    const personId = personOf(f.chercheur);
    if (!personId && typeof f.chercheur === 'number' && f.chercheur > 0) { extra.chercheur = f.chercheur; issue('work_person_unresolved', 'Taches', [r.id], ['chercheur']); }
    let status = text(f.statut) ?? 'a_faire'; // an empty status typed in Grist reads as « à faire » (tasks_schema.statusOf)
    if (!TASK_STATUSES.includes(status)) { extra.statut = f.statut; issue('work_value_kept_in_extra', 'Taches', [r.id], ['statut']); status = 'a_faire'; }
    let priority = text(f.priorite) ?? 'normale';
    if (!PRIORITIES.includes(priority)) { extra.priorite = f.priorite; issue('work_value_kept_in_extra', 'Taches', [r.id], ['priorite']); priority = 'normale'; }
    task.push({
      legacy_grist_id: r.id, key, type: text(f.type) ?? '', base: text(f.base), channel: text(f.canal), title: String(f.titre ?? '').trim(),
      description: text(f.description), person_id: personId, membership_id: membershipOf(f.chercheur), uid: text(f.uid_dyna), person_name: text(f.nom), lab: text(f.labo),
      link: text(f.lien), status, assignee: text(f.assignee), priority, origin: text(f.origine), created_by: text(f.cree_par),
      created_at: timestamp(extra, 'Taches', r.id, 'cree_le', f.cree_le), taken_by: text(f.pris_par),
      taken_at: timestamp(extra, 'Taches', r.id, 'pris_le', f.pris_le), waiting_reason: text(f.attente_motif), done_by: text(f.fait_par),
      done_at: timestamp(extra, 'Taches', r.id, 'fait_le', f.fait_le), resolution: text(f.resolution),
      verified_at: timestamp(extra, 'Taches', r.id, 'verifie_le', f.verifie_le), extra,
    });
  }
  const taskIds = new Set(task.map((t) => t.legacy_grist_id));
  const task_event: TaskEventRow[] = [];
  for (const r of byId(input.Taches_evenements)) {
    const f = r.fields || {};
    if (!taskIds.has(f.tache)) { issue('work_orphan', 'Taches_evenements', [r.id], ['tache']); continue; }
    const extra: Record<string, unknown> = {};
    keepUnknown('Taches_evenements', r, new Set(['tache', 'date', 'auteur', 'action', 'detail']), extra);
    task_event.push({ legacy_grist_id: r.id, at: timestamp(extra, 'Taches_evenements', r.id, 'date', f.date), author: text(f.auteur),
      action: text(f.action) ?? '', detail: text(f.detail), extra, $task: f.tache });
  }

  // Merge log.
  const MERGE_COLS = new Set(['uid_dyna', 'Nom', 'kept_rowid', 'dropped_rowid', 'auteur', 'date', 'note', 'dropped_json', 'kept_before_json',
    'kept_patch_json', 'restaure', 'restored_rowid']);
  const merge_log: MergeLogRow[] = [];
  for (const r of byId(input.Fusions_log)) {
    const f = r.fields || {};
    const extra: Record<string, unknown> = {};
    keepUnknown('Fusions_log', r, MERGE_COLS, extra);
    if (!isEmpty(f.Nom)) extra.Nom = f.Nom; // name shown by the merge log
    const kept = personOf(f.kept_rowid) ?? personOfKey(f.uid_dyna);
    if (!kept) issue('work_person_unresolved', 'Fusions_log', [r.id], ['kept_rowid']);
    const restoredRow = typeof f.restored_rowid === 'number' && f.restored_rowid > 0 ? f.restored_rowid : null;
    merge_log.push({
      legacy_grist_id: r.id, uid: text(f.uid_dyna), kept_person_id: kept,
      dropped_snapshot: json(extra, 'Fusions_log', r.id, 'dropped_json', f.dropped_json) ?? {},
      kept_before: json(extra, 'Fusions_log', r.id, 'kept_before_json', f.kept_before_json) ?? {},
      kept_patch: json(extra, 'Fusions_log', r.id, 'kept_patch_json', f.kept_patch_json) ?? {},
      author: text(f.auteur), note: text(f.note), merged_at: timestamp(extra, 'Fusions_log', r.id, 'date', f.date), restored: f.restaure === true,
      restored_person_id: restoredRow ? personOf(restoredRow) : null, legacy_kept_rowid: typeof f.kept_rowid === 'number' ? f.kept_rowid : null,
      legacy_dropped_rowid: typeof f.dropped_rowid === 'number' ? f.dropped_rowid : null, legacy_restored_rowid: restoredRow, extra,
    });
  }

  // Alignment reviews: one table per source, everything that is not a decision field goes to `payload`.
  const alignment_candidate: AlignmentRow[] = [];
  const reviewKeys = new Set<string>();
  for (const [table, { source: src, candidate }] of Object.entries(ALIGNMENT_SOURCES)) {
    for (const r of byId(input[table as keyof GristWorkInput] as GristRecord[] | null)) {
      const f = r.fields || {};
      let personId = personOf(f.Annuaire_id);
      if (!personId) {
        personId = personOfKey(f.uid_dyna);
        if (personId) issue('work_person_by_uid', table, [r.id]);
      }
      if (!personId) { issue('work_person_unresolved', table, [r.id], ['Annuaire_id', 'uid_dyna']); continue; }
      const candidateId = String(f[candidate] ?? '').trim();
      const k = `${personId}|${src}|${candidateId}`;
      if (reviewKeys.has(k)) { issue('work_duplicate', table, [r.id]); continue; }
      reviewKeys.add(k);
      const payload: Record<string, unknown> = {};
      for (const [c, v] of Object.entries(f)) {
        if (ALIGNMENT_MAPPED.has(c) || c === candidate || ALIGNMENT_DERIVED.test(c) || isTechnical(c) || isEmpty(v)) continue;
        payload[c] = v;
      }
      alignment_candidate.push({
        legacy_grist_id: r.id, person_id: personId, source: src, candidate_id: candidateId,
        score: typeof f.Score === 'number' ? f.Score : null, payload, decision: text(f.Decision) ?? 'À traiter', note: freeText(f.Note),
        pushed_on: day(payload, table, r.id, 'Pousse_le', f.Pousse_le), applied: f.Applique === true,
        applied_on: day(payload, table, r.id, 'Date_application', f.Date_application),
      });
    }
  }

  // Directory import arbitrations: one batch per Arbitrage_<source>_<date> table.
  const ARBITRATION_COLS = new Set(['Fiche', 'Personne', 'Labo', 'Famille', 'Champ', 'Valeur_actuelle', 'Valeur_importee', 'Remarque', 'Choix',
    'Valeur_autre', 'Valeur_importee_json', 'Resolu_le', 'Resolu_par']);
  const import_batch: ImportBatchRow[] = [];
  const import_row: ImportRowRow[] = [];
  for (const [table, records] of Object.entries(input.arbitrations).sort(([a], [b]) => a.localeCompare(b))) {
    const m = /^Arbitrage_(.+?)(?:_(\d{4}_\d{2}))?$/.exec(table)!;
    import_batch.push({ legacy_table: table, source: m[1], label: m[2] ? m[2].replace('_', '-') : null });
    for (const r of byId(records)) {
      const f = r.fields || {};
      const extra: Record<string, unknown> = {};
      keepUnknown(table, r, ARBITRATION_COLS, extra);
      const personId = personOf(f.Fiche);
      if (!personId && !isEmpty(f.Fiche) && f.Fiche !== 0) { extra.Fiche = f.Fiche; issue('work_person_unresolved', table, [r.id], ['Fiche']); }
      import_row.push({
        legacy_grist_id: r.id, person_id: personId, membership_id: membershipOf(f.Fiche), person_label: text(f.Personne), lab: text(f.Labo), family: text(f.Famille),
        field: String(f.Champ ?? '').trim(), current_value: text(f.Valeur_actuelle), imported_value: text(f.Valeur_importee),
        imported_json: json(extra, table, r.id, 'Valeur_importee_json', f.Valeur_importee_json), remark: text(f.Remarque),
        choice: text(f.Choix), other_value: text(f.Valeur_autre), resolved_at: timestamp(extra, table, r.id, 'Resolu_le', f.Resolu_le),
        resolved_by: text(f.Resolu_par), extra, $batch: table,
      });
    }
  }

  // Reports.
  const REPORT_COLS = new Set(['owner', 'name', 'description', 'template_id', 'definition', 'visibility', 'created_at', 'updated_at', 'deleted_at', 'published_template']);
  const report: ReportRow[] = [];
  for (const r of byId(input.Rapports)) {
    const f = r.fields || {};
    const extra: Record<string, unknown> = {};
    keepUnknown('Rapports', r, REPORT_COLS, extra);
    report.push({
      legacy_grist_id: r.id, owner: String(f.owner ?? '').trim(), name: String(f.name ?? '').trim(), description: text(f.description),
      template_id: text(f.template_id), definition: json(extra, 'Rapports', r.id, 'definition', f.definition) ?? {},
      visibility: text(f.visibility) ?? 'private', published_template: f.published_template === true,
      created_at: timestamp(extra, 'Rapports', r.id, 'created_at', f.created_at), updated_at: timestamp(extra, 'Rapports', r.id, 'updated_at', f.updated_at),
      deleted_at: timestamp(extra, 'Rapports', r.id, 'deleted_at', f.deleted_at), extra,
    });
  }
  const reportIds = new Set(report.map((r) => r.legacy_grist_id));
  const report_share: ReportShareRow[] = [];
  const shareKeys = new Set<string>();
  for (const r of byId(input.Rapports_partages)) {
    const f = r.fields || {};
    if (!reportIds.has(f.report)) { issue('work_orphan', 'Rapports_partages', [r.id], ['report']); continue; }
    const k = `${f.report}|${String(f.grantee ?? '').trim()}`;
    if (shareKeys.has(k)) { issue('work_duplicate', 'Rapports_partages', [r.id]); continue; }
    shareKeys.add(k);
    const extra: Record<string, unknown> = {};
    report_share.push({ legacy_grist_id: r.id, grantee: String(f.grantee ?? '').trim(), role: text(f.role) ?? 'viewer', granted_by: text(f.granted_by),
      granted_at: timestamp(extra, 'Rapports_partages', r.id, 'granted_at', f.granted_at), $report: f.report });
  }
  const GENERATION_COLS = new Set(['report', 'generated_at', 'generated_by', 'definition_snapshot', 'publication_count', 'data_date', 'ai_texts', 'pdf_ref', 'shared_frozen']);
  const report_generation: ReportGenerationRow[] = [];
  for (const r of byId(input.Rapports_generations)) {
    const f = r.fields || {};
    if (!reportIds.has(f.report)) { issue('work_orphan', 'Rapports_generations', [r.id], ['report']); continue; }
    const extra: Record<string, unknown> = {};
    keepUnknown('Rapports_generations', r, GENERATION_COLS, extra);
    report_generation.push({
      legacy_grist_id: r.id, generated_at: timestamp(extra, 'Rapports_generations', r.id, 'generated_at', f.generated_at), generated_by: text(f.generated_by),
      definition_snapshot: json(extra, 'Rapports_generations', r.id, 'definition_snapshot', f.definition_snapshot),
      publication_count: typeof f.publication_count === 'number' ? f.publication_count : null, data_date: text(f.data_date),
      ai_texts: json(extra, 'Rapports_generations', r.id, 'ai_texts', f.ai_texts), pdf_ref: text(f.pdf_ref), shared_frozen: f.shared_frozen === true,
      extra, $report: f.report,
    });
  }

  // Benchmark peer lists (ROR list stored as JSON text).
  const benchmark_peer_group: PeerGroupRow[] = [];
  const groupKeys = new Set<string>();
  for (const r of byId(input.BenchmarkPeerGroups)) {
    const f = r.fields || {};
    const owner = String(f.owner ?? '').trim();
    const name = String(f.name ?? '').trim();
    if (groupKeys.has(`${owner}|${name}`)) { issue('work_duplicate', 'BenchmarkPeerGroups', [r.id]); continue; }
    groupKeys.add(`${owner}|${name}`);
    let rors: string[] = [];
    try { const parsed = JSON.parse(String(f.rors || '[]')); rors = Array.isArray(parsed) ? parsed.map(String) : []; }
    catch { issue('work_value_kept_in_extra', 'BenchmarkPeerGroups', [r.id], ['rors'], 'unreadable list, imported empty'); }
    benchmark_peer_group.push({ legacy_grist_id: r.id, owner, name, rors, updated_at: isEmpty(f.updated_at) || Number.isNaN(Date.parse(String(f.updated_at))) ? null : String(f.updated_at) });
  }

  for (const [k, rows] of unknownCols) { const [table, col] = k.split('|'); issue('work_column_unmapped', table, rows, [col]); }
  return {
    rows: { task, task_event, merge_log, alignment_candidate, import_batch, import_row, report, report_share, report_generation, benchmark_peer_group },
    issues,
    source,
  };
};
