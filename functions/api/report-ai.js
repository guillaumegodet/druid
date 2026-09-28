// Cloudflare Pages Function — AI texts of the reports (POST /api/report-ai, docs/plan-mes-rapports.md
// lot 8). Same tasks, prompts and guards as server.cjs, from scripts/lib/reports_ai.cjs.
// Identity: Cloudflare Access (anonymous only locally with ALLOW_ANONYMOUS_WRITES=true); the ILAAS
// key is the instance's (ILAAS_API_KEY, per instance on a shared deployment). Refused on a
// read-only instance (public demo): anonymous visitors must not spend the ILAAS quota.
import reportsAi from '../../scripts/lib/reports_ai.cjs';
import { instanceEnv, instanceOf } from '../_lib/instance.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request } = context;
  const instance = instanceOf(context);
  const env = instanceEnv(context.env, instance);
  if (instance.readOnly) return json(403, { error: 'Read-only instance: writes are disabled' });
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  const anonymousAllowed = !instance.shared && env.ALLOW_ANONYMOUS_WRITES === 'true';
  if (!email && !anonymousAllowed) return json(401, { error: 'Unauthorized' });
  if (!env.ILAAS_API_KEY) return json(500, { error: 'ILAAS_API_KEY not configured on Cloudflare (secret + redeploy)' });
  let body = {};
  try { body = await request.json(); } catch { /* invalid task below */ }
  const ai = reportsAi.createReportAi({
    apiBase: env.ILAAS_API_BASE,
    apiKey: env.ILAAS_API_KEY,
    model: env.ILAAS_MODEL || 'mistral-small-4-119b',
  });
  const out = await ai.run(body);
  return json(out.status, out.body);
}
