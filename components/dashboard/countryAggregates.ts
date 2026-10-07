// Aggregations of the « Pays » sub-tab of the Collaborations tab (docs/plan-collaboration-pays.md,
// lot 1): everything about ONE partner country — its institutions only (never the other countries'),
// the internal labs and researchers involved, themes and specialization, funders, impact, map
// framing. The other countries appear only twice: the rank of the country among the partners and
// the third countries of the multilateral co-publications.
//
// Country of a publication = `countries` ∪ countries of its partner institutions: exports
// predating 2026-10-07 missed the country of an institution on 11 % of the international
// co-publications (§ 4.1 of the plan; fixed in druid-biblio, kept here as a safety net).

import { partnerKey, researcherLabel, unitsOfDataset } from './collabAggregates';
import { countryLabel } from './labels';
import type { CountItem, YearRange } from './overviewAggregates';
import { compareImpact, halfTrend, LARGE_COLLAB_AUTHORS, OPEN_STATUSES, type ImpactComparison } from './partnerKpis';
import type { CountryName, DashboardDataset, DashboardPublication } from './types';

type Institution = DashboardPublication['partnerInstitutions'][number];

/** Countries of a publication: `countries` plus the countries of its partner institutions. */
export function publicationCountries(p: DashboardPublication): string[] {
  const out = new Set(p.countries.filter(Boolean));
  for (const o of p.partnerInstitutions) if (o.cc) out.add(o.cc);
  return [...out];
}

/** Foreign (non-FR) countries of a publication. */
export const foreignCountriesOf = (p: DashboardPublication): string[] =>
  publicationCountries(p).filter((c) => c !== 'FR');

/** Is `cc` a country of the publication (the « Pays » filter)? */
export const hasCountry = (p: DashboardPublication, cc: string): boolean =>
  p.countries.includes(cc) || p.partnerInstitutions.some((o) => o.cc === cc);

/** International publication: flagged so, or with a foreign country (safety net, see above). */
const isInternational = (p: DashboardPublication) => p.isInternational === true || foreignCountriesOf(p).length > 0;

const inRange = (p: DashboardPublication, r: YearRange) =>
  typeof p.year === 'number' && p.year >= r.start && p.year <= r.end;

const isLarge = (p: DashboardPublication, maxAuthors: number) =>
  typeof p.authorCount === 'number' && p.authorCount > maxAuthors;

export interface CountryOption {
  cc: string;
  label: string;
  count: number;
}

/** Partner countries of the period, most co-publications first (selector and rank). */
export function countryOptions(
  pubs: DashboardPublication[],
  range: YearRange,
  countryNames: Record<string, CountryName>,
): CountryOption[] {
  const count = new Map<string, number>();
  for (const p of pubs) {
    if (!inRange(p, range)) continue;
    for (const cc of foreignCountriesOf(p)) count.set(cc, (count.get(cc) ?? 0) + 1);
  }
  return [...count]
    .map(([cc, n]) => ({ cc, label: countryLabel(cc, countryNames), count: n }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface CountryInstitution {
  /** ROR when known, else `name:<name>` (or the parent's, when grouped). */
  key: string;
  name: string;
  ror: string | null;
  city: string | null;
  region: string | null;
  count: number;
  /** Institutions folded under this one (« Regrouper les affiliés »), itself excluded. */
  affiliates: string[];
  /** Keys of the `partnerKeys` filter (publication list) covering the institution and its affiliates. */
  partnerKeys: string[];
}

export interface CountryMapPoint {
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  value: number;
}

/** ECharts geo `boundingCoords`: [[west, north], [east, south]]. */
export type GeoBounds = [[number, number], [number, number]];

export interface CountrySpecialization {
  key: string;
  count: number;
  /** Share of the country co-publications in this subfield (0-1). */
  share: number;
  /** Share among all the international co-publications of the structure (0-1). */
  refShare: number;
  /** share / refShare: > 1 = more frequent with this country than with the others. */
  index: number;
}

export type FunderOrigin = 'country' | 'france' | 'other' | 'unknown';

export interface CountryFunder {
  name: string;
  cc: string | null;
  origin: FunderOrigin;
  count: number;
}

export interface CountryFocus {
  cc: string;
  label: string;
  /** Co-publications with the country over the period (after `maxAuthors`). */
  pubs: DashboardPublication[];
  total: number;
  /** International co-publications of the period (denominator of the share). */
  international: number;
  shareOfInternational: number | null;
  rank: { rank: number; of: number } | null;
  trend: ReturnType<typeof halfTrend>;
  byYear: { year: number; count: number; international: number; share: number | null }[];
  /** Top partner countries, the selected one included even beyond the top. */
  topCountries: (CountryOption & { selected: boolean })[];
  bilateral: number;
  multilateral: number;
  thirdCountries: CountryOption[];
  institutions: CountryInstitution[];
  /** Co-publications per province / state (distinct per publication). */
  regions: CountItem[];
  /** Co-publications with at least one institution whose region is known. */
  withRegion: number;
  mapPoints: CountryMapPoint[];
  bounds: GeoBounds | null;
  units: { kind: 'labs' | 'teams' | null; top: CountItem[]; count: number; without: number };
  researchers: { count: number; top: { id: number; label: string; count: number; teams: string[] }[] };
  /** Internal units × institutions of the country (top × top, co-publications). */
  matrix: { units: string[]; institutions: string[]; cells: { x: number; y: number; v: number }[] };
  domains: CountItem[];
  topSubfields: CountItem[];
  /** Subfields with at least `specializationMin` co-publications, most over-represented first. */
  specialization: CountrySpecialization[];
  specializationMin: number;
  languages: CountItem[];
  funders: CountryFunder[];
  /** Co-publications acknowledging at least one funder of each origin. */
  funderOrigins: Record<FunderOrigin, number>;
  funded: number;
  /** Impact vs the other international co-publications of the same subfields (large collaborations excluded). */
  impact: ImpactComparison;
  openAccess: number;
  large: number;
}

export interface CountryFocusOptions {
  /** Excludes the publications with more than `maxAuthors` authors everywhere (D2 checkbox). */
  maxAuthors?: number;
  /** Folds hospitals and institutes under their parent university (D3, off by default). */
  groupAffiliates?: boolean;
  topInstitutions?: number;
  topUnits?: number;
  topResearchers?: number;
  topCountries?: number;
  matrixSize?: number;
}

const sorted = (m: Map<string, number>, n = Infinity): CountItem[] =>
  [...m]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/** Grouping key and displayed name of an institution of the country. */
function institutionKey(o: Institution, group: boolean): { key: string; name: string; ror: string | null } {
  if (group && o.parent?.name) {
    return { key: o.parent.ror || `name:${o.parent.name}`, name: o.parent.name, ror: o.parent.ror ?? null };
  }
  return { key: o.ror || `name:${o.name}`, name: o.name, ror: o.ror ?? null };
}

/** Weighted quantile of values (`q` in 0-1). */
function weightedQuantile(items: { v: number; w: number }[], q: number): number {
  const s = [...items].sort((a, b) => a.v - b.v);
  const total = s.reduce((acc, x) => acc + x.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= q * total) return x.v;
  }
  return s[s.length - 1].v;
}

/**
 * Map framing on the institutions of the country (lot 0 § 4.1): the country polygon would include
 * Alaska, Hawaii or the Canadian Arctic. Percentiles 2-98 weighted by co-publications from 50
 * signatures on, raw extent below; 15 % margin; at least 8° × 5°.
 */
export function countryBounds(points: CountryMapPoint[]): GeoBounds | null {
  if (!points.length) return null;
  const weight = points.reduce((acc, p) => acc + p.value, 0);
  const trim = weight >= 50 ? 0.02 : 0;
  const lons = points.map((p) => ({ v: p.lon, w: p.value }));
  const lats = points.map((p) => ({ v: p.lat, w: p.value }));
  let west = trim ? weightedQuantile(lons, trim) : Math.min(...points.map((p) => p.lon));
  let east = trim ? weightedQuantile(lons, 1 - trim) : Math.max(...points.map((p) => p.lon));
  let south = trim ? weightedQuantile(lats, trim) : Math.min(...points.map((p) => p.lat));
  let north = trim ? weightedQuantile(lats, 1 - trim) : Math.max(...points.map((p) => p.lat));
  const padLon = Math.max((east - west) * 0.15, (8 - (east - west)) / 2, 0);
  const padLat = Math.max((north - south) * 0.15, (5 - (north - south)) / 2, 0);
  west = Math.max(-180, west - padLon);
  east = Math.min(180, east + padLon);
  south = Math.max(-85, south - padLat);
  north = Math.min(85, north + padLat);
  return [[west, north], [east, south]];
}

/**
 * Everything the « Pays » sub-tab shows for country `cc` over `range`. Large collaborations
 * (> 50 authors) count in the volumes unless `maxAuthors` is set, and never in the impact (D2).
 */
export function aggregateCountryFocus(
  dataset: Pick<DashboardDataset, 'publications' | 'authors' | 'countryNames'>,
  range: YearRange,
  cc: string,
  opts: CountryFocusOptions = {},
): CountryFocus {
  const {
    maxAuthors,
    groupAffiliates = false,
    topInstitutions = 20,
    topUnits = 15,
    topResearchers = 20,
    topCountries = 15,
    matrixSize = 12,
  } = opts;
  const scope = dataset.publications.filter(
    (p) => inRange(p, range) && (maxAuthors == null || !isLarge(p, maxAuthors)),
  );
  const pubs = scope.filter((p) => hasCountry(p, cc));
  const intl = scope.filter(isInternational);
  const total = pubs.length;

  // ── Position of the country
  const options = countryOptions(scope, range, dataset.countryNames);
  const index = options.findIndex((o) => o.cc === cc);
  const top = options.slice(0, topCountries).map((o) => ({ ...o, selected: o.cc === cc }));
  if (index >= topCountries) top.push({ ...options[index], selected: true });

  // ── Years (all the years of the range, even empty)
  const perYear = new Map<number, { count: number; international: number }>();
  for (let y = range.start; y <= range.end; y++) perYear.set(y, { count: 0, international: 0 });
  for (const p of intl) perYear.get(p.year as number)!.international += 1;
  for (const p of pubs) perYear.get(p.year as number)!.count += 1;
  const byYear = [...perYear].map(([year, v]) => ({
    year,
    ...v,
    share: v.international ? Math.round((v.count / v.international) * 1000) / 10 : null,
  }));

  // ── Bilateral / third countries
  let bilateral = 0;
  const third = new Map<string, number>();
  for (const p of pubs) {
    const others = foreignCountriesOf(p).filter((c) => c !== cc);
    if (!others.length) bilateral += 1;
    for (const c of others) bump(third, c);
  }
  const thirdCountries = sorted(third, 10).map(({ key, count }) => ({
    cc: key,
    label: countryLabel(key, dataset.countryNames),
    count,
  }));

  // ── Institutions of the country, regions, map
  const instCount = new Map<string, CountryInstitution>();
  const pointCount = new Map<string, CountryMapPoint>();
  const regionCount = new Map<string, number>();
  const instKeysByPub = new Map<DashboardPublication, Set<string>>();
  let withRegion = 0;
  for (const p of pubs) {
    const keys = new Set<string>();
    const regions = new Set<string>();
    const points = new Set<string>();
    for (const o of p.partnerInstitutions) {
      if (o.cc !== cc || !o.name) continue;
      const k = institutionKey(o, groupAffiliates);
      let entry = instCount.get(k.key);
      if (!entry) {
        const isParent = k.name !== o.name;
        entry = {
          key: k.key,
          name: k.name,
          ror: k.ror,
          city: isParent ? null : o.city,
          region: o.region ?? null,
          count: 0,
          affiliates: [],
          partnerKeys: [],
        };
        instCount.set(k.key, entry);
      }
      if (k.name !== o.name && !entry.affiliates.includes(o.name)) entry.affiliates.push(o.name);
      const filterKey = partnerKey(o, 'international');
      if (!entry.partnerKeys.includes(filterKey)) entry.partnerKeys.push(filterKey);
      if (!keys.has(k.key)) {
        keys.add(k.key);
        entry.count += 1;
      }
      if (o.region) regions.add(o.region);
      const pk = o.ror || o.name;
      if (o.lat != null && o.lon != null && !points.has(pk)) {
        points.add(pk);
        const pt = pointCount.get(pk) ?? { name: o.name, city: o.city, lat: o.lat, lon: o.lon, value: 0 };
        pt.value += 1;
        pointCount.set(pk, pt);
      }
    }
    instKeysByPub.set(p, keys);
    for (const r of regions) bump(regionCount, r);
    if (regions.size) withRegion += 1;
  }
  const institutions = [...instCount.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, topInstitutions);
  const mapPoints = [...pointCount.values()].sort((a, b) => b.value - a.value);

  // ── Internal units and researchers
  const units = unitsOfDataset({ publications: scope, authors: dataset.authors });
  const unitCount = new Map<string, number>();
  let without = 0;
  const unitsByPub = new Map<DashboardPublication, string[]>();
  const authorCount = new Map<number, number>();
  for (const p of pubs) {
    const us = units.of(p);
    unitsByPub.set(p, us);
    if (!us.length) without += 1;
    for (const u of us) bump(unitCount, u);
    for (const id of new Set(p.authorIds)) authorCount.set(id, (authorCount.get(id) ?? 0) + 1);
  }
  const authorsById = new Map(dataset.authors.map((a) => [a.id, a]));
  const researchersTop = [...authorCount]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, topResearchers)
    .map(([id, count]) => {
      const a = authorsById.get(id);
      return { id, label: a ? researcherLabel(a) : `#${id}`, count, teams: a?.teams ?? [] };
    });

  // ── Units × institutions
  const mUnits = sorted(unitCount, matrixSize).map((u) => u.key);
  const mInst = institutions.slice(0, matrixSize).map((i) => i.key);
  const cells = new Map<string, number>();
  for (const p of pubs) {
    const us = unitsByPub.get(p)!.filter((u) => mUnits.includes(u));
    const is = [...instKeysByPub.get(p)!].filter((k) => mInst.includes(k));
    for (const u of us) for (const k of is) bump(cells, `${mUnits.indexOf(u)}|${mInst.indexOf(k)}`);
  }
  const nameOf = new Map(institutions.map((i) => [i.key, i.name]));
  const matrix = {
    units: mUnits,
    institutions: mInst.map((k) => nameOf.get(k) ?? k),
    cells: [...cells].map(([xy, v]) => {
      const [y, x] = xy.split('|').map(Number);
      return { x, y, v };
    }),
  };

  // ── Themes and specialization
  const domainCount = new Map<string, number>();
  const sfCount = new Map<string, number>();
  const langCount = new Map<string, number>();
  for (const p of pubs) {
    for (const d of new Set(p.domains)) bump(domainCount, d);
    for (const s of new Set(p.subfields)) bump(sfCount, s);
    bump(langCount, p.language || 'unknown');
  }
  const refSf = new Map<string, number>();
  for (const p of intl) for (const s of new Set(p.subfields)) bump(refSf, s);
  // Fewer publications for a lab than for the university: a lower threshold keeps a few subfields.
  const specializationMin = total >= 500 ? 20 : 5;
  const specialization = [...sfCount]
    .filter(([key, count]) => count >= specializationMin && (refSf.get(key) ?? 0) > 0)
    .map(([key, count]) => {
      const share = count / total;
      const refShare = (refSf.get(key) as number) / intl.length;
      return { key, count, share, refShare, index: Math.round((share / refShare) * 100) / 100 };
    })
    .sort((a, b) => b.index - a.index || b.count - a.count);

  // ── Funders
  const funderCount = new Map<string, CountryFunder>();
  const funderOrigins: Record<FunderOrigin, number> = { country: 0, france: 0, other: 0, unknown: 0 };
  let funded = 0;
  for (const p of pubs) {
    const fs = p.funders ?? [];
    if (fs.length) funded += 1;
    const origins = new Set<FunderOrigin>();
    const seen = new Set<string>();
    for (const f of fs) {
      if (!f.name || seen.has(f.name)) continue;
      seen.add(f.name);
      const fcc = f.cc ?? null;
      const origin: FunderOrigin = !fcc ? 'unknown' : fcc === cc ? 'country' : fcc === 'FR' ? 'france' : 'other';
      origins.add(origin);
      const entry = funderCount.get(f.name) ?? { name: f.name, cc: fcc, origin, count: 0 };
      entry.count += 1;
      funderCount.set(f.name, entry);
    }
    for (const o of origins) funderOrigins[o] += 1;
  }
  const funders = [...funderCount.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 15);

  // ── Impact: reference = the OTHER international co-publications (the country's own would pull
  // the reference toward the co-publications themselves).
  const reference = intl.filter((p) => !hasCountry(p, cc));
  const impact = compareImpact(pubs, reference, range, LARGE_COLLAB_AUTHORS);

  return {
    cc,
    label: countryLabel(cc, dataset.countryNames),
    pubs,
    total,
    international: intl.length,
    shareOfInternational: intl.length ? Math.round((total / intl.length) * 1000) / 10 : null,
    rank: index >= 0 ? { rank: index + 1, of: options.length } : null,
    trend: halfTrend(pubs, range),
    byYear,
    topCountries: top,
    bilateral,
    multilateral: total - bilateral,
    thirdCountries,
    institutions,
    regions: sorted(regionCount),
    withRegion,
    mapPoints,
    bounds: countryBounds(mapPoints),
    units: { kind: units.kind, top: sorted(unitCount, topUnits), count: unitCount.size, without },
    researchers: { count: authorCount.size, top: researchersTop },
    matrix,
    domains: sorted(domainCount),
    topSubfields: sorted(sfCount, 12),
    specialization,
    specializationMin,
    languages: sorted(langCount),
    funders,
    funderOrigins,
    funded,
    impact,
    openAccess: pubs.filter((p) => OPEN_STATUSES.has(p.oaStatus ?? '')).length,
    large: pubs.filter((p) => isLarge(p, LARGE_COLLAB_AUTHORS)).length,
  };
}
