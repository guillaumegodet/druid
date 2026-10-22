// Cloudflare Pages Function — pairs of one researcher (record page, druid-internal `docs/archive/plan-binomes-chercheurs.md`):
// `GET /api/researchers/:key/pairs` of server.cjs on the network.json of the instance (functions/_lib/network.js) —
// their most frequent co-authors (every lab, all years) and the researchers suggested to them over the last five
// years. Rights: those of the network (functions/_lib/network.js networkReader); the opinions come from the PostgreSQL
// database of the instance when it has one.
import { createPairFeedbackStore } from '../../../../lib/pairs/feedback.ts';
import { instanceOf } from '../../../_lib/instance.js';
import { coNetwork, loadNetwork, networkReader } from '../../../_lib/network.js';
import { json } from '../../../_lib/saas.js';
import { withStorage } from '../../../_lib/storage.js';

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
// Same bound as LARGE_COLLAB_MAX_AUTHORS (components/dashboard/interLabNetwork.ts): large collaborations are no pair.
const RECORD_PAIRS_MAX_AUTHORS = 50;

export async function onRequestGet(context) {
  const instance = instanceOf(context);
  const key = String(context.params.key || '');
  if (!KEY_RE.test(key)) return json(400, { error: 'Invalid record key' });
  const net = await loadNetwork(context, instance);
  if (!net) return json(404, { error: 'No network data' });
  const reader = networkReader(context, instance, net);
  if (reader.refusal) return reader.refusal;
  const author = net.authors.find((a) => a.uid === key);
  if (!author) return json(200, { found: false, observed: [], suggestions: [] });
  const labSlugs = net.labs.filter((l) => l.slug && author.labs.includes(l.acronym)).map((l) => l.slug);
  const readable = reader.all ? labSlugs : labSlugs.filter((slug) => reader.visibleLabs.includes(net.labs.find((l) => l.slug === slug)?.acronym));
  const self = reader.viewer === key;
  if (!self && !reader.all && !readable.length) return json(403, { error: 'Forbidden' });
  const lastYear = net.pubs.reduce((m, p) => Math.max(m, p.y), -Infinity);
  const common = { authorId: author.id, maxAuthors: RECORD_PAIRS_MAX_AUTHORS };
  const observed = coNetwork.rankPairs(net, { ...common, crossLab: false, minShared: 2, limit: 24 });
  const suggested = coNetwork.suggestPairs(net, { ...common, from: lastYear - 4, to: lastYear, quota: null, limit: 12 });
  const feedbackSlug = readable[0] ?? null;
  return withStorage(context, async ({ store, missing }) => {
    const feedback = !missing && store?.kind === 'postgres' ? createPairFeedbackStore(store.db) : null;
    let suggestions = suggested.suggestions;
    if (feedback && feedbackSlug) {
      try { suggestions = await feedback.annotate(suggestions, reader.viewer); } catch (e) { console.error('[pairs] feedback unavailable:', e.message); }
    }
    return json(200, {
      found: true,
      authorId: author.id,
      generatedAt: net.generatedAt,
      observed: observed.pairs,
      refYear: observed.refYear,
      suggestions,
      level: suggested.level,
      from: lastYear - 4,
      to: lastYear,
      feedback: !!feedback && !!feedbackSlug,
      feedbackSlug,
    }, { 'Cache-Control': 'private, no-cache' });
  });
}
