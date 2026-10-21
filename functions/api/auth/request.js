// POST /api/auth/request { email, next? } — magic link of a tenant (druid-internal docs/plan-druid-saas.md, lot 1 e).
// Always 200 for a well-formed address (no account enumeration): the link is only sent to a MEMBER of the tenant.
// At most 5 links per address and quarter of an hour. Without RESEND_API_KEY, `SAAS_DEV_LINKS=true` returns the link in
// the response (local runs and tests only).
import { createMagicLink, findMember, isValidEmail, normalizeEmail } from '../../../lib/saas/controlPlane.ts';
import { sendMagicLink } from '../../_lib/email.js';
import { instanceOf } from '../../_lib/instance.js';
import { json, safeNextPath, withSaasDb } from '../../_lib/saas.js';

const LINKS_PER_QUARTER = 5;

const generateToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const sha256Hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

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
      const recent = await db.selectFrom('magic_link').select(({ fn }) => fn.countAll().as('n'))
        .where('email', '=', email).where('tenant_id', '=', tenant.id).where('created_at', '>', new Date(Date.now() - 15 * 60_000).toISOString()).executeTakeFirst();
      if (Number(recent?.n || 0) >= LINKS_PER_QUARTER) return;
      const token = generateToken();
      await createMagicLink(db, { email, tenantId: tenant.id, tokenHash: await sha256Hex(token), nextPath });
      const link = `${new URL(request.url).origin}/api/auth/verify?token=${token}`;
      if (env.RESEND_API_KEY) await sendMagicLink(env, { to: email, link, tenantLabel: instance.label });
      else if (env.SAAS_DEV_LINKS === 'true') devLink = link;
      else throw new Error('RESEND_API_KEY not configured');
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'auth.request.failed', instance: instance.slug, error: String(err?.message || err) }));
  }
  return json(200, devLink ? { ok: true, link: devLink } : { ok: true });
}
