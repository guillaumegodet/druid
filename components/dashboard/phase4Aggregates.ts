// Aggregations of the Journals / Keywords / Axes / Charter tabs (phase 4).
// Equivalents of the _tab_journals, keywords, _tab_axes and _tab_charte of the
// old Streamlit dashboard of druid-biblio (removed on 2026-09-10, see git history), recomputed client-side on dashboard.json.

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { DashboardPublication } from './types';
import { CountItem, YearRange } from './overviewAggregates';
import { StackedByYear, StackedByCategory } from './structureAggregates';

function inRangePubs(pubs: DashboardPublication[], range: YearRange): DashboardPublication[] {
  return pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );
}

// ── Journals (full port of the Streamlit _tab_journals) ───────────────────────

/** Nantilus access categories, labels and semantic colors (constants.py). */
export const JOURNAL_ACCESS_ORDER = [
  'abonnement_courant', 'archives', 'licence_nationale',
  'oa_nantilus', 'oa_hors_nantilus', 'ferme', 'inconnu',
];
export const JOURNAL_ACCESS_LABELS: Record<string, MessageDescriptor> = {
  abonnement_courant: msg`Current subscription (NU)`,
  archives: msg`Archives (former subscription)`,
  licence_nationale: msg`National licence (ISTEX)`,
  oa_nantilus: msg`Open access listed in Nantilus`,
  oa_hors_nantilus: msg`Open access not listed`,
  ferme: msg`Closed access, unavailable at NU`,
  inconnu: msg`Access not determined`,
};
export const JOURNAL_ACCESS_COLORS: Record<string, string> = {
  abonnement_courant: '#2E7D32',
  archives: '#7CB342',
  licence_nationale: '#1565C0',
  oa_nantilus: '#00897B',
  oa_hors_nantilus: '#80CBC4',
  ferme: '#C62828',
  inconnu: '#9E9E9E',
};
export function accessLabel(key: string): string {
  const m = JOURNAL_ACCESS_LABELS[key];
  return m ? i18n._(m) : key;
}

const ACCESSIBLE_CATS = new Set([
  'abonnement_courant', 'archives', 'oa_nantilus', 'oa_hors_nantilus',
]);
const OA_OPEN = new Set(['gold', 'diamond', 'hybrid', 'green', 'bronze']);
const NON_JOURNAL_PREFIXES = [
  'hal (', 'theses.fr', 'biorxiv', 'medrxiv', 'arxiv', 'ssrn',
  'research square', 'osf', 'zenodo', 'figshare', 'preprints.org',
  'ssoar', 'openedition',
];
export const NANTILUS_SEARCH =
  'https://nantilus.univ-nantes.fr/vufind/Search/Results?type=ISN&lookfor=';

function isRealJournal(name: string | null): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (!n || n === 'inconnu' || n === 'n/a' || n === 'unknown') return false;
  return !NON_JOURNAL_PREFIXES.some((p) => n.startsWith(p));
}

export interface JournalRow {
  journal: string;
  publisher: string | null;
  issn: string | null;
  publications: number;
  pctOpen: number;
  quartile: string | null;
  citations: number;
  accessCat: string; // JOURNAL_ACCESS_* key
  licenceNationale: boolean;
}

export interface JournalsAggregates {
  // KPI
  nbPubs: number;
  nbJournals: number;
  nbOpen: number;
  nbIssn: number;
  topJournal: { name: string; count: number } | null;
  // NU access
  hasAccessData: boolean;
  byAccess: { key: string; count: number }[]; // JOURNAL_ACCESS_ORDER order
  nbAccessible: number;
  lnJournals: number;
  lnPubs: number;
  accessibleByYear: { year: number; pct: number; total: number }[];
  byOaFallback: CountItem[]; // OA statuses of the journal corpus (if no NU access data)
  // Journals
  rows: JournalRow[]; // sorted by decreasing publications
  top10SharePct: number | null;
  // FNEGE ranking (management sciences) — present if ≥1 publication of the corpus
  // appeared in a ranked journal (fnege.csv reference dataset applied at export time).
  hasFnege: boolean;
  fnege: { rank: string; count: number }[]; // FNEGE_RANK_ORDER order, counts > 0 only
  nbFnegeUnranked: number; // journal articles outside the reference dataset (« non classées »)
}

/** FNEGE ranks from best to worst (EM = emerging journal). */
export const FNEGE_RANK_ORDER = ['1*', '1', '2', '3', '4', 'EM'];

export function aggregateJournals(
  pubs: DashboardPublication[],
  range: YearRange,
): JournalsAggregates {
  // « revues » (journals) corpus: journal articles published in an identified journal
  // (HAL/arXiv/theses.fr repositories captured as source are excluded).
  const corpus = inRangePubs(pubs, range).filter(
    (p) => p.pubType === 'Article de revue' && isRealJournal(p.journal),
  );

  const nbPubs = corpus.length;
  const isOpen = (p: DashboardPublication) => OA_OPEN.has(p.oaStatus ?? '');
  const nbOpen = corpus.filter(isOpen).length;
  const nbIssn = corpus.filter((p) => p.issn && p.issn.trim()).length;
  const hasAccessData = corpus.some((p) => p.journalAccess != null);
  const accessOf = (p: DashboardPublication) => p.journalAccess ?? 'inconnu';
  const accessible = (p: DashboardPublication) =>
    ACCESSIBLE_CATS.has(accessOf(p)) || p.licenceNationale;

  // Aggregate per journal
  const acc = new Map<
    string,
    {
      n: number;
      open: number;
      citations: number;
      issn: string | null;
      publisher: string | null;
      quartile: string | null;
      accessCat: string;
      ln: boolean;
    }
  >();
  for (const p of corpus) {
    const j = p.journal as string;
    const cur = acc.get(j) ?? {
      n: 0, open: 0, citations: 0, issn: null, publisher: null,
      quartile: null, accessCat: 'inconnu', ln: false,
    };
    cur.n += 1;
    if (isOpen(p)) cur.open += 1;
    cur.citations += p.citedByCount ?? 0;
    cur.issn ??= p.issn && p.issn.trim() ? p.issn : null;
    cur.publisher ??= p.journalPublisher;
    cur.quartile ??= p.sjrQuartile;
    if (cur.accessCat === 'inconnu' && p.journalAccess) cur.accessCat = p.journalAccess;
    cur.ln = cur.ln || p.licenceNationale;
    acc.set(j, cur);
  }
  const rows: JournalRow[] = Array.from(acc.entries())
    .map(([journal, v]) => ({
      journal,
      publisher: v.publisher,
      issn: v.issn,
      publications: v.n,
      pctOpen: v.n > 0 ? Math.round((v.open / v.n) * 100) : 0,
      quartile: v.quartile,
      citations: v.citations,
      accessCat: v.accessCat,
      licenceNationale: v.ln,
    }))
    .sort((a, b) => b.publications - a.publications);

  const byAccess = JOURNAL_ACCESS_ORDER.map((key) => ({
    key,
    count: corpus.filter((p) => accessOf(p) === key).length,
  })).filter((c) => c.count > 0);

  const nbAccessible = corpus.filter(accessible).length;
  const lnPubs = corpus.filter((p) => p.licenceNationale).length;
  const lnJournals = rows.filter((r) => r.licenceNationale).length;

  const ym = new Map<number, { total: number; ok: number }>();
  for (const p of corpus) {
    if (typeof p.year !== 'number') continue;
    const cur = ym.get(p.year) ?? { total: 0, ok: 0 };
    cur.total += 1;
    if (accessible(p)) cur.ok += 1;
    ym.set(p.year, cur);
  }
  const accessibleByYear = Array.from(ym.entries())
    .map(([year, v]) => ({
      year,
      pct: Math.round((v.ok / v.total) * 100),
      total: v.total,
    }))
    .sort((a, b) => a.year - b.year);

  const oaCount = new Map<string, number>();
  for (const p of corpus) {
    const k = p.oaStatus ?? 'unknown';
    oaCount.set(k, (oaCount.get(k) ?? 0) + 1);
  }
  const byOaFallback = Array.from(oaCount.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  const top10 = rows.slice(0, 10).reduce((s, r) => s + r.publications, 0);

  // FNEGE ranking: counts per rank on the journal corpus.
  const fnegeCount = new Map<string, number>();
  for (const p of corpus) {
    if (p.fnegeRank) fnegeCount.set(p.fnegeRank, (fnegeCount.get(p.fnegeRank) ?? 0) + 1);
  }
  const fnege = FNEGE_RANK_ORDER.filter((r) => fnegeCount.has(r)).map((rank) => ({
    rank,
    count: fnegeCount.get(rank)!,
  }));
  const nbFnegeRanked = fnege.reduce((s, f) => s + f.count, 0);

  return {
    nbPubs,
    nbJournals: rows.length,
    nbOpen,
    nbIssn,
    topJournal: rows.length ? { name: rows[0].journal, count: rows[0].publications } : null,
    hasAccessData,
    byAccess,
    nbAccessible,
    lnJournals,
    lnPubs,
    accessibleByYear,
    byOaFallback,
    rows,
    top10SharePct: nbPubs > 0 && rows.length > 10 ? Math.round((top10 / nbPubs) * 100) : null,
    hasFnege: fnege.length > 0,
    fnege,
    nbFnegeUnranked: nbPubs - nbFnegeRanked,
  };
}

// ── Keywords (OpenAlex topics) ────────────────────────────────────────────────

export interface KeywordsAggregates {
  topTopics: CountItem[];
  topSubfields: CountItem[];
}

export function aggregateKeywords(
  pubs: DashboardPublication[],
  range: YearRange,
  topN = 25,
): KeywordsAggregates {
  const inRange = inRangePubs(pubs, range);
  const tally = (get: (p: DashboardPublication) => string[]) => {
    const m = new Map<string, number>();
    for (const p of inRange) {
      for (const k of new Set(get(p))) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  };
  return {
    topTopics: tally((p) => p.topics).slice(0, topN),
    topSubfields: tally((p) => p.subfields).slice(0, topN),
  };
}

// ── Strategic axes (chosen_axe + strategic_axes config) ───────────────────────

export const AXE_OTHER = 'Autre / Non classé';

export interface AxesAggregates {
  axeNames: string[]; // config order + `Autre` last
  byAxe: CountItem[];
  byYear: StackedByYear;
  byType: StackedByCategory;
  total: number;
}

/**
 * Aggregates of the strategic axes tab. `axeOf` allows applying the Grist
 * curation corrections on top of the ETL classification.
 */
export function aggregateAxes(
  pubs: DashboardPublication[],
  range: YearRange,
  configAxes: string[],
  axeOf: (p: DashboardPublication) => string,
): AxesAggregates {
  const inRange = inRangePubs(pubs, range);
  const axeNames = [...configAxes, AXE_OTHER];
  const known = new Set(axeNames);
  const norm = (a: string) => (known.has(a) ? a : AXE_OTHER);

  const counts = new Map<string, number>();
  for (const p of inRange) counts.set(norm(axeOf(p)), (counts.get(norm(axeOf(p))) ?? 0) + 1);
  const byAxe = axeNames
    .map((key) => ({ key, count: counts.get(key) ?? 0 }))
    .filter((c) => c.count > 0);
  const present = byAxe.map((c) => c.key);

  const years = Array.from(
    new Set(inRange.map((p) => p.year).filter((y): y is number => y != null)),
  ).sort((a, b) => a - b);
  const byYearSeries = present.map((axe) => {
    const perYear = new Map<number, number>();
    for (const p of inRange) {
      if (typeof p.year === 'number' && norm(axeOf(p)) === axe) {
        perYear.set(p.year, (perYear.get(p.year) ?? 0) + 1);
      }
    }
    return { name: axe, data: years.map((y) => perYear.get(y) ?? 0) };
  });

  const typeSet = Array.from(
    new Set(inRange.map((p) => p.pubType).filter((t): t is string => !!t)),
  );
  const byTypeSeries = present.map((axe) => ({
    name: axe,
    data: typeSet.map(
      (type) => inRange.filter((p) => p.pubType === type && norm(axeOf(p)) === axe).length,
    ),
  }));

  return {
    axeNames: present,
    byAxe,
    byYear: { keys: present, years, series: byYearSeries },
    // types as categories, series = axes (as in the Streamlit: bars stacked per axis)
    byType: { categories: typeSet, series: byTypeSeries },
    total: inRange.length,
  };
}

// ── Signature charter ─────────────────────────────────────────────────────────

export const CRITERE_LABELS: Record<string, string> = {
  nantes_universite: '« Nantes Université »',
  structure: 'Structure (acronyme / nom)',
  code_unite: 'Code unité (UMR/UR…)',
  adresse: 'Adresse postale',
  tutelles: 'Tutelles requises',
};

/**
 * Compliance recomputed for a given threshold (same rule as charte.analyser:
 * the « Nantes Université » mention of the best model is a prerequisite, then
 * the score must reach the threshold).
 */
export function charterCompliant(p: DashboardPublication, seuil: number): boolean {
  const c = p.charte;
  if (!c || c.score == null) return false;
  return c.criteres?.nantes_universite === true && c.score >= seuil;
}

export interface CharteAggregates {
  total: number; // publications of the period
  analysable: number;
  conformes: number;
  nuSeul: number; // « Nantes Université » mention present in the raw affiliation
  scoreMean: number | null;
  scoreHistogram: { label: string; count: number }[];
  rateByYear: { year: number; pctConf: number; pctNu: number; n: number }[];
  byCritere: { key: string; label: string; pct: number }[];
  byTeam: { team: string; pct: number; n: number }[]; // teams with ≥ 3 analyzable publications
}

export function aggregateCharte(
  pubs: DashboardPublication[],
  range: YearRange,
  seuil = 0.75,
): CharteAggregates {
  const inRange = inRangePubs(pubs, range);
  const withCharte = inRange.filter((p) => p.charte != null && p.charte.score != null);
  const analysable = withCharte.length;
  const conformes = withCharte.filter((p) => charterCompliant(p, seuil)).length;
  const nuSeul = withCharte.filter((p) => p.charte!.nuSeul).length;
  const scoreMean = analysable
    ? withCharte.reduce((s, p) => s + (p.charte!.score as number), 0) / analysable
    : null;

  // Score histogram (0.1 step)
  const bins = new Array(11).fill(0);
  for (const p of withCharte) {
    bins[Math.min(10, Math.floor((p.charte!.score as number) * 10))] += 1;
  }
  const scoreHistogram = bins.map((count: number, i: number) => ({
    label: i === 10 ? '100' : String(i * 10),
    count,
  }));

  // Compliance and « NU » mention rates per year
  const ym = new Map<number, { conf: number; nu: number; n: number }>();
  for (const p of withCharte) {
    if (typeof p.year !== 'number') continue;
    const cur = ym.get(p.year) ?? { conf: 0, nu: 0, n: 0 };
    cur.n += 1;
    if (charterCompliant(p, seuil)) cur.conf += 1;
    if (p.charte!.nuSeul) cur.nu += 1;
    ym.set(p.year, cur);
  }
  const rateByYear = Array.from(ym.entries())
    .map(([year, v]) => ({
      year,
      pctConf: Math.round((v.conf / v.n) * 1000) / 10,
      pctNu: Math.round((v.nu / v.n) * 1000) / 10,
      n: v.n,
    }))
    .sort((a, b) => a.year - b.year);

  // Presence rate per criterion
  const critKeys = Object.keys(CRITERE_LABELS);
  const byCritere = critKeys
    .map((key) => {
      const applicable = withCharte.filter((p) => p.charte!.criteres?.[key] != null);
      const ok = applicable.filter((p) => p.charte!.criteres[key] === true).length;
      return {
        key,
        label: CRITERE_LABELS[key],
        pct: applicable.length ? Math.round((ok / applicable.length) * 1000) / 10 : 0,
        n: applicable.length,
      };
    })
    .filter((c) => c.n > 0)
    .map(({ key, label, pct }) => ({ key, label, pct }));

  // Compliance per team (identified teams, ≥ 3 analyzable publications)
  const tm = new Map<string, { conf: number; n: number }>();
  for (const p of withCharte) {
    for (const team of p.teams) {
      if (!team || team === 'Non identifié') continue;
      const cur = tm.get(team) ?? { conf: 0, n: 0 };
      cur.n += 1;
      if (charterCompliant(p, seuil)) cur.conf += 1;
      tm.set(team, cur);
    }
  }
  const byTeam = Array.from(tm.entries())
    .filter(([, v]) => v.n >= 3)
    .map(([team, v]) => ({ team, pct: Math.round((v.conf / v.n) * 100), n: v.n }))
    .sort((a, b) => a.pct - b.pct);

  return {
    total: inRange.length,
    analysable,
    conformes,
    nuSeul,
    scoreMean,
    scoreHistogram,
    rateByYear,
    byCritere,
    byTeam,
  };
}
