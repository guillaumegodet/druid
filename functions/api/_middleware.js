// Cloudflare Pages middleware of every /api route (docs/plan-architecture-multi-instances.md, lot 6 b):
// resolves the instance serving the request host once (functions/_lib/instance.js) and hands it to
// the handlers in context.data.instance. On a deployment shared by several instances, a host that no
// instance.json declares gets 404 — never the data of another instance.
import { instanceForRequest } from '../_lib/instance.js';

export async function onRequest(context) {
  const instance = instanceForRequest(context.request, context.env);
  if (!instance) {
    return new Response(JSON.stringify({ error: 'Unknown Druid instance for this host' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  context.data.instance = instance;
  return context.next();
}
