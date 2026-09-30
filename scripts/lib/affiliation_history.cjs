/**
 * affiliation_history.cjs — pure core of a researcher's « career path »
 * (docs/plan-parcours-affiliations.md, lot 1). No I/O: the readers of scripts/lib/affiliation_sources.cjs
 * turn each source into the normalized shapes below, this module classifies, merges, aggregates and
 * computes the departure signals.
 *
 * Three kinds of evidence:
 *   - observed  — affiliations of the publications (CRISalid graph, OpenAlex works, Scopus Search),
 *                 merged by DOI then by source identifier;
 *   - declared  — ORCID employments (periods) and invited positions;
 *   - profile   — Scopus Author Retrieval (affiliation history, current affiliation, publication range).
 *
 * Normalized organization (`org`), whatever the source:
 *   { ids: { openalex:[], ror:[], hal:[], scopus:[], ringgold:[], rnsr:[], grid:[] }, names:[], city, country }
 * Normalized publication: { doi, sourceIds:[], year, title, sources:[], orgs:[org] }
 * Normalized ORCID period: { org, start, end, role, dept, kind: 'employment'|'invited' }  (dates AAAA[-MM[-JJ]])
 * Normalized Scopus profile: { current:[org], history:[org], range:{ start, end }, docCount }
 */

// ── Text ─────────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const normWords = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const lastSegment = (v) => String(v || '').trim().replace(/\/+$/, '').split('/').pop();
const cleanId = (type, v) => {
  const s = lastSegment(v).trim();
  if (!s) return '';
  if (type === 'openalex') return s.toUpperCase();
  if (type === 'ror' || type === 'grid') return s.toLowerCase();
  return s;
};
const uniq = (a) => [...new Set(a.filter(Boolean))];
const ID_TYPES = ['openalex', 'ror', 'hal', 'scopus', 'ringgold', 'rnsr', 'grid'];

function emptyIds() { return Object.fromEntries(ID_TYPES.map((t) => [t, []])); }
/** Normalized organization from loose parts (ids as { type: value | [values] }). */
function makeOrg({ ids = {}, names = [], city = '', country = '' } = {}) {
  const out = emptyIds();
  for (const [t, v] of Object.entries(ids || {})) {
    const type = t === 'nns' ? 'rnsr' : t;
    if (!out[type]) continue;
    for (const x of Array.isArray(v) ? v : [v]) { const c = cleanId(type, x); if (c && !out[type].includes(c)) out[type].push(c); }
  }
  return { ids: out, names: uniq((Array.isArray(names) ? names : [names]).map((n) => String(n || '').trim())), city: String(city || '').trim(), country: String(country || '').trim().toUpperCase() };
}

// ── Configuration (per instance, D2) ─────────────────────────────────────────
/** Organisms present on every UMR paper whatever the city: shown, ignored by the signals. */
const DEFAULT_NEUTRAL_NAMES = [
  'centre national de la recherche scientifique', 'cnrs', 'inserm', 'institut national de la sante et de la recherche medicale',
  'inrae', "institut national de recherche pour l agriculture l alimentation et l environnement", 'ird',
  'institut de recherche pour le developpement', 'inria', 'institut national de recherche en informatique et en automatique',
  'institut national de recherche en sciences et technologies du numerique', 'cea',
  'commissariat a l energie atomique et aux energies alternatives',
];
const DEFAULT_NEUTRAL_IDS = { openalex: ['I1294671590', 'I154526488', 'I4210088668', 'I4210166444', 'I1326498283', 'I2738703131'] };

/**
 * Build the matcher of an instance.
 *   config = { local: { ids:{type:[…]}, names:[…] }, site: { ids, names }, neutral: { ids, names }, area: { cities:[…] } }
 *     local  — the establishment itself (and its former names);
 *     site   — other establishments counted as local (D2 variant D: CHU, Centrale…);
 *     neutral— national organisms (defaults above are always included);
 *     area   — cities whose labs count as local when no establishment is identified (ORCID / Scopus).
 *   structures = rows of the Druid Structures table, normalized { ids:{rnsr,ror,scopus,hal,…}, names:[…] }:
 *     every structure of the instance counts as local (D2 variant D).
 */
function createMatcher(config = {}, structures = []) {
  const idSets = (kind) => {
    const sets = Object.fromEntries(ID_TYPES.map((t) => [t, new Set()]));
    const add = (ids) => { for (const [t, v] of Object.entries(ids || {})) { const type = t === 'nns' ? 'rnsr' : t; if (!sets[type]) continue; for (const x of Array.isArray(v) ? v : [v]) { const c = cleanId(type, x); if (c) sets[type].add(c); } } };
    if (kind === 'local') { add(config.local?.ids); add(config.site?.ids); for (const s of structures) add(s.ids); }
    else { add(DEFAULT_NEUTRAL_IDS); add(config.neutral?.ids); }
    return sets;
  };
  const localIds = idSets('local');
  const neutralIds = idSets('neutral');
  const localNames = new Set([...(config.local?.names || []), ...(config.site?.names || []), ...structures.flatMap((s) => s.names || [])].map(norm).filter((n) => n.length >= 4));
  const neutralNames = new Set([...DEFAULT_NEUTRAL_NAMES, ...(config.neutral?.names || [])].map(norm));
  // Neutral organisms also appear as « CNRS Délégation Bretagne et Pays de la Loire », « INSERM U1234 »…
  const neutralPrefixes = [...neutralNames].filter((n) => n.length <= 6);
  const cities = new Set((config.area?.cities || []).map(norm));
  const hit = (sets, org) => ID_TYPES.some((t) => (org.ids[t] || []).some((v) => sets[t].has(v)));
  return {
    isLocal: (org) => hit(localIds, org) || org.names.some((n) => localNames.has(norm(n))),
    isNeutral: (org) => hit(neutralIds, org) || org.names.some((n) => { const k = norm(n); return neutralNames.has(k) || neutralPrefixes.some((p) => k.startsWith(p) && /^(cnrs|inserm|inrae|inria|ird|cea)\b/.test(normWords(n))); }),
    inArea: (org) => !!org.city && cities.has(norm(org.city)),
  };
}

// ── Hierarchy (establishment of an organization) ─────────────────────────────
/**
 * Reference tables filled by the resolver (durable cache org_hierarchy_cache.json):
 *   openalex: { I… : { name, country, type, ror, lineage:[I…] } }
 *   hal:      { docid : { name, type, country, ror, parents:[docid] } }
 *   scopus:   { afid : { name, city, country, parent } }
 *   rorToOpenalex: { ror : I… }
 */
function emptyHierarchy() { return { openalex: {}, hal: {}, scopus: {}, rorToOpenalex: {} }; }

const HAL_INSTITUTION_TYPES = new Set(['institution', 'regroupinstitution']);
/** Chain of the organization: itself then its ancestors, as normalized orgs tagged `root` when top-level. */
function chainOf(org, H) {
  const chain = [{ ...org, self: true }];
  const seen = new Set();
  const push = (o) => { const k = JSON.stringify(o.ids) + o.names.join('|'); if (!seen.has(k)) { seen.add(k); chain.push(o); } };
  const oaIds = uniq([...org.ids.openalex, ...org.ids.ror.map((r) => H.rorToOpenalex[r])]);
  for (const id of oaIds) {
    const inst = H.openalex[id];
    if (!inst) continue;
    for (const a of inst.lineage || []) {
      if (a === id) continue;
      const anc = H.openalex[a];
      if (anc) push({ ...makeOrg({ ids: { openalex: a, ror: anc.ror }, names: [anc.name], country: anc.country }), root: (anc.lineage || []).length <= 1, type: anc.type });
    }
    if ((inst.lineage || []).length <= 1) chain[0].root = true;
    if (!chain[0].names.length && inst.name) chain[0].names = [inst.name];
    if (!chain[0].ids.ror.length && inst.ror) chain[0].ids = { ...chain[0].ids, ror: [cleanId('ror', inst.ror)] };
    chain[0].type = chain[0].type || inst.type;
    if (!chain[0].country && inst.country) chain[0].country = inst.country;
  }
  const walkHal = (docid, depth) => {
    const s = H.hal[docid];
    if (!s || depth > 5) return;
    for (const p of s.parents || []) {
      const ps = H.hal[p];
      if (!ps) continue;
      push({ ...makeOrg({ ids: { hal: p, ror: ps.ror }, names: [ps.name], country: ps.country }), root: !(ps.parents || []).length, type: ps.type });
      walkHal(p, depth + 1);
    }
  };
  for (const d of org.ids.hal) {
    const s = H.hal[d];
    if (!s) continue;
    if (!chain[0].type) chain[0].type = s.type;
    if (!chain[0].names.length && s.name) chain[0].names = [s.name];
    if (!chain[0].country && s.country) chain[0].country = String(s.country).toUpperCase();
    if (!(s.parents || []).length) chain[0].root = true;
    walkHal(d, 0);
  }
  for (const a of org.ids.scopus) {
    const s = H.scopus[a];
    if (!s) continue;
    if (!chain[0].names.length && s.name) chain[0].names = [s.name];
    if (!chain[0].city && s.city) chain[0].city = s.city;
    if (!chain[0].country && s.country) chain[0].country = s.country;
    if (s.parent && H.scopus[s.parent]) {
      const p = H.scopus[s.parent];
      push({ ...makeOrg({ ids: { scopus: s.parent }, names: [p.name], city: p.city, country: p.country }), root: true, type: 'institution' });
    } else if (!s.parent) chain[0].root = true;
  }
  return chain;
}

const orgKey = (o) => (o.ids.ror[0] ? `ror:${o.ids.ror[0]}` : o.ids.openalex[0] ? `openalex:${o.ids.openalex[0]}` : `name:${norm(o.names[0] || '')}`);
const orgName = (o) => o.names[0] || o.ids.ror[0] || o.ids.openalex[0] || o.ids.hal[0] || o.ids.scopus[0] || '?';
/** Top-level organization (OpenAlex root, HAL institution, Scopus parent) — candidate establishment. */
const isEstablishmentType = (o) => !!o.root || HAL_INSTITUTION_TYPES.has(o.type);
/** Government umbrella at the top of some OpenAlex lineages (a national library → « Gouvernement de la
 * République française »): never the establishment, the node below it is. */
const UMBRELLA = /^(gouvernement|government|minist[eè]re|ministry|ministerio|bundesministerium|r[ée]publique fran[cç]aise)\b/i;
const isUmbrella = (o) => o.names.some((n) => UMBRELLA.test(n));

/**
 * Class of an organization: 'local' | 'neutral' | 'other' | 'unknown', with its establishment
 * (top-level non-neutral organization of the chain) and, when distinct, the lab.
 */
function classifyOrg(org, matcher, H) {
  const chain = chainOf(org, H);
  const self = chain[0];
  const lab = (e) => (e && orgKey(e) !== orgKey(self) ? { key: orgKey(self), name: orgName(self) } : null);
  const localNode = chain.find((o) => matcher.isLocal(o));
  if (localNode) {
    // Establishment = the top-most local node (Nantes Université rather than one of its labs).
    const locals = chain.filter((o) => matcher.isLocal(o));
    const est = locals.find((o) => o.root) || locals[locals.length - 1];
    return { cls: 'local', establishment: { key: orgKey(est), name: orgName(est), country: est.country || self.country || '' }, lab: lab(est) };
  }
  const roots = chain.filter((o) => isEstablishmentType(o) && !matcher.isNeutral(o) && !isUmbrella(o));
  let est = roots.find((o) => !o.self) || roots[0];
  // Only an umbrella above: the organization itself (or the node just below the umbrella) is the establishment.
  if (!est && chain.some(isUmbrella)) est = chain.find((o) => !isUmbrella(o) && !matcher.isNeutral(o));
  if (est) return { cls: 'other', establishment: { key: orgKey(est), name: orgName(est), country: est.country || self.country || '' }, lab: lab(est) };
  if (chain.some((o) => matcher.isNeutral(o))) {
    const n = chain.find((o) => matcher.isNeutral(o) && o.root) || chain.find((o) => matcher.isNeutral(o));
    return { cls: 'neutral', establishment: { key: orgKey(n), name: orgName(n), country: n.country || self.country || '' }, lab: lab(n) };
  }
  if (matcher.inArea(self)) return { cls: 'local', establishment: { key: `name:${norm(self.names[0] || self.city)}`, name: orgName(self), country: self.country || '' }, lab: null };
  if (self.names.length || ID_TYPES.some((t) => self.ids[t].length)) return { cls: 'other', establishment: { key: orgKey(self), name: orgName(self), country: self.country || '' }, lab: null };
  return { cls: 'unknown', establishment: null, lab: null };
}

// ── Publications: merge ──────────────────────────────────────────────────────
const normDoi = (d) => String(d || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:/, '');
/**
 * Union of the publication lists of several sources: same DOI ⇒ one publication, else same source
 * identifier (an OpenAlex W-id or a Scopus EID seen by the graph and by the direct API). The year of
 * the first source that has one wins (sources are given in priority order), orgs are unioned.
 */
function mergePublications(...lists) {
  const out = [];
  const byKey = new Map();
  for (const list of lists) {
    for (const p of list || []) {
      const keys = uniq([normDoi(p.doi) && `doi:${normDoi(p.doi)}`, ...(p.sourceIds || []).map((s) => `src:${String(s).toLowerCase()}`)]);
      let target = keys.map((k) => byKey.get(k)).find(Boolean);
      if (!target) {
        target = { doi: normDoi(p.doi), sourceIds: [], year: p.year || null, title: p.title || '', sources: [], orgs: [] };
        out.push(target);
      }
      if (!target.doi && p.doi) target.doi = normDoi(p.doi);
      if (!target.year && p.year) target.year = p.year;
      if (!target.title && p.title) target.title = p.title;
      target.sourceIds = uniq([...target.sourceIds, ...(p.sourceIds || [])]);
      target.sources = uniq([...target.sources, ...(p.sources || [])]);
      target.orgs.push(...(p.orgs || []));
      for (const k of uniq([target.doi && `doi:${target.doi}`, ...target.sourceIds.map((s) => `src:${String(s).toLowerCase()}`)])) byKey.set(k, target);
    }
  }
  return out;
}

// ── Aggregation ──────────────────────────────────────────────────────────────
/**
 * Classify every publication and aggregate by establishment × year.
 * Returns { pubs: [{ year, doi, title, sources, classes:[…], est:[key] }], establishments: [...], totals }.
 * A publication signed local AND elsewhere counts for both establishments, but its signal class is
 * « local » (a joint position is not a departure).
 */
function aggregate(publications, matcher, H) {
  const ests = new Map();
  const estsByName = new Map();   // the same establishment met with two keys (ROR from OpenAlex, name from HAL)
  const pubs = [];
  let withAffiliation = 0, undated = 0;
  publications.forEach((p, idx) => {
    const classes = new Set();
    const estKeys = [];
    const labsSeen = new Set();
    for (const org of p.orgs || []) {
      const c = classifyOrg(org, matcher, H);
      if (c.cls === 'unknown' || !c.establishment) continue;
      classes.add(c.cls);
      let e = ests.get(c.establishment.key) || estsByName.get(norm(c.establishment.name));
      if (!e) { e = { key: c.establishment.key, name: c.establishment.name, country: c.establishment.country, cls: c.cls, byYear: {}, count: 0, first: null, last: null, labs: {}, pubs: [] }; estsByName.set(norm(c.establishment.name), e); }
      ests.set(c.establishment.key, e);
      if (c.cls === 'local') e.cls = 'local';
      if (!e.country && c.establishment.country) e.country = c.establishment.country;
      if (c.lab && !labsSeen.has(`${e.key}|${c.lab.name}`)) { labsSeen.add(`${e.key}|${c.lab.name}`); e.labs[c.lab.name] = (e.labs[c.lab.name] || 0) + 1; }
      if (e.pubs[e.pubs.length - 1] !== idx) {
        e.pubs.push(idx); e.count++;
        if (p.year) { e.byYear[p.year] = (e.byYear[p.year] || 0) + 1; e.first = e.first ? Math.min(e.first, p.year) : p.year; e.last = e.last ? Math.max(e.last, p.year) : p.year; }
        estKeys.push(e.key);
      }
    }
    if (classes.size) withAffiliation++;
    if (!p.year) undated++;
    if (classes.has('local')) classes.delete('other');
    pubs.push({ year: p.year || null, doi: p.doi || '', title: p.title || '', sources: p.sources || [], classes: [...classes], est: estKeys });
  });
  const establishments = [...new Set(ests.values())]
    .map((e) => ({ ...e, labs: Object.entries(e.labs).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) }))
    .sort((a, b) => (b.last || 0) - (a.last || 0) || b.count - a.count);
  return { pubs, establishments, totals: { pubs: publications.length, withAffiliation, undated } };
}

// ── ORCID periods ────────────────────────────────────────────────────────────
const PHD_ROLE = /(ph\.? ?d|doctora|doctoral|th[eè]se|thesis)/i;
/** Classify the ORCID periods (employment + invited) with the same matcher. */
function classifyPeriods(periods, matcher, H) {
  return (periods || []).map((p) => {
    const c = classifyOrg(p.org, matcher, H);
    return { ...p, cls: c.cls, establishment: c.establishment, lab: c.lab, inArea: matcher.inArea(p.org) };
  });
}
/** The whole period `d` (AAAA, AAAA-MM or AAAA-MM-JJ) is over — same rule as isFuzzyDatePast (lib/dates.ts). */
const isPast = (d, today) => {
  const s = String(d || '').trim();
  if (!s) return false;
  return s.length >= 10 ? s.slice(0, 10) < today : s < today.slice(0, s.length);
};

// ── Signals ──────────────────────────────────────────────────────────────────
const DEFAULT_THRESHOLDS = { lag: 2, minAfter: 3, minYears: 2, dominantWindow: 3, dominantMin: 3, dominantRatio: 2, confirmGap: 1, suspectMinPubs: 5, stillLocalGap: 2 };

/**
 * Departure / consistency signals (plan § 1, table « Signaux », decisions D3, D7, D10).
 *   agg      — result of aggregate()
 *   periods  — classifyPeriods() of the ORCID employments and invited positions
 *   profile  — Scopus profile { current:[classified], history:[classified], range } or null
 *   record   — { employmentStart, employmentEnd, membershipEnd, isDoctorant } of the Druid record
 *   today    — 'AAAA-MM-JJ'
 */
function computeSignals({ agg, periods = [], profile = null, record = {}, today, thresholds = {} }) {
  const T = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const N = parseInt(today.slice(0, 4), 10);
  const out = [];
  const dated = agg.pubs.filter((p) => p.year);
  const localYears = dated.filter((p) => p.classes.includes('local')).map((p) => p.year);
  const firstLocal = localYears.length ? Math.min(...localYears) : null;
  const lastLocal = localYears.length ? Math.max(...localYears) : null;
  const estName = (k) => agg.establishments.find((e) => e.key === k)?.name || '';
  const destinationAfter = (y) => {
    const c = {};
    for (const p of dated) if (p.year > y && p.classes.includes('other')) for (const k of p.est) { const e = agg.establishments.find((x) => x.key === k); if (e && e.cls === 'other') c[k] = (c[k] || 0) + 1; }
    const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return best ? estName(best[0]) : '';
  };
  const hasEnd = !!(record.employmentEnd || record.membershipEnd);
  const endPast = [record.employmentEnd, record.membershipEnd].some((d) => d && isPast(d, today));

  // Observed departure: rule 1 (last local year) or rule 2 (elsewhere dominant over the last complete years).
  let observed = null;
  if (lastLocal !== null) {
    const after = dated.filter((p) => p.year > lastLocal && p.classes.includes('other'));
    if (lastLocal <= N - T.lag && after.length >= T.minAfter && new Set(after.map((p) => p.year)).size >= T.minYears) {
      observed = { rule: 'last_local', year: lastLocal, count: after.length, destination: destinationAfter(lastLocal) };
    } else {
      const lo = N - T.dominantWindow, hi = N - 1;
      const w = dated.filter((p) => p.year >= lo && p.year <= hi);
      const L = w.filter((p) => p.classes.includes('local')).length;
      const O = w.filter((p) => p.classes.includes('other')).length;
      if (O >= T.dominantMin && O >= T.dominantRatio * Math.max(L, 0.5)) {
        const firstOther = Math.min(...w.filter((p) => p.classes.includes('other')).map((p) => p.year));
        observed = { rule: 'dominant', year: Math.max(lastLocal < firstOther ? lastLocal : firstOther - 1, firstLocal), count: O, local: L, destination: destinationAfter(firstOther - 1) };
      }
    }
  }
  // Invited position (secondment, stay abroad) covering the « elsewhere » years neutralizes it.
  if (observed) {
    const cover = periods.find((p) => p.kind === 'invited' && p.cls === 'other' && p.start && parseInt(p.start, 10) <= observed.year + 1 && (!p.end || parseInt(p.end, 10) >= N - 1));
    if (cover) observed.neutralizedBy = { kind: 'invited', name: cover.establishment?.name || '', start: cover.start, end: cover.end || '' };
  }

  // Declared departure (ORCID).
  const emp = periods.filter((p) => p.kind === 'employment');
  const loc = emp.filter((p) => p.cls === 'local');
  const locNonPhd = loc.filter((p) => !PHD_ROLE.test(p.role || ''));
  const relevantLoc = locNonPhd.length || record.isDoctorant ? (locNonPhd.length ? locNonPhd : loc) : [];
  const openLocal = loc.some((p) => !p.end) || emp.some((p) => p.cls === 'neutral' && !p.end && p.inArea);
  let declared = null, newPost = null;
  if (relevantLoc.length && !openLocal && relevantLoc.every((p) => p.end && isPast(p.end, today))) {
    const end = relevantLoc.map((p) => p.end).sort().pop();
    declared = { end, establishment: relevantLoc.find((p) => p.end === end)?.establishment?.name || '' };
  }
  const lastLocStart = loc.map((p) => p.start || '').sort().pop() || '';
  const np = emp.filter((p) => p.cls === 'other' && !p.end && p.start && p.start >= lastLocStart).sort((a, b) => String(a.start).localeCompare(String(b.start))).pop();
  if (np && loc.length && !openLocal) newPost = { start: np.start, establishment: np.establishment?.name || orgName(np.org), country: np.establishment?.country || np.org.country || '' };

  // Scopus current affiliation not local while the history was local.
  let scopusCurrent = null;
  if (profile && profile.current.length) {
    const cur = profile.current.filter((c) => c.cls !== 'unknown');
    const histLocal = [...profile.history, ...profile.current].some((c) => c.cls === 'local');
    if (cur.length && !cur.some((c) => c.cls === 'local') && cur.some((c) => c.cls === 'other') && histLocal) {
      scopusCurrent = { establishment: cur.find((c) => c.cls === 'other')?.establishment?.name || '', lastPub: profile.range?.end || null };
    }
  }

  if (!hasEnd) {
    if (declared) out.push({ type: 'depart_declare', strength: 'strong', date: declared.end, establishment: declared.establishment, ...(newPost ? { destination: newPost.establishment, destinationStart: newPost.start } : {}) });
    if (newPost && !declared) out.push({ type: 'nouveau_poste_declare', strength: 'strong', date: newPost.start, destination: newPost.establishment });
    if (observed && !observed.neutralizedBy) out.push({ type: 'depart_observe', strength: 'medium', date: String(observed.year), rule: observed.rule, count: observed.count, destination: observed.destination });
    if (scopusCurrent) out.push({ type: 'scopus_courante_non_locale', strength: 'medium', destination: scopusCurrent.establishment, lastPub: scopusCurrent.lastPub });
    // Confirmed: at least two independent sources agree within confirmGap years.
    const years = [];
    if (declared) years.push(['orcid', parseInt(declared.end, 10)]);
    else if (newPost) years.push(['orcid', parseInt(newPost.start, 10) - 1]);
    if (observed && !observed.neutralizedBy) years.push(['publications', observed.year]);
    if (scopusCurrent) years.push(['scopus', observed ? observed.year : (years[0]?.[1] ?? null)]);
    const pairs = years.filter(([, y]) => y !== null);
    if (pairs.length >= 2 && Math.max(...pairs.map(([, y]) => y)) - Math.min(...pairs.map(([, y]) => y)) <= T.confirmGap) {
      // D7: the ORCID date wins (declared, month precision), the gap is shown.
      const date = declared ? declared.end : newPost ? String(parseInt(newPost.start, 10) - 1) : String(observed.year);
      out.unshift({ type: 'depart_confirme', strength: 'very_strong', date, sources: pairs.map(([s]) => s), destination: newPost?.establishment || observed?.destination || scopusCurrent?.establishment || '' });
    }
  }
  // Arrival: suggestion when the Druid start date is missing.
  if (!record.employmentStart) {
    const orcidStart = loc.map((p) => p.start || '').filter(Boolean).sort()[0] || '';
    if (orcidStart || firstLocal) out.push({ type: 'arrivee', strength: 'suggestion', date: orcidStart || String(firstLocal), source: orcidStart ? 'orcid' : 'publications' });
  }
  // Suspect identifier: publications with affiliations, never a local one.
  const affPubs = agg.pubs.filter((p) => p.classes.length).length;
  const profileNeverLocal = profile && (profile.history.length || profile.current.length) && ![...profile.history, ...profile.current].some((c) => c.cls === 'local');
  if ((affPubs >= T.suspectMinPubs && lastLocal === null) || profileNeverLocal) {
    out.push({ type: 'identifiant_suspect', strength: 'control', sources: [...(affPubs >= T.suspectMinPubs && lastLocal === null ? ['publications'] : []), ...(profileNeverLocal ? ['scopus'] : [])] });
  }
  // Inconsistent status (D10): the record is ended but the person still publishes locally / holds an open local post.
  if (endPast) {
    const endYear = Math.max(...[record.employmentEnd, record.membershipEnd].filter(Boolean).map((d) => parseInt(d, 10)));
    const stillLocal = lastLocal !== null && lastLocal >= endYear + T.stillLocalGap;
    if (stillLocal || openLocal) out.push({ type: 'statut_incoherent', strength: 'control', endYear, ...(stillLocal ? { lastLocal } : {}), ...(openLocal ? { orcidOpenLocal: true } : {}) });
  }
  return { signals: out, firstLocal, lastLocal };
}

module.exports = {
  norm, normDoi, makeOrg, createMatcher, emptyHierarchy, chainOf, classifyOrg, orgKey,
  mergePublications, aggregate, classifyPeriods, computeSignals, DEFAULT_THRESHOLDS, DEFAULT_NEUTRAL_NAMES,
};
