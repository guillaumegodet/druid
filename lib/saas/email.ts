/**
 * @file email.ts
 * @description Transactional e-mails of a multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lots 1 e
 * and 2 e), sent through Resend by the Cloudflare Functions (functions/_lib/email.js) and by the runner. Texts in
 * French and English: a tenant has no language setting yet.
 */
export interface EmailEnv { RESEND_API_KEY?: string; EMAIL_FROM?: string }

const escape = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const sendEmail = async (env: EmailEnv, { to, subject, html, text }: { to: string; subject: string; html: string; text: string }): Promise<void> => {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Druid <no-reply@example.org>', to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
};

const wrap = (title: string, inner: string): string => `<!doctype html><html><body style="margin:0;background:#f4f0e6;padding:32px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1b19">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:20px;padding:32px">
<p style="font-weight:800;font-size:20px;margin:0 0 20px">${escape(title)}</p>
${inner}
</div></body></html>`;

const button = (href: string, label: string): string =>
  `<p><a href="${escape(href)}" style="display:inline-block;background:#1c1b19;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">${escape(label)}</a></p>
<p style="font-size:12px;color:#6f6a5e;word-break:break-all;margin:20px 0 0">${escape(href)}</p>`;

const footer = `<p style="font-size:12px;color:#9a9486;margin:24px 0 0">Si vous n'avez rien demandé, ignorez ce message. · If you did not ask for it, ignore this message.</p>`;

/** Magic link of a tenant (or of the portal, `tenantLabel` = the portal name): valid 15 minutes, single use. */
export const sendMagicLink = (env: EmailEnv, { to, link, tenantLabel }: { to: string; link: string; tenantLabel: string }): Promise<void> => {
  const title = `Druid — ${tenantLabel}`;
  const html = wrap(title, `
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">Bonjour,<br>cliquez sur le bouton pour vous connecter à Druid (${escape(tenantLabel)}). Ce lien est valable 15 minutes et ne sert qu'une fois.</p>
<p style="font-size:13px;color:#6f6a5e;margin:0 0 20px">Hello, click the button to sign in to Druid (${escape(tenantLabel)}). The link is valid for 15 minutes and works once.</p>
${button(link, 'Me connecter · Sign in')}${footer}`);
  const text = `Druid — ${tenantLabel}\n\nConnexion / Sign in (15 min, usage unique / single use):\n${link}\n`;
  return sendEmail(env, { to, subject: `Votre lien de connexion Druid · Your Druid sign-in link (${tenantLabel})`, html, text });
};

/** The Druid of an establishment is built (lot 2 e): link to its login page. */
export const sendTenantReady = (env: EmailEnv, { to, label, loginUrl }: { to: string; label: string; loginUrl: string }): Promise<void> => {
  const title = `Druid — ${label}`;
  const html = wrap(title, `
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">Votre Druid est prêt : les structures de ${escape(label)} y sont, vous pouvez maintenant charger vos chercheurs, inviter vos collègues et lancer l'alignement des identifiants.</p>
<p style="font-size:13px;color:#6f6a5e;margin:0 0 20px">Your Druid is ready: the structures of ${escape(label)} are in, you can now load your researchers, invite colleagues and align identifiers.</p>
${button(loginUrl, 'Ouvrir mon Druid · Open my Druid')}${footer}`);
  const text = `Druid — ${label}\n\nVotre Druid est prêt / Your Druid is ready:\n${loginUrl}\n`;
  return sendEmail(env, { to, subject: `Votre Druid est prêt · Your Druid is ready (${label})`, html, text });
};

const ROLE_LABELS: Record<string, [string, string]> = {
  owner: ['propriétaire', 'owner'], admin: ['administrateur', 'administrator'], viewer: ['lecteur', 'reader'], lab: ['compte laboratoire', 'lab account'],
};

/** Invitation to a tenant (lot 6 a-1): link to its login page, where the invitee asks for a magic link. */
export const sendInvitation = (env: EmailEnv, { to, label, loginUrl, invitedBy, role }: { to: string; label: string; loginUrl: string; invitedBy: string; role: string }): Promise<void> => {
  const [fr, en] = ROLE_LABELS[role] || [role, role];
  const title = `Druid — ${label}`;
  const html = wrap(title, `
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">Bonjour,<br>${escape(invitedBy)} vous invite à rejoindre le Druid de ${escape(label)} (${escape(fr)}). Druid est le référentiel des structures, des chercheurs et de leurs publications de l'établissement. Pour vous connecter, saisissez votre adresse sur la page de connexion : vous recevrez un lien.</p>
<p style="font-size:13px;color:#6f6a5e;margin:0 0 20px">Hello, ${escape(invitedBy)} invites you to join the Druid of ${escape(label)} (${escape(en)}). To sign in, enter your address on the login page: you will receive a link.</p>
${button(loginUrl, 'Rejoindre · Join')}${footer}`);
  const text = `Druid — ${label}\n\n${invitedBy} vous invite / invites you (${fr} / ${en}):\n${loginUrl}\n`;
  return sendEmail(env, { to, subject: `Invitation au Druid de ${label} · Invitation to the Druid of ${label}`, html, text });
};

/** A colleague of a mail domain of the tenant asked for access (lot 6 a-1): to the owners, link to « My institution ». */
export const sendAccessRequestNotice = (env: EmailEnv, { to, label, requester, adminUrl }: { to: string; label: string; requester: string; adminUrl: string }): Promise<void> => {
  const title = `Druid — ${label}`;
  const html = wrap(title, `
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">${escape(requester)} demande un accès au Druid de ${escape(label)}. Vous pouvez l'inviter ou écarter la demande dans Administration › Mon établissement.</p>
<p style="font-size:13px;color:#6f6a5e;margin:0 0 20px">${escape(requester)} asks for access to the Druid of ${escape(label)}. Invite them or dismiss the request in Administration › My institution.</p>
${button(adminUrl, 'Voir la demande · See the request')}`);
  const text = `Druid — ${label}\n\n${requester} demande un accès / asks for access:\n${adminUrl}\n`;
  return sendEmail(env, { to, subject: `Demande d'accès au Druid de ${label} · Access request (${label})`, html, text });
};
