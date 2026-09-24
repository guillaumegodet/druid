// Aggregations of the « International » tab — ported from the SoVisu+ mockups
// (internationalAggregates.ts). Druid adaptations: the « real team » filter
// excludes the « Non identifié » placeholder (instead of the « Équipe » prefix of the
// demo data), and without teams the flow takes the lab as root.

import { CountryName, DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { countryLabel } from './labels';

export interface IntlYearItem {
  year: number;
  international: number;
  national: number;
}

export interface CountryItem {
  iso2: string;
  fr: string;
  echarts: string;
  eu: boolean;
  count: number;
}

export interface PartnerItem {
  name: string;
  cc: string | null;
  count: number;
}

export interface CountryHeatmap {
  countries: string[]; // FR labels, order top -> bottom
  years: number[];
  cells: { x: number; y: number; v: number }[];
}

export interface InternationalAggregates {
  intlByYear: IntlYearItem[];
  intlPctByYear: { year: number; pct: number }[];
  byCountry: CountryItem[]; // sorted descending, FR excluded
  euZone: { ue: number; outsideEu: number };
  euByYear: { year: number; ue: number; outsideEu: number }[];
  topPartners: PartnerItem[]; // foreign organizations (cc != FR)
  /**
   * Publications of the period (same rules as the other fields) — exposed
   * so that downstream components (MarketShareSection, CountryEvolutionChart,
   * aggregateCountryHeatmap) reuse this filtering already done rather than
   * redoing it each on their own (D3, see the Collaborations re-split reflection,
   * 2026-09-03 — marginal gain, each refilter being a trivial O(n), but
   * code consistency + avoids a refilter at each dimension change
   * in MarketShareSection while the period has not changed).
   */
  inRange: DashboardPublication[];
}

const HEATMAP_TOP = 15;
const PARTNERS_TOP = 20;
const FLOW_ORGS_TOP = 15;
const TEAM_UNKNOWN = 'Non identifié';

export interface FlowNode {
  name: string;
  depth?: number;
}
export interface FlowLink {
  source: string;
  target: string;
  value: number;
}
export interface SunburstNode {
  name: string;
  value?: number;
  children?: SunburstNode[];
}
export interface FlowAggregates {
  sankey: { nodes: FlowNode[]; links: FlowLink[] };
  sunburst: SunburstNode[];
}

export interface FlowMapPoint {
  name: string;
  coord: [number, number]; // [lon, lat]
  value: number;
}
export interface FlowMapAggregates {
  origin: { name: string; coord: [number, number] };
  points: FlowMapPoint[];
  maxValue: number;
}

function inYear(p: DashboardPublication, r: YearRange): boolean {
  return typeof p.year === 'number' && p.year >= r.start && p.year <= r.end;
}

/** Distinct non-FR countries of a publication. */
function foreignCountries(p: DashboardPublication): string[] {
  return Array.from(new Set(p.countries.filter((c) => c && c !== 'FR')));
}

export function aggregateInternational(
  pubs: DashboardPublication[],
  range: YearRange,
  countryNames: Record<string, CountryName>,
): InternationalAggregates {
  const inRange = pubs.filter((p) => inYear(p, range));
  const label = (iso2: string) => countryLabel(iso2, countryNames);

  // ── Intl vs national per year (known is_international only)
  const yMap = new Map<number, { intl: number; total: number }>();
  for (const p of inRange) {
    if (p.isInternational == null || typeof p.year !== 'number') continue;
    const cur = yMap.get(p.year) ?? { intl: 0, total: 0 };
    cur.total += 1;
    if (p.isInternational) cur.intl += 1;
    yMap.set(p.year, cur);
  }
  const intlByYear: IntlYearItem[] = Array.from(yMap.entries())
    .map(([year, v]) => ({ year, international: v.intl, national: v.total - v.intl }))
    .sort((a, b) => a.year - b.year);
  const intlPctByYear = Array.from(yMap.entries())
    .map(([year, v]) => ({
      year,
      pct: v.total > 0 ? Math.round((v.intl / v.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.year - b.year);

  // ── Count per country (FR excluded) + EU zone
  const countryCount = new Map<string, number>();
  let ue = 0;
  let outsideEu = 0;
  const euYearMap = new Map<number, { ue: number; outsideEu: number }>();
  for (const p of inRange) {
    const fc = foreignCountries(p);
    let hasUe = false;
    let hasOutside = false;
    for (const iso2 of fc) {
      countryCount.set(iso2, (countryCount.get(iso2) ?? 0) + 1);
      // Code missing from the reference list (missing data): neither EU nor non-EU, rather than
      // wrongly counting it as non-EU (review lot 8).
      const known = countryNames[iso2];
      if (!known) continue;
      if (known.eu) hasUe = true;
      else hasOutside = true;
    }
    if (hasUe) ue += 1;
    if (hasOutside) outsideEu += 1;
    if (typeof p.year === 'number' && (hasUe || hasOutside)) {
      const cur = euYearMap.get(p.year) ?? { ue: 0, outsideEu: 0 };
      if (hasUe) cur.ue += 1;
      if (hasOutside) cur.outsideEu += 1;
      euYearMap.set(p.year, cur);
    }
  }

  const byCountry: CountryItem[] = Array.from(countryCount.entries())
    .map(([iso2, count]) => ({
      iso2,
      fr: label(iso2),
      echarts: countryNames[iso2]?.echarts ?? '',
      eu: countryNames[iso2]?.eu ?? false,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const euByYear = Array.from(euYearMap.entries())
    .map(([year, v]) => ({ year, ue: v.ue, outsideEu: v.outsideEu }))
    .sort((a, b) => a.year - b.year);

  // ── Top foreign partner organizations
  const partnerCount = new Map<string, { cc: string | null; count: number }>();
  for (const p of inRange) {
    const seen = new Set<string>();
    for (const org of p.partnerInstitutions) {
      if (!org.name || org.cc === 'FR' || seen.has(org.name)) continue;
      seen.add(org.name);
      const cur = partnerCount.get(org.name) ?? { cc: org.cc, count: 0 };
      cur.count += 1;
      partnerCount.set(org.name, cur);
    }
  }
  const topPartners: PartnerItem[] = Array.from(partnerCount.entries())
    .map(([name, v]) => ({ name, cc: v.cc, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, PARTNERS_TOP);

  return { intlByYear, intlPctByYear, byCountry, euZone: { ue, outsideEu }, euByYear, topPartners, inRange };
}

// ── Heatmap top N countries × years ─────────────────────────────────────────────
// Taken out of aggregateInternational (2026-09-03, see the reflection on the
// re-split of the Collaborations pages): expensive (before D1, a full scan
// of inRange per top country) and used only by the « Approfondir » view
// of InternationalTab — computing it in aggregateInternational made the
// « Vue d'ensemble », which does not display it, pay for it too. Takes `inRange` and
// `byCountry` already computed by aggregateInternational (D3) rather than
// refiltering the publications and recounting the countries from scratch.
export function aggregateCountryHeatmap(
  inRange: DashboardPublication[],
  byCountry: CountryItem[],
  topN = HEATMAP_TOP,
): CountryHeatmap {
  const topCountries = byCountry.slice(0, topN);
  const countryIndex = new Map(topCountries.map((c, ci) => [c.iso2, ci]));
  const years = Array.from(
    new Set(inRange.map((p) => p.year).filter((y): y is number => y != null)),
  ).sort((a, b) => a - b);
  const yearIndex = new Map(years.map((y, yi) => [y, yi]));

  // A single pass over inRange (instead of one per top country, see D1): the
  // country×year grid is incremented directly.
  const grid: number[][] = topCountries.map(() => years.map(() => 0));
  for (const p of inRange) {
    if (typeof p.year !== 'number') continue;
    const yi = yearIndex.get(p.year);
    if (yi == null) continue;
    for (const iso2 of foreignCountries(p)) {
      const ci = countryIndex.get(iso2);
      if (ci != null) grid[ci][yi] += 1;
    }
  }

  const cells: { x: number; y: number; v: number }[] = [];
  topCountries.forEach((_, ci) => {
    years.forEach((_, yi) => cells.push({ x: yi, y: ci, v: grid[ci][yi] }));
  });
  return {
    countries: topCountries.map((c) => countryLabel(c.iso2, { [c.iso2]: { fr: c.fr, echarts: c.echarts, eu: c.eu } })),
    years,
    cells,
  };
}

// ── Evolution of the main partner countries (curves per country) ─────────────

export interface CountryEvolution {
  countries: string[]; // FR labels, order = global ranking
  years: number[];
  series: { name: string; data: number[] }[];
}

export function aggregateCountryEvolution(
  pubs: DashboardPublication[],
  range: YearRange,
  countryNames: Record<string, CountryName>,
  topN = 8,
  /** Publications already filtered by period (D3, see InternationalAggregates.inRange)
   * — avoids refiltering `pubs` when the caller already did (aggregateInternational). */
  precomputedInRange?: DashboardPublication[],
): CountryEvolution {
  const inRange = precomputedInRange ?? pubs.filter((p) => inYear(p, range));
  const label = (iso2: string) => countryLabel(iso2, countryNames);

  const totals = new Map<string, number>();
  for (const p of inRange) {
    for (const iso2 of foreignCountries(p)) totals.set(iso2, (totals.get(iso2) ?? 0) + 1);
  }
  const top = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([iso2]) => iso2);

  const years = Array.from(
    new Set(inRange.map((p) => p.year).filter((y): y is number => y != null)),
  ).sort((a, b) => a - b);

  // A single pass over inRange (instead of one per top country, see D1, same
  // flaw as the heatmap above): country×year grid incremented directly.
  const topSet = new Set(top);
  const countryIndex = new Map(top.map((iso2, ci) => [iso2, ci]));
  const yearIndex = new Map(years.map((y, yi) => [y, yi]));
  const grid: number[][] = top.map(() => years.map(() => 0));
  for (const p of inRange) {
    if (typeof p.year !== 'number') continue;
    const yi = yearIndex.get(p.year);
    if (yi == null) continue;
    for (const iso2 of foreignCountries(p)) {
      if (!topSet.has(iso2)) continue;
      grid[countryIndex.get(iso2)!][yi] += 1;
    }
  }
  const series = top.map((iso2, ci) => ({ name: label(iso2), data: grid[ci] }));

  return { countries: top.map(label), years, series };
}

// ── Market share of a selection (country / team / organization) ────────────────

export type MarketDimension = 'country' | 'team' | 'org';

export interface MarketIndex {
  /** value -> indices of the publications concerned (in the inRange array). */
  byValue: Map<string, Set<number>>;
  /** values ranked by decreasing number of publications. */
  ranking: string[];
  /** publications of the period (reference for the indices). */
  inRange: DashboardPublication[];
}

export function buildMarketIndex(
  pubs: DashboardPublication[],
  range: YearRange,
  dim: MarketDimension,
  countryNames: Record<string, CountryName>,
  /** Publications already filtered by period (D3, see InternationalAggregates.inRange)
   * — avoids refiltering `pubs` at each change of `dim` (MarketShareSection),
   * the period having not changed. */
  precomputedInRange?: DashboardPublication[],
): MarketIndex {
  const inRange = precomputedInRange ?? pubs.filter((p) => inYear(p, range));
  const label = (iso2: string) => countryLabel(iso2, countryNames);
  const byValue = new Map<string, Set<number>>();

  inRange.forEach((p, i) => {
    let values: string[] = [];
    if (dim === 'country') values = foreignCountries(p).map(label);
    else if (dim === 'team') values = p.teams.filter((t) => t && t !== TEAM_UNKNOWN);
    else {
      values = Array.from(
        new Set(
          p.partnerInstitutions
            .filter((o) => o.name && o.cc && o.cc !== 'FR')
            .map((o) => o.name),
        ),
      );
    }
    for (const v of values) {
      if (!byValue.has(v)) byValue.set(v, new Set());
      byValue.get(v)!.add(i);
    }
  });

  const ranking = Array.from(byValue.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .map(([v]) => v);

  return { byValue, ranking, inRange };
}

export interface MarketShare {
  selected: number;
  total: number;
  pct: number | null;
  shareByYear: { year: number; pct: number }[];
}

export function computeMarketShare(index: MarketIndex, selection: string[]): MarketShare {
  const wids = new Set<number>();
  for (const v of selection) {
    for (const i of index.byValue.get(v) ?? []) wids.add(i);
  }
  const total = index.inRange.length;

  const yearTotal = new Map<number, number>();
  const yearSel = new Map<number, number>();
  index.inRange.forEach((p, i) => {
    if (typeof p.year !== 'number') return;
    yearTotal.set(p.year, (yearTotal.get(p.year) ?? 0) + 1);
    if (wids.has(i)) yearSel.set(p.year, (yearSel.get(p.year) ?? 0) + 1);
  });
  const shareByYear = Array.from(yearTotal.entries())
    .map(([year, n]) => ({
      year,
      pct: n > 0 ? Math.round(((yearSel.get(year) ?? 0) / n) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.year - b.year);

  return {
    selected: wids.size,
    total,
    pct: total > 0 ? Math.round((wids.size / total) * 1000) / 10 : null,
    shareByYear,
  };
}

// ── Network teams ↔ foreign organizations ────────────────────────────────────

export interface TeamOrgNetwork {
  nodes: { id: string; name: string; value: number; category: number; isOrg: boolean }[];
  links: { source: string; target: string; value: number }[];
  categories: { name: string }[];
}

export function aggregateTeamOrgNetwork(
  pubs: DashboardPublication[],
  range: YearRange,
  topOrgs = 15,
): TeamOrgNetwork {
  const inRange = pubs.filter((p) => inYear(p, range));

  const orgCount = new Map<string, number>();
  for (const p of inRange) {
    const seen = new Set<string>();
    for (const o of p.partnerInstitutions) {
      if (!o.name || !o.cc || o.cc === 'FR' || seen.has(o.name)) continue;
      seen.add(o.name);
      orgCount.set(o.name, (orgCount.get(o.name) ?? 0) + 1);
    }
  }
  const kept = new Set(
    Array.from(orgCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topOrgs)
      .map(([n]) => n),
  );

  const pair = new Map<string, number>();
  const teamCount = new Map<string, number>();
  for (const p of inRange) {
    const teams = p.teams.filter((t) => t && t !== TEAM_UNKNOWN);
    if (!teams.length) continue;
    const orgs = Array.from(
      new Set(
        p.partnerInstitutions
          .filter((o) => o.name && o.cc && o.cc !== 'FR' && kept.has(o.name))
          .map((o) => o.name),
      ),
    );
    if (!orgs.length) continue;
    for (const tm of teams) {
      teamCount.set(tm, (teamCount.get(tm) ?? 0) + 1);
      for (const org of orgs) {
        const key = `${tm}|||${org}`;
        pair.set(key, (pair.get(key) ?? 0) + 1);
      }
    }
  }

  const usedOrgs = new Set<string>();
  const links = Array.from(pair.entries()).map(([k, value]) => {
    const [tm, org] = k.split('|||');
    usedOrgs.add(org);
    return { source: `t:${tm}`, target: `o:${org}`, value };
  });
  const teams = Array.from(teamCount.keys()).sort();
  const categories = [...teams.map((name) => ({ name })), { name: 'Organismes' }];
  const catIndex = new Map(teams.map((tm, i) => [tm, i]));

  const nodes = [
    ...teams.map((tm) => ({
      id: `t:${tm}`,
      name: tm,
      value: teamCount.get(tm) ?? 0,
      category: catIndex.get(tm) ?? 0,
      isOrg: false,
    })),
    ...Array.from(usedOrgs).map((org) => ({
      id: `o:${org}`,
      name: org,
      value: orgCount.get(org) ?? 0,
      category: teams.length, // « Organismes » category
      isOrg: true,
    })),
  ];

  return { nodes, links, categories };
}

/**
 * Flow team → country → organization (Sankey + Sunburst). A publication links
 * each of its teams to each foreign partner organization (and to the country of
 * that organization). Without an identified team, the lab (`labLabel`) serves as root.
 */
export function aggregateFlows(
  pubs: DashboardPublication[],
  range: YearRange,
  countryNames: Record<string, CountryName>,
  labLabel: string,
  topOrgs = FLOW_ORGS_TOP,
): FlowAggregates {
  const inRange = pubs.filter((p) => inYear(p, range));
  const countryLabelOf = (cc: string) => countryLabel(cc, countryNames);

  // 1. most frequent foreign organizations (per distinct publication)
  const orgPub = new Map<string, number>();
  for (const p of inRange) {
    const seen = new Set<string>();
    for (const o of p.partnerInstitutions) {
      if (!o.name || !o.cc || o.cc === 'FR' || seen.has(o.name)) continue;
      seen.add(o.name);
      orgPub.set(o.name, (orgPub.get(o.name) ?? 0) + 1);
    }
  }
  const topOrgSet = new Set(
    Array.from(orgPub.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topOrgs)
      .map(([name]) => name),
  );

  // 2. count of (team, country, organization) triplets
  const triple = new Map<string, number>(); // "team|||country|||org"
  for (const p of inRange) {
    const realTeams = p.teams.filter((tm) => tm && tm !== TEAM_UNKNOWN);
    const teams = realTeams.length ? realTeams : [labLabel];
    const orgs = p.partnerInstitutions.filter(
      (o) => o.name && o.cc && o.cc !== 'FR' && topOrgSet.has(o.name),
    );
    if (!orgs.length) continue;
    const seen = new Set<string>();
    for (const team of teams) {
      for (const o of orgs) {
        const key = `${team}|||${countryLabelOf(o.cc as string)}|||${o.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        triple.set(key, (triple.get(key) ?? 0) + 1);
      }
    }
  }

  // 3. derived aggregations
  const teamCountry = new Map<string, number>();
  const countryOrg = new Map<string, number>();
  const teamSet = new Set<string>();
  const countrySet = new Set<string>();
  const orgSet = new Set<string>();
  const tree = new Map<string, Map<string, Map<string, number>>>();

  for (const [key, v] of triple.entries()) {
    const [team, country, org] = key.split('|||');
    teamSet.add(team);
    countrySet.add(country);
    orgSet.add(org);
    teamCountry.set(`${team}|||${country}`, (teamCountry.get(`${team}|||${country}`) ?? 0) + v);
    countryOrg.set(`${country}|||${org}`, (countryOrg.get(`${country}|||${org}`) ?? 0) + v);
    if (!tree.has(team)) tree.set(team, new Map());
    const ct = tree.get(team)!;
    if (!ct.has(country)) ct.set(country, new Map());
    ct.get(country)!.set(org, v);
  }

  const nodes: FlowNode[] = [
    ...Array.from(teamSet).map((name) => ({ name, depth: 0 })),
    ...Array.from(countrySet).map((name) => ({ name, depth: 1 })),
    ...Array.from(orgSet).map((name) => ({ name, depth: 2 })),
  ];
  const links: FlowLink[] = [
    ...Array.from(teamCountry.entries()).map(([k, value]) => {
      const [source, target] = k.split('|||');
      return { source, target, value };
    }),
    ...Array.from(countryOrg.entries()).map(([k, value]) => {
      const [source, target] = k.split('|||');
      return { source, target, value };
    }),
  ];

  const sunburst: SunburstNode[] = Array.from(tree.entries()).map(([team, countries]) => ({
    name: team,
    children: Array.from(countries.entries()).map(([country, orgs]) => ({
      name: country,
      children: Array.from(orgs.entries()).map(([org, value]) => ({ name: org, value })),
    })),
  }));

  return { sankey: { nodes, links }, sunburst };
}

/**
 * Flow map: arcs from the lab (Nantes) to the cities of the
 * geolocated foreign partner organizations. Value = number of distinct
 * publications co-signed with an organization of that city.
 */
export function aggregateFlowMap(
  pubs: DashboardPublication[],
  range: YearRange,
  countryNames: Record<string, CountryName>,
  originName: string,
): FlowMapAggregates {
  const inRange = pubs.filter((p) => inYear(p, range));
  const countryLabelOf = (cc: string) => countryLabel(cc, countryNames);

  const acc = new Map<string, { name: string; lon: number; lat: number; value: number }>();
  for (const p of inRange) {
    const seen = new Set<string>();
    for (const o of p.partnerInstitutions) {
      if (!o.cc || o.cc === 'FR' || o.lat == null || o.lon == null || !o.city) continue;
      const key = `${o.city}|${o.cc}`;
      if (seen.has(key)) continue; // once per publication
      seen.add(key);
      const cur = acc.get(key) ?? {
        name: `${o.city} (${countryLabelOf(o.cc)})`,
        lon: o.lon,
        lat: o.lat,
        value: 0,
      };
      cur.value += 1;
      acc.set(key, cur);
    }
  }

  const points: FlowMapPoint[] = Array.from(acc.values())
    .map((p) => ({ name: p.name, coord: [p.lon, p.lat] as [number, number], value: p.value }))
    .sort((a, b) => b.value - a.value);

  return {
    origin: { name: `${originName} (Nantes)`, coord: [-1.5536, 47.2184] },
    points,
    maxValue: points.reduce((m, p) => Math.max(m, p.value), 0),
  };
}
