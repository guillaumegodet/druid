// Aggregations of the « Financements » (funding) tab: funders and projects acknowledged by
// the publications (OpenAlex funders/awards + HAL ANR/European projects, see
// DashboardPublication.funders/awards). All aggregations are client-side.
//
// ⚠️ Scope: a funder on a publication = the publication *acknowledges* it.
// It means neither "paid `Nantes Université`" nor "a Nantes researcher holds the
// grant". Declarative view (acknowledgements), not an accounting one.

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';

export type FunderCategory =
  | 'ANR'
  | 'Europe'
  | 'Recherche nationale'
  | 'Régional'
  | 'Privé / fondations'
  | 'International'
  | 'Autre';

/** Stable display order (legend, stacking) — mapped onto palette slots. */
export const FUNDER_CATEGORIES: FunderCategory[] = [
  'ANR',
  'Europe',
  'Recherche nationale',
  'Régional',
  'International',
  'Privé / fondations',
  'Autre',
];

/** Displayed labels of the funder categories (keys = FunderCategory, stable in the data). */
export const FUNDER_CATEGORY_LABELS: Record<string, MessageDescriptor> = {
  ANR: msg`ANR`,
  Europe: msg`Europe`,
  'Recherche nationale': msg`National research`,
  Régional: msg`Regional`,
  International: msg`International`,
  'Privé / fondations': msg`Private / foundations`,
  Autre: msg`Other`,
};

/** Palette slot (VizTheme.series) per category — color-blindness order preserved. */
export const CATEGORY_COLOR_SLOT: Record<FunderCategory, number> = {
  ANR: 0,
  Europe: 3,
  'Recherche nationale': 2,
  Régional: 1,
  International: 5,
  'Privé / fondations': 6,
  Autre: 7,
};

/**
 * Categorizes a funder from its label (keyword heuristic). Explicitly identified
 * French funders take precedence; the remainder (after ANR, Europe, regional,
 * national FR, private) is classed as « International » — on this corpus, that
 * remainder consists of foreign national agencies (NSF, DFG, JSPS, NSFC, DOE…).
 * Best-effort: to be documented as such (methodology sheet).
 */
export function funderCategory(name: string): FunderCategory {
  const n = (name || '').toLowerCase().trim();
  if (!n) return 'Autre';
  if (/agence nationale de la recherche|\banr\b/.test(n)) return 'ANR';
  if (
    /european commission|commission europ|\berc\b|european research council|horizon|h2020|h2020|marie|european union|european regional development|\bfeder\b|euratom|cost action|europe/.test(
      n,
    )
  )
    return 'Europe';
  if (
    /conseil régional|conseil regional|région |region pays|regional council|métropole|metropole|conseil départemental|conseil departemental|collectivité/.test(
      n,
    )
  )
    return 'Régional';
  if (
    /cnrs|centre national de la recherche|inserm|institut national de la santé|inrae|\binra\b|inria|\bcea\b|commissariat à l'énergie|\bcnes\b|ademe|\bird\b|institut de recherche pour le développement|anrs|institut national du cancer|\binca\b|ifremer|\bbrgm\b|onera|université de nantes|nantes université|nantes universit|\bfrance\b|français|francaise|french|ministère|ministere/.test(
      n,
    )
  )
    return 'Recherche nationale';
  if (
    /fondation|foundation|\bfonds\b|charit|\btrust\b|wellcome|gates|leducq|téléthon|telethon|\bligue\b|association pour|institut pasteur|novo nordisk/.test(
      n,
    )
  )
    return 'Privé / fondations';
  return 'International';
}

/** Canonical label of a funder (merges divergent OpenAlex/HAL spellings). */
export function canonFunderName(name: string): string {
  const n = (name || '').toLowerCase();
  if (/agence nationale de la recherche|\banr\b/.test(n)) return 'Agence Nationale de la Recherche';
  if (/european commission|commission europ/.test(n)) return 'Commission européenne';
  if (/european research council|\berc\b/.test(n)) return 'European Research Council (ERC)';
  return (name || '').trim();
}

const inRange = (p: DashboardPublication, range: YearRange) =>
  typeof p.year === 'number' && p.year >= range.start && p.year <= range.end;

/** Distinct canonical funders of a publication (funders + funderName of the awards). */
export function fundersOf(p: DashboardPublication): string[] {
  const names = new Set<string>();
  for (const f of p.funders ?? []) if (f?.name) names.add(canonFunderName(f.name));
  for (const a of p.awards ?? []) if (a?.funderName) names.add(canonFunderName(a.funderName));
  return Array.from(names);
}

export const hasFunding = (p: DashboardPublication) =>
  (p.funders?.length ?? 0) > 0 || (p.awards?.length ?? 0) > 0;

export interface FunderCount {
  name: string;
  category: FunderCategory;
  count: number;
}

export interface ProjectCount {
  projectId: string | null;
  projectName: string | null;
  funderName: string;
  category: FunderCategory;
  count: number;
  source: string;
}

export interface FundersAggregates {
  totalPubs: number;
  fundedPubs: number;
  coveragePct: number;
  distinctFunders: number;
  distinctProjects: number;
  topFunders: FunderCount[];
  byCategory: { category: FunderCategory; count: number }[];
  byYear: { year: number; funded: number; total: number }[];
  topProjects: ProjectCount[];
  /** Publications whose funding comes (also) from each source. */
  sourceSplit: { openalex: number; hal: number };
}

export function aggregateFunders(
  pubs: DashboardPublication[],
  range: YearRange,
): FundersAggregates {
  const scoped = pubs.filter((p) => inRange(p, range));
  const funded = scoped.filter(hasFunding);

  const funderCounts = new Map<string, number>();
  const catCounts = new Map<FunderCategory, number>();
  const projectCounts = new Map<
    string,
    { projectId: string | null; projectName: string | null; funderName: string; source: string; count: number }
  >();
  let srcOa = 0;
  let srcHal = 0;

  for (const p of funded) {
    // Funders (distinct per publication) → publication counts.
    const cats = new Set<FunderCategory>();
    for (const name of fundersOf(p)) {
      funderCounts.set(name, (funderCounts.get(name) ?? 0) + 1);
      cats.add(funderCategory(name));
    }
    for (const c of cats) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);

    // Projects (distinct per publication).
    const seenProj = new Set<string>();
    let hasOa = false;
    let hasHal = false;
    for (const a of p.awards ?? []) {
      if (a.source === 'openalex') hasOa = true;
      if (a.source === 'hal') hasHal = true;
      const key = (a.projectId || a.projectName || '').trim().toLowerCase();
      if (!key || seenProj.has(key)) continue;
      seenProj.add(key);
      const cur = projectCounts.get(key) ?? {
        projectId: a.projectId,
        projectName: a.projectName,
        funderName: canonFunderName(a.funderName),
        source: a.source,
        count: 0,
      };
      cur.count += 1;
      // Completes the label if a later occurrence is richer.
      if (!cur.projectName && a.projectName) cur.projectName = a.projectName;
      if (!cur.projectId && a.projectId) cur.projectId = a.projectId;
      projectCounts.set(key, cur);
    }
    if (hasOa) srcOa += 1;
    if (hasHal) srcHal += 1;
  }

  const topFunders: FunderCount[] = Array.from(funderCounts.entries())
    .map(([name, count]) => ({ name, category: funderCategory(name), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const byCategory = FUNDER_CATEGORIES.map((category) => ({
    category,
    count: catCounts.get(category) ?? 0,
  })).filter((c) => c.count > 0);

  const ym = new Map<number, { funded: number; total: number }>();
  for (const p of scoped) {
    const cur = ym.get(p.year as number) ?? { funded: 0, total: 0 };
    cur.total += 1;
    if (hasFunding(p)) cur.funded += 1;
    ym.set(p.year as number, cur);
  }
  const byYear = Array.from(ym.entries())
    .map(([year, v]) => ({ year, funded: v.funded, total: v.total }))
    .sort((a, b) => a.year - b.year);

  const topProjects: ProjectCount[] = Array.from(projectCounts.values())
    .map((v) => ({ ...v, category: funderCategory(v.funderName) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const distinctProjects = projectCounts.size;

  return {
    totalPubs: scoped.length,
    fundedPubs: funded.length,
    coveragePct: scoped.length ? Math.round((funded.length / scoped.length) * 100) : 0,
    distinctFunders: funderCounts.size,
    distinctProjects,
    topFunders,
    byCategory,
    byYear,
    topProjects,
    sourceSplit: { openalex: srcOa, hal: srcHal },
  };
}

export interface LaboCategoryRow {
  labo: string;
  total: number; // funded publications (at least one funder) attributed to the lab
  byCat: Record<FunderCategory, number>;
}

/**
 * Breakdown of funders per Structure (composite institution): for each lab,
 * count of funded publications split by funder category.
 * A co-signed publication counts in each lab. Stackable (lab × category).
 */
export function aggregateCategoryByLabo(
  pubs: DashboardPublication[],
  range: YearRange,
  topN = 15,
): LaboCategoryRow[] {
  const m = new Map<string, LaboCategoryRow>();
  for (const p of pubs) {
    if (!inRange(p, range) || !hasFunding(p)) continue;
    const cats = new Set(fundersOf(p).map(funderCategory));
    const labos = Array.from(new Set(p.sousStructures.filter(Boolean)));
    for (const labo of labos.length ? labos : ['Non réparti']) {
      let row = m.get(labo);
      if (!row) {
        row = {
          labo,
          total: 0,
          byCat: Object.fromEntries(FUNDER_CATEGORIES.map((c) => [c, 0])) as Record<
            FunderCategory,
            number
          >,
        };
        m.set(labo, row);
      }
      row.total += 1;
      for (const c of cats) row.byCat[c] += 1;
    }
  }
  return Array.from(m.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, topN);
}
