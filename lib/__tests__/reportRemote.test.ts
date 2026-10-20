import { describe, expect, it } from 'vitest';
import { REPORT_ONLY_IDS } from '../../components/dashboard/embedIds';
import { sanitizeChartParams } from '../../components/dashboard/chartMeta';
import { KPI_SETS } from '../../components/dashboard/kpiItems';
import { pairsChartParams, pairsParamsOf, type PairsResponse } from '../../components/dashboard/pairsApi';
import { parseReportDefinition, type ReportDefinition } from '../../components/dashboard/report/definition';
import { REPORT_ONLY_CHARTS } from '../../components/dashboard/report/reportCharts';
import { REPORT_TABLES } from '../../components/dashboard/report/reportTables';
import { reportRemoteRequests, resolveReport } from '../../components/dashboard/report/resolveReport';
import type { DashboardDataset } from '../../components/dashboard/types';

// Report blocks fed by a remote source (druid-internal `docs/plan-binomes-chercheurs.md`, lot 2b): the
// researcher pairs. Fictitious researchers and labs.

const LAB = {
  lab: 'LAB', name: 'lab', slug: 'lab', teamLabel: 'Team', strategicAxes: [], publications: [],
  authors: [], members: [], effectifsAuthorIds: [], countryNames: {},
} as unknown as DashboardDataset;

const author = (id: number, label: string, labs: string[]) => ({ id, label, labs, poles: [], phd: false });
const PAIRS: PairsResponse = {
  source: 'univ-test', generatedAt: '2026-10-01T00:00:00Z', version: 3, structureLabs: ['LAB'],
  poles: [{ acronym: 'P1', name: 'Pole 1' }, { acronym: 'P2', name: 'Pole 2' }],
  coverage: { authors: 10, resolvedAuthors: 9, signatures: 100, resolvedSignatures: 80 },
  restricted: false,
  pairs: [
    { a: author(1, 'Alma Verdier', ['LAB']), b: author(2, 'Basile Oudin', ['LBX']), shared: 6, share: [0.3, 0.2], first: 2021, last: 2025, trend: 'rising', distance: 0.62, crossPole: true, subfields: [] },
    { a: author(1, 'Alma Verdier', ['LAB']), b: author(3, 'Cyrielle Pons', ['LCY']), shared: 2, share: [0.1, 0.5], first: 2020, last: 2020, trend: 'dormant', distance: null, crossPole: false, subfields: [] },
  ],
  total: 2,
  counts: { new: 0, dormant: 1, rising: 1, steady: 0, distant: 1, crossPole: 1, authors: 3, perimeter: 20, perimeterEngaged: 1, perimeterCrossPole: 1 },
  labMatrix: [{ a: 'LAB', b: 'LBX', pairs: 1, new: 0, dormant: 0 }],
  poleMatrix: [{ a: 'P1', b: 'P2', pairs: 1, new: 0, dormant: 0 }],
  refYear: 2025,
};

const def: ReportDefinition = {
  schemaVersion: 1,
  name: 'Pairs',
  description: '',
  context: { slug: 'lab', perimetre: 'affiliation', period: { kind: 'fixed', start: 2020, end: 2025 }, filters: {} },
  blocks: [
    { id: 'm1', kind: 'chart', chartId: 'collab-pairs-poles', params: { relation: 'pole' } },
    { id: 'm2', kind: 'chart', chartId: 'collab-pairs-labs', params: { relation: 'pole', junk: 3 } },
    { id: 'k1', kind: 'kpis', setId: 'pairs', params: { relation: 'pole' } },
    { id: 't1', kind: 'table', tableId: 'pairs', limit: 1 },
    { id: 'c1', kind: 'chart', chartId: 'publications-par-annee' },
  ],
  lang: 'fr',
};
const at = new Date('2026-10-20T12:00:00Z');

describe('report-only charts', () => {
  it('have a component and are accepted by the definition schema', () => {
    expect(new Set(Object.keys(REPORT_ONLY_CHARTS))).toEqual(REPORT_ONLY_IDS);
    expect(parseReportDefinition(def).ok).toBe(true);
    const unknown = { ...def, blocks: [{ id: 'x', kind: 'chart', chartId: 'collab-pairs-nope' }] };
    expect(parseReportDefinition(unknown)).toMatchObject({ ok: false });
  });
});

describe('remote requests', () => {
  it('fetches once per distinct source, structure, period and options', () => {
    const reqs = reportRemoteRequests(def, at);
    // m1, m2 and k1 share their options (the unknown key is dropped); t1 uses the defaults.
    expect(reqs).toHaveLength(2);
    expect(reqs.map((r) => r.params)).toEqual([{ relation: 'pole' }, {}]);
    expect(reqs.every((r) => r.source === 'pairs' && r.slug === 'lab' && r.range.start === 2020)).toBe(true);
  });

  it('keeps remote blocks loading until their payload arrives, whatever the dataset', () => {
    const loading = resolveReport(def, {}, at);
    const status = (r: ReturnType<typeof resolveReport>) => Object.fromEntries(r.blocks.map((b) => [b.block.id, b.status]));
    expect(status(loading)).toEqual({ m1: 'loading', m2: 'loading', k1: 'loading', t1: 'loading', c1: 'loading' });

    const [poleReq, defaultReq] = reportRemoteRequests(def, at);
    const partial = resolveReport(def, { lab: LAB }, at, { [poleReq.key]: PAIRS, [defaultReq.key]: null });
    expect(status(partial)).toEqual({ m1: 'ok', m2: 'ok', k1: 'ok', t1: 'no-data', c1: 'ok' });
    const m1 = partial.blocks[0];
    expect(m1.remote).toBe(PAIRS);
    expect(m1.dataset).toBeNull();
    expect(partial.blocks[4].remoteRequest).toBeNull();
  });
});

describe('pairs key figures and table', () => {
  it('reads the key figures from the payload', () => {
    const items = KPI_SETS.pairs.items(LAB, { start: 2020, end: 2025 }, { source: null, filters: {}, remote: PAIRS });
    expect(items.find((i) => i.key === 'pairs-active')?.value).toBe('1');
    expect(items.find((i) => i.key === 'pairs-cross-pole-researchers')).toBeDefined();
    expect(KPI_SETS.pairs.items(LAB, { start: 2020, end: 2025 })).toEqual([]);
  });

  it('prints the pairs, most joint publications first, within the limit', () => {
    const t = REPORT_TABLES.pairs.build(null, { start: 2020, end: 2025 }, 1, PAIRS);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].slice(0, 4)).toEqual(['Alma Verdier (LAB)', 'Basile Oudin (LBX)', '6', '2021–2025']);
    expect(t.rows[0][5]).toBe('0.62');
    expect(t.omitted).toBe(1);
    expect(REPORT_TABLES.pairs.build(null, { start: 2020, end: 2025 }, 10).rows).toEqual([]);
  });
});

describe('pairs options as block parameters', () => {
  it('round-trips the sub-tab options, defaults left out', () => {
    const range = { start: 2020, end: 2025 };
    const base = pairsParamsOf(range, {});
    expect(pairsChartParams(base)).toEqual({});
    const custom = { ...base, relation: 'P1|P2' as const, membership: 'members' as const, minShared: 3, distantOnly: true, includePhd: false };
    const params = pairsChartParams(custom);
    expect(params).toEqual({ poles: 'P1|P2', membership: 'members', minShared: 3, profiles: 'distant', phd: 'exclude' });
    expect(pairsParamsOf(range, sanitizeChartParams('collab-pairs-labs', params))).toEqual(custom);
  });

  it('accepts a couple of poles only in the A|B form', () => {
    expect(sanitizeChartParams('collab-pairs-poles', { poles: 'Santé|S&T' })).toEqual({ poles: 'Santé|S&T' });
    expect(sanitizeChartParams('collab-pairs-poles', { poles: 'A|B|C' })).toEqual({});
    expect(sanitizeChartParams('collab-pairs-poles', { poles: 'A,B' })).toEqual({});
  });
});
