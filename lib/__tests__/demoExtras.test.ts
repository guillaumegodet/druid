// Fictitious calls for proposals, theses and eligibility of the public demo (lib/migration/demoExtras.ts): built from the
// researchers of instances/demo/demo-data.mjs and its network, consistent with what the tab and the record show.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoExtras, type DemoNetwork, type DemoResearcherRow } from '../migration/demoExtras';

const data = await import('../../instances/demo/demo-data.mjs');
const rows = data.buildResearchers() as unknown as DemoResearcherRow[];
const network = JSON.parse(fs.readFileSync(new URL('../../instances/demo/dashboard-data/network.json', import.meta.url), 'utf8')) as DemoNetwork;
const TODAY = '2026-10-22';
const extras = demoExtras(rows, network, TODAY);

describe('demo extras', () => {
  it('names only fictitious calls, dated so that most stay open', () => {
    expect(extras.calls.every((c) => c.callId.startsWith('DEMO-') && c.url.startsWith('https://example.org/'))).toBe(true);
    const open = extras.calls.filter((c) => c.status === 'open');
    expect(open.length).toBeGreaterThanOrEqual(8);
    expect(extras.calls.some((c) => c.status === 'closed')).toBe(true);
    expect(extras.calls.some((c) => c.status === 'forthcoming')).toBe(true);
    expect(open.every((c) => c.deadlines.some((d) => d >= TODAY))).toBe(true);
  });

  it('matches present researchers of the targeted labs and cites their own publications', () => {
    const byUid = new Map(rows.map((r) => [r.uid_dyna, r]));
    expect(extras.matches.length).toBeGreaterThan(30);
    for (const m of extras.matches) {
      const r = byUid.get(m.uid)!;
      expect(r).toBeDefined();
      expect(m.units).toEqual([r.LABO]);
      expect(m.pairId).toBe(`${m.callId}|local-${m.uid}`);
      expect(!r.employment_end_date || r.employment_end_date >= TODAY).toBe(true);
      const author = network.authors.find((a) => a.uid === m.uid)!;
      for (const p of m.publications) expect(network.pubs.some((x) => x.w === p.uid && x.a.includes(author.id))).toBe(true);
    }
    // One run per programme and subset, every match attached to a run of its call's programme.
    const runs = new Map(extras.runs.map((r) => [r.runId, r]));
    const calls = new Map(extras.calls.map((c) => [c.callId, c]));
    expect(extras.matches.every((m) => runs.get(m.runId)?.programmeId === calls.get(m.callId)?.programmeId)).toBe(true);
    expect(extras.matches.filter((m) => m.overall === 'strong').length).toBeGreaterThan(5);
    expect(extras.feedback.every((f) => extras.matches.some((m) => m.pairId === f.pairId))).toBe(true);
  });

  it('reads the ERC rules from the text of the calls and finds candidates', () => {
    const schemes = extras.eligibility.map((e) => e.rule.scheme).sort();
    expect(schemes).toEqual(['ERC-CoG', 'ERC-StG']);
    const stg = extras.eligibility.find((e) => e.rule.scheme === 'ERC-StG')!;
    expect([stg.rule.phdFrom, stg.rule.phdTo, stg.rule.extensionYears]).toEqual(['2020-01-01', '2025-12-31', 2]);
    expect(stg.candidates.filter((c) => c.verdict === 'eligible').length).toBeGreaterThan(0);
    expect(extras.eligibility.every((e) => e.candidates.every((c) => c.verdict !== 'ineligible'))).toBe(true);
  });

  it('gives every permanent researcher a thesis and every PhD student one in progress', () => {
    const byUid = new Map(extras.theses.map((t) => [t.uid, t]));
    for (const r of rows) {
      const t = byUid.get(r.uid_dyna);
      if (r.Corps_grade === 'Doctorant') expect(t?.status).toBe('in_progress');
      if (['PR', 'MCF', 'DR', 'CR', 'PREM'].includes(r.Corps_grade)) {
        expect(t?.status).toBe('defended');
        expect(Number(t!.defendedOn.slice(0, 4))).toBeLessThanOrEqual(Number(r.employment_start_date.slice(0, 4)));
      }
    }
    expect(extras.theses.every((t) => t.nnt.includes('DEMO') || t.nnt.startsWith('s'))).toBe(true);
  });
});
