// Data contract of the bibliometric dashboard, served by
// /api/dashboard/:slug/publications (dashboard.json file produced by
// scripts/export_dashboard_json.py on the druid-biblio side). Same schema as the
// SoVisu+ mockups (SVP-mockups, DashboardPublication), plus the structure
// metadata and the embedded country labels.

export interface DashboardPublication {
  year: number | null;
  language: string | null;
  isForeignLanguage: boolean;
  pubType: string | null;
  oaStatus: string | null;
  oaColor: string | null;
  isInternational: boolean | null;
  hasApc: boolean;
  apcAmount: number | null;
  apcCurrency: string | null;
  /** OpenAlex APC detail (present only when hasApc). */
  apcDetail: {
    listAmount: number | null;
    listCurrency: string | null;
    listUsd: number | null;
    paidAmount: number | null;
    paidCurrency: string | null;
    paidUsd: number | null;
    correspondingAuthors: string[];
    correspondingInstitutions: string[];
    correspondingCountries: string[];
  } | null;
  /**
   * Publisher transformative agreement (Elsevier/Couperin) — present only for the
   * DOIs of the publisher report (Nantes U). Ground truth that the OpenAlex estimate
   * does not give: `confirmedPayer` = the Nantes U corresponding author triggered the agreement.
   * `model`: gold/hybrid = OA (APC covered by the agreement); subscription = the author
   * waived OA (no APC), kept for tracking. Amounts in €.
   */
  publisherDeal?: {
    source: string;
    agreement: string | null;
    model: 'gold' | 'hybrid' | 'subscription';
    confirmedPayer: boolean;
    listAmountEur: number | null;
    paidAfterDiscountEur: number | null;
  } | null;
  journal: string | null;
  countries: string[];
  subfields: string[];
  partnerInstitutions: {
    name: string;
    cc: string | null;
    city: string | null;
    lat: number | null;
    lon: number | null;
    /** Missing from exports predating 2026-09-03 (backfill in progress). */
    ror?: string | null;
  }[];
  sjrQuartile: string | null;
  /** FNEGE 2025 rank of the journal (1*, 1, 2, 3, 4, EM) — management sciences; missing from exports predating 2026-07-09. */
  fnegeRank?: string | null;
  fwci: number | null;
  citedByCount: number;
  isTop10Percent: boolean | null;
  isTop1Percent: boolean | null;
  teams: string[];
  authorIds: number[];
  hasPhd: boolean;
  /**
   * Total number of authors (all affiliations) — "excluding large
   * collaborations" filter (ALICE/CMS… hyper-authorship). Missing from exports
   * predating 2026-09-15.
   */
  authorCount?: number | null;
  // phase 5: Collaborations tab
  collabTypes: string[];
  sousStructures: string[];
  nantesPartners: string[];
  /**
   * Provenance of each nantesPartners entry (same order): OpenAlex affiliations, the
   * co-authors' lab memberships in the CRISalid graph, or both. Missing when the graph
   * was not used (structures other than the university labs, exports predating 2026-09-29).
   */
  nantesPartnersSource?: ('openalex' | 'crisalid' | 'both')[];
  nationalPartners: {
    name: string;
    city: string | null;
    lat: number | null;
    lon: number | null;
    /** Missing from exports predating 2026-09-03 (backfill in progress). */
    ror?: string | null;
  }[];
  domains: string[];
  // phase 4: Journals / Keywords / Axes / List / Charter
  title: string | null;
  doi: string | null;
  topics: string[];
  chosenTheme: string | null;
  /** Assigned strategic axis (OpenAlex topics classification, see strategicAxes). */
  chosenAxe: string | null;
  /** Rationale of the classification (triggering keywords). */
  axeMotivation: string | null;
  issn: string | null;
  journalAccess: string | null;
  licenceNationale: boolean;
  journalPublisher: string | null;
  charte: {
    score: number | null;
    conforme: boolean | null;
    /** The mention « Nantes Université » appears somewhere in the raw affiliation. */
    nuSeul: boolean;
    /** Best signature line (raw OpenAlex affiliation). */
    signature: string | null;
    /** Acronym of the charter model used for the evaluation. */
    modele: string | null;
    criteres: Record<string, boolean | null>;
  } | null;
  // provenance (Sources tab) — missing from exports predating 2026-07-16
  /** "Winning" source of the ETL merge (CRISalid, BSO, OpenAlex, HAL). */
  sourceDb?: string | null;
  /** All the sources where the publication was seen (crisalid, bso, openalex, hal). */
  sources?: string[];
  /** Sub-sources of the CRISalid harvester (hal, scanr, idref, openalex, scopus). */
  crisalidHarvesters?: string[];
  /** OpenAlex re-enrichment of the CRISalid records: matched_corpus,
   *  found_by_id, found_by_doi, not_found, no_doi. */
  openalexLookup?: string | null;
  // Funding (« Financements » tab) — missing from exports predating 2026-07-21.
  /**
   * Funders acknowledged by the publication (OpenAlex funders + HAL ANR/European
   * projects). ⚠️ A funder on a publication = the publication *acknowledges* it — it means neither "paid
   * Nantes" nor "a Nantes researcher holds the grant". Declarative view, not an accounting one.
   */
  funders?: { id: string | null; name: string; ror: string | null }[];
  /**
   * Projects / grants attached to the publication. `projectId` = funding code
   * (OpenAlex funder_award_id, e.g. « ANR-16-IDEX-0007 », or HAL ANR/European reference).
   */
  awards?: {
    funderId: string | null;
    funderName: string;
    projectId: string | null;
    projectName: string | null;
    source: 'openalex' | 'hal';
  }[];
}

export interface AuthorMeta {
  id: number;
  label: string;
  /**
   * Teams of the author (headcounts). For a composite structure without its own
   * headcounts (`Nantes Université`, `Pôle S&T`), these are the acronyms of its member
   * labs (`teamLabel` = « laboratoire »), resolved by the export from the labs'
   * headcounts and corpora — empty for ≈ 25 % of the signatures (abbreviated
   * OpenAlex spellings). See docs/archive/plan-collab-consortium.md, lot 0.
   */
  teams: string[];
  isPhd: boolean;
}

/** Headcount member (« Membres par équipe » table). */
export interface MemberMeta {
  label: string;
  type: string | null;
  teams: string[];
  isPhd: boolean;
  /** Employer (Employeur column of the headcounts) — missing from exports predating 2026-07-09. */
  employer?: string | null;
  /** Internal author matched by name (null if no publication). */
  authorId: number | null;
  /* Researchers tab attributes (druid-biblio biblio_etl/staff.py, exports since 2026-10-06; absent
   * or null in older exports and for groups). */
  /** Lab membership (cdb vocabulary: stat_mmb, assoc_mmb…), null when not provided. */
  membershipType?: string | null;
  /** permanent / non_permanent / doctorant / emeritus, null when unknown. */
  category?: StaffCategory | null;
  /** Overall FTE (« quotité »), 0-1. */
  fte?: number | null;
  /** Research FTE, 0-1: Annuaire value, or grade default when `researchFteEstimated`. */
  researchFte?: number | null;
  researchFteEstimated?: boolean;
  /** Birth year — authenticated export only (null in the anonymized variant). */
  birthYear?: number | null;
  /** Membership dates (YYYY, YYYY-MM or YYYY-MM-DD). */
  startDate?: string | null;
  endDate?: string | null;
  /** Former members only: « parti » (validated), « ldap » (LDAP departure), « historique ». */
  departureReason?: string | null;
}

export type StaffCategory = 'permanent' | 'non_permanent' | 'doctorant' | 'emeritus';

export interface CountryName {
  fr: string;
  echarts: string;
  eu: boolean;
}

/**
 * Actual OpenAPC APC spending (Couperin consortium, SIFAC accounting) — amounts
 * actually paid by the institution, in €. Block aggregated at institution level,
 * present only for the institution (null for a lab). See openapc-de.
 */
export interface OpenApcData {
  institution: string;
  source: string;
  sourceUrl: string;
  total: number;
  count: number;
  mean: number | null;
  yearMin: number | null;
  yearMax: number | null;
  hybrid: { n: number; total: number };
  gold: { n: number; total: number };
  byYear: { year: number; total: number; n: number }[];
  byPublisher: { label: string; total: number; n: number }[];
  byJournal: { label: string; total: number; n: number }[];
  rows: {
    year: number | null;
    publisher: string;
    journal: string;
    euro: number;
    hybrid: boolean;
    doi: string | null;
  }[];
}

/**
 * Direct OpenAlex positioning for the institution (h-index, citations…) —
 * queried live on /institutions/{id}, independent of the structure's
 * publication corpus (see Benchmark tab, work/druid/benchmark.md §4.1).
 */
export interface BenchmarkOpenAlex {
  openalexId: string;
  ror: string | null;
  worksCount: number | null;
  citedByCount: number | null;
  hIndex: number | null;
  i10Index: number | null;
  meanCitedness2yr: number | null;
  countsByYear: { year: number; worksCount: number; citedByCount: number }[];
}

/** Value of a Leiden Ranking Open Edition indicator and its world percentile. */
export interface BenchmarkLeidenIndicator {
  value: number;
  /** 0-100, share of the reference universities with a lower or equal value. */
  percentile: number | null;
}

/** A university of the Leiden Ranking Open Edition reference dataset, raw values (no
 * percentile — recomputed on the frontend side according to the chosen subgroup). */
export interface BenchmarkLeidenPeer {
  ror: string | null;
  university: string | null;
  country: string | null;
  /** Keys = Leiden Ranking Open Edition codes, raw values only. */
  indicators: Record<string, number>;
}

/** Sub-indicators available for a major Leiden field (drill-down of the Scientific
 * impact axis — see the benchmark action plan phase 5). Always in
 * « publications core » mode (no « toutes publications » variant per field). */
export interface BenchmarkLeidenDomain {
  /** One of the 5 major Leiden fields (e.g. « Biomedical and health sciences »). */
  name: string;
  indicators: Record<string, BenchmarkLeidenIndicator>;
  peers: BenchmarkLeidenPeer[];
}

/**
 * Leiden Ranking Open Edition yardstick — missing (null) as long as the reference
 * dataset has not been imported (scripts/import_leiden_reference.py on the druid-biblio side).
 */
export interface BenchmarkLeiden {
  period: string | null;
  /** Number of reference universities used for the percentile. */
  peerCount: number;
  university: string | null;
  country: string | null;
  /** Date (ISO, day) of the last import of the Leiden reference dataset — mtime of
   * leiden_indicators.csv on the ETL side, null if unavailable. */
  importedAt: string | null;
  /** Always `true` for now (see §3.5 of the benchmark MVP spec: the percentile-normalized
   * indicators — MNCS, PP_top_* — are only valid on the Leiden « core »
   * publications) — will become variable if a core/non-core toggle is added. */
  corePubsOnly: boolean;
  /** Always `false` for now (v1.2 decision of the benchmark spec, taken over as is: fractional
   * counting is out of scope). */
  fracCounting: boolean;
  /** Keys = Leiden Ranking Open Edition codes (P, MNCS, PP_top10…). */
  indicators: Record<string, BenchmarkLeidenIndicator>;
  /**
   * Full reference dataset (all universities of the Leiden Ranking Open Edition,
   * including the institution itself) — serves as a pool for the manual selection
   * of a peer group (see work/druid/benchmark.md §6.2); selection and recomputation
   * of the percentile within the subgroup are done on the frontend side.
   */
  peers: BenchmarkLeidenPeer[];
  /**
   * Scientific impact axis, « toutes les publications » (all publications) mode (core/non-core toggle —
   * see the benchmark action plan phase 3). Keys differ from
   * `indicators`: NO MNCS/PP_top_* (not computed by Leiden outside the core
   * subset), `PP_10_cits` (share with ≥ 10 citations, absolute threshold not normalized by
   * discipline) as a replacement — a different indicator, not an equivalent of
   * `PP_top10`, see the benchmark MVP spec §3.5/§5.1 v1.7. `null` if unavailable.
   */
  allPubsIndicators: Record<string, BenchmarkLeidenIndicator> | null;
  allPubsPeers: BenchmarkLeidenPeer[] | null;
  /** Drill-down per major Leiden field (phase 5) — always in « publications core »
   * mode. [] if no field has a row for this institution. */
  domains: BenchmarkLeidenDomain[];
}

/**
 * OpenAlex world reference dataset (domains/subfields) for the disciplinary profile —
 * denominator of the specialization index computed on the frontend side (local share of
 * the institution / world share). Null as long as the reference dataset has not been imported
 * (scripts/import_openalex_topics_reference.py on the druid-biblio side); the local profile
 * (distribution, concentration) then remains computable, without specialization index.
 */
export interface BenchmarkTopicsReference {
  domains: { id: string; name: string; worksCount: number }[];
  subfields: { id: string; name: string; domainId: string; domainName: string; worksCount: number }[];
}

/** Block of the Benchmark tab — null if the structure is not an eligible institution. */
export interface BenchmarkData {
  openalex: BenchmarkOpenAlex;
  leiden: BenchmarkLeiden | null;
  topicsReference: BenchmarkTopicsReference | null;
}

export interface DashboardDataset {
  lab: string;
  name: string;
  slug: string;
  teamLabel: string;
  /** Research FTE entered in configuration (null if not filled in). */
  etpr: number | null;
  /** Default scope of the structure: true = restricted to the headcounts. */
  filterToEffectifs: boolean;
  /** Signature model of the NU charter for the structure (null if missing). */
  charteModele: string | null;
  /** Composite: no signature of its own, aggregated tracking of the member labs. */
  charteComposite: boolean;
  /** Strategic axes defined in configuration (name + classification keywords). */
  strategicAxes: { name: string; keywords: string[] }[];
  publications: DashboardPublication[];
  /** Actual OpenAPC/SIFAC APC spending (institution aggregate, null if unavailable). */
  openapc?: OpenApcData | null;
  /** OpenAlex positioning + Leiden Ranking Open Edition (Benchmark tab). */
  benchmark?: BenchmarkData | null;
  authors: AuthorMeta[];
  members: MemberMeta[];
  /** Validated members who left (Researchers tab pro rata counts only; absent from older exports). */
  formerMembers?: MemberMeta[];
  /** Author ids matched to the headcounts (also present in the public variant). */
  effectifsAuthorIds: number[];
  countryNames: Record<string, CountryName>;
}
