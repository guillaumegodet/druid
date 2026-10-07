import { describe, expect, it } from 'vitest';
import { parseReportDefinition, type ReportBlock } from '../../components/dashboard/report/definition';
import { resolveReport } from '../../components/dashboard/report/resolveReport';
import { KPI_SETS } from '../../components/dashboard/kpiItems';
import {
  DEFAULT_PERIOD,
  instantiateReportTemplate,
  partnerCountries,
  REPORT_TEMPLATES,
  templateById,
  type TemplateInput,
} from '../../components/dashboard/report/templates';
import type { DashboardDataset, DashboardPublication } from '../../components/dashboard/types';

// Report templates (docs/plan-mes-rapports.md, lot 5). Fictitious lab dashboard: teams, no
// member labs (not composite), no strategic axis.
const pub = (over: Partial<DashboardPublication>): DashboardPublication => ({
  year: 2023, title: 'T', doi: null, journal: null, pubType: 'Article de revue', teams: ['Team A'], sousStructures: [],
  authorIds: [1], countries: [], partnerInstitutions: [], nationalPartners: [], isInternational: false,
  domains: ['Health Sciences'], subfields: [], topics: [], collabTypes: [], nantesPartners: [], hasPhd: false,
  journalAccess: null, charte: null, chosenAxe: null, authorCount: 3,
  ...over,
} as unknown as DashboardPublication);
const LAB = {
  lab: 'LAB', name: 'Test lab', slug: 'lab', teamLabel: 'Team', strategicAxes: [],
  publications: [
    pub({ countries: ['CA'], isInternational: true }),
    pub({ countries: ['CA', 'DE'], isInternational: true }),
    pub({ countries: ['DE'], isInternational: true }),
    pub({ countries: ['CA'], isInternational: true, year: 2024 }),
  ],
  authors: [], members: [], effectifsAuthorIds: [], countryNames: {},
} as unknown as DashboardDataset;

const input: TemplateInput = { name: 'Lab report', slug: 'lab', period: DEFAULT_PERIOD, perimetre: 'affiliation', lang: 'fr' };
const charts = (blocks: ReportBlock[]) => blocks.filter((b) => b.kind === 'chart').map((b) => (b as { chartId: string }).chartId);

describe('report templates', () => {
  it('build valid definitions, with or without the structure data', () => {
    for (const t of REPORT_TEMPLATES) {
      for (const dataset of [LAB, null]) {
        const def = t.build(input, { dataset, hiddenTabs: [] });
        const r = parseReportDefinition(def);
        expect(r.ok, `${t.id}: ${(r as { error?: string }).error ?? ''}`).toBe(true);
        expect(def.context.period).toEqual(DEFAULT_PERIOD);
      }
    }
    expect(templateById('blank')!.build(input, { dataset: LAB, hiddenTabs: [] })).not.toHaveProperty('templateId');
  });

  it('structure report: one section per visible tab, only the charts the structure can show', () => {
    const def = templateById('structure')!.build(input, { dataset: LAB, hiddenTabs: ['apc'] });
    const ids = charts(def.blocks);
    expect(def.templateId).toBe('structure');
    expect(ids).toContain('equipes-repartition');
    expect(ids).not.toContain('funders-par-labo'); // not composite
    expect(ids).not.toContain('axes-repartition'); // no strategic axis
    expect(ids).not.toContain('apc-evolution'); // tab hidden by the admin
    expect(def.blocks.slice(0, 2).map((b) => b.kind)).toEqual(['section', 'kpis']);
    // No empty section: every section is followed by content.
    def.blocks.forEach((b, i) => { if (b.kind === 'section') expect(def.blocks[i + 1]?.kind).not.toBe('section'); });
  });

  it('international collaborations: every partner country, international-only themes and impact', () => {
    const t = templateById('international')!;
    expect(t.params).not.toContain('country');
    const all = t.build({ ...input, country: 'CA' }, { dataset: LAB, hiddenTabs: [] });
    // One country is the « country » template: the international one ignores it.
    expect(all.context.filters).toEqual({});
    expect(charts(all.blocks)).toContain('zone-ue');
    const r = resolveReport(all, { lab: LAB }, new Date('2026-09-28T12:00:00Z'));
    const fwci = r.blocks.find((b) => b.block.kind === 'chart' && b.block.chartId === 'distribution-fwci')!;
    expect(fwci.scope?.filters).toEqual({ international: true });
    expect(fwci.dataset?.publications).toHaveLength(4);
  });

  it('collaboration with a country: charts about that country only, impact without large collaborations', () => {
    const t = templateById('country')!;
    expect(t.params).toContain('country');
    const ca = t.build({ ...input, country: 'ca' }, { dataset: LAB, hiddenTabs: [] });
    expect(ca.context.filters).toEqual({ country: 'CA' });
    expect(ca.templateParams).toEqual({ country: 'CA' });
    expect(ca.footerNote).toBeTruthy();
    const ids = charts(ca.blocks);
    expect(ids).toEqual(expect.arrayContaining(['pays-evolution', 'pays-rang', 'pays-etablissements', 'pays-specialisation', 'pays-financeurs']));
    // No chart about all the partner countries, no lab chart without labs (lab dashboard: teams).
    expect(ids.filter((id) => ['carte-monde', 'top-pays', 'zone-ue', 'evolution-pays'].includes(id))).toEqual([]);
    expect(ca.blocks.filter((b) => b.kind === 'kpis').map((b) => (b as { setId: string }).setId)).toEqual(['country', 'country-impact']);
    // The texts carry no figure: they would go stale with the data.
    const texts = ca.blocks.filter((b) => b.kind === 'text').map((b) => (b as { markdown: string }).markdown).join(' ');
    expect(texts).not.toMatch(/\d{3,}/);

    const r = resolveReport(ca, { lab: LAB }, new Date('2026-09-28T12:00:00Z'));
    const fwci = r.blocks.find((b) => b.block.kind === 'chart' && b.block.chartId === 'distribution-fwci')!;
    expect(fwci.scope?.filters).toEqual({ country: 'CA', maxAuthors: 50 });
    const rank = r.blocks.find((b) => b.block.kind === 'chart' && b.block.chartId === 'pays-rang')!;
    expect(rank.status).toBe('ok');
    // The chart gets the whole corpus too (rank, share of the international co-publications).
    expect(rank.dataset?.publications).toHaveLength(3);
    expect(rank.source?.publications).toHaveLength(4);

    // Key figures of the block: rank and share read on the whole corpus, not on the 3 co-publications.
    const kb = r.blocks.find((b) => b.block.kind === 'kpis' && b.block.setId === 'country')!;
    const items = KPI_SETS.country.items(kb.dataset!, kb.scope!.range, { source: kb.source, filters: kb.scope!.filters });
    const value = (key: string) => items.find((i) => i.key === key)?.value;
    expect([value('copubs'), value('intl-share'), value('rank')]).toEqual(['3', '75 %', '1']);
    expect(KPI_SETS['country-impact'].items(kb.dataset!, kb.scope!.range, { source: kb.source, filters: kb.scope!.filters }))
      .toHaveLength(3);
    // Regions: only with an export that knows them (exports since 2026-10-07).
    expect(ids).not.toContain('pays-regions');
    const withRegions = {
      ...LAB,
      publications: LAB.publications.map((p) => ({
        ...p,
        partnerInstitutions: [{ name: 'Univ Alpha', cc: 'CA', city: null, lat: null, lon: null, ror: '0aaaaaaa1', region: 'Quebec' }],
      })),
    } as DashboardDataset;
    expect(charts(t.build({ ...input, country: 'CA' }, { dataset: withRegions, hiddenTabs: [] }).blocks)).toContain('pays-regions');

    // Without a country in the filters, the sets stay empty instead of failing.
    expect(KPI_SETS.country.items(LAB, kb.scope!.range, { source: LAB, filters: {} })).toEqual([]);
  });

  it('lists partner countries by frequency', () => {
    expect(partnerCountries(LAB)).toEqual(['CA', 'DE']);
    expect(partnerCountries(null)).toEqual([]);
  });

  it('instantiates an instance template on another structure and period', () => {
    const source = templateById('country')!.build({ ...input, country: 'CA' }, { dataset: LAB, hiddenTabs: [] });
    const def = instantiateReportTemplate(source, 12, { ...input, name: 'Copy', slug: 'other', period: { kind: 'fixed', start: 2020, end: 2022 } });
    expect(parseReportDefinition(def).ok).toBe(true);
    expect(def).toMatchObject({ name: 'Copy', templateId: 'report:12', context: { slug: 'other', filters: { country: 'CA' } } });
    expect(def.blocks).toHaveLength(source.blocks.length);
    expect(def.blocks.every((b, i) => b.id !== source.blocks[i].id)).toBe(true);
    expect(new Set(def.blocks.map((b) => b.id)).size).toBe(def.blocks.length);
  });
});
