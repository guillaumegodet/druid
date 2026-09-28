import { describe, expect, it } from 'vitest';
import {
  applyAxisCorrections,
  buildAxisCorrectionIndex,
  effectiveAxe,
} from '../../components/dashboard/axesCorrections';
import {
  CHART_META,
  datasetFeatures,
  missingFeatures,
  sanitizeChartParams,
  trivialFiltersOf,
} from '../../components/dashboard/chartMeta';
import { EMBEDDABLE_IDS, KPI_SET_IDS } from '../../components/dashboard/embedIds';
import { KPI_SETS } from '../../components/dashboard/kpiItems';
import { aggregateDomains } from '../../components/dashboard/phase4Aggregates';
import {
  decodeEmbedParam,
  embedStateParams,
  encodeEmbedParam,
  MAX_EMBED_PARAM_LENGTH,
  parseEmbedFilters,
  parseEmbedParams,
} from '../../components/dashboard/embedState';
import { parseReportDefinition, REPORT_LIMITS } from '../../components/dashboard/report/definition';
import { REPORT_SECTIONS } from '../../components/dashboard/report/reportCatalog';
import {
  hasActiveFilter,
  resolvePeriod,
  restrictDataset,
} from '../../components/dashboard/report/restrictDataset';
import { visibleTabKeys } from '../../components/dashboard/tabAvailability';
import type { DashboardDataset, DashboardPublication } from '../../components/dashboard/types';

// Report scope and chart registry metadata (docs/plan-mes-rapports.md, lot 1).
// Fictitious corpus: 4 publications, 2 staff authors (ids 1 and 2).

const pub = (over: Partial<DashboardPublication>): DashboardPublication => ({
  year: 2022, title: 'Untitled', doi: null, journal: null, journalPublisher: null, pubType: 'Article de revue',
  oaStatus: 'gold', language: 'en', sjrQuartile: null, journalAccess: null, licenceNationale: false,
  teams: [], sousStructures: [], authorIds: [], hasPhd: false, collabTypes: [], countries: [],
  nantesPartners: [], nationalPartners: [], partnerInstitutions: [], isInternational: false,
  domains: [], subfields: [], topics: [], chosenTheme: null, chosenAxe: null, charte: null,
  hasApc: false, isTop10Percent: false, isTop1Percent: false, authorCount: 3,
  ...over,
} as unknown as DashboardPublication);

const OTTAWA = { name: 'University of Ottawa', cc: 'CA', city: null, lat: null, lon: null, ror: '03c4mmv16' };

const dataset = (publications: DashboardPublication[]): DashboardDataset => ({
  lab: 'LAB', name: 'Test lab', slug: 'test-lab', teamLabel: 'Team', strategicAxes: [],
  publications, authors: [], members: [{ authorId: 1, type: 'EC' }, { authorId: 2, type: 'EC' }],
  effectifsAuthorIds: [], countryNames: {},
} as unknown as DashboardDataset);

const DS = dataset([
  pub({ title: 'Heart valves', year: 2021, authorIds: [1, 9], partnerInstitutions: [OTTAWA], countries: ['CA'], isInternational: true }),
  pub({ title: 'Big consortium', year: 2023, authorIds: [2], partnerInstitutions: [OTTAWA], countries: ['CA'], isInternational: true, authorCount: 400 }),
  pub({ title: 'Local study', year: 2022, authorIds: [9] }),
  pub({ title: 'Other partner', year: 2024, authorIds: [1], countries: ['DE'], isInternational: true }),
]);
const titles = (d: DashboardDataset) => d.publications.map((p) => p.title);

describe('chart metadata (CHART_META)', () => {
  it('covers exactly the embeddable charts', () => {
    expect(new Set(Object.keys(CHART_META))).toEqual(EMBEDDABLE_IDS);
  });

  it('places every chart of the PDF catalog in its section tab', () => {
    for (const section of REPORT_SECTIONS) {
      for (const id of section.ids) expect(CHART_META[id]?.tab, id).toBe(section.tab);
    }
  });

  it('declares parameters with consistent bounds', () => {
    for (const [id, meta] of Object.entries(CHART_META)) {
      for (const p of meta.params ?? []) {
        if (p.values) {
          expect(p.values.length, id).toBeGreaterThan(0);
          if (p.default != null) expect(p.values, id).toContain(p.default);
          continue;
        }
        expect(typeof p.min === 'number' && typeof p.max === 'number', id).toBe(true);
        expect(p.min!, id).toBeLessThanOrEqual(p.max!);
        if (p.default != null) {
          expect(p.default as number, id).toBeGreaterThanOrEqual(p.min!);
          expect(p.default as number, id).toBeLessThanOrEqual(p.max!);
        }
      }
    }
  });

  it('sanitizes chart parameters: known keys only, rounded and clamped', () => {
    expect(sanitizeChartParams('charte-scores', { thresholdPct: 140, other: 3 })).toEqual({ thresholdPct: 100 });
    expect(sanitizeChartParams('top-revues', { n: 12.4 })).toEqual({ n: 12 });
    expect(sanitizeChartParams('top-revues', { n: 'ten' })).toEqual({});
    expect(sanitizeChartParams('langues', { n: 5 })).toEqual({});
    // Enumerated parameter: only the allowed values.
    expect(sanitizeChartParams('heatmap-disciplinaire', { level: 'topic' })).toEqual({ level: 'topic' });
    expect(sanitizeChartParams('heatmap-disciplinaire', { level: 'field', n: 3 })).toEqual({});
  });

  it('offers exactly the key-figure sets declared in KPI_SET_IDS', () => {
    expect(new Set(Object.keys(KPI_SETS))).toEqual(KPI_SET_IDS);
    const items = KPI_SETS.overview.items(DS, { start: 2020, end: 2025 });
    expect(items.find((i) => i.key === 'publications')?.value).toBe('4');
    expect(items.find((i) => i.key === 'international')?.value).toBe('3');
    expect(KPI_SETS.impact.items(DS, { start: 2020, end: 2025 }).map((i) => i.key))
      .toEqual(['fwci-known', 'top10', 'top1', 'fwci-mean']);
  });

  it('counts each OpenAlex domain once per publication', () => {
    const ds = dataset([
      pub({ domains: ['Health Sciences', 'Life Sciences', 'Health Sciences'] }),
      pub({ domains: ['Health Sciences'] }),
      pub({ domains: ['Physical Sciences'], year: 2010 }),
    ]);
    expect(aggregateDomains(ds.publications, { start: 2020, end: 2025 })).toEqual([
      { key: 'Health Sciences', count: 2 },
      { key: 'Life Sciences', count: 1 },
    ]);
  });

  it('flags degenerate charts under a filter', () => {
    expect(trivialFiltersOf('pourcentage-international', { partnerKeys: ['03c4mmv16'] })).toEqual(['partnerKeys']);
    expect(trivialFiltersOf('pourcentage-international', { partnerKeys: [] })).toEqual([]);
    expect(trivialFiltersOf('top-pays', { country: 'CA' })).toEqual([]);
  });

  it('detects dataset features and the charts that lack them', () => {
    const f = datasetFeatures(DS);
    expect(f.has('composite')).toBe(false);
    expect(missingFeatures('funders-par-labo', f)).toEqual(['composite']);
    expect(missingFeatures('publications-par-annee', f)).toEqual([]);
    const composite = dataset([pub({ sousStructures: ['LAB-A'] })]);
    expect(datasetFeatures(composite).has('composite')).toBe(true);
  });
});

describe('resolvePeriod', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  it('keeps a fixed period', () => {
    expect(resolvePeriod({ kind: 'fixed', start: 2020, end: 2025 }, now)).toEqual({ start: 2020, end: 2025 });
  });
  it('counts complete years back from the current one', () => {
    expect(resolvePeriod({ kind: 'relative', lastYears: 5, includeCurrent: false }, now)).toEqual({ start: 2021, end: 2025 });
    expect(resolvePeriod({ kind: 'relative', lastYears: 3, includeCurrent: true }, now)).toEqual({ start: 2024, end: 2026 });
  });
});

describe('restrictDataset', () => {
  it('returns the dataset unchanged when nothing restricts it', () => {
    expect(restrictDataset(DS, { perimetre: 'affiliation', filters: {} })).toBe(DS);
    expect(restrictDataset(DS, { filters: { partnerKeys: [], international: false } })).toBe(DS);
  });

  it('restricts to the partner group, then excludes hyper-authored papers', () => {
    const partner = restrictDataset(DS, { filters: { partnerKeys: ['03c4mmv16'] } });
    expect(titles(partner)).toEqual(['Heart valves', 'Big consortium']);
    const small = restrictDataset(DS, { filters: { partnerKeys: ['03c4mmv16'], maxAuthors: 50 } });
    expect(titles(small)).toEqual(['Heart valves']);
    // Other fields are kept as is.
    expect(small.members).toBe(DS.members);
  });

  it('applies the headcount scope, and keeps everything without matched staff', () => {
    expect(titles(restrictDataset(DS, { perimetre: 'effectifs' }))).toEqual(['Heart valves', 'Big consortium', 'Other partner']);
    const noStaff = { ...DS, members: [], effectifsAuthorIds: [] };
    expect(restrictDataset(noStaff, { perimetre: 'effectifs' })).toBe(noStaff);
    // Public variant: effectifsAuthorIds instead of members.
    const publicVariant = { ...DS, members: [], effectifsAuthorIds: [9] };
    expect(titles(restrictDataset(publicVariant, { perimetre: 'effectifs' }))).toEqual(['Heart valves', 'Local study']);
  });

  it('counts the free-text search as a filter (unlike the list badge)', () => {
    expect(hasActiveFilter({ q: 'heart' })).toBe(true);
    expect(hasActiveFilter({ q: '  ' })).toBe(false);
    expect(hasActiveFilter({ charteSeuil: 0.5 })).toBe(false);
    expect(titles(restrictDataset(DS, { filters: { q: 'heart' } }))).toEqual(['Heart valves']);
  });
});

describe('report definition schema', () => {
  const valid = {
    schemaVersion: 1,
    name: 'Lab × University of Ottawa',
    description: '',
    context: {
      slug: 'test-lab',
      perimetre: 'affiliation',
      period: { kind: 'relative', lastYears: 5, includeCurrent: false },
      filters: { partnerKeys: ['03c4mmv16'] },
    },
    blocks: [
      { id: 's1', kind: 'section', title: 'Overview' },
      { id: 'c1', kind: 'chart', chartId: 'publications-par-annee' },
      { id: 'c2', kind: 'chart', chartId: 'distribution-fwci', override: { filters: { maxAuthors: 50 } } },
      { id: 't1', kind: 'text', markdown: 'Some **notes**.' },
    ],
    lang: 'fr',
  };

  it('accepts a valid definition', () => {
    const r = parseReportDefinition(valid);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown charts, filters and duplicate block ids', () => {
    const bad = (patch: object) => parseReportDefinition({ ...valid, ...patch });
    expect(bad({ blocks: [{ id: 'c1', kind: 'chart', chartId: 'no-such-chart' }] }).ok).toBe(false);
    expect(bad({ context: { ...valid.context, filters: { colour: 'red' } } }).ok).toBe(false);
    expect(bad({ blocks: [valid.blocks[0], valid.blocks[0]] }).ok).toBe(false);
    expect(bad({ context: { ...valid.context, period: { kind: 'fixed', start: 2025, end: 2020 } } }).ok).toBe(false);
    expect(bad({ context: { ...valid.context, slug: '../etc' } }).ok).toBe(false);
    expect(bad({ blocks: [{ id: 'k1', kind: 'kpis', setId: 'unknown' }] }).ok).toBe(false);
    expect(bad({ blocks: [{ id: 'k1', kind: 'kpis', setId: 'impact' }] }).ok).toBe(true);
    expect(bad({ blocks: [{ id: 'h1', kind: 'chart', chartId: 'heatmap-disciplinaire', params: { level: 'topic' } }] }).ok).toBe(true);
  });

  it('bounds the size of a definition', () => {
    const blocks = Array.from({ length: REPORT_LIMITS.maxBlocks + 1 }, (_, i) => ({ id: `b${i}`, kind: 'section', title: 'x' }));
    expect(parseReportDefinition({ ...valid, blocks }).ok).toBe(false);
    const huge = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, kind: 'text', markdown: 'x'.repeat(REPORT_LIMITS.maxText) }));
    const r = parseReportDefinition({ ...valid, blocks: huge });
    expect(r).toEqual({ ok: false, error: 'definition too large' });
  });
});

describe('/embed state (f and p parameters)', () => {
  it('round-trips filters, including non-ASCII text', () => {
    const filters = { partnerKeys: ['03c4mmv16'], maxAuthors: 50, q: 'cœur « valve »' };
    const [[k, raw]] = embedStateParams(filters, undefined);
    expect(k).toBe('f');
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseEmbedFilters(raw, { isPublic: true })).toEqual({ filters, error: null });
  });

  it('refuses person-level filters on the public page only', () => {
    const raw = encodeEmbedParam({ authorId: 12 });
    expect(parseEmbedFilters(raw, { isPublic: true })).toEqual({ filters: {}, error: 'forbidden' });
    expect(parseEmbedFilters(raw, { isPublic: false })).toEqual({ filters: { authorId: 12 }, error: null });
  });

  it('rejects malformed, unknown or oversized values', () => {
    expect(parseEmbedFilters('%%%', { isPublic: true })).toEqual({ filters: {}, error: 'malformed' });
    expect(parseEmbedFilters(encodeEmbedParam({ colour: 'red' }), { isPublic: true })).toEqual({ filters: {}, error: 'malformed' });
    expect(decodeEmbedParam('A'.repeat(MAX_EMBED_PARAM_LENGTH + 1))).toBeNull();
    expect(parseEmbedFilters(null, { isPublic: true })).toEqual({ filters: {}, error: null });
  });

  it('decodes chart parameters against the chart metadata', () => {
    expect(parseEmbedParams(encodeEmbedParam({ n: 99, x: 1 }), 'top-revues')).toEqual({ n: 50 });
    expect(parseEmbedParams(encodeEmbedParam([1, 2]), 'top-revues')).toEqual({});
    expect(embedStateParams({}, {})).toEqual([]);
  });
});

describe('strategic axes corrections', () => {
  const index = buildAxisCorrectionIndex(
    [
      { id: 1, fields: { doi: '10.1/X', Titre: 'Ignored', Axe_Retenu: 'Energy|Health' } },
      { id: 2, fields: { doi: '', Titre: 'Héllo, World!', Axe_Retenu: 'Digital' } },
      { id: 3, fields: { doi: '10.1/empty', Titre: 'No axis', Axe_Retenu: ' ' } },
    ],
    'Axe_Retenu',
  );

  it('matches by DOI, then by normalized title', () => {
    expect(effectiveAxe(index, pub({ doi: '10.1/x', chosenAxe: 'Materials' }))).toBe('Energy');
    expect(effectiveAxe(index, pub({ title: 'hello world', chosenAxe: 'Materials' }))).toBe('Digital');
    expect(effectiveAxe(index, pub({ doi: '10.1/empty', chosenAxe: 'Materials|Energy' }))).toBe('Materials');
  });

  it('rewrites chosenAxe so that registry charts see the corrections', () => {
    const ds = dataset([pub({ doi: '10.1/x', chosenAxe: 'Materials' }), pub({ doi: '10.1/other', chosenAxe: 'Materials' })]);
    const out = applyAxisCorrections(ds, index);
    expect(out.publications.map((p) => p.chosenAxe)).toEqual(['Energy|Health', 'Materials']);
    expect(applyAxisCorrections(ds, buildAxisCorrectionIndex([], 'Axe_Retenu'))).toBe(ds);
  });
});

describe('visibleTabKeys', () => {
  const tabs = ['overview', 'themes', 'benchmark', 'apc'] as const;
  it('always keeps the overview and applies the admin, axes and benchmark rules', () => {
    expect(visibleTabKeys(tabs, { hidden: ['overview', 'apc'], hasAxes: false, hasBenchmark: true }))
      .toEqual(['overview', 'benchmark']);
    expect(visibleTabKeys(tabs, { hidden: [], hasAxes: true, hasBenchmark: false }))
      .toEqual(['overview', 'themes', 'apc']);
  });
});
