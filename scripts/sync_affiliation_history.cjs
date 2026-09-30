/**
 * sync_affiliation_history.cjs — career path of the researchers (docs/plan-parcours-affiliations.md, lot 1).
 *
 * For every Annuaire record with at least one usable identifier, gathers:
 *   - the publications with the affiliations of THIS person: CRISalid graph (uid), OpenAlex works
 *     (OpenAlex_ids) and Scopus Search (ID_SCOPUS), merged by DOI then source id (D1, D8);
 *   - the ORCID employments and invited positions (ORCID);
 *   - the Scopus profile (Author Retrieval ENHANCED: history, current affiliation, publication range);
 * classifies every organization (local / neutral / other, D2), aggregates by establishment × year and
 * computes the signals (departure declared / observed / confirmed, Scopus current affiliation, arrival,
 * suspect identifier, inconsistent status D10). Pure logic: scripts/lib/affiliation_history.cjs;
 * readers: scripts/lib/affiliation_sources.cjs.
 *
 * Output: one directory, bind-mounted as a whole (cache-data/affiliation_history, --dir=), key = uid_dyna
 * or g<rowId>:
 *   p-<key>.json      full entry of one person (establishments, ORCID, Scopus profile, signals,
 *                     publication list) — read one at a time by the API (lot 2);
 *   _index.json       signals, dates and totals of every person (incremental runs, list filter and
 *                     « À traiter » rules, lot 4) — small enough to load whole;
 *   _hierarchy.json   durable names / parents of the organizations;
 *   _progress.json    state of the current / last run.
 * Read-only everywhere else (Grist, graph, APIs).
 *
 * Safety (incident of 2026-09-29, OOM of the server during a graph extraction):
 *   - one graph query per person, by chunks; the run stops when the host free memory falls under
 *     --min-mem-mb (default 2500);
 *   - an entry is rewritten only from a complete fetch: a failing source leaves the previous entry
 *     untouched (a source disabled for the rest of the run after repeated failures, or a Scopus quota
 *     share reached, produces entries marked `incomplete`, which never replace a complete one);
 *   - writes are atomic (temporary file + rename).
 *
 * Configuration of the instance (D2): --config=<file> or AFFILIATION_HISTORY_CONFIG = an instance.json
 * (key `affiliationHistory`, schema in scripts/instances/instanceConfig.cjs) or that object alone. The
 * Structures table of the Grist doc is always added to the local organizations.
 *
 * Options: --limit= --labo=ACRONYM --uid=<uid_dyna> --sources=graph,openalex,scopus,orcid (default all)
 *          --max-age-days=(6) incremental: skips entries computed since, complete and with unchanged ids
 *          --force (recompute everything) --dry-run (computes, prints a summary, writes nothing)
 *          --concurrency=(3) --chunk=(20) --min-mem-mb=(2500) --scopus-reserve=(0.4) --no-key (OpenAlex polite pool)
 */
const fs = require('fs');
const common = require('./lib/align_common.cjs');
const { getArg, hasFlag, gristGet, DOC, runPool, extractOrcid, today } = common;
const AH = require('./lib/affiliation_history.cjs');
const SRC = require('./lib/affiliation_sources.cjs');
const STORE = require('./lib/affiliation_history_store.cjs');
const { createElsevierClient } = require('./lib/elsevier_client.cjs');
const { affiliationHistorySchema } = require('./instances/instanceConfig.cjs');

const ENTRIES_DIR = getArg('dir', process.env.AFFILIATION_HISTORY_DIR || 'affiliation_history');
const INDEX_PATH = STORE.indexFile(ENTRIES_DIR);
const PROGRESS_PATH = STORE.progressFile(ENTRIES_DIR);
const HIERARCHY_PATH = STORE.hierarchyFile(ENTRIES_DIR);
const LIMIT = parseInt(getArg('limit', '0'), 10) || 0;
const LABO = String(getArg('labo', '') || '').trim().toUpperCase();
const ONLY_UID = String(getArg('uid', '') || '').trim();
const SOURCES = new Set(String(getArg('sources', 'graph,openalex,scopus,orcid')).split(',').map((s) => s.trim()).filter(Boolean));
const MAX_AGE_DAYS = parseFloat(getArg('max-age-days', '6'));
const FORCE = hasFlag('force');
const DRY_RUN = hasFlag('dry-run');
const CONCURRENCY = parseInt(getArg('concurrency', '3'), 10) || 3;
const CHUNK = parseInt(getArg('chunk', '20'), 10) || 20;
const MIN_MEM_MB = parseInt(getArg('min-mem-mb', '2500'), 10) || 2500;
const SCOPUS_RESERVE = parseFloat(getArg('scopus-reserve', '0.4'));
const OPENALEX_KEY = hasFlag('no-key') ? '' : (process.env.OPENALEX_API_KEY || '');
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_PUBS_STORED = 300;
/** Index line of an entry: what the list, the rules and the incremental runs need. */
const indexLine = (e) => ({ computedAt: e.computedAt, idsSignature: e.idsSignature, incomplete: e.incomplete, totals: e.totals, firstLocal: e.firstLocal, lastLocal: e.lastLocal, signals: e.signals });
const TODAY = today();

// ── Configuration ────────────────────────────────────────────────────────────
function loadConfig() {
  const p = getArg('config', process.env.AFFILIATION_HISTORY_CONFIG || '');
  if (!p) { console.warn('[parcours] no configuration (--config / AFFILIATION_HISTORY_CONFIG): local = Structures table only'); return affiliationHistorySchema.parse({}); }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return affiliationHistorySchema.parse(raw && Object.prototype.hasOwnProperty.call(raw, 'affiliationHistory') ? (raw.affiliationHistory || {}) : raw);
}
/** « Name[fr]|Other[en] » (V2 labels of the Structures table) → ['Name', 'Other']. */
const labels = (v) => String(v || '').split('|').map((x) => x.replace(/\[[a-z]{2}\]\s*$/i, '').trim()).filter(Boolean);
async function loadStructures() {
  const { records } = await gristGet(`/docs/${DOC}/tables/Structures/records`);
  return (records || []).map((r) => {
    const f = r.fields;
    return { ids: { rnsr: [f.nns].filter(Boolean), ror: [f.ror].filter(Boolean), scopus: [f.scopus].filter(Boolean).map(String) }, names: [...labels(f.short_labels), ...labels(f.long_labels)] };
  }).filter((s) => s.names.length || s.ids.rnsr.length || s.ids.ror.length || s.ids.scopus.length);
}

// ── Annuaire → people ────────────────────────────────────────────────────────
/** Grist date cell (epoch seconds of a former Date column, or fuzzy text AAAA[-MM[-JJ]]) → text. */
const dateText = (v) => (typeof v === 'number' && v ? new Date(v * 1000).toISOString().slice(0, 10) : String(v || '').trim());
const splitIds = (v) => String(v || '').split(/[|,;\s]+/).map((s) => s.trim()).filter(Boolean);
async function loadPeople() {
  const { records } = await gristGet(`/docs/${DOC}/tables/Annuaire/records`);
  const byKey = new Map();
  for (const rec of records || []) {
    const f = rec.fields;
    const key = f.uid_dyna || `g${rec.id}`;
    let p = byKey.get(key);
    if (!p) { p = { key, uid: f.uid_dyna || '', orcid: '', openalex: [], scopus: [], labos: [], employmentStart: '', employmentEnd: '', membershipEnds: [], isDoctorant: false }; byKey.set(key, p); }
    p.orcid = p.orcid || extractOrcid(f.ORCID);
    p.openalex = [...new Set([...p.openalex, ...splitIds(f.OpenAlex_ids).filter((a) => /^A\d+$/i.test(a)).map((a) => a.toUpperCase())])];
    p.scopus = [...new Set([...p.scopus, ...splitIds(f.ID_SCOPUS).filter((s) => /^\d+$/.test(s))])];
    if (f.LABO) p.labos.push(String(f.LABO).trim().toUpperCase());
    const es = dateText(f.employment_start_date); if (es && (!p.employmentStart || es < p.employmentStart)) p.employmentStart = es;
    const ee = dateText(f.employment_end_date); if (ee && ee > p.employmentEnd) p.employmentEnd = ee;
    p.membershipEnds.push(dateText(f.affiliation_end_date));
    if (String(f.TYPE_EMPLOI || '').trim().toUpperCase() === 'DOCTORANT') p.isDoctorant = true;
  }
  return [...byKey.values()].map((p) => ({
    ...p,
    // Membership over only when every membership row is ended.
    membershipEnd: p.membershipEnds.length && p.membershipEnds.every(Boolean) ? p.membershipEnds.sort().pop() : '',
  }));
}
const idsSignature = (p) => JSON.stringify([p.uid, p.orcid, p.openalex, p.scopus]);

// ── Classification helpers ───────────────────────────────────────────────────
const classified = (orgs, matcher, H) => orgs.map((org) => { const c = AH.classifyOrg(org, matcher, H); return { org, cls: c.cls, establishment: c.establishment, lab: c.lab }; });
const shortPeriod = (p) => ({ kind: p.kind, name: p.establishment?.name || p.org.names[0] || '', lab: p.lab?.name || (p.org.names[0] && p.org.names[0] !== p.establishment?.name ? p.org.names[0] : ''), cls: p.cls, country: p.establishment?.country || p.org.country || '', start: p.start || '', end: p.end || '', role: p.role || '', dept: p.dept || '' });

const dedupe = (list) => { const seen = new Set(); return list.filter((x) => { const k = `${x.cls}|${x.name}`; if (!x.name || seen.has(k)) return false; seen.add(k); return true; }); };
/** Compact cache entry of one person (served to the record's « Parcours » block, lots 2-3). */
function buildEntry(person, fetched, matcher, H, incomplete) {
  const pubs = AH.mergePublications(fetched.graph || [], fetched.openalex || [], fetched.scopus || []);
  const agg = AH.aggregate(pubs, matcher, H);
  const periods = AH.classifyPeriods(fetched.orcid || [], matcher, H);
  const prof = fetched.profile ? { current: classified(fetched.profile.current, matcher, H), history: classified(fetched.profile.history, matcher, H), range: fetched.profile.range } : null;
  const record = { employmentStart: person.employmentStart, employmentEnd: person.employmentEnd, membershipEnd: person.membershipEnd, isDoctorant: person.isDoctorant };
  const { signals, firstLocal, lastLocal } = AH.computeSignals({ agg, periods, profile: prof, record, today: TODAY, thresholds: CONFIG.thresholds });
  const estIndex = new Map(agg.establishments.map((e, i) => [e.key, i]));
  const order = agg.pubs.map((p, i) => i).sort((a, b) => (agg.pubs[b].year || 0) - (agg.pubs[a].year || 0));
  return {
    computedAt: new Date().toISOString(),
    ids: { uid: person.uid, orcid: person.orcid, openalex: person.openalex, scopus: person.scopus },
    idsSignature: idsSignature(person),
    sources: { graph: fetched.graph ? fetched.graph.length : null, openalex: fetched.openalex ? fetched.openalex.length : null, scopus: fetched.scopus ? fetched.scopus.length : null, orcid: fetched.orcid ? fetched.orcid.length : null, scopusProfile: !!fetched.profile },
    incomplete,
    totals: agg.totals,
    firstLocal, lastLocal,
    establishments: agg.establishments.map((e) => ({ key: e.key, name: e.name, country: e.country, cls: e.cls, byYear: e.byYear, first: e.first, last: e.last, count: e.count, labs: e.labs.slice(0, 8) })),
    orcid: periods.map(shortPeriod),
    scopusProfile: prof ? { current: dedupe(prof.current.map((c) => ({ name: c.establishment?.name || c.org.names[0] || '', cls: c.cls }))), history: dedupe(prof.history.map((c) => ({ name: c.establishment?.name || c.org.names[0] || '', cls: c.cls }))), range: prof.range } : null,
    signals,
    pubs: order.slice(0, MAX_PUBS_STORED).map((i) => { const p = agg.pubs[i]; return { y: p.year, doi: p.doi || undefined, t: String(p.title || '').replace(/<[^>]+>/g, '').slice(0, 180), s: p.sources, c: p.classes, e: p.est.map((k) => estIndex.get(k)) }; }),
  };
}

// ── Run ──────────────────────────────────────────────────────────────────────
let CONFIG;
async function main() {
  CONFIG = loadConfig();
  if (!DRY_RUN) fs.mkdirSync(ENTRIES_DIR, { recursive: true });
  const structures = await loadStructures();
  const matcher = AH.createMatcher(CONFIG, structures);
  const people = await loadPeople();
  const cache = (() => { try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); } catch (e) { return {}; } })();
  const dryEntries = {};
  const updatedIndex = {};
  const hierarchy = SRC.loadHierarchy(HIERARCHY_PATH);
  const fresh = (e, p) => e && !e.incomplete?.length && e.idsSignature === idsSignature(p) && (Date.now() - new Date(e.computedAt).getTime()) < MAX_AGE_DAYS * 864e5;
  let targets = people.filter((p) => p.uid || p.orcid || p.openalex.length || p.scopus.length);
  if (ONLY_UID) targets = targets.filter((p) => p.uid === ONLY_UID || p.key === ONLY_UID);
  if (LABO) targets = targets.filter((p) => p.labos.includes(LABO));
  if (!FORCE && !ONLY_UID) targets = targets.filter((p) => !fresh(cache[p.key], p));
  if (LIMIT) targets = targets.slice(0, LIMIT);
  console.log(`[parcours] ${people.length} people, ${targets.length} to compute · sources ${[...SOURCES].join(',')} · structures ${structures.length}${DRY_RUN ? ' · DRY-RUN' : ''}`);

  const graph = SOURCES.has('graph') ? SRC.createGraphReader() : null;
  const elsevier = SOURCES.has('scopus') ? createElsevierClient({ tag: 'parcours', ratePerS: { author: 3, scopus_search: 3 }, reserve: SCOPUS_RESERVE }) : null;
  if (elsevier && !elsevier.hasKey) console.warn('[parcours] SCOPUS_API_KEY is not set: Scopus source skipped');
  const disabled = new Set();            // sources disabled for the rest of the run
  const failures = {};                   // consecutive failures per source
  const noteFailure = (src, e) => {
    failures[src] = (failures[src] || 0) + 1;
    if (failures[src] >= MAX_CONSECUTIVE_FAILURES && !disabled.has(src)) { disabled.add(src); console.error(`[parcours] source ${src} disabled for this run after ${failures[src]} consecutive failures (last: ${e.message || e})`); }
  };
  const counts = { computed: 0, kept: 0, failed: 0, incomplete: 0, signals: {} };
  const startedAt = new Date().toISOString();
  let stopReason = null;
  // A one-person run (--uid, the API « refresh ») never touches the progress of the full run.
  const writeProgress = (running, done) => { if (!DRY_RUN && !ONLY_UID) try { fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ running, total: targets.length, done, ...counts, disabled: [...disabled], quota: elsevier?.quota || {}, startedAt, ...(stopReason ? { warning: stopReason } : {}) })); } catch (e) { /* noop */ } };
  writeProgress(true, 0);

  let done = 0;
  for (let c = 0; c < targets.length && !stopReason; c += CHUNK) {
    const chunk = targets.slice(c, c + CHUNK);
    if (graph && !disabled.has('graph')) {
      const mem = SRC.memAvailableMb();
      if (mem !== null && mem < MIN_MEM_MB) { stopReason = `free memory ${mem} MB < ${MIN_MEM_MB} MB: run stopped to protect Neo4j`; break; }
    }
    // Scopus profiles of the chunk in a few multi-id requests.
    const scopusActive = () => elsevier && elsevier.hasKey && !elsevier.aborted() && !disabled.has('scopus');
    let profiles = new Map();
    if (scopusActive()) profiles = await SRC.scopusProfiles(elsevier, chunk.flatMap((p) => p.scopus), { hierarchy });
    const results = await runPool(chunk, async (p) => {
      const fetched = {};
      const incomplete = [];
      const run = async (src, applicable, fn) => {
        if (!SOURCES.has(src) || !applicable) return true;
        if (disabled.has(src) || (src === 'scopus' && !scopusActive())) { incomplete.push(src); return true; }
        try { fetched[src] = await fn(); failures[src] = 0; if (fetched[src] === null) { delete fetched[src]; incomplete.push(src); } return true; }
        catch (e) { noteFailure(src, e); return false; }
      };
      const ok = [
        await run('graph', !!p.uid, () => graph.publications(p.uid)),
        await run('openalex', p.openalex.length > 0, () => SRC.openalexPublications(p.openalex, { apiKey: OPENALEX_KEY, hierarchy })),
        await run('scopus', p.scopus.length > 0, () => SRC.scopusPublications(elsevier, p.scopus, { hierarchy })),
        await run('orcid', !!p.orcid, () => SRC.orcidPeriods(p.orcid)),
      ].every(Boolean);
      if (SOURCES.has('scopus') && p.scopus.length && scopusActive()) {
        const prof = p.scopus.map((id) => profiles.get(id)).filter(Boolean);
        if (prof.length) fetched.profile = { current: prof.flatMap((x) => x.current), history: prof.flatMap((x) => x.history), range: { start: Math.min(...prof.map((x) => x.range.start || 9999)), end: Math.max(...prof.map((x) => x.range.end || 0)) || null } };
      }
      return { p, ok, fetched, incomplete };
    }, CONCURRENCY);
    // Names / parents of every organization met in the chunk.
    const orgs = results.flatMap((r) => (r && r.fetched ? [
      ...['graph', 'openalex', 'scopus'].flatMap((s) => (r.fetched[s] || []).flatMap((x) => x.orgs)),
      ...(r.fetched.orcid || []).map((x) => x.org),
      ...(r.fetched.profile ? [...r.fetched.profile.current, ...r.fetched.profile.history] : []),
    ] : []));
    try { await SRC.resolveHierarchy(hierarchy, orgs, { apiKey: OPENALEX_KEY }); }
    catch (e) { console.error(`[parcours] resolver failed (${e.message}): chunk not written, retried next run`); counts.failed += chunk.length; done += chunk.length; writeProgress(true, done); continue; }
    for (const r of results) {
      done++;
      if (!r || r.error || !r.ok) { counts.failed++; continue; }
      const entry = buildEntry(r.p, r.fetched, matcher, hierarchy, r.incomplete);
      const old = cache[r.p.key];
      if (entry.incomplete.length && old && !old.incomplete?.length && old.idsSignature === entry.idsSignature) { counts.kept++; continue; }
      cache[r.p.key] = indexLine(entry);
      updatedIndex[r.p.key] = cache[r.p.key];
      if (DRY_RUN) dryEntries[r.p.key] = entry; else STORE.writeJsonAtomic(STORE.entryFile(ENTRIES_DIR, r.p.key), entry);
      counts.computed++;
      if (entry.incomplete.length) counts.incomplete++;
      for (const s of entry.signals) counts.signals[s.type] = (counts.signals[s.type] || 0) + 1;
    }
    if (elsevier?.aborted() && !disabled.has('scopus')) { disabled.add('scopus'); console.warn(`[parcours] Scopus stopped: ${elsevier.aborted()} — next entries marked incomplete`); }
    if (!DRY_RUN) {
      // Merge on write: a concurrent run (full run / API refresh) keeps its own keys.
      STORE.mergeIndex(ENTRIES_DIR, updatedIndex);
      const merged = SRC.loadHierarchy(HIERARCHY_PATH);
      for (const [table, rows] of Object.entries(hierarchy)) merged[table] = { ...(merged[table] || {}), ...rows };
      STORE.writeJsonAtomic(HIERARCHY_PATH, merged);
    }
    writeProgress(true, done);
    console.log(`[parcours] ${done}/${targets.length} · computed ${counts.computed} · failed ${counts.failed} · incomplete ${counts.incomplete} · mem ${SRC.memAvailableMb() ?? '?'} MB`);
  }
  if (!stopReason && disabled.size) stopReason = `sources disabled during the run: ${[...disabled].join(', ')}${elsevier?.aborted() ? ` (${elsevier.aborted()})` : ''}`;
  writeProgress(false, done);
  console.log(`[parcours] Done. ${JSON.stringify(counts)}${stopReason ? ` — ${stopReason}` : ''}. Quota Scopus: ${JSON.stringify(elsevier?.quota || {})}`);
  if (DRY_RUN) {
    for (const r of targets.slice(0, hasFlag('verbose') ? targets.length : 5)) {
      const e = dryEntries[r.key];
      if (!e) continue;
      console.log(r.key, JSON.stringify({ totals: e.totals, signals: e.signals }));
      if (hasFlag('verbose')) for (const x of e.establishments.slice(0, 12)) console.log(`   ${x.cls.padEnd(7)} ${String(x.count).padStart(3)} ${x.first}-${x.last} ${x.name}${x.labs.length ? ` [${x.labs.slice(0, 3).map((l) => l.name).join(' ; ')}]` : ''}`);
    }
  }
}

main().catch((e) => { console.error('[parcours] FAILED:', e); process.exit(1); });
