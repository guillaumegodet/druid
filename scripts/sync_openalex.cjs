/**
 * sync_openalex.cjs — Alignment of Annuaire records with OpenAlex author profiles (A-ids).
 *
 * Goal: maintain `OpenAlex_ids`, the REVIEWED list of OpenAlex author profiles of a record
 * (A-ids separated by `|`), exported as is in the `openalex` column of people.csv.
 * Plan : docs/archive/plan-alignement-openalex.md. Socle : scripts/lib/align_common.cjs.
 * What differs from the IdRef / ORCID / HAL alignments:
 * - multi-valued: main profile + fragments (secondary profiles created by OpenAlex);
 * - unstable: a validated A-id can be merged or vanish → periodic `verify` mode;
 * - harvesting identifier, not an authority: never a pivot, never entered manually.
 *
 * API (OPENALEX_API_KEY key as `api_key` parameter, direct access from the container — acceptance test of 2026-09-11):
 * GET /authors?filter=orcid:<ORCID>                       → 0 or 1 profile carrying the ORCID (pass 0)
 * GET /authors?filter=ids.openalex:A1|A2                   → profiles by identifiers (A-ids seen in the IKG)
 * GET /authors?search=<first name last name>&filter=affiliations.institution.lineage:I97188460|I100445878
 * → homonyms affiliated with the Nantes site (25 max)
 * GET /authors/<A-id> (redirect: manual)                   → 200 profile; 301/302 → merged into Location;
 * 404 → gone (old A2… ids answer 404, no redirect)
 * GET /works?filter=author.id:<A>&select=id,doi&cursor=*   → DOIs of a candidate (1 page × 200, quota)
 * Cross signals:
 * Neo4j IKG (HTTP, ikg network): A-ids of the OpenAlex SourcePersons linked to the person (directly or through
 * CONTEXTUAL_EQUIVALENT) = « A-id already contributor of a reference attached to the record »; DOIs of the
 * SourceRecords harvested for the person outside OpenAlex (reference corpus).
 * HAL (FortiGate proxy): DOIs by authIdHal_i, as a fallback when the IKG has nothing.
 *
 * Modes (--mode=) :
 * search (default): records WITHOUT OpenAlex_ids (departures excluded). Pass 0 by ORCID → if the profile carries the right
 * name, DIRECT WRITE (deterministic, traced OpenAlex_*); IKG A-ids; search by name +
 * affiliation; strong/medium/weak scoring (§1 of the plan); every strong + medium candidate is pushed
 * to the Grist table `Alignement_OpenAlex` (Valider = ADDITION to the list, no conflict).
 * verify          : records WITH OpenAlex_ids. Each A-id: ok / merged (→ direct replacement) / gone
 * (→ direct removal, confirmed by a 2nd request); direct addition of the ORCID profile if missing;
 * diverging name reported; NEW FRAGMENTS (candidates missing from the list) → review.
 * push            : no API call — pushes the cached suggestions again to the review table.
 *
 * Options: `--mode= --limit= --labo= --group=personnel|doctorants|hors_recherche --concurrency=(3) --incremental`
 * --push-grist=false (dry run: neither review table nor Annuaire write)
 * --force (reprocesses records already cached, --labo included)
 * --no-key (OPENALEX_MAILTO polite pool instead of the OPENALEX_API_KEY key, the default)
 * Cache: openalex_align_cache.json (key = uid_dyna, or g<rowId>), progress: openalex_align_progress.json.
 */
const common = require('./lib/align_common.cjs');
const {
  normalize, nameMatch, extractOrcid, getUrl, runPool, makeStore, today,
  gristRecords, gristPatchGrouped, gristPatchRecords, withTrace, loadRejected, loadReviewDecisions, pushReview, DOC,
  heterogeneousFirstNames, DECISION_MIXED, DECISION_TODO,
} = common;
const { selectTargets, extractAId, parseIds } = require('./lib/align_targets.cjs');

// ── Parameters ───────────────────────────────────────────────────────────────
const OPTS = common.commonOptions({ modes: ['search', 'verify', 'push'], concurrency: 3 });
const { mode: MODE, limit: LIMIT, labo: LABO_FILTER, group: GROUP_FILTER, concurrency: CONCURRENCY, pushGrist: PUSH_GRIST } = OPTS;
// Incremental by default, --labo included (decision D2 of 2026-09-30): only records never seen or in
// error; --force reprocesses the cached ones too. --incremental is kept as an explicit no-op override.
const FORCE = common.hasFlag('incremental') ? false : OPTS.force;
// OpenAlex rate limit: 10 requests/s across all keys → at most one request every 130 ms
// (~7.7/s); without this limiter, concurrency 4 → burst of 429s (LS2N run of 2026-09-11).
const OA_MIN_INTERVAL_MS = 130;
let oaNextSlot = 0;
async function oaThrottle() {
  const now = Date.now();
  const slot = Math.max(now, oaNextSlot);
  oaNextSlot = slot + OA_MIN_INTERVAL_MS;
  if (slot > now) await new Promise((res) => setTimeout(res, slot - now));
}
const OA = 'https://api.openalex.org';
// OpenAlex quotas (observed on 2026-09-11, x-ratelimit-* headers): the institution's OPENALEX_API_KEY
// has a DAILY BUDGET of $1 ≈ 10,000 requests (reset at midnight UTC), shared with
// the harvester and the druid-biblio ETL — exhausted by a single LS2N run; the « polite pool » (mailto parameter,
// no key) is limited to 1,000 requests/day. Since the switch to the institution key (200,000 req/day,
// afternoon of 2026-09-11), the KEY IS THE DEFAULT; --no-key (or OPENALEX_ALIGN_USE_KEY=false) forces the polite
// pool; if the key is dry (429 with a long Retry-After), automatic fallback to the polite pool.
// Order of magnitude: 3 to 8 requests per record → a lab of 500 records ≈ 2,000 to 4,000 requests.
// Network: api.openalex.org is reached DIRECTLY (not via the FortiGate proxy, which returns spurious 429s
// with a one-day Retry-After while direct access — same public IP — answers 200).
process.env.NO_PROXY = [process.env.NO_PROXY || '', 'api.openalex.org'].filter(Boolean).join(',');
const API_KEY = process.env.OPENALEX_API_KEY || '';
const MAILTO = process.env.OPENALEX_MAILTO || '';
let USE_KEY = !!API_KEY && !common.hasFlag('no-key') && !/^(0|false|no)$/i.test(process.env.OPENALEX_ALIGN_USE_KEY || '');
function dropKey(reason) {
  if (!USE_KEY) return false;
  USE_KEY = false;
  console.error(`[openalex] OpenAlex key set aside (${reason}) → polite pool${MAILTO ? ` (mailto ${MAILTO})` : ' WITHOUT mailto: reduced rate'}`);
  return true;
}
// Quota exhausted with no fallback possible (429 with a long Retry-After on the polite pool): stop the run rather
// than chain hundreds of « error » records (the next run, --incremental, resumes where we were).
let ABORT = null;
function abortRun(reason) {
  if (!ABORT) { ABORT = reason; console.error(`[openalex] run STOPPED: ${reason}`); }
}
const REVIEW_TABLE = 'Alignement_OpenAlex';
const SOURCE = 'OpenAlex';                              // Data_source label / OpenAlex_* columns
const TARGET = 'OpenAlex_ids';
const SITE_LINEAGE = ['I97188460', 'I100445878'];       // Nantes Université, École Centrale de Nantes
const SITE_PATTERNS = ['nantes', 'imt atlantique', 'oniris', 'ifremer', 'institut de cancerologie de l ouest'];
const STRONG_SHARED_DOIS = 2;                            // ≥ 2 shared DOIs (exact name) = strong; 1 = medium
const MAX_WEAK = 5;                                      // cap on kept weak candidates
const MAX_PUSHED = 5;                                    // review rows per record
const MAX_WORKS_CANDIDATES = 5;                          // candidates whose DOIs are loaded (quota!)
const MAX_WORKS_PAGES = 1;                               // 1 × 200 works per candidate (quota: the most expensive item)
const NEO4J_URL = process.env.NEO4J_HTTP_URL || 'http://localhost:7474';
// No default password: NEO4J_PASSWORD comes from the environment (druid.yaml). Without it the graph
// answers 401 and the graph signals are skipped.
if (!process.env.NEO4J_PASSWORD) console.warn('[neo4j] NEO4J_PASSWORD is not set: the CRISalid graph will refuse the queries');
const NEO4J_AUTH = 'Basic ' + Buffer.from(`${process.env.NEO4J_USER || 'neo4j'}:${process.env.NEO4J_PASSWORD || ''}`).toString('base64');
const AUTHOR_SELECT = 'id,display_name,display_name_alternatives,works_count,orcid,affiliations';

const store = makeStore({ cachePath: 'openalex_align_cache.json', progressPath: 'openalex_align_progress.json' });
/** `key::A-id` pairs flagged « Identité mêlée » in the review table (loaded by main, read by verifyPerson). */
const MIXED_KEYS = new Set();
const { loadCache, writeCache, writeProgress } = store;

// ── Helpers identifiants ─────────────────────────────────────────────────────
/** "https://openalex.org/A5038332349", " a5038332349 " → "A5038332349". */
// extractAId / parseIds: scripts/lib/align_targets.cjs (shared with the run estimate of the launch window).
const joinIds = (ids) => ids.join('|');
const instId = (v) => { const m = String(v || '').match(/(I\d+)/); return m ? m[1] : ''; };
const rorId = (v) => String(v || '').trim().replace(/^https?:\/\/ror\.org\//, '').toLowerCase();
const normDoi = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');

// ── Client OpenAlex ──────────────────────────────────────────────────────────
function oaUrl(path, params = {}) {
  const u = new URL(`${OA}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  if (USE_KEY) u.searchParams.set('api_key', API_KEY);
  else if (MAILTO) u.searchParams.set('mailto', MAILTO);
  return u.toString();
}
/** GET JSON; null = network/HTTP error (distinct from « 0 result »); { notFound: true } = 404. */
async function oaGet(path, params) {
  for (let pass = 0; pass < 2; pass++) {
    await oaThrottle();
    try {
      return await getUrl(oaUrl(path, params), { json: true, timeout: 20000, tries: 5, delay: 500 });
    } catch (e) {
      if (/HTTP 404/.test(e.message)) return { notFound: true };
      if (e.retryAfter) {
        if (dropKey(`429, retry-after ${Math.round(e.retryAfter)}s`)) continue;   // key budget exhausted → 2nd pass without key
        abortRun(`OpenAlex 429, retry-after ${Math.round(e.retryAfter)}s (${USE_KEY ? 'clé' : 'polite pool'})`);
      }
      return null;
    }
  }
  return null;
}
/** Common projection of an OpenAlex author profile. */
function toAuthor(a) {
  const affiliations = (a.affiliations || []).map((x) => ({
    id: instId(x.institution?.id), name: x.institution?.display_name || '', ror: rorId(x.institution?.ror),
    country: x.institution?.country_code || '', type: x.institution?.type || '', lineage: (x.institution?.lineage || []).map(instId).filter(Boolean), years: x.years || [],
  }));
  return {
    id: extractAId(a.id), fullName: a.display_name || '', forms: a.display_name_alternatives || [],
    worksCount: a.works_count || 0, orcid: extractOrcid(a.orcid), affiliations,
  };
}
const results = (d) => (d && !d.notFound ? (d.results || []).map(toAuthor) : []);

async function authorByOrcid(orcid) {
  const d = await oaGet('/authors', { filter: `orcid:${orcid}`, select: AUTHOR_SELECT, 'per-page': 5 });
  return d ? results(d) : null;
}
async function authorsByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await oaGet('/authors', { filter: `ids.openalex:${ids.slice(i, i + 50).join('|')}`, select: AUTHOR_SELECT, 'per-page': 50 });
    if (!d) return null;
    out.push(...results(d));
  }
  return out;
}
/** Homonyms affiliated with the site (Nantes Université / Centrale lineage). `search` is tolerant, local name filtering. */
async function searchByName(firstName, lastName) {
  const q = normalize(`${firstName} ${lastName}`);
  if (!q) return [];
  const d = await oaGet('/authors', { search: q, filter: `affiliations.institution.lineage:${SITE_LINEAGE.join('|')}`, select: AUTHOR_SELECT, 'per-page': 25 });
  return d ? results(d) : null;
}
/** DOIs (normalized) of a candidate's works, capped at MAX_WORKS_PAGES pages. null = error from the 1st page. */
async function authorDois(id) {
  const dois = new Set();
  let cursor = '*';
  for (let page = 0; page < MAX_WORKS_PAGES && cursor; page++) {
    const d = await oaGet('/works', { filter: `author.id:${id}`, select: 'id,doi', 'per-page': 200, cursor });
    if (!d || d.notFound) return page === 0 ? null : dois;
    for (const w of d.results || []) { const doi = normDoi(w.doi); if (doi) dois.add(doi); }
    cursor = d.meta?.next_cursor || '';
  }
  return dois;
}
/**
 * Resolution of an A-id (verify mode): { status: 'ok', author } | { status: 'merged', into, author? } |
 * { status: 'gone' } | null (network error after retries). Redirects followed by hand: a merged profile
 * must return 301 to the target (OpenAlex doc); a vanished id (or an old A2…) returns 404.
 */
async function resolveAuthor(id) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await oaThrottle();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(oaUrl(`/authors/${id}`, { select: AUTHOR_SELECT }), { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'Druid-CRISalid/1.0' } });
      clearTimeout(t);
      if (r.status === 429) {
        const ra = parseFloat(r.headers.get('retry-after') || '0') || 0;
        if (ra > 30) { if (dropKey(`429, retry-after ${Math.round(ra)}s`)) continue; abortRun(`OpenAlex 429, retry-after ${Math.round(ra)}s`); return null; }
        await new Promise((res) => setTimeout(res, Math.max(ra * 1000, 2000) * (attempt + 1)));
        continue;
      }
      if (r.status === 200) {
        const a = toAuthor(await r.json());
        return a.id && a.id !== id ? { status: 'merged', into: a.id, author: a } : { status: 'ok', author: a };
      }
      if ([301, 302, 307, 308].includes(r.status)) {
        const into = extractAId(String(r.headers.get('location') || '').split('/').pop());
        return into ? { status: 'merged', into } : { status: 'gone' };
      }
      if (r.status === 404) {
        // Confirmation through the filter (an isolated 404 could be an incident on the API side).
        const d = await oaGet('/authors', { filter: `ids.openalex:${id}`, select: 'id', 'per-page': 1 });
        if (d && !d.notFound && (d.results || []).length) return { status: 'ok', author: toAuthor(d.results[0]) };
        return { status: 'gone' };
      }
      // 429 / 5xx → nouvel essai
    } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
  }
  return null;
}

// ── Cross signals: IKG (Neo4j) and HAL ───────────────────────────────────────
let IKG_DOWN = false;
async function cypher(statement, parameters) {
  if (IKG_DOWN) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`${NEO4J_URL}/db/neo4j/tx/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: NEO4J_AUTH },
      body: JSON.stringify({ statements: [{ statement, parameters }] }), signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = await r.json();
    if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
    return (j.results?.[0]?.data || []).map((d) => d.row);
  } catch (e) {
    if (!IKG_DOWN) console.error('[openalex] IKG (Neo4j) unavailable — IKG signals ignored:', e.message);
    IKG_DOWN = true;
    return null;
  }
}
/**
 * A-ids already seen on the person's references (OpenAlex SourcePersons linked directly or by
 * contextual equivalence, weighted by the number of paths = references) and DOIs of their corpus
 * harvested outside OpenAlex (reference corpus for the overlap).
 */
async function ikgSignals(uid) {
  if (!uid) return { available: false, ids: [], dois: [] };
  const key = `local-${uid}`;
  const ids = await cypher(
    'MATCH (p:Person {uid:$uid})-[:RECORDED_BY]-(sp:SourcePerson) ' +
    'MATCH (sp)-[:CONTEXTUAL_EQUIVALENT*0..1]-(sp2:SourcePerson)-[:HAS_IDENTIFIER]->(i:SourcePersonIdentifier {type:\'openalex\'}) ' +
    'RETURN i.value AS id, count(*) AS n ORDER BY n DESC', { uid: key });
  const dois = await cypher(
    'MATCH (p:Person {uid:$uid})<-[:HARVESTED_FOR]-(r:SourceRecord)-[:HAS_IDENTIFIER]->(i:PublicationIdentifier {type:\'doi\'}) ' +
    'WHERE r.harvester <> \'openalex\' RETURN collect(DISTINCT i.value) AS dois', { uid: key });
  if (ids === null && dois === null) return { available: false, ids: [], dois: [] };
  return {
    available: true,
    ids: (ids || []).map(([id, n]) => ({ id: extractAId(id), n })).filter((x) => x.id),
    dois: ((dois && dois[0] && dois[0][0]) || []).map(normDoi).filter(Boolean),
  };
}
/** HAL DOIs of a record by authIdHal_i (fallback when the IKG has nothing). null = error. */
async function halDois(idhalI) {
  const n = parseInt(idhalI, 10);
  if (!n) return [];
  try {
    const j = await getUrl(`https://api.archives-ouvertes.fr/search/?q=authIdHal_i:${n}&fl=doiId_s&rows=1000&wt=json`, { json: true, timeout: 20000 });
    return (j?.response?.docs || []).map((d) => normDoi(d.doiId_s)).filter(Boolean);
  } catch (e) { return null; }
}

// ── Labs (Structures table): acronym → labels + ROR, to recognize affiliations ──
const stripLang = (v) => String(v || '').split('|').map((x) => x.replace(/\[[a-z]{2}\]\s*$/i, '').trim()).filter(Boolean);
async function loadLabs() {
  const labs = new Map();
  try {
    const records = await gristRecords('Structures');
    for (const r of records || []) {
      const f = r.fields || {};
      const sigles = stripLang(f.short_labels);
      const names = [...sigles, ...stripLang(f.long_labels)].map(normalize).filter((x) => x.length > 2);
      for (const s of sigles) labs.set(normalize(s), { sigle: s, names, ror: rorId(f.ror) });
    }
  } catch (e) { console.error('[openalex] Structures table unreadable (lab affiliations ignored):', e.message); }
  return labs;
}

// ── Scoring ──────────────────────────────────────────────────────────────────
/** Best name match between the record and display_name / display_name_alternatives. */
function bestNameMatch(p, cand) {
  let best = null;
  for (const f of [cand.fullName, ...(cand.forms || [])]) {
    const m = nameMatch(p.first, p.last, f);
    if (m === 'exact') return 'exact';
    if (m === 'partial') best = 'partial';
  }
  return best;
}
const years = (a) => { const y = (a.years || []).filter(Boolean).sort(); return y.length ? (y.length > 1 ? `${y[0]}–${y[y.length - 1]}` : String(y[0])) : '?'; };
/**
 * Incompatible affiliations (§ 8.2): two institutions from different countries active over ≥ 5 shared years,
 * or more than 10 distinct institutions. Returns the reason or null.
 */
function affiliationsIncompatible(affs) {
  // OpenAlex affiliations list every institution of the coauthors over the career (25 to 35 for a
  // senior): the count says nothing. Only a lasting double affiliation in two countries matters: two
  // academic institutions (OpenAlex « company »/« other » are often false name matches:
  // Vivant, Quartz Corp…) from different countries, ≥ 8 years each, with ≥ 8 shared years.
  const list = (affs || []).filter((a) => a.id && a.country && !['company', 'other'].includes(a.type) && (a.years || []).length >= 8).slice(0, 40);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.country === b.country) continue;
      const common = a.years.filter((y) => b.years.includes(y));
      if (common.length >= 8) return `${a.name} (${a.country}) et ${b.name} (${b.country}) sur ${common.length} années communes`;
    }
  }
  return null;
}
/** Reasons to suspect a mixed identity for a profile (signal, never a decision). */
function suspicionOf(p, cand, { matchedIds = [], nameMatch: name = null } = {}) {
  const suspect = [];
  if (matchedIds.length && !name) suspect.push('signal fort mais nom divergent');
  const het = heterogeneousFirstNames(p.last, [cand.fullName, ...(cand.forms || [])], p.first);
  if (het) suspect.push(`prénoms hétérogènes dans les formes (« ${het[0]} » / « ${het[1]} »)`);
  const inc = affiliationsIncompatible(cand.affiliations);
  if (inc) suspect.push(`affiliations incompatibles : ${inc}`);
  return suspect;
}
/**
 * Scoring of a candidate for a record (§1 of the plan):
 * strong = profile carrying the record's ORCID; A-id seen on its IKG references; ≥ 2 shared DOIs (exact name);
 *            choix manuel `openalex_author_id` ;
 * medium = 1 shared DOI, or affiliation with the record's lab, with matching name; or strong signal but diverging name;
 * weak   = homonym affiliated with the Nantes site without other evidence (MAX_WEAK cap, sorted by works_count).
 */
function scoreCandidate(p, cand, ctx) {
  const evidence = [];
  const matchedIds = [];
  const name = bestNameMatch(p, cand);
  if (ctx.orcid && cand.orcid === ctx.orcid) { matchedIds.push('ORCID'); evidence.push(`ORCID identique (${ctx.orcid})`); }
  const ikg = ctx.ikgIds.get(cand.id);
  if (ikg) { matchedIds.push('IKG'); evidence.push(`contributeur de ${ikg} référence${ikg > 1 ? 's' : ''} de la fiche (IKG)`); }
  if (ctx.manualId && ctx.manualId === cand.id) { matchedIds.push('openalex_author_id'); evidence.push('choisi manuellement (openalex_author_id)'); }
  let shared = 0;
  if (ctx.candDois && ctx.refDois.size) {
    for (const d of ctx.candDois) if (ctx.refDois.has(d)) shared++;
    if (shared) evidence.push(`${shared} DOI${shared > 1 ? 's' : ''} commun${shared > 1 ? 's' : ''} avec ${ctx.refSource} (${ctx.refDois.size} DOIs de référence)`);
  }
  if (shared >= STRONG_SHARED_DOIS && name === 'exact') matchedIds.push('DOI');

  // Affiliations: the record's lab (ROR or label from the Structures table) = medium; the Nantes site alone
  // = weak (the name search is already restricted to the site: this is the case of every homonym).
  const lab = ctx.lab;
  const affLabo = lab ? cand.affiliations.find((a) => (lab.ror && a.ror === lab.ror) || lab.names.some((n) => normalize(a.name) === n)) : null;
  if (affLabo) evidence.push(`affiliation ${affLabo.name} (${years(affLabo)})`);
  const affSite = cand.affiliations.find((a) => a.lineage.some((l) => SITE_LINEAGE.includes(l)) || SITE_PATTERNS.some((pat) => normalize(a.name).includes(pat)));
  if (affSite && !affLabo) evidence.push(`affiliation ${affSite.name} (${years(affSite)})`);
  if (cand.worksCount) evidence.push(`${cand.worksCount} work${cand.worksCount > 1 ? 's' : ''}`);
  if (name === 'partial') evidence.push('nom partiel');
  if (!name) evidence.push('nom divergent');

  let score = 'faible';
  if (matchedIds.length) score = name ? 'fort' : 'moyen';
  else if ((shared >= 1 || affLabo) && name) score = 'moyen';
  // Suspected mixed identity (§ 8.2): capped at « medium » → never a direct write, always the review.
  const suspect = suspicionOf(p, cand, { matchedIds, nameMatch: name });
  if (suspect.length) { evidence.unshift(`⚠ identité mêlée suspectée : ${suspect.join(' ; ')}`); if (score === 'fort') score = 'moyen'; }
  return { score, evidence, matchedIds, nameMatch: name, sharedDois: shared, suspect };
}
const RANK = { fort: 0, moyen: 1, faible: 2 };

/**
 * Search + scoring of a record's profiles, excluding those already in `existing` (current list, empty in
 * search, resolved list in verify → fragments). Returns the cache entry (search mode).
 */
async function alignPerson(p, labs, existing = parseIds(p.openalexIds), orcidAuthors = undefined) {
  const queryName = `${p.first} ${p.last}`.trim();
  const orcid = extractOrcid(p.orcid);
  const manualId = extractAId(p.openalexManual);
  const derivedFrom = [];
  let netError = false;
  const byId = new Map();
  const origins = new Map();
  const add = (a, origin) => {
    if (!a || !a.id) return;
    if (!byId.has(a.id)) byId.set(a.id, a);
    if (!origins.has(a.id)) origins.set(a.id, []);
    if (!origins.get(a.id).includes(origin)) origins.get(a.id).push(origin);
  };

  // Pass 0: profile carrying the ORCID. `orcidAuthors` lets verifyPerson reuse its own
  // call (same orcid) instead of repeating an identical one here (review lot 4, finding 2).
  if (orcid) {
    const r = orcidAuthors !== undefined ? orcidAuthors : await authorByOrcid(orcid);
    if (r === null) netError = true;
    else { if (r.length) derivedFrom.push('ORCID'); for (const a of r) add(a, 'ORCID'); }
  }
  // A-ids already seen in the IKG (+ reference DOI corpus).
  const ikg = await ikgSignals(p.uid);
  const ikgIds = new Map(ikg.ids.map((x) => [x.id, x.n]));
  const toFetch = [...ikgIds.keys()].filter((id) => !byId.has(id) && !existing.includes(id));
  if (manualId && !byId.has(manualId) && !existing.includes(manualId) && !toFetch.includes(manualId)) toFetch.push(manualId);
  if (toFetch.length) {
    const r = await authorsByIds(toFetch);
    if (r === null) netError = true;
    else {
      for (const a of r) add(a, ikgIds.has(a.id) ? 'IKG' : 'manuel');
      if (r.some((a) => ikgIds.has(a.id))) derivedFrom.push('IKG');
    }
  }
  // Search by name + site affiliation (local name filter).
  const byName = await searchByName(p.first, p.last);
  if (byName === null) netError = true;
  else for (const a of byName) if (bestNameMatch(p, a)) add(a, 'nom');

  // Reference corpus for the DOI overlap: IKG, otherwise HAL.
  let refDois = new Set(ikg.dois);
  let refSource = refDois.size ? 'IKG' : '';
  if (!refDois.size && p.idhalI) {
    const h = await halDois(p.idhalI);
    if (h === null) netError = true;
    else if (h.length) { refDois = new Set(h); refSource = 'HAL'; }
  }

  const cands = [...byId.values()].filter((a) => !existing.includes(a.id));
  const lab = labs.get(normalize(p.labo)) || null;
  const scored = [];
  let nWorks = 0;
  for (const cand of cands) {
    let candDois;
    const alreadyStrong = (orcid && cand.orcid === orcid) || ikgIds.has(cand.id);
    if (refDois.size && !alreadyStrong && nWorks < MAX_WORKS_CANDIDATES) {
      nWorks++;
      candDois = await authorDois(cand.id);
      if (candDois === null) { candDois = undefined; netError = true; }
    }
    const s = scoreCandidate(p, cand, { orcid, ikgIds, manualId, refDois, refSource, candDois, lab });
    scored.push({
      id: cand.id, fullName: cand.fullName, forms: (cand.forms || []).slice(0, 12), worksCount: cand.worksCount, orcid: cand.orcid,
      affiliations: cand.affiliations.slice(0, 6).map((a) => `${a.name} (${years(a)})`),
      origins: origins.get(cand.id) || [], ikgRefs: ikgIds.get(cand.id) || 0, sharedDois: s.sharedDois,
      doisChecked: candDois !== undefined, score: s.score, evidence: s.evidence, matchedIds: s.matchedIds, nameMatch: s.nameMatch, suspect: s.suspect,
    });
  }
  scored.sort((a, b) => RANK[a.score] - RANK[b.score] || (b.worksCount || 0) - (a.worksCount || 0));
  const weak = scored.filter((c) => c.score === 'faible');
  const kept = weak.length > MAX_WEAK ? [...scored.filter((c) => c.score !== 'faible'), ...weak.slice(0, MAX_WEAK)] : scored;

  const strong = kept.filter((c) => c.score === 'fort');
  let status;
  if (!kept.length) status = netError ? 'error' : 'not_found';
  else if (strong.length) status = 'found';
  else status = 'ambiguous';
  // Direct write (search): profile carrying the ORCID AND matching name — deterministic.
  const direct = strong.filter((c) => c.matchedIds.includes('ORCID') && c.nameMatch).map((c) => c.id);
  return {
    mode: 'search', queryName, status, best: strong.map((c) => c.id), direct, derivedFrom,
    ikg: ikg.available, refSource, refDois: refDois.size, netError, candidates: kept, checkedAt: today(),
  };
}

/** Verification of a record with OpenAlex_ids: resolution, replacement/removal, missing ORCID profile, fragments. */
async function verifyPerson(p, labs) {
  const queryName = `${p.first} ${p.last}`.trim();
  const ids = parseIds(p.openalexIds);
  const orcid = extractOrcid(p.orcid);
  const resolved = [];
  let netError = false;
  for (const id of ids) {
    const r = await resolveAuthor(id);
    if (!r) { netError = true; resolved.push({ id, status: 'error' }); continue; }
    if (r.status === 'gone') { resolved.push({ id, status: 'gone' }); continue; }
    if (r.status === 'merged') {
      let a = r.author;
      if (!a) {
        const rr = await authorsByIds([r.into]);
        if (rr === null) netError = true;   // network failure of the fallback: do not classify the merge as resolved
        else a = rr[0];
      }
      resolved.push({ id, status: 'merged', into: r.into, fullName: a?.fullName || '', worksCount: a?.worksCount || 0, nameMatch: a ? bestNameMatch(p, a) : null });
      continue;
    }
    const nm = bestNameMatch(p, r.author);
    resolved.push({ id, status: 'ok', fullName: r.author.fullName, worksCount: r.author.worksCount, orcid: r.author.orcid, nameMatch: nm, suspect: suspicionOf(p, r.author, { matchedIds: [], nameMatch: nm }) });
  }
  let next = [];
  const replaced = [];
  const removed = [];
  for (const r of resolved) {
    if (r.status === 'ok' || r.status === 'error') { if (!next.includes(r.id)) next.push(r.id); }
    else if (r.status === 'merged') { if (!next.includes(r.into)) next.push(r.into); replaced.push([r.id, r.into]); }
    else if (r.status === 'gone') removed.push(r.id);
  }
  // « Identité mêlée » decision in the review table → the A-id leaves the list (the decision drives the list, § 8.1).
  const removedMixed = next.filter((id) => MIXED_KEYS.has(`${p.key}::${id}`));
  next = next.filter((id) => !removedMixed.includes(id));
  // The profile carrying the ORCID (matching name) must be in the list — same deterministic rule as in search.
  const added = [];
  let orcidAuthors;
  if (orcid) {
    orcidAuthors = await authorByOrcid(orcid);
    if (orcidAuthors === null) netError = true;
    else for (const a of orcidAuthors) if (!next.includes(a.id) && bestNameMatch(p, a)) { next.push(a.id); added.push(a.id); }
  }
  // Fragments: same search as in search mode, excluding the resolved list. Reuses the ORCID call
  // above (otherwise alignPerson repeats the same authorByOrcid: review lot 4, finding 2).
  const frag = await alignPerson(p, labs, next, orcidAuthors);
  if (frag.netError) netError = true;
  const nameMismatch = resolved.some((r) => r.status === 'ok' && !r.nameMatch);
  // netError included: otherwise a merge whose network fallback failed (or the ORCID/fragments call) stays
  // « checked » and is never retried on the next incremental run (review lot 4, finding 1).
  const status = netError || (resolved.length && resolved.every((r) => r.status === 'error')) ? 'error' : 'checked';
  return {
    mode: 'verify', queryName, status, ids, next, resolved, replaced, removed, removedMixed, added,
    changed: !!(replaced.length || removed.length || removedMixed.length || added.length), nameMismatch,
    suspects: resolved.filter((r) => (r.suspect || []).length).map((r) => ({ id: r.id, fullName: r.fullName, reasons: r.suspect })),
    best: frag.best, derivedFrom: frag.derivedFrom, ikg: frag.ikg, refSource: frag.refSource, refDois: frag.refDois, netError,
    candidates: frag.candidates, checkedAt: today(),
  };
}

// ── Revue collaborative Grist (table Alignement_OpenAlex) ────────────────────
/** Review table columns + button formulas. Valider = ADDITION to the list (non-empty target ≠ conflict). */
function buildReviewColumns() {
  const validerFormula = [
    `if $Decision == "Validé":`,
    `  return {"button": "Validé ✓", "description": "Déjà appliqué%s" % ((" le " + $Date_application) if $Date_application else ""), "actions": []}`,
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `ann = Annuaire.lookupOne(id=$Annuaire_id) if $Annuaire_id else Annuaire.lookupOne(uid_dyna=$uid_dyna)`,
    `if not ann:`,
    `  return {"button": "Fiche introuvable", "description": "Aucune fiche Annuaire pour %s" % $uid_dyna, "actions": []}`,
    `import re`,
    `def _ids(v):`,
    `  out = []`,
    `  for x in re.split(r"[|,;\\s]+", str(v or "")):`,
    `    m = re.search(r"(A\\d{4,})", x, re.I)`,
    `    if m and m.group(1).upper() not in out: out.append(m.group(1).upper())`,
    `  return out`,
    `cur = _ids(ann.${TARGET})`,
    `cand = _ids($OpenAlex_candidat)`,
    `cand = cand[0] if cand else ""`,
    `if not cand:`,
    `  return {"button": "Candidat invalide", "description": "OpenAlex_candidat doit être un A-id", "actions": []}`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `actions = []`,
    `if cand in cur:`,
    `  label = "Valider (déjà présent)"`,
    `  new = cur`,
    `else:`,
    `  new = cur + [cand]`,
    `  fields = {"${TARGET}": "|".join(new)}`,
    `  src = str(ann.Data_source or "")`,
    `  parts = [s.strip().upper() for s in re.split(r"[|,]", src) if s.strip()]`,
    `  if "${SOURCE.toUpperCase()}" not in parts:`,
    `    fields["Data_source"] = (src + "|${SOURCE}") if src else "${SOURCE}"`,
    `  fields["${SOURCE}_derniere_maj"] = today`,
    `  fields["${SOURCE}_champs_modifies"] = "${TARGET}"`,
    `  note = "[%s] MAJ ${SOURCE} (revue Grist): ${TARGET} += %s" % (today, cand)`,
    `  com = str(ann.Commentaires or "")`,
    `  fields["Commentaires"] = (com + "\\n" + note) if com else note`,
    `  actions.append(["UpdateRecord", "Annuaire", ann.id, fields])`,
    `  label = "Ajouter " + cand`,
    `actions.append(["UpdateRecord", "${REVIEW_TABLE}", $id, {"Decision": "Validé", "Applique": True, "Date_application": today}])`,
    `# Pas d'auto-rejet des autres candidats : plusieurs profils peuvent être légitimes (fragments).`,
    `return {"button": label, "description": "%s -> ${TARGET} = %s" % ($Nom_annuaire, "|".join(new)), "actions": actions}`,
  ].join('\n');

  const rejeterFormula = [
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `return {"button": "Rejeter", "description": "Écarte ce profil pour %s (il ne sera plus reproposé)" % $Nom_annuaire, "actions": [["UpdateRecord", "${REVIEW_TABLE}", $id, {"Decision": "Rejeté", "Date_application": today}]]}`,
  ].join('\n');

  const text = (id, label) => ({ id, fields: { label, type: 'Text' } });
  return [
    text('uid_dyna', 'uid_dyna'),
    { id: 'Annuaire_id', fields: { label: 'Annuaire (ligne)', type: 'Int' } },
    text('Nom_annuaire', 'Nom annuaire'),
    text('LABO', 'LABO'),
    { id: 'Nb_candidats', fields: { label: 'Nb candidats', type: 'Int' } },
    text('OpenAlex_candidat', 'A-id candidat'),
    {
      id: 'Lien',
      fields: {
        label: 'Lien OpenAlex', type: 'Text', isFormula: true,
        formula: `"https://openalex.org/" + str($OpenAlex_candidat or "")`,
        widgetOptions: JSON.stringify({ widget: 'HyperLink' }),
      },
    },
    text('Nom_profil', 'Nom du profil'),
    text('Formes', 'Formes du nom'),
    { id: 'Nb_publications', fields: { label: 'Nb works', type: 'Int' } },
    text('Affiliations', 'Affiliations (années)'),
    text('ORCID_profil', 'ORCID du profil'),
    text('Score', 'Score'),
    text('Preuves', 'Preuves'),
    text('Deja_dans_annuaire', 'Déjà dans l\'Annuaire (OpenAlex_ids)'),
    text('Origine', 'Origine'),
    ...common.reviewDecisionColumns(REVIEW_TABLE),   // Decision (4 values), Note, Signale_le, Meler_action
    { id: 'Applique', fields: { label: 'Appliqué', type: 'Bool' } },
    text('Date_application', 'Date application'),
    text('Pousse_le', 'Poussé le'),
    { id: 'Valider_action', fields: { label: 'Valider (action)', type: 'Any', isFormula: true, formula: validerFormula } },
    { id: 'Rejeter_action', fields: { label: 'Rejeter (action)', type: 'Any', isFormula: true, formula: rejeterFormula } },
  ];
}

/**
 * Rows to push to review, from the search AND verify cache entries:
 * found → every strong then the medium ones (MAX_PUSHED cap); ambiguous → medium then weak (MAX_PUSHED).
 * Excluded: rejections, A-ids already in the record's list, A-ids written directly by this script.
 */
function buildReviewRows(cache, all, rejected) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const desired = new Map();
  const row = (p, entry, nb, c, existing) => ({
    uid_dyna: p.key, Annuaire_id: p.recId, Nom_annuaire: entry.queryName || `${p.first} ${p.last}`.trim(), LABO: p.labo || '',
    Nb_candidats: nb, OpenAlex_candidat: c.id, Nom_profil: c.fullName || '', Formes: (c.forms || []).slice(0, 8).join(' | '),
    Nb_publications: c.worksCount || 0, Affiliations: (c.affiliations || []).join(' ; '), ORCID_profil: c.orcid || '',
    Score: c.score, Preuves: (c.evidence || []).join(' ; '), Deja_dans_annuaire: joinIds(existing),
    Origine: entry.mode === 'verify' ? 'vérification (fragment)' : 'recherche',
  });
  let found = 0, ambiguous = 0;
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.mode !== 'search' && entry.mode !== 'verify') continue;
    const p = byKey.get(key);
    if (!p) continue;   // record gone
    const existing = parseIds(p.openalexIds);
    const written = new Set([...(entry.writtenIds || []), ...(entry.next || [])]);
    const cands = (entry.candidates || []).filter((c) => !rejected.has(`${key}::${c.id}`) && !existing.includes(c.id) && !written.has(c.id));
    if (!cands.length) continue;
    const strong = cands.filter((c) => c.score === 'fort');
    const top = strong.length
      ? [...strong, ...cands.filter((c) => c.score === 'moyen')].slice(0, Math.max(MAX_PUSHED, strong.length))
      : cands.slice(0, MAX_PUSHED);
    for (const c of top) desired.set(`${key}::${c.id}`, row(p, entry, top.length, c, existing));
    if (strong.length) found++; else ambiguous++;
  }
  return { desired, found, ambiguous };
}

// ── Direct Annuaire writes ───────────────────────────────────────────────────
/** search: profile carrying the ORCID (matching name) → OpenAlex_ids, if the target is still empty. */
async function applyDirectWrites(cache, all) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const updates = [];
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.mode !== 'search' || !(entry.direct || []).length || entry.written) continue;
    const p = byKey.get(key);
    if (!p || parseIds(p.openalexIds).length) continue;
    updates.push({ key, recId: p.recId, ids: entry.direct });
  }
  if (!updates.length) return { updated: 0, planned: 0 };
  if (!PUSH_GRIST) {
    console.log(`[openalex] DRY-RUN: ${updates.length} record(s) would receive OpenAlex_ids (ORCID profile), e.g. ${updates.slice(0, 3).map((u) => `${u.key}→${joinIds(u.ids)}`).join(', ')}`);
    return { updated: 0, planned: updates.length };
  }
  const fresh = new Map((await common.fetchAnnuaire()).map((p) => [p.recId, p]));
  const records = updates
    .filter((u) => fresh.has(u.recId) && !parseIds(fresh.get(u.recId).openalexIds).length)
    .map((u) => ({ id: u.recId, fields: withTrace(SOURCE, fresh.get(u.recId), { [TARGET]: joinIds(u.ids) }, 'profil ORCID') }));
  const n = await gristPatchGrouped('Annuaire', records);
  const writtenIds = new Set(records.map((r) => r.id));
  for (const u of updates) if (writtenIds.has(u.recId)) { cache[u.key].written = [TARGET]; cache[u.key].writtenIds = u.ids; }
  return { updated: n, planned: updates.length };
}
/** verify: resolved list (merges replaced, gone ones removed, ORCID profile added) → OpenAlex_ids, traced. */
async function applyVerifyWrites(cache, all) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const updates = [];
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.mode !== 'verify' || entry.status !== 'checked' || !entry.changed || entry.written) continue;
    const p = byKey.get(key);
    if (!p) continue;
    const details = [
      ...(entry.replaced || []).map(([a, b]) => `${a}→${b} (fusion)`),
      ...(entry.removed || []).map((a) => `retiré ${a} (disparu)`),
      ...(entry.removedMixed || []).map((a) => `retiré ${a} (identité mêlée)`),
      ...(entry.added || []).map((a) => `ajouté ${a} (profil ORCID)`),
    ].join(', ');
    updates.push({ key, recId: p.recId, before: entry.ids, after: entry.next, details });
  }
  if (!updates.length) return { updated: 0, planned: 0 };
  if (!PUSH_GRIST) {
    console.log(`[openalex] DRY-RUN: ${updates.length} record(s) would get OpenAlex_ids fixed, e.g. ${updates.slice(0, 3).map((u) => `${u.key}: ${u.details}`).join(' ; ')}`);
    return { updated: 0, planned: updates.length };
  }
  const fresh = new Map((await common.fetchAnnuaire()).map((p) => [p.recId, p]));
  const records = updates
    .filter((u) => fresh.has(u.recId) && joinIds(parseIds(fresh.get(u.recId).openalexIds)) === joinIds(u.before))   // nothing changed in the meantime
    .map((u) => ({ id: u.recId, fields: withTrace(SOURCE, fresh.get(u.recId), { [TARGET]: joinIds(u.after) }, `vérification : ${u.details}`) }));
  const n = await gristPatchGrouped('Annuaire', records);
  const writtenIds = new Set(records.map((r) => r.id));
  for (const u of updates) if (writtenIds.has(u.recId)) cache[u.key].written = [TARGET];
  return { updated: n, planned: updates.length };
}

/**
 * Quarterly re-examination of the « Identité mêlée » tickets (§ 8.3): if the profile vanished, was merged, lost
 * more than half of its works since the report or is no longer suspect, the row goes back to « À traiter »
 * with the dated evidence in Note — otherwise it remains an open ticket.
 */
async function reexamineMixed(decisions, all) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const rows = [...decisions.entries()].filter(([, d]) => d.decision === DECISION_MIXED);
  if (!rows.length) return null;
  const toPatch = [];
  for (const [key, d] of rows) {
    const uid = key.split('::')[0];
    const id = extractAId(d.fields.OpenAlex_candidat);
    const p = byKey.get(uid);
    if (!id || !p) continue;
    const r = await resolveAuthor(id);
    if (!r) continue;
    let why = '';
    if (r.status === 'gone') why = 'profil disparu';
    else if (r.status === 'merged') why = `profil fusionné dans ${r.into}`;
    else {
      const before = parseInt(d.fields.Nb_publications, 10) || 0;
      if (before && r.author.worksCount < before / 2) why = `works passés de ${before} à ${r.author.worksCount}`;
      else if (!suspicionOf(p, r.author, { matchedIds: [], nameMatch: bestNameMatch(p, r.author) }).length && /identité mêlée suspectée/.test(String(d.fields.Preuves || ''))) why = 'plus de signe de mélange';
    }
    if (!why) continue;
    const note = `${d.note ? `${d.note}\n` : ''}[${today()}] profil modifié depuis le signalement : ${why} → à réexaminer`;
    toPatch.push({ id: d.id, fields: { Decision: DECISION_TODO, Note: note, Pousse_le: today() } });
  }
  if (toPatch.length) await gristPatchRecords(REVIEW_TABLE, toPatch);
  return { checked: rows.length, reopened: toPatch.length };
}

// Export of the pure functions (tests; main only runs on direct invocation).
module.exports = {
  extractAId, parseIds, joinIds, normDoi, toAuthor, bestNameMatch, scoreCandidate, buildReviewRows, buildReviewColumns,
  resolveAuthor, authorByOrcid, authorsByIds, searchByName, authorDois, ikgSignals, loadLabs, alignPerson, verifyPerson,
  suspicionOf, affiliationsIncompatible, reexamineMixed,
  SITE_LINEAGE, SITE_PATTERNS, REVIEW_TABLE, TARGET,
};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cache = loadCache();
  console.log(`[openalex] mode=${MODE} concurrency=${CONCURRENCY} (${USE_KEY ? 'OpenAlex key' : MAILTO ? `polite pool, mailto ${MAILTO}` : 'NO key nor mailto'})${PUSH_GRIST ? '' : ' (dry run: no Grist write)'}`);

  const all = await common.fetchAnnuaire();
  const labs = MODE === 'push' ? new Map() : await loadLabs();
  const decisions = await loadReviewDecisions(REVIEW_TABLE, 'OpenAlex_candidat', extractAId);
  for (const [k, d] of decisions) if (d.decision === DECISION_MIXED) MIXED_KEYS.add(k);
  const sel = MODE === 'push' ? { eligible: [], targets: [] } : selectTargets('openalex', all, cache, { mode: MODE, labo: LABO_FILTER, group: GROUP_FILTER, force: FORCE, limit: LIMIT, record: OPTS.record });
  let targets = sel.targets;
  const eligible = sel.eligible.length;

  console.log(`[openalex] ${all.length} Annuaire records, ${eligible} eligible (${MODE}${LABO_FILTER ? `, labo ${LABO_FILTER}` : ''}${GROUP_FILTER ? `, group ${GROUP_FILTER}` : ''}), ${targets.length} to process${FORCE ? ' (force)' : ''}.`);
  const counts = { found: 0, ambiguous: 0, not_found: 0, error: 0, checked: 0, direct: 0, changed: 0, nameMismatch: 0 };
  const progress = (running, extra = {}) => writeProgress({ running, mode: MODE, total: targets.length, done: 0, ...counts, startedAt: today(), ...extra });
  progress(true);

  let done = 0;
  let skipped = 0;
  await runPool(targets, async (p) => {
    if (ABORT) { skipped++; return; }   // quota exhausted: the remaining records are left untouched (not flagged as errors either)
    const entry = MODE === 'verify' ? await verifyPerson(p, labs) : await alignPerson(p, labs, []);
    if (ABORT && entry.status === 'error') { skipped++; return; }   // the current record suffered the stop: do not flag it
    const prev = cache[p.key];
    if (prev && prev.mode === entry.mode && prev.written && joinIds(prev.writtenIds || prev.next || []) === joinIds(entry.direct || entry.next || [])) {
      entry.written = prev.written;
      if (prev.writtenIds) entry.writtenIds = prev.writtenIds;
    }
    cache[p.key] = entry;
    if (counts[entry.status] !== undefined) counts[entry.status]++;
    if ((entry.direct || []).length) counts.direct++;
    if (entry.changed) counts.changed++;
    if (entry.nameMismatch) counts.nameMismatch++;
  }, CONCURRENCY, (n) => {
    done = n;
    if (n % 10 === 0 || n === targets.length) {
      writeProgress({ running: true, mode: MODE, total: targets.length, done: n, ...counts, startedAt: today() });
      console.log(`[openalex] ${n}/${targets.length}`);
    }
  }, { stoppable: true });   // « Stop » button: records in progress finish, the rest is left for the next run
  writeCache(cache);

  let writes = null;
  if (MODE === 'verify' && PUSH_GRIST) {
    try { const re = await reexamineMixed(decisions, all); if (re) console.log(`[openalex] « Identité mêlée » tickets re-examined: ${re.checked}, reopened: ${re.reopened}.`); }
    catch (e) { console.error('[openalex] Mixed identities re-examination ERROR', e); }
  }
  if (MODE === 'search' || MODE === 'verify') {
    try {
      writes = MODE === 'search' ? await applyDirectWrites(cache, all) : await applyVerifyWrites(cache, all);
      if (writes.updated) { writeCache(cache); console.log(`[openalex] ${TARGET} written to ${writes.updated} Annuaire record(s) (${MODE}).`); }
    } catch (e) {
      console.error('[openalex] Annuaire write ERROR', e);
      writes = { error: e.message };
    }
  }

  let push = null;
  const rejected = await loadRejected(REVIEW_TABLE, 'OpenAlex_candidat', extractAId);
  const { desired, found, ambiguous } = buildReviewRows(cache, all, rejected);
  console.log(`[openalex] Suggestions: ${found} records with a strong candidate, ${ambiguous} ambiguous → ${desired.size} review row(s) (${rejected.size} known rejections).`);
  // Push to Alignement_OpenAlex only on explicit request (push mode): validation is
  // done in Druid, the table now only serves as a blacklist — decision of 2026-09-21.
  if (PUSH_GRIST && MODE === 'push') {
    try {
      push = await pushReview({
        table: REVIEW_TABLE, columns: buildReviewColumns(), desired,
        keyOf: (rec) => `${rec.fields.uid_dyna || ''}::${extractAId(rec.fields.OpenAlex_candidat)}`,
      });
      console.log(`[openalex] Grist review: +${push.created} created, ${push.refreshed} refreshed, ${push.skipped} already decided, ${push.purged} purged${push.tableCreated ? ' (table created)' : ''}.`);
    } catch (e) {
      console.error('[openalex] Grist push ERROR (local cache kept)', e);
      push = { error: e.message };
    }
  }

  writeProgress({ running: false, mode: MODE, total: targets.length, done, ...counts, skipped, push, writes, ...(ABORT ? { error: `Run interrompu : ${ABORT} — ${skipped} fiche(s) non traitée(s), relancer plus tard (--incremental avec --labo)` } : {}), finishedAt: new Date().toISOString() });
  console.log(`[openalex] Done${ABORT ? ` (INTERRUPTED: ${ABORT}, ${skipped} records not processed)` : ''}. ${JSON.stringify(counts)}. Cache: ${store.cachePath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[openalex] ERROR', e);
    writeProgress({ running: false, mode: MODE, error: e.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });
}
