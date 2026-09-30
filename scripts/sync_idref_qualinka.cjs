/**
 * sync_idref_qualinka.cjs — Qualinka « align » stage for the IdRef sync (mode
 * `--mode=align`, alternative to sync_idref.cjs --mode=search for the same need).
 *
 * Does NOT overwrite the cache of sync_idref.cjs (idref_align_cache.json): writes to
 * idref_align_qualinka_cache.json. Availability driven by the HAS_QUALINKA
 * capability (docs/plan-architecture-multi-instances.md, lot 4 —
 * docs/archive/plan-fusion-centrale-2026-09.md § 3 sub-lot 3): without a configured Neo4j,
 * the IdRef alignment remains available through sync_idref.cjs (Solr, no publication
 * context). Shares its foundation (HTTP/retry, pool, Grist, cache/progress,
 * push to a review table) with sync_idref.cjs via scripts/lib/align_common.cjs
 * rather than duplicating it (debt identified by docs/archive/lot0-inventaire-derive-2026-09-18.md).
 *
 * Idea: replace the « tout-ou-rien » disambiguation of sync_idref.cjs
 * (0 candidates → not_found, 1 → found, ≥2 → ambiguous handed back to a human) with a
 * scoring stage inspired by the smartbiblia skill `resolve-authorities-idref`:
 *
 *   1. find-ra-idref  → PPN candidates (handles variants/homonyms, better than raw Solr)
 *   2. attrra         → disambiguation evidence (preferedform, variantform, bioNote, source)
 *   3. references     → linked records (OPTIONAL, --refs; 1 more HTTP call per candidate)
 *   4. weighted score → accepted / ambiguous / low_confidence / not_found
 *
 * attrra does NOT return the 035 identifiers (ORCID/IdHAL): for a retained candidate, we
 * fall back to the XML authority record fetch of sync_idref.cjs (getNotice/getIdentifiers) to enrich.
 *
 * Endpoints (tested reachable through the FortiGate proxy AND directly, 2026-06-20):
 *   GET https://qualinka.idref.fr/data/find-ra-idref/api/v2/debug/req?lastName=&firstName=
 *   GET https://qualinka.idref.fr/data/attrra/api/v2/req?ra_id={ppn}
 *   GET https://www.idref.fr/services/references/{ppn}.json
 *
 * Usage:
 *   # Single-person demo (no Grist needed):
 *   node sync_idref_qualinka.cjs --name="Bruno Latour" --affiliation="sociologie Sciences Po médialab"
 *   node sync_idref_qualinka.cjs --last=Latour --first=Bruno --field="philosophie" --refs
 *   # Batch on the Grist Annuaire (records without IdRef):
 *   node sync_idref_qualinka.cjs --mode=search --limit=20
 *
 * At the end of the run (batch mode only), also pushes its suggestions (accepted → aRenseigner,
 * ambiguous/low_confidence → ambigus) into the collaborative Grist table `Alignement_IdRef`
 * (port of GristService.pushIdrefReview / computeIdrefAlignDiff, see docs/revue-idref-grist.md):
 * they remain viewable/validatable by colleagues even if nobody opened the Druid
 * « Alignement IdRef » page to click « Envoyer en revue Grist ». Can be disabled with
 * --push-grist=false (dry-run/debug).
 */
const fs = require('fs');
const common = require('./lib/align_common.cjs');   // shared foundation: HTTP/retry, pool, Grist, cache/progress, review
const { getArg, hasFlag, getUrl, runPool, gristGet, gristWrite, normalize, extractPpn, makeStore } = common;

// fast-xml-parser is only required for the identifier enrichment (XML authority record).
// Lazily loaded so that the --name demo works without node_modules.
let parser = null;
function getParser() {
  if (parser) return parser;
  const { XMLParser } = require('fast-xml-parser');
  parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, parseTagValue: false, parseAttributeValue: false });
  return parser;
}

// ── Parameters ───────────────────────────────────────────────────────────────
const MODE = (getArg('mode', 'search') || 'search').toLowerCase();
const LIMIT = parseInt(getArg('limit', '0'), 10) || 0;   // 0 = no limit (processes everything)
const FORCE = hasFlag('force');                          // --force: reprocesses even the records already in the cache
const LABO_FILTER = (getArg('labo', '') || '').trim().toUpperCase(); // `--labo=SIGLE`: only processes this lab (`LABO` column)
// --group=personnel|doctorants|hors_recherche: scopes the active tab of the Alignement IdRef page.
// « doctorants » = TYPE_EMPLOI=DOCTORANT (LIB_TYPE_EMPLOI is NOT reliable for this sort: empty for
// almost all PhD students in the Nantes Annuaire, checked 2026-09-07); « hors_recherche » = HR label
// « Personnel [non] titulaire n'ayant pas d'obligation statutaire de recherche »; « personnel » = the rest.
// Same logic as alignGroupOf in scripts/lib/align_common.cjs and lib/gristService.ts.
const GROUP_FILTER = (getArg('group', '') || '').trim().toLowerCase();
const isDoctorantEmployment = (p) => String(p.typeEmploi || '').trim().toUpperCase() === 'DOCTORANT';
const isHorsRechercheEmployment = (p) => /n'ayant pas d'obligation statutaire de recherche/i.test(String(p.libTypeEmploi || '').replace(/[’‘]/g, "'"));
const alignGroupOf = (p) => (isDoctorantEmployment(p) ? 'doctorants' : isHorsRechercheEmployment(p) ? 'hors_recherche' : 'personnel');
const CONCURRENCY = parseInt(getArg('concurrency', '4'), 10) || 4;
const USE_REFS = hasFlag('refs');           // enables the references call (expensive)
const USE_NEO4J = hasFlag('neo4j');         // context = publication titles (Neo4j)
const USE_LABOS = hasFlag('labos');         // context = lab description (Grist Structures)
const LABOS_FILE = getArg('labosfile', ''); // JSON override {CODE_LABO: "description"} (demo/complement)
// --push-grist=false: computes the diff without writing to Alignement_IdRef (debug/dry-run).
// Defaults to true: the run pushes its suggestions directly into Grist (batch mode
// only), so as not to depend on an open Druid session to transfer them there.
// Push into Alignement_IdRef disabled by default (--push-grist=true to force): validation
// is done in Druid, the table now only serves as a blacklist — decision of 2026-09-21.
const PUSH_GRIST = (getArg('push-grist', 'false') || 'false').toLowerCase() === 'true';

// Thresholds taken from the skill (align-person)
const ACCEPT_THRESHOLD = parseFloat(getArg('accept', '0.60'));
const MARGIN_THRESHOLD = parseFloat(getArg('margin', '0.08'));
// NAME coverage thresholds (calibrated on a Nantes Annuaire sample, 2026-06-20):
//   >= NAME_MIN  → « exact » name match (= exact-name filter of sync_idref.cjs)
//   [NAME_NEAR, NAME_MIN) → probable variant (spelling, abbreviated first name) → to arbitrate
const NAME_MIN = parseFloat(getArg('namemin', '0.999'));
const NAME_NEAR = parseFloat(getArg('namenear', '0.5'));
// Cap on attrra calls per person: very common names (« Michel Morin » → 47 PPN)
// remain ambiguous whatever happens; no point probing the whole list.
const MAX_CANDIDATES = parseInt(getArg('maxcand', '20'), 10) || 20;
// A candidate whose authority record indicates a death before this year is discarded outright (obvious
// bad candidate: the researchers looked up are current staff/PhD students) — never
// proposed, even as ambiguous. Only a reliable year (exactly 4 digits); approximate IdRef
// dates ("19XX", "17..") are ignored by this filter rather than wrongly rejected.
const DEATH_MIN_YEAR = parseInt(getArg('deathmin', '2015'), 10) || 2015;
function candidateDeathYear(death) {
  const m = /^(\d{4})$/.exec(String(death || '').trim());
  return m ? parseInt(m[1], 10) : null;
}

// Weights from the skill: 0.40 name + 0.25 source + 0.15 notes + 0.15 references + 0.05 context.
// Dynamically renormalized over the computable components only (see score()).
const WEIGHTS = { name: 0.40, source: 0.25, notes: 0.15, refs: 0.15, context: 0.05 };

const QUALINKA = 'https://qualinka.idref.fr/data';
const { GRIST_BASE, DOC, KEY } = common;

// Cache/progress: common foundation (align_common.cjs::makeStore) — progress path
// overridable (--progress=) so that the Druid server reuses the file the UI
// already polls (/api/sync-idref-progress).
const store = makeStore({ cachePath: 'idref_align_qualinka_cache.json', progressPath: 'idref_align_qualinka_progress.json' });

// ── Text helpers specific to the Qualinka scoring (normalize/extractPpn: common foundation) ──
// Token ⊂ stop-words discarded (IdRef preferred-form qualifiers, years, etc.)
const STOP = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'et', 'en', 'ne', 'ai', 'sur', 'au', 'aux']);
function tokens(s) {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t) && !/^\d{2,4}$/.test(t));
}
// Dice on token sets: 2|A∩B| / (|A|+|B|)  ∈ [0,1]
function dice(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return (2 * inter) / (aSet.size + bSet.size);
}
// Coverage rate of the query tokens present in the target text ∈ [0,1]
function coverage(queryTokens, targetSet) {
  if (!queryTokens.length) return 0;
  let hit = 0;
  for (const t of queryTokens) if (targetSet.has(t)) hit++;
  return hit / queryTokens.length;
}

// ── Qualinka / IdRef client ──────────────────────────────────────────────────
async function findRaIdref(lastName, firstName) {
  const params = new URLSearchParams({ lastName: lastName || '' });
  if (firstName) params.set('firstName', firstName);
  let blocks;
  try { blocks = await getUrl(`${QUALINKA}/find-ra-idref/api/v2/debug/req?${params}`, { json: true }); }
  catch (e) { return []; }
  // Response = list of blocks {found, results:[{ppn,firstName,lastName}]}. PPNs are deduplicated.
  const seen = new Set(); const out = [];
  for (const b of [].concat(blocks || [])) {
    for (const r of (b && b.results) || []) {
      const ppn = extractPpn(r.ppn);
      if (ppn && !seen.has(ppn)) { seen.add(ppn); out.push({ ppn, firstName: r.firstName || '', lastName: r.lastName || '' }); }
    }
  }
  return out;
}

async function attrra(ppn) {
  try {
    const d = await getUrl(`${QUALINKA}/attrra/api/v2/req?ra_id=${encodeURIComponent(ppn)}`, { json: true });
    if (!d || !d.id) return null;
    const prefered = (d.preferedform || []).map((p) => p.value || '').filter(Boolean);
    return {
      ppn: String(d.id),
      prefered,
      variants: [].concat(d.variantform || []),
      bioNote: [].concat(d.bioNote || []),
      source: [].concat(d.source || []),
      birth: d.birth || '', death: d.death || '',
      gender: d.gender === 'aa' ? 'F' : d.gender === 'ba' ? 'M' : null,
      country: d.country || '',
    };
  } catch (e) { return null; }
}

async function references(ppn) {
  try {
    const d = await getUrl(`https://www.idref.fr/services/references/${encodeURIComponent(ppn)}.json`, { json: true });
    // tolerant structure: we flatten every record text found
    const texts = [];
    const walk = (n) => {
      if (!n) return;
      if (typeof n === 'string') { texts.push(n); return; }
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (typeof n === 'object') Object.values(n).forEach(walk);
    };
    walk(d);
    return texts.join(' ').slice(0, 4000);
  } catch (e) { return ''; }
}

// ── Enriched context: publication titles (Neo4j) + lab description (Grist) ──
const NEO4J_URL = process.env.NEO4J_HTTP_URL || 'http://localhost:7474';
// No default password: NEO4J_PASSWORD comes from the environment (druid.yaml). Without it the graph
// answers 401 and the graph signals are skipped.
if (!process.env.NEO4J_PASSWORD) console.warn('[neo4j] NEO4J_PASSWORD is not set: the CRISalid graph will refuse the queries');
const NEO4J_AUTH = 'Basic ' + Buffer.from(`${process.env.NEO4J_USER || 'neo4j'}:${process.env.NEO4J_PASSWORD || ''}`).toString('base64');
const PUB_TITLES_K = parseInt(getArg('pubk', '8'), 10) || 8;   // max number of titles injected as context

// Preloads in ONE query the publication titles by uid_dyna (Person.uid = 'local-'+uid).
async function fetchPubTitles(uids) {
  const map = {};
  if (!uids.length) return map;
  const cypher =
    'UNWIND $uids AS uid ' +
    "MATCH (p:Person {uid: 'local-' + uid}) " +
    'OPTIONAL MATCH (p)-[:HAS_CONTRIBUTION]->(:Contribution)<-[:HAS_CONTRIBUTION]-(d:Document)-[:HAS_TITLE]->(t) ' +
    'WITH uid, collect(DISTINCT t.value)[0..$k] AS titles RETURN uid, titles';
  try {
    const r = await fetch(`${NEO4J_URL}/db/neo4j/tx/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: NEO4J_AUTH },
      body: JSON.stringify({ statements: [{ statement: cypher, parameters: { uids, k: PUB_TITLES_K } }] }),
    });
    const j = await r.json();
    for (const row of j?.results?.[0]?.data || []) {
      const [uid, titles] = row.row;
      map[uid] = (titles || []).filter(Boolean);
    }
  } catch (e) { console.error('[neo4j] indisponible:', e.message); }
  return map;
}

// Lab description from the Grist Structures table, indexed by normalized short_label.
// Concatenates descriptions + disciplinary fields (ERC/HCERES) + long label.
async function fetchLaboDesc() {
  const map = {};
  try {
    const { records } = await gristGet(`/docs/${DOC}/tables/Structures/records`);
    for (const rec of records || []) {
      const f = rec.fields || {};
      const code = String(f.short_labels || '').replace(/\[.*?\]/g, '').trim();   // "CEISAM[fr]" → "CEISAM"
      if (!code) continue;
      const txt = [f.descriptions, f.erc_research_field, f.hceres_research_areas, f.long_labels]
        .map((x) => String(x || '').replace(/\[.*?\]/g, ' ')).filter(Boolean).join(' ').trim();
      if (txt) map[code.toUpperCase()] = txt;
    }
  } catch (e) { console.error('[structures] indisponible:', e.message); }
  return map;
}

// ── Scoring ───────────────────────────────────────────────────────────────────
// query: { name, contextText }  (contextText = affiliation + field + free, concatenated)
// ev   : enriched attrra object { prefered, variants, bioNote, source, refsText? }
function scoreCandidate(query, ev) {
  const qNameTokens = tokens(query.name);
  // name: best coverage of the name tokens over the preferred/variant forms
  let nameScore = 0;
  for (const form of [...ev.prefered, ...ev.variants]) {
    nameScore = Math.max(nameScore, coverage(qNameTokens, new Set(tokens(form))));
  }

  const comps = { name: nameScore };           // present components → renormalization
  const qCtx = new Set(tokens(query.contextText || ''));
  const hasCtx = qCtx.size > 0;

  if (hasCtx) {
    // ASYMMETRIC coverage (not Dice): « what share of MY context is corroborated by
    // the candidate's evidence ». The candidate's source field = its list of works; a symmetric
    // Dice would be diluted by all its other works, whereas a single strong common title
    // (e.g. « La vie de laboratoire ») must weigh in.
    const qArr = [...qCtx];
    comps.source = coverage(qArr, new Set(tokens(ev.source.join(' '))));
    comps.notes = coverage(qArr, new Set(tokens(ev.bioNote.join(' '))));
    const evSet = new Set(tokens([...ev.prefered, ...ev.bioNote, ...ev.source].join(' ')));
    comps.context = coverage(qArr, evSet);
    if (ev.refsText !== undefined) comps.refs = coverage(qArr, new Set(tokens(ev.refsText)));
  }

  // weighted sum renormalized over the computed components only
  let num = 0, den = 0;
  for (const k of Object.keys(comps)) { num += WEIGHTS[k] * comps[k]; den += WEIGHTS[k]; }
  const score = den ? num / den : 0;
  return { score, components: comps };
}

// ── Align stage: combines find + attrra (+refs) + scoring + decision ─────────
async function alignPerson({ name, last, first, contextText }) {
  const fullName = name || `${first || ''} ${last || ''}`.trim();
  const lastName = last || fullName.split(' ').slice(-1)[0];
  const firstName = first || fullName.split(' ').slice(0, -1).join(' ');

  const foundAll = await findRaIdref(lastName, firstName);
  if (!foundAll.length) return { status: 'not_found', queryName: fullName, candidates: [] };
  const truncated = foundAll.length > MAX_CANDIDATES;
  const found = foundAll.slice(0, MAX_CANDIDATES);

  const candidates = [];
  for (const f of found) {
    const ev = await attrra(f.ppn);
    if (!ev) continue;
    const deathYear = candidateDeathYear(ev.death);
    if (deathYear !== null && deathYear < DEATH_MIN_YEAR) continue; // obvious bad candidate: deceased
    if (USE_REFS) ev.refsText = await references(f.ppn);
    const { score, components } = scoreCandidate({ name: fullName, contextText }, ev);
    candidates.push({
      ppn: ev.ppn,
      prefered: ev.prefered[0] || `${f.firstName} ${f.lastName}`.trim(),
      bioNote: ev.bioNote.join(' ; '),
      birth: ev.birth, death: ev.death, gender: ev.gender, country: ev.country,
      score: Math.round(score * 1000) / 1000,
      components,
    });
  }
  if (!candidates.length) return { status: 'not_found', queryName: fullName, candidates: [] };

  candidates.sort((a, b) => b.score - a.score);

  // Decision tree (calibrated on the Nantes Annuaire) — the context BREAKS TIES between
  // homonyms, it never BLOCKS an uncontested exact-name candidate.
  //   strong: exact name (>= NAME_MIN)   near: probable variant [NAME_NEAR, NAME_MIN)
  const strong = candidates.filter((c) => c.components.name >= NAME_MIN).sort((a, b) => b.score - a.score);
  const near = candidates.filter((c) => c.components.name >= NAME_NEAR && c.components.name < NAME_MIN);

  let status, best = null, margin = 1;
  if (strong.length === 1) {
    // single exact-name candidate → accepted (= « found » of sync_idref.cjs), context ignored
    status = 'accepted'; best = strong[0].ppn;
  } else if (strong.length > 1) {
    // homonyms: we decide ONLY if the context opens a clear margin
    const top = strong[0], second = strong[1];
    margin = top.score - second.score;
    if (top.score >= ACCEPT_THRESHOLD && margin >= MARGIN_THRESHOLD) { status = 'accepted'; best = top.ppn; }
    else status = 'ambiguous';
  } else if (near.length) {
    // no exact name but plausible variant(s) → review (recall gain vs exact-name)
    status = 'low_confidence';
  } else {
    status = 'not_found';
  }

  return {
    status, queryName: fullName, best,
    topScore: (strong[0] || near[0] || candidates[0]).score,
    margin: Math.round(margin * 1000) / 1000,
    nbStrong: strong.length, nbNear: near.length, truncated,
    candidates,
  };
}

// ── Identifier enrichment (attrra does not return the 035 fields) ─────────────
// Reuses the XML authority record path of sync_idref.cjs for a retained PPN.
async function enrichIdentifiers(ppn) {
  try {
    const xml = await getUrl(`https://www.idref.fr/${ppn}.xml`);
    const root = getParser().parse(xml);
    const acc = { control: [], data: [] };
    (function collect(node) {
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (k === 'controlfield') for (const cf of [].concat(v)) acc.control.push({ tag: cf?.['@_tag'], text: String(cf?.['#text'] ?? cf ?? '').trim() });
        else if (k === 'datafield') for (const df of [].concat(v)) acc.data.push({ tag: df?.['@_tag'], subs: [].concat(df?.subfield || []).map((s) => ({ code: s?.['@_code'], text: String(s?.['#text'] ?? '').trim() })) });
        else if (v && typeof v === 'object') collect(v);
      }
    })(root);
    const sub = (df, code) => (df.subs.find((s) => s.code === code) || {}).text || '';
    const ids = { orcid: '', idhal: '', isni: '' };
    for (const df of acc.data) {
      if (df.tag === '010' && !ids.isni) ids.isni = sub(df, 'a');
      if (df.tag === '035') {
        const labels = df.subs.map((s) => s.text.toUpperCase()); const a = sub(df, 'a');
        if (labels.includes('ORCID') && !ids.orcid) ids.orcid = a;
        else if ((labels.includes('IDHAL') || labels.includes('HAL')) && !ids.idhal) ids.idhal = a;
      }
    }
    return ids;
  } catch (e) { return { orcid: '', idhal: '', isni: '' }; }
}

// ── Grist (Annuaire + LABO as context) ───────────────────────────────────────
// EXTERNAL records (without LDAP uid_dyna, e.g. guest researchers) are included. Stable cache
// key for all: uid_dyna if present, otherwise `g<Grist row id>`. recId is used for the remapping
// (computeIdrefAlignDiff finds the record by its id, not by uid_dyna).
async function fetchAnnuaire() {
  // common.fetchAnnuaire() already returns recId/key/uid/first/last/idref/labo/orcid/idhal/
  // typeEmploi/libTypeEmploi (superset schema, see docs/archive/plan-fusion-centrale-2026-09.md § 3
  // sub-lot 3); only the filter (a name is enough, uid not required) is specific to this alignment.
  return (await common.fetchAnnuaire()).filter((p) => p.first || p.last);
}

// ── Collaborative Grist review (Alignement_IdRef table) ───────────────────────
// Port of GristService.pushIdrefReview / computeIdrefAlignDiff (frontend/lib/gristService.ts).
const IDREF_REVIEW_TABLE = 'Alignement_IdRef';

/** Columns of the review table, including the Valider/Rejeter formulas — identical to those
 * created by the front end (lib/gristService.ts::buildIdrefReviewColumns) so that the automatic
 * push (this script) and the manual push (Druid button) produce the same table. */
function buildIdrefReviewColumns() {
  const validerFormula = [
    `if $Decision == "Validé":`,
    `  return {"button": "Validé ✓", "description": "Déjà appliqué%s" % ((" le " + $Date_application) if $Date_application else ""), "actions": []}`,
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `ann = Annuaire.lookupOne(id=$Annuaire_id) if $Annuaire_id else Annuaire.lookupOne(uid_dyna=$uid_dyna)`,
    `if not ann:`,
    `  return {"button": "Fiche introuvable", "description": "Aucune fiche Annuaire avec uid_dyna=%s" % $uid_dyna, "actions": []}`,
    `import re`,
    `def _ppn(v):`,
    `  m = re.search(r"([0-9]{6,}[0-9Xx])", str(v or ""))`,
    `  return m.group(1).upper() if m else ""`,
    `fields = {}`,
    `done = []`,
    `cur = str(ann.IdRef or "").strip()`,
    `if not cur:`,
    `  fields["IdRef"] = $PPN_candidat`,
    `  done.append("IdRef")`,
    `elif _ppn(cur) != _ppn($PPN_candidat):`,
    `  return {"button": "Conflit IdRef", "description": "L'Annuaire contient déjà l'IdRef %s (différent de %s) : à régler dans Druid" % (cur, $PPN_candidat), "actions": []}`,
    `if str($ORCID_candidat or "").strip() and not str(ann.ORCID or "").strip():`,
    `  fields["ORCID"] = $ORCID_candidat`,
    `  done.append("ORCID")`,
    `if str($IdHAL_candidat or "").strip() and not str(ann.IdHAL or "").strip():`,
    `  fields["IdHAL"] = $IdHAL_candidat`,
    `  done.append("IdHAL")`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `actions = []`,
    `if fields:`,
    `  src = str(ann.Data_source or "")`,
    `  parts = [s.strip().upper() for s in re.split(r"[|,]", src) if s.strip()]`,
    `  if "IDREF" not in parts:`,
    `    fields["Data_source"] = (src + "|IdRef") if src else "IdRef"`,
    `  fields["IdRef_derniere_maj"] = today`,
    `  fields["IdRef_champs_modifies"] = "|".join(done)`,
    `  note = "[%s] MAJ IdRef (revue Grist): %s" % (today, ", ".join(done))`,
    `  com = str(ann.Commentaires or "")`,
    `  fields["Commentaires"] = (com + "\\n" + note) if com else note`,
    `  actions.append(["UpdateRecord", "Annuaire", ann.id, fields])`,
    `actions.append(["UpdateRecord", "${IDREF_REVIEW_TABLE}", $id, {"Decision": "Validé", "Applique": True, "Date_application": today}])`,
    `# Les autres candidats encore en attente pour la même personne sont auto-rejetés.`,
    `for sib in ${IDREF_REVIEW_TABLE}.lookupRecords(uid_dyna=$uid_dyna):`,
    `  if sib.id != $id and sib.Decision == "À traiter":`,
    `    actions.append(["UpdateRecord", "${IDREF_REVIEW_TABLE}", sib.id, {"Decision": "Rejeté", "Date_application": today}])`,
    `label = ("Valider " + " + ".join(done)) if done else "Valider (rien à écrire)"`,
    `return {"button": label, "description": "%s -> IdRef %s" % ($Nom_annuaire, $PPN_candidat), "actions": actions}`,
  ].join('\n');

  const rejeterFormula = [
    `if $Decision != "À traiter":`,
    `  return {"button": "—", "description": "Ligne déjà traitée (%s)" % $Decision, "actions": []}`,
    `today = NOW().strftime("%Y-%m-%d")`,
    `return {"button": "Rejeter", "description": "Écarte ce candidat pour %s (il ne sera plus reproposé)" % $Nom_annuaire, "actions": [["UpdateRecord", "${IDREF_REVIEW_TABLE}", $id, {"Decision": "Rejeté", "Date_application": today}]]}`,
  ].join('\n');

  const text = (id, label) => ({ id, fields: { label, type: 'Text' } });
  return [
    text('uid_dyna', 'uid_dyna'),
    { id: 'Annuaire_id', fields: { label: 'Annuaire (ligne)', type: 'Int' } },
    text('Nom_annuaire', 'Nom annuaire'),
    text('LABO', 'LABO'),
    { id: 'Nb_candidats', fields: { label: 'Nb candidats', type: 'Int' } },
    text('PPN_candidat', 'PPN candidat'),
    {
      id: 'Lien_IdRef',
      fields: {
        label: 'Lien IdRef', type: 'Text', isFormula: true,
        formula: `"https://www.idref.fr/" + str($PPN_candidat or "")`,
        widgetOptions: JSON.stringify({ widget: 'HyperLink' }),
      },
    },
    text('Nom_notice', 'Nom notice'),
    text('Profession', 'Profession'),
    text('Naissance', 'Naissance'),
    text('Description_notice', 'Description notice'),
    text('ORCID_candidat', 'ORCID candidat'),
    text('IdHAL_candidat', 'IdHAL candidat'),
    ...common.reviewDecisionColumns('Alignement_IdRef'),   // Decision (4 values), Note, Signale_le, Meler_action
    { id: 'Applique', fields: { label: 'Appliqué', type: 'Bool' } },
    text('Date_application', 'Date application'),
    text('Pousse_le', 'Poussé le'),
    { id: 'Valider_action', fields: { label: 'Valider (action)', type: 'Any', isFormula: true, formula: validerFormula } },
    { id: 'Rejeter_action', fields: { label: 'Rejeter (action)', type: 'Any', isFormula: true, formula: rejeterFormula } },
  ];
}

/** Minimal "align" diff (aRenseigner + ambigus) — equivalent of GristService.computeIdrefAlignDiff,
 * computed directly on the cache + the Annuaire already in memory (no re-read of the static
 * files). Never proposes to overwrite a non-empty cell. */
// NB « uid » below = the CACHE KEY (uid_dyna, or `g<recId>` for externals without an
// LDAP identity) — not necessarily the Grist `uid_dyna` column itself. Same choice
// as GristService.computeIdrefAlignDiff (loop `for (const [uid, raw] of Object.entries(cache))`):
// reproduced identically so that the blacklist (rejectIdrefCandidates) and the diff read
// by the Druid page agree with what this script pushes.
function computeAlignDiff(cache, all, rejected) {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const aRenseigner = [];
  const ambigus = [];
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.mode !== 'align') continue;
    const p = byKey.get(key);
    if (!p) continue;
    // Filters out the candidates rejected in the Grist review AND the records indicating a death before
    // DEATH_MIN_YEAR (obvious bad candidate, see alignPerson — filter also applied here to the
    // existing cache, produced before this filter was added, without waiting for a new run).
    const cands = (entry.candidates || []).filter((c) => {
      if (rejected.has(`${key}::${extractPpn(c.ppn)}`)) return false;
      const dy = candidateDeathYear(c.death);
      return !(dy !== null && dy < DEATH_MIN_YEAR);
    });
    if (entry.status === 'not_found' || !cands.length) continue;
    const bc = entry.status === 'accepted' && entry.best
      ? cands.find((c) => extractPpn(c.ppn) === extractPpn(entry.best))
      : null;
    if (bc) {
      const ids = entry.identifiers || {};
      const proposals = [];
      if (bc.ppn && !p.idref) proposals.push({ field: 'IdRef', after: bc.ppn });
      if (ids.orcid && !p.orcid) proposals.push({ field: 'ORCID', after: ids.orcid });
      if (ids.idhal && !p.idhal) proposals.push({ field: 'IdHAL', after: ids.idhal });
      if (proposals.length) {
        aRenseigner.push({
          uid: key, recId: p.recId, displayName: entry.queryName || `${p.first} ${p.last}`.trim(), labo: p.labo,
          candidate: { ppn: bc.ppn, fullName: bc.prefered || '', birth: bc.birth || '', death: bc.death || '', description: bc.bioNote || '', orcid: ids.orcid || '', idhal: ids.idhal || '' },
        });
      }
    } else if (!p.idref) {
      // ambiguous (homonyms) or low_confidence (variants) → human arbitration. Also covers the
      // case where the original "accepted" candidate was discarded by the death filter above: the
      // remaining candidates (if any) go back to arbitration rather than being lost.
      // Keeps !p.idref like the branch above: otherwise a record already filled in (through another path
      // since the cache was computed) stays proposed for arbitration indefinitely (review lot 4, finding 5).
      ambigus.push({
        uid: key, recId: p.recId, displayName: entry.queryName || `${p.first} ${p.last}`.trim(), labo: p.labo,
        candidates: cands.map((c) => ({ ppn: c.ppn, fullName: c.prefered || '', birth: c.birth || '', death: c.death || '', description: c.bioNote || '' })),
      });
    }
  }
  return { aRenseigner, ambigus };
}

/** Pushes the suggestions into Alignement_IdRef through the common foundation (align_common.cjs::pushReview):
 * creates the table if needed, upserts by uid::ppn, never touches a row already `Validé`/`Rejeté`,
 * purges the suggestions that became obsolete (candidate no longer proposed, or IdRef now filled in —
 * `targetField: 'IdRef'`, see the `g<recId>` convention for externals already handled by pushReview). */
async function pushReview(diff) {
  const baseRow = (uid, recId, displayName, labo, nb, c) => ({
    uid_dyna: uid, Annuaire_id: recId, Nom_annuaire: displayName, LABO: labo, Nb_candidats: nb,
    PPN_candidat: c.ppn, Nom_notice: c.fullName || '', Profession: '',
    Naissance: [c.birth, c.death].filter(Boolean).join('–'), Description_notice: c.description || '',
    ORCID_candidat: c.orcid || '', IdHAL_candidat: c.idhal || '',
  });
  const desired = new Map();
  for (const r of diff.aRenseigner) desired.set(`${r.uid}::${extractPpn(r.candidate.ppn)}`, baseRow(r.uid, r.recId, r.displayName, r.labo, 1, r.candidate));
  for (const a of diff.ambigus) for (const c of a.candidates) desired.set(`${a.uid}::${extractPpn(c.ppn)}`, baseRow(a.uid, a.recId, a.displayName, a.labo, a.candidates.length, c));

  return common.pushReview({
    table: IDREF_REVIEW_TABLE,
    columns: buildIdrefReviewColumns(),
    desired,
    keyOf: (rec) => `${rec.fields.uid_dyna || ''}::${extractPpn(rec.fields.PPN_candidat)}`,
    targetField: 'IdRef',
  });
}

module.exports = { normalize, tokens, dice, coverage, findRaIdref, attrra, references, scoreCandidate, alignPerson, enrichIdentifiers, computeAlignDiff, buildIdrefReviewColumns, pushReview };

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // Single-person demo mode: --name / --last+--first, without Grist
  const oneName = getArg('name', null);
  const oneLast = getArg('last', null);
  if (oneName || oneLast) {
    // --pubs="titre1|titre2" to inject publication titles by hand (demo)
    const pubs = (getArg('pubs', '') || '').split('|').filter(Boolean);
    const ctx = [getArg('affiliation', ''), getArg('field', ''), getArg('context', ''), ...pubs].filter(Boolean).join(' ');
    const res = await alignPerson({ name: oneName, last: oneLast, first: getArg('first', ''), contextText: ctx });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // Batch mode: Grist Annuaire, records without IdRef — INCREMENTAL (resumes from the existing cache).
  // 1st run = ~3000 records (long, once); following runs = only the new/unprocessed ones.
  // --force to reprocess everything, --limit=N to cap the number of NEW records in a run.
  const today = new Date().toISOString().slice(0, 10);
  const all = await fetchAnnuaire();
  const cache = store.loadCache();                            // resume: merge with the existing cache
  let targets = all.filter((p) => !extractPpn(p.idref) && (p.first || p.last));
  if (LABO_FILTER) targets = targets.filter((p) => String(p.labo || '').trim().toUpperCase() === LABO_FILTER);
  if (['personnel', 'doctorants', 'hors_recherche'].includes(GROUP_FILTER)) targets = targets.filter((p) => alignGroupOf(p) === GROUP_FILTER);
  const sansIdref = targets.length;
  if (!FORCE) targets = targets.filter((p) => !cache[p.key] || !cache[p.key].status);  // skips the already processed ones
  const remaining = targets.length;
  const nbExternes = targets.filter((p) => !p.uid).length;
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  // Context sources (optional)
  let laboDesc = {};
  if (USE_LABOS) {
    laboDesc = await fetchLaboDesc();
    if (LABOS_FILE) { try { Object.assign(laboDesc, JSON.parse(fs.readFileSync(LABOS_FILE, 'utf8'))); } catch (e) { console.error('[labos] fichier illisible:', e.message); } }
    console.log(`[qualinka] lab descriptions loaded: ${Object.keys(laboDesc).length}`);
  }
  let pubTitles = {};
  if (USE_NEO4J) {
    // Externals have no Person 'local-<uid>' in Neo4j → only those with a uid are queried.
    pubTitles = await fetchPubTitles(targets.filter((p) => p.uid).map((p) => p.uid));
    const withPubs = Object.values(pubTitles).filter((t) => t.length).length;
    console.log(`[qualinka] publication titles loaded: ${withPubs} records`);
  }
  console.log(`[qualinka] ${all.length} records · ${sansIdref} without IdRef${LABO_FILTER ? ` (labo ${LABO_FILTER})` : ''}${GROUP_FILTER ? ` (group ${GROUP_FILTER})` : ''} · ${sansIdref - remaining} already cached · ${targets.length} processed this run (including ${nbExternes} externals without LDAP uid). force=${FORCE} neo4j=${USE_NEO4J} labos=${USE_LABOS}`);

  let accepted = 0, ambiguous = 0, low = 0, notFound = 0;
  await runPool(targets, async (p) => {
    // context = lab description (readable) + publication titles; fallback to the raw LABO acronym
    const labTxt = (USE_LABOS && laboDesc[String(p.labo).toUpperCase()]) || p.labo || '';
    const ctxParts = [labTxt, ...((USE_NEO4J && pubTitles[p.uid]) || [])];
    const res = await alignPerson({ first: p.first, last: p.last, contextText: ctxParts.join(' ') });
    if (res.status === 'accepted') {
      accepted++;
      res.identifiers = await enrichIdentifiers(res.best);   // ORCID/IdHAL via the XML authority record
    } else if (res.status === 'ambiguous') ambiguous++;
    else if (res.status === 'low_confidence') low++;
    else notFound++;
    // A row attached to LDAP since the last run changes key (« g<id> » → uid):
    // the old entry is removed so as not to show the same person twice in the UI.
    for (const k of Object.keys(cache)) if (k !== p.key && cache[k] && cache[k].gristId === p.recId) delete cache[k];
    cache[p.key] = { mode: 'align', gristId: p.recId, uid: p.uid, labo: p.labo, nbPubCtx: ((USE_NEO4J && pubTitles[p.uid]) || []).length, ...res, checkedAt: today };
  }, CONCURRENCY, (done) => {
    if (done % 10 === 0 || done === targets.length) {
      store.writeProgress({ running: true, total: targets.length, done, accepted, ambiguous });
      console.log(`[qualinka] ${done}/${targets.length}  accepted=${accepted} ambiguous=${ambiguous} low=${low} not_found=${notFound}`);
    }
  });
  store.writeCache(cache);

  // Collaborative Grist review: pushes the suggestions directly (accepted → aRenseigner,
  // ambiguous/low_confidence → ambigus) into Alignement_IdRef, so that they can be
  // viewed/validated from another session without rerunning this run.
  let push = null;
  if (PUSH_GRIST) {
    try {
      const rejected = await common.loadRejected(IDREF_REVIEW_TABLE, 'PPN_candidat', extractPpn);
      const diff = computeAlignDiff(cache, all, rejected);
      push = await pushReview(diff);
      console.log(`[qualinka] Grist review: +${push.created} created, ${push.refreshed} refreshed, ${push.skipped} already decided, ${push.purged} purged.`);
    } catch (e) {
      console.error('[qualinka] Grist push ERROR (local cache kept)', e);
      push = { error: e.message };
    }
  }

  store.writeProgress({ running: false, total: targets.length, accepted, ambiguous, low, notFound, push, finishedAt: new Date().toISOString() });
  console.log(`[qualinka] Done. accepted=${accepted} ambiguous=${ambiguous} low_confidence=${low} not_found=${notFound}. Cache: ${store.cachePath}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('[qualinka] ERROR', e); store.writeProgress({ running: false, error: e.message }); process.exit(1); });
}
