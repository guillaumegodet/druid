/**
 * @file sync_ldap_candidates.cjs
 * @description Search for LDAP candidates for the Annuaire records WITHOUT uid_dyna
 * (typically people imported from lab websites). « email-first »
 * prototype: each record without uid but with an email is matched to the
 * corresponding LDAP `mail`, and we propose to attach the official identity
 * (uid + civility / grade / birth date / eppn).
 *
 * READ-ONLY: writes NOTHING to Grist; only produces a cache
 * `ldap_candidates_cache.json` (copied into dist/ to be served statically),
 * re-read client-side by `GristService.computeLdapCandidatesDiff`. The actual
 * write goes through the review UI then `applyLdapCandidates`.
 *
 * Modeled on scripts/sync_ldap.cjs (LDAP bind) + scripts/sync_idref.cjs
 * (Grist read + cache + progress). Nantes-only (internal LDAP).
 */
const fs = require('fs');
const { BIND_DN, BIND_PW, createLdapClient } = require('./lib/ldap_common.cjs');
const LDAP_BASE = 'ou=People,dc=univ-nantes,dc=fr';

const GRIST_BASE = 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.VITE_GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY;

const CACHE_PATH = 'ldap_candidates_cache.json';
const DIST_CACHE_PATH = 'dist/ldap_candidates_cache.json';
const PROGRESS_PATH = 'ldap_candidates_progress.json';

const norm = (s) => String(s || '').trim().toLowerCase();
const deburr = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Tolerant name key (tokens ≥ 2 letters, deduplicated, sorted) — identical to lib/validation.ts. */
const nameKey = (s) =>
  Array.from(new Set(deburr(s).split(/[^a-z]+/).filter((t) => t.length >= 2))).sort().join(' ');

function writeProgress(p) {
  try { fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p)); } catch (e) { /* noop */ }
}

/** Index `mail → entry` AND `nameKey → [entries]` over all LDAP staff. */
function buildLdapIndex() {
  return new Promise((resolve, reject) => {
    const client = createLdapClient();
    client.on('error', reject);
    client.bind(BIND_DN, BIND_PW, (err) => {
      if (err) return reject(err);
      const opts = {
        filter: '(&(objectClass=supannPerson)(population=PERSONNEL))',
        scope: 'sub',
        attributes: ['uid', 'mail', 'sn', 'givenName', 'cn', 'dynaEtat', 'dynaCategorie',
          'supannEmpCorps', 'supannCivilite', 'supannOIDCDateDeNaissance',
          'eduPersonPrincipalName'],
      };
      const byMail = {};
      const byName = {};
      let count = 0;
      client.search(LDAP_BASE, opts, (err2, res) => {
        if (err2) return reject(err2);
        res.on('searchEntry', (entry) => {
          const attrs = entry.pojo.attributes || [];
          const p = {};
          attrs.forEach((a) => { p[a.type.toLowerCase()] = a.values; }); // all values
          const uid = (p['uid'] || [])[0];
          if (!uid) return;
          const first = (arr) => (arr || [])[0] || '';
          const rec = {
            uid,
            displayName: first(p['cn']) || `${first(p['sn'])} ${first(p['givenname'])}`.trim(),
            sn: first(p['sn']),
            givenName: first(p['givenname']),
            etat: first(p['dynaetat']),
            categorie: first(p['dynacategorie']),
            empCorps: first(p['supannempcorps']).replace(/^\{[^}]+\}/, ''),
            civilite: first(p['supanncivilite']),
            birthDate: first(p['supannoidcdatedenaissance']),
            eppn: first(p['edupersonprincipalname']),
          };
          count += 1;
          for (const m of (p['mail'] || [])) {
            const key = norm(m);
            if (key && !byMail[key]) byMail[key] = rec; // 1st occurrence wins
          }
          const nk = nameKey(`${rec.sn} ${rec.givenName}`);
          if (nk) { (byName[nk] = byName[nk] || []).push(rec); }
        });
        res.on('error', reject);
        res.on('end', () => {
          client.unbind();
          console.log(`[ldap-cand] ${count} LDAP staff members, ${Object.keys(byMail).length} emails, ${Object.keys(byName).length} name keys indexed.`);
          resolve({ byMail, byName });
        });
      });
    });
  });
}

async function fetchAnnuaire() {
  if (!DOC || !KEY) throw new Error('VITE_GRIST_DOC_ID / GRIST_API_KEY not configured');
  const r = await fetch(`${GRIST_BASE}/docs/${DOC}/tables/Annuaire/records`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`Grist Annuaire: ${r.status}`);
  const { records } = await r.json();
  return (records || []).map((rec) => ({ gristRowId: rec.id, f: rec.fields || {} }));
}

async function main() {
  writeProgress({ running: true, done: 0, total: 0, matched: 0 });
  try {
    const rows = await fetchAnnuaire();
    // Targets: every record without uid_dyna (we try email THEN name).
    const targets = rows.filter((r) => !String(r.f['uid_dyna'] || '').trim());
    writeProgress({ running: true, done: 0, total: targets.length, matched: 0 });
    console.log(`[ldap-cand] ${rows.length} Annuaire records, ${targets.length} targets (without uid).`);

    const { byMail, byName } = await buildLdapIndex();

    const MAX_AMBIG = 12; // cap on the homonym candidates displayed
    const proposals = [];  // 1 certain candidate (email) or unique one (name)
    const ambiguous = [];  // several homonyms → arbitration
    let done = 0;
    for (const t of targets) {
      const base = {
        gristRowId: t.gristRowId,
        nom: t.f['Nom'] || '',
        prenom: t.f['Prenom'] || '',
        email: norm(t.f['Email']),
        labo: t.f['LABO'] || '',
      };
      const emailHit = base.email.includes('@') ? byMail[base.email] : null;
      if (emailHit) {
        proposals.push({ ...base, matchedBy: 'email', ldap: emailHit });
      } else {
        const nk = nameKey(`${base.nom} ${base.prenom}`);
        const hits = (nk && byName[nk]) ? byName[nk] : [];
        if (hits.length === 1) {
          proposals.push({ ...base, matchedBy: 'name', ldap: hits[0] });
        } else if (hits.length > 1) {
          ambiguous.push({ ...base, candidates: hits.slice(0, MAX_AMBIG) });
        }
      }
      done += 1;
      if (done % 200 === 0) writeProgress({ running: true, done, total: targets.length, matched: proposals.length, ambiguous: ambiguous.length });
    }

    const cache = { generatedAt: new Date().toISOString(), count: proposals.length, ambiguousCount: ambiguous.length, proposals, ambiguous };
    const json = JSON.stringify(cache, null, 2);
    fs.writeFileSync(CACHE_PATH, json);
    try { if (fs.existsSync('dist')) fs.writeFileSync(DIST_CACHE_PATH, json); } catch (e) { /* noop */ }
    writeProgress({ running: false, done: targets.length, total: targets.length, matched: proposals.length, ambiguous: ambiguous.length });
    const nEmail = proposals.filter((p) => p.matchedBy === 'email').length;
    console.log(`[ldap-cand] ${proposals.length} candidate(s) (${nEmail} email, ${proposals.length - nEmail} unique name) + ${ambiguous.length} homonym(s) to arbitrate → ${CACHE_PATH}.`);
  } catch (e) {
    console.error('[ldap-cand] error:', e.message);
    writeProgress({ running: false, error: e.message });
    process.exitCode = 1;
  }
}

main();
