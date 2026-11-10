/**
 * @file email.ts
 * @description Transactional e-mails of a multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lots 1 e
 * and 2 e), sent through Resend by the Cloudflare Functions (functions/_lib/email.js) and by the runner. Texts in
 * French and English: a tenant has no language setting yet.
 */
export interface EmailEnv { RESEND_API_KEY?: string; EMAIL_FROM?: string }

const escape = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const sendEmail = async (env: EmailEnv, { to, subject, html, text, replyTo }: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<void> => {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Druid <no-reply@example.org>', to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
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

/** A quote request of a tenant (lot 6 b), to DirlaData (`SAAS_SALES_EMAIL`), answerable to the requester. */
export const sendQuoteRequest = (env: EmailEnv, { to, label, slug, requester, plan, researchers, accounts, message, feature }: {
  to: string; label: string; slug: string; requester: string; plan: string; researchers: number | null; accounts: number | null; message: string | null; feature: string | null;
}): Promise<void> => {
  const rows: [string, string][] = [
    ['Établissement', `${label} (${slug})`], ['Demandeur', requester], ['Offre demandée', plan],
    ['Chercheurs (estimation)', researchers === null ? '—' : String(researchers)], ['Comptes souhaités', accounts === null ? '—' : String(accounts)],
    ['Depuis', feature ? `fonction verrouillée « ${feature} »` : 'Mon établissement'],
  ];
  const html = wrap(`Demande de devis — ${label}`, `
<table style="font-size:14px;line-height:1.6;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#6f6a5e">${escape(k)}</td><td style="font-weight:600">${escape(v)}</td></tr>`).join('')}</table>
${message ? `<p style="font-size:14px;line-height:1.6;white-space:pre-wrap;margin:20px 0 0">${escape(message)}</p>` : ''}
<p style="font-size:12px;color:#9a9486;margin:24px 0 0">Répondre à ce message écrit au demandeur.</p>`);
  const text = `${rows.map(([k, v]) => `${k} : ${v}`).join('\n')}\n\n${message || ''}\n`;
  return sendEmail(env, { to, subject: `Demande de devis Druid — ${label} (${plan})`, html, text, replyTo: requester });
};

const dateFr = (iso: string): string => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const dateEn = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

/** The export of the data is ready (lot 6 a-3): link to « My institution », where it is downloaded (owners only). */
export const sendExportReady = (env: EmailEnv, { to, label, adminUrl, expiresAt }: { to: string; label: string; adminUrl: string; expiresAt: string }): Promise<void> => {
  const title = `Druid — ${label}`;
  const html = wrap(title, `
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">L'export des données du Druid de ${escape(label)} est prêt. Téléchargez-le depuis Administration › Mon établissement (connexion requise) avant le ${escape(dateFr(expiresAt))} : il sera supprimé ensuite.</p>
<p style="font-size:13px;color:#6f6a5e;margin:0 0 20px">The data export of the Druid of ${escape(label)} is ready. Download it from Administration › My institution (sign-in required) before ${escape(dateEn(expiresAt))}: it is removed afterwards.</p>
${button(adminUrl, 'Télécharger · Download')}`);
  const text = `Druid — ${label}\n\nExport prêt jusqu'au ${dateFr(expiresAt)} / Export ready until ${dateEn(expiresAt)}:\n${adminUrl}\n`;
  return sendEmail(env, { to, subject: `Export de votre Druid prêt · Your Druid export is ready (${label})`, html, text });
};

/** A deletion was asked (lot 6 a-3): to every owner, with the date and how to cancel. */
export const sendDeletionScheduled = (env: EmailEnv, { to, label, requestedBy, deleteAfter, adminUrl }: { to: string; label: string; requestedBy: string; deleteAfter: string; adminUrl: string }): Promise<void> => {
  const title = `Druid — ${label}`;
  const html = wrap(title, `
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">${escape(requestedBy)} a demandé la suppression du Druid de ${escape(label)}. Il est désormais en lecture seule et sera supprimé définitivement le ${escape(dateFr(deleteAfter))} : base de données, tableaux de bord, comptes et clés. D'ici là, un propriétaire peut exporter les données ou annuler la suppression dans Administration › Mon établissement.</p>
<p style="font-size:13px;color:#6f6a5e;margin:0 0 20px">${escape(requestedBy)} asked for the deletion of the Druid of ${escape(label)}. It is now read-only and will be deleted for good on ${escape(dateEn(deleteAfter))}: database, dashboards, accounts and keys. Until then, an owner can export the data or cancel the deletion in Administration › My institution.</p>
${button(adminUrl, 'Mon établissement · My institution')}`);
  const text = `Druid — ${label}\n\nSuppression prévue le ${dateFr(deleteAfter)} / Deletion planned on ${dateEn(deleteAfter)} (${requestedBy}).\n${adminUrl}\n`;
  return sendEmail(env, { to, subject: `Suppression de votre Druid prévue · Deletion of your Druid planned (${label})`, html, text });
};

/** The deletion is done (lot 6 a-3): to the owners it had, as a record. */
export const sendTenantDeleted = (env: EmailEnv, { to, label }: { to: string; label: string }): Promise<void> => {
  const title = `Druid — ${label}`;
  const html = wrap(title, `
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">Le Druid de ${escape(label)} a été supprimé comme demandé : sa base de données, ses tableaux de bord, ses exports, ses comptes et ses clés n'existent plus. Les sauvegardes de l'hébergeur qui en gardent une copie expirent d'elles-mêmes.</p>
<p style="font-size:13px;color:#6f6a5e;margin:0">The Druid of ${escape(label)} was deleted as asked: its database, dashboards, exports, accounts and keys are gone. The backups of the host that still hold a copy expire on their own.</p>`);
  const text = `Druid — ${label}\n\nLe Druid a été supprimé. / The Druid was deleted.\n`;
  return sendEmail(env, { to, subject: `Votre Druid a été supprimé · Your Druid was deleted (${label})`, html, text });
};
