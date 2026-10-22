// Cloudflare Pages Function — inter-lab network and researcher pairs, the routes of server.cjs on the network.json of
// the instance (functions/_lib/network.js):
//   GET  /api/network/:slug[?meta=1&labs=&from=&to=&minPubs=&maxAuthors=&crossOnly=&aggregateOthers=&maxNodes=]
//   GET  /api/network/:slug/publications?a=&b=[&from=&to=&maxAuthors=&source=university]
//   GET  /api/network/:slug/pairs[?scope=&from=&to=&minShared=&maxAuthors=&crossLab=&crossPole=&poles=&labPair=&minDistance=&phd=&membership=&limit=]
//   GET  /api/network/:slug/suggestions[?scope=&from=&to=&maxAuthors=&crossPole=&poles=&phd=&membership=&signal=&quota=&limit=]
//   POST /api/network/:slug/suggestions/feedback { a, b, verdict, comment }   (PostgreSQL instance, not read-only)
//   GET  /api/network/suggestions/feedback.csv                                 (PostgreSQL instance)
// The pairs and the suggestions always come from the whole file (the institution), the structure only scopes them
// (decision D2 of druid-internal `docs/archive/plan-binomes-chercheurs.md`). Opinions on the suggestions live in the
// PostgreSQL database of the instance (lib/pairs/feedback.ts); a Grist instance answers 501 to them.
import { createPairFeedbackStore } from '../../../lib/pairs/feedback.ts';
import { identityOf } from '../../_lib/identity.js';
import { instanceOf } from '../../_lib/instance.js';
import { cached, coNetwork, intOr, loadNetwork, networkReader, resolveNetwork, toAcronyms } from '../../_lib/network.js';
import { json } from '../../_lib/saas.js';
import { withStorage } from '../../_lib/storage.js';

const PAIRS_MEMBERSHIP = new Set(['all', 'associates', 'members']);
const SUGGESTION_SIGNALS = new Set(['combined', 'triadic', 'topics', 'coupling', 'cites']);
const PAIR_VERDICTS = new Set(['relevant', 'already_in_contact', 'not_relevant']);
const NODE_RE = /^(a:\d+|lab:[\w&.' -]+)$/;

/** Runs `fn` with the opinions store of a PostgreSQL instance (null on another storage), then releases the client. */
const withFeedback = (context, fn) => withStorage(context, ({ store, missing }) =>
  fn(!missing && store?.kind === 'postgres' ? createPairFeedbackStore(store.db) : null));

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const feedbackCsv = (context, instance, reader) => withFeedback(context, async (store) => {
  if (!store) return json(501, { error: 'The opinions need the PostgreSQL storage' });
  if (!reader.all) return json(403, { error: 'Forbidden' });
  const rows = await store.rows();
  const head = ['pair_key', 'slug', 'a_label', 'a_labs', 'b_label', 'b_labs', 'verdict', 'comment', 'author', 'created_at'];
  const lines = [head.join(';'), ...rows.map((row) => head.map((k) => csvCell(row[k])).join(';'))];
  return new Response(`\ufeff${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pair-suggestions-feedback.csv"', 'Cache-Control': 'no-store' },
  });
});

export async function onRequest(context) {
  const { request, env } = context;
  const instance = instanceOf(context);
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/api\/network\/?/, '').split('/').filter(Boolean);
  const q = url.searchParams;
  const slug = segments[0] || '';
  const action = segments.slice(1).join('/');

  const net = await loadNetwork(context, instance);
  if (!net) return json(404, { error: 'No network data' });
  const reader = networkReader(context, instance, net);
  if (reader.refusal) return reader.refusal;
  if (slug === 'suggestions' && action === 'feedback.csv' && request.method === 'GET') return feedbackCsv(context, instance, reader);

  const resolved = resolveNetwork(net, slug, reader);
  if (resolved.error) return resolved.error;
  const { source, focus, structureLabs, isComposite } = resolved;
  // null = no restriction; a composite was just checked on its own slug.
  const visibleLabs = reader.all || isComposite ? null : reader.visibleLabs;
  const poles = String(q.get('poles') || '').split(',').filter(Boolean);
  const common = {
    structureLabs,
    scope: q.get('scope') === 'structure' ? 'structure' : 'all',
    from: intOr(q.get('from'), undefined),
    to: intOr(q.get('to'), undefined),
    maxAuthors: intOr(q.get('maxAuthors'), null),
    crossPole: q.get('crossPole') === '1',
    poles: poles.length === 2 ? poles : null,
    membership: PAIRS_MEMBERSHIP.has(q.get('membership')) ? q.get('membership') : 'all',
    visibleLabs,
  };
  const base = { source, generatedAt: net.generatedAt, version: net.version ?? 1, structureLabs, poles: net.poles ?? [], restricted: !!visibleLabs };

  if (request.method === 'GET' && !action) {
    const labs = [...new Set([...(focus ? [focus] : []), ...toAcronyms(net, q.get('labs'))])];
    // meta=1: only the labs and the coverage (lab picker), no graph.
    const graph = labs.length && q.get('meta') !== '1'
      ? coNetwork.buildInterLabNetwork(net, {
        labs,
        from: intOr(q.get('from'), undefined),
        to: intOr(q.get('to'), undefined),
        minPubs: intOr(q.get('minPubs'), 1),
        maxAuthors: intOr(q.get('maxAuthors'), null),
        crossOnly: q.get('crossOnly') === '1',
        aggregateOthers: q.get('aggregateOthers') === '1',
        visibleLabs,
        maxNodes: Math.min(intOr(q.get('maxNodes'), 400), 1000),
      })
      : { nodes: [], links: [], categories: [], truncated: 0 };
    return cached({ source, generatedAt: net.generatedAt, focus, labs: net.labs, coverage: net.coverage, restricted: !!visibleLabs, ...graph });
  }

  if (request.method === 'GET' && action === 'publications') {
    const a = String(q.get('a') || '');
    const b = String(q.get('b') || '');
    if (!NODE_RE.test(a) || !NODE_RE.test(b)) return json(400, { error: 'Invalid node ids' });
    const publications = coNetwork.commonPublications(net, {
      a, b, from: intOr(q.get('from'), null), to: intOr(q.get('to'), null), maxAuthors: intOr(q.get('maxAuthors'), null), requireLabs: visibleLabs,
    });
    return cached({ publications: publications.slice(0, 200), total: publications.length });
  }

  if (request.method === 'GET' && action === 'pairs') {
    const labPair = String(q.get('labPair') || '').split(',').filter(Boolean);
    const minDistance = Number(q.get('minDistance'));
    const result = coNetwork.rankPairs(net, {
      ...common,
      minShared: intOr(q.get('minShared'), 2),
      crossLab: q.get('crossLab') !== '0',
      labPair: labPair.length === 2 ? labPair : null,
      minDistance: Number.isFinite(minDistance) && q.get('minDistance') !== '' && q.get('minDistance') !== null ? minDistance : null,
      includePhd: q.get('phd') !== '0',
      limit: Math.min(intOr(q.get('limit'), 500), 2000),
    });
    return cached({ ...base, coverage: net.coverage, ...result });
  }

  if (request.method === 'GET' && action === 'suggestions') {
    const result = coNetwork.suggestPairs(net, {
      ...common,
      includePhd: q.get('phd') === '1',
      signal: SUGGESTION_SIGNALS.has(q.get('signal')) ? q.get('signal') : 'combined',
      quota: Math.min(Math.max(intOr(q.get('quota'), 5), 1), 50),
      limit: Math.min(intOr(q.get('limit'), 200), 1000),
    });
    // Opinions of the users (PostgreSQL only): per viewer, so not cached by the browser.
    return withFeedback(context, async (store) => {
      let suggestions = result.suggestions;
      if (store) {
        try { suggestions = await store.annotate(suggestions, reader.viewer); } catch (e) { console.error('[pairs] feedback unavailable:', e.message); }
      }
      return json(200, { ...base, feedback: !!store, ...result, suggestions }, { 'Cache-Control': store ? 'private, no-cache' : 'private, max-age=300' });
    });
  }

  if (request.method === 'POST' && action === 'suggestions/feedback') {
    if (instance.readOnly) return json(403, { error: 'Read-only instance: writes are disabled' });
    const identity = identityOf(context);
    if (!identity && !(!instance.shared && env.ALLOW_ANONYMOUS_WRITES === 'true')) return json(403, { error: 'Writes require an authenticated user (Cloudflare Access)' });
    let body;
    try { body = (await request.json()) || {}; } catch { return json(400, { error: 'Invalid pair' }); }
    const { a, b, verdict } = body;
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 2000) : '';
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return json(400, { error: 'Invalid pair' });
    if (verdict !== null && !PAIR_VERDICTS.has(verdict)) return json(400, { error: 'Invalid verdict' });
    const byId = new Map(net.authors.map((x) => [x.id, x]));
    const x = byId.get(a);
    const y = byId.get(b);
    if (!x || !y) return json(404, { error: 'Unknown researcher' });
    if (visibleLabs && ![...x.labs, ...y.labs].some((l) => visibleLabs.includes(l))) return json(403, { error: 'Forbidden' });
    return withFeedback(context, async (store) => {
      if (!store) return json(501, { error: 'The opinions need the PostgreSQL storage' });
      const author = identity || 'anonymous';
      try {
        const pairKey = store.pairKeyOf(x, y);
        if (verdict === null) await store.remove(pairKey, author);
        else await store.save({ pairKey, slug, a: x, b: y, verdict, comment, author });
        return json(200, { ok: true, pairKey });
      } catch (e) {
        console.error('[pairs] feedback not saved:', e.message);
        return json(500, { error: e.message });
      }
    });
  }

  return json(404, { error: 'Not found' });
}
