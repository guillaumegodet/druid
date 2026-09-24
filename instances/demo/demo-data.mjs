// Fictitious data of the public demo instance (docs/plan-instance-demo-cloudflare.md, lot A3).
//
// A fictitious university with three labs (LIRA, BIOS, LMD) and three teams (see STRUCTURES) —
// the universe of the former demo fork (docker/druid-demo), in the Grist schema of the Centrale
// doc (Annuaire / Structures / Etablissements). Nothing here refers to a real person:
//  - e-mails under example.org (reserved domain);
//  - ORCID and IdRef identifiers built with a deliberately WRONG check character, so they can
//    never resolve to a real record;
//  - IdHAL prefixed `demo-`, OpenAlex ids `A00000…` (outside the range OpenAlex assigns);
//  - no Scopus id.
// Deterministic (seeded generator): two runs produce the same records.
// Run directly, prints the researchers as JSON (input of gen_demo_dashboards.py):
//   node instances/demo/demo-data.mjs > /tmp/demo-people.json

import { pathToFileURL } from 'node:url';

/** Etablissements table (Annuaire.Employeur references these rows by `key`). */
export const ETABLISSEMENTS = [
  { key: 'UNIV', Employeur: 'UNIVERSITÉ DE DÉMONSTRATION', UAI: 'DEMO-UNIV', ROR: '', Libelle: 'Université de Démonstration' },
  { key: 'ENS', Employeur: 'ENS-DÉMO', UAI: 'DEMO-ENS', ROR: '', Libelle: 'École Nationale Supérieure de Démonstration' },
  { key: 'CNR', Employeur: 'CNRD', UAI: 'DEMO-CNR', ROR: '', Libelle: 'Centre National de Recherche de Démonstration' },
];

/** Structures table (CRISalid V2 schema, same rows as the former demo doc). */
export const STRUCTURES = [
  { generic_type: 'institution', type: 'EPE', local_id: 'DEMO-UNIV', short_labels: 'UDémo[fr]', long_labels: 'Université de Démonstration[fr]', uai: 'DEMO-UNIV', web: 'https://example.org/udemo' },
  { generic_type: 'institution', type: 'GE', local_id: 'DEMO-ENS', short_labels: 'ENS-Démo[fr]', long_labels: 'École Nationale Supérieure de Démonstration[fr]', uai: 'DEMO-ENS', web: 'https://example.org/ens-demo' },
  { generic_type: 'institution', type: 'EPST', local_id: 'DEMO-CNR', short_labels: 'CNRD[fr]', long_labels: 'Centre National de Recherche de Démonstration[fr]', uai: 'DEMO-CNR', web: 'https://example.org/cnrd' },
  { generic_type: 'unit', type: 'POLE', main_mission: 'research', local_id: 'POLE-ST', short_labels: 'PST[fr]', long_labels: 'Pôle Sciences et Technologies[fr]' },
  { generic_type: 'unit', type: 'POLE', main_mission: 'research', local_id: 'POLE-VIE', short_labels: 'PVS[fr]', long_labels: 'Pôle Vie et Santé[fr]' },
  { generic_type: 'unit', type: 'UFR', local_id: 'UFR-SCI', short_labels: 'FacSciences[fr]', long_labels: 'Faculté des Sciences et Techniques[fr]', inclusions: 'local-DEMO-UNIV[20150901-]' },
  { generic_type: 'unit', type: 'UFR', local_id: 'UFR-MED', short_labels: 'FacSanté[fr]', long_labels: 'Faculté de Santé[fr]', inclusions: 'local-DEMO-UNIV[20150901-]' },
  {
    generic_type: 'unit', type: 'UMR', main_mission: 'research', local_id: 'LIRA', short_labels: 'LIRA[fr]',
    long_labels: "Laboratoire d'Informatique et Réseaux Appliqués[fr]", inclusions: 'local-UFR-SCI[20160101-]',
    participations: 'local-DEMO-UNIV[main_supervision][20160101-]|local-DEMO-ENS[associated_supervision][20160101-]|local-DEMO-CNR[associated_supervision][20160101-]|local-POLE-ST[20160101-]',
    nns: 'DEMO-UMR-001', web: 'https://example.org/lira', signature: 'Université de Démonstration, ENS-Démo, CNRD, LIRA, UMR 0001, Démoville, France',
  },
  {
    generic_type: 'unit', type: 'UMR', main_mission: 'research', local_id: 'BIOS', short_labels: 'BIOS[fr]',
    long_labels: 'Biologie des Organismes et des Systèmes[fr]', inclusions: 'local-UFR-MED[20160101-]',
    participations: 'local-DEMO-UNIV[main_supervision][20160101-]|local-DEMO-CNR[associated_supervision][20160101-]|local-POLE-VIE[20160101-]',
    nns: 'DEMO-UMR-002', web: 'https://example.org/bios', signature: 'Université de Démonstration, CNRD, BIOS, UMR 0002, Démoville, France',
  },
  {
    generic_type: 'unit', type: 'UR', main_mission: 'research', local_id: 'LMD', short_labels: 'LMD[fr]',
    long_labels: 'Laboratoire de Mathématiques de Démonstration[fr]', inclusions: 'local-UFR-SCI[20160101-]',
    participations: 'local-DEMO-UNIV[main_supervision][20160101-]|local-POLE-ST[20160101-]',
    nns: 'DEMO-UR-003', web: 'https://example.org/lmd',
  },
  { generic_type: 'unit', type: 'ER', main_mission: 'research', local_id: 'LIRA-AI', short_labels: 'IA-Démo[fr]', long_labels: 'Équipe Intelligence Artificielle[fr]', inclusions: 'local-LIRA[20170101-]' },
  { generic_type: 'unit', type: 'ER', main_mission: 'research', local_id: 'LIRA-NET', short_labels: 'Net-Démo[fr]', long_labels: 'Équipe Réseaux et Systèmes Distribués[fr]', inclusions: 'local-LIRA[20170101-]' },
  { generic_type: 'unit', type: 'ER', main_mission: 'research', local_id: 'BIOS-GEN', short_labels: 'Gen-Démo[fr]', long_labels: 'Équipe Génomique Fonctionnelle[fr]', inclusions: 'local-BIOS[20170101-]' },
];

// ── Fictitious identifiers (never valid) ─────────────────────────────────────

/** ORCID check character (ISO 7064 11,2) of the first 15 digits. */
export const orcidCheck = (digits15) => {
  let total = 0;
  for (const c of digits15) total = (total + Number(c)) * 2;
  const r = (12 - (total % 11)) % 11;
  return r === 10 ? 'X' : String(r);
};
/** Fictitious ORCID: correct shape, wrong check character. */
export const fakeOrcid = (n) => {
  const d15 = `0000000199${String(n).padStart(5, '0')}`;
  const good = orcidCheck(d15);
  const bad = good === 'X' ? '0' : String((Number(good) + 1) % 10);
  const s = d15 + bad;
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
};

/** IdRef PPN check character (weights 9..2 on the first 8 digits, modulo 11). */
export const ppnCheck = (digits8) => {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits8[i]) * (9 - i);
  const r = (11 - (sum % 11)) % 11;
  return r === 10 ? 'X' : String(r);
};
/** Fictitious PPN: 9 characters, wrong check character. */
export const fakePpn = (n) => {
  const d8 = `99${String(n).padStart(6, '0')}`;
  const good = ppnCheck(d8);
  const bad = good === 'X' ? '0' : String((Number(good) + 1) % 10);
  return d8 + bad;
};

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const fakeIdHal = (first, last) => `demo-${slug(first)}-${slug(last)}`;
export const fakeOpenAlex = (n) => `A${String(n).padStart(10, '0')}`;

// ── Researchers ──────────────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32). */
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const FIRST_F = ['Élodie', 'Manon', 'Chloé', 'Nadia', 'Aurélie', 'Justine', 'Yasmine', 'Hélène', 'Pauline', 'Mélanie', 'Laure', 'Agathe', 'Salomé', 'Irène', 'Maëlle', 'Rania'];
const FIRST_M = ['Julien', 'Maxime', 'Karim', 'Bastien', 'Antoine', 'Romain', 'Yann', 'Florian', 'Mehdi', 'Loïc', 'Quentin', 'Gaël', 'Tristan', 'Rémi', 'Olivier', 'Samuel'];
const LAST = ['Arnaud', 'Barbier', 'Carpentier', 'Delmas', 'Esnault', 'Fournier', 'Gauthier', 'Hamon', 'Jacquet', 'Kerbrat', 'Laurent', 'Mallet', 'Noël', 'Ollivier', 'Pasquier', 'Quéré', 'Renaud', 'Sabatier', 'Tessier', 'Vidal', 'Weber', 'Boucher', 'Colas', 'Duval', 'Évrard', 'Ferrand', 'Guérin', 'Huet', 'Jourdan', 'Leclerc', 'Masson', 'Poirier', 'Riviere', 'Simon', 'Texier', 'Vasseur', 'Aubert', 'Bertin', 'Charpentier', 'Dumont'];

/** Composition of each lab/team: [LABO, team, campus, grades drawn from]. */
const UNITS = [
  { labo: 'LIRA', team: 'IA-Démo', campus: 'Campus UDémo', count: 8 },
  { labo: 'LIRA', team: 'Net-Démo', campus: 'Campus UDémo', count: 7 },
  { labo: 'BIOS', team: 'Gen-Démo', campus: 'Campus Santé', count: 7 },
  { labo: 'BIOS', team: '', campus: 'Campus Santé', count: 5 },
  { labo: 'LMD', team: '', campus: 'Campus UDémo', count: 9 },
];

/** Grade → employment type, employer and whether an HDR is plausible. */
const GRADES = [
  { grade: 'PR', typeEmploi: 'TITULAIRE', employer: 'UNIV', hdr: true, weight: 3 },
  { grade: 'MCF', typeEmploi: 'TITULAIRE', employer: 'UNIV', hdr: false, weight: 6 },
  { grade: 'DR', typeEmploi: 'TITULAIRE', employer: 'CNR', hdr: true, weight: 1 },
  { grade: 'CR', typeEmploi: 'TITULAIRE', employer: 'CNR', hdr: false, weight: 2 },
  { grade: 'IR', typeEmploi: 'TITULAIRE', employer: 'ENS', hdr: false, weight: 1 },
  { grade: 'Post-doc', typeEmploi: 'CDD UNIVERSITE', employer: 'UNIV', hdr: false, weight: 2 },
  { grade: 'Doctorant', typeEmploi: 'Doctorant', employer: 'UNIV', hdr: false, weight: 3 },
];

/**
 * One researcher. Identifier coverage is controlled by `ids` (subset of orcid/idref/idhal/openalex)
 * so that the alignment view has records to complete.
 */
const person = ({ n, first, last, civ, birth, grade, typeEmploi, employer, hdr, hdrYear = '', labo, team = '', campus,
  start, end = '', affEnd = '', ids = ['orcid', 'idref', 'idhal', 'openalex'], ed = '', groupes = '' }) => {
  const uid = `${slug(last).replace(/-/g, '')}-${slug(first)[0]}`;
  return {
    uid_dyna: uid,
    Nom: last,
    Prenom: first,
    Civilite: civ,
    Email: `${uid}@udemo.example.org`,
    Nationalite: 'Française',
    DATE_DE_NAISSANCE_JJ_MM_AAAA: birth,
    Corps_grade: grade,
    TYPE_EMPLOI: typeEmploi,
    HDR: hdr ? 'OUI' : 'NON',
    ANNEE_HDR: hdr ? hdrYear : '',
    ED_de_rattachement: ed,
    LABO: labo,
    team,
    campus,
    employerKey: employer,
    employment_start_date: start,
    employment_end_date: end,
    affiliation_start_date: start,
    affiliation_end_date: affEnd,
    membership_type: 'stat_mmb',
    ORCID: ids.includes('orcid') ? fakeOrcid(n) : '',
    IdRef: ids.includes('idref') ? fakePpn(n) : '',
    IdHAL: ids.includes('idhal') ? fakeIdHal(first, last) : '',
    openalex_author_id: ids.includes('openalex') ? fakeOpenAlex(n) : '',
    // Reviewed list read by the alignment view (multi-valued target, pipe-separated).
    OpenAlex_ids: ids.includes('openalex') ? fakeOpenAlex(n) : '',
    groupes,
    annuaire_url: `https://example.org/udemo/annuaire/${uid}`,
  };
};

/** The 14 researchers of the former demo, kept for continuity (same names, labs, grades). */
const CORE = [
  { first: 'Camille', last: 'Roussel', civ: 'F', birth: '1974-04-12', grade: 'PR', hdr: true, hdrYear: '2008', labo: 'LIRA', team: 'IA-Démo', start: '2006-09-01' },
  { first: 'Hugo', last: 'Lefèvre', civ: 'M', birth: '1985-01-30', grade: 'MCF', labo: 'LIRA', team: 'IA-Démo', start: '2014-09-01' },
  { first: 'Inês', last: 'Da Silva', civ: 'F', birth: '1989-06-08', grade: 'CR', employer: 'CNR', labo: 'LIRA', team: 'IA-Démo', start: '2017-01-01' },
  { first: 'Théo', last: 'Marchand', civ: 'M', birth: '1983-09-19', grade: 'MCF', labo: 'LIRA', team: 'Net-Démo', start: '2013-09-01' },
  { first: 'Lan', last: 'Nguyen', civ: 'F', birth: '1996-02-25', grade: 'Doctorant', labo: 'LIRA', team: 'Net-Démo', start: '2022-10-01', ids: ['orcid'], ed: 'ED Démo-STIC' },
  { first: 'Pierre', last: 'Bonnet', civ: 'M', birth: '1979-12-03', grade: 'IR', employer: 'ENS', labo: 'LIRA', team: 'Net-Démo', start: '2011-03-01' },
  { first: 'Sophie', last: 'Garnier', civ: 'F', birth: '1969-11-21', grade: 'DR', employer: 'CNR', hdr: true, hdrYear: '2002', labo: 'BIOS', team: 'Gen-Démo', start: '2003-01-01' },
  { first: 'Adrien', last: 'Faure', civ: 'M', birth: '1986-05-17', grade: 'MCF', labo: 'BIOS', team: 'Gen-Démo', start: '2015-09-01' },
  { first: 'Léa', last: 'Petit', civ: 'F', birth: '1997-08-14', grade: 'Doctorant', labo: 'BIOS', team: 'Gen-Démo', start: '2023-10-01', ids: ['orcid'], ed: 'ED Démo-Santé' },
  // No IdHAL on purpose: the IdRef record carries one → « to enrich » case of the alignment view.
  { first: 'Julien', last: 'Morel', civ: 'M', birth: '1971-03-09', grade: 'PR', hdr: true, hdrYear: '2005', labo: 'BIOS', start: '2004-09-01', ids: ['orcid', 'idref', 'openalex'] },
  { first: 'Anne', last: 'Chevalier', civ: 'F', birth: '1973-07-02', grade: 'PR', hdr: true, hdrYear: '2007', labo: 'LMD', start: '2005-09-01' },
  { first: 'Marc', last: 'Henry', civ: 'M', birth: '1982-10-28', grade: 'MCF', labo: 'LMD', start: '2012-09-01' },
  { first: 'Claire', last: 'Robin', civ: 'F', birth: '1990-01-15', grade: 'CR', employer: 'CNR', labo: 'LMD', start: '2018-01-01' },
  { first: 'Sami', last: 'Olivier', civ: 'M', birth: '1995-09-06', grade: 'Doctorant', labo: 'LMD', start: '2021-10-01', ids: ['orcid'], ed: 'ED Démo-STIC' },
];

/** Cases the demo must show: emeritus, departure, imprecise dates, researcher with no identifier. */
const SPECIAL = [
  { first: 'Gérard', last: 'Lambert', civ: 'M', birth: '1950-02-11', grade: 'PREM', typeEmploi: 'EMERITE', hdr: true, hdrYear: '1988', labo: 'LMD', start: '1985-09-01' },
  { first: 'Odile', last: 'Perrin', civ: 'F', birth: '1962-06-30', grade: 'MCF', labo: 'BIOS', team: 'Gen-Démo', start: '1995-09-01', end: '2024-08-31', affEnd: '2024-08-31' },
  { first: 'Nicolas', last: 'Brunet', civ: 'M', birth: '1991-04-03', grade: 'Post-doc', typeEmploi: 'CDD UNIVERSITE', labo: 'LIRA', team: 'IA-Démo', start: '2024', ids: [] },
  { first: 'Sarah', last: 'Meunier', civ: 'F', birth: '1988-12-19', grade: 'MCF', labo: 'LMD', start: '2021-03', ids: ['orcid', 'idhal'] },
];

const defaultsFor = (grade) => GRADES.find((g) => g.grade === grade) || GRADES[1];

/** All researchers (Annuaire rows before the Employeur reference is resolved). */
export const buildResearchers = () => {
  const out = [];
  let n = 1;
  const add = (p) => {
    const d = defaultsFor(p.grade);
    const campus = p.campus || (p.labo === 'BIOS' ? 'Campus Santé' : 'Campus UDémo');
    out.push(person({
      n: n++, typeEmploi: d.typeEmploi, employer: d.employer, hdr: false, campus,
      ed: p.grade === 'Doctorant' ? 'ED Démo-STIC' : '', ...p,
    }));
  };
  CORE.forEach(add);
  SPECIAL.forEach(add);

  const rand = rng(20260924);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weighted = GRADES.flatMap((g) => Array(g.weight).fill(g));
  const used = new Set(out.map((r) => `${r.Nom}|${r.Prenom}`));
  for (const unit of UNITS) {
    for (let i = 0; i < unit.count; i++) {
      const g = pick(weighted);
      const civ = rand() < 0.5 ? 'F' : 'M';
      let first, last;
      do {
        first = pick(civ === 'F' ? FIRST_F : FIRST_M);
        last = pick(LAST);
      } while (used.has(`${last}|${first}`));
      used.add(`${last}|${first}`);
      const young = g.grade === 'Doctorant' || g.grade === 'Post-doc';
      const birthYear = young ? 1994 + Math.floor(rand() * 6) : 1965 + Math.floor(rand() * 25);
      const startYear = young ? 2021 + Math.floor(rand() * 4) : Math.max(birthYear + 28, 1998) + Math.floor(rand() * 10);
      // Identifier coverage: permanent staff mostly complete, young researchers sparse.
      const ids = ['orcid', 'idref', 'idhal', 'openalex'].filter((_, k) => rand() < (young ? [0.7, 0.1, 0.2, 0.3][k] : [0.85, 0.7, 0.55, 0.5][k]));
      add({
        first, last, civ, grade: g.grade,
        birth: `${birthYear}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
        hdr: g.hdr, hdrYear: g.hdr ? String(startYear + 6) : '',
        labo: unit.labo, team: unit.team, campus: unit.campus,
        start: `${startYear}-${young ? '10' : '09'}-01`, ids,
      });
    }
  }
  return out;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(buildResearchers(), null, 1) + '\n');
}
