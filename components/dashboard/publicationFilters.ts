// Filters of the « Liste des publications » (publication list) tab — pivot of the cross-tab links.
//
// Any tab can open the pre-filtered list via the `onOpenList(filters)` callback
// provided by DashboardPage (e.g. the « Publis » column of the
// « Toutes les revues » table opens the list filtered on the journal).
// To add a link from a new tab: pass `onOpenList` as a prop
// and call `onOpenList({ country: 'DE' })`, `onOpenList({ team: 'ComBi' })`, etc.
// Each field of PubFilters maps to one dimension of DashboardPublication;
// all fields are optional and combine as a logical AND.

import { DashboardDataset, DashboardPublication } from './types';
import { languageLabel, oaLabel, countryLabel } from './labels';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { accessLabel, AXE_OTHER, charterCompliant } from './phase4Aggregates';
import { comboLabelOf } from './sourcesAggregates';
import { buildPartnerCatalog, partnerKey } from './collabAggregates';
import { FUNDER_CATEGORY_LABELS, funderCategory, fundersOf, hasFunding } from './fundersAggregates';

/** Effective strategic axis of a publication (1st axis if multiple, « Autre » otherwise). */
export function axeOfPub(p: DashboardPublication): string {
  const raw = (p.chosenAxe ?? '').split('|')[0].trim();
  return raw || AXE_OTHER;
}

export interface PubFilters {
  /** Free-text search (title, journal, DOI). */
  q?: string;
  /** Exact year (the dashboard's global range applies on top). */
  year?: number;
  /** Document type (exported French label, e.g. « Article de revue »). */
  pubType?: string;
  /** Open access status (diamond/gold/green/hybrid/bronze/closed/unknown). */
  oaStatus?: string;
  /** Language (ISO code). */
  language?: string;
  /** Exact journal name. */
  journal?: string;
  /** Journal publisher. */
  publisher?: string;
  /** SJR quartile (Q1…Q4). */
  quartile?: string;
  /** NU access category of the journal (JOURNAL_ACCESS_* keys). */
  journalAccess?: string;
  /** Journal under ISTEX national license. */
  licenceNationale?: boolean;
  /** Internal team. */
  team?: string;
  /** Sub-structure / internal lab (composite structures). */
  sousStructure?: string;
  /** Employment type of at least one internal author (effectifs.csv, private corpus). */
  memberType?: string;
  /** Specific internal author (dataset id). */
  authorId?: number;
  /** Involves at least one PhD student. */
  hasPhd?: boolean;
  /** Collaboration category (collabTypes values of the export). */
  collabType?: string;
  /** Partner country (ISO-2 code from countries). */
  country?: string;
  /** Other co-signing `Nantes Université` lab. */
  nantesPartner?: string;
  /** Co-signing French institution (outside NU). */
  nationalPartner?: string;
  /** International partner institution (OpenAlex name). */
  partnerInstitution?: string;
  /**
   * Group of partner institutions (national and/or international) selected
   * via PartnerInstitutionPicker — ROR-or-name keys (see PartnerCatalogEntry.key in
   * collabAggregates.ts), matches if the publication has at least one partner in the
   * group. Phase 3 of the « sélecteur d'institutions » plan (2026-09-03).
   */
  partnerKeys?: string[];
  /** Publication with ≥ 1 foreign country. */
  international?: boolean;
  /** OpenAlex domain. */
  domain?: string;
  /** OpenAlex subfield. */
  subfield?: string;
  /** OpenAlex topic. */
  topic?: string;
  /**
   * Group of OpenAlex subfields and/or topics retained by the AI thematic analysis
   * (see PartnerBilanSection, « analyse IA des thématiques de collaboration » scenario
   * of 2026-09-03) — matches if the publication has at least one subfield OR one topic
   * in the group (both vocabularies are mixed in a single array: their labels
   * never overlap, so there is no ambiguity in testing them together).
   * Same multi-value mechanics as partnerKeys (phase 3 of the previous plan).
   */
  themeKeys?: string[];
  /** Strategic axis (chosen_theme). */
  theme?: string;
  /** Retained strategic axis (chosen_axe, see the strategic axes tab). */
  axe?: string;
  /** Source combination — canonical label of the Sources tab
   *  (e.g. « Harvester CRISalid + OpenAlex + HAL », see comboLabelOf). */
  sourceCombo?: string;
  /** APC paid (hasApc). */
  hasApc?: boolean;
  /** Top 10 % most cited publications. */
  top10?: boolean;
  /** Top 1 % most cited publications. */
  top1?: boolean;
  /** Signature compliant with the charter (export threshold, unless `charteSeuil` is given). */
  charterCompliant?: boolean;
  /** Threshold (fraction 0-1) to apply to `charterCompliant` instead of the export's fixed threshold —
   * lets the Charter tab make the opened list match the threshold adjusted by the
   * user (review lot 8: without it, the chart and the opened list diverged). */
  charteSeuil?: number;
  /**
   * Exclude large collaborations: publications with more than `maxAuthors` authors
   * (DashboardPublication.authorCount, missing from exports predating 2026-09-15:
   * without a value, the publication is kept). Backs the filter « Exclure les grandes collaborations »
   * of PartnerBreakdownSection (lot 4, docs/archive/plan-collab-consortium.md).
   */
  maxAuthors?: number;
  /**
   * Acknowledges at least one funder (OpenAlex funders or HAL projects — declarative, see
   * DashboardPublication.funders). « Analyse des financements » template, docs/plan-mes-rapports.md lot 10.
   */
  funded?: boolean;
  /** Acknowledges a funder of this category (FunderCategory key, funderCategory()). */
  funderCategory?: string;
  /** Acknowledges this funder (canonical name, canonFunderName()). */
  funder?: string;
}

/** Resolution context built once per dataset (headcount matches). */
export interface FilterContext {
  /** authorId → employment types (an author may appear several times). */
  memberTypesByAuthorId: Map<number, Set<string>>;
  /** authorId → label (for the authorId filter chip). */
  authorLabelById: Map<number, string>;
  /** Country code → French label. */
  countryLabel: (cc: string) => string;
  /** ROR-or-name key (PartnerCatalogEntry.key) → displayed name, for the partnerKeys chip. */
  partnerNameByKey: Map<string, string>;
}

export function buildFilterContext(dataset: DashboardDataset): FilterContext {
  const memberTypesByAuthorId = new Map<number, Set<string>>();
  for (const m of dataset.members ?? []) {
    if (m.authorId == null || !m.type) continue;
    const set = memberTypesByAuthorId.get(m.authorId) ?? new Set<string>();
    set.add(m.type);
    memberTypesByAuthorId.set(m.authorId, set);
  }
  const authorLabelById = new Map<number, string>();
  for (const a of dataset.authors ?? []) authorLabelById.set(a.id, a.label);
  const partnerNameByKey = new Map(
    buildPartnerCatalog(dataset.publications).map((c) => [c.key, c.name]),
  );
  return {
    memberTypesByAuthorId,
    authorLabelById,
    countryLabel: (cc) => countryLabel(cc, dataset.countryNames),
    partnerNameByKey,
  };
}

export function matchesFilters(
  p: DashboardPublication,
  f: PubFilters,
  ctx: FilterContext,
): boolean {
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    if (
      q &&
      !(p.title ?? '').toLowerCase().includes(q) &&
      !(p.journal ?? '').toLowerCase().includes(q) &&
      !(p.doi ?? '').toLowerCase().includes(q)
    )
      return false;
  }
  if (f.year != null && p.year !== f.year) return false;
  if (f.pubType && p.pubType !== f.pubType) return false;
  if (f.oaStatus && (p.oaStatus ?? 'unknown') !== f.oaStatus) return false;
  if (f.language && (p.language ?? 'unknown') !== f.language) return false;
  if (f.journal && p.journal !== f.journal) return false;
  if (f.publisher && p.journalPublisher !== f.publisher) return false;
  if (f.quartile && p.sjrQuartile !== f.quartile) return false;
  if (f.journalAccess && (p.journalAccess ?? 'inconnu') !== f.journalAccess) return false;
  if (f.licenceNationale && !p.licenceNationale) return false;
  if (f.team && !p.teams.includes(f.team)) return false;
  if (f.sousStructure && !p.sousStructures.includes(f.sousStructure)) return false;
  if (f.memberType) {
    const ok = p.authorIds.some((id) => ctx.memberTypesByAuthorId.get(id)?.has(f.memberType!));
    if (!ok) return false;
  }
  if (f.authorId != null && !p.authorIds.includes(f.authorId)) return false;
  if (f.hasPhd && !p.hasPhd) return false;
  if (f.collabType && !p.collabTypes.includes(f.collabType)) return false;
  if (f.country && !p.countries.includes(f.country)) return false;
  if (f.nantesPartner && !p.nantesPartners.includes(f.nantesPartner)) return false;
  if (f.nationalPartner && !p.nationalPartners.some((n) => n.name === f.nationalPartner))
    return false;
  if (f.partnerInstitution && !p.partnerInstitutions.some((i) => i.name === f.partnerInstitution))
    return false;
  if (f.partnerKeys && f.partnerKeys.length > 0) {
    // Same keys as the partner catalog (partnerKey): ROR, else `<scope>:<name>` — comparing with the
    // bare name never matched the institutions without a ROR (plan-mes-rapports lot 7).
    const keys = f.partnerKeys;
    if (
      !p.partnerInstitutions.some((o) => keys.includes(partnerKey(o, 'international'))) &&
      !p.nationalPartners.some((o) => keys.includes(partnerKey(o, 'national')))
    ) return false;
  }
  if (f.international && p.isInternational !== true) return false;
  if (f.domain && !p.domains.includes(f.domain)) return false;
  if (f.subfield && !p.subfields.includes(f.subfield)) return false;
  if (f.topic && !p.topics.includes(f.topic)) return false;
  if (f.themeKeys && f.themeKeys.length > 0) {
    const ok = f.themeKeys.some((k) => p.subfields.includes(k) || p.topics.includes(k));
    if (!ok) return false;
  }
  if (f.theme && p.chosenTheme !== f.theme) return false;
  if (f.axe && axeOfPub(p) !== f.axe) return false;
  if (f.sourceCombo && comboLabelOf(p.sources) !== f.sourceCombo) return false;
  if (f.hasApc && !p.hasApc) return false;
  if (f.top10 && p.isTop10Percent !== true) return false;
  if (f.top1 && p.isTop1Percent !== true) return false;
  if (f.charterCompliant) {
    const conf = f.charteSeuil != null ? charterCompliant(p, f.charteSeuil) : p.charte?.conforme === true;
    if (!conf) return false;
  }
  if (f.maxAuthors != null && typeof p.authorCount === 'number' && p.authorCount > f.maxAuthors)
    return false;
  if (f.funded && !hasFunding(p)) return false;
  if (f.funderCategory && !fundersOf(p).some((name) => funderCategory(name) === f.funderCategory)) return false;
  if (f.funder && !fundersOf(p).includes(f.funder)) return false;
  return true;
}

/** Boolean "checkbox" fields (chip without value). */
const FLAG_LABELS: Partial<Record<keyof PubFilters, MessageDescriptor>> = {
  licenceNationale: msg`National licence (ISTEX)`,
  hasPhd: msg`PhD student involved`,
  international: msg`International collaboration`,
  hasApc: msg`APC paid`,
  top10: msg`Top 10% citations`,
  top1: msg`Top 1% citations`,
  charterCompliant: msg`Signature compliant with the charter`,
  funded: msg`Acknowledges a funder`,
};

export interface FilterChip {
  key: keyof PubFilters;
  label: string;
}

/** Chips of the active filters (excluding free-text search, shown in its own field). */
export function describeFilters(f: PubFilters, ctx: FilterContext): FilterChip[] {
  const chips: FilterChip[] = [];
  // Outside a React component: we go through `i18n._` (callers re-render on
  // language change via I18nProvider — see PublicationsListTab).
  const _ = (d: MessageDescriptor) => i18n._(d);
  const push = (key: keyof PubFilters, label: string) => chips.push({ key, label });
  if (f.year != null) push('year', _(msg`Year: ${f.year}`));
  if (f.pubType) push('pubType', _(msg`Type: ${f.pubType}`));
  if (f.oaStatus) push('oaStatus', _(msg`Open access: ${oaLabel(f.oaStatus)}`));
  if (f.language) push('language', _(msg`Language: ${languageLabel(f.language)}`));
  if (f.journal) push('journal', _(msg`Journal: ${f.journal}`));
  if (f.publisher) push('publisher', _(msg`Publisher: ${f.publisher}`));
  if (f.quartile) push('quartile', _(msg`Quartile: ${f.quartile}`));
  if (f.journalAccess) push('journalAccess', _(msg`NU access: ${accessLabel(f.journalAccess)}`));
  if (f.team) push('team', _(msg`Team: ${f.team}`));
  if (f.sousStructure) push('sousStructure', _(msg`Lab: ${f.sousStructure}`));
  if (f.memberType) push('memberType', _(msg`Employment type: ${f.memberType}`));
  if (f.authorId != null) {
    const author = ctx.authorLabelById.get(f.authorId) ?? `#${f.authorId}`;
    push('authorId', _(msg`Author: ${author}`));
  }
  if (f.collabType) push('collabType', _(msg`Collaboration: ${f.collabType}`));
  if (f.country) push('country', _(msg`Country: ${ctx.countryLabel(f.country)}`));
  if (f.nantesPartner) push('nantesPartner', _(msg`NU lab: ${f.nantesPartner}`));
  if (f.nationalPartner) push('nationalPartner', _(msg`National partner: ${f.nationalPartner}`));
  if (f.partnerInstitution)
    push('partnerInstitution', _(msg`Partner: ${f.partnerInstitution}`));
  if (f.partnerKeys && f.partnerKeys.length > 0) {
    const names = f.partnerKeys.map((k) => ctx.partnerNameByKey.get(k) ?? k);
    const joined = names.join(', ');
    push(
      'partnerKeys',
      names.length === 1 ? _(msg`Partner institution: ${names[0]}`) : _(msg`Partner institutions: ${joined}`),
    );
  }
  if (f.domain) push('domain', _(msg`Domain: ${f.domain}`));
  if (f.subfield) push('subfield', _(msg`Subfield: ${f.subfield}`));
  if (f.topic) push('topic', _(msg`Topic: ${f.topic}`));
  if (f.themeKeys && f.themeKeys.length > 0) {
    const joined = f.themeKeys.join(', ');
    push(
      'themeKeys',
      f.themeKeys.length === 1 ? _(msg`Subject: ${f.themeKeys[0]}`) : _(msg`Subjects: ${joined}`),
    );
  }
  if (f.theme) push('theme', _(msg`Axis: ${f.theme}`));
  if (f.axe) push('axe', _(msg`Strategic axis: ${f.axe}`));
  if (f.sourceCombo) push('sourceCombo', _(msg`Sources: ${f.sourceCombo}`));
  if (f.maxAuthors != null) push('maxAuthors', _(msg`Excluding large collaborations (≤ ${f.maxAuthors} authors)`));
  if (f.funderCategory) {
    const category = FUNDER_CATEGORY_LABELS[f.funderCategory] ? _(FUNDER_CATEGORY_LABELS[f.funderCategory]) : f.funderCategory;
    push('funderCategory', _(msg`Funders: ${category}`));
  }
  if (f.funder) push('funder', _(msg`Funder: ${f.funder}`));
  for (const [key, label] of Object.entries(FLAG_LABELS) as [keyof PubFilters, MessageDescriptor][]) {
    if (f[key]) push(key, _(label));
  }
  return chips;
}

export function countActiveFilters(f: PubFilters): number {
  // charteSeuil goes with charterCompliant (same chip, see describeFilters) — counting it separately
  // inflated the « N filtres actifs » badge with no matching chip (review lot 9a).
  return Object.entries(f).filter(
    ([k, v]) => k !== 'q' && k !== 'charteSeuil' && v != null && v !== '' && !(Array.isArray(v) && v.length === 0),
  ).length;
}

/** Distinct values available for each select of the filter panel. */
export interface FilterOptions {
  years: number[];
  pubTypes: string[];
  oaStatuses: string[];
  languages: string[];
  journals: string[]; // sorted by decreasing number of publications
  quartiles: string[];
  journalAccesses: string[];
  teams: string[];
  sousStructures: string[];
  memberTypes: string[];
  collabTypes: string[];
  countries: { cc: string; label: string }[];
  domains: string[];
  subfields: string[];
  themes: string[];
  /** Source combinations, sorted by decreasing volume (as in the Sources tab). */
  sourceCombos: string[];
  hasCharter: boolean;
}

const collator = new Intl.Collator('fr');

function sortedUnique(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort(collator.compare);
}

export function buildFilterOptions(
  dataset: DashboardDataset,
  ctx: FilterContext,
): FilterOptions {
  const pubs = dataset.publications;
  const journalCounts = new Map<string, number>();
  for (const p of pubs) {
    if (p.journal) journalCounts.set(p.journal, (journalCounts.get(p.journal) ?? 0) + 1);
  }
  const ccs = sortedUnique(pubs.flatMap((p) => p.countries));
  const comboCounts = new Map<string, number>();
  for (const p of pubs) {
    const combo = comboLabelOf(p.sources);
    if (combo) comboCounts.set(combo, (comboCounts.get(combo) ?? 0) + 1);
  }
  const memberTypes = new Set<string>();
  for (const types of ctx.memberTypesByAuthorId.values())
    for (const t of types) memberTypes.add(t);
  return {
    years: Array.from(
      new Set(pubs.map((p) => p.year).filter((y): y is number => typeof y === 'number')),
    ).sort((a, b) => b - a),
    pubTypes: sortedUnique(pubs.map((p) => p.pubType)),
    oaStatuses: sortedUnique(pubs.map((p) => p.oaStatus ?? 'unknown')),
    languages: sortedUnique(pubs.map((p) => p.language)),
    journals: Array.from(journalCounts.entries())
      .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
      .map(([j]) => j),
    quartiles: sortedUnique(pubs.map((p) => p.sjrQuartile)),
    journalAccesses: sortedUnique(pubs.map((p) => p.journalAccess)),
    teams: sortedUnique(pubs.flatMap((p) => p.teams)),
    sousStructures: sortedUnique(pubs.flatMap((p) => p.sousStructures)),
    memberTypes: Array.from(memberTypes).sort(collator.compare),
    collabTypes: sortedUnique(pubs.flatMap((p) => p.collabTypes)),
    countries: ccs
      .map((cc) => ({ cc, label: ctx.countryLabel(cc) }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    domains: sortedUnique(pubs.flatMap((p) => p.domains)),
    subfields: sortedUnique(pubs.flatMap((p) => p.subfields)),
    themes: sortedUnique(pubs.map((p) => p.chosenTheme)),
    sourceCombos: Array.from(comboCounts.entries())
      .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
      .map(([c]) => c),
    hasCharter: pubs.some((p) => p.charte != null),
  };
}
