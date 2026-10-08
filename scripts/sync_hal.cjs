/**
 * sync_hal.cjs — Alignment of the Annuaire records on the HAL author profiles (AureHal).
 *
 * Goal: fill in `IdHAL` (idHal_s, slug) AND `IdHAL_i` (numeric identifier) —
 * CRISalid consumes both (`idhals` / `idhali` columns of people.csv, see server.cjs).
 * Plan: docs/archive/plan-alignement-orcid-hal.md (lot 2). Foundation: scripts/lib/align_common.cjs.
 *
 * API (no authentication, tested on 2026-09-09):
 *   GET https://api.archives-ouvertes.fr/ref/author/?q=text:(nom AND prenom) AND valid_s:(PREFERRED OR OLD)
 *       → docs { idHal_i, idHal_s, person_i, form_i, fullName_s, valid_s, emailDomain_s[], orcidId_s[], idrefId_s[] }
 *       (orcidId_s / idrefId_s are URLs: https://orcid.org/…, https://www.idref.fr/…)
 *   GET https://api.archives-ouvertes.fr/search/?q=authIdHal_i:<i>&rows=0&facet=true&facet.field=…
 *       → labs / structures of a candidate's publications (evidence of a Nantes affiliation)
 *
 * Modes (--mode=):
 *   search (default): records WITHOUT IdHAL. Pass 0 = derivation through cross identifiers (ORCID, IdRef,
 *                     IdHAL_selon_IdRef); otherwise search by name. Scoring `fort`/`moyen`/`faible` (§1 of the plan),
 *                     then push of the suggestions into the collaborative Grist table `Alignement_HAL`
 *                     (Valider / Rejeter buttons, same life cycle as Alignement_IdRef).
 *   verify          : records WITH IdHAL. Resolves IdHAL_i (deterministic → written directly into
 *                     the Annuaire with HAL_* traceability), flags IdHALs unknown to HAL and name
 *                     discrepancies, proposes ORCID / IdRef if empty (read by the UI, no review).
 *
 *   push            : no API call — pushes the cached suggestions (search mode) again into the review
 *                     table (« Envoyer en revue Grist » button of Druid, see server.cjs /api/align/:source/trigger).
 *
 * Options: --mode= --limit= --labo= --group=personnel|doctorants|hors_recherche --concurrency=(4)
 *           --push-grist=false (dry-run: neither review table nor Annuaire write)
 *           --force (reprocesses the records already in the cache, --labo included)
 * Incremental: a record already processed in the current mode is skipped without --force.
 * Cache: hal_align_cache.json (key = uid_dyna, or g<rowId> for records without uid), served by
 * server.cjs from the app root; progress: hal_align_progress.json.
 */
const common = require('./lib/align_common.cjs');
const {
  normalize, extractPpn, nameMatch, getUrl, runPool, makeStore, today,
  gristPatchGrouped, withTrace, loadRejected, pushReview, DOC, heterogeneousFirstNames,
} = common;
const { selectTargets } = require('./lib/align_targets.cjs');

// ── Parameters ───────────────────────────────────────────────────────────────
const OPTS = common.commonOptions({ modes: ['search', 'verify', 'push'], concurrency: 4 });
const { mode: MODE, limit: LIMIT, labo: LABO_FILTER, group: GROUP_FILTER, concurrency: CONCURRENCY, pushGrist: PUSH_GRIST } = OPTS;
const FORCE = OPTS.force;   // a lab run is incremental too (decision D2 of 2026-09-30): --force to reprocess
const HAL = 'https://api.archives-ouvertes.fr';
const REVIEW_TABLE = 'Alignement_HAL';
const SOURCE = 'HAL';                 // Data_source label / HAL_* columns
const MAX_CANDIDATES_FACETS = 8;      // facet requests per person (cap)
const MAX_PUSHED_CANDIDATES = 5;      // candidates pushed to review for an ambiguous case

const store = makeStore({ cachePath: 'hal_align_cache.json', progressPath: 'hal_align_progress.json' });
const { loadCache, writeCache, writeProgress } = store;

// Email domains of the Nantes site (« moyen » evidence). National domains (cnrs.fr, inserm.fr…)
// are only cited as evidence: too many homonyms elsewhere in France.
const SITE_DOMAINS = [
  'univ-nantes.fr', 'ec-nantes.fr', 'imt-atlantique.fr', 'mines-nantes.fr', 'oniris-nantes.fr',
  'chu-nantes.fr', 'ls2n.fr', 'ico.unicancer.fr', 'nantes.inserm.fr', 'nantes.inra.fr', 'ifremer.fr',
];
const NATIONAL_DOMAINS = ['cnrs.fr', 'inserm.fr', 'inrae.fr', 'inria.fr'];
// Substrings (normalized) recognized in the names/acronyms of HAL structures.
const SITE_STRUCT_PATTERNS = [
  'nantes', 'imt atlantique', 'oniris', 'ifremer', 'institut de cancerologie de l ouest',
];

// ── Identifier helpers ───────────────────────────────────────────────────────
/** "https://cv.hal.science/guillaume-godet", "guillaume-godet " → "guillaume-godet". */
function extractIdhal(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  return s.split('/').pop().trim().toLowerCase();
}
const { extractOrcid } = common;   // shared with sync_orcid.cjs
const first = (v) => (Array.isArray(v) ? v[0] : v) || '';
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// ── AureHal client ───────────────────────────────────────────────────────────
const AUTHOR_FL = 'person_i,form_i,idHal_i,idHal_s,fullName_s,firstName_s,lastName_s,valid_s,emailDomain_s,orcidId_s,idrefId_s';

async function refAuthor(q, rows = 60) {
  const params = new URLSearchParams({ q, fl: AUTHOR_FL, rows: String(rows), wt: 'json' });
  try {
    const data = await getUrl(`${HAL}/ref/author/?${params}`, { json: true, timeout: 15000 });
    return data?.response?.docs || [];
  } catch (e) {
    return null; // network error distinguished from « 0 résultat »
  }
}
/** Solr: escapes the special characters of a quoted value. */
const quote = (v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`;

async function searchByName(firstName, lastName) {
  const toks = [...new Set(normalize(`${firstName} ${lastName}`).split(' ').filter((t) => t.length > 1))];
  if (!toks.length) return [];
  return refAuthor(`text:(${toks.join(' AND ')}) AND valid_s:(PREFERRED OR OLD)`);
}
const byIdhal = (slug) => refAuthor(`idHal_s:${quote(slug)}`);
const byIdhalI = (i) => refAuthor(`idHal_i:${parseInt(i, 10)}`);
const byOrcid = (orcid) => refAuthor(`orcidId_s:${quote(`https://orcid.org/${orcid}`)}`);
const byIdref = (ppn) => refAuthor(`idrefId_s:${quote(`https://www.idref.fr/${ppn}`)}`);

/** Labs/structures of the publications of an idHal_i (facets) + number of documents. */
async function authorStructures(idhalI) {
  const params = new URLSearchParams({
    q: `authIdHal_i:${parseInt(idhalI, 10)}`, rows: '0', facet: 'true', 'facet.mincount': '1', 'facet.limit': '15', wt: 'json',
  });
  for (const f of ['labStructAcronym_s', 'structAcronym_s', 'structName_s']) params.append('facet.field', f);
  try {
    const data = await getUrl(`${HAL}/search/?${params}`, { json: true, timeout: 15000 });
    const ff = data?.facet_counts?.facet_fields || {};
    const pairs = (arr) => { const out = []; for (let i = 0; i + 1 < (arr || []).length; i += 2) out.push({ name: arr[i], count: arr[i + 1] }); return out; };
    return {
      nbDocs: data?.response?.numFound || 0,
      labs: pairs(ff.labStructAcronym_s),
      structs: pairs(ff.structAcronym_s),
      structNames: pairs(ff.structName_s),
    };
  } catch (e) {
    return { nbDocs: null, labs: [], structs: [], structNames: [] };
  }
}

// ── Candidates ───────────────────────────────────────────────────────────────
/** Groups the author forms (docs /ref/author) by idHal_i; ignores forms without IdHAL. */
function groupByIdhal(docs) {
  const groups = new Map();
  for (const d of docs || []) {
    const slug = extractIdhal(d.idHal_s);
    if (!slug || !d.idHal_i) continue;
    const key = String(d.idHal_i);
    if (!groups.has(key)) {
      groups.set(key, { idhal: slug, idhalI: key, fullName: '', forms: [], emailDomains: [], orcids: [], idrefs: [] });
    }
    const g = groups.get(key);
    const name = d.fullName_s || `${d.firstName_s || ''} ${d.lastName_s || ''}`.trim();
    if (name && !g.forms.includes(name)) g.forms.push(name);
    if (d.valid_s === 'PREFERRED' && !g.fullName) g.fullName = name;
    for (const e of list(d.emailDomain_s)) if (e && !g.emailDomains.includes(e)) g.emailDomains.push(e);
    for (const o of list(d.orcidId_s)) { const x = extractOrcid(o); if (x && !g.orcids.includes(x)) g.orcids.push(x); }
    for (const r of list(d.idrefId_s)) { const x = extractPpn(r); if (x && !g.idrefs.includes(x)) g.idrefs.push(x); }
  }
  for (const g of groups.values()) if (!g.fullName) g.fullName = g.forms[0] || g.idhal;
  return [...groups.values()];
}

/** Best name match between the record and the candidate's forms. */
function bestNameMatch(p, cand) {
  let best = null;
  for (const f of cand.forms) {
    const m = nameMatch(p.first, p.last, f);
    if (m === 'exact') return 'exact';
    if (m === 'partial') best = 'partial';
  }
  return best;
}

/**
 * Scoring of a candidate for a record (§1 of the plan):
 *   `fort`   = cross identifier (ORCID / IdRef / IdHAL per IdRef) already in the Annuaire;
 *   `moyen`  = site email domain, or Nantes lab/structure in its publications;
 *   `faible` = homonym without evidence.
 * A cross identifier with a divergent name falls back to « moyen » (doubtful ORCID/IdRef).
 */
function scoreCandidate(p, cand, structures) {
  const evidence = [];
  const matchedIds = [];
  const orcid = extractOrcid(p.orcid);
  if (orcid && cand.orcids.includes(orcid)) { matchedIds.push('ORCID'); evidence.push(`ORCID identique (${orcid})`); }
  const ppn = extractPpn(p.idref);
  if (ppn && cand.idrefs.includes(ppn)) { matchedIds.push('IdRef'); evidence.push(`IdRef identique (${ppn})`); }
  const viaIdref = extractIdhal(p.idhalSelonIdref);
  if (viaIdref && viaIdref === cand.idhal) { matchedIds.push('IdHAL_selon_IdRef'); evidence.push('IdHAL indiqué par la notice IdRef'); }

  let site = false;
  for (const d of cand.emailDomains) {
    const dl = d.toLowerCase();
    if (SITE_DOMAINS.some((s) => dl === s || dl.endsWith(`.${s}`))) { site = true; evidence.push(`mail @${d}`); }
    else if (NATIONAL_DOMAINS.some((s) => dl === s || dl.endsWith(`.${s}`))) evidence.push(`mail @${d} (national)`);
  }
  const labo = normalize(p.labo);
  const labs = [...(structures?.labs || []), ...(structures?.structs || [])];
  const laboHit = labo ? labs.find((x) => normalize(x.name) === labo) : null;
  if (laboHit) { site = true; evidence.push(`labo ${laboHit.name} (${laboHit.count} publi${laboHit.count > 1 ? 's' : ''})`); }
  const siteStruct = [...labs, ...(structures?.structNames || [])]
    .find((x) => SITE_STRUCT_PATTERNS.some((pat) => normalize(x.name).includes(pat)));
  if (siteStruct && !laboHit) { site = true; evidence.push(`structure ${siteStruct.name} (${siteStruct.count})`); }
  if (structures?.nbDocs) evidence.push(`${structures.nbDocs} doc${structures.nbDocs > 1 ? 's' : ''} HAL`);

  const name = bestNameMatch(p, cand);
  if (name === 'partial') evidence.push('nom partiel');
  if (!name) evidence.push('nom divergent');

  let score = 'faible';
  if (matchedIds.length) score = name ? 'fort' : 'moyen';
  else if (site && name) score = 'moyen';
  // Suspected mixed identity (OpenAlex plan § 8.2): author forms of the IdHAL carrying different first names, or
  // cross identifier with a divergent name → capped at « moyen », always goes to review.
  const suspect = [];
  if (matchedIds.length && !name) suspect.push('identifiant croisé mais nom divergent');
  const het = heterogeneousFirstNames(p.last, [cand.fullName, ...cand.forms], p.first);
  if (het) suspect.push(`prénoms hétérogènes dans les formes auteur (« ${het[0]} » / « ${het[1]} »)`);
  if (suspect.length) { evidence.unshift(`⚠ identité mêlée suspectée : ${suspect.join(' ; ')}`); if (score === 'fort') score = 'moyen'; }
  return { score, evidence, matchedIds, nameMatch: name, suspect };
}
const RANK = { fort: 0, moyen: 1, faible: 2 };

/** Search + scoring for a record without IdHAL. Returns the cache entry. */
async function alignPerson(p) {
  const queryName = `${p.first} ${p.last}`.trim();
  const derivedFrom = [];
  let derivedDocs = [];
  let netError = false;

  // Pass 0: derivation through cross identifiers (free and safe).
  const derive = async (label, fn) => {
    const r = await fn();
    if (r === null) { netError = true; return; }
    if (r.length) { derivedFrom.push(label); derivedDocs = derivedDocs.concat(r); }
  };
  const orcid = extractOrcid(p.orcid);
  if (orcid) await derive('ORCID', () => byOrcid(orcid));
  const ppn = extractPpn(p.idref);
  if (ppn) await derive('IdRef', () => byIdref(ppn));
  const viaIdref = extractIdhal(p.idhalSelonIdref);
  if (viaIdref) await derive('IdHAL_selon_IdRef', () => byIdhal(viaIdref));

  // Search by name (always: allows detecting a homonym competing with the derived candidate).
  const byName = await searchByName(p.first, p.last);
  if (byName === null) netError = true;

  let candidates = groupByIdhal([...derivedDocs, ...(byName || [])]);
  // Name filter: keep the candidates with a matching form, plus those coming from the derivation
  // (divergent name → « nom divergent » evidence, human arbitration).
  const derivedSlugs = new Set(groupByIdhal(derivedDocs).map((c) => c.idhal));
  candidates = candidates.filter((c) => bestNameMatch(p, c) || derivedSlugs.has(c.idhal));

  // Facets (labs of the publications) for the retained candidates — capped.
  const scored = [];
  for (const cand of candidates.slice(0, MAX_CANDIDATES_FACETS)) {
    const structures = await authorStructures(cand.idhalI);
    const s = scoreCandidate(p, cand, structures);
    scored.push({
      idhal: cand.idhal, idhalI: cand.idhalI, fullName: cand.fullName, forms: cand.forms,
      emailDomains: cand.emailDomains, orcid: cand.orcids[0] || '', idref: cand.idrefs[0] || '',
      labs: labsSummary(structures), nbDocs: structures.nbDocs,
      score: s.score, evidence: s.evidence, matchedIds: s.matchedIds, nameMatch: s.nameMatch, suspect: s.suspect,
    });
  }
  for (const cand of candidates.slice(MAX_CANDIDATES_FACETS)) {
    const s = scoreCandidate(p, cand, null);
    scored.push({
      idhal: cand.idhal, idhalI: cand.idhalI, fullName: cand.fullName, forms: cand.forms,
      emailDomains: cand.emailDomains, orcid: cand.orcids[0] || '', idref: cand.idrefs[0] || '',
      labs: [], nbDocs: null, score: s.score, evidence: [...s.evidence, 'facettes non interrogées'], matchedIds: s.matchedIds, nameMatch: s.nameMatch, suspect: s.suspect,
    });
  }
  scored.sort((a, b) => RANK[a.score] - RANK[b.score] || (b.nbDocs || 0) - (a.nbDocs || 0));

  const strong = scored.filter((c) => c.score === 'fort');
  const medium = scored.filter((c) => c.score === 'moyen');
  let status, best = '';
  if (!scored.length) status = netError ? 'error' : 'not_found';
  else if (strong.length === 1) { status = 'found'; best = strong[0].idhal; }
  else if (!strong.length && medium.length === 1) { status = 'found'; best = medium[0].idhal; }
  else status = 'ambiguous';

  return { mode: 'search', queryName, status, best, derivedFrom, candidates: scored, checkedAt: today() };
}
function labsSummary(structures) {
  return [...(structures?.labs || []), ...(structures?.structs || [])].slice(0, 8).map((x) => `${x.name} (${x.count})`);
}

/** Verification of a record with IdHAL: idHal_i resolution, name check, proposed ORCID/IdRef. */
async function verifyPerson(p) {
  const queryName = `${p.first} ${p.last}`.trim();
  const raw = String(p.idhal || '').trim();
  const numeric = /^\d+$/.test(raw);
  const slug = numeric ? '' : extractIdhal(raw);
  const docs = numeric ? await byIdhalI(raw) : await byIdhal(slug);
  if (docs === null) return { mode: 'verify', queryName, idhal: slug || raw, status: 'error', checkedAt: today() };
  const cand = groupByIdhal(docs)[0];
  if (!cand) return { mode: 'verify', queryName, idhal: slug || raw, status: 'not_found_hal', checkedAt: today() };
  const name = bestNameMatch(p, cand);
  const het = heterogeneousFirstNames(p.last, [cand.fullName, ...cand.forms], p.first);
  const suspect = het ? [`prénoms hétérogènes dans les formes auteur (« ${het[0]} » / « ${het[1]} »)`] : [];
  const proposals = [];
  if (!String(p.idhalI || '').trim()) proposals.push({ field: 'IdHAL_i', after: cand.idhalI });
  if (numeric) proposals.push({ field: 'IdHAL', after: cand.idhal }); // the Annuaire held the numeric id: we fill in the slug
  if (cand.orcids[0] && !extractOrcid(p.orcid)) proposals.push({ field: 'ORCID', after: cand.orcids[0] });
  if (cand.idrefs[0] && !extractPpn(p.idref)) proposals.push({ field: 'IdRef', after: cand.idrefs[0] });
  return {
    mode: 'verify', queryName, idhal: cand.idhal, idhalI: cand.idhalI, status: 'checked',
    nameMismatch: !name, nameMatch: name,
    candidate: { idhal: cand.idhal, idhalI: cand.idhalI, fullName: cand.fullName, forms: cand.forms, emailDomains: cand.emailDomains, orcid: cand.orcids[0] || '', idref: cand.idrefs[0] || '', suspect },
    suspect, proposals, checkedAt: today(),
  };
}

// ── Collaborative Grist review (Alignement_HAL table) ────────────────────────
/** Columns of the review table + formulas of the Valider / Rejeter buttons (Action Button widget). */
function buildHalReviewColumns() {
  const validerFormula = [
    `if $Decision == "Validé":`,
    `  return {"button": "Validé ✓", "description": "Déjà appliqué%s" % ((" le " + $Date_application) if $Date_application else ""), "actions": []}`,
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `ann = Annuaire.lookupOne(id=$Annuaire_id) if $Annuaire_id else Annuaire.lookupOne(uid_dyna=$uid_dyna)`,
    `if not ann:`,
    `  return {"button": "Fiche introuvable", "description": "Aucune fiche Annuaire pour %s" % $uid_dyna, "actions": []}`,
    `import re`,
    `def _slug(v):`,
    `  s = str(v or "").strip().rstrip("/").lower()`,
    `  return s.split("/")[-1] if s else ""`,
    `def _ppn(v):`,
    `  m = re.search(r"([0-9]{6,}[0-9Xx])", str(v or ""))`,
    `  return m.group(1).upper() if m else ""`,
    `fields = {}`,
    `done = []`,
    `cur = _slug(ann.IdHAL)`,
    `cand = _slug($IdHAL_candidat)`,
    `if not cur:`,
    `  fields["IdHAL"] = cand`,
    `  done.append("IdHAL")`,
    `elif cur != cand:`,
    `  return {"button": "Conflit IdHAL", "description": "L'Annuaire contient déjà l'IdHAL %s (différent de %s) : à régler dans Druid" % (ann.IdHAL, cand), "actions": []}`,
    `if str($IdHAL_i_candidat or "").strip() and not str(ann.IdHAL_i or "").strip():`,
    `  fields["IdHAL_i"] = str($IdHAL_i_candidat).strip()`,
    `  done.append("IdHAL_i")`,
    `if str($ORCID_candidat or "").strip() and not str(ann.ORCID or "").strip():`,
    `  fields["ORCID"] = $ORCID_candidat`,
    `  done.append("ORCID")`,
    `if str($IdRef_candidat or "").strip() and not _ppn(ann.IdRef):`,
    `  fields["IdRef"] = $IdRef_candidat`,
    `  done.append("IdRef")`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `actions = []`,
    `if fields:`,
    `  src = str(ann.Data_source or "")`,
    `  parts = [s.strip().upper() for s in re.split(r"[|,]", src) if s.strip()]`,
    `  if "${SOURCE.toUpperCase()}" not in parts:`,
    `    fields["Data_source"] = (src + "|${SOURCE}") if src else "${SOURCE}"`,
    `  fields["${SOURCE}_derniere_maj"] = today`,
    `  fields["${SOURCE}_champs_modifies"] = "|".join(done)`,
    `  note = "[%s] MAJ ${SOURCE} (revue Grist): %s" % (today, ", ".join(done))`,
    `  com = str(ann.Commentaires or "")`,
    `  fields["Commentaires"] = (com + "\\n" + note) if com else note`,
    `  actions.append(["UpdateRecord", "Annuaire", ann.id, fields])`,
    `actions.append(["UpdateRecord", "${REVIEW_TABLE}", $id, {"Decision": "Validé", "Applique": True, "Date_application": today}])`,
    `# Les autres candidats encore en attente pour la même personne sont auto-rejetés.`,
    `for sib in ${REVIEW_TABLE}.lookupRecords(uid_dyna=$uid_dyna):`,
    `  if sib.id != $id and sib.Decision == "À traiter":`,
    `    actions.append(["UpdateRecord", "${REVIEW_TABLE}", sib.id, {"Decision": "Rejeté", "Date_application": today}])`,
    `label = ("Valider " + " + ".join(done)) if done else "Valider (rien à écrire)"`,
    `return {"button": label, "description": "%s -> IdHAL %s" % ($Nom_annuaire, cand), "actions": actions}`,
  ].join('\n');

  const rejeterFormula = [
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `return {"button": "Rejeter", "description": "Écarte ce candidat pour %s (il ne sera plus reproposé)" % $Nom_annuaire, "actions": [["UpdateRecord", "${REVIEW_TABLE}", $id, {"Decision": "Rejeté", "Date_application": today}]]}`,
  ].join('\n');

  const text = (id, label) => ({ id, fields: { label, type: 'Text' } });
  return [
    text('uid_dyna', 'uid_dyna'),
    { id: 'Annuaire_id', fields: { label: 'Annuaire (ligne)', type: 'Int' } },
    text('Nom_annuaire', 'Nom annuaire'),
    text('LABO', 'LABO'),
    { id: 'Nb_candidats', fields: { label: 'Nb candidats', type: 'Int' } },
    text('IdHAL_candidat', 'IdHAL candidat'),
    text('IdHAL_i_candidat', 'IdHAL_i candidat'),
    {
      id: 'Lien_HAL',
      fields: {
        label: 'Lien HAL', type: 'Text', isFormula: true,
        // HAL search by IdHAL (cv.hal.science only exists for authors who created a HAL CV).
        formula: `"https://hal.science/search/index/q/*/authIdHal_s/" + str($IdHAL_candidat or "")`,
        widgetOptions: JSON.stringify({ widget: 'HyperLink' }),
      },
    },
    text('Nom_profil', 'Nom profil HAL'),
    text('Formes', 'Formes auteur'),
    text('Score', 'Score'),
    text('Preuves', 'Preuves'),
    text('Domaines_email', 'Domaines email'),
    text('Labos_HAL', 'Labos / structures HAL'),
    { id: 'Nb_publis', fields: { label: 'Nb publis HAL', type: 'Int' } },
    text('ORCID_candidat', 'ORCID candidat'),
    text('IdRef_candidat', 'IdRef candidat'),
    ...common.reviewDecisionColumns(REVIEW_TABLE),   // Decision (4 values), Note, Signale_le, Meler_action
    { id: 'Applique', fields: { label: 'Appliqué', type: 'Bool' } },
    text('Date_application', 'Date application'),
    text('Pousse_le', 'Poussé le'),
    { id: 'Valider_action', fields: { label: 'Valider (action)', type: 'Any', isFormula: true, formula: validerFormula } },
    { id: 'Rejeter_action', fields: { label: 'Rejeter (action)', type: 'Any', isFormula: true, formula: rejeterFormula } },
  ];
}

/** Rows to push to review (found → 1 row; ambiguous → up to MAX_PUSHED_CANDIDATES rows). */
function buildReviewRows(cache, all, rejected) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const desired = new Map();
  const row = (p, entry, nb, c) => ({
    uid_dyna: p.key, Annuaire_id: p.recId, Nom_annuaire: entry.queryName || `${p.first} ${p.last}`.trim(), LABO: p.labo || '',
    Nb_candidats: nb, IdHAL_candidat: c.idhal, IdHAL_i_candidat: String(c.idhalI || ''),
    Nom_profil: c.fullName || '', Formes: (c.forms || []).join(' | '), Score: c.score,
    Preuves: (c.evidence || []).join(' ; '), Domaines_email: (c.emailDomains || []).join(', '),
    Labos_HAL: (c.labs || []).join(' ; '), Nb_publis: c.nbDocs || 0,
    ORCID_candidat: c.orcid || '', IdRef_candidat: c.idref || '',
  });
  let found = 0, ambiguous = 0;
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.mode !== 'search') continue;
    const p = byKey.get(key);
    if (!p || extractIdhal(p.idhal)) continue;   // record gone or IdHAL filled in in the meantime
    const cands = (entry.candidates || []).filter((c) => !rejected.has(`${key}::${c.idhal}`));
    if (!cands.length) continue;
    if (entry.status === 'found' && cands.some((c) => c.idhal === entry.best)) {
      const c = cands.find((x) => x.idhal === entry.best);
      desired.set(`${key}::${c.idhal}`, row(p, entry, 1, c));
      found++;
    } else {
      const top = cands.slice(0, MAX_PUSHED_CANDIDATES);
      for (const c of top) desired.set(`${key}::${c.idhal}`, row(p, entry, top.length, c));
      ambiguous++;
    }
  }
  return { desired, found, ambiguous };
}

// ── Direct Annuaire write (verify mode) ──────────────────────────────────────
/** Writes IdHAL_i (and the slug if the Annuaire only held the numeric id) for the verified records. */
async function applyVerifyWrites(cache, all) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const updates = [];
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.mode !== 'verify' || entry.status !== 'checked' || entry.written) continue;
    const p = byKey.get(key);
    if (!p) continue;
    const fields = {};
    for (const pr of entry.proposals || []) {
      if (pr.field === 'IdHAL_i' && !String(p.idhalI || '').trim()) fields.IdHAL_i = String(pr.after);
      if (pr.field === 'IdHAL' && /^\d+$/.test(String(p.idhal || '').trim())) fields.IdHAL = pr.after;
    }
    if (Object.keys(fields).length) updates.push({ key, recId: p.recId, fields });
  }
  if (!updates.length) return { updated: 0, planned: 0 };
  if (!PUSH_GRIST) {
    console.log(`[hal] DRY-RUN: ${updates.length} record(s) would receive IdHAL_i (e.g. ${updates.slice(0, 3).map((u) => `${u.key}→${u.fields.IdHAL_i || u.fields.IdHAL}`).join(', ')})`);
    return { updated: 0, planned: updates.length };
  }
  // Re-read right before writing: freshest possible Data_source / Commentaires, and each field is
  // revalidated individually (IdHAL_i still empty, IdHAL still numeric) —
  // not only IdHAL_i as before, otherwise a human correction of IdHAL during the run is
  // overwritten by the value derived from the stale number (review lot 4, finding 6).
  const fresh = new Map((await common.fetchAnnuaire()).map((p) => [p.recId, p]));
  const writtenFieldsByRecId = new Map();
  const records = updates
    .map((u) => {
      const f = fresh.get(u.recId);
      if (!f) return null;
      const fields = {};
      if (u.fields.IdHAL_i && !String(f.idhalI || '').trim()) fields.IdHAL_i = u.fields.IdHAL_i;
      if (u.fields.IdHAL && /^\d+$/.test(String(f.idhal || '').trim())) fields.IdHAL = u.fields.IdHAL;
      if (!Object.keys(fields).length) return null;
      writtenFieldsByRecId.set(u.recId, Object.keys(fields));
      return { id: u.recId, fields: withTrace(SOURCE, f, fields, 'vérification') };
    })
    .filter(Boolean);
  const n = await gristPatchGrouped('Annuaire', records);
  for (const u of updates) if (writtenFieldsByRecId.has(u.recId)) cache[u.key].written = writtenFieldsByRecId.get(u.recId);
  return { updated: n, planned: updates.length };
}

// Export of the pure functions (tests; main only runs when invoked directly).
module.exports = {
  extractIdhal, extractOrcid, groupByIdhal, bestNameMatch, scoreCandidate, buildReviewRows, buildHalReviewColumns,
  byIdhal, byOrcid,   // AureHal client reused by sync_orcid.cjs (pass 0: IdHAL → ORCID)
  SITE_DOMAINS, SITE_STRUCT_PATTERNS,
};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cache = loadCache();
  console.log(`[hal] mode=${MODE} concurrency=${CONCURRENCY}${PUSH_GRIST ? '' : ' (dry run: no Grist write)'}`);

  const all = await common.fetchAnnuaire();
  const sel = MODE === 'push' ? { eligible: [], targets: [] } : selectTargets('hal', all, cache, { mode: MODE, labo: LABO_FILTER, group: GROUP_FILTER, force: FORCE, limit: LIMIT, record: OPTS.record });
  let targets = sel.targets;
  const eligible = sel.eligible.length;

  console.log(`[hal] ${all.length} Annuaire records, ${eligible} eligible (${MODE}${LABO_FILTER ? `, labo ${LABO_FILTER}` : ''}${GROUP_FILTER ? `, group ${GROUP_FILTER}` : ''}), ${targets.length} to process${FORCE ? ' (force)' : ''}.`);
  const counts = { found: 0, ambiguous: 0, not_found: 0, error: 0, checked: 0, not_found_hal: 0, nameMismatch: 0 };
  const progress = (running, extra = {}) => writeProgress({ running, mode: MODE, total: targets.length, done: 0, ...counts, startedAt: today(), ...extra });
  progress(true);

  let done = 0;
  await runPool(targets, async (p) => {
    const entry = MODE === 'verify' ? await verifyPerson(p) : await alignPerson(p);
    if (MODE === 'verify' && cache[p.key]?.written && cache[p.key].idhalI === entry.idhalI) entry.written = cache[p.key].written;
    cache[p.key] = entry;
    if (counts[entry.status] !== undefined) counts[entry.status]++;
    if (entry.nameMismatch) counts.nameMismatch++;
  }, CONCURRENCY, (n) => {
    done = n;
    if (n % 10 === 0 || n === targets.length) {
      writeProgress({ running: true, mode: MODE, total: targets.length, done: n, ...counts, startedAt: today() });
      console.log(`[hal] ${n}/${targets.length}`);
    }
  }, { stoppable: true });   // « Stop » button: records in progress finish, the rest is left for the next run
  writeCache(cache);

  let push = null;
  let writes = null;
  // Push into Alignement_HAL only on explicit request (push mode): validation is done
  // in Druid, the table now only serves as a blacklist — decision of 2026-09-21.
  if (MODE === 'push') {
    const rejected = await loadRejected(REVIEW_TABLE, 'IdHAL_candidat', extractIdhal);
    const { desired, found, ambiguous } = buildReviewRows(cache, all, rejected);
    console.log(`[hal] Suggestions: ${found} found, ${ambiguous} ambiguous → ${desired.size} review row(s) (${rejected.size} known rejections).`);
    if (PUSH_GRIST) {
      try {
        push = await pushReview({
          table: REVIEW_TABLE, columns: buildHalReviewColumns(), desired, targetField: 'IdHAL',
          keyOf: (rec) => `${rec.fields.uid_dyna || ''}::${extractIdhal(rec.fields.IdHAL_candidat)}`,
        });
        console.log(`[hal] Grist review: +${push.created} created, ${push.refreshed} refreshed, ${push.skipped} already decided, ${push.purged} purged${push.tableCreated ? ' (table created)' : ''}.`);
      } catch (e) {
        console.error('[hal] Grist push ERROR (local cache kept)', e);
        push = { error: e.message };
      }
    }
  } else if (MODE === 'verify') {
    try {
      writes = await applyVerifyWrites(cache, all);
      if (writes.updated) { writeCache(cache); console.log(`[hal] IdHAL_i written to ${writes.updated} Annuaire record(s).`); }
    } catch (e) {
      console.error('[hal] Annuaire write ERROR', e);
      writes = { error: e.message };
    }
  }

  writeProgress({ running: false, mode: MODE, total: targets.length, done, ...counts, push, writes, finishedAt: new Date().toISOString() });
  console.log(`[hal] Done. ${JSON.stringify(counts)}. Cache: ${store.cachePath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[hal] ERROR', e);
    writeProgress({ running: false, mode: MODE, error: e.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });
}
