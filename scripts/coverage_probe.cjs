#!/usr/bin/env node
/**
 * coverage_probe.cjs — share of a lab's 2021-2025 output that is « reachable » through the Annuaire
 * identifiers, with and then without the OpenAlex A-ids (docs/archive/plan-alignement-openalex.md, lot 5).
 * Node rewrite, on the align_common foundation, of the Python probes of 2026-09-10
 * (/opt/crisalid/work/evolution-etl-sources/sondages-20260910/probe_struct2.py, probe_hal.py).
 *
 * Per lab (Structures table: `ror` → OpenAlex institution, `hal_collection`):
 *   OpenAlex: works 2021-2025 with ≥ 1 authorship affiliated to the lab (lineage). A work is reachable
 *              « avant » if an author affiliated to the lab carries an ORCID from the Annuaire (current
 *              person-level harvesting), « après » if in addition their A-id is in OpenAlex_ids.
 *   HAL      : documents 2021-2025 of the collection. Reachable if authIdHal_i ∈ IdHAL_i of the Annuaire
 *              or authORCIDIdExt_s ∈ ORCID of the Annuaire.
 * Sample: --pages=3 pages × 200 OpenAlex works (sorted by descending date); HAL rows=1000.
 *
 * Options: --labo=LS2N,CEISAM (default: the 4 control labs LS2N, CEISAM, CReAAH, CAPHI) | --all
 *           --pages=3  --out=coverage_probe.json (bind-mounted in cache-data/, see druid.yaml)
 * Output: { generatedAt, years, labs: { SIGLE: { openalex: {…}, hal: {…} } } } — basis of the « Sources » tab.
 */
'use strict';
const fs = require('fs');
const common = require('./lib/align_common.cjs');
const { getArg, hasFlag, extractOrcid, getUrl, gristRecords, DOC, normalize } = common;
const oa = require('./sync_openalex.cjs');

const YEARS = '2021-2025';
const HAL_FQ = 'producedDateY_i:[2021 TO 2025]';
const PAGES = parseInt(getArg('pages', '3'), 10) || 3;
const OUT = getArg('out', 'coverage_probe.json');
const ALL = hasFlag('all');
const WITNESS = ['LS2N', 'CEISAM', 'CReAAH', 'CAPHI'];
const LABOS = (getArg('labo', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
// OPENALEX_API_KEY key by default (institution key, 200,000 req/day — see sync_openalex.cjs); --no-key for
// the polite pool (OPENALEX_MAILTO, 1,000 req/day).
const API_KEY = process.env.OPENALEX_API_KEY || '';
const MAILTO = process.env.OPENALEX_MAILTO || '';
const USE_KEY = !!API_KEY && !hasFlag('no-key');

const stripLang = (v) => String(v || '').split('|').map((x) => x.replace(/\[[a-z]{2}\]\s*$/i, '').trim()).filter(Boolean);
const oaUrl = (path, params) => {
  const u = new URL(`https://api.openalex.org${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  if (USE_KEY) u.searchParams.set('api_key', API_KEY);
  else if (MAILTO) u.searchParams.set('mailto', MAILTO);
  return u.toString();
};
const oaGet = (path, params) => getUrl(oaUrl(path, params), { json: true, timeout: 40000, tries: 4, delay: 500 });

async function institutionByRor(ror) {
  if (!ror) return null;
  const d = await oaGet('/institutions', { filter: `ror:${ror}`, select: 'id,display_name', 'per-page': 1 });
  const inst = d?.results?.[0];
  return inst ? { id: String(inst.id).split('/').pop(), name: inst.display_name } : null;
}

/** OpenAlex: sample of the lab's works and reachable share through ORCID alone / ORCID + A-ids. */
async function probeOpenalex(inst, ann) {
  if (!inst) return { skipped: 'pas de ROR / institution OpenAlex' };
  const filter = `authorships.institutions.lineage:${inst.id},publication_year:${YEARS}`;
  let total = 0, sample = 0, reachOrcid = 0, reachAll = 0, sampleWithOrcidAuthor = 0;
  let cursor = '*';
  for (let page = 0; page < PAGES && cursor; page++) {
    const d = await oaGet('/works', { filter, select: 'id,authorships', 'per-page': 200, sort: 'publication_date:desc', cursor });
    total = d.meta?.count || total;
    cursor = d.meta?.next_cursor || '';
    for (const w of d.results || []) {
      sample++;
      const labAuth = (w.authorships || []).filter((a) => (a.institutions || []).some((i) => String(i.id || '').endsWith(inst.id) || (i.lineage || []).some((l) => String(l).endsWith(inst.id))));
      const orcids = labAuth.map((a) => extractOrcid(a.author?.orcid)).filter(Boolean);
      const aids = labAuth.map((a) => oa.extractAId(a.author?.id)).filter(Boolean);
      if (orcids.length) sampleWithOrcidAuthor++;
      const byOrcid = orcids.some((o) => ann.orcids.has(o));
      const byAid = aids.some((a) => ann.aids.has(a));
      if (byOrcid) reachOrcid++;
      if (byOrcid || byAid) reachAll++;
    }
  }
  const pct = (n) => (sample ? Math.round((100 * n) / sample) : null);
  return { institution: inst, total, sample, sampleWithOrcidAuthor, reachOrcid, reachAll, pctOrcid: pct(reachOrcid), pctAll: pct(reachAll) };
}

/** HAL: sample of the collection and reachable share through IdHAL_i / ORCID of the Annuaire. */
async function probeHal(collection, ann) {
  const code = String(collection || '').trim().replace(/\/+$/, '').split('/').pop();
  if (!code) return { skipped: 'pas de collection HAL' };
  const params = new URLSearchParams({ q: '*:*', fq: HAL_FQ, fl: 'docid,authIdHal_i,authORCIDIdExt_s', rows: '1000', wt: 'json' });
  let d;
  try {
    d = await getUrl(`https://api.archives-ouvertes.fr/search/${encodeURIComponent(code)}/?${params}`, { json: true, timeout: 60000 });
  } catch (e) { return { collection: code, error: e.message }; }
  const docs = d?.response?.docs || [];
  let reach = 0, noIdhal = 0;
  for (const x of docs) {
    const idh = (x.authIdHal_i || []).map(String);
    const orc = (x.authORCIDIdExt_s || []).map(extractOrcid).filter(Boolean);
    if (!idh.length) noIdhal++;
    if (idh.some((i) => ann.idhalI.has(i)) || orc.some((o) => ann.orcids.has(o))) reach++;
  }
  const sample = docs.length;
  return { collection: code, total: d?.response?.numFound || 0, sample, sansIdhal: noIdhal, reach, pct: sample ? Math.round((100 * reach) / sample) : null };
}

async function main() {
  const annuaire = await common.fetchAnnuaire();
  const ann = {
    orcids: new Set(annuaire.map((p) => extractOrcid(p.orcid)).filter(Boolean)),
    aids: new Set(annuaire.flatMap((p) => oa.parseIds(p.openalexIds))),
    idhalI: new Set(annuaire.map((p) => String(p.idhalI || '').trim()).filter(Boolean)),
  };
  console.log(`[coverage] Annuaire: ${annuaire.length} records · ${ann.orcids.size} ORCID · ${ann.aids.size} A-ids OpenAlex · ${ann.idhalI.size} IdHAL_i`);

  const records = await gristRecords('Structures');
  const units = (records || []).map((r) => r.fields).filter((f) => f.generic_type === 'unit');
  const wanted = ALL ? null : new Set((LABOS.length ? LABOS : WITNESS).map(normalize));
  const labs = units
    .map((f) => ({ sigle: stripLang(f.short_labels)[0] || f.local_id, ror: String(f.ror || '').trim().replace(/^https?:\/\/ror\.org\//, ''), hal: f.hal_collection || '' }))
    .filter((l) => l.sigle && (ALL ? (l.ror || l.hal) : wanted.has(normalize(l.sigle))));
  console.log(`[coverage] ${labs.length} labo(s) : ${labs.map((l) => l.sigle).join(', ')}`);

  let out = {};
  try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
  out.generatedAt = new Date().toISOString();
  out.years = YEARS;
  out.annuaire = { fiches: annuaire.length, orcid: ann.orcids.size, openalexIds: ann.aids.size, idhalI: ann.idhalI.size };
  out.labs = out.labs || {};
  for (const lab of labs) {
    const t = Date.now();
    const inst = await institutionByRor(lab.ror).catch(() => null);
    const [openalex, hal] = await Promise.all([
      probeOpenalex(inst, ann).catch((e) => ({ error: e.message })),
      probeHal(lab.hal, ann).catch((e) => ({ error: e.message })),
    ]);
    out.labs[lab.sigle] = { ror: lab.ror, openalex, hal, checkedAt: new Date().toISOString() };
    const fmt = (o) => (o.skipped || o.error) ? (o.skipped || `erreur ${o.error}`) : `${o.sample}/${o.total}`;
    console.log(`[coverage] ${lab.sigle} (${Math.round((Date.now() - t) / 1000)}s) — OpenAlex ${fmt(openalex)} : ORCID ${openalex.pctOrcid ?? '-'} % → ORCID+A-ids ${openalex.pctAll ?? '-'} % · HAL ${fmt(hal)} : ${hal.pct ?? '-'} %`);
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  }
  console.log(`[coverage] Done → ${OUT}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('[coverage] ERROR', e); process.exit(1); });
}
