/**
 * @file etlConfig.ts
 * @description Configuration of the druid-biblio ETL for the labs of a tenant (druid-internal docs/plan-druid-saas.md,
 * lot 3 c): one `data/<lab slug>/config.yaml` per lab of the directory, written by the runner from the identifiers the
 * structure alignment confirmed (OpenAlex institution ids, HAL collection, RNSR → BSO dump), the years capped by the
 * plan. Pure: the structures come from the repository, the YAML is emitted here (flat documents only — no YAML lib).
 */
import { StructureLevel, type Structure } from '../../types';

export const BSO_DUMP_URL = 'https://storage.gra.cloud.ovh.net/v1/AUTH_32c5d10cb0fe4519b957064a111717e3/bso_dump/bso-publications-latest_{id}_enriched.jsonl.gz';

/** Slug of a lab in the data folder of druid-biblio: `LS2N` → `ls2n`, `CRCI²NA` → `crci2na`. */
export const labSlugOf = (acronym: string): string =>
  String(acronym || '').toLowerCase().split('²').join('2').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

export interface EtlLab { slug: string; acronym: string; config: Record<string, unknown> }
export interface EtlConfigOptions {
  /** Years of history the plan allows (null = everything since 2016, the first BSO year). */
  historyYears: number | null;
  mailto: string | null;
  now?: Date;
}
export interface EtlLabsReport { labs: EtlLab[]; skipped: { acronym: string; reason: string }[] }

/** The labs of the directory (level 2) with at least one harvesting key, as druid-biblio configurations. */
export const etlLabsOf = (structures: Structure[], { historyYears, mailto, now = new Date() }: EtlConfigOptions): EtlLabsReport => {
  const yearTo = now.getUTCFullYear();
  const yearFrom = historyYears ? Math.max(2016, yearTo - historyYears + 1) : 2016;
  const report: EtlLabsReport = { labs: [], skipped: [] };
  const seen = new Set<string>();
  for (const s of structures) {
    if (String(s.level) !== StructureLevel.ENTITE) continue;
    const acronym = String(s.acronym || '').trim();
    if (!acronym) { report.skipped.push({ acronym: s.officialName || s.id, reason: 'no acronym' }); continue; }
    const slug = labSlugOf(acronym);
    if (!slug) { report.skipped.push({ acronym, reason: 'no usable slug' }); continue; }
    if (seen.has(slug)) { report.skipped.push({ acronym, reason: `slug ${slug} already used` }); continue; }
    const openalex = (s.identifiers?.openalexIds || []).map((v) => String(v).trim().toUpperCase()).filter((v) => /^I\d{3,}$/.test(v));
    const rnsr = String(s.rnsrId || '').trim().toUpperCase();
    const halCollection = String(s.halCollectionUrl || '').trim().replace(/^https?:\/\/hal\.science\/|\/$/gi, '').toUpperCase();
    if (!openalex.length && !rnsr && !halCollection) { report.skipped.push({ acronym, reason: 'no OpenAlex id, RNSR or HAL collection' }); continue; }
    seen.add(slug);
    // Markers are matched on lower-cased affiliation strings: the RNSR and the acronym (« CRCI²NA » → crci2na).
    const markers = [...new Set([rnsr.toLowerCase(), acronym.toLowerCase().split('²').join('2').normalize('NFD').replace(/\p{M}/gu, '')].filter(Boolean))];
    const config: Record<string, unknown> = {
      name: s.officialName || acronym,
      acronym,
      openalex_id: openalex.join('|'),
      year_from: yearFrom,
      year_to: yearTo,
      mailto: mailto || '',
      team_label: 'équipe',
      bso_markers: markers,
      bso_url: rnsr ? BSO_DUMP_URL.replace('{id}', rnsr) : '',
      hal_collection: halCollection,
      hal_year_from: 0,
      crisalid_structure_uid: '',
      teams: [],
      sous_structures: [],
      strategic_axes: [],
      tabs_hidden: ['benchmark'],
      druid_tabs_hidden: [],
      filter_to_effectifs: false,
      etpr: 0,
      team_aliases: {},
      grist: { labo_acronyme: acronym },
    };
    report.labs.push({ slug, acronym, config });
  }
  return report;
};

const yamlScalar = (v: unknown): string => {
  if (v === null || v === undefined) return "''";
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s === '' || /^[\s'"#&*!|>%@`{}[\],:?-]|[:#]\s|\s$|^(true|false|null|yes|no|on|off|~)$|^[-+]?(\d[\d_]*\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) || /[\n\r]/.test(s)) {
    return `'${s.replace(/'/g, "''").replace(/[\n\r]/g, ' ')}'`;
  }
  return s;
};
const yamlLines = (v: unknown, indent: string): string[] => {
  if (Array.isArray(v)) return v.length ? v.flatMap((x) => (x && typeof x === 'object' ? [`${indent}-`, ...yamlLines(x, `${indent}  `)] : [`${indent}- ${yamlScalar(x)}`])) : [];
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
      if (Array.isArray(x)) return x.length ? [`${indent}${k}:`, ...yamlLines(x, indent)] : [`${indent}${k}: []`];
      if (x && typeof x === 'object') return Object.keys(x).length ? [`${indent}${k}:`, ...yamlLines(x, `${indent}  `)] : [`${indent}${k}: {}`];
      return [`${indent}${k}: ${yamlScalar(x)}`];
    });
  }
  return [`${indent}${yamlScalar(v)}`];
};
/** YAML of a flat document (scalars, lists of scalars, nested maps) — what druid-biblio reads with yaml.safe_load. */
export const yamlOf = (doc: Record<string, unknown>): string => `${yamlLines(doc, '').join('\n')}\n`;

/** `dashboard-data/index.json` of a tenant: the list the front reads without /api/dashboard-structures (lib/dashboardSource.ts). */
export const dashboardIndexOf = (labs: Pick<EtlLab, 'slug'>[]): { slugs: string[]; groups: string[]; tabsHidden: Record<string, string[]> } => ({
  slugs: labs.map((l) => l.slug),
  groups: [],
  tabsHidden: Object.fromEntries(labs.map((l) => [l.slug, ['benchmark']])),
});
