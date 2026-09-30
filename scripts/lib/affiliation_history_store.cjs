/**
 * affiliation_history_store.cjs — storage of the career path (docs/plan-parcours-affiliations.md, lots 1-2),
 * shared by the job (scripts/sync_affiliation_history.cjs) and the API (server.cjs).
 *
 * One directory (cache-data/affiliation_history in Docker, bind-mounted as a whole):
 *   p-<key>.json      full entry of one person;
 *   _index.json       signals, dates and totals of every person;
 *   _hierarchy.json   names / parents of the organizations;
 *   _progress.json    state of the current / last full run.
 * Keys are uid_dyna values or g<rowId> (records without uid).
 */
const fs = require('fs');
const path = require('path');

/** Accepted person keys: uid_dyna (letters, digits, - _ .), ext_… or g<rowId>. */
const isValidKey = (key) => typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(key);
/** File of one person's entry (anything outside [A-Za-z0-9._-] is escaped, keys never start with « _ »). */
const entryFile = (dir, key) => path.join(dir, `p-${String(key).replace(/[^A-Za-z0-9._-]/g, (ch) => `~${ch.charCodeAt(0).toString(16)}`)}.json`);
const indexFile = (dir) => path.join(dir, '_index.json');
const progressFile = (dir) => path.join(dir, '_progress.json');
const hierarchyFile = (dir) => path.join(dir, '_hierarchy.json');

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
/** Atomic write (temporary file + rename in the same directory): a reader never sees a truncated JSON. */
function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  try { fs.renameSync(tmp, file); }
  catch (e) { fs.writeFileSync(file, fs.readFileSync(tmp)); fs.unlinkSync(tmp); }   // bind-mounted single file (EBUSY)
}

/**
 * Writes the index lines computed by this run on top of the index CURRENTLY on disk: a one-person
 * refresh (API) and a full run can overlap, each only brings its own keys.
 */
function mergeIndex(dir, updated) {
  const onDisk = readJson(indexFile(dir), {});
  writeJsonAtomic(indexFile(dir), { ...onDisk, ...updated });
}

const readEntry = (dir, key) => (isValidKey(key) ? readJson(entryFile(dir, key), null) : null);
const readProgress = (dir) => readJson(progressFile(dir), null);

/**
 * May this user trigger a live recomputation of a record (API quotas)? Institution scope, or a lab
 * right on the record's lab — the same scope as editing the record.
 *   access = session access (allSlugs, labAnchors), labos = LABO values of the person's Annuaire rows,
 *   normalize = normalizeAcronym of server.cjs.
 */
function canRefresh(access, labos, normalize) {
  if (access?.allSlugs) return true;
  const anchors = access?.labAnchors || [];
  return !!anchors.length && (labos || []).some((l) => anchors.includes(normalize(String(l || ''))));
}

module.exports = { isValidKey, entryFile, indexFile, progressFile, hierarchyFile, readJson, writeJsonAtomic, mergeIndex, readEntry, readProgress, canRefresh };
