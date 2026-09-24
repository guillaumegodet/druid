/**
 * sync_idref.cjs — Alignment of researcher identifiers on IdRef (ABES).
 *
 * Node port of the logic of `pydref.py`
 * (`gitlab.univ-nantes.fr/bibliometrie/alignement-identifiants-chercheurs`):
 *   - IdRef Solr query (https://www.idref.fr/Sru/Solr)
 *   - download + parsing of the UniMARC XML authority record (https://www.idref.fr/{ppn}.xml)
 *   - filters: exact fullname / scientific person / date bounds
 *
 * Reads the Grist `Annuaire` table directly (env VITE_GRIST_DOC_ID / GRIST_API_KEY,
 * like the /api/sync-structures-csv endpoint) and writes an `idref_align_cache.json` cache
 * (key = uid_dyna) consumed by GristService.computeIdrefDiff on the front-end side.
 *
 * Modes (--mode=):
 *   search  (default): for the records WITHOUT IdRef → search by name.
 *   verify           : for the records WITH IdRef → re-reads the authority record, proposes ORCID/IdHAL,
 *                      flags name inconsistencies.
 *
 * Modeled on scripts/sync_ldap.cjs (generates a JSON cache served by server.cjs from the app root).
 * Incremental: merges with the existing cache.
 *
 * The foundation (CLI, text, HTTP, pool, Grist, cache/progress) lives in scripts/lib/align_common.cjs,
 * shared with the ORCID and HAL alignments (docs/archive/plan-alignement-orcid-hal.md).
 */
const { XMLParser } = require('fast-xml-parser');
const common = require('./lib/align_common.cjs');
const { normalize, extractPpn, getUrl, runPool, applyTargetFilters, makeStore } = common;

// ── Parameters (common foundation: --mode= --limit= --labo= --group= --concurrency=) ─────────
const OPTS = common.commonOptions({ modes: ['search', 'verify'], concurrency: 6 });
const { mode: MODE, limit: LIMIT, labo: LABO_FILTER, group: GROUP_FILTER, concurrency: CONCURRENCY } = OPTS;
// Like sync_hal.cjs/sync_orcid.cjs/sync_openalex.cjs: without --force, a record already resolved in this mode
// is not reprocessed (except on an authority record error, to retry) — the file docstring already announced this
// behavior (« Incrémental »), which was missing in practice (review lot 4, finding 10).
const FORCE = OPTS.force || !!LABO_FILTER;
const MIN_BIRTH_YEAR = 1920;
const MIN_DEATH_YEAR = 2005;
const NOT_SCIENTIST_TOKEN = ['chanteur', 'dramaturge', 'journalist', 'poete', 'theater', 'theatre'];

const store = makeStore({ cachePath: 'idref_align_cache.json', progressPath: 'idref_align_progress.json' });
const { loadCache, writeCache, writeProgress } = store;

// parseTagValue/parseAttributeValue=false: mandatory so as not to lose the leading zeros
// of PPN/ISNI (e.g. "028736036" would become the number 28736036).
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true,
  parseTagValue: false, parseAttributeValue: false,
});

// ── IdRef access ──────────────────────────────────────────────────────────────
async function querySolr(name) {
  const solrQuery = normalize(name).split(' ').filter(Boolean).join(' AND ');
  if (!solrQuery) return [];
  const params = new URLSearchParams({
    q: `persname_t: (${solrQuery})`, wt: 'json', fl: '*', sort: 'score desc', version: '2.2',
  });
  try {
    const data = await getUrl(`https://www.idref.fr/Sru/Solr?${params}`, { json: true });
    const docs = data?.response?.docs || [];
    return docs.map((d) => d.ppn_z).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/** Parsed MARC XML authority record, or `{ redirect: newPpn }` if the record was merged/replaced (IdRef 301
 * to the PPN that replaces it), `{ missing: true }` if it no longer exists (404), null on any other error. */
async function getNotice(ppn) {
  try {
    const xml = await getUrl(`https://www.idref.fr/${ppn}.xml`, { redirect: 'manual' });
    if (!xml || typeof xml !== 'string') return null;
    return parser.parse(xml);
  } catch (e) {
    if (e && e.redirect) {
      const m = /\/(\d{8}[\dXx])(?:\.xml)?(?:[?#].*)?$/.exec(e.redirect);
      if (m && m[1].toUpperCase() !== String(ppn).toUpperCase()) return { redirect: m[1].toUpperCase() };
    }
    if (e && e.status === 404) return { missing: true };
    return null;
  }
}
/** Follows up to 3 authority record redirects; returns { notice, ppn (final), redirectedFrom?, missing? }. */
async function resolveNotice(ppn) {
  let cur = String(ppn);
  for (let hop = 0; hop < 4; hop++) {
    const n = await getNotice(cur);
    if (n && n.redirect) { cur = n.redirect; continue; }
    if (n && n.missing) return { notice: null, ppn: cur, redirectedFrom: cur !== String(ppn) ? String(ppn) : undefined, missing: true };
    return { notice: n, ppn: cur, redirectedFrom: cur !== String(ppn) ? String(ppn) : undefined };
  }
  return { notice: null, ppn: cur, redirectedFrom: String(ppn) };
}

// Walks the parsed tree and collects all control/datafields (equivalent of BeautifulSoup find_all,
// robust to the root element — record/recordData/etc.).
function collectFields(node, acc) {
  if (!node || typeof node !== 'object') return acc;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'controlfield') {
      for (const cf of [].concat(v)) acc.control.push({ tag: cf?.['@_tag'], text: String(cf?.['#text'] ?? cf ?? '').trim() });
    } else if (k === 'datafield') {
      for (const df of [].concat(v)) {
        const subs = [].concat(df?.subfield || []).map((s) => ({ code: s?.['@_code'], text: String(s?.['#text'] ?? '').trim() }));
        acc.data.push({ tag: df?.['@_tag'], subs });
      }
    } else if (v && typeof v === 'object') {
      collectFields(v, acc);
    }
  }
  return acc;
}
function parseNotice(parsed) {
  return collectFields(parsed, { control: [], data: [] });
}
const sub = (df, code) => (df.subs.find((s) => s.code === code) || {}).text || '';

function getName(fields) {
  let last = null, first = null, job = null, job2 = null;
  for (const df of fields.data) {
    if (df.tag === '200') { last = sub(df, 'a'); first = sub(df, 'b'); job = sub(df, 'c'); }
    if (df.tag === '300') { job2 = sub(df, 'a'); }
  }
  if (job2 && !job) job = job2;
  return { last_name: last, first_name: first, job };
}
function validIdrefDate(x) {
  const digits = (x || '').replace(/\D/g, '');
  if (digits.length !== (x || '').length) return null;
  if (![4, 8].includes(digits.length)) return null;
  return digits.slice(0, 4); // keep only the year (enough for the bounds)
}
function getBirthDeath(fields) {
  let birth = null, death = null;
  for (const df of fields.data) {
    if (df.tag === '103') { birth = validIdrefDate(sub(df, 'a')); death = validIdrefDate(sub(df, 'b')); }
  }
  return { birth, death };
}
function getIdentifiers(fields) {
  const ids = { orcid: '', isni: '', ark: '', sudoc: '', idhal: '' };
  for (const cf of fields.control) {
    if (cf.tag === '001' && !ids.idref) ids.idref = cf.text;
  }
  for (const df of fields.data) {
    if (df.tag === '010' && !ids.isni) ids.isni = sub(df, 'a');
    if (df.tag === '033' && !ids.ark) ids.ark = sub(df, 'a');
    if (df.tag === '035') {
      const labels = df.subs.map((s) => s.text.toUpperCase());
      const a = sub(df, 'a');
      if (labels.includes('ORCID') && !ids.orcid) ids.orcid = a;
      else if (labels.includes('SUDOC') && !ids.sudoc) ids.sudoc = a;
      else if ((labels.includes('IDHAL') || labels.includes('HAL')) && !ids.idhal) ids.idhal = a;
    }
  }
  return ids;
}
/** All 035 fields typed by $2 (ORCID, HAL, SCOPUSID, RNSR, ROR, VIAF…) — ABES export (docs/plan-export-abes-idref.md). */
function getExternalIds(fields) {
  const out = {};
  for (const df of fields.data) {
    if (df.tag !== '035') continue;
    const src = sub(df, '2').toUpperCase();
    const a = sub(df, 'a');
    if (!src || !a) continue;
    (out[src] = out[src] || []).push(a);
  }
  return out;
}
/** 510 fields (institutional affiliations): linked PPN ($3), display dates ($0), label ($a [$c]), relation code ($5). */
function getAffiliations(fields) {
  const out = [];
  for (const df of fields.data) {
    if (df.tag !== '510') continue;
    const ppn = sub(df, '3');
    if (!ppn) continue;
    out.push({ ppn, dates: sub(df, '0'), label: sub(df, 'a'), qualifier: sub(df, 'c'), rel: sub(df, '5') });
  }
  return out;
}
/** 340 fields (biographical / activity notes) — raw text. */
function getNotes(fields) {
  return fields.data.filter((df) => df.tag === '340').map((df) => sub(df, 'a')).filter(Boolean);
}
function getGender(fields) {
  for (const df of fields.data) {
    if (df.tag === '120') {
      const a = sub(df, 'a');
      if (a === 'aa') return 'F';
      if (a === 'ba') return 'M';
    }
  }
  return null;
}
function getDescriptions(fields) {
  const out = [];
  for (const df of fields.data) {
    if (df.tag === '340') { const a = sub(df, 'a'); if (a) out.push(a); }
  }
  return out;
}

// Builds an enriched candidate from an authority record (or null if rejected by the filters).
function buildCandidate(fields, { query = null, scientificFilter = false } = {}) {
  const name = getName(fields);
  const fullName = `${name.first_name || ''} ${name.last_name || ''}`.trim();
  const fullName2 = `${name.last_name || ''} ${name.first_name || ''}`.trim();

  if (query) {
    const forms = [normalize(fullName), normalize(fullName2)];
    if (!forms.includes(normalize(query))) return null; // exact fullname (see pydref)
  }
  const { birth, death } = getBirthDeath(fields);
  if (birth && parseInt(birth, 10) < MIN_BIRTH_YEAR) return null;
  if (death && parseInt(death, 10) < MIN_DEATH_YEAR) return null;

  const descriptions = getDescriptions(fields);
  if (scientificFilter) {
    const joined = descriptions.join(' ').toLowerCase();
    if (NOT_SCIENTIST_TOKEN.some((tok) => joined.includes(tok))) return null;
  }
  const ids = getIdentifiers(fields);
  const externalIds = getExternalIds(fields);
  return {
    ppn: ids.idref || '',
    fullName,
    job: name.job || '',
    birth: birth || '',
    death: death || '',
    description: descriptions.join('; '),
    orcid: ids.orcid || '',
    idhal: ids.idhal || '',
    isni: ids.isni || '',
    sudoc: ids.sudoc || '',
    gender: getGender(fields),
    // Additive fields for the ABES export (lot 1 of docs/plan-export-abes-idref.md):
    // form of the 200 heading, Scopus, all 035 fields, 510 affiliations, 340 notes.
    nameIdref: [name.last_name, name.first_name].filter(Boolean).join(', '),
    scopus: (externalIds.SCOPUSID || [])[0] || '',
    externalIds,
    affiliations: getAffiliations(fields),
    notes: descriptions,
  };
}

// ── Grist ─────────────────────────────────────────────────────────────────────
/** Annuaire records with an LDAP identity (uid_dyna) — key of the idref_align_cache.json cache. */
async function fetchAnnuaire() {
  return (await common.fetchAnnuaire()).filter((p) => p.uid);
}

// Export of the pure functions (unit tests; main only runs when invoked directly).
module.exports = {
  normalize, extractPpn, querySolr, getNotice, parseNotice, buildCandidate,
  getName, getIdentifiers, getBirthDeath, getGender, getDescriptions,
  getExternalIds, getAffiliations, getNotes,
};

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const cache = loadCache();
  console.log(`[idref] mode=${MODE} concurrency=${CONCURRENCY}`);

  const all = await fetchAnnuaire();
  let targets;
  if (MODE === 'verify') targets = all.filter((p) => extractPpn(p.idref));
  else targets = all.filter((p) => !extractPpn(p.idref) && (p.first || p.last)); // search
  targets = applyTargetFilters(targets, { labo: LABO_FILTER, group: GROUP_FILTER });
  const eligible = targets.length;
  if (!FORCE) targets = targets.filter((p) => !cache[p.uid] || cache[p.uid].mode !== MODE || cache[p.uid].status === 'notice_error');
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  console.log(`[idref] ${all.length} Annuaire records, ${eligible} eligible (${MODE}${LABO_FILTER ? `, labo ${LABO_FILTER}` : ''}${GROUP_FILTER ? `, group ${GROUP_FILTER}` : ''}), ${targets.length} to process${FORCE ? ' (force)' : ''}.`);
  let found = 0;
  writeProgress({ running: true, mode: MODE, total: targets.length, done: 0, found: 0, startedAt: new Date().toISOString() });

  await runPool(targets, async (p) => {
    if (MODE === 'verify') {
      const ppn = extractPpn(p.idref);
      const queryName = `${p.first} ${p.last}`.trim();
      // Merged/replaced authority record (IdRef 301) → status 'redirected' + newPpn: the page offers to « Mettre à
      // jour » the Annuaire IdRef; the replacement record is re-read to display its name.
      const { notice, ppn: finalPpn, redirectedFrom, missing } = await resolveNotice(ppn);
      if (missing) { cache[p.uid] = { mode: 'verify', queryName, ppn, status: 'notice_missing', newPpn: redirectedFrom ? finalPpn : undefined, checkedAt: today }; return; }
      if (!notice) {
        cache[p.uid] = redirectedFrom
          ? { mode: 'verify', queryName, ppn, status: 'redirected', newPpn: finalPpn, candidates: [], checkedAt: today }
          : { mode: 'verify', queryName, ppn, status: 'notice_error', checkedAt: today };
        return;
      }
      const cand = buildCandidate(parseNotice(notice), {}); // no filter: we read the known authority record
      const nameForms = [normalize(cand.fullName), normalize(`${cand.fullName.split(' ').reverse().join(' ')}`)];
      const nameMismatch = !!cand.fullName && !nameForms.includes(normalize(queryName));
      cache[p.uid] = redirectedFrom
        ? { mode: 'verify', queryName, ppn, status: 'redirected', newPpn: finalPpn, nameMismatch, candidates: [cand], checkedAt: today }
        : { mode: 'verify', queryName, ppn, status: 'checked', nameMismatch, candidates: [cand], checkedAt: today };
    } else {
      const queryName = `${p.first} ${p.last}`.trim();
      const ppns = await querySolr(queryName);
      const candidates = [];
      for (const ppn of ppns) {
        const { notice } = await resolveNotice(ppn);   // follows a possible authority record merge
        if (!notice) continue;
        const cand = buildCandidate(parseNotice(notice), { query: queryName, scientificFilter: true });
        if (cand && cand.ppn) candidates.push(cand);
      }
      const status = candidates.length === 0 ? 'not_found' : candidates.length === 1 ? 'found' : 'ambiguous';
      if (status !== 'not_found') found++;
      cache[p.uid] = { mode: 'search', queryName, status, candidates, checkedAt: today };
    }
  }, CONCURRENCY, (done) => {
    if (done % 10 === 0 || done === targets.length) {
      writeProgress({ running: true, mode: MODE, total: targets.length, done, found, startedAt: today });
      console.log(`[idref] ${done}/${targets.length}`);
    }
  });

  writeCache(cache);
  writeProgress({ running: false, mode: MODE, total: targets.length, done: targets.length, found, finishedAt: new Date().toISOString() });
  console.log(`[idref] Done. ${MODE === 'search' ? `${found} matches (found/ambiguous)` : `${targets.length} records re-read`}. Cache: ${store.cachePath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[idref] ERROR', e);
    writeProgress({ running: false, error: e.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });
}
