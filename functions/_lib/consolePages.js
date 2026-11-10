// Pages of the DirlaData console (druid-internal docs/plan-druid-saas.md, lot 6 c), served by functions/console on
// SAAS_ADMIN_HOST: plain HTML and a little JavaScript over the JSON routes /console/api/*. French only: a tool for
// DirlaData, not for the establishments.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
:root{--ink:#1c1b19;--muted:#6f6a5e;--line:#e4ddcc;--bg:#f4f0e6;--card:#fff;--warn:#8a6113;--err:#9b2c2c;--ok:#1f7a4d}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);font-size:14px}
header{display:flex;align-items:center;gap:1rem;padding:.8rem 1.5rem;background:var(--ink);color:#fff}header a{color:#fff}
main{max-width:76rem;margin:0 auto;padding:1.5rem}h1{font-size:1.3rem;margin:0 0 1rem}h2{font-size:1.05rem;margin:1.5rem 0 .5rem}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:12px;overflow:hidden}th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600}.muted{color:var(--muted)}.warn{color:var(--warn);font-weight:600}.err{color:var(--err);font-weight:600}.ok{color:var(--ok);font-weight:600}
.card{background:var(--card);border-radius:14px;padding:1rem 1.2rem;margin:0 0 1rem}button,select,input{font:inherit}
button{border:0;border-radius:999px;padding:.35rem .9rem;background:var(--ink);color:#fff;cursor:pointer;font-weight:600}button.light{background:#ece6d6;color:var(--ink)}
input,select{padding:.35rem .6rem;border:1px solid var(--line);border-radius:999px}pre{white-space:pre-wrap;font-size:11.5px;max-height:14rem;overflow:auto;background:#faf8f2;padding:.5rem;border-radius:8px;margin:.3rem 0 0}
details summary{cursor:pointer;color:var(--muted)}.row{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center}#msg{min-height:1.2rem}
</style></head><body>
<header><strong>Console DirlaData</strong><a href="/console">Établissements</a><a href="/console/events">Journal</a><span style="flex:1"></span><a href="/console/logout">Se déconnecter</a></header>
<main>${body}</main></body></html>`;

export const consoleLoginPage = ({ sent, reason }) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Console DirlaData</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f4f0e6;color:#1c1b19}
main{width:min(24rem,calc(100% - 2rem));background:#fff;border-radius:20px;padding:2rem}input{width:100%;box-sizing:border-box;padding:.65rem .9rem;border:1px solid #d9d3c3;border-radius:999px;font-size:1rem}
button{margin-top:1rem;width:100%;padding:.7rem;border:0;border-radius:999px;background:#1c1b19;color:#fff;font-weight:600;font-size:1rem;cursor:pointer}.ok{background:#e7f5ec;color:#1f7a4d;border-radius:12px;padding:.75rem 1rem}.err{background:#fdecea;color:#9b2c2c;border-radius:12px;padding:.75rem 1rem}</style></head>
<body><main><h1 style="margin-top:0">Console DirlaData</h1>
${reason ? `<p class="err">${reason === 'expired' ? 'Lien expiré ou déjà utilisé.' : 'Lien invalide.'}</p>` : ''}
${sent ? '<p class="ok">Si cette adresse est autorisée, un lien de connexion vient de lui être envoyé (15 minutes).</p>' : `<form id="f"><input name="email" type="email" required autofocus placeholder="adresse e-mail"><button>Recevoir un lien</button></form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();e.target.querySelector('button').disabled=true;
try{await fetch('/console/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e.target.email.value})});}catch{}
location.replace('/console?sent=1');});</script>`}
</main></body></html>`;

const CLIENT = `
const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=(iso)=>iso?new Date(iso).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'—';
const api=async(path,body)=>{const r=await fetch('/console/api'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;};
const say=(t,cls)=>{const m=$('msg');m.className=cls||'';m.textContent=t;};
const statusCls={active:'ok',suspended:'warn',provisioning:'muted'};const jobCls={done:'ok',failed:'err',running:'warn',queued:'muted',cancelled:'muted'};`;

export const consoleTenantsPage = () => page('Console DirlaData — établissements', `
<h1>Établissements</h1><p id="msg"></p>
<table><thead><tr><th>Établissement</th><th>Offre</th><th>Statut</th><th>Comptes</th><th>Dernière connexion</th><th>Dernier job</th><th>Échecs 7 j</th><th>Devis</th><th>Créé le</th></tr></thead><tbody id="rows"><tr><td colspan="9" class="muted">Chargement…</td></tr></tbody></table>
<script>${CLIENT}
api('/tenants').then(({tenants})=>{$('rows').innerHTML=tenants.length?tenants.map((t)=>'<tr><td><a href="/console/t/'+esc(t.slug)+'"><strong>'+esc(t.label)+'</strong></a><br><span class="muted">'+esc(t.host||t.slug)+'</span></td><td>'+esc(t.plan)+'</td><td class="'+(statusCls[t.status]||'')+'">'+esc(t.status)+(t.deleteAfter?'<br><span class="warn">suppression le '+when(t.deleteAfter)+'</span>':'')+'</td><td>'+t.members+'</td><td>'+when(t.lastLoginAt)+'</td><td>'+(t.lastJob?'<span class="'+(jobCls[t.lastJob.status]||'')+'">'+esc(t.lastJob.type)+' · '+esc(t.lastJob.status)+'</span><br><span class="muted">'+when(t.lastJob.createdAt)+'</span>':'—')+'</td><td class="'+(t.failedJobs7d?'err':'muted')+'">'+t.failedJobs7d+'</td><td>'+when(t.createdAt)+'</td></tr>').join(''):'<tr><td colspan="8" class="muted">Aucun établissement.</td></tr>';}).catch((e)=>say(e.message,'err'));
</script>`);

export const consoleTenantPage = (slug) => page(`Console DirlaData — ${slug}`, `
<h1 id="title">${esc(slug)}</h1><p id="msg"></p>
<div class="card" id="facts">Chargement…</div>
<div class="card"><div class="row"><label>Offre <select id="plan"></select></label><button id="setPlan">Changer l'offre</button>
<span style="flex:1"></span><button class="light" id="status"></button></div><div class="row" id="deletion"></div></div>
<h2>Demandes de devis</h2><table><tbody id="quotes"></tbody></table>
<h2>Membres</h2><table><thead><tr><th>E-mail</th><th>Rôle</th><th>Dernière connexion</th><th></th></tr></thead><tbody id="members"></tbody></table>
<h2>Jobs</h2><table><thead><tr><th>Job</th><th>Statut</th><th>Créé</th><th>Fini</th><th></th></tr></thead><tbody id="jobs"></tbody></table>
<h2>Demandes d'accès</h2><table><tbody id="requests"></tbody></table>
<h2>Journal de la console</h2><table><tbody id="events"></tbody></table>
<script>${CLIENT}
const SLUG=${JSON.stringify(slug)};
const load=async()=>{const d=await api('/tenants/'+encodeURIComponent(SLUG));const t=d.tenant;
$('title').textContent=t.label;
$('facts').innerHTML='<div class="row"><span><strong>'+esc(t.slug)+'</strong></span><span class="'+(statusCls[t.status]||'')+'">'+esc(t.status)+'</span><span>offre <strong>'+esc(t.plan)+'</strong></span><span class="muted">schéma '+esc(t.schema)+'</span><span class="muted">ROR '+esc(t.ror||'—')+' · UAI '+esc(t.uai||'—')+'</span><span class="muted">créé le '+when(t.createdAt)+' par '+esc(t.createdBy||'—')+'</span></div><div class="muted">'+d.hosts.map((h)=>'<a href="https://'+esc(h.host)+'/" target="_blank" rel="noreferrer">'+esc(h.host)+'</a>').join(' · ')+' · domaines : '+esc((t.mailDomains||[]).join(', ')||'—')+'</div>';
$('plan').innerHTML=d.plans.map((p)=>'<option value="'+esc(p.code)+'"'+(p.code===t.plan?' selected':'')+'>'+esc(p.label)+' ('+(p.seats===null?'illimité':p.seats+' comptes')+')</option>').join('');
const del=t.deletion;$('deletion').innerHTML=del?'<span class="warn"><strong>Suppression prévue le '+when(del.deleteAfter)+'</strong></span> <span class="muted">demandée le '+when(del.requestedAt)+' par '+esc(del.requestedBy||'—')+'</span> <button class="light" id="cancelDel">Annuler la suppression</button>':'';
const st=$('status');st.style.display=(!del&&(t.status==='active'||t.status==='suspended'))?'':'none';st.textContent=t.status==='suspended'?'Réactiver':'Suspendre';st.dataset.to=t.status==='suspended'?'active':'suspended';
$('members').innerHTML=d.members.map((m)=>'<tr><td>'+esc(m.email)+'</td><td>'+esc(m.role)+(m.role==='lab'?' ('+esc(m.labScope.join(', '))+')':'')+'</td><td>'+(m.lastLoginAt?when(m.lastLoginAt):'<span class="warn">jamais</span>')+'</td><td><button class="light" data-imp="'+esc(m.id)+'" data-email="'+esc(m.email)+'">Ouvrir en tant que</button></td></tr>').join('');
$('jobs').innerHTML=d.jobs.map((j)=>'<tr><td><strong>'+esc(j.type)+'</strong><br><span class="muted">'+esc(j.key)+' · essais '+j.attempts+'</span>'+(j.logTail?'<details><summary>journal</summary><pre>'+esc(j.logTail)+'</pre></details>':'')+'</td><td class="'+(jobCls[j.status]||'')+'">'+esc(j.status)+(j.error?'<br><span class="muted">'+esc(j.error)+'</span>':'')+'</td><td>'+when(j.createdAt)+'</td><td>'+when(j.finishedAt)+'</td><td>'+((j.status==='failed'||j.status==='cancelled'||j.status==='done')?'<button class="light" data-retry="'+esc(j.id)+'">Relancer</button>':'')+'</td></tr>').join('')||'<tr><td class="muted">Aucun job.</td></tr>';
$('quotes').innerHTML=d.quotes.map((q)=>'<tr><td>'+when(q.createdAt)+'</td><td><a href="mailto:'+esc(q.email)+'">'+esc(q.email)+'</a></td><td><strong>'+esc(q.plan)+'</strong>'+(q.feature?' <span class="muted">(depuis '+esc(q.feature)+')</span>':'')+'</td><td>'+(q.researchers??'—')+' chercheurs · '+(q.accounts??'—')+' comptes'+(q.message?'<br><span class="muted">'+esc(q.message)+'</span>':'')+'</td><td>'+(q.handledAt?'<span class="muted">traitée le '+when(q.handledAt)+'</span>':'<button class="light" data-quote="'+esc(q.id)+'">Marquer traitée</button>')+'</td></tr>').join('')||'<tr><td class="muted">Aucune.</td></tr>';
$('requests').innerHTML=d.accessRequests.map((r)=>'<tr><td>'+esc(r.email)+'</td><td>'+when(r.createdAt)+'</td><td class="muted">'+(r.handledAt?'traitée le '+when(r.handledAt):'en attente')+'</td></tr>').join('')||'<tr><td class="muted">Aucune.</td></tr>';
$('events').innerHTML=d.events.map((e)=>'<tr><td>'+when(e.at)+'</td><td>'+esc(e.actor)+'</td><td><strong>'+esc(e.action)+'</strong></td><td class="muted">'+esc(JSON.stringify(e.details))+'</td></tr>').join('')||'<tr><td class="muted">Rien.</td></tr>';};
const act=async(fn,ok)=>{try{const r=await fn();say(ok?ok(r):'Fait.','ok');await load();}catch(e){say(e.message,'err');}};
$('setPlan').onclick=()=>{const p=$('plan').value;if(confirm('Passer '+SLUG+' en offre '+p+' ?'))act(()=>api('/tenants/'+encodeURIComponent(SLUG)+'/plan',{plan:p}),(r)=>'Offre : '+r.from+' → '+r.to+'.');};
$('status').onclick=(e)=>{const to=e.target.dataset.to;if(confirm(to==='suspended'?'Suspendre '+SLUG+' ? (lecture seule pour tous)':'Réactiver '+SLUG+' ?'))act(()=>api('/tenants/'+encodeURIComponent(SLUG)+'/status',{status:to}));};
document.addEventListener('click',(e)=>{const b=e.target.closest('button');if(!b)return;
if(b.id==='cancelDel'){if(confirm('Annuler la suppression de '+SLUG+' ? (il retrouve son statut précédent)'))act(()=>api('/tenants/'+encodeURIComponent(SLUG)+'/cancel-deletion',{}),(r)=>'Suppression annulée, statut '+r.status+'.');return;}
if(b.dataset.quote)act(()=>api('/tenants/'+encodeURIComponent(SLUG)+'/quotes/'+b.dataset.quote+'/handled',{}),()=>'Demande marquée traitée.');
if(b.dataset.retry)act(()=>api('/tenants/'+encodeURIComponent(SLUG)+'/jobs/'+b.dataset.retry+'/retry',{}),()=>'Job remis en file.');
if(b.dataset.imp){const why=prompt('Ouvrir le Druid de '+SLUG+' en tant que '+b.dataset.email+' (session de 2 h, tracée). Motif :','support');if(why===null)return;
api('/tenants/'+encodeURIComponent(SLUG)+'/impersonate',{memberId:b.dataset.imp,reason:why}).then((r)=>{window.open(r.url,'_blank','noopener');load();}).catch((err)=>say(err.message,'err'));}});
load().catch((e)=>say(e.message,'err'));
</script>`);

export const consoleEventsPage = () => page('Console DirlaData — journal', `
<h1>Journal de la console</h1><p id="msg"></p><table><thead><tr><th>Quand</th><th>Qui</th><th>Établissement</th><th>Action</th><th>Détails</th></tr></thead><tbody id="rows"></tbody></table>
<script>${CLIENT}
api('/events').then(({events})=>{$('rows').innerHTML=events.map((e)=>'<tr><td>'+when(e.at)+'</td><td>'+esc(e.actor)+'</td><td>'+(e.slug?'<a href="/console/t/'+esc(e.slug)+'">'+esc(e.slug)+'</a>':'—')+'</td><td><strong>'+esc(e.action)+'</strong></td><td class="muted">'+esc(JSON.stringify(e.details))+'</td></tr>').join('')||'<tr><td class="muted">Rien.</td></tr>';}).catch((e)=>say(e.message,'err'));
</script>`);
