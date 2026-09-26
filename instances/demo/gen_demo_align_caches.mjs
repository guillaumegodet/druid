#!/usr/bin/env node
// Fictitious alignment caches of a fictitious instance — the demo (docs/plan-instance-demo-cloudflare.md,
// lot A4) or demo-2 (--instance demo-2, docs/plan-architecture-multi-instances.md, lot 6) — read by the unified view « Alignement des identifiants chercheurs » in search mode:
//   demo-idref_align_cache.json           IdRef   (computeIdrefDiff: mode 'search', generic pipeline —
//                                         the demo has no Qualinka engine, HAS_QUALINKA false)
//   demo-orcid_align_cache.json           ORCID   (computeAlignDiff: mode 'search')
//   demo-hal_align_cache.json             HAL
//   demo-openalex_align_cache.json        OpenAlex
// (prefix = instance slug, files written in instances/<slug>/), copied without the prefix by
// scripts/prepare-cloudflare-assets.cjs.
//
// Only researchers MISSING an identifier get an entry (actionable records only). The « true »
// identifier of researcher n (UNIVERSE.firstNumber + index) is the one demo-data.mjs would have given (fakeOrcid(n), fakePpn(n)…),
// so the sources agree with each other; homonyms get ids from another range. Most records get a
// single strong candidate, some are ambiguous (homonyms), a few are not found. Deterministic.
//
// Usage: docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo/gen_demo_align_caches.mjs [--instance demo-2]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeOrcid, fakePpn, fakeIdHal, fakeOpenAlex } from './demo-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argInstance = process.argv.indexOf('--instance');
const INSTANCE = argInstance > 0 ? process.argv[argInstance + 1] : 'demo';
if (!['demo', 'demo-2'].includes(INSTANCE)) { console.error('--instance must be demo or demo-2'); process.exit(1); }
const OUT_DIR = path.join(HERE, '..', INSTANCE);
const { buildResearchers, UNIVERSE } = await import(`../${INSTANCE}/demo-data.mjs`);
const CHECKED_AT = '2026-09-24T06:00:00.000Z';
const HOMONYM = 500;   // id offset of the homonym candidates
const SITE = UNIVERSE.site;
const EMAIL_DOMAIN = UNIVERSE.emailDomain;

const researchers = buildResearchers();
const fullName = (r) => `${r.Nom}, ${r.Prenom}`;
const displayName = (r) => `${r.Nom.toUpperCase()} ${r.Prenom}`;
const birthYear = (r) => (r.DATE_DE_NAISSANCE_JJ_MM_AAAA || '').slice(0, 4);
const lab = (r) => (r.team ? `${r.LABO} (${r.team})` : r.LABO);

/** Case of a missing identifier: most found, every 4th ambiguous, every 9th not found. */
const caseOf = (n, salt) => ((n + salt) % 9 === 0 ? 'not_found' : (n + salt) % 4 === 0 ? 'ambiguous' : 'found');

const idref = {};
const orcid = {};
const hal = {};
const openalex = {};

researchers.forEach((r, i) => {
  const n = UNIVERSE.firstNumber + i;
  const uid = r.uid_dyna;

  // ── IdRef (generic pipeline, scripts/sync_idref.cjs) ──
  if (!r.IdRef) {
    const c = caseOf(n, 0);
    const gender = r.Civilite === 'F' ? 'F' : 'M';
    // Identifiers read on the IdRef record (ORCID, IdHAL): proposed where the Annuaire is empty.
    const main = {
      ppn: fakePpn(n), fullName: fullName(r), job: '', birth: birthYear(r), death: '', gender,
      description: `Enseignant-chercheur, ${lab(r)}, ${SITE}`, orcid: fakeOrcid(n), idhal: fakeIdHal(r.Prenom, r.Nom, UNIVERSE.idhalPrefix), isni: '',
    };
    const homonym = {
      ppn: fakePpn(n + HOMONYM), fullName: fullName(r), job: '', birth: String(Number(birthYear(r)) - 31), death: '', gender,
      description: 'Auteur d\'une thèse de lettres (1987)', orcid: '', idhal: '', isni: '',
    };
    idref[uid] = {
      mode: 'search', queryName: displayName(r), checkedAt: CHECKED_AT,
      ...(c === 'found' ? { status: 'found', candidates: [main] }
        : c === 'ambiguous' ? { status: 'ambiguous', candidates: [main, homonym] }
        : { status: 'not_found', candidates: [] }),
    };
  }

  // ── ORCID ──
  if (!r.ORCID) {
    const c = caseOf(n, 1);
    const cand = (id, score, evidence, institutions) => ({
      orcid: id, fullName: `${r.Prenom} ${r.Nom}`, forms: [`${r.Prenom} ${r.Nom}`], institutions, employments: institutions,
      emails: [], scopus: '', score, evidence, matchedIds: [], nameMatch: 'exact',
    });
    const good = cand(fakeOrcid(n), 'fort', [`site (${SITE})`, `labo ${r.LABO}`], [SITE]);
    orcid[uid] = {
      mode: 'search', queryName: displayName(r), checkedAt: CHECKED_AT, derivedFrom: [], fallback: false,
      ...(c === 'found' ? { status: 'found', best: good.orcid, candidates: [good] }
        : c === 'ambiguous' ? { status: 'ambiguous', best: '', candidates: [{ ...good, score: 'moyen', evidence: [`site (${SITE})`] }, cand(fakeOrcid(n + HOMONYM), 'faible', ['non enrichi'], [])] }
        : { status: 'not_found', best: '', candidates: [] }),
    };
  }

  // ── HAL ──
  if (!r.IdHAL) {
    const c = caseOf(n, 2);
    const cand = (idhal, idhalI, score, evidence, labs) => ({
      idhal, idhalI, fullName: `${r.Prenom} ${r.Nom}`, forms: [`${r.Prenom} ${r.Nom}`], emailDomains: [EMAIL_DOMAIN],
      labs, orcid: '', idref: '', score, evidence, matchedIds: [], nameMatch: 'exact', suspect: [],
    });
    const good = cand(fakeIdHal(r.Prenom, r.Nom, UNIVERSE.idhalPrefix), String(900000 + n), 'fort', [`mail @${EMAIL_DOMAIN}`, `labo ${r.LABO} (${3 + (n % 9)} publis)`], [r.LABO]);
    hal[uid] = {
      mode: 'search', queryName: displayName(r), checkedAt: CHECKED_AT, derivedFrom: [],
      ...(c === 'found' ? { status: 'found', best: good.idhal, candidates: [good] }
        : c === 'ambiguous' ? { status: 'ambiguous', best: '', candidates: [{ ...good, score: 'moyen' }, cand(`${good.idhal}-1`, String(900000 + n + HOMONYM), 'faible', ['nom partiel'], ['Laboratoire Témoin'])] }
        : { status: 'not_found', best: '', candidates: [] }),
    };
  }

  // ── OpenAlex (multi-valued: every strong profile is proposed, the others arbitrated) ──
  if (!r.openalex_author_id) {
    const c = caseOf(n, 3);
    const cand = (id, score, evidence, worksCount) => ({
      id, fullName: `${r.Prenom} ${r.Nom}`, forms: [`${r.Prenom} ${r.Nom}`], worksCount, orcid: '',
      affiliations: [`${SITE} (2016–2026)`], origins: ['name'], ikgRefs: 0, sharedDois: 0, doisChecked: false,
      score, evidence, matchedIds: [], nameMatch: 'exact', suspect: [],
    });
    const good = cand(fakeOpenAlex(n), 'fort', [`affiliation ${SITE} (2016–2026)`, `${12 + (n % 30)} works`], 12 + (n % 30));
    openalex[uid] = {
      mode: 'search', queryName: displayName(r), checkedAt: CHECKED_AT, direct: [], derivedFrom: [], ikg: false, refSource: 'none', refDois: 0, netError: false,
      ...(c === 'found' ? { status: 'found', best: [good.id], candidates: [good] }
        : c === 'ambiguous' ? { status: 'ambiguous', best: [], candidates: [{ ...good, score: 'moyen' }, cand(fakeOpenAlex(n + HOMONYM), 'faible', ['3 works'], 3)] }
        : { status: 'not_found', best: [], candidates: [] }),
    };
  }
});

const write = (name, data) => {
  fs.writeFileSync(path.join(OUT_DIR, `${INSTANCE}-${name}`), JSON.stringify(data, null, 1) + '\n');
  const counts = Object.values(data).reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }), {});
  console.log(`${INSTANCE}-${name}: ${Object.keys(data).length} entries ${JSON.stringify(counts)}`);
};
write('idref_align_cache.json', idref);
write('orcid_align_cache.json', orcid);
write('hal_align_cache.json', hal);
write('openalex_align_cache.json', openalex);
