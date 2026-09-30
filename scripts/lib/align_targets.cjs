/**
 * align_targets.cjs — which Annuaire records an alignment run processes, per source
 * (docs/plan-recherche-alignement-maitrisee.md, lot 2). One definition shared by the five scripts
 * (sync_idref_qualinka, sync_orcid, sync_hal, sync_openalex, sync_scopus) and by the estimate
 * route of server.cjs (/api/align/estimate): the launch window counts exactly what a run does.
 *
 * Pure: records come from align_common.fetchAnnuaire(), caches are the parsed JSON files.
 */
'use strict';

const { extractPpn, applyTargetFilters } = require('./align_common.cjs');

/** OpenAlex author id of a cell (URL, « A123… »), upper-case; '' when none. */
function extractAId(raw) {
  const m = String(raw || '').match(/(A\d{4,})/i);
  return m ? m[1].toUpperCase() : '';
}
/** List of A-ids from a pipe-separated cell (tolerates , ; spaces and URLs). Deduplicated, order kept. */
function parseIds(v) {
  const out = [];
  for (const x of String(v || '').split(/[|,;\s]+/)) {
    const a = extractAId(x);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

const digits = (v) => String(v || '').replace(/\D/g, '');
/** Scopus Author ID of a record ('' when none: empty, 0, or not 6-12 digits). */
const scopusIdOf = (p) => (/^\d{6,12}$/.test(digits(p.scopus)) && String(p.scopus).trim() !== '0' ? digits(p.scopus) : '');
/** Explicit non-numeric text in ID_SCOPUS (« absent »…): treated as filled by hand, never searched. */
const scopusMarkedAbsent = (p) => !scopusIdOf(p) && String(p.scopus ?? '').trim() !== '' && String(p.scopus).trim() !== '0';

/** A record already processed in this mode, not in error: skipped unless --force. */
const doneInMode = (entry, mode) => !!entry && entry.mode === mode && entry.status !== 'error';

/**
 * Per source: the cache file, the modes a run supports, `eligible(p, mode)` (the record lacks or
 * carries the identifier, according to the mode) and `done(entry, mode)` (already processed).
 * IdRef in the unified view = the Qualinka engine, search only; its cache entries carry no mode.
 */
const TARGET_SOURCES = {
  idref: {
    cachePath: 'idref_align_qualinka_cache.json',
    modes: ['search'],
    eligible: (p) => !extractPpn(p.idref),
    done: (entry) => !!(entry && entry.status),
  },
  orcid: {
    cachePath: 'orcid_align_cache.json',
    modes: ['search', 'verify'],
    eligible: (p, mode) => (mode === 'verify' ? !!String(p.orcid || '').trim() : !String(p.orcid || '').trim()),
    done: doneInMode,
  },
  hal: {
    cachePath: 'hal_align_cache.json',
    modes: ['search', 'verify'],
    eligible: (p, mode) => (mode === 'verify' ? !!String(p.idhal || '').trim() : !String(p.idhal || '').trim()),
    done: doneInMode,
  },
  openalex: {
    cachePath: 'openalex_align_cache.json',
    modes: ['search', 'verify'],
    eligible: (p, mode) => (mode === 'verify'
      ? parseIds(p.openalexIds).length > 0
      : !parseIds(p.openalexIds).length && String(p.statut || '').trim().toUpperCase() !== 'DEPART'),
    done: doneInMode,
  },
  scopus: {
    cachePath: 'scopus_align_cache.json',
    modes: ['search', 'verify'],
    eligible: (p, mode) => (mode === 'verify'
      ? !!(scopusIdOf(p) || (String(p.scopus ?? '').trim() && !scopusMarkedAbsent(p)))
      : !scopusIdOf(p) && !scopusMarkedAbsent(p)),
    done: doneInMode,
  },
};

/**
 * Records a run of `source` processes. `eligible` = records of the scope lacking (search) or
 * carrying (verify) the identifier; `pending` = those never processed in this mode, or in error;
 * `targets` = what the run takes (all eligible with `force`, else pending), capped by `limit`.
 */
function selectTargets(source, all, cache, { mode = 'search', labo = '', group = '', force = false, limit = 0 } = {}) {
  const spec = TARGET_SOURCES[source];
  if (!spec) throw new Error(`Unknown alignment source: ${source}`);
  const scoped = applyTargetFilters(all.filter((p) => (p.first || p.last) && spec.eligible(p, mode)), { labo, group });
  const pending = scoped.filter((p) => !spec.done((cache || {})[p.key], mode));
  let targets = force ? scoped : pending;
  if (limit > 0) targets = targets.slice(0, limit);
  return { eligible: scoped, pending, targets };
}

module.exports = { TARGET_SOURCES, selectTargets, extractAId, parseIds, scopusIdOf, scopusMarkedAbsent };
