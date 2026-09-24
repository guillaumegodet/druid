#!/usr/bin/env node
/**
 * sync_tasks.cjs — detection rules of the « À traiter › Tâches » tab
 * (docs/plan-chantiers-taches.md, lot 5). Reads the Annuaire and the alignment
 * caches already produced by the sync_* scripts (no external API call), and
 * keeps the Grist table `Taches` in step with what they show:
 *
 *   - a situation detected for the first time creates a task (origine `regle:<rule>`,
 *     `cle` = `<type>:<uid>`, never duplicated on the next run);
 *   - a situation still present stamps `verifie_le` (and refreshes the description);
 *   - a situation gone since the last run closes the task as `resolue_auto` (the two
 *     ORCID became one, the researcher answered…) — nobody has to click;
 *   - a situation back after an automatic resolution reopens the task;
 *   - a task closed by hand (fait / abandonnee) is never recreated.
 *
 * Rules (`--rules=a,b` to choose, default = every rule except the `abes_*` ones,
 * which the ABES export already handles in batch):
 *   orcid_deux_ids   two Nantes-affiliated ORCID profiles for the same name, or
 *                    Annuaire ORCID ≠ ORCID of the IdRef record
 *   hal_deux_idhal   two Nantes-affiliated IdHAL for the same name, or Annuaire
 *                    IdHAL ≠ IdHAL of the IdRef record
 *   scopus_deux_ids  two Nantes-affiliated Scopus author profiles
 *   rh_depart        LDAP employment ended since --since (default: 12 months ago)
 *                    on a record whose IdRef record still mentions Nantes
 *   abes_orcid       Annuaire ORCID missing from the IdRef record (lot ABES channel)
 *   abes_idhal       Annuaire IdHAL missing from the IdRef record (lot ABES channel)
 *
 * DRY-RUN by default; `--apply` writes. Progress file tasks_detect_progress.json
 * (served by /api/tasks/detect/progress). Env: VITE_GRIST_DOC_ID, GRIST_API_KEY.
 *
 *   node scripts/sync_tasks.cjs                      # dry-run, default rules
 *   node scripts/sync_tasks.cjs --apply --since=2024-01-01
 *   node scripts/sync_tasks.cjs --rules=abes_orcid   # ABES rule alone (dry-run)
 */
'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const fs = require('fs');
const common = require('./lib/align_common.cjs');
const schema = require('./lib/tasks_schema.cjs');

const APPLY = common.hasFlag('apply');
const AUTHOR = 'druid:regles';
const PROGRESS_PATH = common.getArg('progress', 'tasks_detect_progress.json');
const DEFAULT_RULES = ['orcid_deux_ids', 'hal_deux_idhal', 'scopus_deux_ids', 'rh_depart'];
const RULES_ARG = String(common.getArg('rules', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const today = common.today();
const defaultSince = () => { const d = new Date(); d.setMonth(d.getMonth() - 12); return d.toISOString().slice(0, 10); };
const SINCE = String(common.getArg('since', defaultSince()));

const DOC = process.env.VITE_GRIST_DOC_ID;
const loadJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const writeProgress = (p) => { try { fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p)); } catch { /* noop */ } };

// ── Helpers ────────────────────────────────────────────────────────────────
const normOrcid = (v) => String(v || '').trim().toUpperCase().replace(/^HTTPS?:\/\/ORCID\.ORG\//, '');
const normId = (v) => String(v || '').trim().toLowerCase();
/** Evidence lines of the sync_* candidates that tie the profile to Nantes (site, mail, lab). */
const NANTES_EVIDENCE = /nantes|univ-nantes|^labo |^structure /i;
const nantesLinked = (c) => (c.evidence || []).some((e) => NANTES_EVIDENCE.test(String(e)));
/** Candidates plausibly being the person: exact name, at least medium score, Nantes evidence. */
const plausible = (cands) => (cands || []).filter((c) => c.nameMatch === 'exact' && (c.score === 'fort' || c.score === 'moyen') && nantesLinked(c));
const nameOf = (f) => `${String(f.Nom || '').toUpperCase()} ${f.Prenom || ''}`.trim();
const idrefUrl = (ppn) => (ppn ? `https://www.idref.fr/${String(ppn).trim()}` : '');
/** IdRef verify entry of a record, only when it describes the record's current PPN. */
const idrefNoticeOf = (ctx, key, f) => {
  const e = ctx.idref[key];
  const n = e && e.mode === 'verify' && e.candidates && e.candidates[0];
  return n && f.IdRef && String(n.ppn) === String(f.IdRef).trim() ? n : null;
};

/** 510 affiliations of an IdRef record ({ ppn, label, qualifier, dates }) pointing to Nantes
 * with an open date range (« 2022-.... ») or no year at all. */
const openNantesAffiliations = (notice) => (notice.affiliations || []).filter((a) => {
  const txt = `${a.label || ''} ${a.qualifier || ''}`;
  const dates = `${a.dates || ''} ${a.qualifier || ''}`;
  return /nantes/i.test(txt) && (/\.\.\.\./.test(dates) || !/\d{4}/.test(dates));
});

// ── Rules: detect(ctx) → [{ key, rec, description, lien }] ─────────────────
const RULES = {
  orcid_deux_ids: {
    type: 'orcid_deux_ids',
    sources: ['orcid', 'idref'],
    detect(ctx) {
      const out = [];
      for (const rec of ctx.annuaire) {
        const f = rec.fields;
        const reasons = [];
        const entry = ctx.orcid[rec.key];
        const cands = entry && entry.mode === 'search' ? plausible(entry.candidates) : [];
        const ids = [...new Set(cands.map((c) => normOrcid(c.orcid)).filter(Boolean))];
        if (ids.length >= 2) reasons.push(`Deux profils ORCID rattachés à Nantes pour ce nom : ${cands.map((c) => `${normOrcid(c.orcid)} (${(c.evidence || []).join(', ')})`).join(' ; ')}`);
        const n = idrefNoticeOf(ctx, rec.key, f);
        if (n && f.ORCID && n.orcid && normOrcid(n.orcid) !== normOrcid(f.ORCID)) reasons.push(`ORCID de l’Annuaire ${normOrcid(f.ORCID)} ≠ ORCID de la notice IdRef ${normOrcid(n.orcid)} (${idrefUrl(f.IdRef)})`);
        if (!reasons.length) continue;
        const first = ids[0] || normOrcid(f.ORCID);
        out.push({ key: rec.key, rec, description: reasons.join('\n'), lien: first ? `https://orcid.org/${first}` : '' });
      }
      return out;
    },
  },
  hal_deux_idhal: {
    type: 'hal_deux_idhal',
    sources: ['hal', 'idref'],
    detect(ctx) {
      const out = [];
      for (const rec of ctx.annuaire) {
        const f = rec.fields;
        const reasons = [];
        const entry = ctx.hal[rec.key];
        const cands = entry && entry.mode === 'search' ? plausible(entry.candidates) : [];
        const ids = [...new Set(cands.map((c) => normId(c.idhal)).filter(Boolean))];
        if (ids.length >= 2) reasons.push(`Deux IdHAL rattachés à Nantes pour ce nom : ${cands.map((c) => `${c.idhal} (${(c.evidence || []).join(', ')})`).join(' ; ')}`);
        const n = idrefNoticeOf(ctx, rec.key, f);
        if (n && f.IdHAL && n.idhal && normId(n.idhal) !== normId(f.IdHAL)) reasons.push(`IdHAL de l’Annuaire ${String(f.IdHAL).trim()} ≠ IdHAL de la notice IdRef ${n.idhal} (${idrefUrl(f.IdRef)})`);
        if (!reasons.length) continue;
        const first = ids[0] || normId(f.IdHAL);
        out.push({ key: rec.key, rec, description: reasons.join('\n'), lien: first ? `https://cv.hal.science/${first}` : '' });
      }
      return out;
    },
  },
  scopus_deux_ids: {
    type: 'scopus_deux_ids',
    sources: ['scopus'],
    detect(ctx) {
      const out = [];
      for (const rec of ctx.annuaire) {
        const entry = ctx.scopus[rec.key];
        const cands = entry && entry.mode === 'search' ? plausible(entry.candidates) : [];
        const ids = [...new Set(cands.map((c) => String(c.id || '').trim()).filter(Boolean))];
        if (ids.length < 2) continue;
        out.push({
          key: rec.key, rec,
          description: `Deux profils auteur Scopus rattachés à Nantes pour ce nom : ${cands.map((c) => `${c.id} (${c.affiliation || ''}${c.docCount ? `, ${c.docCount} docs` : ''})`).join(' ; ')}`,
          lien: `https://www.scopus.com/authid/detail.uri?authorId=${ids[0]}`,
        });
      }
      return out;
    },
  },
  rh_depart: {
    type: 'rh_depart',
    sources: ['ldap', 'idref'],
    detect(ctx) {
      const out = [];
      for (const rec of ctx.annuaire) {
        const f = rec.fields;
        if (!f.uid_dyna || !f.IdRef) continue;
        // PhD students: the end of the contract is the end of the thesis, and the IdRef record
        // legitimately keeps « thèse à Nantes Université » — nothing to correct.
        if (String(f.TYPE_EMPLOI || '').trim().toUpperCase() === 'DOCTORANT') continue;
        const l = ctx.ldap[f.uid_dyna];
        if (!l) continue;
        const fin = String(l.dateFin || '').slice(0, 10);
        const gone = l.etat === 'D' || (fin && fin < today);
        if (!gone || !fin || fin < SINCE) continue;
        const n = idrefNoticeOf(ctx, rec.key, f);
        if (!n) continue;
        // Current affiliations only: a 510 Nantes whose date range is still open (« 2022-.... »).
        // Notes and description carry history (thesis…) and are not a reason to correct.
        const open = openNantesAffiliations(n);
        if (!open.length) continue;
        out.push({
          key: rec.key, rec,
          description: `Fin d’emploi vue par le LDAP le ${fin} (état ${l.etat}) ; la notice IdRef garde une affiliation nantaise ouverte : ${open.map((a) => `${a.label}${a.qualifier ? ` (${a.qualifier})` : ''}${a.dates ? ` — ${a.dates}` : ''}`).join(' ; ')}`,
          lien: idrefUrl(f.IdRef),
        });
      }
      return out;
    },
  },
  abes_orcid: {
    type: 'idref_ajouter_orcid',
    sources: ['idref'],
    detect(ctx) {
      const out = [];
      for (const rec of ctx.annuaire) {
        const f = rec.fields;
        const n = idrefNoticeOf(ctx, rec.key, f);
        if (!n || !f.ORCID || n.orcid || f.ABES_export_date) continue;
        out.push({ key: rec.key, rec, description: `ORCID ${normOrcid(f.ORCID)} connu de l’Annuaire, absent de la notice IdRef (035)`, lien: idrefUrl(f.IdRef) });
      }
      return out;
    },
  },
  abes_idhal: {
    type: 'idref_ajouter_idhal',
    sources: ['idref'],
    detect(ctx) {
      const out = [];
      for (const rec of ctx.annuaire) {
        const f = rec.fields;
        const n = idrefNoticeOf(ctx, rec.key, f);
        if (!n || !f.IdHAL || n.idhal || f.ABES_export_date) continue;
        out.push({ key: rec.key, rec, description: `IdHAL ${String(f.IdHAL).trim()} connu de l’Annuaire, absent de la notice IdRef (035)`, lien: idrefUrl(f.IdRef) });
      }
      return out;
    },
  },
};

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
  const rules = RULES_ARG.length ? RULES_ARG : DEFAULT_RULES;
  const unknown = rules.filter((r) => !RULES[r]);
  if (unknown.length) throw new Error(`Unknown rule(s): ${unknown.join(', ')} — known: ${Object.keys(RULES).join(', ')}`);
  const nowIso = new Date().toISOString();
  console.log(`[tasks] ${APPLY ? 'APPLY' : 'DRY-RUN'} · rules ${rules.join(', ')} · since ${SINCE}`);
  writeProgress({ running: true, total: rules.length, done: 0, created: 0, verified: 0, resolved: 0, reopened: 0, startedAt: nowIso });

  if (APPLY) await schema.ensureTasksTables({ apiBase: 'https://grist.numerique.gouv.fr/api', doc: DOC, headers: { Authorization: `Bearer ${process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY}`, 'Content-Type': 'application/json' } });
  const { records } = await common.gristGet(`/docs/${DOC}/tables/Annuaire/records`);
  const annuaire = (records || []).map((r) => ({ id: r.id, key: r.fields.uid_dyna || `g${r.id}`, fields: r.fields }));
  const ctx = {
    annuaire,
    orcid: loadJson('orcid_align_cache.json'),
    hal: loadJson('hal_align_cache.json'),
    scopus: loadJson('scopus_align_cache.json'),
    idref: loadJson('idref_align_cache.json'),
    ldap: loadJson('ldap_status_cache.json'),
  };
  let existing = [];
  try { existing = (await common.gristGet(`/docs/${DOC}/tables/${schema.TASKS_TABLE}/records`)).records || []; }
  catch (e) { if (APPLY) throw e; console.log(`[tasks] table ${schema.TASKS_TABLE} unreadable (${e.message}) — dry-run continues with no existing task`); }
  const byKey = new Map(existing.filter((r) => r.fields.cle).map((r) => [r.fields.cle, r]));
  // Open tasks typed by hand (import, form) for the same type + person: the rule does not
  // duplicate them — the human one already tracks the situation.
  const manualOpen = new Set(existing
    .filter((r) => !r.fields.cle && r.fields.uid_dyna && ['a_faire', 'en_cours', 'en_attente'].includes(schema.statusOf(r.fields)))
    .map((r) => `${r.fields.type}:${r.fields.uid_dyna}`));

  const creates = [];   // { fields, ruleName }
  const patches = [];   // { id, fields, event? }
  const stats = { created: 0, verified: 0, resolved: 0, reopened: 0, kept_closed: 0, covered_manual: 0 };
  let done = 0;
  for (const name of rules) {
    const rule = RULES[name];
    // An empty or unreadable cache would make the rule detect nothing and close every one of
    // its open tasks as « resolved »: skip the rule instead (tasks left untouched).
    const missing = rule.sources.filter((src) => Object.keys(ctx[src] || {}).length === 0);
    if (missing.length) {
      console.warn(`[tasks] ${name}: skipped, empty cache(s) ${missing.join(', ')}`);
      stats.skipped = [...(stats.skipped || []), name];
      done++;
      continue;
    }
    const detected = rule.detect(ctx);
    const seen = new Set();
    for (const d of detected) {
      const f = d.rec.fields;
      const fields = schema.normalizeCreate({
        type: rule.type, description: d.description, lien: d.lien,
        chercheurRowId: d.rec.id, uid_dyna: f.uid_dyna || '', nom: nameOf(f), labo: f.LABO || '',
      }, { author: AUTHOR, nowIso, origine: `regle:${name}` });
      fields.cle = `${rule.type}:${d.key}`;   // records without uid_dyna keep a stable g<row> key
      fields.verifie_le = nowIso;
      if (seen.has(fields.cle)) continue;   // two Annuaire rows sharing a uid (pending duplicate)
      seen.add(fields.cle);
      if (manualOpen.has(fields.cle)) { stats.covered_manual++; continue; }
      const cur = byKey.get(fields.cle);
      if (!cur) { creates.push({ fields, ruleName: name }); stats.created++; continue; }
      const statut = schema.statusOf(cur.fields);
      if (statut === 'resolue_auto') {
        patches.push({ id: cur.id, fields: { statut: 'a_faire', description: fields.description, lien: fields.lien, verifie_le: nowIso, fait_par: '', fait_le: '', resolution: '' },
          event: { date: nowIso, auteur: AUTHOR, action: 'reouverture', detail: `Situation de nouveau détectée par la règle ${name}` } });
        stats.reopened++;
      } else if (statut === 'fait' || statut === 'abandonnee') {
        patches.push({ id: cur.id, fields: { verifie_le: nowIso } });
        stats.kept_closed++;
      } else {
        const changed = cur.fields.description !== fields.description || (cur.fields.lien || '') !== fields.lien;
        patches.push({ id: cur.id, fields: { verifie_le: nowIso, ...(changed ? { description: fields.description, lien: fields.lien } : {}) } });
        stats.verified++;
      }
    }
    // Open tasks of this rule whose situation disappeared → resolved automatically.
    for (const cur of existing) {
      if (cur.fields.origine !== `regle:${name}` || seen.has(cur.fields.cle)) continue;
      const statut = schema.statusOf(cur.fields);
      if (!['a_faire', 'en_cours', 'en_attente'].includes(statut)) continue;
      patches.push({ id: cur.id, fields: { statut: 'resolue_auto', fait_par: AUTHOR, fait_le: nowIso, verifie_le: nowIso, resolution: `Situation disparue au contrôle du ${today}` },
        event: { date: nowIso, auteur: AUTHOR, action: 'resolution_auto', detail: `La règle ${name} ne détecte plus la situation` } });
      stats.resolved++;
    }
    console.log(`[tasks] ${name}: ${detected.length} detected`);
    done++;
    writeProgress({ running: true, total: rules.length, done, ...stats, startedAt: nowIso });
  }

  for (const c of creates) console.log(`+ ${c.fields.cle} · ${c.fields.titre}`);
  for (const p of patches.filter((x) => x.event)) console.log(`~ ${p.id} → ${p.fields.statut} (${p.event.action})`);
  console.log(`[tasks] to create ${stats.created} · verified ${stats.verified} · resolved ${stats.resolved} · reopened ${stats.reopened} · closed by hand kept ${stats.kept_closed} · covered by a manual task ${stats.covered_manual}`);
  if (APPLY) {
    if (creates.length) {
      const rows = creates.map((c) => c.fields);
      const ids = [];
      for (let i = 0; i < rows.length; i += 100) {
        const res = await fetch(`https://grist.numerique.gouv.fr/api/docs/${DOC}/tables/${schema.TASKS_TABLE}/records`, {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: rows.slice(i, i + 100).map((fields) => ({ fields })) }),
        });
        if (!res.ok) throw new Error(`Grist POST Taches: ${res.status} ${await res.text()}`);
        ids.push(...((await res.json()).records || []).map((r) => r.id));
      }
      await common.gristCreateRecords(schema.EVENTS_TABLE, ids.map((id, i) => ({ tache: id, date: nowIso, auteur: AUTHOR, action: 'creation', detail: `Détectée par la règle ${creates[i].ruleName}` })));
    }
    if (patches.length) {
      await common.gristPatchRecords(schema.TASKS_TABLE, patches.map(({ id, fields }) => ({ id, fields })));
      const events = patches.filter((p) => p.event).map((p) => ({ tache: p.id, ...p.event }));
      if (events.length) await common.gristCreateRecords(schema.EVENTS_TABLE, events);
    }
    console.log('[tasks] written.');
  } else {
    console.log('[tasks] dry-run — rerun with --apply to write.');
  }
  writeProgress({ running: false, total: rules.length, done, ...stats, startedAt: nowIso, finishedAt: new Date().toISOString() });
}

module.exports = { RULES, DEFAULT_RULES, plausible, openNantesAffiliations };

if (require.main === module) {
  main().catch((e) => {
    console.error('[tasks] ✗', e);
    writeProgress({ running: false, error: e.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });
}
