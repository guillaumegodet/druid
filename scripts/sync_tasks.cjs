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
 *   annuaire_ids_partages  Annuaire records with different uid_dyna sharing an ORCID, IdRef,
 *                    IdHAL, IdHAL_i or Scopus id (SoVisu+ refuses the second one): one task per
 *                    group, typed by the names — annuaire_doublon (same person, merge),
 *                    annuaire_doublon_a_verifier (usage name, relatives, or same names with two different
 *                    IdRef / ORCID: namesakes?), annuaire_identifiant_partage
 *                    (two people: fix the identifier); key = the sorted uids joined by « + »
 *   parcours_depart  probable departure of a record without end date, from the career-path job
 *                    (affiliation_history/_index.json of scripts/sync_affiliation_history.cjs): one task per
 *                    record, typed by the strongest signal — parcours_depart_confirme (several sources),
 *                    parcours_depart_declare (ORCID), parcours_depart_observe (publications); closed as soon
 *                    as an end date is entered (docs/plan-parcours-affiliations.md, lot 4)
 *   parcours_statut_incoherent  ended record still publishing locally / with an open ORCID position there
 *   parcours_identifiant_suspect  identifiers whose publications / Scopus profile never mention the
 *                    institution (alignment control)
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

try { require('dotenv').config(); } catch { /* dotenv optional */ }

const fs = require('fs');
const common = require('./lib/align_common.cjs');
const schema = require('./lib/tasks_schema.cjs');

const APPLY = common.hasFlag('apply');
const AUTHOR = 'druid:regles';
const PROGRESS_PATH = common.getArg('progress', 'tasks_detect_progress.json');
const DEFAULT_RULES = ['orcid_deux_ids', 'hal_deux_idhal', 'scopus_deux_ids', 'rh_depart', 'annuaire_ids_partages', 'parcours_depart', 'parcours_statut_incoherent', 'parcours_identifiant_suspect'];
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

/** Identifiers exported to SoVisu+ in people.csv (server.cjs buildPeopleCsv) — SoVisu+ refuses
 * a person whose identifier already belongs to another person (« Conflicting identifiers »).
 * OpenAlex_ids is left out: cdb / the IKG ignore it. The HR staff number (lib/hrId.ts) is not
 * exported but is the surest sign of one person on two records (ext_ record + LDAP uid record). */
const SHARED_ID_COLUMNS = [
  { col: 'ORCID', label: 'ORCID', norm: (v) => normOrcid(v), valid: (v) => /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(v), url: (v) => `https://orcid.org/${v}` },
  { col: 'IdRef', label: 'IdRef', norm: (v) => String(v).trim().toUpperCase(), valid: (v) => /^\d{8}[\dX]$/.test(v), url: (v) => idrefUrl(v) },
  { col: 'IdHAL', label: 'IdHAL', norm: (v) => normId(v), valid: (v) => /^[a-z0-9][a-z0-9._-]+$/.test(v), url: (v) => `https://cv.hal.science/${v}` },
  { col: 'IdHAL_i', label: 'IdHAL numérique', norm: (v) => String(v).trim(), valid: (v) => /^[1-9]\d*$/.test(v), url: () => '' },
  { col: 'N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_', label: 'N° agent', norm: (v) => String(v).trim().replace(/\.0+$/, '').replace(/^0+/, ''), valid: (v) => /^[1-9]\d*$/.test(v), url: () => '' },
  { col: 'ID_SCOPUS', label: 'Scopus', norm: (v) => String(v).trim(), valid: (v) => /^[1-9]\d{5,}$/.test(v), url: (v) => `https://www.scopus.com/authid/detail.uri?authorId=${v}` },
];
/** Values of one identifier column (a cell may carry several, pipe- or comma-separated). */
const idValues = (spec, raw) => (raw == null || raw === 0 ? [] : String(raw).split(/[|,;\s]+/))
  .map((v) => (v ? spec.norm(v) : '')).filter((v) => v && spec.valid(v));

/** Lower-case ASCII name tokens (accents, hyphens and particles of one letter dropped). */
const nameTokens = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^a-z]+/).filter((w) => w.length > 1);
const overlaps = (a, b) => a.some((w) => b.includes(w));
/**
 * How two records sharing identifiers compare by name:
 *  - `same`     same first and last names (or the two swapped) — one person, two records;
 *  - `partial`  only the first name or only the last name in common — married / usage name,
 *               or relatives / homonyms: to check;
 *  - `distinct` nothing in common — the identifier was put on the wrong record.
 */
function nameMatch(a, b) {
  const [fa, la, fb, lb] = [nameTokens(a.Prenom), nameTokens(a.Nom), nameTokens(b.Prenom), nameTokens(b.Nom)];
  const first = overlaps(fa, fb);
  const last = overlaps(la, lb);
  if ((first && last) || (overlaps(fa, lb) && overlaps(la, fb))) return 'same';
  return first || last ? 'partial' : 'distinct';
}
const SHARED_ID_TYPES = { same: 'annuaire_doublon', partial: 'annuaire_doublon_a_verifier', distinct: 'annuaire_identifiant_partage' };
const MATCH_RANK = { same: 0, partial: 1, distinct: 2 };
/** Record carrying the task of a group: an internal record before an `ext_` one, a lab before
 * the parking lab, then the fullest record, then the oldest row — stable from one run to the next. */
const filled = (f) => Object.values(f).filter((v) => v !== null && v !== '' && v !== 0 && v !== false).length;
const PARKING = new Set(['', 'ZZZ']);
const taskRecordOf = (recs) => [...recs].sort((x, y) =>
  (x.key.startsWith('ext_') - y.key.startsWith('ext_'))
  || (PARKING.has(String(x.fields.LABO || '').trim().toUpperCase()) - PARKING.has(String(y.fields.LABO || '').trim().toUpperCase()))
  || (filled(y.fields) - filled(x.fields)) || (x.id - y.id))[0];

/**
 * Groups of Annuaire records with DIFFERENT uid_dyna that share at least one exported identifier
 * (rows of one uid_dyna — pending duplicates, qualified multi-affiliations — count as one person:
 * the « Doublons » tab handles them). Connected groups: A–B by ORCID and B–C by IdRef give A+B+C.
 * Returns [{ recs, shared: [{ label, value, url, uids }], match, contradictions }], `match` being the least
 * similar pair of the group — same names but two different values of one identifier type (two
 * IdRef…) count as `partial`, listed in `contradictions`.
 */
function sharedIdentifierGroups(annuaire) {
  const byUid = new Map();
  for (const rec of annuaire) {
    if (!rec.fields.uid_dyna) continue;   // not exported to SoVisu+ (people.csv skips rows without uid)
    if (!byUid.has(rec.key)) byUid.set(rec.key, []);
    byUid.get(rec.key).push(rec);
  }
  const owners = new Map();   // `<col>:<value>` → Set(uid)
  const valuesOf = new Map();   // uid → { <col>: Set(value) }
  for (const [uid, recs] of byUid) {
    valuesOf.set(uid, {});
    for (const spec of SHARED_ID_COLUMNS) {
      const values = new Set(recs.flatMap((r) => idValues(spec, r.fields[spec.col])));
      valuesOf.get(uid)[spec.col] = values;
      for (const v of values) {
        const k = `${spec.col}:${v}`;
        if (!owners.has(k)) owners.set(k, new Set());
        owners.get(k).add(uid);
      }
    }
  }
  /** Identifier types for which both records have values and none in common (two IdRef…). */
  const conflicting = (u, v) => SHARED_ID_COLUMNS.filter((spec) => {
    const [a, b] = [valuesOf.get(u)[spec.col], valuesOf.get(v)[spec.col]];
    return a.size && b.size && ![...a].some((x) => b.has(x));
  }).map((spec) => spec.label);
  const parent = new Map();
  const find = (u) => { while (parent.get(u) !== u) { parent.set(u, parent.get(parent.get(u))); u = parent.get(u); } return u; };
  const shared = [...owners].filter(([, uids]) => uids.size > 1);
  for (const [, uids] of shared) {
    const [head, ...rest] = [...uids];
    for (const u of [head, ...rest]) if (!parent.has(u)) parent.set(u, u);
    for (const u of rest) parent.set(find(u), find(head));
  }
  const groups = new Map();
  for (const [k, uids] of shared) {
    const root = find([...uids][0]);
    if (!groups.has(root)) groups.set(root, { uids: new Set(), shared: [] });
    const g = groups.get(root);
    uids.forEach((u) => g.uids.add(u));
    const [col, value] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    const spec = SHARED_ID_COLUMNS.find((s) => s.col === col);
    g.shared.push({ label: spec.label, value, url: spec.url(value), uids: [...uids].sort() });
  }
  return [...groups.values()].map((g) => {
    const uids = [...g.uids].sort();
    const heads = uids.map((u) => byUid.get(u)[0]);
    let match = 'same';
    const contradictions = [];
    for (let i = 0; i < heads.length; i++) {
      for (let j = i + 1; j < heads.length; j++) {
        let m = nameMatch(heads[i].fields, heads[j].fields);
        // Same names but two different IdRef (or ORCID…): namesakes as often as duplicates.
        const diff = conflicting(uids[i], uids[j]);
        if (diff.length) contradictions.push({ uids: [uids[i], uids[j]], labels: diff });
        if (m === 'same' && diff.length) m = 'partial';
        if (MATCH_RANK[m] > MATCH_RANK[match]) match = m;
      }
    }
    return { uids, recs: heads, shared: g.shared, match, contradictions };
  });
}

/**
 * Record a shared IdHAL most likely belongs to: the only record whose first and last names both
 * appear in the IdHAL (« jean-dupont » ⇒ DUPONT Jean). null when none or several.
 */
function idhalOwner(group) {
  for (const s of group.shared.filter((x) => x.label === 'IdHAL')) {
    const words = nameTokens(s.value);
    const owners = group.recs.filter((r) => {
      const [first, last] = [nameTokens(r.fields.Prenom), nameTokens(r.fields.Nom)];
      return first.length && last.length && overlaps(first, words) && overlaps(last, words);
    });
    if (owners.length === 1) return { rec: owners[0], idhal: s.value };
  }
  return null;
}

const SHARED_ID_ACTIONS = {
  same: 'À faire : fusionner les fiches (bouton « Ouvrir l’assistant de fusion » ; on y choisit l’uid à garder). '
    + 'Garder de préférence l’uid que SoVisu+ connaît déjà avec ces identifiants (celui qui a les publications) : '
    + 'sinon, faire retirer les identifiants de l’ancienne personne dans SoVisu+, qui ne supprime jamais une personne.',
  partial: 'À vérifier : même personne sous un autre nom (nom d’usage, faute de saisie) ⇒ fusionner comme un doublon ; '
    + 'deux personnes (parents, homonymes) ⇒ retirer l’identifiant de la fiche qui ne le porte pas à juste titre.',
  distinct: 'À faire : retirer l’identifiant de la fiche qui ne le porte pas à juste titre (vérifier sur le lien du profil).',
};

// ── Rules: detect(ctx) → [{ key, rec, description, lien, type? }] ─────────────────

// ── Career path (docs/plan-parcours-affiliations.md, lot 4) ────────────────────────
const PARCOURS_INDEX = common.getArg('parcours-index', 'affiliation_history/_index.json');
/** Strongest departure signal → task type (a person gets one departure task at a time). */
const PARCOURS_DEPART = [
  ['depart_confirme', 'parcours_depart_confirme'],
  ['depart_declare', 'parcours_depart_declare'],
  ['nouveau_poste_declare', 'parcours_depart_declare'],
  ['depart_observe', 'parcours_depart_observe'],
];
const druidRecordUrl = (key) => `/?page=RESEARCHER_DETAIL&id=${encodeURIComponent(key)}`;
/** End dates of a person over its Annuaire rows (a membership is over only when every row is ended). */
function endsByKey(annuaire) {
  const out = new Map();
  for (const r of annuaire) {
    const f = r.fields;
    const cur = out.get(r.key) || { employmentEnd: '', memberships: [], rec: r };
    const ee = typeof f.employment_end_date === 'number' && f.employment_end_date ? new Date(f.employment_end_date * 1000).toISOString().slice(0, 10) : String(f.employment_end_date || '').trim();
    if (ee > cur.employmentEnd) cur.employmentEnd = ee;
    cur.memberships.push(String(f.affiliation_end_date || '').trim());
    out.set(r.key, cur);
  }
  for (const v of out.values()) v.ended = !!v.employmentEnd || (v.memberships.length > 0 && v.memberships.every(Boolean));
  return out;
}
const sourcesFr = (list) => (list || []).map((x) => (x === 'orcid' ? 'ORCID' : x === 'scopus' ? 'Scopus' : 'les publications')).join(' + ');
function departDescription(sig) {
  const dest = sig.destination ? `, pour ${sig.destination}` : '';
  switch (sig.type) {
    case 'depart_confirme': return `Départ confirmé par ${sourcesFr(sig.sources)} : parti vers ${sig.date}${dest}. Fin d’emploi proposée : ${sig.date}.`;
    case 'depart_declare': return `ORCID : le dernier poste à l’établissement s’est terminé en ${sig.date}${sig.destination ? ` ; nouveau poste à ${sig.destination}${sig.destinationStart ? ` depuis ${sig.destinationStart}` : ''}` : ''}.`;
    case 'nouveau_poste_declare': return `ORCID : nouveau poste à ${sig.destination} depuis ${sig.date}.`;
    default: return sig.rule === 'dominant'
      ? `Publications : surtout affiliées ailleurs depuis ${sig.since} (${sig.count} contre ${sig.local} à l’établissement)${sig.destination ? `, surtout ${sig.destination}` : ''} ; dernière affiliée à l’établissement en ${sig.date}.`
      : `Publications : aucune affiliée à l’établissement après ${sig.date} ; ${sig.count} affiliées ailleurs${sig.destination ? `, surtout ${sig.destination}` : ''}.`;
  }
}

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
  annuaire_ids_partages: {
    // One rule, three task types chosen per group by the names (`type` of each detection).
    type: 'annuaire_doublon',
    types: Object.values(SHARED_ID_TYPES),
    sources: ['annuaire'],
    detect(ctx) {
      return sharedIdentifierGroups(ctx.annuaire).map((g) => {
        const lines = g.recs.map((r) => `• ${r.key} — ${nameOf(r.fields)}${r.fields.LABO ? ` (${r.fields.LABO})` : ''}`);
        const ids = g.shared.map((s) => `${s.label} ${s.value}${g.uids.length > 2 ? ` (${s.uids.join(', ')})` : ''}`);
        // Two people: the task goes to the record to correct when the IdHAL names its owner.
        const owner = g.match !== 'same' ? idhalOwner(g) : null;
        const others = owner ? g.recs.filter((r) => r !== owner.rec) : [];
        return {
          key: g.uids.join('+'),
          rec: others.length === 1 ? others[0] : taskRecordOf(g.recs),
          type: SHARED_ID_TYPES[g.match],
          description: [
            `${g.uids.length} fiches de l’Annuaire portent les mêmes identifiants :`, ...lines,
            `Identifiants communs : ${ids.join(' ; ')}.`,
            ...(owner ? [`Indice : l’IdHAL ${owner.idhal} correspond au nom de ${nameOf(owner.rec.fields)} (${owner.rec.key}).`] : []),
            ...g.contradictions.map((c) => `Attention : ${c.uids.join(' et ')} ont des ${c.labels.join(', ')} différents — souvent deux homonymes.`),
            'SoVisu+ refuse la seconde fiche qui arrive avec ces identifiants (« Conflicting identifiers »).',
            SHARED_ID_ACTIONS[g.match],
          ].join('\n'),
          lien: (g.shared.find((s) => s.url) || {}).url || '',
        };
      });
    },
  },
  parcours_depart: {
    type: 'parcours_depart_observe',
    types: ['parcours_depart_confirme', 'parcours_depart_declare', 'parcours_depart_observe'],
    sources: ['parcours'],
    detect(ctx) {
      const out = [];
      for (const [key, e] of endsByKey(ctx.annuaire)) {
        const line = ctx.parcours[key];
        if (!line || e.ended) continue;   // an end date entered since the computation closes the task
        const found = PARCOURS_DEPART.map(([sig, type]) => ({ sig: (line.signals || []).find((x) => x.type === sig), type })).find((x) => x.sig);
        if (!found) continue;
        const others = (line.signals || []).filter((x) => x !== found.sig && PARCOURS_DEPART.some(([t]) => t === x.type));
        out.push({
          key, rec: e.rec, type: found.type,
          description: [departDescription(found.sig), ...others.map(departDescription),
            'À vérifier puis saisir la fin d’emploi dans la fiche Druid (bloc « Parcours », bouton « Reporter … en fin d’emploi »).'].join('\n'),
          lien: druidRecordUrl(key),
        });
      }
      return out;
    },
  },
  parcours_statut_incoherent: {
    type: 'parcours_statut_incoherent',
    sources: ['parcours'],
    detect(ctx) {
      const out = [];
      for (const [key, e] of endsByKey(ctx.annuaire)) {
        const sig = (ctx.parcours[key]?.signals || []).find((x) => x.type === 'statut_incoherent');
        if (!sig || !e.ended) continue;   // end date removed since the computation: nothing left to check
        out.push({
          key, rec: e.rec,
          description: sig.lastLocal
            ? `La fiche est close (${sig.endYear}), mais des publications sont encore affiliées à l’établissement en ${sig.lastLocal} : date de fin saisie trop tôt, personnel hospitalier ou émérite ? Vérifier la date de fin et le statut.`
            : `La fiche est close (${sig.endYear}), mais ORCID indique un poste en cours dans l’établissement : vérifier la date de fin et le statut.`,
          lien: druidRecordUrl(key),
        });
      }
      return out;
    },
  },
  parcours_identifiant_suspect: {
    type: 'parcours_identifiant_suspect',
    sources: ['parcours'],
    detect(ctx) {
      const out = [];
      for (const [key, e] of endsByKey(ctx.annuaire)) {
        const sig = (ctx.parcours[key]?.signals || []).find((x) => x.type === 'identifiant_suspect');
        if (!sig || e.ended) continue;
        const via = (sig.sources || []).map((x) => (x === 'scopus' ? 'le profil Scopus' : 'les publications')).join(' et ');
        out.push({
          key, rec: e.rec,
          description: `D’après ${via}, les identifiants de la fiche ne mentionnent jamais l’établissement : identifiant d’un homonyme ? Vérifier ORCID, OpenAlex et Scopus dans « Alignement des identifiants chercheurs ».`,
          lien: druidRecordUrl(key),
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
    parcours: loadJson(PARCOURS_INDEX),
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
      const type = d.type || rule.type;
      const fields = schema.normalizeCreate({
        type, description: d.description, lien: d.lien,
        chercheurRowId: d.rec.id, uid_dyna: f.uid_dyna || '', nom: nameOf(f), labo: f.LABO || '',
      }, { author: AUTHOR, nowIso, origine: `regle:${name}` });
      fields.cle = `${type}:${d.key}`;   // records without uid_dyna keep a stable g<row> key
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
      // Grist refuses a PATCH whose records carry different field sets (a verified task only
      // stamps verifie_le, a resolved one also changes statut…): one request per field set.
      await common.gristPatchGrouped(schema.TASKS_TABLE, patches.map(({ id, fields }) => ({ id, fields })));
      const events = patches.filter((p) => p.event).map((p) => ({ tache: p.id, ...p.event }));
      if (events.length) await common.gristCreateRecords(schema.EVENTS_TABLE, events);
    }
    console.log('[tasks] written.');
  } else {
    console.log('[tasks] dry-run — rerun with --apply to write.');
  }
  writeProgress({ running: false, total: rules.length, done, ...stats, startedAt: nowIso, finishedAt: new Date().toISOString() });
}

module.exports = { RULES, DEFAULT_RULES, endsByKey, plausible, openNantesAffiliations, nameMatch, sharedIdentifierGroups };

if (require.main === module) {
  main().catch((e) => {
    console.error('[tasks] ✗', e);
    writeProgress({ running: false, error: e.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });
}
