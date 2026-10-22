// Fictitious data of the features a demo instance shows beyond its directory (druid-internal docs/plan-funding-calls.md,
// docs/plan-binomes-citations.md): calls for proposals of the programmes followed by Druid with their matches to the
// researchers, the rules of the calls reserved by career stage and the candidates they make eligible, the doctoral
// theses of the researchers. Pure: everything is derived from the researchers of instances/<slug>/demo-data.mjs and,
// when the instance ships one, from its co-authorship network (dashboard-data/network.json, the titles of the
// publications the « matching » cites); the database part is lib/migration/loadDemoExtras.ts. Nothing here is real: the
// calls are invented (ids prefixed DEMO-, pages under example.org), the theses carry a fictitious national number.
// Deterministic, except the dates, set relative to the day of the seed so that the calls stay open.
import { evaluate, rulesFromCallText, type EligibilityRule, type EligibilityVerdict, type EligibilityReason } from '../calls/eligibility';
import { ANR_AAPG, ANR_FUNDER, EU_FUNDER, HORIZON_EUROPE, PORTAL_PROGRAMMES_BUILT_IN, type Funder, type Programme, type CallStatus } from '../calls/programmes';
import type { MatchOverall } from '../calls/trm';

/** A researcher of demo-data.mjs, as the builders read it (Annuaire row before the Employeur is resolved). */
export interface DemoResearcherRow {
  uid_dyna: string;
  Nom: string;
  Prenom: string;
  LABO: string;
  Corps_grade: string;
  DATE_DE_NAISSANCE_JJ_MM_AAAA: string;
  employment_start_date: string;
  employment_end_date?: string;
  IdRef?: string;
  HDR?: string;
}

/** The network.json of the instance, the fields the builders use (functions/_lib/network.js reads the whole file). */
export interface DemoNetwork {
  authors: { id: number; label: string; uid?: string }[];
  pubs: { y: number; a: number[]; title: string; w?: string }[];
}

export interface DemoThesis {
  uid: string;
  nnt: string;
  title: string;
  /** Fuzzy date: the day, or the year alone (theses.fr knows some defences to the year only). */
  defendedOn: string;
  status: 'defended' | 'in_progress';
  institution: string;
  discipline: string;
}

export interface DemoCall {
  callId: string;
  programmeId: string;
  subset: string;
  scheme: string;
  title: string;
  titleFr: string;
  summary: string;
  summaryFr: string;
  objectives: string;
  scope: string;
  taxonomy: Record<string, string>;
  openingDate: string;
  deadlines: string[];
  url: string;
  status: CallStatus;
  /** Labs whose researchers the matching retained (acronyms), strongest first. */
  targets: { lab: string; count: number }[];
}

export interface DemoMatch {
  pairId: string;
  runId: string;
  callId: string;
  personUid: string;
  uid: string;
  personName: string;
  units: string[];
  score: number;
  rawScore: number;
  overall: MatchOverall;
  justification: string;
  justificationFr: string;
  publications: { uid: string; title: string; year: number | null; score: number; relevant: boolean; reason: string }[];
}

export interface DemoRun {
  runId: string;
  programmeId: string;
  subset: string;
  engine: 'trm';
  perimeter: string;
  startedAt: string;
  model: string;
  settings: Record<string, unknown>;
  calls: number;
  failedCalls: number;
}

export interface DemoEligibility {
  rule: EligibilityRule;
  candidates: { uid: string; verdict: EligibilityVerdict; reasons: EligibilityReason[]; phdOn: string }[];
}

export interface DemoFeedback {
  pairId: string;
  author: string;
  verdict: 'relevant' | 'not_relevant' | 'already_applying';
  comment: string;
}

export interface DemoExtras {
  funders: Funder[];
  programmes: Programme[];
  calls: DemoCall[];
  runs: DemoRun[];
  matches: DemoMatch[];
  eligibility: DemoEligibility[];
  theses: DemoThesis[];
  feedback: DemoFeedback[];
}

/** Programmes the demo calls belong to (the built-in ones of lib/calls/programmes.ts, plus a regional one added by hand). */
const ERC = PORTAL_PROGRAMMES_BUILT_IN.find((p) => p.programmeId === 'erc')!;
const MSCA = PORTAL_PROGRAMMES_BUILT_IN.find((p) => p.programmeId === 'msca')!;
export const REGION_FUNDER: Funder = { funderId: 'manual-region-udemo', name: 'Région de Démonstration', country: 'FR', category: 'Régional', url: 'https://example.org/region-demo' };
export const REGION_PROGRAMME: Programme = {
  programmeId: 'manual-region-udemo-emergence', funderId: REGION_FUNDER.funderId, name: 'Appel Émergence (Région de Démonstration)',
  kind: 'thematic', url: 'https://example.org/region-demo/emergence', source: 'manual', refresh: 'manual', subsetLabel: '', active: true,
};

const INSTITUTION = 'Université de Démonstration';
const DISCIPLINE: Record<string, string> = { LIRA: 'Informatique', BIOS: 'Biologie', LMD: 'Mathématiques' };
const TOPIC: Record<string, string> = {
  LIRA: 'apprentissage automatique et réseaux', BIOS: 'génomique et écologie des populations', LMD: 'analyse et probabilités',
};
const TOPIC_EN: Record<string, string> = {
  LIRA: 'machine learning and networks', BIOS: 'genomics and population ecology', LMD: 'analysis and probability',
};

const addDays = (today: string, days: number): string => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const year = (ymd: string): number => Number(String(ymd).slice(0, 4));
/** Small deterministic hash of a string, in [0, n[. */
const bucket = (s: string, n: number): number => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % n;
};
const fullName = (r: DemoResearcherRow): string => `${r.Prenom} ${r.Nom}`;

// ── Theses ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const DEFENDED_GRADES = new Set(['PR', 'MCF', 'DR', 'CR', 'PREM', 'DREM', 'MCFEM', 'Post-doc']);
const THESIS_TITLES = [
  'Contribution à l’étude de {topic} : modèles et applications',
  'Approches computationnelles pour {topic}',
  'Méthodes robustes en {topic}',
  'Analyse et modélisation en {topic}',
];

/** Doctoral theses: one defended thesis per permanent researcher or post-doc, one in progress per PhD student. */
export const demoTheses = (rows: DemoResearcherRow[]): DemoThesis[] => {
  const out: DemoThesis[] = [];
  for (const r of rows) {
    const uid = r.uid_dyna;
    const lab = r.LABO;
    const topic = TOPIC[lab] ?? 'sciences';
    const title = THESIS_TITLES[bucket(uid, THESIS_TITLES.length)].replace('{topic}', topic);
    if (r.Corps_grade === 'Doctorant') {
      out.push({ uid, nnt: `s${100000 + bucket(uid, 899999)}`, title, defendedOn: '', status: 'in_progress', institution: INSTITUTION, discipline: DISCIPLINE[lab] ?? '' });
      continue;
    }
    if (!DEFENDED_GRADES.has(r.Corps_grade) && !(r.Corps_grade === 'IR' && bucket(uid, 2) === 0)) continue;
    const birth = year(r.DATE_DE_NAISSANCE_JJ_MM_AAAA);
    const start = year(r.employment_start_date);
    // Defended around 28, never after the first job; one defence in four is known to the year only.
    const phdYear = Math.min(Number.isFinite(start) ? start : 9999, birth + 27 + bucket(`${uid}y`, 4));
    const month = 1 + bucket(`${uid}m`, 12);
    const day = 1 + bucket(`${uid}d`, 28);
    const defendedOn = bucket(`${uid}p`, 4) === 0 ? String(phdYear) : `${phdYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    out.push({ uid, nnt: `${phdYear}DEMO${String(1 + bucket(uid, 9000)).padStart(4, '0')}`, title, defendedOn, status: 'defended', institution: INSTITUTION, discipline: DISCIPLINE[lab] ?? '' });
  }
  return out;
};

// ── Calls ──────────────────────────────────────────────────────────────────────────────────────────────────────────

interface CallSpec {
  callId: string;
  programmeId: string;
  subset: string;
  scheme?: string;
  title: string;
  titleFr: string;
  summary: string;
  summaryFr: string;
  objectives?: string;
  scope?: string;
  taxonomy?: Record<string, string>;
  /** Opening and deadlines, in days from the day of the seed (negative = past). */
  opening: number;
  deadlines: number[];
  targets: { lab: string; count: number }[];
}

const PORTAL = 'https://example.org/funding-portal/topic-details/';
const CALL_SPECS: CallSpec[] = [
  {
    callId: 'DEMO-HE-CL4-2027-DATA-01', programmeId: HORIZON_EUROPE.programmeId, subset: 'CL4',
    title: 'Trustworthy AI for resilient digital infrastructures', titleFr: 'IA de confiance pour des infrastructures numériques résilientes',
    summary: 'Research and innovation actions on machine learning methods that keep large networked systems dependable: anomaly detection, privacy-preserving training, verifiable models.',
    summaryFr: 'Actions de recherche et d’innovation sur les méthodes d’apprentissage qui gardent les grands systèmes en réseau fiables : détection d’anomalies, apprentissage respectueux de la vie privée, modèles vérifiables.',
    taxonomy: { destination: 'Digital and emerging technologies for competitiveness', call: 'HORIZON-CL4-2027-DATA-01' },
    opening: -45, deadlines: [60], targets: [{ lab: 'LIRA', count: 6 }, { lab: 'LMD', count: 2 }],
  },
  {
    callId: 'DEMO-HE-CL4-2027-DATA-02', programmeId: HORIZON_EUROPE.programmeId, subset: 'CL4',
    title: 'Privacy-preserving data spaces for science', titleFr: 'Espaces de données respectueux de la vie privée pour la science',
    summary: 'Secure sharing of research data across institutions: federated computation, cryptographic protocols, peer-to-peer architectures.',
    summaryFr: 'Partage sécurisé des données de recherche entre établissements : calcul fédéré, protocoles cryptographiques, architectures pair-à-pair.',
    taxonomy: { destination: 'A human-centred and ethical development of digital technologies', call: 'HORIZON-CL4-2027-DATA-02' },
    opening: -45, deadlines: [60], targets: [{ lab: 'LIRA', count: 5 }],
  },
  {
    callId: 'DEMO-HE-CL1-2027-DISEASE-01', programmeId: HORIZON_EUROPE.programmeId, subset: 'CL1',
    title: 'Functional genomics for personalised prevention', titleFr: 'Génomique fonctionnelle pour la prévention personnalisée',
    summary: 'From gene regulation to prevention strategies: integrating multi-omics data, metabolic network models and cohort follow-up.',
    summaryFr: 'De la régulation des gènes aux stratégies de prévention : intégration de données multi-omiques, modèles de réseaux métaboliques et suivi de cohortes.',
    taxonomy: { destination: 'Tackling diseases and reducing disease burden', call: 'HORIZON-CL1-2027-DISEASE-01' },
    opening: -30, deadlines: [95], targets: [{ lab: 'BIOS', count: 6 }, { lab: 'LIRA', count: 1 }],
  },
  {
    callId: 'DEMO-HE-CL6-2027-BIODIV-01', programmeId: HORIZON_EUROPE.programmeId, subset: 'CL6',
    title: 'Modelling biodiversity dynamics under climate pressure', titleFr: 'Modéliser la dynamique de la biodiversité sous pression climatique',
    summary: 'Population models, stochastic dynamics and long-term monitoring to anticipate the resilience of ecosystems.',
    summaryFr: 'Modèles de populations, dynamiques stochastiques et suivi de long terme pour anticiper la résilience des écosystèmes.',
    taxonomy: { destination: 'Biodiversity and ecosystem services', call: 'HORIZON-CL6-2027-BIODIV-01' },
    opening: -30, deadlines: [95], targets: [{ lab: 'BIOS', count: 4 }, { lab: 'LMD', count: 3 }],
  },
  {
    callId: 'DEMO-HE-CL4-2027-TWIN-01', programmeId: HORIZON_EUROPE.programmeId, subset: 'CL4',
    title: 'Mathematical foundations of scalable simulation', titleFr: 'Fondements mathématiques de la simulation à grande échelle',
    summary: 'Numerical analysis, partial differential equations and stochastic methods for digital twins at the scale of a region.',
    summaryFr: 'Analyse numérique, équations aux dérivées partielles et méthodes stochastiques pour des jumeaux numériques à l’échelle d’une région.',
    taxonomy: { destination: 'Digital and emerging technologies for competitiveness', call: 'HORIZON-CL4-2027-TWIN-01' },
    opening: 20, deadlines: [140], targets: [{ lab: 'LMD', count: 6 }, { lab: 'LIRA', count: 2 }],
  },
  {
    callId: 'DEMO-HE-CL4-2026-DATA-07', programmeId: HORIZON_EUROPE.programmeId, subset: 'CL4',
    title: 'Graph methods for large-scale networks (closed edition)', titleFr: 'Méthodes de graphes pour les grands réseaux (édition close)',
    summary: 'Previous edition, kept for the record: graph neural networks and distributed algorithms for communication networks.',
    summaryFr: 'Édition précédente, gardée pour mémoire : réseaux de neurones sur graphes et algorithmes distribués pour les réseaux de communication.',
    taxonomy: { destination: 'Digital and emerging technologies for competitiveness', call: 'HORIZON-CL4-2026-DATA-07' },
    opening: -400, deadlines: [-200], targets: [{ lab: 'LIRA', count: 3 }],
  },
  {
    callId: 'DEMO-ERC-2027-STG', programmeId: ERC.programmeId, subset: 'ERC-StG', scheme: 'ERC-StG',
    title: 'ERC Starting Grant 2027 (demo)', titleFr: 'ERC Starting Grant 2027 (démo)',
    summary: 'Frontier research grants for early-career principal investigators, any field.',
    summaryFr: 'Bourses de recherche exploratoire pour les chercheuses et chercheurs en début de carrière, tous domaines.',
    objectives: 'ERC Starting Grants support excellent Principal Investigators at the career stage at which they are starting their own independent research team or programme.',
    scope: 'Applicants must demonstrate the ground-breaking nature, ambition and feasibility of their scientific proposal. Eligibility: successful defence of PhD between 1 January 2020 and 31 December 2025 (inclusive). Extensions of the eligibility window apply for documented career breaks.',
    taxonomy: { scheme: 'ERC-StG' },
    opening: -20, deadlines: [75], targets: [],
  },
  {
    callId: 'DEMO-ERC-2027-COG', programmeId: ERC.programmeId, subset: 'ERC-CoG', scheme: 'ERC-CoG',
    title: 'ERC Consolidator Grant 2027 (demo)', titleFr: 'ERC Consolidator Grant 2027 (démo)',
    summary: 'Frontier research grants for researchers consolidating their own independent research team, any field.',
    summaryFr: 'Bourses de recherche exploratoire pour les chercheuses et chercheurs qui consolident leur équipe indépendante, tous domaines.',
    objectives: 'ERC Consolidator Grants support excellent Principal Investigators at the career stage at which they are consolidating their own independent research team or programme.',
    scope: 'Eligibility: successful defence of PhD between 1 January 2013 and 31 December 2019 (inclusive). Extensions of the eligibility window apply for documented career breaks.',
    taxonomy: { scheme: 'ERC-CoG' },
    opening: 15, deadlines: [120], targets: [],
  },
  {
    callId: 'DEMO-MSCA-2027-PF', programmeId: MSCA.programmeId, subset: 'MSCA-PF', scheme: 'MSCA-PF',
    title: 'MSCA Postdoctoral Fellowships 2027 (demo)', titleFr: 'Bourses postdoctorales MSCA 2027 (démo)',
    summary: 'Fellowships for post-doctoral researchers to carry out a research project abroad with a host organisation, any field.',
    summaryFr: 'Bourses pour les post-doctorants qui mènent un projet de recherche à l’étranger avec un organisme d’accueil, tous domaines.',
    taxonomy: { scheme: 'MSCA-PF' },
    opening: -10, deadlines: [110], targets: [{ lab: 'LIRA', count: 2 }, { lab: 'BIOS', count: 2 }, { lab: 'LMD', count: 1 }],
  },
  {
    callId: 'DEMO-ANR-AAPG-2027-H12', programmeId: ANR_AAPG.programmeId, subset: 'Numérique et IA',
    title: 'AAPG 2027 — axe H.12 Apprentissage et données (demo)', titleFr: 'AAPG 2027 — axe H.12 Apprentissage et données (démo)',
    summary: 'Generic call of the ANR, axis H.12: learning methods, data science, trustworthy AI; PRC, PRCE, PRCI and JCJC instruments.',
    summaryFr: 'Appel à projets générique de l’ANR, axe H.12 : méthodes d’apprentissage, science des données, IA de confiance ; instruments PRC, PRCE, PRCI et JCJC.',
    taxonomy: { axis: 'H.12', instruments: 'PRC, PRCE, PRCI, JCJC' },
    opening: -60, deadlines: [40, 170], targets: [{ lab: 'LIRA', count: 5 }, { lab: 'LMD', count: 2 }],
  },
  {
    callId: 'DEMO-ANR-AAPG-2027-B04', programmeId: ANR_AAPG.programmeId, subset: 'Sciences de la vie',
    title: 'AAPG 2027 — axe B.04 Biologie des systèmes (demo)', titleFr: 'AAPG 2027 — axe B.04 Biologie des systèmes (démo)',
    summary: 'Generic call of the ANR, axis B.04: systems biology, functional genomics, metabolic modelling.',
    summaryFr: 'Appel à projets générique de l’ANR, axe B.04 : biologie des systèmes, génomique fonctionnelle, modélisation métabolique.',
    taxonomy: { axis: 'B.04', instruments: 'PRC, PRCE, JCJC' },
    opening: -60, deadlines: [40, 170], targets: [{ lab: 'BIOS', count: 5 }],
  },
  {
    callId: 'DEMO-REGION-EMERGENCE-2027', programmeId: REGION_PROGRAMME.programmeId, subset: '',
    title: 'Appel Émergence 2027 — projets interdisciplinaires', titleFr: 'Appel Émergence 2027 — projets interdisciplinaires',
    summary: 'Regional seed funding for interdisciplinary projects led by two labs of the institution, added by hand from the website of the region.',
    summaryFr: 'Amorçage régional de projets interdisciplinaires portés par deux laboratoires de l’établissement, saisi à la main depuis le site de la région.',
    opening: -15, deadlines: [50], targets: [{ lab: 'LMD', count: 2 }, { lab: 'BIOS', count: 2 }, { lab: 'LIRA', count: 2 }],
  },
];

const statusOf = (opening: string, deadlines: string[], today: string): CallStatus =>
  opening > today ? 'forthcoming' : deadlines.some((d) => d >= today) ? 'open' : 'closed';

/** The calls, dated relative to `today` ('YYYY-MM-DD'). */
export const demoCalls = (today: string): DemoCall[] => CALL_SPECS.map((c) => {
  const openingDate = addDays(today, c.opening);
  const deadlines = c.deadlines.map((d) => addDays(today, d));
  return {
    callId: c.callId, programmeId: c.programmeId, subset: c.subset, scheme: c.scheme ?? '', title: c.title, titleFr: c.titleFr,
    summary: c.summary, summaryFr: c.summaryFr, objectives: c.objectives ?? '', scope: c.scope ?? '', taxonomy: c.taxonomy ?? {},
    openingDate, deadlines, url: `${PORTAL}${c.callId.toLowerCase()}`, status: statusOf(openingDate, deadlines, today), targets: c.targets,
  };
});

// ── Matches ────────────────────────────────────────────────────────────────────────────────────────────────────────

const OVERALL_BY_RANK: MatchOverall[] = ['strong', 'strong', 'plausible', 'plausible', 'plausible', 'weak', 'weak', 'weak'];
const JUSTIFICATION = {
  strong: (name: string, topic: string) => `${name} has published several recent works on ${topic} that match the objectives of the call closely; the publications verified below address its central questions.`,
  plausible: (name: string, topic: string) => `Part of the recent work of ${name} on ${topic} relates to the call; the link is plausible but the call targets a broader scope.`,
  weak: (name: string, topic: string) => `Only an indirect link: the publications of ${name} on ${topic} touch the call through its methods, not its objectives.`,
  none: () => '',
};
const JUSTIFICATION_FR = {
  strong: (name: string, topic: string) => `${name} a publié plusieurs travaux récents sur ${topic} qui correspondent étroitement aux objectifs de l’appel ; les publications vérifiées ci-dessous traitent ses questions centrales.`,
  plausible: (name: string, topic: string) => `Une partie des travaux récents de ${name} sur ${topic} se rapporte à l’appel ; le lien est plausible mais l’appel vise un périmètre plus large.`,
  weak: (name: string, topic: string) => `Lien indirect seulement : les publications de ${name} sur ${topic} touchent l’appel par ses méthodes, pas par ses objectifs.`,
  none: () => '',
};

const MATCHED_GRADES = new Set(['PR', 'MCF', 'DR', 'CR', 'IR', 'Post-doc', 'PREM', 'DREM', 'MCFEM']);

/** Publications of a researcher in the network, latest first (empty without network). */
const publicationsOf = (network: DemoNetwork | null, uid: string) => {
  const author = network?.authors.find((a) => a.uid === uid);
  if (!author || !network) return [];
  return network.pubs.filter((p) => p.a.includes(author.id)).sort((a, b) => b.y - a.y);
};

/**
 * One matching run per programme and subset of the calls (as the import of a Topic-to-Researcher Match report does),
 * the researchers of the targeted labs retained for each call: permanent researchers and post-docs present at `today`,
 * the most senior first, strength decreasing with the rank. MSCA retains post-docs and PhD students only.
 */
export const demoMatches = (calls: DemoCall[], rows: DemoResearcherRow[], network: DemoNetwork | null, today: string): { runs: DemoRun[]; matches: DemoMatch[] } => {
  const present = rows.filter((r) => !r.employment_end_date || r.employment_end_date >= today);
  const runs = new Map<string, DemoRun>();
  const matches: DemoMatch[] = [];
  for (const call of calls) {
    const runKey = `${call.programmeId}|${call.subset}`;
    if (!runs.has(runKey)) {
      runs.set(runKey, {
        runId: `demo-${call.programmeId}-${call.subset.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'all'}`, programmeId: call.programmeId, subset: call.subset,
        engine: 'trm', perimeter: INSTITUTION, startedAt: `${addDays(today, -3)}T02:15:00Z`, model: 'demo-matching-model',
        settings: { topK: 8, minScore: 0.3 }, calls: 0, failedCalls: 0,
      });
    }
    const run = runs.get(runKey)!;
    run.calls += 1;
    let rank = 0;
    for (const target of call.targets) {
      const pool = present
        .filter((r) => r.LABO === target.lab)
        .filter((r) => (call.programmeId === MSCA.programmeId ? r.Corps_grade === 'Post-doc' || r.Corps_grade === 'Doctorant' : MATCHED_GRADES.has(r.Corps_grade)))
        // Seeded by the call: each call retains different people of the lab.
        .sort((a, b) => bucket(`${call.callId}${a.uid_dyna}`, 1000) - bucket(`${call.callId}${b.uid_dyna}`, 1000))
        .slice(0, target.count);
      for (const r of pool) {
        const overall = OVERALL_BY_RANK[Math.min(rank, OVERALL_BY_RANK.length - 1)];
        const score = Math.round((0.95 - rank * 0.08 - bucket(`${call.callId}${r.uid_dyna}s`, 5) / 100) * 1000) / 1000;
        const uid = r.uid_dyna;
        const pubs = publicationsOf(network, uid).slice(0, overall === 'strong' ? 3 : 2);
        matches.push({
          pairId: `${call.callId}|local-${uid}`, runId: run.runId, callId: call.callId, personUid: `local-${uid}`, uid, personName: fullName(r),
          units: [r.LABO], score: Math.max(0.3, score), rawScore: Math.max(0.3, score) * 12, overall,
          justification: JUSTIFICATION[overall](fullName(r), TOPIC_EN[r.LABO] ?? 'their field'),
          justificationFr: JUSTIFICATION_FR[overall](fullName(r), TOPIC[r.LABO] ?? 'leur domaine'),
          publications: pubs.map((p, i) => ({
            uid: p.w ?? '', title: p.title, year: p.y, score: Math.round((0.9 - i * 0.12) * 100) / 100, relevant: i === 0 || overall !== 'weak',
            reason: i === 0 ? 'Addresses the central question of the call.' : 'Related method, applied to another object.',
          })),
        });
        rank += 1;
      }
    }
  }
  return { runs: [...runs.values()], matches };
};

// ── Eligibility ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Rules read from the text of the calls (lib/calls/eligibility.ts), and the researchers they make eligible or to check. */
export const demoEligibility = (calls: DemoCall[], rows: DemoResearcherRow[], theses: DemoThesis[], today: string): DemoEligibility[] => {
  const phdOf = new Map(theses.filter((t) => t.status === 'defended').map((t) => [t.uid, t.defendedOn]));
  const present = rows.filter((r) => !r.employment_end_date || r.employment_end_date >= today);
  return calls
    .filter((c) => c.status !== 'closed')
    .flatMap((c) => rulesFromCallText({ callId: c.callId, scheme: c.scheme || c.subset, objectives: c.objectives, scope: c.scope }))
    .map((rule) => ({
      rule,
      candidates: present.flatMap((r) => {
        const phdOn = phdOf.get(r.uid_dyna);
        if (!phdOn) return [];
        const result = evaluate(phdOn, rule);
        return result && result.verdict !== 'ineligible' ? [{ uid: r.uid_dyna, verdict: result.verdict, reasons: result.reasons, phdOn }] : [];
      }),
    }));
};

// ── Everything ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Opinions a few users of the demo left on the strongest matches (counts shown by the tab). */
const demoFeedback = (matches: DemoMatch[]): DemoFeedback[] =>
  matches.filter((m) => m.overall === 'strong').slice(0, 6).map((m, i) => ({
    pairId: m.pairId, author: ['demo-gestionnaire', 'demo-direction'][i % 2],
    verdict: (['relevant', 'relevant', 'already_applying', 'relevant', 'not_relevant', 'relevant'] as const)[i],
    comment: i === 2 ? 'Projet déjà déposé lors de l’édition précédente.' : '',
  }));

export const demoExtras = (rows: DemoResearcherRow[], network: DemoNetwork | null, today: string): DemoExtras => {
  const calls = demoCalls(today);
  const theses = demoTheses(rows);
  const { runs, matches } = demoMatches(calls, rows, network, today);
  return {
    funders: [EU_FUNDER, ANR_FUNDER, REGION_FUNDER],
    programmes: [HORIZON_EUROPE, ERC, MSCA, ANR_AAPG, REGION_PROGRAMME],
    calls, runs, matches,
    eligibility: demoEligibility(calls, rows, theses, today),
    theses,
    feedback: demoFeedback(matches),
  };
};
