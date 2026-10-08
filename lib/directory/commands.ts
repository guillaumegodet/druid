// Write commands of the directory domain API (druid-internal docs/plan-migration-postgresql.md, lot 2 a): the
// record form, groups, OpenAlex id, bulk validations and ABES marks, formerly written by the browser through
// the /api/grist proxy (GristService.createResearcher, updateResearcher…). Same writes, same order, now run by
// the server with the user's scope checked up front — the proxy checked each request separately, so a refusal
// in the middle of a record save left the first writes done.
//
// Authorization, as the proxy (server.cjs gristProxyDecision): institution right = everything; lab right =
// every touched row and every new `LABO` value within its labs, the merge log open to it. Schema changes
// (affiliation columns, merge log table) are made by the server for every right.
import type { Researcher, Structure } from '../../types';
import { normalizeAcronym } from '../normalize';
import { MERGE_LOG_TABLE, buildMergeLogColumns, buildMergeLogRow } from '../mergeLog';
import { validationToGristFields, ValidationInfo } from '../validation';
import { ApiError } from './errors';
import {
  AnnuaireColumnMeta, AnnuaireWriteContext, fuzzyDateEncoderFor, membershipFieldsOf, planAffiliationRows,
  researcherCreateFields, researcherUpdateFields, secondaryRowIdentity, toGristDateCell,
} from './annuaireWrite';
import {
  AFFILIATION_END_COL, DUPLICATE_DECISION_COL, RATTACHEMENT_CHOICES, RATTACHEMENT_COL, mapInstitutionRecords, parseMultiLabel,
} from './gristMapping';
import { structureCreateFields, structureUpdateFields } from './structureWrite';
import type { DirectoryRepository, DirectoryScope, GristClient } from './repository';

/** What a write touched, for the audit log (`api.write` event): table, kind, rows and field names. */
export interface WriteAudit {
  table: string;
  kind: 'create' | 'update' | 'delete' | 'columns' | 'table';
  rows?: number[];
  fields?: string[];
  count: number;
}

export interface CommandContext {
  scope: DirectoryScope;
  /** Who writes (Keycloak user, Cloudflare Access e-mail, job name): the PostgreSQL audit log records it. */
  actor?: string;
  /** Reported write (called once per Grist write). */
  audit: (entry: WriteAudit) => void;
}

export interface DirectoryCommands {
  createPerson(researcher: Researcher, ctx: CommandContext): Promise<{ recordId: number }>;
  updatePerson(recordId: number, researcher: Researcher, ctx: CommandContext): Promise<void>;
  setGroups(entries: { recordId: number; groups: string[] }[], ctx: CommandContext): Promise<void>;
  setOpenalexId(recordId: number, openalexId: string, ctx: CommandContext): Promise<void>;
  applyValidations(entries: { recordId: number; validation: ValidationInfo }[], ctx: CommandContext): Promise<number>;
  markAbesSent(entries: { recordId: number; hash: string }[], date: string, ctx: CommandContext): Promise<number>;
  /** New structure (lot 2 b); returns its Druid id `S-<rowId>`. */
  createStructure(structure: Structure, ctx: CommandContext): Promise<{ id: string }>;
  updateStructure(recordId: number, structure: Structure, ctx: CommandContext): Promise<void>;
  // ── Duplicates and merges (lot 2 c) ──
  qualifyDuplicates(args: { rowIds: number[]; principalRowId?: number; mode: 'concomitant' | 'successif' | 'a_revoir'; endDate?: string; author: string },
    ctx: CommandContext): Promise<{ updated: number }>;
  unqualifyDuplicates(rowIds: number[], ctx: CommandContext): Promise<{ updated: number }>;
  switchUid(args: { fromUid: string; rowId?: number; toUid: string; author: string }, ctx: CommandContext): Promise<{ updated: number }>;
  mergeRows(args: { keepRowId: number; dropRowId: number; fields: Record<string, any>; author: string; note?: string },
    ctx: CommandContext): Promise<{ logId: number }>;
  restoreMerge(logId: number, ctx: CommandContext): Promise<{ restoredRowId: number }>;
  /** Columns of the Annuaire (the record form shows the FTE fields only when they exist). */
  annuaireColumns(): Promise<AnnuaireColumnMeta[]>;
}

const ANNUAIRE = 'Annuaire';
const STRUCTURES = 'Structures';
const isRowId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

export interface GristDirectoryCommandsOptions {
  grist: GristClient;
  /** Its cached reads are dropped after every write. */
  repository: DirectoryRepository;
  /** Today (YYYY-MM-DD), for the HISTORIQUE / SECONDAIRE qualification of the memberships. */
  today?: () => string;
}

export const createGristDirectoryCommands = ({ grist, repository, today }: GristDirectoryCommandsOptions): DirectoryCommands => {
  const todayIso = today ?? (() => new Date().toISOString().slice(0, 10));
  let columnsCache: AnnuaireColumnMeta[] | null = null;

  const annuaireColumns = async (): Promise<AnnuaireColumnMeta[]> => {
    if (!columnsCache) {
      columnsCache = (await grist.columns(ANNUAIRE)).map((c) => ({
        id: c.id, label: c.fields?.label || c.id, type: c.fields?.type || 'Any', isFormula: !!c.fields?.isFormula,
      }));
    }
    return columnsCache;
  };

  /** Columns and institutions for the field builders; an unreadable one is left out, as the browser did. */
  const writeContext = async (): Promise<AnnuaireWriteContext> => {
    const [columns, institutions] = await Promise.all([
      annuaireColumns().catch((err) => { console.warn('[api/v1] Annuaire columns unavailable:', (err as Error).message); return null; }),
      grist.records('Etablissements').then(mapInstitutionRecords).catch(() => null),
    ]);
    return { columns, institutions };
  };

  // ── Scope checks (lab right) ─────────────────────────────────────────────
  const anchorsOf = (scope: DirectoryScope) => new Set(scope.labAnchors);
  const assertLabsInScope = (scope: DirectoryScope, labs: unknown[]): void => {
    if (scope.all) return;
    const anchors = anchorsOf(scope);
    if (anchors.size === 0) throw new ApiError(403, 'Grist writes require the institution right');
    if (labs.some((v) => !anchors.has(normalizeAcronym(String(v ?? ''))))) throw new ApiError(403, 'Write outside scope: LABO');
  };
  const assertRowsInScope = async (scope: DirectoryScope, ids: number[]): Promise<void> => {
    if (!ids.every(isRowId)) throw new ApiError(400, 'Invalid Grist identifiers');
    if (scope.all || ids.length === 0) return;
    const anchors = anchorsOf(scope);
    if (anchors.size === 0) throw new ApiError(403, 'Grist writes require the institution right');
    const unique = [...new Set(ids)];
    const labOf = new Map<number, unknown>();
    for (let i = 0; i < unique.length; i += 500) {   // SQLite variable limit
      const chunk = unique.slice(i, i + 500);
      const rows = await grist.sql(`SELECT id, LABO AS v FROM ${ANNUAIRE} WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      for (const r of rows) labOf.set(r.id, r.v);
    }
    if (unique.some((id) => !labOf.has(id) || !anchors.has(normalizeAcronym(String(labOf.get(id) ?? ''))))) {
      throw new ApiError(403, 'Rows outside scope or unknown: Annuaire');
    }
  };

  // Structures: scope column `short_labels` (« LS2N[fr]|LS2N[en] » → its French label), as the proxy.
  const structureAnchor = (raw: unknown) => normalizeAcronym(parseMultiLabel(raw));
  const assertStructuresInScope = async (scope: DirectoryScope, ids: number[], newLabels: unknown[]): Promise<void> => {
    if (!ids.every(isRowId)) throw new ApiError(400, 'Invalid Grist identifiers');
    if (scope.all) return;
    const anchors = anchorsOf(scope);
    if (anchors.size === 0) throw new ApiError(403, 'Grist writes require the institution right');
    if (newLabels.some((v) => !anchors.has(structureAnchor(v)))) throw new ApiError(403, 'Write outside scope: short_labels');
    if (ids.length === 0) return;
    const rows = await grist.sql(`SELECT id, short_labels AS v FROM ${STRUCTURES} WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    const labelOf = new Map(rows.map((r) => [r.id, r.v]));
    if (ids.some((id) => !labelOf.has(id) || !anchors.has(structureAnchor(labelOf.get(id))))) {
      throw new ApiError(403, 'Rows outside scope or unknown: Structures');
    }
  };

  // ── Writes, each reported to the audit log ───────────────────────────────
  const fieldNames = (records: { fields: Record<string, any> }[]) => [...new Set(records.flatMap((r) => Object.keys(r.fields)))];
  const update = async (ctx: CommandContext, table: string, records: { id: number; fields: Record<string, any> }[]) => {
    await grist.updateRecords(table, records);
    ctx.audit({ table, kind: 'update', rows: records.map((r) => r.id), fields: fieldNames(records), count: records.length });
  };
  const add = async (ctx: CommandContext, table: string, records: { fields: Record<string, any> }[]) => {
    const ids = await grist.addRecords(table, records);
    ctx.audit({ table, kind: 'create', rows: ids, fields: fieldNames(records), count: records.length });
    return ids;
  };
  const remove = async (ctx: CommandContext, table: string, ids: number[]) => {
    await grist.deleteRecords(table, ids);
    ctx.audit({ table, kind: 'delete', rows: ids, count: ids.length });
  };

  /** Creates the `rattachement` (Choice) and `doublon_decision` (Text) columns if missing. Idempotent. */
  const ensureAffiliationColumns = async (ctx: CommandContext): Promise<void> => {
    const have = new Set((await annuaireColumns()).map((c) => c.id));
    const missing: { id: string; fields: Record<string, any> }[] = [];
    if (!have.has(RATTACHEMENT_COL)) missing.push({ id: RATTACHEMENT_COL, fields: { label: 'Rattachement (multi-lignes)', type: 'Choice', widgetOptions: JSON.stringify({ choices: RATTACHEMENT_CHOICES }) } });
    if (!have.has(DUPLICATE_DECISION_COL)) missing.push({ id: DUPLICATE_DECISION_COL, fields: { label: 'Décision doublon', type: 'Text' } });
    if (missing.length === 0) return;
    await grist.addColumns(ANNUAIRE, missing);
    columnsCache = null;
    ctx.audit({ table: ANNUAIRE, kind: 'columns', fields: missing.map((c) => c.id), count: missing.length });
  };

  const ensureMergeLogTable = async (ctx: CommandContext): Promise<void> => {
    if ((await grist.tableIds()).includes(MERGE_LOG_TABLE)) return;
    await grist.addTables([{ id: MERGE_LOG_TABLE, columns: buildMergeLogColumns() }]);
    ctx.audit({ table: MERGE_LOG_TABLE, kind: 'table', count: 1 });
  };

  /** Runs a write and drops the repository caches afterwards, even when it failed half-way. */
  const writing = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } finally {
      repository.invalidate();
    }
  };

  /** Annuaire rows by id, limited to the scope (a lab right never saw the other rows through the proxy). */
  const rowsInScope = async (scope: DirectoryScope, filter: Record<string, unknown[]>) => {
    const anchors = anchorsOf(scope);
    return (await grist.records(ANNUAIRE, filter))
      .filter((r) => scope.all || anchors.has(normalizeAcronym(String(r.fields?.LABO || ''))))
      .map((r) => ({ rowId: r.id, fields: r.fields }));
  };
  const writableColumns = async () => new Set((await annuaireColumns()).filter((c) => !c.isFormula).map((c) => c.id));
  /** Runs a Grist write whose failure must name what was already done (merge, restoration). */
  const step = async (fn: () => Promise<unknown>, message: string): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      console.error('[api/v1]', message, (err as Error).message);
      throw new ApiError(502, message);
    }
  };

  return {
    annuaireColumns,

    /**
     * Qualifies a group of rows sharing a uid (duplicate merge plan, lot 1): `concomitant` → the chosen row
     * PRINCIPAL, the others SECONDAIRE; `successif` → the others HISTORIQUE (+ `affiliation_end_date` when
     * given and empty); `a_revoir` → no role, « A_REVOIR » decision. Trace: `doublon_decision` = « <MODE> <date> <author> ».
     */
    qualifyDuplicates: ({ rowIds, principalRowId, mode, endDate, author }, ctx) => writing(async () => {
      if (mode !== 'a_revoir' && (principalRowId === undefined || !rowIds.includes(principalRowId))) {
        throw new ApiError(400, 'Qualification: primary row required');
      }
      if (!rowIds.every(isRowId)) throw new ApiError(400, 'Invalid Grist identifiers');
      await ensureAffiliationColumns(ctx);
      const encodeDate = fuzzyDateEncoderFor(await annuaireColumns().catch(() => null));
      const decision = `${mode === 'a_revoir' ? 'A_REVOIR' : mode === 'concomitant' ? 'CONCOMITANT' : 'SUCCESSIF'} ${todayIso()} ${author}`;
      const rows = await rowsInScope(ctx.scope, { id: rowIds });
      const records = rows.map((r) => {
        const fields: Record<string, any> = { [DUPLICATE_DECISION_COL]: decision };
        if (mode === 'a_revoir') {
          fields[RATTACHEMENT_COL] = null;
        } else if (r.rowId === principalRowId) {
          fields[RATTACHEMENT_COL] = 'PRINCIPAL';
        } else {
          fields[RATTACHEMENT_COL] = mode === 'concomitant' ? 'SECONDAIRE' : 'HISTORIQUE';
          // Successive affiliation: the end of the old row is a lab MEMBERSHIP end (affiliation_end_date).
          if (mode === 'successif' && endDate && !r.fields[AFFILIATION_END_COL] && !r.fields['employment_end_date']) {
            const cell = encodeDate(AFFILIATION_END_COL, endDate);
            if (cell !== null) fields[AFFILIATION_END_COL] = cell;
          }
        }
        return { id: r.rowId, fields };
      });
      // Different column signatures possible (affiliation_end_date) → one PATCH per row.
      for (const rec of records) await update(ctx, ANNUAIRE, [rec]);
      return { updated: records.length };
    }),

    /** Removes the qualification of a group (roles and decision cleared) → a pending duplicate again. */
    unqualifyDuplicates: (rowIds, ctx) => writing(async () => {
      await assertRowsInScope(ctx.scope, rowIds);
      await ensureAffiliationColumns(ctx);
      await update(ctx, ANNUAIRE, rowIds.map((id) => ({ id, fields: { [RATTACHEMENT_COL]: null, [DUPLICATE_DECISION_COL]: '' } })));
      return { updated: rowIds.length };
    }),

    /**
     * Moves a record to its LDAP uid (`annuaire_uid_ldap` task): every row of `fromUid` (or the single row
     * `rowId` of a record without uid) gets `uid_dyna = toUid`, with a dated line in Commentaires keeping the
     * former uid. Refused when a row already carries `toUid` — anywhere in the directory: that case is a merge.
     */
    switchUid: ({ fromUid, rowId, toUid, author }, ctx) => writing(async () => {
      if (!toUid || toUid.startsWith('ext_')) throw new ApiError(400, `Invalid LDAP uid: ${toUid}`);
      if ((await grist.records(ANNUAIRE, { uid_dyna: [toUid] })).length) {
        throw new ApiError(409, `This uid already has a directory record, merge the two records instead: ${toUid}`);
      }
      const rows = fromUid ? await rowsInScope(ctx.scope, { uid_dyna: [fromUid] })
        : rowId ? await rowsInScope(ctx.scope, { id: [rowId] }) : [];
      if (!rows.length) throw new ApiError(404, `Record not found in Grist: uid ${fromUid || '—'}`);
      const note = `[${todayIso()}] uid ${fromUid || '(vide)'} → ${toUid} (n° agent = compte LDAP), par ${author}`;
      await update(ctx, ANNUAIRE, rows.map((r) => {
        const com = String(r.fields['Commentaires'] || '').trimEnd();
        return { id: r.rowId, fields: { uid_dyna: toUid, Commentaires: com ? `${com}\n${note}` : note } };
      }));
      return { updated: rows.length };
    }),

    /**
     * Merges two Annuaire rows: logs (JSON snapshot of the deleted row + previous values of the fields
     * written on the kept row), PATCHes the kept row, then deletes the other — the log exists before any
     * destructive write. Formula columns are never written.
     */
    mergeRows: ({ keepRowId, dropRowId, fields, author, note = '' }, ctx) => writing(async () => {
      if (keepRowId === dropRowId) throw new ApiError(400, 'Merge: both rows are identical');
      if (![keepRowId, dropRowId].every(isRowId)) throw new ApiError(400, 'Invalid Grist identifiers');
      const rows = await rowsInScope(ctx.scope, { id: [keepRowId, dropRowId] });
      const keep = rows.find((r) => r.rowId === keepRowId);
      const drop = rows.find((r) => r.rowId === dropRowId);
      if (!keep || !drop) throw new ApiError(404, 'Merge: one of the rows no longer exists in Grist');
      const writable = await writableColumns();
      const patch: Record<string, any> = {};
      for (const [k, v] of Object.entries(fields || {})) if (writable.has(k)) patch[k] = v;
      if (patch['LABO'] !== undefined) assertLabsInScope(ctx.scope, [patch['LABO']]);
      await ensureMergeLogTable(ctx);
      const [logId] = await add(ctx, MERGE_LOG_TABLE, [{ fields: buildMergeLogRow({ keep, drop, patch, author, note }) }]);
      if (Object.keys(patch).length > 0) {
        await step(() => update(ctx, ANNUAIRE, [{ id: keepRowId, fields: patch }]), `Grist error (writing the kept row): merge log ${logId}`);
      }
      await step(() => remove(ctx, ANNUAIRE, [dropRowId]), `Grist error (deleting the absorbed row): merge log ${logId}`);
      return { logId };
    }),

    /**
     * Undoes a merge: recreates the absorbed row from its snapshot (new rowId — Druid URLs use the uid) and
     * restores the previous values of the fields written on the kept row. The log is flagged as soon as the row
     * is recreated, so that a later failure never leads to recreating it twice.
     */
    restoreMerge: (logId, ctx) => writing(async () => {
      if (!isRowId(logId)) throw new ApiError(400, 'Invalid Grist identifiers');
      const tableIds = await grist.tableIds();
      const rec = tableIds.includes(MERGE_LOG_TABLE) ? (await grist.records(MERGE_LOG_TABLE, { id: [logId] }))[0] : undefined;
      if (!rec) throw new ApiError(404, `Merge not found: ${logId}`);
      if (rec.fields.restaure) throw new ApiError(409, `Merge already restored: ${logId}`);
      const writable = await writableColumns();
      const dropped = JSON.parse(rec.fields.dropped_json || '{}');
      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries(dropped)) if (writable.has(k) && v !== null) fields[k] = v;
      const before = JSON.parse(rec.fields.kept_before_json || '{}');
      const keptRowId = Number(rec.fields.kept_rowid);
      // Every check before the first write: recreated row and restored kept row within the scope.
      assertLabsInScope(ctx.scope, [fields['LABO']]);
      if (Object.keys(before).length > 0) {
        await assertRowsInScope(ctx.scope, [keptRowId]);
        if (before['LABO'] !== undefined) assertLabsInScope(ctx.scope, [before['LABO']]);
      }
      const [restoredRowId] = await add(ctx, ANNUAIRE, [{ fields }]);
      await step(() => update(ctx, MERGE_LOG_TABLE, [{ id: logId, fields: { restaure: true, restored_rowid: restoredRowId } }]),
        `Row re-created but merge log not updated, do not restart the restoration: row ${restoredRowId}`);
      if (Object.keys(before).length > 0) {
        await step(() => update(ctx, ANNUAIRE, [{ id: keptRowId, fields: before }]),
          `Row re-created but kept row not restored: row ${restoredRowId}, kept row ${keptRowId}`);
      }
      return { restoredRowId };
    }),

    createStructure: (structure, ctx) => writing(async () => {
      // Uniqueness checked against every structure of the document (the browser only knew the ones it could see).
      const fields = structureCreateFields(structure, (await repository.structures()).items, todayIso());
      await assertStructuresInScope(ctx.scope, [], [fields['short_labels']]);
      const [rowId] = await add(ctx, STRUCTURES, [{ fields }]);
      return { id: `S-${rowId}` };
    }),

    updateStructure: (recordId, structure, ctx) => writing(async () => {
      const fields = structureUpdateFields(structure);
      await assertStructuresInScope(ctx.scope, [recordId], [fields['short_labels']]);
      await update(ctx, STRUCTURES, [{ id: recordId, fields }]);
    }),

    createPerson: (researcher, ctx) => writing(async () => {
      const fields = researcherCreateFields(researcher, await writeContext());
      assertLabsInScope(ctx.scope, [fields['LABO']]);
      const [recordId] = await add(ctx, ANNUAIRE, [{ fields }]);
      return { recordId };
    }),

    updatePerson: (recordId, researcher, ctx) => writing(async () => {
      if (!isRowId(recordId)) throw new ApiError(400, 'Invalid Grist ID (gristRowId missing)');
      // One Annuaire row per membership (grouped back by groupQualifiedRows on read). A lab right only sees
      // — and may only rewrite — the rows of its labs, as when the browser read them through the proxy.
      const uid = String(researcher.uid || '').trim();
      const sameUid = uid ? await grist.records(ANNUAIRE, { uid_dyna: [uid] }) : [];
      const anchors = anchorsOf(ctx.scope);
      const siblings = sameUid
        .filter((r) => r.id !== recordId)
        .filter((r) => ctx.scope.all || anchors.has(normalizeAcronym(String(r.fields?.LABO || ''))))
        .map((r) => ({ rowId: r.id, fields: r.fields }));
      const qualified = siblings.filter((r) => String(r.fields[RATTACHEMENT_COL] || '').trim()).map((r) => r.rowId);
      const plan = planAffiliationRows(recordId, researcher.affiliations || [], qualified, todayIso());
      if (plan.patches.length + plan.creates.length > 0) {
        if (!uid) throw new ApiError(400, 'Several affiliations can only be saved for a person with a directory identifier (uid_dyna).');
        if (qualified.length < siblings.length) {
          throw new ApiError(409, 'This person has other directory rows not yet qualified: resolve them on the Duplicates page before adding an affiliation.');
        }
      }
      const wctx = await writeContext();
      const encodeDate = fuzzyDateEncoderFor(wctx.columns);
      const fields = researcherUpdateFields(researcher, plan, wctx);
      const patches = plan.patches.map((p) => ({
        id: p.rowId, fields: { ...membershipFieldsOf(encodeDate, p.affiliation), [RATTACHEMENT_COL]: p.role },
      }));
      const creates = plan.creates.map((c) => ({
        fields: { ...secondaryRowIdentity(researcher, uid), ...membershipFieldsOf(encodeDate, c.affiliation), [RATTACHEMENT_COL]: c.role },
      }));

      // Every check before the first write.
      await assertRowsInScope(ctx.scope, [recordId, ...patches.map((p) => p.id), ...plan.deletes]);
      assertLabsInScope(ctx.scope, [fields['LABO'], ...patches.map((p) => p.fields['LABO']), ...creates.map((c) => c.fields['LABO'])]);

      if (patches.length + creates.length > 0) await ensureAffiliationColumns(ctx);
      await update(ctx, ANNUAIRE, [{ id: recordId, fields }]);
      if (patches.length > 0) await update(ctx, ANNUAIRE, patches);
      if (creates.length > 0) await add(ctx, ANNUAIRE, creates);
      if (plan.deletes.length > 0) {
        // Snapshot in Fusions_log before deleting (restorable like a merge).
        await ensureMergeLogTable(ctx);
        const keep = { rowId: recordId, fields: { uid_dyna: uid, Nom: researcher.lastName, Prenom: researcher.firstName } };
        const logs = siblings.filter((r) => plan.deletes.includes(r.rowId)).map((drop) => ({
          fields: buildMergeLogRow({ keep, drop, patch: {}, author: 'druid', note: 'affiliation removed from the record' }),
        }));
        await add(ctx, MERGE_LOG_TABLE, logs);
        await remove(ctx, ANNUAIRE, plan.deletes);
      }
    }),

    setGroups: (entries, ctx) => writing(async () => {
      const records = entries
        .filter((e) => isRowId(e.recordId))
        .map((e) => ({ id: e.recordId, fields: { groupes: e.groups.join('|') } }));
      if (records.length === 0) return;
      await assertRowsInScope(ctx.scope, records.map((r) => r.id));
      try {
        await update(ctx, ANNUAIRE, records);
      } catch (err) {
        console.error('[api/v1] groups:', (err as Error).message);
        throw new ApiError(502, 'Error saving the groups — does the « groupes » column exist in the Annuaire? (provisioning: node scripts/add_groups_column.cjs --apply)');
      }
    }),

    setOpenalexId: (recordId, openalexId, ctx) => writing(async () => {
      await assertRowsInScope(ctx.scope, [recordId]);
      try {
        await update(ctx, ANNUAIRE, [{ id: recordId, fields: { openalex_author_id: openalexId } }]);
      } catch (err) {
        console.error('[api/v1] openalex id:', (err as Error).message);
        throw new ApiError(502, 'Error saving the author ID — does the « openalex_author_id » column exist in the Annuaire? (provisioning: node scripts/add_groups_column.cjs --apply)');
      }
    }),

    applyValidations: (entries, ctx) => writing(async () => {
      const records = entries
        .filter((e) => isRowId(e.recordId))
        .map((e) => ({ id: e.recordId, fields: validationToGristFields(e.validation, toGristDateCell) }));
      if (records.length === 0) return 0;
      await assertRowsInScope(ctx.scope, records.map((r) => r.id));
      await update(ctx, ANNUAIRE, records);
      return records.length;
    }),

    markAbesSent: (entries, date, ctx) => writing(async () => {
      const records = entries
        .filter((e) => isRowId(e.recordId))
        .map((e) => ({ id: e.recordId, fields: { ABES_export_hash: e.hash, ABES_export_date: date } }));
      await assertRowsInScope(ctx.scope, records.map((r) => r.id));
      for (let i = 0; i < records.length; i += 200) await update(ctx, ANNUAIRE, records.slice(i, i + 200));
      return records.length;
    }),
  };
};
