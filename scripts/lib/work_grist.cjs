'use strict';
/**
 * work_grist.cjs — the work tables on Grist (druid-internal docs/plan-migration-postgresql.md, lot 6 e): the ports of
 * work_services.cjs (tasks, import arbitrations, Benchmark peer lists) and the storage client of the reports
 * (reports_store.cjs), over a Grist client of the document (lib/directory/repository.ts GristClient). The PostgreSQL
 * twin is lib/work/pg (server-api.cjs bundle).
 */
const tasksSchema = require('./tasks_schema.cjs');
const importConflicts = require('./import_conflicts.cjs');
const reportsStore = require('./reports_store.cjs');

/** Saved Benchmark peer lists: personal (owner = Keycloak profile), table created on first use. */
const PEER_GROUPS_TABLE = 'BenchmarkPeerGroups';
const PEER_GROUPS_COLUMNS = [
  { id: 'owner', fields: { label: 'Propriétaire (Keycloak)', type: 'Text' } },
  { id: 'name', fields: { label: 'Nom de la liste', type: 'Text' } },
  { id: 'rors', fields: { label: 'ROR (JSON)', type: 'Text' } },
  { id: 'updated_at', fields: { label: 'Mis à jour le', type: 'Text' } },
];

/**
 * @param grist  Grist client of the instance document
 * @param opts.key        identifies the document for the reports store (tables checked once per document)
 * @param opts.log        provisioning messages
 * @param opts.now        clock (tests)
 */
function gristWorkPorts(grist, { key = 'grist', log = () => {}, now = () => new Date() } = {}) {
  const tasks = {
    ensure: () => tasksSchema.ensureTasksTablesWith(grist, log),
    tasks: () => grist.records(tasksSchema.TASKS_TABLE),
    /** No task table yet → none. */
    tasksOfUid: (uid) => grist.sql(`SELECT id, cle, type, statut FROM "${tasksSchema.TASKS_TABLE}" WHERE "uid_dyna" = ?`, [uid]).catch(() => []),
    events: (taskId) => grist.records(tasksSchema.EVENTS_TABLE, { tache: [taskId] }),
    addTasks: (rows) => grist.addRecords(tasksSchema.TASKS_TABLE, rows.map((fields) => ({ fields }))),
    updateTasks: async (rows) => { if (rows.length) await grist.updateRecords(tasksSchema.TASKS_TABLE, rows); },
    addEvents: (rows) => grist.addRecords(tasksSchema.EVENTS_TABLE, rows.map((fields) => ({ fields }))),
  };

  const conflicts = {
    tables: async () => (await grist.tableIds()).filter(importConflicts.isConflictTable),
    rows: (table) => grist.records(table),
    /** Annuaire column types + label maps of its Ref columns (id ↔ label). */
    async annuaireMeta() {
      const columns = await grist.columns(importConflicts.ANNUAIRE);
      const colTypes = new Map(columns.map((c) => [c.id, c.fields.type]));
      const refLabels = new Map();
      const refIds = new Map();
      for (const c of columns) {
        const target = String(c.fields.type).startsWith('Ref:') ? c.fields.type.slice(4) : '';
        const labelCol = importConflicts.REF_LABEL_COLUMNS[target];
        if (!labelCol) continue;
        const rows = await grist.records(target);
        refLabels.set(c.id, new Map(rows.map((r) => [r.id, String(r.fields[labelCol] ?? '')])));
        refIds.set(c.id, new Map(rows.map((r) => [String(r.fields[labelCol] ?? '').toUpperCase(), r.id])));
      }
      return { colTypes, refLabels, refIds };
    },
    async annuaireRecords(ids) {
      if (ids.length === 0) return new Map();
      const rows = await grist.records(importConflicts.ANNUAIRE, { id: [...new Set(ids)] });
      return new Map(rows.map((r) => [r.id, r.fields]));
    },
    /** Annuaire first: a failure leaves the conflicts open, never marked resolved without effect. */
    async resolve(table, annuairePatches, rowPatches) {
      for (const group of importConflicts.groupBySameFields(annuairePatches)) await grist.updateRecords(importConflicts.ANNUAIRE, group);
      for (const group of importConflicts.groupBySameFields(rowPatches)) await grist.updateRecords(table, group);
    },
  };

  const ensurePeerGroups = async () => {
    if ((await grist.tableIds()).includes(PEER_GROUPS_TABLE)) return;
    await grist.addTables([{ id: PEER_GROUPS_TABLE, columns: PEER_GROUPS_COLUMNS }]);
  };
  const peerGroups = {
    async list(owner) {
      await ensurePeerGroups();
      return (await grist.records(PEER_GROUPS_TABLE, { owner: [owner] }))
        .map((r) => {
          let rors = [];
          try { rors = JSON.parse(r.fields.rors || '[]'); } catch { /* corrupted list → ignored */ }
          return { id: r.id, name: r.fields.name, rors, updatedAt: r.fields.updated_at || null };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    },
    /** Saving again under a name already used by the same user updates that list rather than adding a second one. */
    async save(owner, name, rors) {
      await ensurePeerGroups();
      const existing = await grist.records(PEER_GROUPS_TABLE, { owner: [owner], name: [name] });
      const fields = { owner, name, rors: JSON.stringify(rors), updated_at: now().toISOString() };
      if (existing.length > 0) {
        await grist.updateRecords(PEER_GROUPS_TABLE, [{ id: existing[0].id, fields }]);
        return existing[0].id;
      }
      const [id = null] = await grist.addRecords(PEER_GROUPS_TABLE, [{ fields }]);
      return id;
    },
    /** Ownership checked through the owner filter: a row id is a guessable integer, never trusted alone. */
    async remove(owner, id) {
      const rec = (await grist.records(PEER_GROUPS_TABLE, { owner: [owner] })).find((r) => r.id === id);
      if (!rec) return false;
      await grist.deleteRecords(PEER_GROUPS_TABLE, [id]);
      return true;
    },
  };

  return { tasks, conflicts, peerGroups, reports: reportsStore.storageClient(grist, key) };
}

module.exports = { gristWorkPorts, PEER_GROUPS_TABLE };
