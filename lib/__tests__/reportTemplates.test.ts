import { describe, expect, it } from 'vitest';
import { parseReportDefinition, type ReportBlock } from '../../components/dashboard/report/definition';
import { resolveReport } from '../../components/dashboard/report/resolveReport';
import {
  DEFAULT_PERIOD,
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

  it('international collaborations: optional partner country, international-only themes and impact', () => {
    const t = templateById('international')!;
    const all = t.build(input, { dataset: LAB, hiddenTabs: [] });
    expect(all.context.filters).toEqual({});
    expect(charts(all.blocks)).toContain('zone-ue');

    const ca = t.build({ ...input, country: 'ca' }, { dataset: LAB, hiddenTabs: [] });
    expect(ca.context.filters).toEqual({ country: 'CA' });
    expect(ca.templateParams).toEqual({ country: 'CA' });
    // Charts degenerate under a country filter are left out.
    expect(charts(ca.blocks)).not.toContain('zone-ue');
    const r = resolveReport(ca, { lab: LAB }, new Date('2026-09-28T12:00:00Z'));
    const fwci = r.blocks.find((b) => b.block.kind === 'chart' && b.block.chartId === 'distribution-fwci')!;
    expect(fwci.scope?.filters).toEqual({ country: 'CA', international: true });
    expect(fwci.dataset?.publications).toHaveLength(3);
  });

  it('lists partner countries by frequency', () => {
    expect(partnerCountries(LAB)).toEqual(['CA', 'DE']);
    expect(partnerCountries(null)).toEqual([]);
  });
});
