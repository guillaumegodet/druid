import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportDefinition } from '../../components/dashboard/report/definition';
import { aiFrameLabel, generateDomainsText, generateExecutiveText } from '../../components/dashboard/report/reportAi';
import { resolveReport } from '../../components/dashboard/report/resolveReport';
import type { DashboardDataset, DashboardPublication } from '../../components/dashboard/types';

// AI texts of the reports (docs/plan-mes-rapports.md, lot 8): server guards, client composition.
// ILAAS is simulated; data are fictitious.
const { createReportAi } = createRequire(import.meta.url)('../../scripts/lib/reports_ai.cjs');

/** Fake ILAAS answering the given contents in order. */
function fakeIlaas(...contents: string[]) {
  const calls: { system: string; user: string }[] = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ system: body.messages[0].content, user: body.messages[1].content });
    const content = contents.shift();
    if (content === undefined) return new Response('down', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  };
  return {
    ai: createReportAi({ apiBase: 'https://llm.example.org/v1', apiKey: 'k', model: 'test-model', fetchImpl, sleep: async () => {} }),
    calls,
  };
}

describe('reports_ai (server)', () => {
  it('keeps only the supplied topics, each in one theme', async () => {
    const { ai, calls } = fakeIlaas(JSON.stringify({
      domains: [
        { label: 'Heart', summary: 'Cardiology.', topics: ['Valves', 'Invented topic', 'Stroke'] },
        { label: 'Again', summary: '', topics: ['Valves'] },
        { label: 'Health economics', summary: 'Costs.', topics: ['Health costs'] },
      ],
    }));
    const out = await ai.run({ task: 'clusters', lang: 'en', items: [
      { label: 'Valves', count: 26 }, { label: 'Stroke', count: 10 }, { label: 'Health costs', count: 12 }, { label: 'Misc', count: 1 },
    ] });
    expect(out.status).toBe(200);
    expect(out.body.domains).toEqual([
      { label: 'Heart', summary: 'Cardiology.', topics: ['Valves', 'Stroke'] },
      { label: 'Health economics', summary: 'Costs.', topics: ['Health costs'] },
    ]);
    expect(out.body.unclassified).toEqual(['Misc']);
    expect(out.body.model).toBe('test-model');
    expect(calls[0].system).toContain('anglais');
  });

  it('drops highlighted names and titles that were not supplied', async () => {
    const { ai } = fakeIlaas(JSON.stringify({
      synthesis: 'A steady collaboration.',
      highlightedResearchers: ['A. Martin (LAB)', 'Invented Person'],
      highlightedTitles: ['Valve study', 'Invented title'],
    }));
    const out = await ai.run({
      task: 'cluster-synthesis',
      domain: { label: 'Heart', figures: '12 publications' },
      publications: [{ title: 'Valve study', year: 2023, journal: 'J', authors: ['A. Martin'] }],
      researchers: [{ label: 'A. Martin (LAB)', count: 3 }],
    });
    expect(out.body).toMatchObject({
      synthesis: 'A steady collaboration.',
      highlightedResearchers: ['A. Martin (LAB)'],
      highlightedTitles: ['Valve study'],
    });
  });

  it('refuses unknown tasks and empty inputs, and reports ILAAS failures', async () => {
    const { ai } = fakeIlaas();
    expect(await ai.run({ task: 'poem' })).toEqual({ status: 400, body: { error: 'Invalid AI task' } });
    expect(await ai.run({ task: 'clusters', items: [] })).toEqual({ status: 400, body: { error: 'No publication to analyze' } });
    expect(await ai.run({ task: 'executive', keyFigures: [{ label: 'Co-publications', value: '145' }] }))
      .toEqual({ status: 502, body: { error: 'Analysis failed: ILAAS HTTP 503' } });
  });

  it('retries a cut or overloaded call, not a refused one', async () => {
    const answers: (() => Response)[] = [
      () => { throw new TypeError('fetch failed'); },
      () => new Response('busy', { status: 503 }),
      () => new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"S","keyPoints":[],"leads":[]}' } }] })),
    ];
    let calls = 0;
    const retrying = createReportAi({
      apiBase: 'https://llm.example.org/v1', apiKey: 'k', model: 'm', sleep: async () => {},
      fetchImpl: async () => { calls += 1; return answers.shift()!(); },
    });
    const ok = await retrying.run({ task: 'executive', keyFigures: [{ label: 'x', value: '1' }] });
    expect(ok).toMatchObject({ status: 200, body: { summary: 'S' } });
    expect(calls).toBe(3);

    let refusedCalls = 0;
    const refused = createReportAi({
      apiBase: 'https://llm.example.org/v1', apiKey: 'k', model: 'm', sleep: async () => {},
      fetchImpl: async () => { refusedCalls += 1; return new Response('bad', { status: 400 }); },
    });
    expect((await refused.run({ task: 'executive', keyFigures: [{ label: 'x', value: '1' }] })).body)
      .toEqual({ error: 'Analysis failed: ILAAS HTTP 400' });
    expect(refusedCalls).toBe(1);
  });
});

// ── Client composition ──────────────────────────────────────────────────────

const pub = (i: number, over: Partial<DashboardPublication>): DashboardPublication => ({
  year: 2021 + (i % 5), title: `Paper ${i}`, doi: null, journal: 'J', pubType: 'Article de revue', teams: [], sousStructures: ['LAB-A'],
  authorIds: [1], countries: ['CA'], partnerInstitutions: [], nationalPartners: [], isInternational: true,
  domains: ['Health Sciences'], subfields: ['Cardiology'], topics: ['Valves'], collabTypes: [], nantesPartners: [],
  hasPhd: false, oaStatus: 'gold', fwci: 2, citedByCount: i, isTop10Percent: false, authorCount: 5,
  ...over,
} as unknown as DashboardPublication);
const DS = {
  lab: 'LAB', name: 'Test lab', slug: 'lab', teamLabel: 'Team', strategicAxes: [],
  publications: [
    ...Array.from({ length: 4 }, (_, i) => pub(i, { topics: ['Valves'] })),
    ...Array.from({ length: 2 }, (_, i) => pub(10 + i, { topics: ['Health costs'], domains: ['Social Sciences'] })),
    pub(20, { topics: ['Misc'] }),
  ],
  authors: [{ id: 1, label: 'A. Martin', teams: ['LAB-A'] }], members: [], effectifsAuthorIds: [], countryNames: {},
} as unknown as DashboardDataset;
const def: ReportDefinition = {
  schemaVersion: 1, name: 'R', description: '', lang: 'en',
  context: { slug: 'lab', perimetre: 'affiliation', period: { kind: 'fixed', start: 2021, end: 2025 }, filters: {} },
  blocks: [
    { id: 'x', kind: 'ai', task: 'executive' },
    { id: 'd', kind: 'ai', task: 'domains', text: '## Heart\n\nPrevious analysis.' },
  ],
};
const rbOf = (id: string) => resolveReport(def, { lab: DS }, new Date('2026-09-28T12:00:00Z')).blocks.find((b) => b.block.id === id)!;

describe('reportAi (client)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubAnswers = (...answers: object[]) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ...answers.shift(), model: 'test-model' }));
    });
    return bodies;
  };

  it('writes one section per theme, figures computed by the code, small themes without synthesis', async () => {
    const bodies = stubAnswers(
      { domains: [{ label: 'Heart', summary: '', topics: ['Valves'] }, { label: 'Economics', summary: '', topics: ['Health costs'] }] },
      { synthesis: 'Heart synthesis.' },
    );
    const progress: number[] = [];
    const r = await generateDomainsText(rbOf('d'), 'en', (p) => progress.push(p.done));
    expect(r.model).toBe('test-model');
    expect(r.text).toContain('## Heart');
    expect(r.text).toContain('4 publications (57% of the corpus)');
    expect(r.text).toContain('Heart synthesis.');
    // « Economics » has 2 publications: figures only, no ILAAS call.
    expect(r.text).toContain('## Economics');
    expect(bodies.map((b) => b.task)).toEqual(['clusters', 'cluster-synthesis']);
    expect(r.text).toMatch(/1 publications do not fall/);
    expect(progress.at(-1)).toBe(2);
  });

  it('falls back on the OpenAlex domains when no theme comes back', async () => {
    stubAnswers({ domains: [] }, { synthesis: 'Health synthesis.' });
    const r = await generateDomainsText(rbOf('d'), 'en');
    expect(r.text).toContain('## Health Sciences');
    expect(r.text).toContain('## Social Sciences');
  });

  it('builds the executive summary from the key figures and the theme analysis', async () => {
    const bodies = stubAnswers({ summary: 'Summary.', keyPoints: ['Point A'], leads: ['Lead A'] });
    const r = await generateExecutiveText(rbOf('x'), def, 'en');
    expect(r.text).toBe('Summary.\n\n### Key points\n\n- Point A\n\n### Cooperation leads\n\n- Lead A');
    expect(bodies[0].domainTexts).toBe('## Heart\n\nPrevious analysis.');
    expect((bodies[0].keyFigures as { label: string }[]).map((f) => f.label)).toContain('Publications');
  });

  it('gives the volume figures without the large-collaboration exclusion of the block (Ottawa case)', async () => {
    const O = { name: 'U Ottawa', cc: 'CA', city: null, lat: null, lon: null, ror: '03c4mmv16' };
    const ds = {
      ...DS,
      publications: [
        ...Array.from({ length: 3 }, (_, i) => pub(i, { partnerInstitutions: [O] })),
        pub(9, { partnerInstitutions: [O], authorCount: 400 }),
      ],
    } as unknown as DashboardDataset;
    const d: ReportDefinition = {
      ...def,
      context: { ...def.context, filters: { partnerKeys: ['03c4mmv16'] } },
      blocks: [{ id: 'x', kind: 'ai', task: 'executive', override: { filters: { maxAuthors: 50 } } }],
    };
    const rb = resolveReport(d, { lab: ds }, new Date('2026-09-28T12:00:00Z')).blocks[0];
    const bodies = stubAnswers({ summary: 'S', keyPoints: [], leads: [] });
    await generateExecutiveText(rb, d, 'en');
    const figures = Object.fromEntries((bodies[0].keyFigures as { label: string; value: string }[]).map((f) => [f.label, f.value]));
    expect(figures['Co-publications']).toBe('4');
    expect(figures['Large collaborations']).toBe('25 %');
    expect(figures['Impact indicators']).toMatch(/more than 50 authors/);
  });

  it('says in the frame whether a person reviewed the text', () => {
    expect(aiFrameLabel({ model: 'm' })).toBe('Text generated by AI (ILAAS, m) — not reviewed yet');
    expect(aiFrameLabel({ model: 'm', reviewedBy: 'A. Martin', reviewedAt: '2026-09-28' }))
      .toBe('Text generated by AI (ILAAS, m) — reviewed by A. Martin on 2026-09-28');
  });
});
