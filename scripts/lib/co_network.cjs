/**
 * co_network.cjs — Inter-lab co-authorship graph of the « Réseau » tab
 * (docs/archive/plan-reseau-inter-labos.md, lots 2 and 4).
 *
 * Input: the network.json of a composite structure (druid-biblio
 * biblio_etl/network_export.py): authors resolved to their lab(s) with per-year publication
 * counts, and the dated publications signed by at least two of them. The links are recomputed
 * here for the requested labs, period and size filter.
 * Pure: no file or network access, testable offline.
 */

/** Category of the aggregated lab nodes (translated by the frontend). */
const OTHER_LABS_CATEGORY = '__other_labs__';

const authorNodeId = (id) => `a:${id}`;
const labNodeId = (acronym) => `lab:${acronym}`;

/**
 * @param net network.json content
 * @param opts {
 *   labs: string[]            — expanded labs (acronyms), focus lab first;
 *   from, to: number          — year range (inclusive);
 *   minPubs: number           — minimum publications of an author over the period;
 *   maxAuthors: number|null   — ignore publications with more authors (large collaborations);
 *   crossOnly: boolean        — keep only links between authors without a common lab;
 *   aggregateOthers: boolean  — the labs not expanded become one node each;
 *   visibleLabs: string[]|null — labs whose authors are always shown (null = no restriction);
 *                               the other authors only when they co-signed with one of them;
 *   maxNodes: number          — cap on author nodes (most prolific kept).
 * }
 * @returns {nodes, links, categories, truncated}
 */
function buildInterLabNetwork(net, opts) {
  const labs = [...new Set(opts.labs || [])];
  const expanded = new Set(labs);
  const from = opts.from ?? -Infinity;
  const to = opts.to ?? Infinity;
  const minPubs = Math.max(1, opts.minPubs ?? 1);
  const maxAuthors = opts.maxAuthors ?? null;
  const maxNodes = opts.maxNodes ?? 400;
  const visible = opts.visibleLabs ? new Set(opts.visibleLabs) : null;

  const authors = new Map(net.authors.map((a) => [a.id, a]));
  const pubCount = (a) => {
    let n = 0;
    for (const [y, c] of Object.entries(a.pubs || {})) {
      const year = Number(y);
      if (year >= from && year <= to) n += c;
    }
    return n;
  };
  const isMember = (a) => a.labs.some((l) => expanded.has(l));

  const kept = new Map(); // id -> publication count
  for (const a of net.authors) {
    if (!isMember(a)) continue;
    const n = pubCount(a);
    if (n >= minPubs) kept.set(a.id, n);
  }

  const shareLab = (a, b) => a.labs.some((l) => b.labs.includes(l));
  const edges = new Map(); // "src|dst" -> {source, target, value, cross}
  const labNodeValue = new Map(); // acronym -> co-publications with the expanded labs
  const addEdge = (source, target, cross) => {
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    const e = edges.get(key);
    if (e) e.value += 1;
    else edges.set(key, { source, target, value: 1, cross });
  };

  for (const p of net.pubs) {
    if (p.y < from || p.y > to) continue;
    if (maxAuthors != null && p.n != null && p.n > maxAuthors) continue;
    const inside = p.a.filter((id) => kept.has(id));
    for (let i = 0; i < inside.length; i++) {
      for (let j = i + 1; j < inside.length; j++) {
        const a = authors.get(inside[i]);
        const b = authors.get(inside[j]);
        addEdge(authorNodeId(a.id), authorNodeId(b.id), !shareLab(a, b));
      }
    }
    if (!opts.aggregateOthers || inside.length === 0) continue;
    // Labs not expanded: one link per (expanded author, lab) and publication.
    const outsideLabs = new Set();
    for (const id of p.a) {
      const a = authors.get(id);
      if (!a || isMember(a)) continue;
      for (const l of a.labs) if (!expanded.has(l)) outsideLabs.add(l);
    }
    for (const l of outsideLabs) {
      labNodeValue.set(l, (labNodeValue.get(l) ?? 0) + 1);
      for (const id of inside) addEdge(authorNodeId(id), labNodeId(l), true);
    }
  }

  let links = [...edges.values()];
  let authorIds = new Set(kept.keys());

  if (visible) {
    const isVisible = (id) => authors.get(id).labs.some((l) => visible.has(l));
    const neighbours = new Set();
    for (const e of links) {
      const [s, t] = [e.source, e.target];
      if (!s.startsWith('a:') || !t.startsWith('a:')) continue;
      const si = Number(s.slice(2));
      const ti = Number(t.slice(2));
      if (isVisible(si)) neighbours.add(ti);
      if (isVisible(ti)) neighbours.add(si);
    }
    authorIds = new Set([...authorIds].filter((id) => isVisible(id) || neighbours.has(id)));
  }

  const alive = (nodeId) =>
    nodeId.startsWith('lab:') || authorIds.has(Number(nodeId.slice(2)));
  links = links.filter((e) => alive(e.source) && alive(e.target));

  if (opts.crossOnly) {
    links = links.filter((e) => e.cross);
    const linked = new Set(links.flatMap((e) => [e.source, e.target]));
    authorIds = new Set([...authorIds].filter((id) => linked.has(authorNodeId(id))));
  }

  // Cap: most prolific authors first.
  let truncated = 0;
  if (authorIds.size > maxNodes) {
    const sorted = [...authorIds].sort((x, y) => kept.get(y) - kept.get(x) || x - y);
    truncated = sorted.length - maxNodes;
    authorIds = new Set(sorted.slice(0, maxNodes));
  }
  links = links.filter((e) => alive(e.source) && alive(e.target));
  const linkedLabs = new Set(
    links.flatMap((e) => [e.source, e.target]).filter((id) => id.startsWith('lab:')),
  );

  const categoryNames = [...labs];
  const hasLabNodes = linkedLabs.size > 0;
  if (hasLabNodes) categoryNames.push(OTHER_LABS_CATEGORY);
  const categoryOf = (a) => {
    const idx = labs.findIndex((l) => a.labs.includes(l));
    return idx >= 0 ? idx : 0;
  };

  const nodes = [...authorIds]
    .sort((x, y) => kept.get(y) - kept.get(x) || x - y)
    .map((id) => {
      const a = authors.get(id);
      return {
        id: authorNodeId(id),
        name: a.label,
        value: kept.get(id),
        category: categoryOf(a),
        labs: a.labs,
        kind: 'author',
      };
    });
  for (const l of [...linkedLabs].sort()) {
    const acronym = l.slice(4);
    nodes.push({
      id: l,
      name: acronym,
      value: labNodeValue.get(acronym) ?? 0,
      category: categoryNames.length - 1,
      labs: [acronym],
      kind: 'lab',
    });
  }

  return { nodes, links, categories: categoryNames.map((name) => ({ name })), truncated };
}

/**
 * Publications behind a link of the graph (lot 4): `a` / `b` are node ids (`a:<id>` or
 * `lab:<acronym>`). `requireLabs` (restricted access): only publications co-signed by an author
 * of one of these labs. Most recent first.
 */
function commonPublications(net, { a, b, from, to, maxAuthors = null, requireLabs = null }) {
  const authors = new Map(net.authors.map((x) => [x.id, x]));
  const matcher = (nodeId) => {
    if (nodeId.startsWith('lab:')) {
      const acronym = nodeId.slice(4);
      return (ids) => ids.some((id) => authors.get(id)?.labs.includes(acronym));
    }
    const id = Number(nodeId.slice(2));
    return (ids) => ids.includes(id);
  };
  const hasA = matcher(a);
  const hasB = matcher(b);
  const required = requireLabs ? new Set(requireLabs) : null;
  return net.pubs
    .filter((p) => (from == null || p.y >= from) && (to == null || p.y <= to))
    .filter((p) => maxAuthors == null || p.n == null || p.n <= maxAuthors)
    .filter((p) => hasA(p.a) && hasB(p.a))
    .filter((p) => !required || p.a.some((id) => authors.get(id)?.labs.some((l) => required.has(l))))
    .sort((x, y) => y.y - x.y)
    .map((p) => ({ year: p.y, title: p.title, doi: p.doi, authorCount: p.n }));
}

// ── Researcher pairs (druid-internal `docs/archive/plan-binomes-chercheurs.md`, lot 1) ─────────────────────
// The links of the graph, aggregated over the whole university without node cap: who co-signs with
// whom across labs and poles. Uses the fields of network.json v3 when present (authors[].f profile
// of OpenAlex fields, authors[].m lab memberships, authors[].uid) and degrades without them.

/** Default disciplinary distance from which a pair counts as « distant profiles » (D10: cosine < 0.5). */
const DISTANT_PROFILES = 0.5;
/** Kinds of lab membership kept by each value of the `membership` option (authors[].m). */
const MEMBERSHIP_KINDS = {
  members: new Set(['stat']),
  associates: new Set(['stat', 'assoc']),
};

const cosineDistance = (x, y) => {
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (const [k, v] of x) { nx += v * v; dot += v * (y.get(k) ?? 0); }
  for (const v of y.values()) ny += v * v;
  if (nx === 0 || ny === 0) return null;
  return Math.max(0, 1 - dot / Math.sqrt(nx * ny));
};

/**
 * Authors that can belong to a pair (with the labs kept by the membership filter, their poles, whether they
 * are in the structure and visible to the viewer) and the rule deciding whether two of them form an allowed
 * pair. Shared by rankPairs and suggestPairs (options documented with rankPairs).
 */
function pairUniverse(net, opts, { includePhd }) {
  const crossLab = opts.crossLab !== false;
  const kinds = MEMBERSHIP_KINDS[opts.membership] ?? null;
  const structure = opts.structureLabs ? new Set(opts.structureLabs) : null;
  const visible = opts.visibleLabs ? new Set(opts.visibleLabs) : null;
  const [poleA, poleB] = opts.poles ?? [];
  const [labA, labB] = opts.labPair ?? [];
  const authorId = opts.authorId ?? null;
  const poleOf = new Map(net.labs.map((l) => [l.acronym, l.pole ?? null]));

  const eligible = new Map();
  for (const a of net.authors) {
    if (!includePhd && a.phd) continue;
    const labs = kinds && a.m ? a.labs.filter((l) => kinds.has(a.m[l])) : a.labs;
    if (labs.length === 0) continue;
    const poles = [...new Set(labs.map((l) => poleOf.get(l)).filter(Boolean))];
    eligible.set(a.id, {
      a,
      labs,
      poles,
      inStructure: !structure || labs.some((l) => structure.has(l)),
      visible: !visible || a.labs.some((l) => visible.has(l)),
    });
  }

  const pairAllowed = (x, y) => {
    if (authorId != null && x.a.id !== authorId && y.a.id !== authorId) return false;
    if (opts.scope === 'structure' ? !(x.inStructure && y.inStructure) : !(x.inStructure || y.inStructure)) return false;
    if (!x.visible && !y.visible) return false;
    if (crossLab && x.labs.some((l) => y.labs.includes(l))) return false;
    if (opts.crossPole && (!x.poles.length || !y.poles.length || x.poles.some((p) => y.poles.includes(p)))) return false;
    const either = (key, A, B) => (x[key].includes(A) && y[key].includes(B)) || (x[key].includes(B) && y[key].includes(A));
    if (poleA && poleB && !either('poles', poleA, poleB)) return false;
    if (labA && labB && !either('labs', labA, labB)) return false;
    return true;
  };
  return { eligible, pairAllowed };
}

/**
 * @param net network.json content
 * @param opts {
 *   structureLabs: string[]|null — labs of the current structure (null = the whole university);
 *   scope: 'all' | 'structure'  — at least one author in the structure, or both;
 *   from, to: number            — year range (inclusive) of the counted joint publications;
 *   minShared: number           — minimum joint publications over the period (default 2);
 *   maxAuthors: number|null     — ignore publications with more authors (large collaborations);
 *   crossLab: boolean           — no common lab (default true);
 *   crossPole: boolean          — no common pole, both poles known;
 *   poles: [string, string]|null — one author in pole A, the other in pole B;
 *   labPair: [string, string]|null — one author in lab A, the other in lab B (cell of the lab matrix);
 *   minDistance: number|null    — keep the pairs whose disciplinary distance is at least this;
 *   includePhd: boolean         — keep the PhD students (default true);
 *   membership: 'all' | 'associates' | 'members' — labs kept for an author: every lab, the labs where the
 *                                 directory lists them (member or associate), or as a member only;
 *   visibleLabs: string[]|null  — restricted access: one author at least in these labs;
 *   authorId: number|null       — only the pairs of this author (record of a researcher);
 *   limit: number               — pairs returned (most joint publications first, default 500).
 * }
 * @returns {pairs, total, counts, labMatrix, poleMatrix, refYear} — counts and matrices cover every pair
 *   kept (not only the `limit` returned); a matrix cell counts the pairs, not their publications, so that a
 *   very productive pair does not hide ten emerging ones.
 */
function rankPairs(net, opts = {}) {
  const from = opts.from ?? -Infinity;
  const to = opts.to ?? Infinity;
  const minShared = Math.max(1, opts.minShared ?? 2);
  const maxAuthors = opts.maxAuthors ?? null;
  const minDistance = opts.minDistance ?? null;
  const limit = opts.limit ?? 500;

  const { eligible, pairAllowed } = pairUniverse(net, opts, { includePhd: opts.includePhd !== false });
  // Reference year of the trends: end of the period, or the last year of the corpus.
  const lastYear = net.pubs.reduce((m, p) => Math.max(m, p.y), -Infinity);
  const refYear = Number.isFinite(to) ? Math.min(to, lastYear) : lastYear;

  // Joint publications of every allowed pair, all years (first / last year, trend), large ones excluded.
  const pairs = new Map(); // "lo|hi" -> publication indexes, or null when the pair is not allowed
  net.pubs.forEach((p, idx) => {
    if (maxAuthors != null && p.n != null && p.n > maxAuthors) return;
    const ids = p.a.filter((id) => eligible.has(id));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [lo, hi] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const key = `${lo}|${hi}`;
        let list = pairs.get(key);
        if (list === undefined) {
          list = pairAllowed(eligible.get(lo), eligible.get(hi)) ? [] : null;
          pairs.set(key, list);
        }
        if (list) list.push(idx);
      }
    }
  });

  // Profiles of OpenAlex fields (v3) and field of each subfield of the vocabulary.
  const fieldIndex = new Map((net.fields ?? []).map((f, i) => [f.name, String(i)]));
  const subfieldField = (net.subfields ?? []).map((sf) => fieldIndex.get(sf.field) ?? null);
  const pubFields = (p) => new Set((p.s ?? []).map((s) => subfieldField[s]).filter((f) => f != null));
  const profile = (a, shared) => {
    const v = new Map(Object.entries(a.f ?? {}));
    for (const [k, n] of shared) v.set(k, Math.max(0, (v.get(k) ?? 0) - n));
    return v;
  };
  // Joint publications of the pair, whatever their size: the profiles counted them all.
  const pubsOf = new Map();
  const authorPubs = (id) => {
    if (!pubsOf.has(id)) pubsOf.set(id, new Set());
    return pubsOf.get(id);
  };
  if (fieldIndex.size) net.pubs.forEach((p, idx) => { for (const id of p.a) authorPubs(id).add(idx); });
  const distanceOf = (x, y) => {
    if (!fieldIndex.size || !x.a.f || !y.a.f) return null;
    const shared = new Map();
    const [small, large] = authorPubs(x.a.id).size < authorPubs(y.a.id).size
      ? [authorPubs(x.a.id), authorPubs(y.a.id)]
      : [authorPubs(y.a.id), authorPubs(x.a.id)];
    for (const idx of small) {
      if (!large.has(idx)) continue;
      for (const f of pubFields(net.pubs[idx])) shared.set(f, (shared.get(f) ?? 0) + 1);
    }
    return cosineDistance(profile(x.a, shared), profile(y.a, shared));
  };

  const production = (a) => {
    let n = 0;
    for (const [y, c] of Object.entries(a.pubs || {})) if (Number(y) >= from && Number(y) <= to) n += c;
    return n;
  };
  const authorOut = (x) => ({
    id: x.a.id,
    label: x.a.label,
    labs: x.labs,
    poles: x.poles,
    phd: !!x.a.phd,
    ...(x.a.m ? { m: Object.fromEntries(x.labs.map((l) => [l, x.a.m[l] ?? 'pubs'])) } : {}),
    ...(x.a.uid ? { uid: x.a.uid } : {}),
  });
  const trendOf = (years) => {
    const first = Math.min(...years);
    const last = Math.max(...years);
    if (first > refYear - 3) return 'new';
    if (last <= refYear - 3) return 'dormant';
    const recent = years.filter((y) => y > refYear - 3 && y <= refYear).length;
    const before = years.filter((y) => y > refYear - 6 && y <= refYear - 3).length;
    return recent > before ? 'rising' : 'steady';
  };

  const rows = [];
  const counts = { new: 0, dormant: 0, rising: 0, steady: 0, distant: 0, crossPole: 0 };
  const engaged = new Set();
  const crossPoleEngaged = new Set();
  // Symmetric matrices: key "A|B" with A <= B, each couple counted once per pair.
  const labCells = new Map();
  const poleCells = new Map();
  const addCells = (cells, xs, ys, trend) => {
    const keys = new Set();
    for (const u of xs) for (const v of ys) if (u !== v || cells === poleCells) keys.add(u < v ? `${u}|${v}` : `${v}|${u}`);
    for (const key of keys) {
      const cell = cells.get(key) ?? { pairs: 0, new: 0, dormant: 0 };
      cell.pairs += 1;
      if (trend === 'new') cell.new += 1;
      if (trend === 'dormant') cell.dormant += 1;
      cells.set(key, cell);
    }
  };
  for (const [key, list] of pairs) {
    if (!list) continue;
    const inPeriod = list.filter((idx) => net.pubs[idx].y >= from && net.pubs[idx].y <= to);
    if (inPeriod.length < minShared) continue;
    const [lo, hi] = key.split('|').map(Number);
    const x = eligible.get(lo);
    const y = eligible.get(hi);
    const distance = distanceOf(x, y);
    if (minDistance != null && (distance == null || distance < minDistance)) continue;
    const years = list.map((idx) => net.pubs[idx].y).filter((yr) => yr <= refYear);
    const trend = trendOf(years.length ? years : [refYear]);
    const subfields = new Map();
    const topics = new Map();
    for (const idx of inPeriod) {
      for (const s of new Set(net.pubs[idx].s ?? [])) subfields.set(s, (subfields.get(s) ?? 0) + 1);
      for (const th of new Set(net.pubs[idx].t ?? [])) topics.set(th, (topics.get(th) ?? 0) + 1);
    }
    const crossPole = x.poles.length > 0 && y.poles.length > 0 && !x.poles.some((p) => y.poles.includes(p));
    counts[trend] += 1;
    if (distance != null && distance >= DISTANT_PROFILES) counts.distant += 1;
    if (crossPole) counts.crossPole += 1;
    engaged.add(lo);
    engaged.add(hi);
    if (crossPole) { crossPoleEngaged.add(lo); crossPoleEngaged.add(hi); }
    addCells(labCells, x.labs, y.labs, trend);
    addCells(poleCells, x.poles, y.poles, trend);
    const [px, py] = [production(x.a), production(y.a)];
    rows.push({
      a: authorOut(x),
      b: authorOut(y),
      shared: inPeriod.length,
      share: [px ? inPeriod.length / px : null, py ? inPeriod.length / py : null],
      first: Math.min(...list.map((idx) => net.pubs[idx].y)),
      last: Math.max(...list.map((idx) => net.pubs[idx].y)),
      trend,
      distance: distance == null ? null : Math.round(distance * 100) / 100,
      crossPole,
      subfields: [...subfields.entries()]
        .sort((m, n) => n[1] - m[1] || m[0] - n[0])
        .slice(0, 3)
        .map(([s]) => net.subfields?.[s]?.name)
        .filter(Boolean),
      // Main OpenAlex topics of the joint publications (network.json v4; empty before).
      topics: [...topics.entries()]
        .sort((m, n) => n[1] - m[1] || m[0] - n[0])
        .slice(0, 3)
        .map(([th]) => net.topics?.[th]?.name)
        .filter(Boolean),
    });
  }
  rows.sort((m, n) => n.shared - m.shared || n.last - m.last || m.a.label.localeCompare(n.a.label));
  // Researchers of the structure who published over the period: denominator of the engagement shares.
  const perimeter = [...eligible.values()].filter((x) => x.inStructure && x.visible && production(x.a) > 0);
  const matrix = (cells) => [...cells.entries()]
    .map(([key, cell]) => { const [a, b] = key.split('|'); return { a, b, ...cell }; })
    .sort((m, n) => n.pairs - m.pairs || m.a.localeCompare(n.a) || m.b.localeCompare(n.b));
  return {
    pairs: rows.slice(0, limit),
    total: rows.length,
    counts: {
      ...counts,
      authors: engaged.size,
      perimeter: perimeter.length,
      perimeterEngaged: perimeter.filter((x) => engaged.has(x.a.id)).length,
      perimeterCrossPole: perimeter.filter((x) => crossPoleEngaged.has(x.a.id)).length,
    },
    labMatrix: matrix(labCells),
    poleMatrix: matrix(poleCells),
    refYear: Number.isFinite(refYear) ? refYear : null,
  };
}

// ─── Suggested connections (druid-internal `docs/archive/plan-binomes-chercheurs.md`, lot 3) ───
// Pairs of researchers of different labs who never co-signed, scored by explainable signals computed on the
// period: common co-authors (triadic closure, Adamic-Adar), closeness of their OpenAlex themes — topics when
// network.json has them (version 4), subfields otherwise — and, when network.json carries the cited works
// (version 5, druid-internal `docs/plan-binomes-citations.md`, lot 2), the references they share (bibliographic
// coupling) and the publications of one that the other already cites (direct citation).

/** Co-authors with more neighbours than this generate no candidate (Adamic-Adar weighs them little anyway). */
const HUB_DEGREE = 300;
/** Thematic candidates kept per researcher (most similar first). */
const TOPIC_CANDIDATES = 30;
/**
 * Thematic similarity below which the signal counts as 0, per level of the profile. Topics (≈ 3 000) are much finer
 * than subfields (≈ 230): their cosines are lower for researchers just as close (retrospective test of druid-internal
 * `docs/binomes-chercheurs/lot3-retrotest.md`).
 */
const MIN_SIMILARITY = { topic: 0.1, subfield: 0.2 };
/**
 * Publications with themes under which a thematic profile is not trusted: the similarity is multiplied by
 * m / (m + TOPIC_PRIOR), m = the smaller profile (two researchers with one identical publication are not « 100 % close »).
 */
const TOPIC_PRIOR = 5;
/**
 * References cited by more publications of the period than this neither weigh nor bring candidates (methods
 * papers, databases, reviews: everybody cites them). Below, a reference weighs 1 / log(1 + publications citing it).
 */
const REF_HUB = 100;
/** Coupling candidates kept per researcher (most similar first). */
const REF_CANDIDATES = 30;
/** Coupling similarity below which the signal counts as 0 (cosines of reference profiles are small: most references
 * of a researcher are cited by nobody else of the university). */
const MIN_COUPLING = 0.01;
/** Publications with references under which a coupling profile is not trusted (as TOPIC_PRIOR). */
const REF_PRIOR = 5;
/**
 * Default weights of the combined score, set from the retrospective tests (druid-internal
 * `docs/binomes-chercheurs/lot3-retrotest.md`, `lot2-citations-retrotest.md`): the shared references predict
 * future co-signatures poorly (P@100 5 % alone, 16 % for the co-authors) and lower the top of the list when they
 * weigh 1 — kept low, as a tie-breaker and an explanation, visible on their own through `signal: 'coupling'`.
 */
const SUGGESTION_WEIGHTS = { triadic: 2, topics: 1, coupling: 0.5, cites: 1 };

/** Level of the thematic profiles of a network: OpenAlex topics (version 4) or subfields. */
function themeLevel(net) {
  return Array.isArray(net.topics) && net.topics.length > 0 ? 'topic' : 'subfield';
}

/**
 * @param net network.json content
 * @param opts {
 *   structureLabs, scope, crossPole, poles, membership, visibleLabs — as rankPairs (crossLab is always true);
 *   from, to: number          — period of the signals (co-authorships, themes); pairs with a joint publication
 *                               up to `to` are never suggested;
 *   maxAuthors: number|null   — ignore publications with more authors (large collaborations);
 *   includePhd: boolean       — suggest PhD students (default false; they still count as common co-authors);
 *   minPubs: number           — publications of each researcher over the period (default 2);
 *   recentYears: number       — each researcher published in the last N years of the period (default 3);
 *   signal: 'combined' | 'triadic' | 'topics' | 'coupling' | 'cites' — ranking (default combined);
 *   weights: {triadic, topics, coupling, cites} — weights of the combined score;
 *   minSimilarity: number     — thematic similarity below which the signal counts as 0 (default MIN_SIMILARITY);
 *   minCoupling, refPrior, refHub: number — same knobs for the coupling signal (defaults MIN_COUPLING, REF_PRIOR,
 *                               REF_HUB);
 *   quota: number|null        — suggestions per researcher at most (default 5, null = none);
 *   limit: number             — suggestions returned (default 200).
 * }
 * @returns {suggestions, total, level, references} — level of the themes ('topic' | 'subfield'), `references` true
 *   when the network carries the cited works; each suggestion: the two researchers, score, common co-authors
 *   (count, the most specific ones named), thematic similarity (with the shared themes named) and, with the cited
 *   works, the shared references (count, coupling similarity, the rarest ones named by W-id) and the direct
 *   citations (`cites.ab` = publications of a citing b, `cites.ba`).
 */
function suggestPairs(net, opts = {}) {
  const from = opts.from ?? -Infinity;
  const to = opts.to ?? Infinity;
  const maxAuthors = opts.maxAuthors ?? null;
  const minPubs = opts.minPubs ?? 2;
  const recentYears = opts.recentYears ?? 3;
  const signal = opts.signal ?? 'combined';
  const weights = { ...SUGGESTION_WEIGHTS, ...(opts.weights ?? {}) };
  // Thematic profiles: OpenAlex topics when the file has them, subfields otherwise.
  const level = themeLevel(net);
  const themesOf = level === 'topic' ? (p) => p.t : (p) => p.s;
  const vocabulary = (level === 'topic' ? net.topics : net.subfields) ?? [];
  const minSimilarity = opts.minSimilarity ?? MIN_SIMILARITY[level];
  const topicPrior = opts.topicPrior ?? TOPIC_PRIOR;
  const hasRefs = Array.isArray(net.refs) && net.refs.length > 0;
  const minCoupling = opts.minCoupling ?? MIN_COUPLING;
  const refPrior = opts.refPrior ?? REF_PRIOR;
  const refHub = opts.refHub ?? REF_HUB;
  const quota = opts.quota === undefined ? 5 : opts.quota;
  const limit = opts.limit ?? 200;

  const { eligible: all, pairAllowed } = pairUniverse(net, { ...opts, crossLab: true }, { includePhd: !!opts.includePhd });
  const lastYear = net.pubs.reduce((m, p) => Math.max(m, p.y), -Infinity);
  const end = Number.isFinite(to) ? Math.min(to, lastYear) : lastYear;
  // Active researchers: enough publications over the period, one at least in its last years.
  const eligible = new Map();
  for (const [id, x] of all) {
    let n = 0;
    let recent = false;
    for (const [y, c] of Object.entries(x.a.pubs || {})) {
      const yr = Number(y);
      if (yr < from || yr > end) continue;
      n += c;
      if (yr > end - recentYears) recent = true;
    }
    if (n >= minPubs && recent) eligible.set(id, x);
  }
  // Never intra-lab, whatever the membership filter keeps.
  const allowed = (x, y) => !x.a.labs.some((l) => y.a.labs.includes(l)) && pairAllowed(x, y);
  const pairKey = (i, j) => (i < j ? i * 1e5 + j : j * 1e5 + i);

  // Co-authorship graph of the period and the pairs already linked (any joint publication up to `to`).
  const neighbours = new Map();
  const linked = new Set();
  const themeCounts = new Map(); // author -> Map(theme -> publications)
  const themePubs = new Map(); // author -> publications with themes
  const refCounts = new Map(); // author -> Map(reference index -> publications citing it)
  const refPubs = new Map(); // author -> publications with references
  const citedBy = new Map(); // reference index -> publications of the period citing it
  const owners = new Map(); // W-id of a publication (up to `to`) -> its eligible authors
  const citing = []; // [eligible authors, reference indexes] of the publications of the period
  for (const p of net.pubs) {
    if (p.y > end || (maxAuthors != null && p.n != null && p.n > maxAuthors)) continue;
    for (let i = 0; i < p.a.length; i++) for (let j = i + 1; j < p.a.length; j++) linked.add(pairKey(p.a[i], p.a[j]));
    if (hasRefs && p.w) owners.set(p.w, p.a.filter((id) => eligible.has(id)));
    if (p.y < from) continue;
    const authors = [];
    for (const id of p.a) {
      if (!neighbours.has(id)) neighbours.set(id, new Set());
      for (const other of p.a) if (other !== id) neighbours.get(id).add(other);
      if (!eligible.has(id)) continue;
      authors.push(id);
      const themes = themesOf(p);
      if (!themes?.length) continue;
      if (!themeCounts.has(id)) themeCounts.set(id, new Map());
      themePubs.set(id, (themePubs.get(id) ?? 0) + 1);
      const counts = themeCounts.get(id);
      for (const th of new Set(themes)) counts.set(th, (counts.get(th) ?? 0) + 1);
    }
    if (!hasRefs || !p.r?.length || !authors.length) continue;
    const refs = [...new Set(p.r)];
    for (const r of refs) citedBy.set(r, (citedBy.get(r) ?? 0) + 1);
    for (const id of authors) {
      if (!refCounts.has(id)) refCounts.set(id, new Map());
      refPubs.set(id, (refPubs.get(id) ?? 0) + 1);
      const counts = refCounts.get(id);
      for (const r of refs) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    citing.push([authors, refs]);
  }

  const candidates = new Map(); // key -> {i, j, aa, via: [ids]}
  const candidate = (i, j) => {
    const key = pairKey(i, j);
    let c = candidates.get(key);
    if (c === undefined) {
      const x = eligible.get(i);
      const y = eligible.get(j);
      c = !linked.has(key) && x && y && allowed(x, y)
        ? { i: Math.min(i, j), j: Math.max(i, j), aa: 0, via: [], similarity: null, coupling: 0, cites: null }
        : null;
      candidates.set(key, c);
    }
    return c;
  };

  // 1. Triadic closure: every pair of eligible neighbours of a co-author, weighted 1 / log(degree).
  for (const [z, ns] of neighbours) {
    if (ns.size < 2 || ns.size > HUB_DEGREE) continue;
    const w = 1 / Math.log(ns.size);
    const ids = [...ns].filter((id) => eligible.has(id));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const c = candidate(ids[i], ids[j]);
        if (!c) continue;
        c.aa += w;
        c.via.push(z);
      }
    }
  }

  // 2. Thematic closeness: cosine of the theme profiles, candidates through the main themes.
  const vectors = new Map();
  for (const [id, counts] of themeCounts) {
    const norm = Math.sqrt([...counts.values()].reduce((t, v) => t + v * v, 0));
    vectors.set(id, { counts, norm, pubs: themePubs.get(id) });
  }
  const cosine = (i, j) => {
    const u = vectors.get(i);
    const v = vectors.get(j);
    if (!u || !v) return 0;
    const [small, large] = u.counts.size < v.counts.size ? [u, v] : [v, u];
    let dot = 0;
    for (const [k, n] of small.counts) dot += n * (large.counts.get(k) ?? 0);
    const m = Math.min(u.pubs, v.pubs);
    return (dot / (u.norm * v.norm)) * (m / (m + topicPrior));
  };
  const topThemes = (id) => [...vectors.get(id).counts.entries()].sort((m, n) => n[1] - m[1] || m[0] - n[0]).slice(0, 3).map(([k]) => k);
  const byTheme = new Map();
  for (const id of vectors.keys()) {
    for (const th of topThemes(id)) {
      if (!byTheme.has(th)) byTheme.set(th, []);
      byTheme.get(th).push(id);
    }
  }
  for (const i of vectors.keys()) {
    const seen = new Set();
    const best = [];
    for (const th of topThemes(i)) {
      for (const j of byTheme.get(th)) {
        if (j === i || seen.has(j)) continue;
        seen.add(j);
        const sim = cosine(i, j);
        if (sim >= minSimilarity) best.push([j, sim]);
      }
    }
    best.sort((m, n) => n[1] - m[1]);
    for (const [j] of best.slice(0, TOPIC_CANDIDATES)) candidate(i, j);
  }

  // 3. Bibliographic coupling (version 5): cosine of the reference profiles, each reference weighted by
  // 1 / log(1 + publications of the period citing it), damped like the themes; the dot products come from the
  // inverted index (reference → authors citing it), hubs left out. Candidates through the closest profiles.
  const refWeight = new Map(); // reference index -> idf-like weight (0 for a hub)
  for (const [r, n] of citedBy) refWeight.set(r, n > refHub ? 0 : 1 / Math.log(1 + n));
  const refVectors = new Map(); // author -> {counts, norm, pubs}
  const refAuthors = new Map(); // reference index -> [[author, publications citing it]] (hubs left out)
  for (const [id, counts] of refCounts) {
    let norm2 = 0;
    for (const [r, n] of counts) {
      const w = refWeight.get(r);
      if (!w) continue;
      norm2 += (n * w) ** 2;
      if (!refAuthors.has(r)) refAuthors.set(r, []);
      refAuthors.get(r).push([id, n]);
    }
    refVectors.set(id, { counts, norm: Math.sqrt(norm2), pubs: refPubs.get(id) });
  }
  const dots = new Map(); // pair key -> weighted dot product (cosine of the profiles)
  const sums = new Map(); // pair key -> sum of the weights of the shared references (ranking by references)
  for (const [r, authors] of refAuthors) {
    if (authors.length < 2) continue;
    const w = refWeight.get(r);
    for (let x = 0; x < authors.length; x++) {
      for (let y = x + 1; y < authors.length; y++) {
        const key = pairKey(authors[x][0], authors[y][0]);
        dots.set(key, (dots.get(key) ?? 0) + authors[x][1] * authors[y][1] * w * w);
        sums.set(key, (sums.get(key) ?? 0) + w);
      }
    }
  }
  const couplingOf = (i, j) => {
    const u = refVectors.get(i);
    const v = refVectors.get(j);
    const dot = dots.get(pairKey(i, j));
    if (!u || !v || !dot || !u.norm || !v.norm) return 0;
    const m = Math.min(u.pubs, v.pubs);
    return (dot / (u.norm * v.norm)) * (m / (m + refPrior));
  };
  if (hasRefs) {
    const partners = new Map(); // author -> [[partner, coupling]]
    for (const key of dots.keys()) {
      const i = Math.floor(key / 1e5);
      const j = key % 1e5;
      const sim = couplingOf(i, j);
      if (sim < minCoupling) continue;
      for (const [a, b] of [[i, j], [j, i]]) {
        if (!partners.has(a)) partners.set(a, []);
        partners.get(a).push([b, sim]);
      }
    }
    for (const [i, best] of partners) {
      best.sort((m, n) => n[1] - m[1] || m[0] - n[0]);
      for (const [j] of best.slice(0, REF_CANDIDATES)) candidate(i, j);
    }
    // 4. Direct citations: a publication of the period citing a publication of the network (up to `to`).
    for (const [authors, refs] of citing) {
      const seen = new Set();
      for (const r of refs) {
        const cited = owners.get(net.refs[r]);
        if (!cited?.length) continue;
        for (const a of authors) {
          for (const b of cited) {
            if (a === b || seen.has(a * 1e5 + b)) continue;
            seen.add(a * 1e5 + b);
            const c = candidate(a, b);
            if (!c) continue;
            c.cites ??= { ab: 0, ba: 0 };
            c.cites[a === c.i ? 'ab' : 'ba'] += 1;
          }
        }
      }
    }
  }

  // Scores: triadic signal bounded to [0, 1[ (1 − e^−AA), similarities in [0, 1], citations bounded alike.
  const scored = [];
  for (const c of candidates.values()) {
    if (!c) continue;
    c.similarity = cosine(c.i, c.j);
    c.coupling = couplingOf(c.i, c.j);
    const triadic = 1 - Math.exp(-c.aa);
    const topics = c.similarity >= minSimilarity ? c.similarity : 0;
    const coupling = c.coupling >= minCoupling ? c.coupling : 0;
    const citations = c.cites ? c.cites.ab + c.cites.ba : 0;
    const cites = 1 - Math.exp(-citations);
    c.score = signal === 'triadic' ? c.aa
      : signal === 'topics' ? topics
        : signal === 'coupling' ? (sums.get(pairKey(c.i, c.j)) ?? 0)
          : signal === 'cites' ? citations + coupling / 10
            : weights.triadic * triadic + weights.topics * topics + (weights.coupling ?? 0) * coupling + (weights.cites ?? 0) * cites;
    if (c.score > 0) scored.push(c);
  }
  scored.sort((m, n) => n.score - m.score || n.aa - m.aa || m.i - n.i || m.j - n.j);

  // Quota per researcher: a very central researcher does not take the whole list.
  const perAuthor = new Map();
  const kept = [];
  for (const c of scored) {
    if (quota != null && ((perAuthor.get(c.i) ?? 0) >= quota || (perAuthor.get(c.j) ?? 0) >= quota)) continue;
    perAuthor.set(c.i, (perAuthor.get(c.i) ?? 0) + 1);
    perAuthor.set(c.j, (perAuthor.get(c.j) ?? 0) + 1);
    kept.push(c);
  }

  const byId = new Map(net.authors.map((a) => [a.id, a]));
  const authorOut = (x) => ({
    id: x.a.id,
    label: x.a.label,
    labs: x.labs,
    poles: x.poles,
    phd: !!x.a.phd,
    ...(x.a.m ? { m: Object.fromEntries(x.labs.map((l) => [l, x.a.m[l] ?? 'pubs'])) } : {}),
    ...(x.a.uid ? { uid: x.a.uid } : {}),
  });
  const sharedThemes = (i, j) => {
    const u = vectors.get(i)?.counts;
    const v = vectors.get(j)?.counts;
    if (!u || !v) return [];
    return [...u.entries()]
      .filter(([k]) => v.has(k))
      .map(([k, n]) => [k, Math.min(n, v.get(k))])
      .sort((m, n) => n[1] - m[1] || m[0] - n[0])
      .slice(0, 3)
      .map(([k]) => vocabulary[k]?.name)
      .filter(Boolean);
  };
  // Shared references of a pair: count, and the rarest ones (fewest citing publications) named by W-id.
  const sharedRefs = (i, j) => {
    const u = refVectors.get(i)?.counts;
    const v = refVectors.get(j)?.counts;
    if (!u || !v) return { count: 0, top: [] };
    const [small, large] = u.size < v.size ? [u, v] : [v, u];
    const shared = [...small.keys()].filter((r) => large.has(r));
    const top = shared.sort((m, n) => citedBy.get(m) - citedBy.get(n) || m - n).slice(0, 3).map((r) => net.refs[r]);
    return { count: shared.length, top };
  };
  return {
    suggestions: kept.slice(0, limit).map((c) => {
      const x = eligible.get(c.i);
      const y = eligible.get(c.j);
      const refs = hasRefs ? sharedRefs(c.i, c.j) : { count: 0, top: [] };
      return {
        a: authorOut(x),
        b: authorOut(y),
        score: Math.round(c.score * 1000) / 1000,
        common: c.via.length,
        // The most specific common co-authors first (fewest co-authors of their own).
        via: [...c.via]
          .sort((m, n) => neighbours.get(m).size - neighbours.get(n).size || m - n)
          .slice(0, 3)
          .map((z) => ({ id: z, label: byId.get(z)?.label ?? '', labs: byId.get(z)?.labs ?? [] })),
        similarity: Math.round(c.similarity * 100) / 100,
        themes: sharedThemes(c.i, c.j),
        references: refs.count,
        coupling: Math.round(c.coupling * 100) / 100,
        sharedRefs: refs.top,
        cites: c.cites,
        crossPole: x.poles.length > 0 && y.poles.length > 0 && !x.poles.some((p) => y.poles.includes(p)),
      };
    }),
    total: kept.length,
    level,
    references: hasRefs,
  };
}

module.exports = {
  buildInterLabNetwork, commonPublications, rankPairs, suggestPairs, OTHER_LABS_CATEGORY, DISTANT_PROFILES, SUGGESTION_WEIGHTS,
};
