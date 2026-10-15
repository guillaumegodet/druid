import { describe, expect, it } from 'vitest';
import { BUILT_IN_FUNDERS, BUILT_IN_PROGRAMMES, portalTopicUrl, statusFromDeadlines } from '../calls/programmes';

describe('statusFromDeadlines', () => {
  it('is unknown without deadline, open before a deadline, closed after the last one', () => {
    expect(statusFromDeadlines([], '2026-10-15')).toBe('unknown');
    expect(statusFromDeadlines(['2026-10-15'], '2026-10-15')).toBe('open');
    expect(statusFromDeadlines(['2026-01-10', '2026-12-01'], '2026-10-15')).toBe('open');
    expect(statusFromDeadlines(['2026-01-10'], '2026-10-15')).toBe('closed');
  });
  it('is forthcoming before the opening date', () => {
    expect(statusFromDeadlines(['2027-03-31'], '2026-10-15', '2026-12-01')).toBe('forthcoming');
    expect(statusFromDeadlines(['2027-03-31'], '2026-12-01', '2026-12-01')).toBe('open');
  });
});

describe('built-in programmes', () => {
  it('every programme has its funder', () => {
    const funders = new Set(BUILT_IN_FUNDERS.map((f) => f.funderId));
    for (const p of BUILT_IN_PROGRAMMES) expect(funders.has(p.funderId)).toBe(true);
  });
  it('builds the portal page of a topic in lower case', () => {
    expect(portalTopicUrl('HORIZON-CL9-2026-01-TEST-01')).toMatch(/topic-details\/horizon-cl9-2026-01-test-01$/);
  });
});
