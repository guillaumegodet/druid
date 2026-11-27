#!/usr/bin/env node
/**
 * sync_tasks.cjs — detection rules of the « À traiter › Tâches » tab
 * (docs/archive/plan-chantiers-taches.md, lot 5). Reads the Annuaire and the alignment
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
 *   uid_ldap_disponible  ext_ record (or record without uid) whose HR staff number is the supannEmpId of
 *                    an LDAP account no Annuaire record carries: switch the record to that uid
 *                    (docs/archive/plan-statut-employeur-ldap.md, lot 2); key = `<current key>><LDAP uid>`.
 *                    When a record already carries that uid, annuaire_ids_partages proposes the merge.
 *   hebergement_fin  record employed by another institution (CNRS, INSERM…) whose hosted LDAP account is
 *                    closing (dynaEtat D): the presence does not follow a hosted account
 *                    (docs/archive/plan-statut-employeur-ldap.md, D3), a person checks; closed once an end
 *                    date is entered or the account is active again.
 *   parcours_depart  probable departure of a record without end date, from the career-path job
 *                    (affiliation_history/_index.json of scripts/sync_affiliation_history.cjs): one task per
 *                    record, typed by the strongest signal — parcours_depart_confirme (several sources),
 *                    parcours_depart_declare (ORCID), parcours_depart_observe (publications); closed as soon
 *                    as an end date is entered or Druid's presence already says gone / leaving (LDAP account gone or
 *                    closing, end dates), and a publications-only signal once the home LDAP account is active
 *                    (docs/archive/plan-parcours-affiliations.md, lot 4)
 *   parcours_statut_incoherent  ended record still publishing locally / with an open ORCID position there; the ORCID
 *                    signal alone yields to a departure a reliable source confirms (validated list, home LDAP account
 *                    gone or closing): the ORCID profile is then out of date
 *   parcours_identifiant_suspect  identifiers whose publications / Scopus profile never mention the
 *                    institution (alignment control); not for a person employed by another institution
 *   doctorant_these  record still a PhD student (TYPE_EMPLOI or Corps_grade DOCTORANT, not gone) whose IdRef has a
 *                    defended thesis on theses.fr (table Theses, PostgreSQL instances, scripts/sync_theses.ts):
 *                    annuaire_doctorant_docteur when the thesis is recent (status, employment or end to update;
 *                    closed once the record no longer says PhD student, or Druid counts the person gone or leaving),
 *                    annuaire_doctorant_these_ancienne when it
 *                    is older than a PhD lasts (IdRef of a namesake, or a second doctorate: to check)
 *   appartenance_a_qualifier  person on several directory rows (same uid) not qualified yet — no single PRINCIPAL row
 *                    with a role on every other one, nor an « à revoir » decision: the record shows as several records
 *                    and refuses a new membership. One task per uid, qualified (or merged) from the task; closed once
 *                    the group is qualified. Replaces the former « Doublons » tab.
 *   employeur_a_renseigner  closing-only rule (`review`, creates nothing) over the « employer to enter » tasks
 *                    of migration 002 (records validated EXTERNE without employer, release 1.6.0): such a task
 *                    only matters while the record carries an LDAP uid — without one (`ext_` or empty),
 *                    lib/presence.ts isHomeStaff already counts the person outside the institution. Closed as
 *                    `resolue_auto` once the record has no LDAP uid, has an employer, is validated gone, or was deleted.
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
const DEFAULT_RULES = ['orcid_deux_ids', 'hal_deux_idhal', 'scopus_deux_ids', 'rh_depart', 'annuaire_ids_partages', 'uid_ldap_disponible', 'hebergement_fin', 'parcours_depart', 'parcours_statut_incoherent', 'parcours_identifiant_suspect', 'doctorant_these', 'employeur_a_renseigner', 'appartenance_a_qualifier'];
const RULES_ARG = String(common.getArg('rules', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const today = common.today();
const defaultSince = () => { const d = new Date(); d.setMonth(d.getMonth() - 12); return d.toISOString().slice(0, 10); };
const SINCE = String(common.getArg('since', defaultSince()));

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
 * exported but is the surest sign of one person on two records (ext_ record + LDAP uid record).
 * `also`: columns read with the main one — the secondary HAL identifiers are not exported either, but one HAL person on
 * two records is still one researcher on two records (docs/plan-alignement-idhal-i.md, lot 1). */
const SHARED_ID_COLUMNS = [
  { col: 'ORCID', label: 'ORCID', norm: (v) => normOrcid(v), valid: (v) => /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(v), url: (v) => `https://orcid.org/${v}` },
  { col: 'IdRef', label: 'IdRef', norm: (v) => String(v).trim().toUpperCase(), valid: (v) => /^\d{8}[\dX]$/.test(v), url: (v) => idrefUrl(v) },
  { col: 'IdHAL', label: 'IdHAL', norm: (v) => normId(v), valid: (v) => /^[a-z0-9][a-z0-9._-]+$/.test(v), url: (v) => `https://cv.hal.science/${v}` },
  { col: 'IdHAL_i', also: ['IdHAL_i_secondaires'], label: 'IdHAL numérique', norm: (v) => String(v).trim(), valid: (v) => /^[1-9]\d*$/.test(v), url: () => '' },
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
      const values = new Set(recs.flatMap((r) => [spec.col, ...(spec.also || [])].flatMap((col) => idValues(spec, r.fields[col]))));
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

// ── LDAP uid of an ext_ record (docs/archive/plan-statut-employeur-ldap.md, lot 2) ─────────
const HR_ID_COL = 'N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_';
/** HR staff number: digits without leading zeros nor « .0 » ('' when empty, 0 or not a number) — lib/hrId.ts. */
const normHrId = (v) => {
  const s = String(v == null || v === false ? '' : v).trim().replace(/^\{[^}]*\}/, '').replace(/\.0+$/, '');
  return /^\d+$/.test(s) ? s.replace(/^0+/, '') : '';
};
/** Grist date cell (epoch seconds, or text) → YYYY-MM-DD ('' when unreadable). */
const isoDay = (v) => {
  if (typeof v === 'number' && v) return new Date(v * 1000).toISOString().slice(0, 10);
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
/** Reduced-precision date cell (YYYY, YYYY-MM, YYYY-MM-DD, epoch or DD-MM-YYYY) → canonical text, '' when unreadable. */
const fuzzyDay = (v) => {
  const s = String(v ?? '').trim();
  return /^\d{4}(-\d{2})?$/.test(s) ? s : isoDay(v);
};
/** Does the uid look like the record's last name? Any word of the uid (« dupont-j », « martin-dupont-j »,
 * « eldupont-j ») against the whole name or one of its words (« Martin-Dupont », « Le Goff »). */
const uidMatchesName = (uid, f) => {
  const parts = String(uid).toLowerCase().split('-').filter((p) => /^[a-z]{2,}$/.test(p));
  const words = nameTokens(f.Nom);
  const names = [words.join(''), ...words];
  const close = (p, n) => p === n || (p.length >= 3 && n.length >= 3 && (n.startsWith(p) || p.startsWith(n) || p.endsWith(n)));
  return parts.some((p) => names.some((n) => close(p, n)));
};

/** Student account uid (« E123456U »): a student or a PhD student who may have become staff since. */
const isStudentUid = (uid) => /^e\d+u$/i.test(String(uid || ''));

/**
 * Records that should carry an LDAP uid: `ext_`, student (E…U) or empty uid, an HR staff number equal to
 * the supannEmpId of exactly one LDAP account, and no Annuaire record on that uid yet. A student uid keeps
 * the record on the student account, closed at the end of the studies or of the doctoral contract, while
 * the person works on under a staff account. Warnings (uid unlike the name, then different birth dates)
 * point to a wrong staff number rather than to the person.
 */
function ldapUidSwitches(annuaire, ldap) {
  const byHrId = new Map();
  for (const [uid, e] of Object.entries(ldap || {})) {
    const n = normHrId(e && e.empId);
    if (n) byHrId.set(n, [...(byHrId.get(n) || []), uid]);
  }
  const carried = new Set(annuaire.map((r) => r.fields.uid_dyna).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const rec of annuaire) {
    const f = rec.fields;
    const uid = String(f.uid_dyna || '');
    if ((uid && !uid.startsWith('ext_') && !isStudentUid(uid)) || seen.has(rec.key)) continue;
    const hrId = normHrId(f[HR_ID_COL]);
    const targets = hrId ? byHrId.get(hrId) || [] : [];
    if (targets.length !== 1 || carried.has(targets[0])) continue;
    seen.add(rec.key);
    const to = targets[0];
    const e = ldap[to];
    // The uid unlike the name is the signal of a wrong staff number; the birth dates of the ext_
    // records are unreliable (shifted between people in old HR exports), so they only back it up.
    const warnings = [];
    if (!uidMatchesName(to, f)) {
      warnings.push(`l’uid ${to} ne ressemble pas au nom ${nameOf(f)} (nom d’usage, ou n° agent erroné ?)`);
      // The record may know the year or the month only (YYYY, YYYY-MM): it contradicts LDAP when it is not a prefix of it.
      const [gristBirth, ldapBirth] = [fuzzyDay(f.DATE_DE_NAISSANCE_JJ_MM_AAAA), isoDay(e.birthDate)];
      if (gristBirth && ldapBirth && !ldapBirth.startsWith(gristBirth)) warnings.push(`dates de naissance différentes (fiche ${gristBirth}, LDAP ${ldapBirth}) : n° agent probablement erroné`);
    }
    const student = isStudentUid(uid) ? { uid, etat: (ldap[uid] || {}).etat || '', dateFin: (ldap[uid] || {}).dateFin || '' } : null;
    out.push({ rec, to, hrId, etat: e.etat || '', categorie: e.categorie || '', warnings, student });
  }
  return out;
}

// ── Hosted account of another employer (D3) ─────────────────────────────────────
/** Home institution, as lib/validation.ts HOME_EMPLOYER (this CommonJS script cannot import it). */
const HOME_UAI = '0442953W';
const HOME_NAME = 'NANTES UNIVERSITE';
const normEmployer = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
/** Employer filled in and other than the home institution (UAI first, else the label) — lib/validation.ts isExternalEmployer. */
const isExternalEmployerRef = (ref, etablissements) => {
  const e = (etablissements || {})[ref];
  if (!e) return false;
  const name = normEmployer(e.Employeur);
  const uai = String(e.UAI || '').trim().toUpperCase();
  if ((!name || name === 'NON RENSEIGNE') && !uai) return false;
  return uai ? uai !== HOME_UAI : name !== HOME_NAME;
};
/** Employer filled in, home institution included (« non renseigné » = not filled) — lib/presence.ts employerKindOf. */
const employerLabelRef = (ref, etablissements) => {
  const e = (etablissements || {})[ref];
  if (!e) return '';
  const name = String(e.Employeur || '').trim();
  if (name && normEmployer(name) !== 'NON RENSEIGNE') return name;
  return String(e.UAI || '').trim();
};

// ── Several directory rows of one person (same uid) ──────────────────────────────────────
/**
 * Groups of Annuaire rows sharing a uid that are not qualified — same test as lib/directory/duplicates.ts
 * computeDuplicateGroups: qualified = exactly one PRINCIPAL row and a role on every row, or an « A_REVOIR » decision.
 */
function unqualifiedGroups(annuaire) {
  const byUid = new Map();
  for (const r of annuaire) {
    const uid = String(r.fields.uid_dyna || '').trim();
    if (uid) byUid.set(uid, [...(byUid.get(uid) || []), r]);
  }
  const out = [];
  for (const rows of byUid.values()) {
    if (rows.length < 2) continue;
    const roles = rows.map((r) => String(r.fields.rattachement || '').trim().toUpperCase());
    const qualified = (roles.filter((x) => x === 'PRINCIPAL').length === 1 && roles.every(Boolean))
      || rows.some((r) => String(r.fields.doublon_decision || '').trim().toUpperCase().startsWith('A_REVOIR'));
    if (!qualified) out.push(rows);
  }
  return out;
}

// ── « Employer to enter » tasks of migration 002 (release 1.6.0) ──────────────────────────
const EMPLOYER_TASK_ORIGIN = 'migration:002-validated-presence';
const OPEN_STATUSES = ['a_faire', 'en_cours', 'en_attente'];
/**
 * Why an « employer to enter » task no longer matters, or '' while it does. The task keeps the « not the
 * institution » information of a record validated EXTERNE; lib/presence.ts isHomeStaff only counts a record
 * with an unknown employer as home staff when it holds an LDAP account, so without one nothing is lost. Only
 * the uid decides (`ext_` or empty = no account), not the LDAP cache: a real uid missing from the cache for a
 * while must not close the task for good (closing-only rule, nothing reopens it).
 */
function employerTaskSettled(rec, ctx) {
  if (!rec) return 'Fiche supprimée de l’Annuaire.';
  const f = rec.fields;
  const employer = f.Employeur ? employerLabelRef(f.Employeur, ctx.etablissements) : '';
  if (employer) return `Employeur renseigné (${employer}).`;
  if (/^PARTI$/i.test(String(f.validated_status || '').trim())) return 'Personne validée partie : l’employeur ne compte plus pour la présence.';
  const uid = String(f.uid_dyna || '').trim();
  if (uid && !uid.startsWith('ext_')) return '';
  return 'Fiche sans uid LDAP (ext_ ou vide) : Druid la compte déjà hors de l’établissement (externe), l’employeur n’est pas nécessaire.';
}

// ── Presence as Druid shows it (lib/presence.ts derivePresence, ported: this script cannot import TypeScript) ──
/** An employment end this close is an announced departure (lib/presence.ts DEPARTURE_NOTICE_MONTHS). */
const DEPARTURE_NOTICE_MONTHS = 3;
/** Fuzzy date of a cell (YYYY, YYYY-MM, YYYY-MM-DD; Grist epoch seconds read as a day). */
const fuzzyOf = (v) => (typeof v === 'number' && v ? new Date(v * 1000).toISOString().slice(0, 10) : String(v || '').trim());
/** Last day a fuzzy date may mean (« 2027 » → 2027-12-31), '' when not a date — lib/dates.ts fuzzyDateUpperBound. */
const fuzzyUpper = (v) => {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(fuzzyOf(v));
  if (!m) return '';
  const month = m[2] ? Number(m[2]) : 12;
  const day = m[3] ? Number(m[3]) : new Date(Date.UTC(Number(m[1]), month, 0)).getUTCDate();
  return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
const isPastFuzzy = (v) => { const u = fuzzyUpper(v); return !!u && u < today; };
const monthsFromToday = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const isTrueCell = (v) => v === true || v === 1 || v === 'true' || v === 'OUI' || v === 'oui' || v === 'yes';
/** Presence set by a reliable list covering the status (lib/validation.ts normStatus), '' otherwise. */
const validatedPresenceOf = (f) => {
  if (!isTrueCell(f.validated) || !String(f.validation_scope || '').includes('statut')) return '';
  const s = normEmployer(f.validated_status);
  if (s === 'PRESENT' || s === 'INTERNE' || s === 'EXTERNE') return 'PRESENT';
  return s === 'DEPART' || s === 'PARTI' ? s : '';
};
/** LDAP state of a record: 'none' (ext_ or no uid), 'gone' (uid absent from the cache), 'closing' (D) or 'active'. */
const ldapStateOf = (f, ctx) => {
  const uid = String(f.uid_dyna || '').trim();
  if (!uid || uid.startsWith('ext_')) return 'none';
  const l = ctx.ldap[uid];
  const etat = l === undefined ? undefined : (typeof l === 'string' ? l : l && l.etat);
  if (etat === undefined || etat === null) return 'gone';
  return String(etat).trim().toUpperCase().startsWith('D') ? 'closing' : 'active';
};
/**
 * Presence of an Annuaire row as Druid computes it (same order as lib/presence.ts derivePresence, without the
 * « retired without emeritus » signal, which only makes this one see fewer departures): { presence, why }.
 */
function presenceOf(f, ctx) {
  const uid = String(f.uid_dyna || '').trim();
  if (isPastFuzzy(f.employment_end_date) && isPastFuzzy(f.affiliation_end_date)) return { presence: 'PARTI', why: 'fins d’emploi et d’appartenance passées' };
  const validated = validatedPresenceOf(f);
  if (validated) return { presence: validated, why: `présence validée${f.validation_source ? ` « ${f.validation_source} »` : ''}` };
  if (!isExternalEmployerRef(f.Employeur, ctx.etablissements)) {
    const l = ldapStateOf(f, ctx);
    if (l === 'gone') return { presence: 'PARTI', why: `compte LDAP ${uid} disparu` };
    if (l === 'closing') return { presence: 'DEPART', why: `compte LDAP ${uid} en fermeture` };
  }
  if (isPastFuzzy(f.employment_end_date)) return { presence: 'PARTI', why: 'fin d’emploi passée' };
  const end = fuzzyUpper(f.employment_end_date);
  if (end && end <= monthsFromToday(DEPARTURE_NOTICE_MONTHS)) return { presence: 'DEPART', why: 'fin d’emploi dans moins de 3 mois' };
  return { presence: 'PRESENT', why: '' };
}

// ── Rules: detect(ctx) → [{ key, rec, description, lien, type? }] ─────────────────

// ── Career path (docs/archive/plan-parcours-affiliations.md, lot 4) ────────────────────────
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
/** A thesis defended more than this many years ago does not belong to a current PhD student (a PhD lasts 3 to 6). */
const PHD_RECENT_YEARS = 6;
const isPhdStudent = (f) => [f.TYPE_EMPLOI, f.Corps_grade].some((v) => String(v || '').trim().toUpperCase() === 'DOCTORANT');

/**
 * `settled(rec, ctx, type)` of a rule: why a situation it would flag needs nobody, or ''. The rule skips such
 * records, and the closing of its open tasks gives this reason instead of « situation gone ».
 */
/** Departure task: Druid already counts the person gone / leaving, or an active home LDAP account outweighs
 * a departure seen in the publications only (the weakest signal). */
function parcoursSettled(rec, ctx) {
  if (!rec) return '';
  const f = rec.fields;
  const p = presenceOf(f, ctx);
  if (p.presence === 'PARTI') return `Druid compte déjà la personne partie (${p.why}).`;
  if (p.presence === 'DEPART') return `Druid compte déjà la personne sur le départ (${p.why}).`;
  const line = ctx.parcours[rec.key];
  const strongest = line && PARCOURS_DEPART.map(([sig, type]) => ((line.signals || []).some((x) => x.type === sig) ? type : '')).find(Boolean);
  if (strongest === 'parcours_depart_observe' && ldapStateOf(f, ctx) === 'active' && !isExternalEmployerRef(f.Employeur, ctx.etablissements)) {
    return `Compte LDAP ${f.uid_dyna} actif dans l’établissement : les publications seules ne suffisent pas à conclure au départ.`;
  }
  return '';
}
/**
 * Ended record that ORCID still shows in a current position here (no local publication behind the signal): when a
 * reliable source already says the person left — a reliable list validating the departure, or the home LDAP account
 * gone or closing — the record is right and the ORCID profile is out of date: nothing to fix in Druid. The end dates
 * alone do not count (they are what the task questions), nor a validated presence (the end date is then the problem).
 */
function incoherentSettled(rec, ctx) {
  if (!rec) return '';
  const sig = (ctx.parcours[rec.key]?.signals || []).find((x) => x.type === 'statut_incoherent');
  if (!sig || sig.lastLocal) return '';   // local publications after the end: the end date is probably too early
  const f = rec.fields;
  const validated = validatedPresenceOf(f);
  if (validated === 'PARTI' || validated === 'DEPART') {
    return `Profil ORCID pas à jour : la personne est validée ${validated === 'PARTI' ? 'partie' : 'sur le départ'}${f.validation_source ? ` (« ${f.validation_source} »)` : ''} ; rien à corriger dans Druid.`;
  }
  if (validated) return '';
  if (isExternalEmployerRef(f.Employeur, ctx.etablissements)) return '';   // a hosted account says nothing
  const l = ldapStateOf(f, ctx);
  if (l === 'gone' || l === 'closing') return `Profil ORCID pas à jour : le compte LDAP ${f.uid_dyna} est ${l === 'gone' ? 'fermé' : 'en fermeture'} ; rien à corriger dans Druid.`;
  return '';
}
/** Identifiers never affiliated here: expected for a person employed by another institution (multi-site lab), whose
 * publications and Scopus profile give their own institution. */
function suspectSettled(rec, ctx) {
  if (!rec || !isExternalEmployerRef(rec.fields.Employeur, ctx.etablissements)) return '';
  const employer = String(ctx.etablissements[rec.fields.Employeur].Employeur || '').trim() || 'un autre établissement';
  return `Employeur ${employer} : ses publications et son profil Scopus citent son propre établissement, il est normal qu’ils ne citent pas celui-ci.`;
}
/** PhD student turned doctor: nothing to update once Druid counts the person gone (or leaving, for the recent
 * thesis — an old one still points to an IdRef to check). */
function doctorantSettled(rec, ctx, type) {
  if (!rec) return '';
  const p = presenceOf(rec.fields, ctx);
  if (p.presence === 'PARTI') return `Druid compte déjà la personne partie (${p.why}) : rien à mettre à jour.`;
  if (p.presence === 'DEPART' && type !== 'annuaire_doctorant_these_ancienne') return `Druid compte déjà la personne sur le départ (${p.why}) : rien à mettre à jour.`;
  return '';
}
/** Thesis of each directory row, from the table Theses (one row per person, `annuaire_rows` = its rows). */
const thesesByRow = (rows) => {
  const out = {};
  for (const r of rows || []) for (const id of r.fields.annuaire_rows || []) out[id] = r.fields;
  return out;
};
const frDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d);
const thesisUrl = (nnt) => `https://theses.fr/${encodeURIComponent(nnt)}`;
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
  uid_ldap_disponible: {
    type: 'annuaire_uid_ldap',
    sources: ['ldap'],
    detect(ctx) {
      return ldapUidSwitches(ctx.annuaire, ctx.ldap).map((s) => ({
        key: `${s.rec.key}>${s.to}`,
        rec: s.rec,
        description: [
          `Le n° agent ${s.hrId} de cette fiche (${s.rec.fields.uid_dyna || 'sans uid'}) est celui du compte LDAP ${s.to}`
            + ` (état ${s.etat || '?'}${s.categorie ? `, ${s.categorie}` : ''}), qu’aucune fiche ne porte.`,
          ...(s.student ? [`${s.student.uid} est un compte étudiant (${s.student.etat ? `état ${s.student.etat}` : 'absent du LDAP personnel'}${s.student.dateFin ? `, fin ${s.student.dateFin}` : ''}) : l’étudiant ou le doctorant est devenu personnel, et la fiche suit encore son compte étudiant (statut, fin d’emploi).`] : []),
          ...s.warnings.map((w) => `Attention : ${w}.`),
          'À faire : bouton « Passer à l’uid LDAP » (toutes les lignes de la fiche). La synchronisation LDAP s’applique ensuite à la fiche.',
          ...(s.rec.fields.uid_dyna ? [`SoVisu+ connaît cette personne sous ${s.rec.fields.uid_dyna} : une tâche de suivi est créée pour retirer ses identifiants de l’ancienne personne, sinon SoVisu+ refuse ${s.to} (« Conflicting identifiers »).`] : []),
        ].join('\n'),
        lien: '',
      }));
    },
  },
  hebergement_fin: {
    type: 'annuaire_hebergement_fin',
    sources: ['ldap', 'etablissements'],
    detect(ctx) {
      const out = [];
      for (const rec of ctx.annuaire) {
        const f = rec.fields;
        const uid = String(f.uid_dyna || '');
        if (!uid || uid.startsWith('ext_') || !isExternalEmployerRef(f.Employeur, ctx.etablissements)) continue;
        const l = ctx.ldap[uid];
        if (!l || !String(l.etat || '').toUpperCase().startsWith('D')) continue;
        // An end already entered (employment or membership) settles it; so does a validated departure.
        if (f.employment_end_date || f.affiliation_end_date) continue;
        if (/^(DEPART|PARTI)$/i.test(String(f.validated_status || '').trim())) continue;
        const employer = ctx.etablissements[f.Employeur].Employeur;
        out.push({
          key: rec.key, rec,
          description: [
            `Employeur ${employer} ; le compte LDAP hébergé ${uid} est en fermeture (état D${l.dateFin ? `, fin ${l.dateFin}` : ''}).`,
            'Druid n’en déduit pas un départ (fin de convention d’hébergement possible sans départ du labo).',
            'À faire : vérifier auprès du labo ; départ ⇒ saisir la fin d’emploi ou d’appartenance (la tâche se ferme seule), sinon abandonner la tâche.',
          ].join('\n'),
          lien: '',
        });
      }
      return out;
    },
  },
  appartenance_a_qualifier: {
    type: 'annuaire_appartenance_a_qualifier',
    sources: ['annuaire'],
    detect(ctx) {
      const out = [];
      for (const rows of unqualifiedGroups(ctx.annuaire)) {
        const f = rows[0].fields;
        const labs = rows.map((r) => String(r.fields.LABO || '').trim() || '∅');
        const sameLab = new Set(labs).size === 1;
        out.push({
          key: rows[0].key, rec: rows[0],
          description: [
            `${rows.length} lignes de l’Annuaire pour ${nameOf(f)} (${f.uid_dyna}), non qualifiées : ${rows.map((r, i) => `${labs[i]}${r.fields.rattachement ? ` (${r.fields.rattachement})` : ''}`).join(', ')}.`,
            sameLab
              ? 'Même labo sur chaque ligne : doublon probable, à fusionner depuis la tâche.'
              : 'À faire depuis la tâche : choisir la ligne principale, puis appartenances simultanées (les autres deviennent secondaires) ou successives (historiques).',
            'Tant que ce n’est pas fait, la personne apparaît en plusieurs fiches et l’ajout d’une appartenance est refusé.',
          ].join('\n'),
          lien: druidRecordUrl(rows[0].key),
        });
      }
      return out;
    },
  },
  employeur_a_renseigner: {
    type: 'annuaire_employeur_a_renseigner',
    // Unreadable employer table ⇒ skipped (an entered employer would go unseen).
    sources: ['etablissements'],
    /** Closing-only: [{ task, reason }] for the open tasks of migration 002 that no longer matter. */
    review(ctx) {
      const byRow = new Map(ctx.annuaire.map((r) => [r.id, r]));
      const out = [];
      for (const task of ctx.tasks || []) {
        const t = task.fields;
        if (t.type !== 'annuaire_employeur_a_renseigner' || t.origine !== EMPLOYER_TASK_ORIGIN) continue;
        if (!OPEN_STATUSES.includes(schema.statusOf(t))) continue;
        const reason = employerTaskSettled(byRow.get(Number(t.chercheur)), ctx);
        if (reason) out.push({ task, reason });
      }
      return out;
    },
  },
  parcours_depart: {
    type: 'parcours_depart_observe',
    types: ['parcours_depart_confirme', 'parcours_depart_declare', 'parcours_depart_observe'],
    // ldap + etablissements: the presence (parcoursSettled) reads them; empty ⇒ skipped, not every uid « gone ».
    sources: ['parcours', 'ldap', 'etablissements'],
    settled: parcoursSettled,
    detect(ctx) {
      const out = [];
      for (const [key, e] of endsByKey(ctx.annuaire)) {
        const line = ctx.parcours[key];
        if (!line || e.ended) continue;   // an end date entered since the computation closes the task
        if (parcoursSettled(e.rec, ctx)) continue;
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
    // ldap + etablissements: incoherentSettled reads them; empty ⇒ skipped, not every account « gone ».
    sources: ['parcours', 'ldap', 'etablissements'],
    settled: incoherentSettled,
    detect(ctx) {
      const out = [];
      for (const [key, e] of endsByKey(ctx.annuaire)) {
        const sig = (ctx.parcours[key]?.signals || []).find((x) => x.type === 'statut_incoherent');
        if (!sig || !e.ended) continue;   // end date removed since the computation: nothing left to check
        if (incoherentSettled(e.rec, ctx)) continue;
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
    sources: ['parcours', 'etablissements'],
    settled: suspectSettled,
    detect(ctx) {
      const out = [];
      for (const [key, e] of endsByKey(ctx.annuaire)) {
        const sig = (ctx.parcours[key]?.signals || []).find((x) => x.type === 'identifiant_suspect');
        if (!sig || e.ended) continue;
        if (suspectSettled(e.rec, ctx)) continue;
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
  doctorant_these: {
    type: 'annuaire_doctorant_docteur',
    types: ['annuaire_doctorant_docteur', 'annuaire_doctorant_these_ancienne'],
    sources: ['theses', 'ldap', 'etablissements'],
    settled: doctorantSettled,
    detect(ctx) {
      const out = [];
      const recentFrom = `${Number(today.slice(0, 4)) - PHD_RECENT_YEARS}${today.slice(4)}`;
      for (const rec of ctx.annuaire) {
        const f = rec.fields;
        const t = ctx.theses[rec.id];
        if (!t || !isPhdStudent(f)) continue;
        if (/^PARTI$/i.test(String(f.validated_status || '').trim())) continue;   // gone: nothing to update
        const when = `${frDate(String(t.defended_on))}${t.institution ? ` (${t.institution})` : ''}`;
        const recent = String(t.defended_on) >= recentFrom.slice(0, String(t.defended_on).length);
        if (doctorantSettled(rec, ctx, recent ? 'annuaire_doctorant_docteur' : 'annuaire_doctorant_these_ancienne')) continue;
        out.push(recent ? {
          key: rec.key, rec, type: 'annuaire_doctorant_docteur',
          description: [
            `Thèse soutenue le ${when}, NNT ${t.nnt} (theses.fr, par l’IdRef de la fiche) ; la fiche indique toujours « doctorant ».`,
            'À faire : mettre à jour le type d’emploi et le grade (post-doctorant, ATER, MCF…), ou, si la personne est partie, saisir la fin d’emploi et valider la présence « parti ». La tâche se ferme seule quand la fiche ne dit plus « doctorant » ou que Druid compte la personne partie ou sur le départ.',
          ].join('\n'),
          lien: druidRecordUrl(rec.key),
        } : {
          key: rec.key, rec, type: 'annuaire_doctorant_these_ancienne',
          description: [
            `L’IdRef de la fiche porte une thèse soutenue le ${when}, NNT ${t.nnt}, il y a plus de ${PHD_RECENT_YEARS} ans, alors que la fiche indique « doctorant ».`,
            'IdRef d’un homonyme ? (ou seconde thèse) À faire : vérifier l’IdRef dans l’alignement IdRef, le corriger le cas échéant ; sinon abandonner la tâche.',
          ].join('\n'),
          lien: thesisUrl(t.nnt),
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

  if (APPLY) await schema.ensureTasksTablesWith(common.grist());
  const records = await common.gristRecords('Annuaire');
  const annuaire = (records || []).map((r) => ({ id: r.id, key: r.fields.uid_dyna || `g${r.id}`, fields: r.fields }));
  const ctx = {
    annuaire,
    orcid: loadJson('orcid_align_cache.json'),
    hal: loadJson('hal_align_cache.json'),
    scopus: loadJson('scopus_align_cache.json'),
    idref: loadJson('idref_align_cache.json'),
    ldap: loadJson('ldap_status_cache.json'),
    // Employer table (hebergement_fin): unreadable ⇒ empty ⇒ the rule is skipped, its tasks left untouched.
    etablissements: await common.gristRecords('Etablissements')
      .then((records) => Object.fromEntries((records || []).map((r) => [r.id, r.fields])))
      .catch((e) => { console.warn(`[tasks] Etablissements unreadable (${e.message})`); return {}; }),
    parcours: loadJson(PARCOURS_INDEX),
    // PhD of the people (doctorant_these): PostgreSQL instances only; elsewhere empty ⇒ the rule is skipped.
    theses: await common.gristRecords('Theses')
      .then(thesesByRow)
      .catch(() => ({})),
  };
  let existing = [];
  try { existing = (await common.gristRecords(schema.TASKS_TABLE)) || []; }
  catch (e) { if (APPLY) throw e; console.log(`[tasks] table ${schema.TASKS_TABLE} unreadable (${e.message}) — dry-run continues with no existing task`); }
  ctx.tasks = existing;   // closing-only rules (review) read the tasks they settle
  const byKey = new Map(existing.filter((r) => r.fields.cle).map((r) => [r.fields.cle, r]));
  const rowById = new Map(annuaire.map((r) => [r.id, r]));   // settled(): reason of a closing
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
    if (rule.review) {
      // Closing-only rule: settles tasks created elsewhere (a migration), never creates nor reopens one.
      const settled = rule.review(ctx);
      for (const { task, reason } of settled) {
        patches.push({ id: task.id, fields: { statut: 'resolue_auto', fait_par: AUTHOR, fait_le: nowIso, verifie_le: nowIso, resolution: reason },
          event: { date: nowIso, auteur: AUTHOR, action: 'resolution_auto', detail: `Règle ${name} : ${reason}` } });
      }
      stats.resolved += settled.length;
      console.log(`[tasks] ${name}: ${settled.length} settled`);
      done++;
      writeProgress({ running: true, total: rules.length, done, ...stats, startedAt: nowIso });
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
      const reason = rule.settled ? rule.settled(rowById.get(Number(cur.fields.chercheur)), ctx, cur.fields.type) : '';
      patches.push({ id: cur.id, fields: { statut: 'resolue_auto', fait_par: AUTHOR, fait_le: nowIso, verifie_le: nowIso, resolution: reason || `Situation disparue au contrôle du ${today}` },
        event: { date: nowIso, auteur: AUTHOR, action: 'resolution_auto', detail: reason ? `Règle ${name} : ${reason}` : `La règle ${name} ne détecte plus la situation` } });
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
      const client = common.grist();
      for (let i = 0; i < rows.length; i += 100) {
        ids.push(...await client.addRecords(schema.TASKS_TABLE, rows.slice(i, i + 100).map((fields) => ({ fields }))));
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

module.exports = { RULES, DEFAULT_RULES, unqualifiedGroups, employerTaskSettled, presenceOf, thesesByRow, endsByKey, plausible, openNantesAffiliations, nameMatch, sharedIdentifierGroups, ldapUidSwitches };

if (require.main === module) {
  main().catch((e) => {
    console.error('[tasks] ✗', e);
    writeProgress({ running: false, error: e.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });
}
