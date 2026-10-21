// Jobs of a tenant (druid-internal docs/plan-druid-saas.md, lot 3 a):
//   GET  /api/jobs?limit=50         the newest jobs of the tenant (every member)
//   POST /api/jobs { type, params } queues a job (owner, admin): 202, or 409 with the live job of the same key
//   GET  /api/jobs/:id              one job and its progress
//   POST /api/jobs/:id/cancel       stops it (queued → cancelled, running → the runner ends the child process)
import { cancelOneJob, jobsOfTenant, oneJob, readJsonBody, startJob } from '../../_lib/jobs.js';
import { json } from '../../_lib/saas.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/jobs\/?/, '').replace(/\/$/, '');
  if (!rest) {
    if (request.method === 'GET') return jobsOfTenant(context, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    if (request.method === 'POST') {
      const body = await readJsonBody(request);
      if (!body) return json(400, { error: 'Invalid request' });
      return startJob(context, String(body.type || ''), body.params || {});
    }
    return json(405, { error: 'Method not allowed' });
  }
  const [id, action] = rest.split('/');
  if (!UUID_RE.test(id)) return json(404, { error: 'Not found' });
  if (!action && request.method === 'GET') return oneJob(context, id);
  if (action === 'cancel' && request.method === 'POST') return cancelOneJob(context, id);
  return json(404, { error: 'Not found' });
}
