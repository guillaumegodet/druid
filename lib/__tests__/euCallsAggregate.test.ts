import { describe, expect, it } from 'vitest';
import { matchesByResearcher, nextDeadlineOf, topicsWithMatches, uidsOf, type EuMatch, type EuTopic } from '../euCalls/aggregate';

const topic = (topicId: string, deadlines: string[], title = topicId): EuTopic =>
  ({ topicId, cluster: 'CL9', title, callId: '', destination: '', deadlines, summary: '' });
const match = (topicId: string, uid: string, overall: EuMatch['overall'], score: number): EuMatch =>
  ({ pairId: `${topicId}|local-${uid}`, topicId, uid, personName: uid.toUpperCase(), units: [], score, overall, justification: '', publications: [], feedback: {}, mine: null });

const topics = [topic('T-OPEN', ['2027-03-31']), topic('T-CLOSED', ['2026-01-10']), topic('T-TWO', ['2026-01-10', '2026-12-01']), topic('T-NONE', [])];
const matches = [
  match('T-OPEN', 'a', 'plausible', 0.6), match('T-OPEN', 'b', 'strong', 0.5), match('T-OPEN', 'c', 'strong', 0.9),
  match('T-CLOSED', 'a', 'strong', 1), match('T-TWO', 'z', 'weak', 0.4),
];
const TODAY = '2026-10-14';

describe('nextDeadlineOf', () => {
  it('gives the first deadline not yet passed, null when all have passed', () => {
    expect(nextDeadlineOf(['2026-01-10', '2026-12-01'], TODAY)).toBe('2026-12-01');
    expect(nextDeadlineOf(['2026-01-10'], TODAY)).toBeNull();
    expect(nextDeadlineOf([], TODAY)).toBeNull();
  });
});

describe('topicsWithMatches', () => {
  it('hides closed topics by default, sorts by next deadline then by matches, strongest match first', () => {
    const rows = topicsWithMatches(topics, matches, { today: TODAY });
    expect(rows.map((r) => r.topicId)).toEqual(['T-TWO', 'T-OPEN', 'T-NONE']);
    expect(rows[1].matches.map((m) => m.uid)).toEqual(['c', 'b', 'a']);
  });

  it('keeps closed topics with includePast and narrows to the given uids', () => {
    const rows = topicsWithMatches(topics, matches, { today: TODAY, includePast: true, uids: new Set(['a']) });
    // Topics without a next deadline come last, the closed one before the one without any deadline (more matches).
    expect(rows.map((r) => [r.topicId, r.matches.length])).toEqual([['T-TWO', 0], ['T-OPEN', 1], ['T-CLOSED', 1], ['T-NONE', 0]]);
  });
});

describe('matchesByResearcher', () => {
  it('groups by researcher, most matches first, and drops unknown topics', () => {
    const rows = matchesByResearcher(topics, [...matches, match('T-UNKNOWN', 'a', 'strong', 1)]);
    expect(rows.map((r) => [r.uid, r.matches.length])).toEqual([['a', 2], ['b', 1], ['c', 1], ['z', 1]]);
    expect(rows[0].matches.map((m) => m.topic.topicId)).toEqual(['T-CLOSED', 'T-OPEN']);
  });

  it('narrows to the given uids', () => {
    expect(matchesByResearcher(topics, matches, new Set(['z'])).map((r) => r.uid)).toEqual(['z']);
  });
});

describe('uidsOf', () => {
  it('ignores records without uid', () => {
    expect([...uidsOf([{ uid: 'a' }, {}, { uid: '' }, { uid: 'b' }])]).toEqual(['a', 'b']);
  });
});
