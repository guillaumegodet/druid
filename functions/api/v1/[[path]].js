// Cloudflare Pages Function — directory domain API (/api/v1), druid-internal
// docs/plan-migration-postgresql.md, lot 1. Same Hono application as server.cjs (lib/directory/api.ts),
// bundled by Pages with the TypeScript modules it imports.
//
// Storage of the instance serving the request: functions/_lib/storage.js — its Grist document (a read-only instance may
// read a public document without key, as the former /api/grist proxy did) or its PostgreSQL database through
// Hyperdrive (lot 10 a).
//
// Rights: the Cloudflare instances have no lab scope (see functions/api/me.js): every account that gets
// through Cloudflare Access reads the whole directory, as it did through the proxy. Writes, as through the
// proxy: refused on a read-only instance, and without a Cloudflare Access identity (unless
// ALLOW_ANONYMOUS_WRITES=true locally). The audit of the writes goes to the Functions log.
import { AUDIT_HEADER, createDirectoryApi } from '../../../lib/directory/api.ts';
import { accessForMember } from '../../../lib/saas/controlPlane.ts';
import { identityOf, memberOf } from '../../_lib/identity.js';
import { storageOf } from '../../_lib/storage.js';

const api = createDirectoryApi();

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * Tenant of the control plane (druid-internal docs/plan-druid-saas.md, lot 1 e): private — every request needs a
 * session of a member; the scope and the right to write come from the member's role (lib/saas/controlPlane.ts).
 */
const tenantContext = (context, instance) => {
  const identity = identityOf(context);
  const member = memberOf(context);
  if (!identity || !member) return { refusal: json(identity ? 403 : 401, { error: identity ? 'This account is not a member of this Druid' : 'Authentication required' }) };
  const { scope } = accessForMember(member, instance.readOnly);
  const writeRefusal = instance.readOnly
    ? { status: 403, error: 'Read-only instance: writes are disabled' }
    : (member.role === 'viewer' ? { status: 403, error: 'Read-only account: writes are disabled' } : null);
  return { identity, scope, writeRefusal };
};

export async function onRequest(context) {
  const { instance, store, missing, release } = storageOf(context);
  if (missing) { await release(); return json(500, { error: missing }); }
  let identity;
  let scope = { all: true, labAnchors: [] };
  let writeRefusal;
  if (instance.tenant) {
    const t = tenantContext(context, instance);
    if (t.refusal) { await release(); return t.refusal; }
    ({ identity, scope, writeRefusal } = t);
  } else {
    identity = identityOf(context);
    const allowAnonymousWrites = !instance.shared && context.env.ALLOW_ANONYMOUS_WRITES === 'true';
    writeRefusal = instance.readOnly
      ? { status: 403, error: 'Read-only instance: writes are disabled' }
      : (!identity && !allowAnonymousWrites ? { status: 403, error: 'Writes require an authenticated user (Cloudflare Access)' } : null);
  }

  let response;
  try {
    response = await api.fetch(context.request, { ...store, scope, actor: identity || undefined, writeRefusal });
  } finally {
    // The responses of the domain API are built in memory: the database client of the request can go.
    await release();
  }
  const audit = response.headers.get(AUDIT_HEADER);
  if (!audit) return response;
  console.log(JSON.stringify({ event: 'api.write', instance: instance.slug, user: identity, path: new URL(context.request.url).pathname, status: response.status, writes: JSON.parse(audit) }));
  const headers = new Headers(response.headers);
  headers.delete(AUDIT_HEADER);
  return new Response(response.body, { status: response.status, headers });
}
