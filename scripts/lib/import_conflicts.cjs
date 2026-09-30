'use strict';
/**
 * « À traiter › Conflits annuaire <source> »: arbitration of the conflicts left by a one-off import
 * of another directory into the Annuaire (e.g. the staff records curated by a partner institution).
 *
 * The import script only fills the empty Annuaire cells; every cell where both sides disagree
 * becomes one row of a Grist table named `Arbitrage_<Source>[_YYYY[_MM]]` (source label derived
 * from the name), with the columns below. Druid lists the open rows and applies the choice:
 * keep the current value, take the imported one, or type another one.
 *
 * Pure functions only (no I/O): the routes live in server.cjs, the tests in
 * lib/__tests__/importConflicts.test.ts.
 */

const TABLE_PREFIX = 'Arbitrage_';
const ANNUAIRE = 'Annuaire';

/** Arbitration table columns (Grist ids). */
const COL = {
  record: 'Fiche', // Ref:Annuaire
  person: 'Personne',
  lab: 'Labo',
  family: 'Famille', // RH | Identifiant | Lien
  field: 'Champ', // Annuaire column id
  current: 'Valeur_actuelle', // display snapshot at import time
  imported: 'Valeur_importee', // display value
  importedJson: 'Valeur_importee_json', // typed value, JSON — what is written on « import »
  remark: 'Remarque',
  choice: 'Choix',
  other: 'Valeur_autre',
  resolvedAt: 'Resolu_le',
  resolvedBy: 'Resolu_par',
};

/** API choice → label stored in the Choix column. */
const CHOICES = { import: 'Import', current: 'Actuelle', other: 'Autre' };

class ConflictInputError extends Error {}

/** Label column of the tables referenced by Annuaire Ref columns (display + « other » input). */
const REF_LABEL_COLUMNS = { Etablissements: 'Employeur' };

const isConflictTable =(id) => typeof id === 'string' && id.startsWith(TABLE_PREFIX) && id.length > TABLE_PREFIX.length;

/** `Arbitrage_Centrale_2026_09` → `Centrale`; `Arbitrage_Ecole_X` → `Ecole X`. */
const sourceLabel = (tableId) =>
  String(tableId).slice(TABLE_PREFIX.length).replace(/(_\d{4})(_\d{1,2})?$/, '').replace(/_/g, ' ').trim();

const isOpen = (fields) => !fields[COL.resolvedAt];

const pad = (n) => String(n).padStart(2, '0');

/** Display form of an Annuaire cell, the same as the import script's snapshot. */
function displayValue(value, colType, refLabels) {
  if (value === null || value === undefined || value === '') return '';
  if (colType === 'Date') {
    if (typeof value !== 'number') return String(value);
    const d = new Date(value * 1000);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }
  if (String(colType).startsWith('Ref:')) return value ? (refLabels?.get(value) ?? String(value)) : '';
  if (colType === 'Numeric' || colType === 'Int') return value === 0 ? '' : String(value);
  return String(value);
}

/** dd/mm/yyyy or yyyy-mm-dd → Grist Date (seconds, UTC midnight). */
function parseDate(text) {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const ymd = m ? [m[3], m[2], m[1]] : (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)) ? [m[1], m[2], m[3]] : null;
  if (!ymd) throw new ConflictInputError(`Invalid date: ${text}`);
  const [y, mo, d] = ymd.map(Number);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new ConflictInputError(`Invalid date: ${text}`);
  }
  return t / 1000;
}

/**
 * Typed Annuaire value for a decision. `refIds`: label → row id of the referenced table
 * (Employeur); an « other » value on a Ref column must name an existing row.
 */
function decisionValue(fields, decision, colType, refIds) {
  if (decision.choice === 'import') {
    const raw = fields[COL.importedJson];
    if (raw === undefined || raw === null || raw === '') throw new ConflictInputError('Imported value missing');
    return JSON.parse(raw);
  }
  const text = String(decision.value ?? '').trim();
  if (colType === 'Date') return text ? parseDate(text) : null;
  if (colType === 'Numeric' || colType === 'Int') {
    if (!text) return null;
    const n = Number(text);
    if (!Number.isFinite(n)) throw new ConflictInputError(`Invalid number: ${text}`);
    return n;
  }
  if (String(colType).startsWith('Ref:')) {
    if (!text) return 0;
    const id = refIds?.get(text.toUpperCase());
    if (!id) throw new ConflictInputError(`Unknown reference: ${text}`);
    return id;
  }
  return text;
}

/**
 * Turns decisions into Grist writes.
 * @param rows        open arbitration rows ({ id, fields }) targeted by the decisions
 * @param decisions   [{ id, choice: 'import'|'current'|'other', value? }]
 * @param ctx         { colTypes: Map, refIds: Map (per Ref column id), annuaire: Map rowId → fields,
 *                      source, author, nowIso }
 * @returns { annuairePatches: [{ id, fields }], rowPatches: [{ id, fields }] }
 */
function buildWrites(rows, decisions, ctx) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const perRecord = new Map(); // Annuaire rowId → { field: value }
  const rowPatches = [];
  const seen = new Set();
  for (const d of decisions) {
    if (!d || !Number.isInteger(d.id)) throw new ConflictInputError('Invalid conflict id');
    if (!Object.prototype.hasOwnProperty.call(CHOICES, d.choice)) throw new ConflictInputError(`Invalid choice: ${d?.choice}`);
    if (seen.has(d.id)) throw new ConflictInputError(`Duplicate conflict id: ${d.id}`);
    seen.add(d.id);
    const row = byId.get(d.id);
    if (!row) throw new ConflictInputError(`Conflict ${d.id} not found or already resolved`);
    const f = row.fields;
    const field = f[COL.field];
    const recordId = f[COL.record];
    if (!ctx.colTypes.has(field)) throw new ConflictInputError(`Unknown Annuaire column: ${field}`);
    if (!ctx.annuaire.has(recordId)) throw new ConflictInputError(`Annuaire record ${recordId} not found`);
    if (d.choice !== 'current') {
      const colType = ctx.colTypes.get(field);
      const value = decisionValue(f, d, colType, ctx.refIds?.get(field));
      const cur = perRecord.get(recordId) || {};
      cur[field] = value;
      perRecord.set(recordId, cur);
    }
    rowPatches.push({
      id: d.id,
      fields: {
        [COL.choice]: CHOICES[d.choice],
        [COL.other]: d.choice === 'other' ? String(d.value ?? '').trim() : '',
        [COL.resolvedAt]: ctx.nowIso,
        [COL.resolvedBy]: ctx.author,
      },
    });
  }
  const day = ctx.nowIso.slice(0, 10);
  const annuairePatches = [...perRecord.entries()].map(([id, fields]) => {
    const previous = String(ctx.annuaire.get(id).Commentaires || '').trimEnd();
    const line = `[${day}] Arbitrage ${ctx.source} (${ctx.author}): ${Object.keys(fields).join(', ')}`;
    return { id, fields: { ...fields, Commentaires: previous ? `${previous}\n${line}` : line } };
  });
  return { annuairePatches, rowPatches };
}

/** Grist PATCH requires the same columns on every record of a request. */
function groupBySameFields(records) {
  const groups = new Map();
  for (const r of records) {
    const key = Object.keys(r.fields).sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()];
}

/**
 * API shape of the open, still actionable rows: the current value is re-read from the Annuaire
 * (it may have been edited since the import); a row whose live value already equals the imported
 * one has nothing left to decide and is left out.
 */
function openConflicts(rows, ctx) {
  const out = [];
  for (const r of rows) {
    const f = r.fields;
    if (!isOpen(f)) continue;
    const record = ctx.annuaire.get(f[COL.record]);
    if (!record) continue;
    const field = f[COL.field];
    const live = displayValue(record[field], ctx.colTypes.get(field), ctx.refLabels?.get(field));
    const imported = String(f[COL.imported] ?? '');
    if (live.trim().toLowerCase() === imported.trim().toLowerCase()) continue;
    out.push({
      id: r.id,
      record: f[COL.record],
      uid: record.uid_dyna || '',
      person: f[COL.person] || `${record.Prenom || ''} ${record.Nom || ''}`.trim(),
      lab: record.LABO || f[COL.lab] || '',
      family: f[COL.family] || '',
      field,
      current: live,
      imported,
      remark: f[COL.remark] || '',
      changedSinceImport: live !== String(f[COL.current] ?? ''),
    });
  }
  return out;
}

module.exports = {
  TABLE_PREFIX, ANNUAIRE, COL, CHOICES, REF_LABEL_COLUMNS, ConflictInputError,
  isConflictTable, sourceLabel, isOpen, displayValue, parseDate, decisionValue, buildWrites,
  groupBySameFields, openConflicts,
};
