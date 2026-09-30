/**
 * sync_orcid.cjs — Alignment of the Annuaire records on ORCID identifiers (public API).
 *
 * Plan: docs/archive/plan-alignement-orcid-hal.md (lot 3). Foundation: scripts/lib/align_common.cjs.
 * Same pattern as sync_hal.cjs (cache, scoring, Grist review table, Valider/Rejeter buttons).
 *
 * API (no authentication, tested on 2026-09-09; ~24 req/s max):
 *   GET https://pub.orcid.org/v3.0/expanded-search/?q=family-name:(…) AND given-names:(…)
 *       → expanded-result[] { orcid-id, given-names, family-names, credit-name, other-name[], email[], institution-name[] }
 *       ⚠ index NOT accent-insensitive → we query the original form AND the accent-stripped form;
 *         compound first names are erratic → fallback to the last name alone, filtered locally (nameMatch).
 *   GET /v3.0/{orcid}/employments         → organizations + dates (ongoing employment = no end-date)
 *   GET /v3.0/{orcid}/external-identifiers → Scopus Author ID, ResearcherID… (ID_SCOPUS cross-check)
 *   GET /v3.0/{orcid}/person              → names (verify mode)
 *   GET /v3.0/search/?q=(orcid:… OR …) AND (work-titles:* OR …) → profiles with public activity
 *       (detection of « fiches vides », see activeOrcids/isEmptyRecord; 1 request per Annuaire record)
 *
 * Modes (--mode=):
 *   search (default): records WITHOUT ORCID. Pass 0 = derivation through IdHAL (AureHal profile → orcidId_s);
 *                     search by name; scoring `fort`/`moyen`/`faible`; push into `Alignement_ORCID`.
 *   verify          : records WITH ORCID. Format check (checksum), existence, name, affiliation
 *                     (`affiliation` = `site | autre | aucune`; `suspect` = divergent name), proposes ID_SCOPUS if empty. Read-only (cache
 *                     consumed by the UI), no Annuaire write.
 *
 *   push            : no API call — pushes the cached suggestions (search mode) again into the review
 *                     table (« Envoyer en revue Grist » button of Druid, see server.cjs /api/align/:source/trigger).
 *   flag-empty      : catch-up — sets the `emptyRecord` flag on all candidates already in the cache
 *                     (/search requests in batches of 50 ORCID), without rerunning the searches.
 *
 * Options: --mode= --limit= --labo= --group=personnel|doctorants|hors_recherche --concurrency=(4)
 *           --push-grist=false (dry-run) --force (reprocesses the cached records, --labo included)
 * Cache: orcid_align_cache.json (key = uid_dyna or g<rowId>); progress: orcid_align_progress.json.
 */
const common = require('./lib/align_common.cjs');
const {
  normalize, stripAccents, extractOrcid, isValidOrcid, nameMatch, getUrl, runPool, applyTargetFilters, makeStore, today,
  gristGet, loadRejected, pushReview, DOC,
} = common;
const hal = require('./sync_hal.cjs');   // byIdhal (pass 0), extractIdhal

// ── Parameters ───────────────────────────────────────────────────────────────
const OPTS = common.commonOptions({ modes: ['search', 'verify', 'push', 'flag-empty'], concurrency: 4 });
const { mode: MODE, limit: LIMIT, labo: LABO_FILTER, group: GROUP_FILTER, concurrency: CONCURRENCY, pushGrist: PUSH_GRIST } = OPTS;
const FORCE = OPTS.force;   // a lab run is incremental too (decision D2 of 2026-09-30): --force to reprocess
const ORCID = 'https://pub.orcid.org/v3.0';
const REVIEW_TABLE = 'Alignement_ORCID';
const SOURCE = 'ORCID';
const MAX_CANDIDATES_ENRICH = 8;      // enriched candidates (employments + external-identifiers) per person
const MAX_PUSHED_CANDIDATES = 5;
const SEARCH_ROWS = 50;

const store = makeStore({ cachePath: 'orcid_align_cache.json', progressPath: 'orcid_align_progress.json' });
const { loadCache, writeCache, writeProgress } = store;

// Patterns (normalized) recognized in ORCID institution names → Nantes site affiliation.
const SITE_PATTERNS = [
  'nantes', 'imt atlantique', 'oniris', 'ifremer', 'institut de cancerologie de l ouest', 'ecole centrale de nantes',
];

// ── ORCID client ─────────────────────────────────────────────────────────────
const JSON_HEADERS = { Accept: 'application/json' };
/** GET JSON; null = network/HTTP error (404 included: distinguished by `notFound`). */
async function orcidGet(path) {
  try {
    return await getUrl(`${ORCID}${path}`, { json: true, headers: JSON_HEADERS, timeout: 15000 });
  } catch (e) {
    return e && /HTTP 404/.test(e.message) ? { notFound: true } : null;
  }
}
const quote = (v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`;
/** Forms of a name for the query: original + accent-stripped (ORCID index is accent-sensitive). */
function queryForms(v) {
  const base = String(v || '').trim();
  if (!base) return [];
  const forms = [base, stripAccents(base)];
  return [...new Set(forms)].map(quote);
}
async function expandedSearch(q) {
  const params = new URLSearchParams({ q, rows: String(SEARCH_ROWS) });
  const data = await orcidGet(`/expanded-search/?${params}`);
  if (!data || data.notFound) return null;
  return data['expanded-result'] || [];
}
/** Query last name + first name, then fallback to last name alone (filtered locally by nameMatch). */
async function searchByName(firstName, lastName) {
  const last = queryForms(lastName);
  const first = queryForms(firstName);
  if (!last.length) return { results: [], fallback: false };
  let results = first.length ? await expandedSearch(`family-name:(${last.join(' OR ')}) AND given-names:(${first.join(' OR ')})`) : [];
  if (results === null) return null;
  if (results.length) return { results, fallback: false };
  results = await expandedSearch(`family-name:(${last.join(' OR ')})`);
  if (results === null) return null;
  return { results, fallback: true };
}
const ymd = (d) => (d && d.year && d.year.value) ? d.year.value : '';
async function employments(orcid) {
  const data = await orcidGet(`/${orcid}/employments`);
  if (!data || data.notFound) return [];
  const out = [];
  for (const g of data['affiliation-group'] || []) {
    for (const s of g.summaries || []) {
      const e = s['employment-summary'] || {};
      out.push({ org: e.organization?.name || '', role: e['role-title'] || '', start: ymd(e['start-date']), end: ymd(e['end-date']) });
    }
  }
  return out;
}
async function externalIds(orcid) {
  const data = await orcidGet(`/${orcid}/external-identifiers`);
  if (!data || data.notFound) return [];
  return (data['external-identifier'] || []).map((x) => ({ type: x['external-id-type'] || '', value: x['external-id-value'] || '' }));
}
async function person(orcid) {
  const data = await orcidGet(`/${orcid}/person`);
  if (!data) return null;
  if (data.notFound) return { notFound: true };
  const n = data.name || {};
  return {
    givenNames: n['given-names']?.value || '', familyName: n['family-name']?.value || '', creditName: n['credit-name']?.value || '',
    otherNames: (data['other-names']?.['other-name'] || []).map((o) => o.content).filter(Boolean),
    emails: (data.emails?.email || []).map((e) => e.email).filter(Boolean),
  };
}

// ── Empty records ────────────────────────────────────────────────────────────
// orcid.org displays « There's no displayable data for this record » when a profile has no public
// data other than the name (no works, no employments/education, no identifiers, no keywords…). Spotting it
// in Druid saves one click per candidate. Reading /works would cost up to several MB per prolific
// profile: we query the search index instead (ONE request for all the candidates of a
// record) on the activity fields, complemented by what we already know of the profile (emails, other names).
const ACTIVITY_FIELDS = ['work-titles', 'digital-object-ids', 'funding-titles', 'affiliation-org-name', 'external-id-type-and-value', 'keyword', 'other-names'];
const ACTIVITY_CLAUSE = `(${ACTIVITY_FIELDS.map((f) => `${f}:*`).join(' OR ')})`;
const ACTIVITY_BATCH = 50;
/** Subset of `orcids` having at least one indexed public activity datum; null = network error. */
async function activeOrcids(orcids) {
  const active = new Set();
  for (let i = 0; i < orcids.length; i += ACTIVITY_BATCH) {
    const batch = orcids.slice(i, i + ACTIVITY_BATCH);
    const params = new URLSearchParams({ q: `(${batch.map((o) => `orcid:${o}`).join(' OR ')}) AND ${ACTIVITY_CLAUSE}`, rows: String(ACTIVITY_BATCH) });
    const data = await orcidGet(`/search/?${params}`);
    if (!data || data.notFound) return null;
    for (const r of data.result || []) { const id = r['orcid-identifier']?.path; if (id) active.add(id); }
  }
  return active;
}
const has = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
/** Profile with no public data other than the name (activity index + fields already known from the candidate). */
function isEmptyRecord(cand, active) {
  if (active.has(cand.orcid)) return false;
  return !has(cand.institutions) && !has(cand.employments) && !has(cand.externalIds) && !has(cand.scopus) && !has(cand.emails) && (cand.forms || []).length <= 1;
}
/** flag-empty mode: sets `emptyRecord` on all candidates of the cache (search + verify). */
async function flagEmptyRecords(cache) {
  const cands = [];
  for (const entry of Object.values(cache)) {
    if (entry.mode === 'search') cands.push(...(entry.candidates || []));
    else if (entry.mode === 'verify' && entry.candidate) cands.push(entry.candidate);
  }
  const orcids = [...new Set(cands.map((c) => c.orcid).filter(isValidOrcid))];
  const batches = [];
  for (let i = 0; i < orcids.length; i += ACTIVITY_BATCH) batches.push(orcids.slice(i, i + ACTIVITY_BATCH));
  const active = new Set();
  let failed = 0;
  await runPool(batches, async (batch) => {
    const a = await activeOrcids(batch);
    if (!a) { failed++; for (const o of batch) active.add(o); return; }   // network error: nothing is flagged as empty
    for (const o of a) active.add(o);
  }, CONCURRENCY, (n) => { if (n % 20 === 0 || n === batches.length) console.log(`[orcid] flag-empty ${n}/${batches.length} lots`); });
  let empty = 0;
  for (const c of cands) { c.emptyRecord = isEmptyRecord(c, active); if (c.emptyRecord) empty++; }
  return { candidates: cands.length, orcids: orcids.length, empty, failed };
}

// ── Labs (Structures table): acronym → long labels, to recognize ORCID affiliations ──
let LAB_NAMES = null;   // Map normalized acronym → [normalized labels]
const stripLang = (v) => String(v || '').split('|').map((x) => x.replace(/\[[a-z]{2}\]\s*$/i, '').trim()).filter(Boolean);
async function loadLabNames() {
  if (LAB_NAMES) return LAB_NAMES;
  LAB_NAMES = new Map();
  try {
    const { records } = await gristGet(`/docs/${DOC}/tables/Structures/records`);
    for (const r of records) {
      for (const short of stripLang(r.fields.short_labels)) {
        const key = normalize(short);
        if (!key) continue;
        const longs = stripLang(r.fields.long_labels).map(normalize).filter((x) => x.length > 8);
        LAB_NAMES.set(key, [...(LAB_NAMES.get(key) || []), ...longs]);
      }
    }
  } catch (e) { console.warn('[orcid] Structures table unreadable: lab matching by acronym only'); }
  return LAB_NAMES;
}

// ── Candidates ───────────────────────────────────────────────────────────────
function toCandidate(r) {
  const given = r['given-names'] || '';
  const family = r['family-names'] || '';
  const forms = [`${given} ${family}`.trim(), r['credit-name'] || '', ...(r['other-name'] || [])].filter(Boolean);
  return {
    orcid: r['orcid-id'], fullName: forms[0] || r['orcid-id'], forms: [...new Set(forms)],
    emails: (r.email || []).map((e) => String(e).toLowerCase()), institutions: [...new Set(r['institution-name'] || [])],
    employments: [], externalIds: [], viaIdhal: '',
  };
}
function bestNameMatch(p, cand) {
  let best = null;
  for (const f of cand.forms) {
    const m = nameMatch(p.first, p.last, f);
    if (m === 'exact') return 'exact';
    if (m === 'partial') best = 'partial';
  }
  return best;
}
const scopusOf = (cand) => (cand.externalIds.find((x) => /scopus/i.test(x.type)) || {}).value || '';
const digits = (v) => String(v || '').replace(/\D/g, '');

/** Does an ORCID organization match the Nantes site / the record's lab? */
function orgMatches(orgName, labo, labNames) {
  const n = normalize(orgName);
  if (!n) return null;
  const sigle = normalize(labo);
  if (sigle && (n === sigle || n.split(' ').includes(sigle))) return `labo ${labo}`;
  if (sigle && (labNames.get(sigle) || []).some((l) => n.includes(l))) return `labo ${labo}`;
  if (SITE_PATTERNS.some((pat) => n.includes(pat))) return `site (${orgName})`;
  return null;
}

/**
 * Scoring (§1 of the plan):
 *   `fort`   = cross identifier (Scopus = ID_SCOPUS, email = Annuaire Email, ORCID of the record's HAL profile);
 *   `moyen`  = Nantes affiliation / record's lab in the institutions or employments;
 *   `faible` = homonym without evidence. Cross identifier but divergent name → `moyen`.
 */
function scoreCandidate(p, cand, labNames) {
  const evidence = [];
  const matchedIds = [];
  const scopus = scopusOf(cand);
  if (scopus && digits(scopus) && digits(scopus) === digits(p.scopus)) { matchedIds.push('ID_SCOPUS'); evidence.push(`Scopus identique (${scopus})`); }
  const email = String(p.email || '').trim().toLowerCase();
  if (email && cand.emails.includes(email)) { matchedIds.push('Email'); evidence.push(`email identique (${email})`); }
  if (cand.viaIdhal) { matchedIds.push('IdHAL'); evidence.push(`ORCID du profil HAL ${cand.viaIdhal}`); }

  let site = false;
  const seen = new Set();
  for (const org of cand.institutions) {
    const m = orgMatches(org, p.labo, labNames);
    if (m && !seen.has(m)) { site = true; seen.add(m); evidence.push(m); }
  }
  for (const e of cand.employments) {
    const m = orgMatches(e.org, p.labo, labNames);
    if (m && !seen.has(m)) { site = true; seen.add(m); evidence.push(`${m}${e.end ? '' : ', en cours'}`); }
  }
  const name = bestNameMatch(p, cand);
  if (name === 'partial') evidence.push('nom partiel');
  if (!name) evidence.push('nom divergent');

  let score = 'faible';
  if (matchedIds.length) score = name ? 'fort' : 'moyen';
  else if (site && name) score = 'moyen';
  return { score, evidence, matchedIds, nameMatch: name };
}
const RANK = { fort: 0, moyen: 1, faible: 2 };
const empSummary = (cand) => cand.employments.slice(0, 6).map((e) => `${e.org}${e.role ? ` – ${e.role}` : ''} (${e.start || '?'}–${e.end || 'en cours'})`);

/** Search + scoring for a record without ORCID. */
async function alignPerson(p, labNames) {
  const queryName = `${p.first} ${p.last}`.trim();
  const derivedFrom = [];
  let netError = false;
  const byOrcid = new Map();

  // Pass 0: the record's HAL profile → orcidId_s.
  const idhal = hal.extractIdhal(p.idhal);
  if (idhal) {
    const docs = await hal.byIdhal(idhal);
    if (docs === null) netError = true;
    else {
      const orcids = [...new Set(docs.flatMap((d) => (Array.isArray(d.orcidId_s) ? d.orcidId_s : [d.orcidId_s]).map(extractOrcid).filter(Boolean)))];
      if (orcids.length) derivedFrom.push('IdHAL');
      for (const o of orcids) {
        const r = await expandedSearch(`orcid:${o}`);
        if (r === null) { netError = true; continue; }
        const c = r.length ? toCandidate(r[0]) : { orcid: o, fullName: o, forms: [], emails: [], institutions: [], employments: [], externalIds: [], viaIdhal: '' };
        c.viaIdhal = idhal;
        byOrcid.set(o, c);
      }
    }
  }

  // Search by name.
  const found = await searchByName(p.first, p.last);
  if (found === null) netError = true;
  else {
    for (const r of found.results) {
      const c = toCandidate(r);
      if (byOrcid.has(c.orcid)) continue;
      if (!bestNameMatch(p, c)) continue;   // name filter (essential with the last-name-only fallback)
      byOrcid.set(c.orcid, c);
    }
  }

  // Enrichment (employments + external identifiers) of the first candidates, detection of empty
  // profiles (one request for the whole record), then scoring.
  const cands = [...byOrcid.values()];
  for (const [i, cand] of cands.entries()) {
    if (i < MAX_CANDIDATES_ENRICH) {
      cand.employments = await employments(cand.orcid);
      cand.externalIds = await externalIds(cand.orcid);
    }
  }
  const active = cands.length ? await activeOrcids(cands.map((c) => c.orcid)) : new Set();
  const scored = [];
  for (const [i, cand] of cands.entries()) {
    const s = scoreCandidate(p, cand, labNames);
    scored.push({
      orcid: cand.orcid, fullName: cand.fullName, forms: cand.forms, institutions: cand.institutions,
      employments: empSummary(cand), emails: cand.emails, scopus: scopusOf(cand), viaIdhal: cand.viaIdhal,
      score: s.score, evidence: i < MAX_CANDIDATES_ENRICH ? s.evidence : [...s.evidence, 'non enrichi'], matchedIds: s.matchedIds, nameMatch: s.nameMatch,
      ...(active ? { emptyRecord: isEmptyRecord(cand, active) } : {}),   // absent = undetermined (network error)
    });
  }
  scored.sort((a, b) => RANK[a.score] - RANK[b.score] || (a.emptyRecord ? 1 : 0) - (b.emptyRecord ? 1 : 0) || b.institutions.length - a.institutions.length);

  const strong = scored.filter((c) => c.score === 'fort');
  const medium = scored.filter((c) => c.score === 'moyen');
  let status, best = '';
  if (!scored.length) status = netError ? 'error' : 'not_found';
  else if (strong.length === 1) { status = 'found'; best = strong[0].orcid; }
  else if (!strong.length && medium.length === 1) { status = 'found'; best = medium[0].orcid; }
  else status = 'ambiguous';
  return { mode: 'search', queryName, status, best, derivedFrom, fallback: !!found?.fallback, candidates: scored, checkedAt: today() };
}

/** Verification of a record with ORCID (read-only). */
async function verifyPerson(p, labNames) {
  const queryName = `${p.first} ${p.last}`.trim();
  const orcid = extractOrcid(p.orcid);
  if (!orcid || !isValidOrcid(orcid)) return { mode: 'verify', queryName, orcid: orcid || String(p.orcid || '').trim(), status: 'invalid', checkedAt: today() };
  // expanded-search by ORCID: names + institutions (employments AND education) in one request.
  const r = await expandedSearch(`orcid:${orcid}`);
  if (r === null) return { mode: 'verify', queryName, orcid, status: 'error', checkedAt: today() };
  let cand;
  if (r.length) cand = toCandidate(r[0]);
  else {
    // Absent from the index (deactivated record?): confirm via /person.
    const pers = await person(orcid);
    if (!pers) return { mode: 'verify', queryName, orcid, status: 'error', checkedAt: today() };
    if (pers.notFound) return { mode: 'verify', queryName, orcid, status: 'not_found_orcid', checkedAt: today() };
    cand = {
      orcid, fullName: `${pers.givenNames} ${pers.familyName}`.trim() || orcid,
      forms: [...new Set([`${pers.givenNames} ${pers.familyName}`.trim(), pers.creditName, ...pers.otherNames].filter(Boolean))],
      emails: pers.emails.map((e) => e.toLowerCase()), institutions: [], employments: [], externalIds: [], viaIdhal: '',
    };
  }
  cand.employments = await employments(orcid);
  cand.externalIds = await externalIds(orcid);
  const active = await activeOrcids([orcid]);
  const s = scoreCandidate(p, cand, labNames);
  const siteAffiliation = s.evidence.some((e) => e.startsWith('labo ') || e.startsWith('site ('));
  const affiliation = siteAffiliation ? 'site' : (cand.institutions.length || cand.employments.length) ? 'autre' : 'aucune';
  const proposals = [];
  const scopus = scopusOf(cand);
  if (scopus && !String(p.scopus || '').trim()) proposals.push({ field: 'ID_SCOPUS', after: scopus });
  return {
    mode: 'verify', queryName, orcid, status: 'checked', nameMismatch: !s.nameMatch, nameMatch: s.nameMatch,
    affiliation, siteAffiliation, suspect: !s.nameMatch,
    candidate: {
      orcid, fullName: cand.fullName, forms: cand.forms, institutions: cand.institutions, employments: empSummary(cand), emails: cand.emails, scopus, evidence: s.evidence, matchedIds: s.matchedIds,
      ...(active ? { emptyRecord: isEmptyRecord(cand, active) } : {}),
    },
    proposals, checkedAt: today(),
  };
}

// ── Collaborative Grist review (Alignement_ORCID table) ──────────────────────
function buildOrcidReviewColumns() {
  const validerFormula = [
    `if $Decision == "Validé":`,
    `  return {"button": "Validé ✓", "description": "Déjà appliqué%s" % ((" le " + $Date_application) if $Date_application else ""), "actions": []}`,
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `ann = Annuaire.lookupOne(id=$Annuaire_id) if $Annuaire_id else Annuaire.lookupOne(uid_dyna=$uid_dyna)`,
    `if not ann:`,
    `  return {"button": "Fiche introuvable", "description": "Aucune fiche Annuaire pour %s" % $uid_dyna, "actions": []}`,
    `import re`,
    `def _orcid(v):`,
    `  m = re.search(r"(\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dXx])", str(v or ""))`,
    `  return m.group(1).upper() if m else ""`,
    `fields = {}`,
    `done = []`,
    `cur = _orcid(ann.ORCID)`,
    `cand = _orcid($ORCID_candidat)`,
    `if not cur:`,
    `  fields["ORCID"] = cand`,
    `  done.append("ORCID")`,
    `elif cur != cand:`,
    `  return {"button": "Conflit ORCID", "description": "L'Annuaire contient déjà l'ORCID %s (différent de %s) : à régler dans Druid" % (cur, cand), "actions": []}`,
    `if str($Scopus_candidat or "").strip() and not str(ann.ID_SCOPUS or "").strip():`,
    `  fields["ID_SCOPUS"] = str($Scopus_candidat).strip()`,
    `  done.append("ID_SCOPUS")`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `actions = []`,
    `if fields:`,
    `  src = str(ann.Data_source or "")`,
    `  parts = [s.strip().upper() for s in re.split(r"[|,]", src) if s.strip()]`,
    `  if "${SOURCE}" not in parts:`,
    `    fields["Data_source"] = (src + "|${SOURCE}") if src else "${SOURCE}"`,
    `  fields["${SOURCE}_derniere_maj"] = today`,
    `  fields["${SOURCE}_champs_modifies"] = "|".join(done)`,
    `  note = "[%s] MAJ ${SOURCE} (revue Grist): %s" % (today, ", ".join(done))`,
    `  com = str(ann.Commentaires or "")`,
    `  fields["Commentaires"] = (com + "\\n" + note) if com else note`,
    `  actions.append(["UpdateRecord", "Annuaire", ann.id, fields])`,
    `actions.append(["UpdateRecord", "${REVIEW_TABLE}", $id, {"Decision": "Validé", "Applique": True, "Date_application": today}])`,
    `for sib in ${REVIEW_TABLE}.lookupRecords(uid_dyna=$uid_dyna):`,
    `  if sib.id != $id and sib.Decision == "À traiter":`,
    `    actions.append(["UpdateRecord", "${REVIEW_TABLE}", sib.id, {"Decision": "Rejeté", "Date_application": today}])`,
    `label = ("Valider " + " + ".join(done)) if done else "Valider (rien à écrire)"`,
    `return {"button": label, "description": "%s -> ORCID %s" % ($Nom_annuaire, cand), "actions": actions}`,
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
    text('ORCID_candidat', 'ORCID candidat'),
    {
      id: 'Lien_ORCID',
      fields: {
        label: 'Lien ORCID', type: 'Text', isFormula: true,
        formula: `"https://orcid.org/" + str($ORCID_candidat or "")`,
        widgetOptions: JSON.stringify({ widget: 'HyperLink' }),
      },
    },
    text('Nom_profil', 'Nom profil ORCID'),
    text('Autres_noms', 'Autres noms'),
    text('Score', 'Score'),
    text('Preuves', 'Preuves'),
    text('Affiliations', 'Affiliations (ORCID)'),
    text('Emplois', 'Emplois'),
    text('Emails', 'Emails publics'),
    text('Scopus_candidat', 'Scopus candidat'),
    ...common.reviewDecisionColumns(REVIEW_TABLE),   // Decision (4 values), Note, Signale_le, Meler_action
    { id: 'Applique', fields: { label: 'Appliqué', type: 'Bool' } },
    text('Date_application', 'Date application'),
    text('Pousse_le', 'Poussé le'),
    { id: 'Valider_action', fields: { label: 'Valider (action)', type: 'Any', isFormula: true, formula: validerFormula } },
    { id: 'Rejeter_action', fields: { label: 'Rejeter (action)', type: 'Any', isFormula: true, formula: rejeterFormula } },
  ];
}

function buildReviewRows(cache, all, rejected) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const desired = new Map();
  const row = (p, entry, nb, c) => ({
    uid_dyna: p.key, Annuaire_id: p.recId, Nom_annuaire: entry.queryName || `${p.first} ${p.last}`.trim(), LABO: p.labo || '',
    Nb_candidats: nb, ORCID_candidat: c.orcid, Nom_profil: c.fullName || '', Autres_noms: (c.forms || []).slice(1).join(' | '),
    Score: c.score, Preuves: [...(c.evidence || []), ...(c.emptyRecord ? ['fiche ORCID vide'] : [])].join(' ; '), Affiliations: (c.institutions || []).join(' ; '),
    Emplois: (c.employments || []).join(' ; '), Emails: (c.emails || []).join(', '), Scopus_candidat: c.scopus || '',
  });
  let found = 0, ambiguous = 0;
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.mode !== 'search') continue;
    const p = byKey.get(key);
    if (!p || extractOrcid(p.orcid)) continue;
    const cands = (entry.candidates || []).filter((c) => !rejected.has(`${key}::${c.orcid}`));
    if (!cands.length) continue;
    if (entry.status === 'found' && cands.some((c) => c.orcid === entry.best)) {
      const c = cands.find((x) => x.orcid === entry.best);
      desired.set(`${key}::${c.orcid}`, row(p, entry, 1, c));
      found++;
    } else {
      const top = cands.slice(0, MAX_PUSHED_CANDIDATES);
      for (const c of top) desired.set(`${key}::${c.orcid}`, row(p, entry, top.length, c));
      ambiguous++;
    }
  }
  return { desired, found, ambiguous };
}

module.exports = { queryForms, toCandidate, bestNameMatch, orgMatches, scoreCandidate, isEmptyRecord, buildReviewRows, buildOrcidReviewColumns, SITE_PATTERNS };

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cache = loadCache();
  console.log(`[orcid] mode=${MODE} concurrency=${CONCURRENCY}${PUSH_GRIST ? '' : ' (dry run: no Grist write)'}`);
  if (MODE === 'flag-empty') {
    // Catch-up outside the UI progress (touches neither the Annuaire nor orcid_align_progress.json).
    const r = await flagEmptyRecords(cache);
    writeCache(cache);
    console.log(`[orcid] flag-empty: ${r.candidates} candidates, ${r.orcids} distinct ORCIDs, ${r.empty} empty profiles${r.failed ? `, ${r.failed} batch(es) in network error (left non-empty)` : ''}. Cache: ${store.cachePath}`);
    return;
  }

  const all = await common.fetchAnnuaire();
  const labNames = await loadLabNames();
  let targets = MODE === 'push' ? [] : all.filter((p) => p.first || p.last);
  if (MODE === 'verify') targets = targets.filter((p) => String(p.orcid || '').trim());
  else targets = targets.filter((p) => !String(p.orcid || '').trim());
  targets = applyTargetFilters(targets, { labo: LABO_FILTER, group: GROUP_FILTER });
  const eligible = targets.length;
  if (!FORCE) targets = targets.filter((p) => !cache[p.key] || cache[p.key].mode !== MODE || cache[p.key].status === 'error');
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  console.log(`[orcid] ${all.length} Annuaire records, ${eligible} eligible (${MODE}${LABO_FILTER ? `, labo ${LABO_FILTER}` : ''}${GROUP_FILTER ? `, group ${GROUP_FILTER}` : ''}), ${targets.length} to process${FORCE ? ' (force)' : ''}.`);
  const counts = { found: 0, ambiguous: 0, not_found: 0, error: 0, checked: 0, not_found_orcid: 0, invalid: 0, nameMismatch: 0, sansAffiliation: 0 };
  writeProgress({ running: true, mode: MODE, total: targets.length, done: 0, ...counts, startedAt: today() });

  let done = 0;
  await runPool(targets, async (p) => {
    const entry = MODE === 'verify' ? await verifyPerson(p, labNames) : await alignPerson(p, labNames);
    cache[p.key] = entry;
    if (counts[entry.status] !== undefined) counts[entry.status]++;
    if (entry.nameMismatch) counts.nameMismatch++;
    if (entry.affiliation === 'aucune') counts.sansAffiliation++;
  }, CONCURRENCY, (n) => {
    done = n;
    if (n % 10 === 0 || n === targets.length) {
      writeProgress({ running: true, mode: MODE, total: targets.length, done: n, ...counts, startedAt: today() });
      console.log(`[orcid] ${n}/${targets.length}`);
    }
  }, { stoppable: true });   // « Stop » button: records in progress finish, the rest is left for the next run
  writeCache(cache);

  let push = null;
  // Push into Alignement_ORCID only on explicit request (push mode): validation is done
  // in Druid, the table now only serves as a blacklist (« Rejeté » / « Identité mêlée ») — decision of
  // 2026-09-21, see docs/plan-alignement-unifie.md lot 6.
  if (MODE === 'push') {
    const rejected = await loadRejected(REVIEW_TABLE, 'ORCID_candidat', extractOrcid);
    const { desired, found, ambiguous } = buildReviewRows(cache, all, rejected);
    console.log(`[orcid] Suggestions: ${found} found, ${ambiguous} ambiguous → ${desired.size} review row(s) (${rejected.size} known rejections).`);
    if (PUSH_GRIST) {
      try {
        push = await pushReview({
          table: REVIEW_TABLE, columns: buildOrcidReviewColumns(), desired, targetField: 'ORCID',
          keyOf: (rec) => `${rec.fields.uid_dyna || ''}::${extractOrcid(rec.fields.ORCID_candidat)}`,
        });
        console.log(`[orcid] Grist review: +${push.created} created, ${push.refreshed} refreshed, ${push.skipped} already decided, ${push.purged} purged${push.tableCreated ? ' (table created)' : ''}.`);
      } catch (e) {
        console.error('[orcid] Grist push ERROR (local cache kept)', e);
        push = { error: e.message };
      }
    }
  }

  writeProgress({ running: false, mode: MODE, total: targets.length, done, ...counts, push, finishedAt: new Date().toISOString() });
  console.log(`[orcid] Done. ${JSON.stringify(counts)}. Cache: ${store.cachePath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[orcid] ERROR', e);
    writeProgress({ running: false, mode: MODE, error: e.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });
}
