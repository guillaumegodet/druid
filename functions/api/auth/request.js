// POST /api/auth/request { email, next? } — magic link of a tenant (druid-internal docs/plan-druid-saas.md, lot 1 e).
// Always 200 for a well-formed address (no account enumeration): the link is only sent to a MEMBER of the tenant.
// At most 5 links per address and quarter of an hour. Without RESEND_API_KEY, `SAAS_DEV_LINKS=true` returns the link in
// the response (local runs and tests only).
import { findMember, isValidEmail, normalizeEmail } from '../../../lib/saas/controlPlane.ts';
import { instanceOf } from '../../_lib/instance.js';
import { issueMagicLink, json, safeNextPath, withSaasDb } from '../../_lib/saas.js';

export const LINKS_PER_QUARTER = 5;

/** Links already sent to `email` for `tenantId` (null = the portal) in the last quarter of an hour. */
export const recentLinks = async (db, email, tenantId) => {
  let q = db.selectFrom('magic_link').select(({ fn }) => fn.countAll().as('n'))
    .where('email', '=', email).where('created_at', '>', new Date(Date.now() - 15 * 60_000).toISOString());
  q = tenantId === null ? q.where('tenant_id', 'is', null) : q.where('tenant_id', '=', tenantId);
  return Number((await q.executeTakeFirst())?.n || 0);
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const instance = instanceOf(context);
  if (!instance.tenant) return json(404, { error: 'Not a tenant of the control plane' });
  let body = {};
  try {
    const ct = request.headers.get('Content-Type') || '';
    body = ct.includes('application/json') ? await request.json() : Object.fromEntries((await request.formData()).entries());
  } catch {
    return json(400, { error: 'Invalid request' });
  }
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return json(400, { error: 'Invalid e-mail address' });
  const nextPath = safeNextPath(body.next);
  const tenant = instance.tenant;
  let devLink = null;
  try {
    await withSaasDb(env, async (db) => {
      const member = await findMember(db, tenant.id, email);
      if (!member) return;
      if (await recentLinks(db, email, tenant.id) >= LINKS_PER_QUARTER) return;
      devLink = await issueMagicLink(db, env, { email, tenantId: tenant.id, verifyUrl: `${new URL(request.url).origin}/api/auth/verify`, nextPath, label: instance.label });
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'auth.request.failed', instance: instance.slug, error: String(err?.message || err) }));
  }
  return json(200, devLink ? { ok: true, link: devLink } : { ok: true });
}
