// GET /auth/login[?next=…&sent=1&reason=…] — login page of a tenant of the control plane (druid-internal
// docs/plan-druid-saas.md, lot 1 e): an e-mail address, a magic link (POST /api/auth/request). Outside /api, so the
// tenant is resolved here. On an instance of the build-time registry there is no login page (Cloudflare Access or a
// public instance): back to the home page.
import { instanceForRequestAnywhere, safeNextPath } from '../_lib/saas.js';

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const loginPage = ({ label, next, sent, reason }) => {
  const messages = {
    invalid: 'Lien invalide. · Invalid link.',
    expired: 'Ce lien a expiré ou a déjà servi : demandez-en un nouveau. · This link has expired or was already used: ask for a new one.',
  };
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Druid — ${escape(label)}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1b19;background:linear-gradient(158deg,#f4f0e6,#f2e8ce)}
main{width:min(26rem,calc(100% - 2rem));background:rgba(255,255,255,.7);backdrop-filter:blur(20px);border:1px solid #fff;border-radius:24px;padding:2rem;box-shadow:0 20px 60px rgba(28,27,25,.08)}
h1{font-size:1.4rem;margin:0 0 .25rem}p{margin:.5rem 0;line-height:1.5}.muted{color:#6f6a5e;font-size:.9rem}
label{display:block;font-weight:600;margin:1rem 0 .4rem}input{width:100%;box-sizing:border-box;padding:.7rem .9rem;border:1px solid #d9d3c3;border-radius:999px;font-size:1rem}
button{margin-top:1rem;width:100%;padding:.75rem;border:0;border-radius:999px;background:#1c1b19;color:#fff;font-weight:600;font-size:1rem;cursor:pointer}
.ok{background:#e7f5ec;color:#1f7a4d;border-radius:12px;padding:.75rem 1rem}.err{background:#fdecea;color:#9b2c2c;border-radius:12px;padding:.75rem 1rem}
</style></head><body><main>
<h1>Druid</h1><p class="muted">${escape(label)}</p>
${reason && messages[reason] ? `<p class="err">${messages[reason]}</p>` : ''}
${sent ? `<p class="ok">Si cette adresse est connue, un lien de connexion vient de lui être envoyé (valable 15 minutes). · If this address is known, a sign-in link was just sent to it (valid 15 minutes).</p>`
  : `<form method="POST" action="/api/auth/request" id="f">
<input type="hidden" name="next" value="${escape(next || '')}">
<label for="email">Adresse e-mail · E-mail address</label>
<input id="email" name="email" type="email" required autocomplete="email" autofocus placeholder="prenom.nom@example.org">
<button type="submit">Recevoir un lien de connexion · Send me a sign-in link</button>
<p class="muted">Pas de mot de passe : le lien reçu par e-mail ouvre votre session. · No password: the link you receive opens your session.</p>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target; const data = { email: form.email.value, next: form.next.value };
  form.querySelector('button').disabled = true;
  try { await fetch('/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); } catch {}
  const u = new URL(location.href); u.searchParams.set('sent', '1'); u.searchParams.delete('reason'); location.replace(u.toString());
});
</script>`}
</main></body></html>`;
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const instance = await instanceForRequestAnywhere(context.request, context.env);
  if (!instance || !instance.tenant) return Response.redirect(`${url.origin}/`, 302);
  const html = loginPage({
    label: instance.label, next: safeNextPath(url.searchParams.get('next')), sent: url.searchParams.get('sent') === '1', reason: url.searchParams.get('reason') || '',
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
