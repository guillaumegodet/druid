import { describe, expect, it } from 'vitest';
import {
  callsWithMatches, inPerimeter, isOpenAt, matchesByResearcher, nextDeadlineOf, programmesOfCategory, subsetsOf, uidsOf,
  type Call, type CallMatch, type ProgrammeView,
} from '../calls/aggregate';

const call = (callId: string, deadlines: string[], programmeId = 'horizon-europe', subset = 'CL9', title = callId): Call =>
  ({ callId, programmeId, subset, scheme: '', title, summary: '', taxonomy: {}, openingDate: null, deadlines, url: '', status: deadlines.length ? 'open' : 'unknown' });
const match = (callId: string, uid: string, overall: CallMatch['overall'], score: number): CallMatch =>
  ({ pairId: `${callId}|local-${uid}`, callId, uid, personName: uid.toUpperCase(), units: [], score, overall, justification: '', publications: [], eligible: null, feedback: {}, mine: null });

const calls = [
  call('T-OPEN', ['2027-03-31']), call('T-CLOSED', ['2026-01-10']), call('T-TWO', ['2026-01-10', '2026-12-01']), call('T-NONE', []),
  call('AAPG-H12', ['2026-10-30'], 'anr-aapg', 'H.12'),
];
const matches = [
  match('T-OPEN', 'a', 'plausible', 0.6), match('T-OPEN', 'b', 'strong', 0.5), match('T-OPEN', 'c', 'strong', 0.9),
  match('T-CLOSED', 'a', 'strong', 1), match('T-TWO', 'z', 'weak', 0.4), match('AAPG-H12', 'a', 'strong', 1),
];
const TODAY = '2026-10-14';

describe('nextDeadlineOf / isOpenAt', () => {
  it('gives the first deadline not yet passed, null when all have passed', () => {
    expect(nextDeadlineOf(['2026-01-10', '2026-12-01'], TODAY)).toBe('2026-12-01');
    expect(nextDeadlineOf(['2026-01-10'], TODAY)).toBeNull();
    expect(nextDeadlineOf([], TODAY)).toBeNull();
  });
  it('keeps a call without deadline open', () => {
    expect(isOpenAt({ deadlines: [] }, TODAY)).toBe(true);
    expect(isOpenAt({ deadlines: ['2026-01-10'] }, TODAY)).toBe(false);
  });
});

describe('callsWithMatches', () => {
  it('hides closed calls by default, sorts by next deadline then by matches, strongest match first', () => {
    const rows = callsWithMatches(calls, matches, { today: TODAY });
    expect(rows.map((r) => r.callId)).toEqual(['AAPG-H12', 'T-TWO', 'T-OPEN', 'T-NONE']);
    expect(rows[2].matches.map((m) => m.uid)).toEqual(['c', 'b', 'a']);
  });

  it('keeps closed calls with includePast and narrows to the given uids', () => {
    const rows = callsWithMatches(calls, matches, { today: TODAY, includePast: true, uids: new Set(['a']) });
    // Calls without a next deadline come last, the closed one before the one without any deadline (more matches).
    expect(rows.map((r) => [r.callId, r.matches.length])).toEqual([['AAPG-H12', 1], ['T-TWO', 0], ['T-OPEN', 1], ['T-CLOSED', 1], ['T-NONE', 0]]);
  });

  it('filters by programme and by subset', () => {
    expect(callsWithMatches(calls, matches, { today: TODAY, programmeIds: new Set(['anr-aapg']) }).map((r) => r.callId)).toEqual(['AAPG-H12']);
    expect(callsWithMatches(calls, matches, { today: TODAY, programmeIds: new Set(), subset: 'CL9' }).map((r) => r.callId)).toEqual(['T-TWO', 'T-OPEN', 'T-NONE']);
  });
});

describe('matchesByResearcher', () => {
  it('groups by researcher, most matches first, and drops unknown or filtered calls', () => {
    const rows = matchesByResearcher(calls, [...matches, match('T-UNKNOWN', 'a', 'strong', 1)], { today: TODAY, includePast: true });
    expect(rows.map((r) => [r.uid, r.matches.length])).toEqual([['a', 3], ['b', 1], ['c', 1], ['z', 1]]);
    expect(rows[0].matches.map((m) => m.call.callId)).toEqual(['T-CLOSED', 'AAPG-H12', 'T-OPEN']);
  });

  it('applies the uids, the programme and the deadline filters', () => {
    expect(matchesByResearcher(calls, matches, { today: TODAY, uids: new Set(['z']) }).map((r) => r.uid)).toEqual(['z']);
    const a = matchesByResearcher(calls, matches, { today: TODAY, uids: new Set(['a']), programmeIds: new Set(['horizon-europe']) });
    expect(a[0].matches.map((m) => m.call.callId)).toEqual(['T-OPEN']);
  });
});

describe('subsetsOf / programmesOfCategory', () => {
  const programmes: ProgrammeView[] = [
    { programmeId: 'horizon-europe', name: 'Horizon Europe', kind: 'thematic', subsetLabel: 'cluster', funderId: 'eu', funderName: 'UE', category: 'Europe', url: '' },
    { programmeId: 'anr-aapg', name: 'AAPG', kind: 'open', subsetLabel: 'axis', funderId: 'anr', funderName: 'ANR', category: 'ANR', url: '' },
  ];
  it('lists the subsets of the programmes kept, sorted', () => {
    expect(subsetsOf(calls)).toEqual(['CL9', 'H.12']);
    expect(subsetsOf(calls, new Set(['anr-aapg']))).toEqual(['H.12']);
    expect(subsetsOf(calls, new Set())).toEqual(['CL9', 'H.12']);
  });
  it('keeps the programmes of a category, all without category', () => {
    expect(programmesOfCategory(programmes, 'ANR').map((p) => p.programmeId)).toEqual(['anr-aapg']);
    expect(programmesOfCategory(programmes, '')).toHaveLength(2);
  });
});

describe('uidsOf', () => {
  it('ignores records without uid', () => {
    expect([...uidsOf([{ uid: 'a' }, {}, { uid: '' }, { uid: 'b' }])]).toEqual(['a', 'b']);
  });
});

describe('inPerimeter', () => {
  it('is true without a recorded perimeter', () => {
    expect(inPerimeter([], { slug: 'xyz', label: 'Any lab' })).toBe(true);
  });
  it('matches the slug or acronym regardless of case and accents', () => {
    expect(inPerimeter(['IMN'], { slug: 'imn', label: 'Institut des matériaux Jean Rouxel' })).toBe(true);
    expect(inPerimeter(['CRCI2NA'], { slug: 'crci²na', label: 'Centre de recherche' })).toBe(true);
  });
  it('matches a perimeter contained in the label', () => {
    expect(inPerimeter(['Nantes Université'], { slug: 'nu', label: 'Nantes Université — tout périmètre' })).toBe(true);
  });
  it('is false for another structure', () => {
    expect(inPerimeter(['IMN'], { slug: 'lppl', label: 'Laboratoire de psychologie' })).toBe(false);
  });
  it('is true for a structure inside an enclosing structure of the perimeter', () => {
    const lemna = { slug: 'lemna', label: "Laboratoire d'économie et de management de Nantes Atlantique" };
    expect(inPerimeter(['Nantes Université'], lemna, [{ slug: '', label: 'Nantes Université' }])).toBe(true);
    expect(inPerimeter(['Nantes Université'], lemna, [{ slug: '', label: 'Nantes Université — TEST' }])).toBe(true);
    expect(inPerimeter(['IMN'], { slug: 'st2e', label: 'ST2E' }, [{ slug: 'IMN', label: 'Institut des matériaux' }, { slug: '', label: 'Nantes Université' }])).toBe(true);
    expect(inPerimeter(['IMN'], lemna, [{ slug: '', label: 'Nantes Université' }])).toBe(false);
  });
  it('ignores the empty slug and label of an enclosing structure', () => {
    expect(inPerimeter(['IMN'], { slug: 'lppl', label: 'Laboratoire de psychologie' }, [{ slug: '', label: '' }])).toBe(false);
  });
});
