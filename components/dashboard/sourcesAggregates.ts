// Aggregations of the « Sources » tab — provenance of the publications:
// CRISalid harvester (IKG graph, harvesting by person identifiers)
// vs the classic ETL sources (BSO, OpenAlex by affiliation, HAL by
// collection). Relies on the fields added to dashboard.json on
// 2026-07-16 (sourceDb, sources[], crisalidHarvesters[], openalexLookup) —
// missing from earlier exports: the tab then shows a waiting message.

import { DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { StackedByYear, ResearcherItem } from './structureAggregates';

/** Fixed display order of the sources (= color slot, merge priority). */
export const SOURCE_ORDER = ['crisalid', 'bso', 'openalex', 'hal'];

export const SOURCE_LABELS: Record<string, string> = {
  crisalid: 'Harvester CRISalid',
  bso: 'BSO',
  openalex: 'OpenAlex',
  hal: 'HAL',
};

/** Sub-sources harvested by the CRISalid harvester (IKG graph). */
export const HARVESTER_LABELS: Record<string, string> = {
  hal: 'HAL',
  scanr: 'ScanR',
  idref: 'IdRef / Sudoc',
  openalex: 'OpenAlex',
  scopus: 'Scopus',
};

/** Result of the OpenAlex re-enrichment of the harvester records.
 *  found_by_id / found_by_doi: the work exists in OpenAlex but the
 *  structure is not credited there → pool of affiliation corrections. */
export const LOOKUP_LABELS: Record<string, string> = {
  matched_corpus: 'Dans le corpus OpenAlex de la structure',
  found_by_id: 'Dans OpenAlex, structure non créditée',
  found_by_doi: 'Dans OpenAlex, structure non créditée',
  not_found: 'Introuvable dans OpenAlex',
  no_doi: 'Hors OpenAlex (ni DOI ni identifiant)',
};

export const COVERAGE_BOTH = 'Harvester + sources classiques';
export const COVERAGE_CRISALID_ONLY = 'Harvester seul';
export const COVERAGE_CLASSIC_ONLY = 'Sources classiques seules';
const COVERAGE_ORDER = [COVERAGE_BOTH, COVERAGE_CRISALID_ONLY, COVERAGE_CLASSIC_ONLY];

export interface SourcesAggregates {
  /** Publications of the period carrying a provenance (non-empty sources). */
  total: number;
  /** Publications of the period without provenance (export predating the field). */
  missing: number;
  inCrisalid: number;
  crisalidOnly: number;
  classicOnly: number;
  inCrisalidPct: number | null;
  /** "Winning" source of the merge (one publication = one source). */
  bySourceDb: { name: string; value: number }[];
  /** Source combinations (sorted sets) — flat UpSet equivalent. */
  combos: ResearcherItem[];
  /** Coverage per year (harvester ∩ classic / harvester only / classic only). */
  evolution: StackedByYear;
  /** CRISalid sub-sources — a publication counts in each harvester seen. */
  harvesterDetail: { name: string; value: number }[];
  /** OpenAlex diagnostic of the records whose winning source is the harvester. */
  lookup: ResearcherItem[];
}

function sortedSources(sources: string[]): string[] {
  return Array.from(new Set(sources)).sort(
    (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
  );
}

/** Canonical label of a source combination (set sorted in priority
 *  order) — shared between the « Recouvrements entre sources » chart
 *  and the « Sources » filter of the publication list. */
export function comboLabelOf(sources: string[] | null | undefined): string | null {
  if (!sources || sources.length === 0) return null;
  return sortedSources(sources)
    .map((s) => SOURCE_LABELS[s] ?? s)
    .join(' + ');
}

function coverageOf(sources: string[]): string {
  const cr = sources.includes('crisalid');
  const classic = sources.some((s) => s !== 'crisalid');
  if (cr && classic) return COVERAGE_BOTH;
  if (cr) return COVERAGE_CRISALID_ONLY;
  return COVERAGE_CLASSIC_ONLY;
}

export function aggregateSources(
  pubs: DashboardPublication[],
  range: YearRange,
): SourcesAggregates {
  const inRange = pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );
  const withSrc = inRange.filter((p) => (p.sources?.length ?? 0) > 0);

  const sourceDbCount = new Map<string, number>();
  const comboCount = new Map<string, number>();
  const coverageByYear = new Map<string, Map<number, number>>();
  const harvesterCount = new Map<string, number>();
  const lookupCount = new Map<string, number>();
  const years = Array.from(new Set(withSrc.map((p) => p.year as number))).sort((a, b) => a - b);
  let inCrisalid = 0;
  let crisalidOnly = 0;

  for (const p of withSrc) {
    const sources = sortedSources(p.sources as string[]);
    const seenCr = sources.includes('crisalid');
    if (seenCr) inCrisalid += 1;
    if (seenCr && sources.length === 1) crisalidOnly += 1;

    const db = p.sourceDb || 'inconnue';
    sourceDbCount.set(db, (sourceDbCount.get(db) ?? 0) + 1);

    const combo = comboLabelOf(sources)!;
    comboCount.set(combo, (comboCount.get(combo) ?? 0) + 1);

    const cov = coverageOf(sources);
    if (!coverageByYear.has(cov)) coverageByYear.set(cov, new Map());
    const ym = coverageByYear.get(cov)!;
    ym.set(p.year as number, (ym.get(p.year as number) ?? 0) + 1);

    for (const h of p.crisalidHarvesters ?? []) {
      const label = HARVESTER_LABELS[h] ?? h;
      harvesterCount.set(label, (harvesterCount.get(label) ?? 0) + 1);
    }
    if (p.sourceDb === 'CRISalid') {
      const label = LOOKUP_LABELS[p.openalexLookup ?? ''] ?? 'Non déterminé';
      lookupCount.set(label, (lookupCount.get(label) ?? 0) + 1);
    }
  }

  const bySourceDb = Array.from(sourceDbCount.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const combos: ResearcherItem[] = Array.from(comboCount.entries())
    .map(([label, count]) => ({ label, count, teams: [] }))
    .sort((a, b) => b.count - a.count);

  const covSeries = COVERAGE_ORDER.filter((c) => coverageByYear.has(c)).map((c) => ({
    name: c,
    data: years.map((y) => coverageByYear.get(c)?.get(y) ?? 0),
  }));

  const harvesterDetail = Array.from(harvesterCount.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const lookup: ResearcherItem[] = Array.from(lookupCount.entries())
    .map(([label, count]) => ({ label, count, teams: [] }))
    .sort((a, b) => b.count - a.count);

  return {
    total: withSrc.length,
    missing: inRange.length - withSrc.length,
    inCrisalid,
    crisalidOnly,
    classicOnly: withSrc.length - inCrisalid,
    inCrisalidPct: withSrc.length ? Math.round((inCrisalid / withSrc.length) * 100) : null,
    bySourceDb,
    combos,
    evolution: { keys: COVERAGE_ORDER, years, series: covSeries },
    harvesterDetail,
    lookup,
  };
}
