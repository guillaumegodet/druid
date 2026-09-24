// Aggregations of the « Benchmark » tab (see work/druid/benchmark.md §5, disciplinary
// specificity) computed client-side on the OpenAlex domains/subfields
// (`domains`/`subfields`) already present on each publication of the corpus. ⚠️ A
// publication may carry several domains/subfields (implicit fractional
// counting) — as for the other "keyword" aggregations (see aggregateKeywords
// in phase4Aggregates.ts).
//
// The OpenAlex world reference dataset (dataset.benchmark.topicsReference, see
// scripts/import_openalex_topics_reference.py on the druid-biblio side) is used only to
// compute the specialization index (local share / world share) of the subfields
// — missing (null) as long as it has not been imported, the rest of the profile (raw distribution,
// concentration) remaining computable without it.

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { DashboardPublication } from './types';
import { BenchmarkTopicsReference, BenchmarkLeiden, BenchmarkLeidenIndicator } from './types';
import { YearRange } from './overviewAggregates';
import { CONSORTIA } from './consortia';

/** Below this number of publications, the specialization index of a subfield
 * is too noisy (small counts) to be presented as a "signature". */
export const MIN_SIGNATURE_COUNT = 10;

function inRangePubs(pubs: DashboardPublication[], range: YearRange): DashboardPublication[] {
  return pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );
}

export interface SubfieldShare {
  key: string;
  count: number;
  /** Share of this field in the total assignments (a publication may count in several). */
  share: number;
}

export type DomainShare = SubfieldShare;

export interface SignatureSubfield extends SubfieldShare {
  /** OpenAlex world share of this subfield (works_count / world total). */
  worldShare: number;
  /** local share / worldShare — > 1 = over-represented vs the world, < 1 = under-represented. */
  ratio: number;
}

export interface SpecialisationProfile {
  totalPubs: number;
  nbSubfields: number;
  topSubfields: SubfieldShare[];
  /**
   * Herfindahl-Hirschman index over the subfields (sum of squared shares):
   * close to 0 = diversified profile, close to 1 = highly specialized in few fields.
   */
  herfindahl: number;
  /** Distribution by major OpenAlex domain (4 categories). */
  domains: DomainShare[];
  /**
   * Subfields most over-represented vs the OpenAlex world reference dataset,
   * sorted by decreasing ratio. Null if the reference dataset has not been imported on the ETL side.
   */
  signature: SignatureSubfield[] | null;
}

export function computeSpecialisationProfile(
  pubs: DashboardPublication[],
  range: YearRange,
  topicsReference?: BenchmarkTopicsReference | null,
  topN = 15,
): SpecialisationProfile {
  const scoped = inRangePubs(pubs, range);
  const counts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  let assignments = 0;
  let domainAssignments = 0;
  for (const p of scoped) {
    for (const s of new Set(p.subfields)) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
      assignments += 1;
    }
    for (const d of new Set(p.domains)) {
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
      domainAssignments += 1;
    }
  }
  const shares: SubfieldShare[] = Array.from(counts.entries())
    .map(([key, count]) => ({ key, count, share: assignments ? count / assignments : 0 }))
    .sort((a, b) => b.count - a.count);
  const herfindahl = shares.reduce((s, r) => s + r.share * r.share, 0);

  const domains: DomainShare[] = Array.from(domainCounts.entries())
    .map(([key, count]) => ({ key, count, share: domainAssignments ? count / domainAssignments : 0 }))
    .sort((a, b) => b.count - a.count);

  let signature: SignatureSubfield[] | null = null;
  if (topicsReference && topicsReference.subfields.length > 0) {
    const worldTotal = topicsReference.subfields.reduce((s, r) => s + r.worksCount, 0);
    const worldByName = new Map(topicsReference.subfields.map((r) => [r.name, r.worksCount]));
    signature = shares
      .filter((s) => s.count >= MIN_SIGNATURE_COUNT && worldByName.has(s.key))
      .map((s) => {
        const worldShare = (worldByName.get(s.key) ?? 0) / worldTotal;
        return { ...s, worldShare, ratio: worldShare ? s.share / worldShare : 0 };
      })
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, topN);
  }

  return {
    totalPubs: scoped.length,
    nbSubfields: shares.length,
    topSubfields: shares.slice(0, topN),
    herfindahl: Math.round(herfindahl * 1000) / 1000,
    domains,
    signature,
  };
}

export interface SpecialisationReading {
  /** « généraliste » / « modérément concentré » / « très spécialisé ». */
  qualifier: string;
  /** 1 / Herfindahl: number of equal-weight subfields giving the same
   * concentration — bounded by nbSubfields (Cauchy-Schwarz), hence usable as an
   * absolute threshold without having to relate it to the number of active subfields. */
  effectiveN: number;
  /** Number of (most active) subfields cumulating at least half of the
   * publications. */
  coreCount: number;
  /** Cumulative share (%) of these `coreCount` subfields. */
  corePct: number;
}

/**
 * Translates the Herfindahl index into a qualitative reading, modeled on the
 * "numbers equivalent" (1/HHI, see the literature on concentration indices):
 * the number of equal-weight subfields that would give the same HHI value.
 * Unlike a threshold set directly on the HHI (hard to read, see work/druid/
 * todo.txt #16), this number reads directly against `nbSubfields`.
 */
export function describeSpecialisation(profile: SpecialisationProfile): SpecialisationReading | null {
  const { herfindahl, nbSubfields, topSubfields } = profile;
  if (herfindahl <= 0 || nbSubfields === 0) return null;

  const effectiveN = Math.round(1 / herfindahl);
  // Outside a component: i18n._ — the caller (BenchmarkTab) puts i18n.locale in the memo's dependencies.
  const qualifier = effectiveN >= 20 ? i18n._(msg`generalist`) : effectiveN >= 8 ? i18n._(msg`moderately concentrated`) : i18n._(msg`highly specialised`);

  let cumulative = 0;
  let coreCount = 0;
  for (const s of topSubfields) {
    if (cumulative >= 0.5) break;
    cumulative += s.share;
    coreCount += 1;
  }

  return { qualifier, effectiveN, coreCount, corePct: Math.round(cumulative * 100) };
}

// --- Signature weighted by citation impact (see
// the benchmark action plan phase 6 — review remark: the clusters
// should be recomputed according to the chosen weighting, not frozen on volume alone).
// Entirely local (no world reference dataset required, unlike `signature`
// above): compares, for each subfield, its share of received citations to its
// share of publications — a subfield that concentrates more citations than its weight in
// volume would suggest is highlighted, regardless of its absolute size.
// Same implicit fractional counting as the rest of the file (a multi-subfield
// publication counts, and its citations count, in each of its subfields).

export interface SubfieldCitationImpact extends SubfieldShare {
  /** Cumulative citations of this subfield's publications (implicit fractional counting). */
  citations: number;
  /** Share of this subfield in the total assigned citations (same logic as `share`
   * for publications). */
  citationShare: number;
  /** citationShare / share — > 1: this subfield concentrates more citations than its weight
   * in volume, a signal of specialization by impact rather than by volume alone; < 1:
   * the opposite (many publications, few citations). */
  impactRatio: number;
}

export function computeCitationWeightedSignature(
  pubs: DashboardPublication[],
  range: YearRange,
  topN = 10,
): SubfieldCitationImpact[] {
  const scoped = inRangePubs(pubs, range);
  const counts = new Map<string, number>();
  const citations = new Map<string, number>();
  let assignments = 0;
  let totalCitations = 0;
  for (const p of scoped) {
    const cited = p.citedByCount ?? 0;
    for (const s of new Set(p.subfields)) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
      citations.set(s, (citations.get(s) ?? 0) + cited);
      assignments += 1;
      totalCitations += cited;
    }
  }
  return Array.from(citations.entries())
    .filter(([key]) => (counts.get(key) ?? 0) >= MIN_SIGNATURE_COUNT)
    .map(([key, cit]) => {
      const count = counts.get(key) ?? 0;
      const share = assignments ? count / assignments : 0;
      const citationShare = totalCitations ? cit / totalCitations : 0;
      return { key, count, share, citations: cit, citationShare, impactRatio: share ? citationShare / share : 0 };
    })
    .sort((a, b) => b.impactRatio - a.impactRatio)
    .slice(0, topN);
}

// --- Chosen peer group (see work/druid/benchmark.md §6.2) ---------------------------
// leiden.peers (full reference dataset, 2831 universities) is exposed as is by the
// backend; the manual selection AND the recomputation of the percentile within the subgroup
// are done entirely here, client-side.

export type LeidenPeer = BenchmarkLeiden['peers'][number];

/**
 * Percentile of the institution recomputed within the selected peer group only
 * (+ the institution itself, as for the world percentile). Same return shape
 * as `leiden.indicators` — directly reusable by LeidenPercentileChart.
 */
export function computePeerGroupIndicators(
  ownIndicators: Record<string, BenchmarkLeidenIndicator>,
  peers: LeidenPeer[],
  selectedRors: string[],
): Record<string, BenchmarkLeidenIndicator> {
  const selected = new Set(selectedRors);
  const group = peers.filter((p) => p.ror && selected.has(p.ror));
  const result: Record<string, BenchmarkLeidenIndicator> = {};
  for (const [key, own] of Object.entries(ownIndicators)) {
    const values = group
      .map((p) => p.indicators[key])
      .filter((v): v is number => typeof v === 'number');
    values.push(own.value);
    const below = values.filter((v) => v <= own.value).length;
    result[key] = { value: own.value, percentile: Math.round((1000 * below) / values.length) / 10 };
  }
  return result;
}

// --- Weighting (composite score) ----------------------------------------------------
// see work/druid/benchmark.md §6.1: "an indicator-building workshop, not yet another
// ranking". Limited for now to the Scientific impact axis (Leiden Ranking Open
// Edition indicators, already expressed as 0-100 percentiles, hence directly
// combinable) — disciplinary specificity has no usable reference distribution
// (the Herfindahl is only computed for the institution, not for the 2831
// universities of the reference dataset); societal/economic impact have no integrated
// data source (see §4.4). Score = mean of the percentiles weighted by the weights (0 =
// excluded), computed on the chosen reference (world or peer group), not on the
// raw values (scales not comparable between P, MNCS, PP_*).

/** Weight per indicator (0 = excluded from the score). Same keys as LEIDEN_INDICATOR_KEYS on the ETL side. */
export type LeidenWeights = Record<string, number>;

export interface LeidenWeightPreset {
  label: MessageDescriptor;
  description: MessageDescriptor;
  weights: LeidenWeights;
}

export const LEIDEN_WEIGHT_PRESETS: Record<string, LeidenWeightPreset> = {
  balanced: {
    label: msg`Balanced`,
    description: msg`The 7 indicators weigh equally.`,
    weights: { P: 1, MNCS: 1, PP_top10: 1, PP_top1: 1, PP_collab: 1, PP_int_collab: 1, PP_OA: 1 },
  },
  excellence: {
    label: msg`Citation excellence`,
    description: msg`Favours MNCS and the top 1%/10% shares; ignores volume, collaboration and open access.`,
    weights: { P: 0, MNCS: 3, PP_top10: 2, PP_top1: 3, PP_collab: 0, PP_int_collab: 0, PP_OA: 0 },
  },
  international: {
    label: msg`International reach`,
    description: msg`Favours international collaboration; ignores volume and citations.`,
    weights: { P: 0, MNCS: 0, PP_top10: 0, PP_top1: 0, PP_collab: 1, PP_int_collab: 3, PP_OA: 0 },
  },
  openAccess: {
    label: msg`Open access`,
    description: msg`Only keeps the share of open access publications.`,
    weights: { P: 0, MNCS: 0, PP_top10: 0, PP_top1: 0, PP_collab: 0, PP_int_collab: 0, PP_OA: 3 },
  },
  volume: {
    label: msg`Output volume`,
    description: msg`Only keeps the number of publications.`,
    weights: { P: 3, MNCS: 0, PP_top10: 0, PP_top1: 0, PP_collab: 0, PP_int_collab: 0, PP_OA: 0 },
  },
};

export interface WeightedScore {
  /** Weighted mean of the retained percentiles (0-100), null if no weight > 0. */
  score: number | null;
  /** Detail per retained indicator (weight > 0 and percentile available). */
  contributions: { key: string; weight: number; percentile: number }[];
}

// --- Predefined peer groups (see the benchmark action plan phase 2)
// Quick starting point complementing the manual selection (PeerGroupPicker):
// geographic (same country) and size bracket (decile on P), computed client-side on
// the already loaded leiden.peers (full reference dataset, including the institution itself) — no
// new data, follows the §4.3 principle of the benchmark MVP spec.

export interface PredefinedPeerGroup {
  key: string;
  label: string;
  /** RORs of the group's peers, reference institution excluded. */
  rors: string[];
}

/** Other universities of the Leiden reference dataset sharing the institution's country. */
export function computeGeographicPeerGroup(
  peers: LeidenPeer[],
  ownRor: string | null,
  ownCountry: string | null,
): PredefinedPeerGroup | null {
  if (!ownCountry) return null;
  const rors = peers
    .filter((p) => p.ror && p.ror !== ownRor && p.country === ownCountry)
    .map((p) => p.ror as string);
  return rors.length > 0 ? { key: 'geographic', label: i18n._(msg`Same country (${ownCountry})`), rors } : null;
}

/** Other universities of the same size decile (number of publications `P`), the reference
 * institution itself being included in the ranking to determine its decile. */
export function computeSizeDecilePeerGroup(
  peers: LeidenPeer[],
  ownRor: string | null,
  nDeciles = 10,
): PredefinedPeerGroup | null {
  if (!ownRor) return null;
  const ranked = peers
    .filter((p) => p.ror && typeof p.indicators.P === 'number')
    .map((p) => ({ ror: p.ror as string, p: p.indicators.P as number }))
    .sort((a, b) => a.p - b.p);
  const ownIdx = ranked.findIndex((r) => r.ror === ownRor);
  if (ownIdx === -1 || ranked.length < nDeciles) return null;
  const bucketOf = (i: number) => Math.min(nDeciles - 1, Math.floor((i * nDeciles) / ranked.length));
  const ownDecile = bucketOf(ownIdx);
  const rors = ranked
    .filter((r, i) => bucketOf(i) === ownDecile && r.ror !== ownRor)
    .map((r) => r.ror);
  return rors.length > 0
    ? { key: 'size_decile', label: i18n._(msg`Same size bracket (decile ${ownDecile + 1}/${nDeciles})`), rors }
    : null;
}

/** Predefined peer groups per consortium — only the consortia of which the
 * reference institution is a member, and only the members actually present
 * in the loaded Leiden reference dataset (Inalco, too small for the Leiden Ranking Open
 * Edition, is not in it). Member list: consortia.ts. */
export function computeConsortiumPeerGroups(
  peers: LeidenPeer[],
  ownRor: string | null,
): PredefinedPeerGroup[] {
  if (!ownRor) return [];
  const availableRors = new Set(peers.filter((p) => p.ror).map((p) => p.ror as string));
  return CONSORTIA.filter((c) => c.memberRors.includes(ownRor))
    .map((c) => ({
      key: `consortium:${c.key}`,
      label: c.label,
      rors: c.memberRors.filter((r) => r !== ownRor && availableRors.has(r)),
    }))
    .filter((g) => g.rors.length > 0);
}

/** Peer groups by institution type (SIES/MESR typology) — fixed member list
 * (institutional classification, not a user preference), hence hard-coded here like
 * CONSORTIA (consortia.ts). RORs looked up in leiden_universities.csv (druid-biblio
 * reference dataset) on 2026-09-03. Names up to date with the recent EPE mergers: `Franche-Comté` was
 * renamed `Université Marie & Louis Pasteur`, UVSQ was absorbed by Paris-Saclay, Rennes 1
 * and 2 merged into `Université de Rennes` (Rennes 2 has no health faculty and thus is not
 * listed), Toulouse III Paul Sabatier merged into `Université de Toulouse`. To add a
 * type, extend ESTABLISHMENT_TYPES below. */
interface EstablishmentTypeDefinition {
  key: string;
  label: MessageDescriptor;
  /** RORs of the members (potential reference institution included). */
  memberRors: string[];
}

const ESTABLISHMENT_TYPES: EstablishmentTypeDefinition[] = [
  {
    key: 'pluri_sante',
    label: msg`Multidisciplinary universities with health`,
    memberRors: [
      '035xkbk20', // `Aix-Marseille Université`
      '04yrqp957', // `Université d'Angers`
      '057qpr032', // `Université de Bordeaux`
      '00g700j37', // `Université Bourgogne Europe`
      '0372th171', // `Université de Bretagne Occidentale` (Brest)
      '051kpcy16', // `Université de Caen Normandie`
      '01a8ajp46', // `Université Clermont Auvergne`
      '04asdee31', // `Université Marie & Louis Pasteur` (formerly `Franche-Comté`)
      '02rx3b187', // `Université Grenoble Alpes`
      '02kzqn938', // `Université de Lille`
      '02cp04407', // `Université de Limoges`
      '04vfs2w97', // `Université de Lorraine`
      '051escj72', // `Université de Montpellier`
      '03gnr7b55', // `Nantes Université`
      '019tgvf94', // `Université Côte d'Azur`
      '05f82e368', // `Université Paris Cité`
      '02en5vm52', // `Sorbonne Université`
      '03xjwb503', // `Université Paris-Saclay` (includes former UVSQ)
      '05ggc9x40', // `Université Paris-Est Créteil`
      '0199hds37', // `Université Sorbonne Paris Nord`
      '01gyxrk03', // `Université de Picardie Jules Verne`
      '04xhy8q59', // `Université de Poitiers`
      '03hypw319', // `Université de Reims Champagne-Ardenne`
      '015m7wh34', // `Université de Rennes` (formerly Rennes 1)
      '03nhjew95', // `Université de Rouen Normandie`
      '030bahv93', // `Université Jean Monnet (Saint-Étienne)`
      '00pg6eq24', // `Université de Strasbourg`
      '01ahyrz84', // `Université de Toulouse` (includes former Toulouse III Paul Sabatier)
      '02wwzvj46', // `Université de Tours`
      '02ryfmr77', // `Université des Antilles`
      '005ypkf75', // `Université de La Réunion`
    ],
  },
];

/** Predefined peer groups by institution type — only the types of which the
 * reference institution is a member, and only the members actually present
 * in the loaded Leiden reference dataset. */
export function computeEstablishmentTypePeerGroups(
  peers: LeidenPeer[],
  ownRor: string | null,
): PredefinedPeerGroup[] {
  if (!ownRor) return [];
  const availableRors = new Set(peers.filter((p) => p.ror).map((p) => p.ror as string));
  return ESTABLISHMENT_TYPES.filter((t) => t.memberRors.includes(ownRor))
    .map((t) => ({
      key: `type:${t.key}`,
      label: i18n._(t.label),
      rors: t.memberRors.filter((r) => r !== ownRor && availableRors.has(r)),
    }))
    .filter((g) => g.rors.length > 0);
}

export function computeWeightedScore(
  indicators: Record<string, BenchmarkLeidenIndicator>,
  weights: LeidenWeights,
): WeightedScore {
  const contributions: WeightedScore['contributions'] = [];
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [key, ind] of Object.entries(indicators)) {
    const w = weights[key] ?? 0;
    if (w <= 0 || ind.percentile == null) continue;
    contributions.push({ key, weight: w, percentile: ind.percentile });
    weightedSum += w * ind.percentile;
    weightTotal += w;
  }
  return {
    score: weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : null,
    contributions,
  };
}

// --- "Who do I compare myself with" rather than an isolated rank (see
// the benchmark action plan phase 4 — review remark: the composite
// score should above all help understand who one compares with according to the
// chosen weightings). Computes the same weighted score (percentile per indicator, weighted
// mean) for each university of the world reference dataset, to identify those whose
// score is closest to one's own — not a ranking, a spotting of institutions
// comparable on the chosen criteria.

/** Number of elements <= value in an ascending sorted array (binary search). */
function countLessOrEqual(sortedAsc: number[], value: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface RankedPeer {
  ror: string;
  university: string;
  country: string | null;
  /** Same scale as computeWeightedScore: weighted mean of the percentiles (0-100),
   * null if no weighted indicator is available for this university. */
  score: number | null;
}

/**
 * Weighted score of each university in `candidates`, the per-indicator percentiles being
 * computed within `referencePeers` (same distribution for all, so they remain
 * comparable with each other — typically the full world reference dataset, `leiden.peers`).
 */
export function rankPeersByWeightedScore(
  candidates: LeidenPeer[],
  referencePeers: LeidenPeer[],
  weights: LeidenWeights,
): RankedPeer[] {
  const sortedByKey: Record<string, number[]> = {};
  for (const [key, w] of Object.entries(weights)) {
    if (w <= 0) continue;
    sortedByKey[key] = referencePeers
      .map((p) => p.indicators[key])
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
  }
  return candidates
    .filter((c) => c.ror)
    .map((c) => {
      let weightedSum = 0;
      let weightTotal = 0;
      for (const [key, w] of Object.entries(weights)) {
        if (w <= 0) continue;
        const value = c.indicators[key];
        const sorted = sortedByKey[key];
        if (typeof value !== 'number' || !sorted || sorted.length === 0) continue;
        const percentile = (100 * countLessOrEqual(sorted, value)) / sorted.length;
        weightedSum += w * percentile;
        weightTotal += w;
      }
      return {
        ror: c.ror as string,
        university: c.university ?? (c.ror as string),
        country: c.country,
        score: weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : null,
      };
    });
}

// --- Truly peer-relative disciplinary signature, Topic level (see
// the benchmark action plan phase 7 — takes over the §4.4 mechanism of
// the benchmark MVP spec: Leiden only goes down to 5 major fields, insufficient to compare
// disciplinary specificity with a chosen peer group at the fine level of OpenAlex
// Topics). Per-Topic distribution of the peers fetched on demand via
// POST /api/benchmark/topic-distribution (relayed by server.cjs to
// scripts/group_api.py on the druid-biblio side, which queries OpenAlex and caches) —
// NOT embedded in dashboard.json like the rest of the benchmark (different
// cost/freshness, see the MAX_PEER_TOPIC_RORS comment on the backend side).
//
// Matching by topic NAME (not by ID): DashboardPublication.topics already contains
// the OpenAlex labels (`primary_topic.display_name` and secondary scores), exactly
// the format returned by `key_display_name` on the peer side — same convention as `signature`
// (vs world reference dataset) higher up in this file, which already matches by subfield
// name rather than by ID.

/** An OpenAlex topic of a peer institution, as returned by the API. */
export interface PeerTopicCount {
  name: string;
  count: number;
}

/** Response of POST /api/benchmark/topic-distribution — one entry per requested ROR. */
export interface PeerTopicDistributionEntry {
  fetchedAt: string;
  openalexId: string | null;
  topics: Record<string, PeerTopicCount>;
}
export type PeerTopicDistributionResponse = Record<string, PeerTopicDistributionEntry>;

export interface TopicPeerSignature extends SubfieldShare {
  /** Share of this topic in the total assignments of the peer group (same RORs as
   * the request, reference institution excluded). */
  peerShare: number;
  /** local share / peerShare — > 1 = over-represented vs the chosen peer group,
   * < 1 = under-represented. Unlike `SignatureSubfield.ratio` (vs the whole
   * world), this ratio depends on the selected peer group: it changes if the user
   * modifies their selection. */
  ratio: number;
}

/** Local distribution per OpenAlex Topic (same fractional counting conventions as
 * computeSpecialisationProfile, but at Topic level — finer than `subfields`). */
function computeLocalTopicShares(pubs: DashboardPublication[], range: YearRange) {
  const scoped = inRangePubs(pubs, range);
  const counts = new Map<string, number>();
  let assignments = 0;
  for (const p of scoped) {
    for (const topic of new Set(p.topics)) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
      assignments += 1;
    }
  }
  return { counts, assignments };
}

/**
 * Topic-level disciplinary signature, compared with the peer group whose
 * distribution was fetched via `peerData` (result of
 * POST /api/benchmark/topic-distribution for the RORs of the selected group,
 * reference institution excluded from `peerData` or ignored if present).
 */
export function computePeerRelativeTopicSignature(
  pubs: DashboardPublication[],
  range: YearRange,
  peerData: PeerTopicDistributionResponse,
  ownRor: string | null,
  topN = 15,
): TopicPeerSignature[] {
  const { counts, assignments } = computeLocalTopicShares(pubs, range);
  const peerCounts = new Map<string, number>();
  let peerTotal = 0;
  for (const [ror, entry] of Object.entries(peerData)) {
    if (ownRor && ror === ownRor) continue;
    for (const t of Object.values(entry.topics)) {
      peerCounts.set(t.name, (peerCounts.get(t.name) ?? 0) + t.count);
      peerTotal += t.count;
    }
  }
  if (peerTotal === 0) return [];
  return Array.from(counts.entries())
    .filter(([, count]) => count >= MIN_SIGNATURE_COUNT)
    .map(([key, count]) => {
      const share = assignments ? count / assignments : 0;
      const peerShare = (peerCounts.get(key) ?? 0) / peerTotal;
      return { key, count, share, peerShare, ratio: peerShare ? share / peerShare : 0 };
    })
    .filter((r) => r.peerShare > 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, topN);
}
