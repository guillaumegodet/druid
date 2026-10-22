// University-wide co-authorship network of a Cloudflare instance (druid-internal `docs/archive/plan-reseau-inter-labos.md`,
// `docs/archive/plan-binomes-chercheurs.md`, `docs/plan-binomes-citations.md`): the network.json exported by druid-biblio
// for the whole institution, shipped with the dashboards of the instance (instances/<slug>/dashboard-data/network.json,
// `features.network` of its instance.json) and computed on by scripts/lib/co_network.cjs, as server.cjs does on
// Nantes from the druid-biblio exports. The file is read through env.ASSETS, never through the public URL. One file per
// instance: its slug is the composite (the institution), every lab of `labs` focuses on itself.
// Shared by functions/api/network/[[path]].js and functions/api/researchers/[key]/pairs.js. No route.
import coNetwork from '../../scripts/lib/co_network.cjs';
import { normalizeAcronym } from '../../lib/normalize.ts';
import { accessForMember } from '../../lib/saas/controlPlane.ts';
import { identityOf, memberOf } from './identity.js';
import { instanceAssetPath } from './instanceAssets.js';
import { json } from './saas.js';

export { coNetwork };

/** Parsed networks per instance file, for the lifetime of the isolate (a deployment ships its file in a new isolate). */
const networks = new Map();

/**
 * The network of the instance, or null when it has none: feature `network` off, no file in the build, or a tenant of
 * the control plane (its dashboards live in R2 and carry no network yet).
 */
export const loadNetwork = async (context, instance) => {
  if (instance.tenant || !instance.features?.network || !context.env?.ASSETS) return null;
  const target = instance.shared ? instanceAssetPath(instance.slug, '/dashboard-data/network.json') : '/dashboard-data/network.json';
  if (!target) return null;
  const key = `${instance.slug}|${target}`;
  if (!networks.has(key)) {
    const loading = (async () => {
      const res = await context.env.ASSETS.fetch(new Request(new URL(target, context.request.url)));
      if (!res.ok || (res.headers.get('Content-Type') || '').includes('text/html')) return null;
      return res.json().catch(() => null);
    })().then(
      (net) => { if (!net) networks.delete(key); return net; },
      (e) => { networks.delete(key); throw e; },
    );
    networks.set(key, loading);
  }
  return networks.get(key);
};

/**
 * Reader of the request: who gives opinions (`viewer`), whether they hold the institution right (`all`) and the labs
 * they may see (`visibleLabs`, null = every lab). The Cloudflare instances have no lab scope (functions/api/me.js): every
 * reader sees the whole network, and the anonymous reader of a public instance is named after it. A tenant of the
 * control plane needs a member session; a member of role `lab` sees the pairs of their labs only, as on Nantes.
 */
export const networkReader = (context, instance, net) => {
  if (!instance.tenant) return { viewer: identityOf(context) || instance.slug, all: true, visibleLabs: null };
  const identity = identityOf(context);
  const member = memberOf(context);
  if (!identity || !member) return { refusal: json(identity ? 403 : 401, { error: identity ? 'This account is not a member of this Druid' : 'Authentication required' }) };
  const { scope } = accessForMember(member, instance.readOnly);
  if (scope.all) return { viewer: identity, all: true, visibleLabs: null };
  const anchors = new Set(scope.labAnchors);
  const visibleLabs = net.labs.filter((l) => anchors.has(normalizeAcronym(l.slug || '')) || anchors.has(normalizeAcronym(l.acronym))).map((l) => l.acronym);
  return { viewer: identity, all: false, visibleLabs };
};

/**
 * Structure of a network request: the composite (the slug of the file) or one of its labs (focus). Answers the error
 * itself (400 / 403 / 404), like resolveNetworkRequest of server.cjs.
 */
export const resolveNetwork = (net, slug, reader) => {
  if (!/^[a-z0-9_-]+$/.test(slug)) return { error: json(400, { error: 'Invalid slug' }) };
  const isComposite = slug === net.slug;
  const focus = isComposite ? null : net.labs.find((l) => l.slug === slug)?.acronym ?? null;
  if (!isComposite && !focus) return { error: json(404, { error: 'Structure not in the university network' }) };
  if (!reader.all && !isComposite && !reader.visibleLabs.includes(focus)) return { error: json(403, { error: 'Forbidden' }) };
  return { source: net.slug, isComposite, focus, structureLabs: focus ? [focus] : null };
};

/** Integer of a query parameter, `d` when absent or not a number. */
export const intOr = (v, d) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);

/** Lab acronyms of a comma-separated list of slugs or acronyms (unknown ones dropped). */
export const toAcronyms = (net, list) => String(list || '').split(',').map((x) => x.trim()).filter(Boolean)
  .map((x) => net.labs.find((l) => l.slug === x || l.acronym === x)?.acronym)
  .filter(Boolean);

/** JSON answer the browser may keep five minutes (the file only changes with a deployment). */
export const cached = (body) => json(200, body, { 'Cache-Control': 'private, max-age=300' });
