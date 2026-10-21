// Cloudflare Pages middleware of every /api route (docs/plan-architecture-multi-instances.md, lot 6 b; druid-internal
// docs/plan-druid-saas.md, lot 1 c): resolves the instance serving the request host once and hands it to the handlers
// in context.data.instance.
//  - the registry written by the build (instance.json of the demos, Centrale…) is consulted first;
//  - on a control-plane deployment (SAAS_HYPERDRIVE bound), a host that no instance.json declares is looked up in the
//    `saas` schema (tenant_host); the session of the user is resolved at the same time (context.data.identity,
//    context.data.member — the Access header is then ignored, functions/_lib/identity.js);
//  - otherwise 404 — never the data of another instance.
import { instanceForRequestAnywhere, json, saasIdentity } from '../_lib/saas.js';

export async function onRequest(context) {
  const { request, env } = context;
  const instance = await instanceForRequestAnywhere(request, env);
  if (!instance) return json(404, { error: 'Unknown Druid instance for this host' });
  if (instance.tenant) {
    const { email, member } = await saasIdentity(env, request, instance);
    context.data.identity = email;
    context.data.member = member;
  }
  context.data.instance = instance;
  return context.next();
}
