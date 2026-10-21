// Transactional e-mails of a multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lot 1 e), sent through
// Resend: secrets RESEND_API_KEY and EMAIL_FROM (« Druid <no-reply@…> ») of the deployment. Text in French and English:
// the tenant has no language setting yet.
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const sendEmail = async (env, { to, subject, html, text }) => {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Druid <no-reply@example.org>', to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
};

const wrap = (title, inner) => `<!doctype html><html><body style="margin:0;background:#f4f0e6;padding:32px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1b19">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:20px;padding:32px">
<p style="font-weight:800;font-size:20px;margin:0 0 20px">${escape(title)}</p>
${inner}
</div></body></html>`;

/** Magic link of a tenant: valid 15 minutes, single use. */
export const sendMagicLink = (env, { to, link, tenantLabel }) => {
  const title = `Druid — ${tenantLabel}`;
  const html = wrap(title, `
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">Bonjour,<br>cliquez sur le bouton pour vous connecter à Druid (${escape(tenantLabel)}). Ce lien est valable 15 minutes et ne sert qu'une fois.</p>
<p style="font-size:13px;color:#6f6a5e;margin:0 0 20px">Hello, click the button to sign in to Druid (${escape(tenantLabel)}). The link is valid for 15 minutes and works once.</p>
<p><a href="${escape(link)}" style="display:inline-block;background:#1c1b19;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">Me connecter · Sign in</a></p>
<p style="font-size:12px;color:#6f6a5e;word-break:break-all;margin:20px 0 0">${escape(link)}</p>
<p style="font-size:12px;color:#9a9486;margin:24px 0 0">Si vous n'avez rien demandé, ignorez ce message. · If you did not ask for it, ignore this message.</p>`);
  const text = `Druid — ${tenantLabel}\n\nConnexion / Sign in (15 min, usage unique / single use):\n${link}\n`;
  return sendEmail(env, { to, subject: `Votre lien de connexion Druid · Your Druid sign-in link (${tenantLabel})`, html, text });
};
