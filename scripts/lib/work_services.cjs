'use strict';
/**
 * work_services.cjs — what the « À traiter » routes of server.cjs do with the work tables (druid-internal
 * docs/plan-migration-postgresql.md, lot 6 e): tasks and their events, arbitration of the directory imports, Benchmark
 * peer lists. The rules are those of tasks_schema.cjs and import_conflicts.cjs; the storage is a port with a Grist
 * implementation (work_grist.cjs) and a PostgreSQL one (lib/work/pg, server-api.cjs bundle), checked against each
 * other by lib/__tests__/pgWork.integration.test.ts.
 *
 * Tasks port: { ensure(), tasks(), tasksOfUid(uid) → [{ id, cle, type, statut }], events(taskId), addTasks([fields]) → ids,
 *   updateTasks([{ id, fields }]), addEvents([fields]) → ids } — rows `{ id, fields }` in the columns of the Grist tables Taches / Taches_evenements.
 * Conflicts port: { tables() → ids, rows(table), annuaireMeta() → { colTypes, refLabels, refIds },
 *   annuaireRecords(ids) → Map id → fields, resolve(table, annuairePatches, rowPatches) }.
 * Peer lists port: { list(owner), save(owner, name, rors) → id, remove(owner, id) → found }.
 *
 * Plain CommonJS: server.cjs cannot import TypeScript.
 */
const tasksSchema = require('./tasks_schema.cjs');
const importConflicts = require('./import_conflicts.cjs');

class WorkError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Grist row → API shape (statut normalised: an empty status typed in Grist reads as `a_faire`). */
const taskOut = (r) => ({ id: r.id, ...r.fields, statut: tasksSchema.statusOf(r.fields), chercheur: r.fields.chercheur || 0 });
const taskEventOut = (r) => ({ id: r.id, tache: r.fields.tache, date: r.fields.date, auteur: r.fields.auteur, action: r.fields.action, detail: r.fields.detail || '' });

/** Task routes: `author` is the Keycloak session, never the request body; `now` a clock (tests). */
function createTasksService(port, { now = () => new Date() } = {}) {
  let ready = false;
  const ensure = async () => {
    if (ready) return;
    await port.ensure();
    ready = true;
  };
  /** Loads one task by id (the Grist filter works on columns only, so the id is checked locally). */
  const loadTask = async (id) => {
    const rec = (await port.tasks()).find((r) => r.id === id);
    if (!rec) throw new WorkError(404, 'Task not found');
    return rec;
  };
  const appendEvent = async (tache, ev) => (await port.addEvents([{ tache, ...ev }]))[0];

  return {
    /** List (all statuses: the client filters, the table stays small). */
    async list() {
      await ensure();
      return (await port.tasks()).map(taskOut);
    },

    /** Tasks of a record key (uid or g<row>): id, key, type, status — the « suggestions » of the record. */
    async ofUid(uid) {
      return (await port.tasksOfUid(uid)).map((t) => ({ ...t, statut: tasksSchema.statusOf(t) }));
    },

    /** A task built by the caller (a suggestion of the record) and its events. */
    async insert(fields, events) {
      await ensure();
      const [id] = await port.addTasks([fields]);
      for (const ev of events) await appendEvent(id, ev);
      return taskOut({ id, fields });
    },

    async events(id) {
      await ensure();
      return (await port.events(id)).map(taskEventOut).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    },

    async create(body, author) {
      await ensure();
      const nowIso = now().toISOString();
      const fields = tasksSchema.normalizeCreate(body, { author, nowIso });
      const [id] = await port.addTasks([fields]);
      await appendEvent(id, { date: nowIso, auteur: author, action: 'creation', detail: fields.titre });
      return taskOut({ id, fields });
    },

    /** Editable fields only (assignee, priorite, canal, description, titre, lien). */
    async patch(id, body, author) {
      await ensure();
      const patch = tasksSchema.normalizePatch(body);
      const rec = await loadTask(id);
      await port.updateTasks([{ id, fields: patch }]);
      const action = 'assignee' in patch && Object.keys(patch).length === 1 ? 'reassignation' : 'modification';
      const detail = action === 'reassignation' ? patch.assignee : Object.keys(patch).join(', ');
      await appendEvent(id, { date: now().toISOString(), auteur: author, action, detail });
      return taskOut({ id, fields: { ...rec.fields, ...patch } });
    },

    /** Workflow: { statut, motif?, resolution? } — transitions checked server-side. */
    async transition(id, body, author) {
      await ensure();
      const rec = await loadTask(id);
      const { patch, event } = tasksSchema.applyTransition(rec.fields, String(body?.statut || ''), {
        author, motif: body?.motif, resolution: body?.resolution, nowIso: now().toISOString(),
      });
      await port.updateTasks([{ id, fields: patch }]);
      await appendEvent(id, event);
      return taskOut({ id, fields: { ...rec.fields, ...patch } });
    },

    /** Free events: comment, or « email prepared » (lot 3: copied / opened in the mail client). */
    async addEvent(id, body, author) {
      await ensure();
      const action = String(body?.action || '');
      if (!['commentaire', 'email_prepare'].includes(action)) throw new WorkError(400, 'Unknown event action');
      const detail = String(body?.detail || '').trim().slice(0, 4000);
      if (action === 'commentaire' && !detail) throw new WorkError(400, 'Empty comment');
      await loadTask(id);
      const date = now().toISOString();
      const eventId = await appendEvent(id, { date, auteur: author, action, detail });
      return taskEventOut({ id: eventId, fields: { tache: id, date, auteur: author, action, detail } });
    },

    /** ABES export marked as sent: closes the open `lot_abes` tasks covered by the exported rows. */
    async abesSent(body, author) {
      await ensure();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? body.date : now().toISOString().slice(0, 10);
      const items = (Array.isArray(body?.items) ? body.items : []).slice(0, 20000).map((it) => ({
        rowId: Number.isInteger(it?.rowId) ? it.rowId : 0,
        uid: String(it?.uid || '').slice(0, 64),
        types: (Array.isArray(it?.types) ? it.types : []).filter((x) => tasksSchema.TASK_TYPES[x]),
      }));
      const { patches, events } = tasksSchema.abesSentPatches(await port.tasks(), items, { author, date, nowIso: now().toISOString() });
      for (let i = 0; i < patches.length; i += 100) await port.updateTasks(patches.slice(i, i + 100));
      for (let i = 0; i < events.length; i += 100) await port.addEvents(events.slice(i, i + 100));
      return { closed: patches.length };
    },
  };
}

/** Arbitration of the conflicts left by a directory import (Arbitrage_* tables). */
function createConflictsService(port, { now = () => new Date() } = {}) {
  /** Resolves `table` against the existing arbitration tables (never a free table name). */
  const tableOf = async (table) => {
    const id = String(table || '');
    if (!importConflicts.isConflictTable(id) || !(await port.tables()).includes(id)) throw new WorkError(404, 'Conflict table not found');
    return id;
  };
  /** Open rows of a table that still need a decision (same list as the tab shows). */
  const actionable = async (table, meta) => {
    const rows = (await port.rows(table)).filter((r) => importConflicts.isOpen(r.fields));
    const annuaire = await port.annuaireRecords(rows.map((r) => r.fields[importConflicts.COL.record]));
    return importConflicts.openConflicts(rows, { ...meta, annuaire });
  };

  return {
    /** Tables with their number of actionable conflicts (a settled table stays listed with 0). */
    async tables() {
      const ids = await port.tables();
      const meta = ids.length ? await port.annuaireMeta() : null;
      const out = [];
      for (const id of ids) out.push({ id, source: importConflicts.sourceLabel(id), open: (await actionable(id, meta)).length });
      return out;
    },

    async conflicts(table) {
      const id = await tableOf(table);
      return { source: importConflicts.sourceLabel(id), conflicts: await actionable(id, await port.annuaireMeta()) };
    },

    /** decisions: [{ id, choice: 'import'|'current'|'other', value? }] (≤ 500 per call). */
    async resolve(table, decisions, author) {
      const id = await tableOf(table);
      if (!Array.isArray(decisions) || decisions.length === 0 || decisions.length > 500) {
        throw new importConflicts.ConflictInputError('1 to 500 decisions expected');
      }
      const rows = (await port.rows(id)).filter((r) => importConflicts.isOpen(r.fields));
      const targeted = rows.filter((r) => decisions.some((d) => d?.id === r.id));
      const meta = await port.annuaireMeta();
      const annuaire = await port.annuaireRecords(targeted.map((r) => r.fields[importConflicts.COL.record]));
      const { annuairePatches, rowPatches } = importConflicts.buildWrites(targeted, decisions, {
        ...meta, annuaire, source: importConflicts.sourceLabel(id), author, nowIso: now().toISOString(),
      });
      await port.resolve(id, annuairePatches, rowPatches);
      return { resolved: rowPatches.length, updatedRecords: annuairePatches.length };
    },
  };
}

/** Status of an error of these services (input errors of the shared rules → 400). */
const workErrorStatus = (e) => e.status
  || (e instanceof tasksSchema.TaskInputError || e instanceof importConflicts.ConflictInputError ? 400 : 502);

module.exports = { WorkError, createTasksService, createConflictsService, workErrorStatus, taskOut, taskEventOut };
