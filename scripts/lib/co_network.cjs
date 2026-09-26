/**
 * co_network.cjs — Inter-lab co-authorship graph of the « Réseau » tab
 * (docs/plan-reseau-inter-labos.md, lots 2 and 4).
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

module.exports = { buildInterLabNetwork, commonPublications, OTHER_LABS_CATEGORY };
