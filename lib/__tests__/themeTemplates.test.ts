import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KPI_SETS } from '../../components/dashboard/kpiItems';
import { buildFilterContext, describeFilters, matchesFilters } from '../../components/dashboard/publicationFilters';
import { parseReportDefinition } from '../../components/dashboard/report/definition';
import { generateExecutiveText } from '../../components/dashboard/report/reportAi';
import { resolveReport } from '../../components/dashboard/report/resolveReport';
import { datasetPublishers, DEFAULT_PERIOD, templateById } from '../../components/dashboard/report/templates';
import type { DashboardDataset, DashboardPublication } from '../../components/dashboard/types';

// « Analyse des financements » and « Analyse des revues » templates (docs/plan-mes-rapports.md,
// lot 10). Fictitious corpus: 2 ANR-funded, 1 European-funded, 3 unfunded publications.
const { createReportAi } = createRequire(import.meta.url)('../../scripts/lib/reports_ai.cjs');

const pub = (over: Partial<DashboardPublication>): DashboardPublication => ({
  year: 2023, title: 'T', doi: null, journal: 'J1', journalPublisher: 'Elsevier', pubType: 'Article de revue',
  teams: [], sousStructures: [], authorIds: [1], countries: [], partnerInstitutions: [], nationalPartners: [],
  isInternational: false, domains: [], subfields: [], topics: [], collabTypes: [], nantesPartners: [],
  oaStatus: 'closed', sjrQuartile: 'Q2', journalAccess: null, licenceNationale: false, hasApc: false,
  fwci: 1, isTop10Percent: false, charte: null, funders: [], awards: [],
  ...over,
} as unknown as DashboardPublication);
const ANR = { id: null, name: 'Agence Nationale de la Recherche', ror: null };
const ERC = { id: null, name: 'European Research Council', ror: null };
const DS = {
  lab: 'LAB', name: 'Test lab', slug: 'lab', teamLabel: 'Team', strategicAxes: [], authors: [], members: [],
  effectifsAuthorIds: [], countryNames: {},
  publications: [
    pub({ title: 'A', funders: [ANR], fwci: 3, isTop10Percent: true, sjrQuartile: 'Q1', oaStatus: 'gold', journalPublisher: 'Springer' }),
    pub({ title: 'B', funders: [ANR, ERC], fwci: 2 }),
    pub({ title: 'C', awards: [{ funderId: null, funderName: 'European Commission', projectId: 'H2020-1', projectName: null, source: 'hal' }], fwci: 4 }),
    pub({ title: 'D', fwci: 0.5 }),
    pub({ title: 'E', fwci: 1 }),
    pub({ title: 'F', fwci: 1.5, hasApc: true }),
  ],
} as unknown as DashboardDataset;
const RANGE = { start: 2021, end: 2025 };
const titles = (f: object) => DS.publications.filter((p) => matchesFilters(p, f, buildFilterContext(DS))).map((p) => p.title);
const at = new Date('2026-09-28T12:00:00Z');

describe('funding filters', () => {
  it('match funded publications, a funder category and a funder', () => {
    expect(titles({ funded: true })).toEqual(['A', 'B', 'C']);
    expect(titles({ funderCategory: 'Europe' })).toEqual(['B', 'C']);
    expect(titles({ funderCategory: 'ANR' })).toEqual(['A', 'B']);
    expect(describeFilters({ funderCategory: 'Europe', funded: true }, buildFilterContext(DS)).map((c) => c.label))
      .toEqual(['Funders: Europe', 'Acknowledges a funder']);
  });
});

describe('funding and journals key figures', () => {
  it('computes funding coverage and the impact of funded vs unfunded publications', () => {
    const items = Object.fromEntries(KPI_SETS.funding.items(DS, RANGE, { source: DS, filters: {} }).map((i) => [i.key, i]));
    expect(items.funded.value).toBe('3');
    expect(items.funded.hint).toBe('50% of the corpus acknowledges a funder');
    expect(items.anr.value).toBe('2');
    expect(items.europe.value).toBe('2');
    expect(items['fwci-funded']).toMatchObject({ value: '3.00', hint: 'articles without funder: 1.00' });
    expect(items['top10-funded'].value).toBe('33 %');
    // Impact compared on journal articles only (a funded chapter does not count).
    const withChapter = { ...DS, publications: [...DS.publications, pub({ title: 'G', funders: [ANR], fwci: 50, pubType: 'Chapitre de livre' })] };
    const again = Object.fromEntries(KPI_SETS.funding.items(withChapter, RANGE, { source: withChapter, filters: {} }).map((i) => [i.key, i.value]));
    expect(again['fwci-funded']).toBe('3.00');
    expect(again.funded).toBe('4');
  });

  it('computes the journal figures', () => {
    const items = Object.fromEntries(KPI_SETS.journals.items(DS, RANGE, { source: DS, filters: {} }).map((i) => [i.key, i.value]));
    expect(items).toMatchObject({ journals: '1', q1: '17 %', open: '17 %', apc: '1' });
    expect(items).not.toHaveProperty('charter'); // no charter score in this corpus
  });
});

describe('funding and journals templates', () => {
  const input = { name: 'R', slug: 'lab', period: DEFAULT_PERIOD, perimetre: 'affiliation' as const, lang: 'en' as const };

  it('build valid funding reports, optionally for one category of funders', () => {
    const all = templateById('funding')!.build(input, { dataset: DS, hiddenTabs: [] });
    expect(parseReportDefinition(all).ok).toBe(true);
    expect(all.context.filters).toEqual({});
    const charts = (d: typeof all) => d.blocks.flatMap((b) => (b.kind === 'chart' ? [b.chartId] : []));
    expect(charts(all)).toContain('funders-categories');
    const europe = templateById('funding')!.build({ ...input, funderCategory: 'Europe' }, { dataset: DS, hiddenTabs: [] });
    expect(europe.context.filters).toEqual({ funderCategory: 'Europe' });
    expect(charts(europe)).not.toContain('funders-categories'); // degenerate on one category
    // Themes and impact on the funded publications only.
    const fwci = europe.blocks.find((b) => b.kind === 'chart' && b.chartId === 'distribution-fwci');
    expect(fwci).toMatchObject({ override: { filters: { funded: true } } });
    expect(europe.blocks.some((b) => b.kind === 'kpis' && b.setId === 'funding')).toBe(true);
  });

  it('build valid journals reports, optionally for one publisher', () => {
    expect(datasetPublishers(DS)).toEqual(['Elsevier', 'Springer']);
    const def = templateById('journals')!.build({ ...input, publisher: 'Elsevier' }, { dataset: DS, hiddenTabs: [] });
    expect(parseReportDefinition(def).ok).toBe(true);
    expect(def.context.filters).toEqual({ publisher: 'Elsevier' });
    // No journal access data nor charter scores: those sections are dropped.
    expect(def.blocks.some((b) => b.kind === 'chart' && b.chartId === 'acces-revues')).toBe(false);
    expect(def.blocks.some((b) => b.kind === 'chart' && b.chartId === 'charte-conformite')).toBe(false);
    def.blocks.forEach((b, i) => { if (b.kind === 'section') expect(def.blocks[i + 1]?.kind).not.toBe('section'); });
  });
});

describe('executive summary outside collaborations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the key-figure sets of the report and asks for leads for action', async () => {
    const def = templateById('funding')!.build({ name: 'R', slug: 'lab', period: DEFAULT_PERIOD, perimetre: 'affiliation', lang: 'en' }, { dataset: DS, hiddenTabs: [] });
    const rb = resolveReport(def, { lab: DS }, at).blocks.find((b) => b.block.kind === 'ai')!;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ summary: 'S', keyPoints: [], leads: ['Do X'], model: 'm' }));
    });
    const r = await generateExecutiveText(rb, def, 'en');
    expect(bodies[0].focus).toBe('general');
    expect((bodies[0].keyFigures as { label: string }[]).map((f) => f.label)).toContain('Funded publications');
    expect(r.text).toContain('### Leads for action');
  });

  it('adapts the server prompt to the focus', async () => {
    const systems: string[] = [];
    const ai = createReportAi({
      apiBase: 'https://llm.example.org/v1', apiKey: 'k', model: 'm', sleep: async () => {},
      fetchImpl: async (_u: string, init: RequestInit) => {
        systems.push(JSON.parse(String(init.body)).messages[0].content);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"S","keyPoints":[],"leads":[]}' } }] }));
      },
    });
    await ai.run({ task: 'executive', focus: 'general', keyFigures: [{ label: 'x', value: '1' }] });
    await ai.run({ task: 'executive', keyFigures: [{ label: 'x', value: '1' }] });
    expect(systems[0]).toContain("pistes d'action");
    expect(systems[1]).toContain('pistes de coopération');
  });
});
