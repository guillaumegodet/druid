// People alignment runs of a tenant, same routes as server.cjs (lib/unifiedAlignRuns.ts invents none):
//   GET  /api/align/estimate?mode=&labo=&group=   what a run would process (lib/saas/alignEstimate.ts)
//   GET  /api/align/:source/trigger?mode=&labo=&group=&force=&limit=&record=   queues a `people.align` job (409 when live)
//   GET  /api/align/:source/progress                                             progress of the newest run
//   POST /api/align/:source/stop                                                 stop
// druid-internal docs/plan-druid-saas.md, lot 3 a. The IdRef routes of the legacy page are functions/api/sync-idref-*.js.
import { PEOPLE_ALIGN_SOURCES, peopleAlignParamsOfQuery } from '../../../lib/saas/jobs.ts';
import { TARGET_SOURCES, estimateAlignment } from '../../../lib/saas/alignEstimate.ts';
import { readAlignCache } from '../../../lib/saas/alignCache.ts';
import { listTenantSecretNames } from '../../../lib/saas/secrets.ts';
import { jobProgress, startJob, stopJob, tenantMember } from '../../_lib/jobs.js';
import { json, withSaasDb } from '../../_lib/saas.js';
import { withStorage } from '../../_lib/storage.js';

const LEGACY_SOURCES = ['orcid', 'hal', 'openalex', 'scopus'];

export const estimate = async (context) => {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  const q = new URL(context.request.url).searchParams;
  const mode = q.get('mode') === 'verify' ? 'verify' : 'search';
  const labo = String(q.get('labo') || '').trim().toUpperCase().slice(0, 120);
  const group = ['personnel', 'doctorants', 'hors_recherche'].includes(q.get('group')) ? q.get('group') : '';
  const secretNames = await withSaasDb(context.env, (db) => listTenantSecretNames(db, t.instance.tenant.id));
  const sources = PEOPLE_ALIGN_SOURCES.filter((s) => s !== 'scopus' || secretNames.includes('SCOPUS_API_KEY'));
  return withStorage(context, async ({ store, missing }) => {
    if (missing) return json(500, { error: missing });
    const records = await store.tables.records('Annuaire');
    const caches = {};
    for (const s of sources) caches[TARGET_SOURCES[s].cache] = await readAlignCache(store.db, TARGET_SOURCES[s].cache);
    const estimated = estimateAlignment(records, caches, { mode, labo, group }, sources);
    // No quota tracking of the Elsevier key here: the budget is unknown, nothing is refused.
    return json(200, { mode, labo, group, sources: estimated, scopus: { keys: sources.includes('scopus') ? 1 : 0, reserve1: 0, pools: {}, affordable: null } });
  });
};

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const [source, action] = url.pathname.replace(/^\/api\/align\/?/, '').split('/');
  if (source === 'estimate' && !action) return request.method === 'GET' ? estimate(context) : json(405, { error: 'Method not allowed' });
  if (!LEGACY_SOURCES.includes(source)) return json(404, { error: `Unknown alignment source: ${source}` });
  const params = peopleAlignParamsOfQuery(source, url.searchParams);
  if (action === 'trigger' && request.method === 'GET') return startJob(context, 'people.align', params);
  if (action === 'progress' && request.method === 'GET') return jobProgress(context, 'people.align', { source });
  if (action === 'stop' && request.method === 'POST') return stopJob(context, 'people.align', { source });
  return json(404, { error: 'Not found' });
}
