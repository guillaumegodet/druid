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

// ── Researcher pairs (druid-internal `docs/plan-binomes-chercheurs.md`, lot 1) ─────────────────────
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
  const crossLab = opts.crossLab !== false;
  const includePhd = opts.includePhd !== false;
  const kinds = MEMBERSHIP_KINDS[opts.membership] ?? null;
  const structure = opts.structureLabs ? new Set(opts.structureLabs) : null;
  const visible = opts.visibleLabs ? new Set(opts.visibleLabs) : null;
  const [poleA, poleB] = opts.poles ?? [];
  const [labA, labB] = opts.labPair ?? [];
  const minDistance = opts.minDistance ?? null;
  const limit = opts.limit ?? 500;

  const poleOf = new Map(net.labs.map((l) => [l.acronym, l.pole ?? null]));
  // Reference year of the trends: end of the period, or the last year of the corpus.
  const lastYear = net.pubs.reduce((m, p) => Math.max(m, p.y), -Infinity);
  const refYear = Number.isFinite(to) ? Math.min(to, lastYear) : lastYear;

  // Authors that can belong to a pair, with the labs kept by the membership filter.
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
    if (opts.scope === 'structure' ? !(x.inStructure && y.inStructure) : !(x.inStructure || y.inStructure)) return false;
    if (!x.visible && !y.visible) return false;
    if (crossLab && x.labs.some((l) => y.labs.includes(l))) return false;
    if (opts.crossPole && (!x.poles.length || !y.poles.length || x.poles.some((p) => y.poles.includes(p)))) return false;
    const either = (key, A, B) => (x[key].includes(A) && y[key].includes(B)) || (x[key].includes(B) && y[key].includes(A));
    if (poleA && poleB && !either('poles', poleA, poleB)) return false;
    if (labA && labB && !either('labs', labA, labB)) return false;
    return true;
  };

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
    for (const idx of inPeriod) {
      for (const s of new Set(net.pubs[idx].s ?? [])) subfields.set(s, (subfields.get(s) ?? 0) + 1);
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

module.exports = { buildInterLabNetwork, commonPublications, rankPairs, OTHER_LABS_CATEGORY, DISTANT_PROFILES };
