/**
 * sync_scopus.cjs — Alignment of the Annuaire records on Scopus Author IDs (Elsevier APIs).
 *
 * Plan: docs/plan-alignement-scopus.md. Foundation: scripts/lib/align_common.cjs.
 * Same pattern as sync_orcid.cjs (cache, scoring, Grist review table, Valider/Rejeter buttons):
 * single-valued target `ID_SCOPUS` (Numeric column), filled only when empty.
 *
 * APIs (key SCOPUS_API_KEY, tested on 2026-09-22 from the container — ONLY through the FortiGate
 * proxy: the direct route answers 401 « not authorized », the proxy IP carries the entitlement):
 *   GET /content/search/author?query=AUTHLASTNAME(…) AND AUTHFIRST(…) [AND AFFIL(nantes)]
 *       → search-results.entry[] { dc:identifier "AUTHOR_ID:n", orcid "[0000-…]", preferred-name,
 *         name-variant[], document-count, subject-area[], affiliation-current {id, name, city} }
 *       Accent-insensitive; ORCID(…) is a valid query (pass 0). Quota 5,000 requests / week.
 *   GET /content/author/author_id/ID1,ID2,…?view=STANDARD → affiliation-history (ids only) + orcid
 *       (enrichment, search mode); ?view=LIGHT → names, orcid, affiliation-current {name, city}
 *       (verify mode, 25 ids per request). Quota 5,000 / week (separate pool).
 *   GET /content/search/affiliation?query=AFFIL(nantes) → id → {name, city, parent}: resolves the
 *       affiliation-history ids (labs of the site, « Nantes Université » children). Quota 5,000 / week,
 *       ~20 pages, cached 30 days in scopus_affiliations_cache.json.
 *
 * Scoring (asked by the product owner, 2026-09-22 — the affiliations distinguish the candidates):
 *   `fort`   = ORCID of the record on the profile, or exact name AND affiliation Nantes Université
 *              or the record's lab (current or history);
 *   `moyen`  = partial name with the same affiliations, exact name with another affiliation of the
 *              Nantes site (CHU, Centrale, IMT…), ORCID with a diverging name;
 *   `faible` = homonym without evidence.
 *
 * Modes (--mode=):
 *   search (default): records WITHOUT ID_SCOPUS (an explicit text such as « absent » counts as filled).
 *                     Search by name (fallbacks: first token of the first name, last name + AFFIL(nantes)),
 *                     pass 0 by ORCID when the name search did not surface it, enrichment, scoring.
 *   verify          : records WITH a numeric ID_SCOPUS. Existence (merged ids), name, affiliation
 *                     (`affiliation` = `nu` | `labo` | `site` | `autre` | `aucune`), proposes ORCID if empty. Read-only.
 *   push            : no API call — pushes the cached suggestions into `Alignement_Scopus`.
 *
 * Quotas: the run STOPS (progress.warning) when a weekly pool is exhausted (429 QUOTA_EXCEEDED or
 * x-ratelimit-remaining = 0): the records not processed are not cached and are picked up by the next run.
 *
 * Options: --mode= --limit= --labo= --group=personnel|doctorants|hors_recherche --concurrency=(3)
 *           --push-grist=false (dry-run) --force (reprocesses the cached records, --labo included)
 *           --enrich=(3) candidates enriched (affiliation history) per record, 0 = none
 * Cache: scopus_align_cache.json (key = uid_dyna or g<rowId>); progress: scopus_align_progress.json.
 */
const fs = require('fs');
const common = require('./lib/align_common.cjs');
const { createElsevierClient } = require('./lib/elsevier_client.cjs');
const {
  normalize, extractOrcid, nameMatch, heterogeneousFirstNames, getUrl, runPool, makeStore, today,
  gristGet, loadRejected, pushReview, ensureReviewTable, DOC,
} = common;
const { selectTargets, scopusIdOf, scopusMarkedAbsent } = require('./lib/align_targets.cjs');

// ── Parameters ───────────────────────────────────────────────────────────────
const OPTS = common.commonOptions({ modes: ['search', 'verify', 'push'], concurrency: 3 });
const { mode: MODE, limit: LIMIT, labo: LABO_FILTER, group: GROUP_FILTER, concurrency: CONCURRENCY, pushGrist: PUSH_GRIST } = OPTS;
const FORCE = OPTS.force;   // a lab run is incremental too (decision D2 of 2026-09-30): --force to reprocess
const MAX_ENRICH = Math.max(0, parseInt(common.getArg('enrich', '3'), 10) || 0);
const ELS = 'https://api.elsevier.com/content';
const API_KEY = process.env.SCOPUS_API_KEY || '';
const REVIEW_TABLE = 'Alignement_Scopus';
const SOURCE = 'Scopus';
const TARGET = 'ID_SCOPUS';
const SEARCH_ROWS = 50;
const MAX_PUSHED_CANDIDATES = 5;
const VERIFY_BATCH = 25;                      // author ids per retrieval request (multi-id form)
// Per-second rate limits of the Elsevier APIs, one throttle per quota pool (Author Search 2/s,
// Author Retrieval 3/s, Affiliation Search 3/s). The former single 400 ms interval (2.5 req/s)
// exceeded the Author Search limit: 1 request in 8 got a 429 of rate (not quota), and each 429
// cost the HTTP client a 2 s then 4 s back-off — the CEISAM run of 2026-09-22 spent most of its
// 6 minutes waiting (measured on 2026-09-23). Latency itself is ~300 ms through the proxy.
const RATE_PER_S = { search: 2, author: 3, affiliation: 3 };
const RATE_MARGIN_MS = 40;
const RATE_LIMIT_WAIT_MS = 700;               // wait after a 429 of rate (Elsevier clears within the second)
const NU_AFFILIATION_ID = '60032006';         // « Nantes Université » (variant « Université de Nantes »)
const AFFIL_CACHE_PATH = 'scopus_affiliations_cache.json';
const AFFIL_CACHE_TTL_DAYS = 30;
const AFFIL_QUERIES = ['AFFIL(nantes)', 'AFFIL(saint-nazaire) OR AFFIL(bouguenais) OR AFFIL(roche-sur-yon)'];
// Patterns (normalized) of the Nantes site in an affiliation name / city, beyond Nantes Université itself.
const SITE_PATTERNS = ['nantes', 'imt atlantique', 'oniris', 'ifremer', 'institut de cancerologie de l ouest', 'ecole centrale de nantes'];
const SITE_CITIES = ['nantes', 'saint nazaire', 'bouguenais', 'la roche sur yon', 'saint herblain', 'carquefou', 'la chapelle sur erdre', 'reze', 'angers'];
const NU_PATTERNS = ['nantes universite', 'universite de nantes', 'university of nantes', 'univ nantes'];

const store = makeStore({ cachePath: 'scopus_align_cache.json', progressPath: 'scopus_align_progress.json' });
const { loadCache, writeCache, writeProgress } = store;

// ── Elsevier client (throttle, quotas, abort): scripts/lib/elsevier_client.cjs ─────
// Keys read by the client: SCOPUS_API_KEY, then the backup SCOPUS_API_KEY_2. Key 1 is shared with the
// SoVisu+ harvester: this job leaves it SCOPUS_KEY1_RESERVE of each weekly limit (default 30 %, decision
// D1 of 2026-09-30) and moves to key 2 — used in full — beyond; with key 1 alone, the run stops there.
const KEY1_RESERVE = Math.min(0.9, Math.max(0, parseFloat(process.env.SCOPUS_KEY1_RESERVE ?? '0.3') || 0));
const elsevier = createElsevierClient({ tag: 'scopus', ratePerS: RATE_PER_S, rateLimitWaitMs: RATE_LIMIT_WAIT_MS, marginMs: RATE_MARGIN_MS, reserve: [KEY1_RESERVE, 0] });
const QUOTA = elsevier.quota;
const els = (pool, path, params) => elsevier.get(pool, path, params);
const digits = (v) => String(v || '').replace(/\D/g, '');

// ── Author search ────────────────────────────────────────────────────────────
/** Query term: letters, spaces, hyphens and apostrophes only (parentheses/quotes would break the syntax). */
const term = (v) => String(v || '').replace(/[()"'’`]/g, ' ').replace(/\s+/g, ' ').trim();
/** { total, entries } — entries = real profiles (the empty result set is an entry carrying `error`); null = error. */
async function authorSearch(query, count = SEARCH_ROWS) {
  const data = await els('search', '/search/author', { query, count: String(count) });
  if (!data) return null;
  const sr = data['search-results'] || {};
  const total = parseInt(sr['opensearch:totalResults'] || '0', 10) || 0;
  const entries = (sr.entry || []).filter((e) => e && e['dc:identifier']);
  return { total, entries };
}
const nameOf = (n) => `${n?.['given-name'] || ''} ${n?.surname || ''}`.trim();
function toCandidate(e) {
  const pref = e['preferred-name'] || {};
  const forms = [nameOf(pref), ...(e['name-variant'] || []).map(nameOf)].filter(Boolean);
  const aff = e['affiliation-current'] || {};
  const subjects = [];
  for (const s of e['subject-area'] || []) { const label = s.$ || ''; if (label && !subjects.includes(label)) subjects.push(label); }
  return {
    id: digits(e['dc:identifier']), fullName: forms[0] || digits(e['dc:identifier']), forms: [...new Set(forms)],
    orcid: extractOrcid(e.orcid), docCount: parseInt(e['document-count'] || '0', 10) || 0, subjects: subjects.slice(0, 3),
    affiliation: { id: String(aff['affiliation-id'] || ''), name: aff['affiliation-name'] || '', city: aff['affiliation-city'] || '', country: aff['affiliation-country'] || '' },
    history: [],     // affiliation ids (STANDARD retrieval), resolved through the affiliations cache
  };
}
/** Name check on every form; a candidate found through the first token of a compound last name
 * (« Budinich Abarca » → « Budinich », see alignPerson) is at most `partial`. */
function bestNameMatch(p, cand) {
  const last = cand.partialSurname ? term(p.last).split(' ')[0] : p.last;
  let best = null;
  for (const f of cand.forms) {
    const m = nameMatch(p.first, last, f);
    if (m === 'exact' && !cand.partialSurname) return 'exact';
    if (m) best = 'partial';
  }
  return best;
}

// ── Author retrieval (enrichment / verify) ───────────────────────────────────
/** Profiles of `ids` (≤ 25) in one request; view LIGHT (names, orcid, affiliation-current) or STANDARD (history ids). */
async function retrieve(ids, view) {
  if (!ids.length) return [];
  const data = await els('author', `/author/author_id/${ids.join(',')}`, { view });
  if (!data) return null;
  if (data.notFound) return ids.map((id) => ({ id, notFound: true }));
  const list = data['author-retrieval-response-list']?.['author-retrieval-response'] || data['author-retrieval-response'] || [];
  return (Array.isArray(list) ? list : [list]).map((r, i) => {
    const core = r.coredata || {};
    const id = digits(core['dc:identifier']) || ids[i] || '';
    if (r['@status'] && r['@status'] !== 'found') return { id: ids[i] || id, notFound: true };
    const pref = r['preferred-name'] || {};
    const variants = (r['name-variants']?.['name-variant'] || []).map((v) => nameOf(v['name-variant'] || v));
    const aff = r['affiliation-current'] || {};
    const hist = (r['affiliation-history']?.affiliation || []).map((a) => String(a['@id'] || '')).filter(Boolean);
    return {
      id, requestedId: ids[i] || id, orcid: extractOrcid(core.orcid), docCount: parseInt(core['document-count'] || '0', 10) || 0,
      fullName: nameOf(pref), forms: [...new Set([nameOf(pref), ...variants].filter(Boolean))],
      affiliation: { id: String(aff['@id'] || aff['affiliation-id'] || ''), name: aff['affiliation-name'] || '', city: aff['affiliation-city'] || '', country: aff['affiliation-country'] || '' },
      history: hist, range: r['publication-range'] ? `${r['publication-range'].start || '?'}–${r['publication-range'].end || '?'}` : '',
    };
  });
}

// ── Affiliations of the site (id → name/city/parent), 30-day cache ───────────
let AFFILS = null;   // Map id → { name, city, parent }
async function loadAffiliations() {
  if (AFFILS) return AFFILS;
  AFFILS = new Map();
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(AFFIL_CACHE_PATH, 'utf8')); } catch (e) { /* first run */ }
  const fresh = cached && cached.fetchedAt && (Date.now() - new Date(cached.fetchedAt).getTime()) < AFFIL_CACHE_TTL_DAYS * 864e5;
  if (cached && cached.byId && (fresh || MODE !== 'search')) {
    for (const [id, a] of Object.entries(cached.byId)) AFFILS.set(id, a);
    return AFFILS;
  }
  const byId = {};
  let ok = true;
  for (const query of AFFIL_QUERIES) {
    for (let start = 0; ; start += 200) {
      const data = await els('affiliation', '/search/affiliation', { query, count: '200', start: String(start) });
      if (!data) { ok = false; break; }
      const sr = data['search-results'] || {};
      for (const e of sr.entry || []) {
        const id = digits(e['dc:identifier']);
        if (!id) continue;
        byId[id] = { name: e['affiliation-name'] || '', city: e.city || '', parent: String(e['parent-affiliation-id'] || '0'), variants: (e['name-variant'] || []).map((v) => v.$).filter(Boolean) };
      }
      const total = parseInt(sr['opensearch:totalResults'] || '0', 10) || 0;
      if (start + 200 >= total || !(sr.entry || []).length) break;
    }
    if (!ok) break;
  }
  if (ok && Object.keys(byId).length) {
    try { fs.writeFileSync(AFFIL_CACHE_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), byId })); } catch (e) { /* noop */ }
    for (const [id, a] of Object.entries(byId)) AFFILS.set(id, a);
    console.log(`[scopus] ${AFFILS.size} affiliations of the site cached (${AFFIL_CACHE_PATH})`);
  } else if (cached && cached.byId) {
    for (const [id, a] of Object.entries(cached.byId)) AFFILS.set(id, a);
    console.warn(`[scopus] affiliation refresh failed: stale cache kept (${AFFILS.size} entries)`);
  } else {
    console.warn('[scopus] no affiliation cache: history ids will not be resolved (current affiliations only)');
  }
  return AFFILS;
}

// ── Labs (Structures table): acronym → long labels, to recognize the record's lab in an affiliation ──
let LAB_NAMES = null;
const stripLang = (v) => String(v || '').split('|').map((x) => x.replace(/\[[a-z]{2}\]\s*$/i, '').trim()).filter(Boolean);
async function loadLabNames() {
  if (LAB_NAMES) return LAB_NAMES;
  LAB_NAMES = new Map();
  try {
    const { records } = await gristGet(`/docs/${DOC}/tables/Structures/records`);
    for (const r of records) {
      for (const short of stripLang(r.fields.short_labels)) {
        const key = normalize(short);
        if (!key) continue;
        const longs = stripLang(r.fields.long_labels).map(normalize).filter((x) => x.length > 8);
        LAB_NAMES.set(key, [...(LAB_NAMES.get(key) || []), ...longs]);
      }
    }
  } catch (e) { console.warn('[scopus] Structures table unreadable: labs matched by acronym only'); }
  return LAB_NAMES;
}

/**
 * Classifies one affiliation (name, city, id) against the record: returns { kind, label } with kind =
 * 'nu' (Nantes Université or one of its components), 'labo' (the record's lab), 'site' (another
 * institution of the Nantes site) or null. `affils` resolves the parent of an id (NU components).
 */
function orgMatches({ id = '', name = '', city = '' }, labo, labNames, affils) {
  const n = normalize(name);
  const c = normalize(city);
  const a = id ? affils.get(id) : null;
  const sigle = normalize(labo);
  if (sigle && n && (n === sigle || n.split(' ').includes(sigle) || (labNames.get(sigle) || []).some((l) => n.includes(l)))) return { kind: 'labo', label: `labo ${labo} (${name})` };
  if (id === NU_AFFILIATION_ID || (a && a.parent === NU_AFFILIATION_ID) || NU_PATTERNS.some((pat) => n.includes(pat))) return { kind: 'nu', label: `Nantes Université${name && !NU_PATTERNS.some((pat) => n === pat) ? ` (${name})` : ''}` };
  if (SITE_PATTERNS.some((pat) => n.includes(pat)) || (c && SITE_CITIES.includes(c))) return { kind: 'site', label: `site (${name || city})` };
  return null;
}

/**
 * Scoring (see the banner): `fort` = ORCID of the record, or exact name + Nantes Université / lab;
 * `moyen` = partial name with those affiliations, exact name + other site institution, ORCID with a
 * diverging name; `faible` = name only. Returns the evidence list (affiliations found, name quality).
 */
function scoreCandidate(p, cand, labNames, affils) {
  const evidence = [];
  const matchedIds = [];
  const orcid = extractOrcid(p.orcid);
  if (orcid && cand.orcid && cand.orcid === orcid) { matchedIds.push('ORCID'); evidence.push(`ORCID identique (${orcid})`); }
  const kinds = new Set();
  const seen = new Set();
  const consider = (aff, suffix) => {
    const m = orgMatches(aff, p.labo, labNames, affils);
    if (!m || seen.has(m.label)) return;
    seen.add(m.label); kinds.add(m.kind); evidence.push(`${m.label}${suffix}`);
  };
  if (cand.affiliation && (cand.affiliation.name || cand.affiliation.id)) consider(cand.affiliation, '');
  for (const id of cand.history || []) {
    if (id === cand.affiliation?.id) continue;
    const a = affils.get(id);
    if (a) consider({ id, name: a.name, city: a.city }, ', historique');
  }
  const name = bestNameMatch(p, cand);
  if (name === 'partial') evidence.push(cand.partialSurname ? 'nom de famille partiel' : 'nom partiel');
  if (!name) evidence.push('nom divergent');
  const nuOrLab = kinds.has('nu') || kinds.has('labo');
  let score = 'faible';
  if (matchedIds.length) score = name ? 'fort' : 'moyen';
  else if (name === 'exact' && nuOrLab) score = 'fort';
  else if (name && (nuOrLab || kinds.has('site'))) score = 'moyen';
  const affiliation = kinds.has('nu') ? 'nu' : kinds.has('labo') ? 'labo' : kinds.has('site') ? 'site' : (cand.affiliation?.name ? 'autre' : 'aucune');
  return { score, evidence, matchedIds, nameMatch: name, affiliation, siteAffiliation: kinds.size > 0 };
}
const RANK = { fort: 0, moyen: 1, faible: 2 };
const affLabel = (aff) => (aff && aff.name ? `${aff.name}${aff.city ? ` (${aff.city})` : ''}` : '');
const historyLabels = (cand, affils) => (cand.history || []).filter((id) => id !== cand.affiliation?.id).map((id) => affils.get(id)?.name).filter(Boolean).slice(0, 6);
/** Compact form written to the cache / review rows. */
function summarize(cand, s, affils) {
  const het = heterogeneousFirstNames('', cand.forms);
  return {
    id: cand.id, fullName: cand.fullName, forms: cand.forms, orcid: cand.orcid || '', docCount: cand.docCount, subjects: cand.subjects || [],
    affiliation: affLabel(cand.affiliation), history: historyLabels(cand, affils), range: cand.range || '',
    score: s.score, evidence: s.evidence, matchedIds: s.matchedIds, nameMatch: s.nameMatch,
    suspect: het ? [`prénoms hétérogènes dans les formes auteur (« ${het[0]} » / « ${het[1]} »)`] : [],
  };
}

/** Search + scoring for a record without Scopus id. */
async function alignPerson(p, labNames, affils) {
  const queryName = `${p.first} ${p.last}`.trim();
  const last = term(p.last);
  const first = term(p.first);
  const firstTok = first.split(' ')[0] || '';
  const derivedFrom = [];
  let netError = false;
  let fallback = false;
  const byId = new Map();
  const add = (entries) => { for (const e of entries) { const c = toCandidate(e); if (c.id && !byId.has(c.id)) byId.set(c.id, c); } };

  if (!last) return { mode: 'search', queryName, status: 'not_found', best: '', derivedFrom, fallback, candidates: [], checkedAt: today() };
  // 1. last name + first name; if the result set overflows, a second query restricted to the site
  //    guarantees the Nantes profiles are in; if empty, retry with the first token of the first name.
  let r = first ? await authorSearch(`AUTHLASTNAME(${last}) AND AUTHFIRST(${first})`) : { total: 0, entries: [] };
  if (r === null) netError = true;
  else {
    add(r.entries);
    if (r.total > SEARCH_ROWS) {
      const r2 = await authorSearch(`AUTHLASTNAME(${last}) AND AUTHFIRST(${first}) AND AFFIL(nantes)`);
      if (r2 === null) netError = true; else add(r2.entries);
    }
    if (!r.entries.length && firstTok && firstTok !== first) {
      const r3 = await authorSearch(`AUTHLASTNAME(${last}) AND AUTHFIRST(${firstTok})`);
      if (r3 === null) netError = true; else add(r3.entries);
    }
  }
  // 2. last name alone, restricted to the site (filtered locally by the name match).
  if (!byId.size && !elsevier.aborted()) {
    const r4 = await authorSearch(`AUTHLASTNAME(${last}) AND AFFIL(nantes)`);
    if (r4 === null) netError = true; else { add(r4.entries); fallback = true; }
  }
  // Name filter (essential with the fallbacks); a profile carrying the record's ORCID is always kept.
  const orcid = extractOrcid(p.orcid);
  for (const [id, c] of byId) if (!bestNameMatch(p, c) && !(orcid && c.orcid === orcid)) byId.delete(id);
  // 2b. Compound last name (« Budinich Abarca », « Ait Oubelli »): Scopus often keeps the first part
  //     only → first token of the last name + first name, candidates flagged partialSurname (≤ partial).
  const lastToks = last.split(' ').filter((t) => t.length >= 3);
  if (!byId.size && !elsevier.aborted() && lastToks.length >= 2 && firstTok) {
    const r6 = await authorSearch(`AUTHLASTNAME(${lastToks[0]}) AND AUTHFIRST(${firstTok})`);
    if (r6 === null) netError = true;
    else {
      for (const e of r6.entries) {
        const c = toCandidate(e);
        c.partialSurname = true;
        if (c.id && !byId.has(c.id) && bestNameMatch(p, c)) { byId.set(c.id, c); fallback = true; }
      }
    }
  }
  // 3. Pass 0 by ORCID when the name search did not surface the profile that carries it.
  if (orcid && !elsevier.aborted() && ![...byId.values()].some((c) => c.orcid === orcid)) {
    const r5 = await authorSearch(`ORCID(${orcid})`, 5);
    if (r5 === null) netError = true;
    else if (r5.entries.length) { derivedFrom.push('ORCID'); add(r5.entries); }
  }
  // 4. Enrichment (affiliation history) of the candidates still without NU/lab evidence — one request.
  const cands = [...byId.values()];
  if (MAX_ENRICH > 0 && cands.length && !elsevier.aborted()) {
    const needs = cands.filter((c) => { const s = scoreCandidate(p, c, labNames, affils); return s.score !== 'fort' && s.affiliation !== 'nu' && s.affiliation !== 'labo'; }).slice(0, MAX_ENRICH);
    if (needs.length) {
      const got = await retrieve(needs.map((c) => c.id), 'STANDARD');
      if (got === null) netError = true;
      else for (const g of got) { const c = byId.get(g.requestedId) || byId.get(g.id); if (c && !g.notFound) { c.history = g.history; if (!c.orcid) c.orcid = g.orcid; } }
    }
  }
  const scored = cands.map((c) => summarize(c, scoreCandidate(p, c, labNames, affils), affils));
  scored.sort((a, b) => RANK[a.score] - RANK[b.score] || b.docCount - a.docCount);

  const strong = scored.filter((c) => c.score === 'fort');
  const medium = scored.filter((c) => c.score === 'moyen');
  let status, best = '';
  if (!scored.length) status = netError || elsevier.aborted() ? 'error' : 'not_found';
  else if (strong.length === 1) { status = 'found'; best = strong[0].id; }
  else if (!strong.length && medium.length === 1) { status = 'found'; best = medium[0].id; }
  else status = 'ambiguous';
  return { mode: 'search', queryName, status, best, derivedFrom, fallback, candidates: scored, checkedAt: today() };
}

/** Verification of a batch of records with Scopus id (one LIGHT retrieval for ≤ 25 ids). Read-only. */
async function verifyBatch(batch, labNames, affils) {
  const out = new Map();
  const valid = batch.filter((p) => /^\d{6,12}$/.test(digits(p.scopus)));
  for (const p of batch) {
    if (!valid.includes(p)) out.set(p.key, { mode: 'verify', queryName: `${p.first} ${p.last}`.trim(), scopus: String(p.scopus || '').trim(), status: 'invalid', checkedAt: today() });
  }
  if (!valid.length) return out;
  const got = await retrieve(valid.map((p) => digits(p.scopus)), 'LIGHT');
  for (const [i, p] of valid.entries()) {
    const queryName = `${p.first} ${p.last}`.trim();
    const id = digits(p.scopus);
    const g = got ? (got.find((x) => x.requestedId === id) || got[i]) : null;
    if (!got || !g) { out.set(p.key, { mode: 'verify', queryName, scopus: id, status: 'error', checkedAt: today() }); continue; }
    if (g.notFound) { out.set(p.key, { mode: 'verify', queryName, scopus: id, status: 'not_found_scopus', checkedAt: today() }); continue; }
    const s = scoreCandidate(p, g, labNames, affils);
    const proposals = [];
    if (g.orcid && !extractOrcid(p.orcid)) proposals.push({ field: 'ORCID', after: g.orcid });
    const cand = summarize(g, s, affils);
    out.set(p.key, {
      mode: 'verify', queryName, scopus: id, status: 'checked', nameMismatch: !s.nameMatch, nameMatch: s.nameMatch,
      affiliation: s.affiliation, siteAffiliation: s.siteAffiliation, suspect: !s.nameMatch,
      merged: g.id && g.id !== id ? g.id : '',       // the id was merged into another profile by Scopus
      candidate: { ...cand, score: undefined }, proposals, checkedAt: today(),
    });
  }
  return out;
}

// ── Collaborative Grist review (Alignement_Scopus table) ─────────────────────
function buildScopusReviewColumns() {
  const validerFormula = [
    `if $Decision == "Validé":`,
    `  return {"button": "Validé ✓", "description": "Déjà appliqué%s" % ((" le " + $Date_application) if $Date_application else ""), "actions": []}`,
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `ann = Annuaire.lookupOne(id=$Annuaire_id) if $Annuaire_id else Annuaire.lookupOne(uid_dyna=$uid_dyna)`,
    `if not ann:`,
    `  return {"button": "Fiche introuvable", "description": "Aucune fiche Annuaire pour %s" % $uid_dyna, "actions": []}`,
    `import re`,
    `def _digits(v):`,
    `  return re.sub(r"\\D", "", str(v or ""))`,
    `def _orcid(v):`,
    `  m = re.search(r"(\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dXx])", str(v or ""))`,
    `  return m.group(1).upper() if m else ""`,
    `fields = {}`,
    `done = []`,
    `cur = _digits(ann.${TARGET}) if isinstance(ann.${TARGET}, (int, float)) else str(ann.${TARGET} or "").strip()`,
    `cand = _digits($Scopus_candidat)`,
    `if not cur or cur == "0":`,
    `  fields["${TARGET}"] = int(cand)`,
    `  done.append("${TARGET}")`,
    `elif _digits(cur) != cand:`,
    `  return {"button": "Conflit Scopus", "description": "L'Annuaire contient déjà l'ID Scopus %s (différent de %s) : à régler dans Druid" % (cur, cand), "actions": []}`,
    `if _orcid($ORCID_candidat) and not _orcid(ann.ORCID):`,
    `  fields["ORCID"] = _orcid($ORCID_candidat)`,
    `  done.append("ORCID")`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `actions = []`,
    `if fields:`,
    `  src = str(ann.Data_source or "")`,
    `  parts = [s.strip().upper() for s in re.split(r"[|,]", src) if s.strip()]`,
    `  if "${SOURCE.toUpperCase()}" not in parts:`,
    `    fields["Data_source"] = (src + "|${SOURCE}") if src else "${SOURCE}"`,
    `  fields["${SOURCE}_derniere_maj"] = today`,
    `  fields["${SOURCE}_champs_modifies"] = "|".join(done)`,
    `  note = "[%s] MAJ ${SOURCE} (revue Grist): %s" % (today, ", ".join(done))`,
    `  com = str(ann.Commentaires or "")`,
    `  fields["Commentaires"] = (com + "\\n" + note) if com else note`,
    `  actions.append(["UpdateRecord", "Annuaire", ann.id, fields])`,
    `actions.append(["UpdateRecord", "${REVIEW_TABLE}", $id, {"Decision": "Validé", "Applique": True, "Date_application": today}])`,
    `for sib in ${REVIEW_TABLE}.lookupRecords(uid_dyna=$uid_dyna):`,
    `  if sib.id != $id and sib.Decision == "À traiter":`,
    `    actions.append(["UpdateRecord", "${REVIEW_TABLE}", sib.id, {"Decision": "Rejeté", "Date_application": today}])`,
    `label = ("Valider " + " + ".join(done)) if done else "Valider (rien à écrire)"`,
    `return {"button": label, "description": "%s -> Scopus %s" % ($Nom_annuaire, cand), "actions": actions}`,
  ].join('\n');
  const rejeterFormula = [
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `return {"button": "Rejeter", "description": "Écarte ce candidat pour %s (il ne sera plus reproposé)" % $Nom_annuaire, "actions": [["UpdateRecord", "${REVIEW_TABLE}", $id, {"Decision": "Rejeté", "Date_application": today}]]}`,
  ].join('\n');

  const text = (id, label) => ({ id, fields: { label, type: 'Text' } });
  return [
    text('uid_dyna', 'uid_dyna'),
    { id: 'Annuaire_id', fields: { label: 'Annuaire (ligne)', type: 'Int' } },
    text('Nom_annuaire', 'Nom annuaire'),
    text('LABO', 'LABO'),
    { id: 'Nb_candidats', fields: { label: 'Nb candidats', type: 'Int' } },
    text('Scopus_candidat', 'Scopus Author ID candidat'),
    {
      id: 'Lien_Scopus',
      fields: {
        label: 'Lien Scopus', type: 'Text', isFormula: true,
        formula: `"https://www.scopus.com/authid/detail.uri?authorId=" + str($Scopus_candidat or "")`,
        widgetOptions: JSON.stringify({ widget: 'HyperLink' }),
      },
    },
    text('Nom_profil', 'Nom profil Scopus'),
    text('Autres_noms', 'Autres noms'),
    text('Score', 'Score'),
    text('Preuves', 'Preuves'),
    text('Affiliation', 'Affiliation courante'),
    text('Affiliations_historique', 'Affiliations (historique, site)'),
    { id: 'Nb_documents', fields: { label: 'Nb documents', type: 'Int' } },
    text('Domaines', 'Domaines'),
    text('ORCID_candidat', 'ORCID du profil'),
    ...common.reviewDecisionColumns(REVIEW_TABLE),   // Decision (4 values), Note, Signale_le, Meler_action
    { id: 'Applique', fields: { label: 'Appliqué', type: 'Bool' } },
    text('Date_application', 'Date application'),
    text('Pousse_le', 'Poussé le'),
    { id: 'Valider_action', fields: { label: 'Valider (action)', type: 'Any', isFormula: true, formula: validerFormula } },
    { id: 'Rejeter_action', fields: { label: 'Rejeter (action)', type: 'Any', isFormula: true, formula: rejeterFormula } },
  ];
}

/** Numeric ID_SCOPUS of a record ('' when empty, 0 or an explicit text such as « absent »). */
// scopusIdOf / scopusMarkedAbsent: scripts/lib/align_targets.cjs (shared with the run estimate).

function buildReviewRows(cache, all, rejected) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const desired = new Map();
  const row = (p, entry, nb, c) => ({
    uid_dyna: p.key, Annuaire_id: p.recId, Nom_annuaire: entry.queryName || `${p.first} ${p.last}`.trim(), LABO: p.labo || '',
    Nb_candidats: nb, Scopus_candidat: c.id, Nom_profil: c.fullName || '', Autres_noms: (c.forms || []).slice(1).join(' | '),
    Score: c.score, Preuves: (c.evidence || []).join(' ; '), Affiliation: c.affiliation || '', Affiliations_historique: (c.history || []).join(' ; '),
    Nb_documents: c.docCount || 0, Domaines: (c.subjects || []).join(' ; '), ORCID_candidat: c.orcid || '',
  });
  let found = 0, ambiguous = 0;
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.mode !== 'search') continue;
    const p = byKey.get(key);
    if (!p || scopusIdOf(p) || scopusMarkedAbsent(p)) continue;
    const cands = (entry.candidates || []).filter((c) => !rejected.has(`${key}::${c.id}`));
    if (!cands.length) continue;
    if (entry.status === 'found' && cands.some((c) => c.id === entry.best)) {
      const c = cands.find((x) => x.id === entry.best);
      desired.set(`${key}::${c.id}`, row(p, entry, 1, c));
      found++;
    } else {
      const top = cands.slice(0, MAX_PUSHED_CANDIDATES);
      for (const c of top) desired.set(`${key}::${c.id}`, row(p, entry, top.length, c));
      ambiguous++;
    }
  }
  return { desired, found, ambiguous };
}

module.exports = { toCandidate, bestNameMatch, orgMatches, scoreCandidate, buildReviewRows, buildScopusReviewColumns, scopusIdOf, scopusMarkedAbsent, SITE_PATTERNS, NU_AFFILIATION_ID };

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cache = loadCache();
  console.log(`[scopus] mode=${MODE} concurrency=${CONCURRENCY} enrich=${MAX_ENRICH}${PUSH_GRIST ? '' : ' (dry-run: no Grist write)'}`);
  if (!API_KEY && MODE !== 'push') throw new Error('SCOPUS_API_KEY is not set (see druid.yaml / .env)');

  const all = await common.fetchAnnuaire();
  // The review table must exist before the UI blacklist writes (« Mauvais candidat »).
  if (PUSH_GRIST && await ensureReviewTable(REVIEW_TABLE, buildScopusReviewColumns())) console.log(`[scopus] review table ${REVIEW_TABLE} created`);
  const labNames = await loadLabNames();
  const affils = MODE === 'push' ? new Map() : await loadAffiliations();
  const markedAbsent = MODE === 'push' ? 0 : all.filter((p) => (p.first || p.last) && scopusMarkedAbsent(p)).length;
  const sel = MODE === 'push' ? { eligible: [], targets: [] } : selectTargets('scopus', all, cache, { mode: MODE, labo: LABO_FILTER, group: GROUP_FILTER, force: FORCE, limit: LIMIT });
  let targets = sel.targets;
  const eligible = sel.eligible.length;

  console.log(`[scopus] ${all.length} Annuaire records, ${eligible} eligible (${MODE}${LABO_FILTER ? `, labo ${LABO_FILTER}` : ''}${GROUP_FILTER ? `, group ${GROUP_FILTER}` : ''}), ${targets.length} to process${FORCE ? ' (force)' : ''}${MODE === 'search' && markedAbsent ? `, ${markedAbsent} marked absent by hand (skipped)` : ''}.`);
  const counts = { found: 0, ambiguous: 0, not_found: 0, error: 0, checked: 0, not_found_scopus: 0, invalid: 0, nameMismatch: 0, sansAffiliation: 0, merged: 0 };
  const progress = (extra = {}) => ({ running: true, mode: MODE, total: targets.length, done: 0, ...counts, startedAt: today(), quota: QUOTA, ...extra });
  writeProgress(progress());

  const record = (p, entry) => {
    cache[p.key] = entry;
    if (counts[entry.status] !== undefined) counts[entry.status]++;
    if (entry.nameMismatch) counts.nameMismatch++;
    if (entry.affiliation === 'aucune') counts.sansAffiliation++;
    if (entry.merged) counts.merged++;
  };
  let done = 0;
  let skipped = 0;
  const tick = (n) => {
    done = n;
    if (n % 10 === 0 || n === targets.length) {
      writeProgress(progress({ done: n }));
      console.log(`[scopus] ${n}/${targets.length}${elsevier.aborted() ? ' (stopping)' : ''}`);
    }
  };
  if (MODE === 'verify') {
    const batches = [];
    for (let i = 0; i < targets.length; i += VERIFY_BATCH) batches.push(targets.slice(i, i + VERIFY_BATCH));
    let n = 0;
    await runPool(batches, async (batch) => {
      if (elsevier.aborted()) { skipped += batch.length; n += batch.length; tick(n); return; }
      const res = await verifyBatch(batch, labNames, affils);
      for (const p of batch) { const e = res.get(p.key); if (e && !(e.status === 'error' && elsevier.aborted())) record(p, e); else skipped++; }
      n += batch.length; tick(n);
    }, CONCURRENCY, undefined, { stoppable: true });
  } else if (MODE === 'search') {
    await runPool(targets, async (p) => {
      if (elsevier.aborted()) { skipped++; return; }
      const entry = await alignPerson(p, labNames, affils);
      // Aborted mid-record (quota): nothing cached, the next run picks it up again.
      if (elsevier.aborted() && entry.status === 'error') { skipped++; return; }
      record(p, entry);
    }, CONCURRENCY, tick, { stoppable: true });
  }
  writeCache(cache);

  let push = null;
  // Push into Alignement_Scopus only on explicit request (push mode): validation is done in Druid,
  // the table only serves as a blacklist (« Rejeté » / « Identité mêlée ») — decision of 2026-09-21,
  // see docs/plan-alignement-unifie.md lot 6.
  if (MODE === 'push') {
    const rejected = await loadRejected(REVIEW_TABLE, 'Scopus_candidat', digits);
    const { desired, found, ambiguous } = buildReviewRows(cache, all, rejected);
    console.log(`[scopus] Suggestions: ${found} found, ${ambiguous} ambiguous → ${desired.size} review row(s) (${rejected.size} known rejections).`);
    if (PUSH_GRIST) {
      try {
        push = await pushReview({
          table: REVIEW_TABLE, columns: buildScopusReviewColumns(), desired, targetField: TARGET,
          keyOf: (rec) => `${rec.fields.uid_dyna || ''}::${digits(rec.fields.Scopus_candidat)}`,
        });
        console.log(`[scopus] Grist review: +${push.created} created, ${push.refreshed} refreshed, ${push.skipped} already decided, ${push.purged} purged${push.tableCreated ? ' (table created)' : ''}.`);
      } catch (e) {
        console.error('[scopus] Grist push ERROR (local cache kept)', e);
        push = { error: e.message };
      }
    }
  }

  const warning = elsevier.aborted() ? `Run Scopus interrompu : ${elsevier.aborted()}${skipped ? ` — ${skipped} fiche(s) non traitée(s), reprises au prochain run` : ''}` : undefined;
  writeProgress({ running: false, mode: MODE, total: targets.length, done, ...counts, skipped, push, quota: QUOTA, ...(warning ? { warning } : {}), finishedAt: new Date().toISOString() });
  console.log(`[scopus] Done. ${JSON.stringify(counts)}${skipped ? `, skipped=${skipped}` : ''}. Quota: ${JSON.stringify(QUOTA)}. Cache: ${store.cachePath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[scopus] ERROR', e);
    writeProgress({ running: false, mode: MODE, error: e.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });
}
