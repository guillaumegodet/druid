// Structure alignment runs of a tenant, same routes as server.cjs (components/structures/StructureAlignPanel.tsx):
//   GET  /api/structures-align/trigger?mode=&types=&only=&force=&limit=   queues a `structures.align` job
//   GET  /api/structures-align/progress
//   POST /api/structures-align/stop
// druid-internal docs/plan-druid-saas.md, lots 3 a and 4 e.
import { structuresAlignParamsOfQuery } from '../../../lib/saas/jobs.ts';
import { jobProgress, startJob, stopJob } from '../../_lib/jobs.js';
import { json } from '../../_lib/saas.js';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/structures-align\/?/, '').replace(/\/$/, '');
  if (action === 'trigger' && request.method === 'GET') return startJob(context, 'structures.align', structuresAlignParamsOfQuery(url.searchParams));
  if (action === 'progress' && request.method === 'GET') return jobProgress(context, 'structures.align', {});
  if (action === 'stop' && request.method === 'POST') return stopJob(context, 'structures.align', {});
  return json(404, { error: 'Not found' });
}
