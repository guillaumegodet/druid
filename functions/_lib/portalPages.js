// Pages of the portal « create my Druid » (druid-internal docs/plan-druid-saas.md, lot 2 a-e), server-rendered by
// functions/start/[[path]].js: home (e-mail → magic link, list of one's Druids), the three-step assistant
// (establishment, labs, confirmation — plain JavaScript on the relays /start/api/*), the construction page.
// French and English side by side: the portal has no language setting.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1b19;background:linear-gradient(158deg,#f4f0e6,#f2e8ce) fixed}
main{width:min(60rem,calc(100% - 2rem));margin:2rem auto;background:rgba(255,255,255,.72);backdrop-filter:blur(20px);border:1px solid #fff;border-radius:24px;padding:2rem;box-shadow:0 20px 60px rgba(28,27,25,.08)}
main.narrow{width:min(28rem,calc(100% - 2rem))}
h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.15rem;margin:1.5rem 0 .5rem}p{line-height:1.5;margin:.5rem 0}.muted{color:#6f6a5e;font-size:.9rem}.en{color:#6f6a5e;font-size:.85rem}
label{display:block;font-weight:600;margin:1rem 0 .4rem}input[type=text],input[type=email],input[type=url],textarea,select{width:100%;padding:.65rem .9rem;border:1px solid #d9d3c3;border-radius:14px;font-size:1rem;background:#fff}
textarea{min-height:6rem;font-family:inherit}
.btn{display:inline-block;padding:.7rem 1.4rem;border:0;border-radius:999px;background:#1c1b19;color:#fff;font-weight:600;font-size:1rem;cursor:pointer;text-decoration:none}.btn.secondary{background:#fff;color:#1c1b19;border:1px solid #d9d3c3}.btn[disabled]{opacity:.5;cursor:default}
.row{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center}.grow{flex:1 1 16rem}
.ok{background:#e7f5ec;color:#1f7a4d;border-radius:12px;padding:.75rem 1rem}.err{background:#fdecea;color:#9b2c2c;border-radius:12px;padding:.75rem 1rem}.warn{background:#fff6dc;color:#7a5a00;border-radius:12px;padding:.75rem 1rem}
.steps{display:flex;gap:.5rem;margin:1rem 0 1.5rem;flex-wrap:wrap}.steps span{padding:.35rem .9rem;border-radius:999px;background:#fff;border:1px solid #d9d3c3;font-size:.9rem}.steps span.on{background:#1c1b19;color:#fff;border-color:#1c1b19}.steps span.done{background:#e7f5ec;border-color:#bfe3cc}
ul.list{list-style:none;padding:0;margin:.5rem 0}ul.list li{padding:.6rem .8rem;border:1px solid #eee7d6;border-radius:14px;background:#fff;margin:.35rem 0;cursor:pointer}ul.list li:hover{border-color:#1c1b19}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden}th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid #eee7d6;font-size:.93rem;vertical-align:top}th{background:#faf7ee;font-weight:600}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem 1rem;margin:.5rem 0}dt{color:#6f6a5e}dd{margin:0}
.bar{height:.6rem;background:#eee7d6;border-radius:999px;overflow:hidden}.bar i{display:block;height:100%;background:#1c1b19;width:0;transition:width .4s}
code{background:#faf7ee;padding:.1rem .35rem;border-radius:6px}
`;

const page = (title, body, { narrow = false } = {}) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main${narrow ? ' class="narrow"' : ''}>${body}</main></body></html>`;

/** Home: an e-mail form, or the Druids of the signed-in person and the button to create one. */
export const homePage = ({ email, tenants, sent, reason, baseDomain }) => {
  const messages = { invalid: 'Lien invalide. · Invalid link.', expired: 'Ce lien a expiré ou a déjà servi. · This link has expired or was already used.' };
  if (!email) {
    return page('Druid — créer mon Druid', `
<h1>Créer mon Druid</h1><p class="en">Create my Druid</p>
<p>Un <strong>Druid</strong> par établissement : vos structures de recherche, vos chercheurs et leurs identifiants (IdRef, ORCID, HAL, OpenAlex), vos publications. L'essai est gratuit, un compte par établissement.</p>
<p class="en">One Druid per establishment: your research structures, your researchers and their identifiers, your publications. The trial is free, one account per establishment.</p>
${reason && messages[reason] ? `<p class="err">${messages[reason]}</p>` : ''}
${sent ? `<p class="ok">Un lien de connexion vient d'être envoyé à cette adresse (valable 15 minutes). · A sign-in link was just sent to this address (valid 15 minutes).</p>`
  : `<form method="POST" action="/start/auth/request" id="f">
<label for="email">Votre adresse e-mail professionnelle · Your work e-mail address</label>
<input id="email" name="email" type="email" required autocomplete="email" autofocus placeholder="prenom.nom@example.org">
<p><button class="btn" type="submit">Recevoir un lien de connexion · Send me a sign-in link</button></p>
<p class="muted">Pas de mot de passe : le lien reçu par e-mail ouvre votre session. · No password: the link opens your session.</p>
</form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;
try{const r=await fetch('/start/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e.target.email.value})});const j=await r.json().catch(()=>({}));if(j.link){location.href=j.link;return;}}catch{}
const u=new URL(location.href);u.searchParams.set('sent','1');u.searchParams.delete('reason');location.replace(u.toString());});</script>`}`, { narrow: true });
  }
  const rows = tenants.map((t) => `<tr><td><strong>${esc(t.label)}</strong><br><span class="muted">${esc(t.host || `${t.slug}.${baseDomain}`)}</span></td><td>${esc(t.plan_code)}</td><td>${esc(t.status)}</td><td>${esc(t.role)}</td><td>${t.status === 'active' ? `<a class="btn secondary" href="https://${esc(t.host || `${t.slug}.${baseDomain}`)}/">Ouvrir · Open</a>` : `<a class="btn secondary" href="/start/wait/${esc(t.slug)}">Suivre · Follow</a>`}</td></tr>`).join('');
  return page('Druid — mes Druid', `
<div class="row"><h1 class="grow">Mes Druid</h1><span class="muted">${esc(email)} · <a href="/start/logout">Déconnexion · Sign out</a></span></div>
${tenants.length ? `<table><thead><tr><th>Établissement</th><th>Offre</th><th>État</th><th>Rôle</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Aucun Druid pour le moment. · No Druid yet.</p>'}
<p style="margin-top:1.5rem"><a class="btn" href="/start/new">Créer un Druid · Create a Druid</a></p>`);
};

/** The assistant: three steps, all client-side on the relays of /start/api. */
export const assistantPage = ({ email, baseDomain }) => page('Druid — créer mon Druid', `
<div class="row"><h1 class="grow">Créer mon Druid</h1><span class="muted">${esc(email)} · <a href="/start">Mes Druid</a></span></div>
<div class="steps"><span id="s1" class="on">1 · Établissement</span><span id="s2">2 · Laboratoires</span><span id="s3">3 · Confirmation</span></div>
<div id="step1">
<p>Quel établissement ? Tapez son nom : la liste vient du registre <strong>ROR</strong> ; pour un établissement français, l'UAI, le SIRET et les laboratoires (RNSR) sont retrouvés automatiquement.</p>
<p class="en">Which establishment? Type its name: the list comes from ROR; for a French establishment the UAI, SIRET and research units (RNSR) are fetched automatically.</p>
<label for="q">Nom de l'établissement · Name</label>
<div class="row"><input id="q" type="text" class="grow" placeholder="Nantes Université" autofocus autocomplete="off"><button class="btn secondary" id="search" type="button">Rechercher · Search</button></div>
<ul class="list" id="orgs"></ul><p id="searchMsg" class="muted"></p>
</div>
<div id="step2" hidden>
<h2 id="orgName"></h2><dl id="orgFacts"></dl>
<p id="labsIntro"></p>
<div class="row"><button class="btn secondary" type="button" id="all">Tout cocher · Check all</button><button class="btn secondary" type="button" id="none">Tout décocher · Uncheck all</button><span class="muted" id="labsCount"></span></div>
<table id="labs"><thead><tr><th></th><th>Sigle</th><th>Nom</th><th>Label</th><th>Type</th><th>RNSR</th></tr></thead><tbody></tbody></table>
<label for="extra">Autres laboratoires (un par ligne : <code>sigle ; nom ; RNSR facultatif</code>) · Other units (one per line: <code>acronym ; name ; RNSR optional</code>)</label>
<textarea id="extra" placeholder="LMJL ; Laboratoire de mathématiques Jean Leray ; 200012186A"></textarea>
<p class="row"><button class="btn secondary" type="button" id="back1">← Établissement</button><button class="btn" type="button" id="next3">Continuer · Continue →</button></p>
</div>
<div id="step3" hidden>
<h2>Votre Druid · Your Druid</h2>
<label for="label">Nom affiché · Display name</label><input id="label" type="text" maxlength="120">
<label for="slug">Adresse · Address</label>
<div class="row"><input id="slug" type="text" class="grow" pattern="[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?" maxlength="63"><span class="muted">.${esc(baseDomain)}</span></div>
<label for="domain">Domaine des adresses e-mail de l'établissement · E-mail domain of the establishment</label>
<input id="domain" type="text" placeholder="universite.fr">
<p class="muted">Vous serez l'administrateur (<code>${esc(email)}</code>). L'essai gratuit comprend un compte ; les offres Équipe et Complet en ajoutent. · You will be the administrator; the free trial includes one account, the Team and Complete plans add more.</p>
<p id="recap" class="muted"></p>
<p id="createMsg"></p>
<p class="row"><button class="btn secondary" type="button" id="back2">← Laboratoires</button><button class="btn" type="button" id="create">Créer mon Druid · Create my Druid</button></p>
</div>
<script>
const $=(id)=>document.getElementById(id);const state={org:null,details:null,labs:[]};
const api=async(path,opts)=>{const r=await fetch('/start/api'+path,opts);const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||r.status),{status:r.status,body:j});return j;};
const show=(n)=>{for(const i of [1,2,3]){$('step'+i).hidden=i!==n;$('s'+i).className=i===n?'on':(i<n?'done':'');}window.scrollTo(0,0);};
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function search(){const q=$('q').value.trim();if(q.length<2)return;$('searchMsg').textContent='Recherche… · Searching…';$('orgs').innerHTML='';
try{const j=await api('/organizations?q='+encodeURIComponent(q));$('searchMsg').textContent=j.items.length?'':'Aucun résultat. · No result.';
$('orgs').innerHTML=j.items.map((o,i)=>'<li data-i="'+i+'"><strong>'+esc(o.name)+'</strong> <span class="muted">'+esc([o.city,o.country].filter(Boolean).join(', '))+' · '+esc(o.types.join(', '))+' · ROR '+esc(o.ror)+'</span></li>').join('');
[...$('orgs').children].forEach((li)=>li.onclick=()=>pick(j.items[li.dataset.i]));}catch(e){$('searchMsg').textContent='Registre indisponible : '+e.message;}}
$('search').onclick=search;$('q').addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();search();}});
async function pick(org){state.org=org;$('searchMsg').textContent='Chargement des identifiants et des laboratoires… · Loading identifiers and units…';
try{const d=await api('/organizations/'+org.ror);state.details=d;const e=d.establishment||{};
$('orgName').textContent=org.name;const facts=[['ROR',org.ror],['Pays · Country',org.country],['Ville · City',e.city||org.city],['UAI',e.uai],['SIRET',e.siret],['IdRef',e.idref],['Wikidata',e.wikidata||org.wikidata],['OpenAlex',d.openalex&&d.openalex.id],['Site · Website',e.website||org.website]].filter((f)=>f[1]);
$('orgFacts').innerHTML=facts.map((f)=>'<dt>'+esc(f[0])+'</dt><dd>'+esc(f[1])+'</dd>').join('');
state.labs=d.labs.map((l)=>Object.assign({selected:true},l));renderLabs();
$('labsIntro').innerHTML=d.labs.length?'<strong>'+d.labs.length+'</strong> structures de recherche ont cette tutelle dans le RNSR : décochez celles qui ne sont pas les vôtres, ajoutez celles qui manquent. · research structures list this establishment among their supervisors in the RNSR: uncheck the ones that are not yours, add the missing ones.':'Aucune structure trouvée dans le RNSR pour cet établissement (hors France, ou tutelle non renseignée) : saisissez vos laboratoires ci-dessous. · No structure found in the RNSR for this establishment: enter your units below.';
$('label').value=e.name||org.name;$('slug').value=d.proposals.slug;$('domain').value=d.proposals.mailDomain||'';show(2);$('searchMsg').textContent='';}catch(err){$('searchMsg').textContent='Erreur : '+err.message;}}
function renderLabs(){const tb=$('labs').querySelector('tbody');tb.innerHTML=state.labs.map((l,i)=>'<tr><td><input type="checkbox" data-i="'+i+'"'+(l.selected?' checked':'')+'></td><td>'+esc(l.acronym||'')+'</td><td>'+esc(l.name)+(l.city?' <span class="muted">('+esc(l.city)+')</span>':'')+'</td><td>'+esc(l.label||'')+'</td><td class="muted">'+esc(l.type||'')+'</td><td class="muted">'+esc(l.rnsr||'')+'</td></tr>').join('');
tb.querySelectorAll('input').forEach((c)=>c.onchange=()=>{state.labs[c.dataset.i].selected=c.checked;count();});count();}
function count(){$('labsCount').textContent=state.labs.filter((l)=>l.selected).length+' / '+state.labs.length;}
$('all').onclick=()=>{state.labs.forEach((l)=>l.selected=true);renderLabs();};$('none').onclick=()=>{state.labs.forEach((l)=>l.selected=false);renderLabs();};
$('back1').onclick=()=>show(1);$('back2').onclick=()=>show(2);
function extraLabs(){return $('extra').value.split('\\n').map((l)=>l.trim()).filter(Boolean).map((l)=>{const p=l.split(';').map((s)=>s.trim());return{acronym:p[0],name:p[1]||p[0],rnsr:p[2]||null,selected:true};}).filter((l)=>l.acronym);}
function payload(){const o=state.org,e=(state.details&&state.details.establishment)||{};const labs=state.labs.filter((l)=>l.selected).concat(extraLabs()).map((l)=>({rnsr:l.rnsr||null,acronym:l.acronym||l.name.slice(0,60),name:l.name,label:l.label||null,type:l.labelType||l.type||null,website:l.website||null,tutelles:l.tutelles||[],uaiTutelles:l.uaiTutelles||[]}));
const d=$('domain').value.trim().toLowerCase();return{slug:$('slug').value.trim(),label:$('label').value.trim(),mailDomains:d?[d]:[],establishment:{ror:o.ror,name:e.name||o.name,nameEn:e.nameEn||o.nameEn||null,country:o.country,countryCode:o.countryCode,city:e.city||o.city,website:e.website||o.website,uai:e.uai||null,siret:e.siret||null,idref:e.idref||null,wikidata:e.wikidata||o.wikidata||null,openalex:(state.details.openalex&&state.details.openalex.id)||null},labs};}
$('next3').onclick=()=>{const p=payload();$('recap').textContent=p.labs.length+' laboratoire(s) seront créés avec l\\'établissement. · unit(s) will be created with the establishment.';show(3);};
$('create').onclick=async()=>{const b=$('create');b.disabled=true;$('createMsg').className='';$('createMsg').textContent='Création… · Creating…';
try{const p=payload();const j=await api('/tenants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});location.href='/start/wait/'+j.slug;}
catch(e){b.disabled=false;const body=e.body||{};
if(e.status===409&&body.existing){$('createMsg').className='warn';$('createMsg').innerHTML='Cet établissement a déjà un Druid (<strong>'+esc(body.existing.label)+'</strong>). Demander l\\'accès à son administrateur ? · This establishment already has a Druid. Ask its administrator for access? <button class="btn secondary" type="button" id="ask">Demander l\\'accès · Request access</button>';
$('ask').onclick=async()=>{try{await api('/tenants/'+body.existing.slug+'/access-request',{method:'POST'});$('createMsg').className='ok';$('createMsg').textContent='Demande enregistrée : l\\'administrateur sera prévenu. · Request recorded: the administrator will be told.';}catch(err){$('createMsg').className='err';$('createMsg').textContent=err.message;}};}
else if(e.status===409){$('createMsg').className='err';$('createMsg').textContent='Cette adresse est déjà prise, choisissez-en une autre. · This address is already taken, choose another one.';}
else{$('createMsg').className='err';$('createMsg').textContent=(body.error||e.message)+(body.issues?' — '+body.issues.join(' ; '):'');}}};
</script>`);

/** Construction page: polls the status of the tenant until it is active, then hands over to the tenant host. */
export const waitPage = ({ slug, label, host }) => page(`Druid — ${label}`, `
<h1>${esc(label)}</h1><p class="muted">${esc(host)}</p>
<p id="msg">Construction de votre Druid… · Building your Druid…</p>
<div class="bar"><i id="bar"></i></div>
<p id="detail" class="muted"></p>
<p id="actions" class="row"></p>
<p class="muted"><a href="/start">← Mes Druid</a></p>
<script>
const STEPS={schema:'Base de données · Database',directory:'Structures',route:'Adresse · Address',ready:'Prêt · Ready'};
async function poll(){try{const r=await fetch('/start/api/tenants/${esc(slug)}');const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);
const job=(j.jobs||[]).find((x)=>x.type==='tenant.provision');const p=(job&&job.progress)||{};document.getElementById('bar').style.width=(p.pct||(j.status==='active'?100:5))+'%';
document.getElementById('detail').textContent=p.step?(STEPS[p.step]||p.step)+(p.structures!=null?' — '+p.structures+' structures':''):'';
if(j.status==='active'){document.getElementById('msg').textContent='Votre Druid est prêt. · Your Druid is ready.';document.getElementById('actions').innerHTML='<button class="btn" id="open" type="button">Ouvrir mon Druid · Open my Druid</button>';
document.getElementById('open').onclick=async()=>{const r2=await fetch('/start/api/tenants/${esc(slug)}/open',{method:'POST'});const j2=await r2.json();if(j2.url)location.href=j2.url;else document.getElementById('msg').textContent=j2.error||'Erreur';};return;}
if(job&&job.status==='failed'){document.getElementById('msg').className='err';document.getElementById('msg').textContent='La construction a échoué : '+(job.error||'')+' · The build failed.';
document.getElementById('actions').innerHTML='<button class="btn" id="retry" type="button">Réessayer · Retry</button> <span class="muted">Si l\'échec persiste, contactez le support. · If it fails again, contact support.</span>';
document.getElementById('retry').onclick=async()=>{const r2=await fetch('/start/api/tenants/${esc(slug)}/retry',{method:'POST'});const j2=await r2.json();if(!r2.ok){document.getElementById('msg').textContent=j2.error||'Erreur';return;}
document.getElementById('actions').innerHTML='';document.getElementById('msg').className='';document.getElementById('msg').textContent='Construction de votre Druid… · Building your Druid…';setTimeout(poll,1500);};return;}
setTimeout(poll,3000);}catch(e){document.getElementById('msg').textContent='Erreur : '+e.message;setTimeout(poll,8000);}}
poll();
</script>`, { narrow: true });
