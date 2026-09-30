/**
 * affiliation_sources.cjs — readers of the career-path sources (docs/plan-parcours-affiliations.md, lot 1).
 * Each reader returns the normalized shapes of scripts/lib/affiliation_history.cjs, or throws (the job
 * then leaves the person's previous entry untouched: an entry is only rewritten from a complete fetch).
 *
 *   graph    — CRISalid graph (Neo4j HTTP, same access as sync_openalex.cjs): publications of the Person
 *              `local-<uid>`, affiliations resolved by the IKG (HAS_AFFILIATION_STATEMENT), DOIs carried by
 *              the SourceRecords. One query per person; the caller checks the free memory first
 *              (incident of 2026-09-29: an extraction of the whole graph put the server out of memory).
 *   openalex — works of the author's A-ids, institutions of HIS authorship only.
 *   scopus   — Scopus Search by author id (affiliation ids of that author on every paper) and Author Retrieval ENHANCED
 *              (affiliation history, current affiliation, publication range).
 *   orcid    — employments and invited positions (public API).
 *   resolver — names / countries / parents of the organizations (OpenAlex institutions + lineage,
 *              HAL structures + parents), kept in a durable cache.
 */
const fs = require('fs');
const { getUrl } = require('./align_common.cjs');
const { makeOrg, emptyHierarchy } = require('./affiliation_history.cjs');

const lastSegment = (v) => String(v || '').trim().replace(/\/+$/, '').split('/').pop();
const yearOf = (v) => { const m = String(v || '').match(/^(\d{4})/); return m ? parseInt(m[1], 10) : null; };

/** Free memory of the host (the container sees the host /proc/meminfo), in MB; null when unreadable. */
function memAvailableMb() {
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m);
    return m ? Math.floor(parseInt(m[1], 10) / 1024) : null;
  } catch (e) { return null; }
}

// ── Graph ────────────────────────────────────────────────────────────────────
const GRAPH_PUBS = `
MATCH (p:Person {uid: $uid})-[:HAS_CONTRIBUTION]->(c:Contribution)<-[:HAS_CONTRIBUTION]-(doc:Document)
OPTIONAL MATCH (c)-[:HAS_AFFILIATION_STATEMENT]->(o:AuthorityOrganization)
WITH doc, collect(DISTINCT o.uid) AS orgs
OPTIONAL MATCH (doc)-[:RECORDED_BY]->(sr:SourceRecord)
OPTIONAL MATCH (sr)-[:HAS_IDENTIFIER]->(pi:PublicationIdentifier) WHERE pi.type = 'doi'
WITH doc, orgs, collect(DISTINCT sr.harvester) AS harvesters,
     collect(DISTINCT sr.harvester + ':' + sr.source_identifier) AS srcs, collect(DISTINCT toLower(pi.value)) AS dois
OPTIONAL MATCH (doc)-[:HAS_TITLE]->(t:Literal)
RETURN doc.publication_date AS date, orgs, harvesters, srcs, dois, head(collect(t.value)) AS title`;
const GRAPH_ORGS = `
UNWIND $uids AS u
MATCH (o:AuthorityOrganization {uid: u})
OPTIONAL MATCH (o)-[:HAS_IDENTIFIER]->(i:AgentIdentifier)
RETURN o.uid AS uid, o.display_names AS names, o.type AS type, collect(DISTINCT [i.type, i.value]) AS ids`;

/** Source identifier comparable across sources: « openalex:W123 », « scopus:8514… », « hal:hal-0123 ». */
function normSourceId(s) {
  const [h, ...rest] = String(s || '').split(':');
  const v = rest.join(':');
  if (!h || !v) return '';
  if (h === 'openalex') return `openalex:${lastSegment(v).toUpperCase()}`;
  if (h === 'scopus') return `scopus:${v.replace(/^SCOPUS_ID:/i, '').replace(/^2-s2\.0-/, '')}`;
  return `${h}:${v}`;
}

function createGraphReader({ url = process.env.NEO4J_HTTP_URL || 'http://localhost:7474', user = process.env.NEO4J_USER || 'neo4j', password = process.env.NEO4J_PASSWORD || '', timeoutMs = 30000 } = {}) {
  const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  async function cypher(statement, parameters) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${url}/db/neo4j/tx/commit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ statements: [{ statement, parameters }] }), signal: ctrl.signal,
      });
      const j = await r.json();
      if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
      const res = j.results?.[0] || { columns: [], data: [] };
      return res.data.map((d) => Object.fromEntries(res.columns.map((c, i) => [c, d.row[i]])));
    } finally { clearTimeout(t); }
  }
  const orgCache = new Map();
  /** Publications of the Person `local-<uid>` (normalized), [] when the person is not in the graph. */
  async function publications(uid) {
    const rows = await cypher(GRAPH_PUBS, { uid: `local-${uid}` });
    const missing = [...new Set(rows.flatMap((r) => r.orgs || []))].filter((u) => !orgCache.has(u));
    for (let i = 0; i < missing.length; i += 200) {
      for (const o of await cypher(GRAPH_ORGS, { uids: missing.slice(i, i + 200) })) {
        const ids = {};
        for (const [t, v] of o.ids || []) if (t && v) (ids[t] = ids[t] || []).push(v);
        orgCache.set(o.uid, makeOrg({ ids, names: o.names || [] }));
      }
    }
    return rows.map((r) => ({
      doi: (r.dois || [])[0] || '',
      sourceIds: (r.srcs || []).map(normSourceId).filter(Boolean),
      year: yearOf(r.date),
      title: r.title || '',
      sources: ['graph'],
      harvesters: r.harvesters || [],
      orgs: (r.orgs || []).map((u) => orgCache.get(u)).filter(Boolean),
    }));
  }
  return { publications, cypher };
}

// ── OpenAlex works ───────────────────────────────────────────────────────────
/**
 * Works of the A-ids; the institutions of the matching authorship (with their lineage, fed into the
 * hierarchy so the resolver only fetches the missing names). `hierarchy` is completed in place.
 */
async function openalexPublications(aids, { apiKey = process.env.OPENALEX_API_KEY || '', mailto = process.env.OPENALEX_MAILTO || '', hierarchy, maxWorks = 2000 } = {}) {
  const ids = [...new Set(aids.map((a) => lastSegment(a).toUpperCase()).filter((a) => /^A\d+$/.test(a)))];
  if (!ids.length) return [];
  const out = [];
  let cursor = '*';
  while (cursor && out.length < maxWorks) {
    const params = new URLSearchParams({ filter: `author.id:${ids.join('|')}`, select: 'id,doi,title,publication_year,authorships', per_page: '200', cursor });
    if (apiKey) params.set('api_key', apiKey); else if (mailto) params.set('mailto', mailto);
    const d = await getUrl(`https://api.openalex.org/works?${params}`, { json: true, timeout: 30000 });
    for (const w of d.results || []) {
      const mine = (w.authorships || []).filter((a) => ids.includes(lastSegment(a.author?.id).toUpperCase()));
      const orgs = [];
      for (const a of mine) {
        for (const i of a.institutions || []) {
          const iid = lastSegment(i.id).toUpperCase();
          if (hierarchy && iid && !hierarchy.openalex[iid]) hierarchy.openalex[iid] = { name: i.display_name || '', country: i.country_code || '', type: i.type || '', ror: lastSegment(i.ror || ''), lineage: (i.lineage || []).map((l) => lastSegment(l).toUpperCase()), partial: true };
          orgs.push(makeOrg({ ids: { openalex: iid, ror: i.ror || '' }, names: [i.display_name], country: i.country_code }));
        }
      }
      out.push({ doi: w.doi || '', sourceIds: [`openalex:${lastSegment(w.id).toUpperCase()}`], year: w.publication_year || null, title: w.title || '', sources: ['openalex'], orgs });
    }
    cursor = d.meta?.next_cursor || null;
    if (!(d.results || []).length) break;
  }
  return out;
}

// ── Scopus ───────────────────────────────────────────────────────────────────
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const scopusOrg = (afid, a = {}) => makeOrg({ ids: { scopus: afid }, names: [a.name || a.affilname || ''], city: a.city || a['affiliation-city'] || '', country: a.country || a['affiliation-country'] || '' });

const SMALL_PAGE = 25;
/** Scopus Search by author id: papers with the affiliation ids of THAT author. Returns null when the run is aborted. */
// Most recent first, at most 500: the recent years carry the departures, and a profile merging
// homonyms (thousands of documents) would otherwise cost dozens of requests (measured on 2026-09-30:
// 1 985 documents = 80 requests, 7 minutes, for 29 affiliated ones).
async function scopusPublications(client, scopusIds, { hierarchy, maxDocs = 500 } = {}) {
  const ids = scopusIds.filter((i) => /^\d+$/.test(i));
  if (!ids.length) return [];
  const query = ids.map((i) => `AU-ID(${i})`).join(' OR ');
  const out = [];
  // Pages of 200, with the full author list of every document: for authors of large collaborations
  // (thousands of co-authors per paper) such a page takes longer than the timeout. On a failure the
  // same page is asked again by 25, with a longer timeout, then the run goes on by 25.
  let pageSize = 200;
  for (let start = 0, total = 1; start < total && start < maxDocs; start += pageSize) {
    const fields = { query, view: 'STANDARD', sort: '-coverDate', count: String(pageSize), start: String(start), field: 'dc:identifier,dc:title,prism:coverDate,prism:doi,affiliation,author' };
    let d = await client.get('scopus_search', '/search/scopus', fields, pageSize === 200 ? { tries: 1 } : { timeout: 60000, tries: 3 });
    if (!d && !client.aborted() && pageSize === 200) {
      pageSize = SMALL_PAGE;
      d = await client.get('scopus_search', '/search/scopus', { ...fields, count: String(pageSize) }, { timeout: 60000, tries: 3 });
    }
    if (!d) { if (client.aborted()) return null; throw new Error('Scopus Search failed'); }
    const sr = d['search-results'] || {};
    total = parseInt(sr['opensearch:totalResults'] || '0', 10) || 0;
    for (const e of arr(sr.entry)) {
      if (e.error) continue;
      const affs = {};
      for (const a of arr(e.affiliation)) {
        affs[a.afid] = { name: a.affilname, city: a['affiliation-city'], country: a['affiliation-country'] };
        if (hierarchy && a.afid && !hierarchy.scopus[a.afid]) hierarchy.scopus[a.afid] = { name: a.affilname || '', city: a['affiliation-city'] || '', country: a['affiliation-country'] || '', parent: null, partial: true };
      }
      const afids = [...new Set(arr(e.author).filter((a) => ids.includes(String(a.authid))).flatMap((a) => arr(a.afid).map((f) => f.$)))];
      out.push({ doi: e['prism:doi'] || '', sourceIds: [normSourceId(`scopus:${e['dc:identifier'] || ''}`)].filter(Boolean), year: yearOf(e['prism:coverDate']), title: e['dc:title'] || '', sources: ['scopus'], orgs: afids.map((f) => scopusOrg(f, affs[f])) });
    }
  }
  return out;
}

/**
 * Author Retrieval ENHANCED for many ids: batches of 10 (a batch of 25 answers 400 in ENHANCED), a
 * batch answering 400 (one invalid id) is split into single requests. Returns Map id → profile
 * { current:[org], history:[org], range:{start,end}, docCount } (absent = not found / error).
 */
async function scopusProfiles(client, scopusIds, { hierarchy, batch = 10 } = {}) {
  const out = new Map();
  const queue = [];
  const ids = [...new Set(scopusIds.filter((i) => /^\d+$/.test(i)))];
  for (let i = 0; i < ids.length; i += batch) queue.push(ids.slice(i, i + batch));
  const aff = (a) => {
    const d = a['ip-doc'] || {};
    const ad = d.address || {};
    const afid = String(a['@affiliation-id'] || d['@id'] || '');
    const parent = a['@parent'] ? String(a['@parent']) : null;
    if (hierarchy && afid) hierarchy.scopus[afid] = { name: d.afdispname || d['preferred-name']?.$ || '', city: ad.city || '', country: ad.country || '', parent, partial: false };
    return scopusOrg(afid, { name: d.afdispname || d['preferred-name']?.$ || '', city: ad.city, country: ad.country });
  };
  while (queue.length && !client.aborted()) {
    const b = queue.shift();
    const d = await client.get('author', `/author/author_id/${b.join(',')}`, { view: 'ENHANCED' }, { badRequestAsValue: true });
    if (!d) continue;
    if (d.badRequest || d.notFound) { if (b.length > 1) queue.unshift(...b.map((x) => [x])); continue; }
    const list = d['author-retrieval-response-list']?.['author-retrieval-response'] || d['author-retrieval-response'] || [];
    for (const r of arr(list)) {
      if (r['@status'] && r['@status'] !== 'found') continue;
      const id = String(r.coredata?.['dc:identifier'] || '').replace(/\D/g, '');
      const p = r['author-profile'] || {};
      const range = p['publication-range'] || {};
      out.set(id, {
        current: arr((p['affiliation-current'] || r['affiliation-current'] || {}).affiliation).map(aff),
        history: arr((p['affiliation-history'] || {}).affiliation).map(aff),
        range: { start: parseInt(range['@start'], 10) || null, end: parseInt(range['@end'], 10) || null },
        docCount: parseInt(r.coredata?.['document-count'] || '0', 10) || 0,
      });
    }
  }
  return out;
}

// ── ORCID ────────────────────────────────────────────────────────────────────
const orcidDate = (d) => (d ? [d.year?.value, d.month?.value, d.day?.value].filter(Boolean).join('-') : '');
async function orcidSection(orcid, section, key, kind) {
  let d;
  try { d = await getUrl(`https://pub.orcid.org/v3.0/${orcid}/${section}`, { json: true, headers: { Accept: 'application/json' }, timeout: 20000 }); }
  catch (e) { if (/HTTP (404|409|410)/.test(e.message || '')) return []; throw e; }
  const out = [];
  for (const g of d['affiliation-group'] || []) {
    const e = g.summaries?.[0]?.[key];   // one summary per group (the others are the same position from other sources)
    if (!e) continue;
    const org = e.organization || {};
    const dis = org['disambiguated-organization'] || {};
    const src = String(dis['disambiguation-source'] || '').toLowerCase();
    const idType = src === 'ror' ? 'ror' : src === 'ringgold' ? 'ringgold' : src === 'grid' ? 'grid' : null;
    out.push({
      kind, start: orcidDate(e['start-date']), end: orcidDate(e['end-date']), role: e['role-title'] || '', dept: e['department-name'] || '',
      org: makeOrg({ ids: idType ? { [idType]: dis['disambiguated-organization-identifier'] } : {}, names: [org.name], city: org.address?.city || '', country: org.address?.country || '' }),
    });
  }
  return out;
}
/** Types of the external identifiers linked to an ORCID (« Scopus Author ID », « ResearcherID »…):
 * the « link your identifiers » suggestion of the record (docs/plan-parcours-affiliations.md, lot 5). */
async function orcidExternalTypes(orcid) {
  if (!orcid) return [];
  let d;
  try { d = await getUrl(`https://pub.orcid.org/v3.0/${orcid}/external-identifiers`, { json: true, headers: { Accept: 'application/json' }, timeout: 20000 }); }
  catch (e) { if (/HTTP (404|409|410)/.test(e.message || '')) return []; throw e; }
  return [...new Set((d['external-identifier'] || []).map((x) => x['external-id-type']).filter(Boolean))];
}
/** Employments + invited positions of an ORCID (two requests). */
async function orcidPeriods(orcid) {
  if (!orcid) return [];
  return [...await orcidSection(orcid, 'employments', 'employment-summary', 'employment'), ...await orcidSection(orcid, 'invited-positions', 'invited-position-summary', 'invited')];
}

// ── Resolver (durable cache) ─────────────────────────────────────────────────
/**
 * Completes `hierarchy` for the organizations of `orgs`: OpenAlex institutions (ids, RORs, then the
 * ancestors of their lineage) and HAL structures (then their parents), by batches of 50. Entries are
 * stamped and refreshed after `ttlDays`.
 */
async function resolveHierarchy(hierarchy, orgs, { mailto = process.env.OPENALEX_MAILTO || '', apiKey = process.env.OPENALEX_API_KEY || '', ttlDays = 90 } = {}) {
  const now = Date.now();
  const old = (e) => !e.fetchedAt || now - new Date(e.fetchedAt).getTime() > ttlDays * 864e5;
  // An institution seen inside an OpenAlex authorship (`partial`: name + lineage) is good enough;
  // only absent or expired entries are fetched. Ids OpenAlex no longer returns are remembered (`missing`).
  const needsOa = (id) => { const e = hierarchy.openalex[id]; return !e || (!e.partial && old(e)); };
  const needsHal = (id) => { const e = hierarchy.hal[id]; return !e || old(e); };
  const oaAuth = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : mailto ? `&mailto=${encodeURIComponent(mailto)}` : '';
  const storeOa = (r) => {
    const id = lastSegment(r.id).toUpperCase();
    const ror = lastSegment(r.ror || '');
    hierarchy.openalex[id] = { name: r.display_name || '', country: r.country_code || '', type: r.type || '', ror, lineage: (r.lineage || []).map((l) => lastSegment(l).toUpperCase()), fetchedAt: new Date().toISOString() };
    if (ror) hierarchy.rorToOpenalex[ror] = id;
  };
  const fetchOa = async (filter, values) => {
    for (let i = 0; i < values.length; i += 50) {
      const d = await getUrl(`https://api.openalex.org/institutions?filter=${filter}:${values.slice(i, i + 50).join('|')}&per_page=50&select=id,display_name,country_code,type,lineage,ror${oaAuth}`, { json: true, timeout: 30000 });
      for (const r of d.results || []) storeOa(r);
    }
  };
  const stamp = new Date().toISOString();
  const oaIds = new Set();
  const rors = new Set();
  const hals = new Set();
  hierarchy.rorMisses = hierarchy.rorMisses || {};
  for (const o of orgs) {
    for (const v of o.ids.openalex) if (/^I\d+$/.test(v) && needsOa(v)) oaIds.add(v);
    for (const v of o.ids.ror) if (!hierarchy.rorToOpenalex[v] && !hierarchy.rorMisses[v]) rors.add(v);
    for (const v of o.ids.hal) if (/^\d+$/.test(v) && needsHal(v)) hals.add(v);
  }
  await fetchOa('openalex', [...oaIds]);
  for (const id of oaIds) if (!hierarchy.openalex[id] || hierarchy.openalex[id].partial) hierarchy.openalex[id] = { ...(hierarchy.openalex[id] || { name: '', lineage: [id] }), missing: !hierarchy.openalex[id], fetchedAt: stamp };
  if (rors.size) {
    await fetchOa('ror', [...rors]);
    for (const r of rors) if (!hierarchy.rorToOpenalex[r]) hierarchy.rorMisses[r] = stamp.slice(0, 10);
  }
  // Ancestors of the lineages (two passes are enough in practice: lab → university / organism).
  for (let pass = 0; pass < 2; pass++) {
    const anc = [...new Set(Object.values(hierarchy.openalex).flatMap((e) => e.lineage || []))].filter(needsOa);
    if (!anc.length) break;
    await fetchOa('openalex', anc);
    for (const id of anc) if (!hierarchy.openalex[id]) hierarchy.openalex[id] = { name: '', lineage: [id], missing: true, fetchedAt: stamp };
  }
  const fetchHal = async (docids) => {
    for (let i = 0; i < docids.length; i += 50) {
      const params = new URLSearchParams({ q: `docid:(${docids.slice(i, i + 50).join(' OR ')})`, fl: 'docid,name_s,type_s,country_s,parentDocid_i,ror_s', rows: '100', wt: 'json' });
      const d = await getUrl(`https://api.archives-ouvertes.fr/ref/structure/?${params}`, { json: true, timeout: 30000 });
      for (const s of d.response?.docs || []) {
        hierarchy.hal[String(s.docid)] = { name: s.name_s || '', type: s.type_s || '', country: String(s.country_s || '').toUpperCase(), ror: lastSegment((s.ror_s || [])[0] || ''), parents: (s.parentDocid_i || []).map(String), fetchedAt: new Date().toISOString() };
      }
    }
  };
  let halTodo = [...hals];
  for (let depth = 0; halTodo.length && depth < 4; depth++) {
    await fetchHal(halTodo);
    for (const d of halTodo) if (!hierarchy.hal[d]) hierarchy.hal[d] = { name: '', parents: [], missing: true, fetchedAt: stamp };
    halTodo = [...new Set(halTodo.flatMap((d) => hierarchy.hal[d]?.parents || []))].filter(needsHal);
  }
  return hierarchy;
}

function loadHierarchy(path) {
  try { return { ...emptyHierarchy(), ...JSON.parse(fs.readFileSync(path, 'utf8')) }; } catch (e) { return emptyHierarchy(); }
}
module.exports = {
  memAvailableMb, createGraphReader, normSourceId, openalexPublications, scopusPublications, scopusProfiles,
  orcidPeriods, orcidExternalTypes, resolveHierarchy, loadHierarchy,
};
