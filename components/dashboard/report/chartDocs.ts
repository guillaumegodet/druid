// Editorial catalog of the PDF reports (phase 3): for each chart of the
// catalog (same keys as EMBED_CHARTS/reportCatalog), a reading text
// (description), the computation method actually applied by the client-side
// aggregates (*Aggregates.ts — source of truth, keep in sync), and the
// reading caveats/biases. Plus the global methodological note printed at
// the top of the report.
// ⚠️ First draft written automatically from the aggregates code — editorial
// proofreading by the product owner expected before wide distribution (same for the
// English version, translated as a block in locales/en/messages.po).

import { msg } from '@lingui/core/macro';
import { i18n, type MessageDescriptor } from '@lingui/core';

/** Doc entry resolved in the active language (what EChartCard and the PDF consume). */
export interface ChartDoc {
  /** What the chart shows (1-2 sentences, reading). */
  description: string;
  /** How it is computed (effective aggregation rules). */
  methode: string;
  /** Reading caveats, known biases (optional). */
  limites?: string;
}

/** Source entry: `msg` descriptors (French), translated in locales/en. */
interface ChartDocSource {
  description: MessageDescriptor;
  methode: MessageDescriptor;
  limites?: MessageDescriptor;
}

/** Global methodological note (« Note méthodologique » page of the report). */
export const METHODOLOGY_NOTE: MessageDescriptor[] = [
  msg`Corpus. The publications come from the druid-biblio bibliometric warehouse of Nantes Université, which merges up to four sources depending on each structure's configuration: the CRISalid graph (publications of the structure's current members, harvested from their researcher identifiers in HAL, ScanR, IdRef/Sudoc, OpenAlex and Scopus), the French Open Science Monitor (BSO), OpenAlex (publications affiliated with the structure's OpenAlex institution) and HAL (the structure's collection). Duplicates are merged by DOI, HAL or OpenAlex identifier, then by normalised title; each record is then enriched (OpenAlex indicators retrieved by DOI, Scimago and Nantilus reference data, signature charter, staff lists) and the whole is frozen in a snapshot. The figures in the report reflect the state of the data at the date of the last export, not real time.`,
  msg`Scopes. “Affiliation” keeps the whole merged corpus: publications signed by the structure (OpenAlex, HAL, BSO) and publications of its current members brought in by CRISalid — the latter may include work published before the researcher joined the structure. “Staff” restricts to publications where at least one author is matched (by name) to the structure's validated member list: this scope is closer to the actual staff but may leave out publications whose authors are not yet matched. The period filters on publication year; publications without a year are excluded from all charts.`,
  msg`Citation indicators. Citations, FWCI and percentiles are OpenAlex data at the export date; records unknown to OpenAlex (often without a DOI: theses, books, French-language publications) have none and are left out of these indicators. The FWCI (Field-Weighted Citation Impact) compares a publication's citations with the world average of comparable publications (same field, same year, same type): 1 = world average. The “Top 1% / Top 10%” indicators flag publications whose citation count places them in the upper percentiles of their field and year. These indicators are of little significance for recent publications (short citation window) and for small samples.`,
  msg`Classifications. Topics, subfields and domains are assigned automatically by OpenAlex from the content of the publications (records unknown to OpenAlex have none). Journal quartiles come from the Scimago reference (SJR), matched by ISSN. The open-access status (diamond, gold, green, hybrid, bronze, closed) is that of the source of the kept record: CRISalid graph (Unpaywall, DOAJ and HAL deposit), BSO, or OpenAlex (Unpaywall); a record known only to HAL with a deposited file counts as green. Collaborations and countries are inferred from co-author affiliations, mainly through OpenAlex (countries reported by the BSO, HAL and CRISalid are added); OpenAlex institution disambiguation still contains residual errors (homonymous institutions, incomplete affiliations).`,
  msg`General limitations. Adding CRISalid, HAL and the BSO to OpenAlex improves the coverage of the humanities and social sciences, French-language publications and books, but these remain less well covered than indexed international journals, and the indicators that depend on OpenAlex (citations, topics, collaborations) are missing for part of them. Comparisons between structures from different disciplines should therefore be avoided; trends over time within the same structure are more robust. The CRISalid contribution depends on the researcher identifiers recorded (ORCID, idHAL, IdRef…) and on the date of the last harvest. The most recent year is usually incomplete (indexing delays).`,
];

export const CHART_DOCS: Record<string, ChartDocSource> = {
  // ── Overview ───────────────────────────────────────────────────────────────
  'publications-par-annee': {
    description:
      msg`Annual volume of the structure's publications over the selected period, all types combined.`,
    methode:
      msg`Count of corpus publications by publication year (OpenAlex metadata).`,
    limites:
      msg`The most recent year is incomplete (OpenAlex indexing delays): a drop at the end of the curve cannot be interpreted.`,
  },
  langues: {
    description: msg`Breakdown of publications by language of writing.`,
    methode:
      msg`Language declared in OpenAlex for each publication; “unknown” groups publications with no language recorded.`,
    limites:
      msg`OpenAlex language detection favours English (the language of the metadata); the share of French may be underestimated.`,
  },
  'types-publications': {
    description:
      msg`Breakdown of publications by document type (journal article, conference paper, chapter, etc.).`,
    methode:
      msg`OpenAlex typology normalised by the druid-biblio ETL; each publication counts in a single type.`,
  },
  'acces-ouvert': {
    description:
      msg`Breakdown of publications by open-access status, from the most open (diamond) to closed.`,
    methode:
      msg`Unpaywall status via OpenAlex: diamond (OA journal with no fees), gold (OA journal), green (open repository), hybrid, bronze (readable without a licence), closed; “unknown” if undetermined.`,
    limites:
      msg`The status changes over time (later deposits in repositories); it is frozen at the export date.`,
  },
  'top-mots-cles': {
    description: msg`Most frequent topics (OpenAlex topics) in the corpus.`,
    methode:
      msg`Each publication counts once per distinct topic assigned to it; top 25 ranked.`,
    limites:
      msg`Automatic OpenAlex classification: granularity and labels (translated from English) are sometimes approximate.`,
  },
  'top-sous-domaines': {
    description: msg`Disciplinary subfields (OpenAlex subfields) most present in the corpus.`,
    methode:
      msg`Each publication counts once per distinct subfield; top 25 ranked.`,
    limites: msg`Automatic OpenAlex classification, same caveats as for topics.`,
  },

  // ── Collaborations ─────────────────────────────────────────────────────────
  'collab-typologie': {
    description:
      msg`Breakdown of publications by their broadest collaboration type: international, national, with other Nantes Université labs, between labs of the structure, or no collaboration.`,
    methode:
      msg`Each publication is placed in a single category, the broadest that applies (international > national outside NU > other NU lab > internal > none), based on its co-authors' affiliations. Only publications whose collaboration type could be determined are counted.`,
    limites:
      msg`A publication that is both international and national appears only as international: the categories do not add up with the detailed views.`,
  },
  'collab-structure-top': {
    description:
      msg`Laboratories (or components) of the structure that co-sign the most with other laboratories of the same structure.`,
    methode:
      msg`Publications signed by at least two distinct internal sub-structures; each sub-structure counts once per publication; top 20 shown.`,
  },
  'collab-structure-evolution': {
    description: msg`Annual trend of co-publications between laboratories of the structure.`,
    methode:
      msg`Count by year of publications signed by at least two distinct internal sub-structures.`,
  },
  'collab-nu-top': {
    description:
      msg`Nantes Université laboratories (outside the structure) that co-sign the most with the structure.`,
    methode:
      msg`Partner NU laboratories identified in the affiliations; each laboratory counts once per publication; top 20 shown.`,
  },
  'collab-nu-evolution': {
    description:
      msg`Annual trend of co-publications with other Nantes Université laboratories.`,
    methode:
      msg`Count by year of publications with at least one partner NU laboratory (outside the structure).`,
  },
  'collab-national-top': {
    description:
      msg`French institutions (outside Nantes Université) that co-sign the most with the structure.`,
    methode:
      msg`Partner French institutions identified by OpenAlex in the co-authors' affiliations; each institution counts once per publication; top 20 shown.`,
    limites:
      msg`OpenAlex disambiguation may split a single institution (e.g. a university and its hospital) or aggregate parent bodies (CNRS counted through its units).`,
  },
  'collab-national-evolution': {
    description: msg`Annual trend of co-publications with French institutions outside NU.`,
    methode:
      msg`Count by year of publications with at least one partner French institution outside NU.`,
  },
  'carte-france': {
    description:
      msg`Location of partner French institutions; dot size is proportional to the number of co-publications.`,
    methode:
      msg`Geolocated partner French institutions (OpenAlex/ROR coordinates); value = number of distinct co-signed publications.`,
    limites: msg`Institutions without known coordinates do not appear on the map.`,
  },
  'international-vs-national': {
    description:
      msg`Publications with at least one co-author affiliated abroad (international) versus France-only publications, by year.`,
    methode:
      msg`A publication is international if at least one co-author affiliation is outside France; only publications whose international status could be determined are counted.`,
  },
  'pourcentage-international': {
    description: msg`Share (%) of international publications by year.`,
    methode:
      msg`International publications as a proportion of publications whose international status is known, by year.`,
  },
  'carte-monde': {
    description:
      msg`Countries of foreign partner institutions, coloured by number of co-publications.`,
    methode:
      msg`Each publication counts once per distinct foreign country present in its co-authors' affiliations; France is excluded.`,
  },
  'carte-flux': {
    description:
      msg`Arcs linking Nantes to the cities of foreign partner organisations, proportional to the volume of co-publications.`,
    methode:
      msg`Cities of foreign organisations geolocated by OpenAlex; value = distinct publications co-signed with at least one organisation in the city (a publication counts once per city).`,
    limites: msg`Organisations without a city or coordinates do not appear.`,
  },
  'top-pays': {
    description: msg`Ranking of partner countries by number of co-publications.`,
    methode:
      msg`Each publication counts once per distinct foreign country in its affiliations; France is excluded.`,
  },
  'pays-annees': {
    description:
      msg`Annual intensity of collaborations with the top 15 partner countries (heatmap).`,
    methode:
      msg`For each of the 15 most frequent countries, count by year of publications with at least one affiliation in that country.`,
  },
  'evolution-pays': {
    description: msg`Annual trajectories of the main partner countries (lines).`,
    methode:
      msg`The 8 countries with the most co-publications over the period; a publication counts once per distinct country and per year.`,
  },
  'zone-ue': {
    description:
      msg`Publications co-signed with the European Union versus those co-signed outside the EU.`,
    methode:
      msg`A publication counts on the EU side if at least one partner is in the EU, and on the non-EU side if at least one partner is outside the EU: the same publication can count in both categories.`,
    limites: msg`The two shares therefore do not add up to a total number of publications.`,
  },
  'ue-par-annee': {
    description: msg`Annual trend of EU and non-EU co-publications.`,
    methode: msg`Same rule as the EU / non-EU chart, broken down by year.`,
  },
  'top-partenaires': {
    description: msg`Foreign organisations that co-sign the most with the structure.`,
    methode:
      msg`Organisations outside France identified by OpenAlex; each organisation counts once per publication; top 20 shown.`,
  },
  'flux-sankey': {
    description:
      msg`Flows of international collaborations: from the team to the country, then to the partner organisation.`,
    methode:
      msg`Team → country → organisation triples counted in distinct publications, restricted to the 15 most frequent foreign organisations; without an identified team, the whole structure serves as the root.`,
    limites:
      msg`A multi-team or multi-organisation publication feeds several flows: the widths do not add up to the number of publications.`,
  },
  'sunburst-partenariats': {
    description:
      msg`The same international partnerships (team, country, organisation) as hierarchical rings.`,
    methode: msg`Same data as the flow diagram (top 15 foreign organisations).`,
  },
  'reseau-equipes-organismes': {
    description:
      msg`Graph linking the structure's teams to the foreign organisations they co-publish with.`,
    methode:
      msg`Team ↔ organisation links weighted by the number of co-publications, restricted to the 15 most frequent foreign organisations; publications without an identified team are left out.`,
  },

  // ── Impact and citations ───────────────────────────────────────────────────
  'quartiles-scimago': {
    description:
      msg`Breakdown of articles by the Scimago (SJR) quartile of their journal: Q1 = top quarter of journals in their category.`,
    methode:
      msg`SJR quartile of the publishing journal (Scimago reference applied by the ETL); publications outside Scimago-indexed journals are not counted.`,
    limites:
      msg`The quartile qualifies the journal, not the article; Scimago coverage is better in the exact sciences than in the humanities and social sciences.`,
  },
  'top-par-annee': {
    description:
      msg`Publications among the 1% and 10% most cited of their field and year.`,
    methode:
      msg`OpenAlex citation percentile indicators (normalised by field, year and type); the “Top 10%” bar excludes publications already counted as Top 1%.`,
    limites:
      msg`Of little significance for recent years (citations still accumulating) and for small corpora.`,
  },
  'distribution-fwci': {
    description:
      msg`Distribution of the publications' FWCI: 1 = average world impact of comparable publications; above that, the publication is cited more than the average of its field.`,
    methode:
      msg`Histogram of FWCI in steps of 0.5, capped above 8 (“≥ 8”); only publications with a known FWCI are counted.`,
    limites:
      msg`The FWCI is highly skewed: the mean is pulled up by a few very highly cited publications; prefer reading the distribution.`,
  },

  // ── Books ──────────────────────────────────────────────────────────────────
  'ouvrages-par-annee': {
    description:
      msg`Annual output of books: chapters, monographs and edited volumes.`,
    methode:
      msg`Publications whose type is “Book chapter”, “Monograph”, “Edited volume” or “Coordination”, stacked by type and year.`,
    limites:
      msg`Books are markedly under-covered by OpenAlex, especially in French: these volumes are floors, not totals.`,
  },
  'ouvrages-types': {
    description: msg`Breakdown of books by type.`,
    methode: msg`Same types as the annual chart, aggregated over the period.`,
    limites: msg`Same OpenAlex coverage caveat for books.`,
  },

  // ── Journals ───────────────────────────────────────────────────────────────
  'top-revues': {
    description: msg`Journals in which the structure publishes the most.`,
    methode:
      msg`“Journals” corpus: journal articles published in an identified journal (HAL, arXiv, theses.fr deposits and other platforms captured as source are excluded); ranked by number of articles.`,
  },
  'acces-revues': {
    description:
      msg`Access conditions for Nantes Université readers to the journals where the structure publishes: current subscription, archives, national licence, open access or closed access.`,
    methode:
      msg`Access category assigned to each article from the Nantilus reference (Nantes Université library, SCD) cross-checked with the open-access status; corpus restricted to identified journal articles.`,
    limites:
      msg`Reflects the state of NU subscriptions at the export date; “access undetermined” groups journals not matched to the catalogue.`,
  },
  'acces-revues-barres': {
    description: msg`The same journal access categories, as comparable volumes.`,
    methode: msg`Same data as the access donut, shown as bars.`,
  },
  'acces-revues-evolution': {
    description:
      msg`Share of articles that remain accessible to the Nantes Université community, by publication year.`,
    methode:
      msg`An article is “accessible” if its journal is under current subscription, in archives, under national licence, or if the article is open access; share computed by year on the journals corpus.`,
  },

  // ── APC tracking ───────────────────────────────────────────────────────────
  'apc-evolution': {
    description:
      msg`Estimated annual spending on article processing charges (APC) for the structure's articles.`,
    methode:
      msg`Sum by year of OpenAlex APC amounts, in US dollars: amount paid when known, otherwise the journal's list price; only publications flagged with an APC are counted.`,
    limites:
      msg`Estimate: the list price overstates the amounts actually paid (agreements, waivers) and the estimate does not say which institution paid (the corresponding author is sometimes external).`,
  },
  'apc-par-revue': {
    description: msg`Estimated average APC cost per journal, for the most frequent journals.`,
    methode:
      msg`Average of APC amounts (paid, otherwise list price, in USD) per journal, over the 20 journals with the most publications with an APC.`,
    limites: msg`Same estimation caveats as the annual chart.`,
  },

  // ── Funding ────────────────────────────────────────────────────────────────
  'funders-top': {
    description:
      msg`Funders most frequently acknowledged by the structure's publications, coloured by category.`,
    methode:
      msg`For each publication in the period, its distinct funders are collected (OpenAlex funders/awards + ANR/European projects declared in HAL, with canonicalised labels — e.g. the two spellings of the European Commission merged). Each funder is counted once per publication; ranking over the 15 funders with the most publications.`,
    limites:
      msg`A funder associated with a publication means that the publication acknowledges it — it is neither “this funder paid Nantes Université” nor “a Nantes researcher holds the grant”. Declarative reading (acknowledgements), not accounting. Coverage of funding metadata is very uneven across disciplines (low in the humanities and social sciences).`,
  },
  'funders-categories': {
    description:
      msg`Breakdown of funded publications between broad funder categories (ANR, Europe, national research, regional, international, private/foundations).`,
    methode:
      msg`Each funder is classified by keywords in its label; a publication counts in every category represented among its funders. The “International” category also collects the unidentified remainder — on this corpus, essentially foreign national agencies (NSF, DFG, JSPS…).`,
    limites:
      msg`Heuristic categorisation (by label): misspelt or uncommon funders may be misclassified, and “International” serves as the default category. Same declarative caveat as the main funders chart.`,
  },
  'funders-evolution': {
    description:
      msg`Number of publications acknowledging at least one funder, by year, and the share this represents in that year's corpus.`,
    methode:
      msg`Annual count of publications with at least one funder (OpenAlex funders/awards or HAL ANR/European project); the label shows the share of the year's total publications.`,
    limites:
      msg`The funded share mostly reflects the completeness of funding metadata, not only the actual funding effort; the most recent year is usually incomplete (indexing delays).`,
  },
  'funders-par-labo': {
    description:
      msg`For a composite institution, breakdown of funded publications by laboratory, split by funder category.`,
    methode:
      msg`Each funded publication is attributed to its co-signing laboratories (sub-structures); a co-signed publication counts in each lab. Stacked by funder category, over the 15 labs with the most funded publications.`,
    limites:
      msg`Deliberate double counting of co-signatures between labs (the total exceeds the number of publications). Same declarative and categorisation caveats as the other funding charts.`,
  },

  // ── Strategic axes ─────────────────────────────────────────────────────────
  'axes-repartition': {
    description:
      msg`Breakdown of publications between the strategic axes defined by the structure.`,
    methode:
      msg`Automatic ETL classification: a publication is attached to an axis when its OpenAlex topics contain the keywords configured for that axis; “Other / Unclassified” otherwise.`,
    limites:
      msg`Automatic lexical classification, without the manual corrections made in the tab (these are not carried over into the exported views); volumes per axis depend on the chosen keywords.`,
  },
  'axes-evolution': {
    description: msg`Annual trend of publications by strategic axis.`,
    methode: msg`Same classification, broken down by year.`,
    limites: msg`Same caveats as the breakdown by axis.`,
  },
  'axes-types': {
    description: msg`Publication types (articles, conference papers…) within each axis.`,
    methode: msg`Same classification, crossed with document type.`,
    limites: msg`Same caveats as the breakdown by axis.`,
  },

  // ── Signature charter ──────────────────────────────────────────────────────
  'charte-conformite': {
    description:
      msg`Share of publications whose signature complies with the Nantes Université signature charter.`,
    methode:
      msg`Among “analysable” publications (affiliation signature available in OpenAlex), a publication is compliant if the mention “Nantes Université” is present and its compliance score against the structure's template reaches 75%.`,
    limites:
      msg`The analysis is based on the raw affiliation transcribed by OpenAlex, which may truncate or rephrase the article's actual signature.`,
  },
  'charte-scores': {
    description:
      msg`Distribution of signature compliance scores (0 to 100% of the template criteria).`,
    methode:
      msg`Score of each analysable publication, in 10% bands; the score measures the share of signature template criteria that are met.`,
  },
  'charte-evolution': {
    description:
      msg`Annual progression of the charter compliance rate and of the “Nantes Université” mention rate.`,
    methode:
      msg`Rates computed by year on analysable publications (75% compliance threshold + NU mention required).`,
  },
  'charte-criteres': {
    description:
      msg`Presence rate of each charter criterion in signatures: NU mention, structure, unit code, address, parent bodies.`,
    methode:
      msg`For each criterion, share of publications meeting it among those where it applies to the structure's template.`,
  },
  'charte-equipes': {
    description: msg`Charter compliance rate by team of the structure.`,
    methode:
      msg`Compliance (75% threshold + NU mention) by team, for teams with at least 3 analysable publications.`,
    limites: msg`Small teams close to the 3-publication threshold have unreliable rates.`,
  },

  // ── Teams ──────────────────────────────────────────────────────────────────
  'equipes-repartition': {
    description: msg`Breakdown of publications between the structure's teams.`,
    methode:
      msg`Teams assigned by matching authors to the staff list; a co-signed publication counts in each of its teams; beyond 7 teams, the least productive are folded into “Others”.`,
    limites:
      msg`The total exceeds the number of publications (multiple counting of inter-team co-signatures); “Unidentified” = authors not matched to the staff list.`,
  },
  'equipes-evolution': {
    description: msg`Annual trend of publications by team.`,
    methode: msg`Same team assignment, broken down by year (stacked areas).`,
    limites: msg`Same multiple-counting caveats as the breakdown by team.`,
  },
  'equipes-types': {
    description: msg`Publication types by team.`,
    methode: msg`Same team assignment, crossed with document type.`,
  },
  'radar-disciplinaire': {
    description:
      msg`Compared disciplinary profile of the teams: share of each team's output across a set of OpenAlex subjects (subfields or topics).`,
    methode:
      msg`For each of the 6 most productive teams, share (%) of its publications falling under each axis. Automatic mode: the 8 most frequent subjects of the chosen level in the unit. “By theme (AI)” mode: subjects selected by an LLM among those actually present in the corpus, from a free-text theme, then adjusted by hand.`,
    limites:
      msg`A team's shares do not add up to 100% (a publication may fall under several subjects, and subjects outside the axes are not shown). In AI mode, the selection of axes depends on how the theme is phrased.`,
  },
  'heatmap-disciplinaire': {
    description:
      msg`Disciplinary profile of the teams as a teams × subjects heatmap: same measure as the radar, readable with more teams and comparable column by column.`,
    methode:
      msg`For each of the 12 most productive teams, share (%) of its publications falling under each axis (same axes and modes as the radar). The shade and the number in each cell carry the share.`,
    limites:
      msg`A team's shares do not add up to 100% (a publication may fall under several subjects). Long labels are truncated (tooltip on hover).`,
  },

  // ── PhD students ───────────────────────────────────────────────────────────
  'doctorants-repartition': {
    description: msg`Publications involving at least one PhD student, by team.`,
    methode:
      msg`Publications where at least one author is identified as a PhD student in the staff list, broken down by team (folded into “Others” beyond 7).`,
    limites:
      msg`Depends on the quality of staff matching and on PhD student status being up to date in the lists.`,
  },
  'doctorants-evolution': {
    description: msg`Annual trend of publications involving PhD students.`,
    methode: msg`Same publications, by year and team (stacked areas).`,
  },
  'doctorants-classement': {
    description: msg`Number of publications per PhD student over the period.`,
    methode:
      msg`Count of publications for each author identified as a PhD student in the staff list.`,
    limites:
      msg`Publication volume varies greatly with discipline and thesis year: not to be read as an individual ranking.`,
  },

  // ── Researchers ────────────────────────────────────────────────────────────
  'chercheurs-classement': {
    description: msg`Most prolific authors of the structure over the period.`,
    methode:
      msg`Count of publications per internal author (OpenAlex authors matched by name to the staff list); top 20 shown.`,
    limites:
      msg`Raw volume measures neither quality nor individual contribution (co-signature practices vary greatly across disciplines); matching homonyms remain possible.`,
  },

  // ── Network ────────────────────────────────────────────────────────────────
  'reseau-cosignatures': {
    description:
      msg`Internal co-signature network: each node is an author of the structure, each link a volume of co-signed publications.`,
    methode:
      msg`Internal authors with at least 2 publications over the period (threshold raised to 8 for very large corpora, for readability); colour corresponds to the author's first team.`,
    limites:
      msg`Authors below the threshold and their links are not shown; the spatial layout (force-directed) has no meaning in itself.`,
  },

  // ── Sources / coverage ─────────────────────────────────────────────────────
  'sources-repartition': {
    description:
      msg`Breakdown of publications by their “primary” source: the one that supplied the record kept when the sources were merged.`,
    methode:
      msg`The ETL merges four sources by DOI, HAL/OpenAlex identifier, then normalised title, with priority CRISalid harvester > BSO > OpenAlex > HAL. The primary source is that of the first insertion; the other sources enrich the record without replacing it.`,
    limites:
      msg`The primary source reflects the merge priority, not exhaustiveness: a “CRISalid” publication may also be known to OpenAlex and HAL (see overlaps).`,
  },
  'sources-recouvrements': {
    description:
      msg`Combinations of sources in which each publication was seen: measures the overlaps and the exclusive contribution of each source, including the share of the corpus harvested by the CRISalid harvester.`,
    methode:
      msg`For each publication, the set of sources in which it appears (CRISalid harvester, BSO, OpenAlex by affiliation, HAL by collection) is recorded at merge time; each publication counts in a single combination.`,
    limites:
      msg`The CRISalid harvester harvests by person identifiers (current members) whereas OpenAlex/HAL are queried by affiliation: part of the differences reflects this difference in scope, not a coverage defect.`,
  },
  'sources-evolution': {
    description:
      msg`Annual trend of coverage: publications seen both by the CRISalid harvester and the classic sources, by the harvester alone, or by the classic sources alone.`,
    methode:
      msg`Each publication is classified according to the presence of “crisalid” and of at least one classic source (BSO/OpenAlex/HAL) among its sources, then counted by publication year.`,
    limites:
      msg`Harvester coverage depends on the identifiers recorded for researchers (ORCID, idHAL, IdRef…) and on the date of the last harvests: low coverage may stem from missing identifiers.`,
  },
  'sources-harvester-detail': {
    description:
      msg`Sub-sources harvested by the CRISalid harvester for the structure's publications: HAL, ScanR, IdRef/Sudoc, OpenAlex, Scopus.`,
    methode:
      msg`For each publication seen by the harvester, count of the sources its records in the CRISalid graph come from (a deduplicated publication may have records from several sources).`,
    limites:
      msg`A publication counts in each of its sub-sources: the total exceeds the number of publications. IdRef/Sudoc mainly contributes theses and books, poorly covered elsewhere.`,
  },
  'sources-openalex-lookup': {
    description:
      msg`OpenAlex diagnosis of records whose primary source is the CRISalid harvester: present in the structure's OpenAlex corpus, found in OpenAlex without the structure being credited, or outside OpenAlex.`,
    methode:
      msg`Harvester records absent from the structure's OpenAlex corpus are looked up again in OpenAlex by OpenAlex identifier, then by DOI, to retrieve the indicators (FWCI, citations, co-author countries, APC).`,
    limites:
      msg`“Structure not credited” signals an affiliation defect in OpenAlex (corrections to request); “outside OpenAlex” records (often without DOI: theses, French books) remain without citation indicators.`,
  },

  // ── Benchmark ──────────────────────────────────────────────────────────────
  'benchmark-leiden-percentiles': {
    description:
      msg`Position of the institution (percentile 0-100, higher = better ranked) among the 2831 universities of the Leiden Ranking Open Edition (CWTS), period 2020-2023, all disciplines. P = number of publications. MNCS (Mean Normalized Citation Score) = average impact normalised by field/year/type, 1 = world average. PP_top10 / PP_top1 = share of the institution's publications among the 10% / 1% most cited worldwide (for a comparable field/year). PP_collab / PP_int_collab = share of publications in collaboration (resp. in international collaboration). PP_OA = share of open-access publications.`,
    methode:
      msg`Percentile = rank of the institution's value in the distribution of the 2831 universities of the reference (share of universities with a value lower than or equal to its own). CC0 reference built by CWTS from OpenAlex (same source as the publication corpus), queryable without an account or fees.`,
    limites:
      msg`Built at whole-university level, independently of the period/scope selected above (see the warning banner). A university absent from the reference (outside the Leiden scope, e.g. a non-university grande école) has no percentile.`,
  },
  'benchmark-peer-group-percentiles': {
    description:
      msg`Same principle as the world percentile, but recomputed only within the manually chosen universities (+ the institution itself) rather than over the 2831 universities of the full reference.`,
    methode:
      msg`For each indicator, percentile = share of group members (selected universities + institution) with a value lower than or equal to its own. Changes with every university added or removed.`,
    limites:
      msg`The percentile is of little significance for a very small group (only a few universities): the smaller the group, the more each member weighs on the ranking.`,
  },
  'benchmark-specialisation': {
    description:
      msg`OpenAlex subfields (“subfields”, ~250 in total, the intermediate level between broad domain and precise topic) most represented in the institution's publication corpus over the selected period.`,
    methode:
      msg`Each publication carries one or more subfields (automatic OpenAlex assignment); one occurrence counted per publication and per distinct subfield (a publication can therefore count in several bars).`,
    limites:
      msg`The total number of occurrences exceeds the number of publications (multiple membership). Based on the corpus exported for this structure, not on the official OpenAlex figures in the block above.`,
  },
  'benchmark-domaines': {
    description:
      msg`Breakdown of the institution's publication corpus between the 4 broad domains of the OpenAlex taxonomy: Life Sciences, Physical Sciences, Health Sciences, Social Sciences.`,
    methode:
      msg`Broadest level of the OpenAlex classification hierarchy (Domain > Field > Subfield > Topic); one occurrence counted per publication and per distinct domain.`,
    limites:
      msg`An interdisciplinary publication may count in several domains; the total may exceed the number of publications.`,
  },
  'benchmark-signature': {
    description:
      msg`Subfields where the institution publishes proportionally much more than the world average — a sign of disciplinary “signature” or specialisation, not a judgement of quality.`,
    methode:
      msg`For each subfield with at least 10 publications over the period, ratio = (share of this subfield in the institution's corpus) / (share of this subfield in world OpenAlex output, all domains, all years). Ratio > 1 = over-represented, < 1 = under-represented. World reference: one-off import of works_count per OpenAlex subfield (scripts/import_openalex_topics_reference.py on the ETL side).`,
    limites:
      msg`The world reference is not filtered by year or language: a subfield may appear over-represented simply because it is poorly covered by OpenAlex worldwide (a known bias in the humanities and social sciences). The 10-publication threshold limits statistical noise but remains arbitrary.`,
  },
};

/** Doc entry of a chart, translated in the active language (undefined if none). */
export function chartDoc(id: string): ChartDoc | undefined {
  const d = CHART_DOCS[id];
  if (!d) return undefined;
  return {
    description: i18n._(d.description),
    methode: i18n._(d.methode),
    limites: d.limites ? i18n._(d.limites) : undefined,
  };
}

/** Paragraphs of the methodological note, in the active language. */
export const methodologyNote = (): string[] => METHODOLOGY_NOTE.map((p) => i18n._(p));
