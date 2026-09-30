import { describe, expect, it } from 'vitest';
import {
  affiliationHistoryKey, timelineRows, yearRange, sortSignals, suggestedEndDate, suggestedStartDate, publicationsOf, yearOf,
  type AhEntry,
} from '../affiliationHistory';

// « Parcours » block helpers (lib/affiliationHistory.ts, docs/plan-parcours-affiliations.md lot 3). Fictitious data.
const entry = (): AhEntry => ({
  computedAt: '2026-09-30T10:00:00Z',
  ids: { uid: 'martin-p', orcid: '', openalex: [], scopus: [] },
  sources: { graph: 3, openalex: 2, scopus: null, orcid: 2, scopusProfile: true },
  incomplete: [],
  totals: { pubs: 4, withAffiliation: 4, undated: 0 },
  firstLocal: 2015, lastLocal: 2020,
  establishments: [
    { key: 'ror:0beta', name: 'Université Beta', country: 'FR', cls: 'other', byYear: { 2022: 2 }, first: 2022, last: 2022, count: 2, labs: [] },
    { key: 'ror:0alpha', name: 'Université Alpha', country: 'FR', cls: 'local', byYear: { 2015: 1, 2020: 1 }, first: 2015, last: 2020, count: 2, labs: [{ name: 'Laboratoire A', count: 2 }] },
    { key: 'name:cnrs', name: 'CNRS', country: 'FR', cls: 'neutral', byYear: { 2020: 1 }, first: 2020, last: 2020, count: 1, labs: [] },
  ],
  orcid: [
    { kind: 'employment', name: 'Université Alpha', lab: '', cls: 'local', country: 'FR', start: '2014-09', end: '2021-08', role: 'MCF', dept: '' },
    { kind: 'employment', name: 'Université Gamma', lab: '', cls: 'other', country: 'FR', start: '2021-09', end: '', role: 'PR', dept: '' },
  ],
  scopusProfile: { current: [{ name: 'Université Beta', cls: 'other' }], history: [{ name: 'Université Alpha', cls: 'local' }], range: { start: 2015, end: 2022 } },
  signals: [
    { type: 'arrivee', strength: 'suggestion', date: '2014-09', source: 'orcid' },
    { type: 'depart_observe', strength: 'medium', date: '2020', count: 2 },
    { type: 'depart_confirme', strength: 'very_strong', date: '2021-08', sources: ['orcid', 'publications'] },
  ],
  pubs: [
    { y: 2015, t: 'a', s: ['graph'], c: ['local'], e: [1] },
    { y: 2022, t: 'b', s: ['openalex'], c: ['other'], e: [0] },
    { y: 2020, t: 'c', s: ['graph'], c: ['local'], e: [1, 2] },
  ],
});

describe('affiliationHistory helpers', () => {
  it('record key: uid, else g<rowId>', () => {
    expect(affiliationHistoryKey({ uid: 'martin-p', gristRowId: 3 })).toBe('martin-p');
    expect(affiliationHistoryKey({ gristRowId: 3 })).toBe('g3');
    expect(affiliationHistoryKey({})).toBeNull();
  });
  it('rows: local first, ORCID-only establishments added, periods and Scopus attached by name', () => {
    const rows = timelineRows(entry());
    expect(rows.map((r) => r.name)).toEqual(['Université Alpha', 'Université Gamma', 'Université Beta', 'CNRS']);
    expect(rows[0].periods).toHaveLength(1);
    expect(rows[0].inScopus).toBe('history');
    expect(rows[1].estIndex).toBeNull();
    expect(rows[2].inScopus).toBe('current');
    expect(timelineRows(entry(), 2)).toHaveLength(2);
  });
  it('rows with the same name are merged (two keys for one establishment)', () => {
    const e = entry();
    e.establishments.push({ key: 'name:universitealpha', name: 'Université Alpha', country: 'FR', cls: 'local', byYear: { 2016: 1 }, first: 2016, last: 2016, count: 1, labs: [] });
    const alpha = timelineRows(e).filter((r) => r.name === 'Université Alpha');
    expect(alpha).toHaveLength(1);
    expect(alpha[0]).toMatchObject({ count: 3, first: 2015, last: 2020, byYear: { 2015: 1, 2016: 1, 2020: 1 }, mergedIndexes: [1, 3] });
  });
  it('year range covers publications, ORCID and Druid employment, at least 5 years, capped at now', () => {
    expect(yearRange(timelineRows(entry()), { start: '2012' }, 2026)).toEqual([2012, 2022]);
    expect(yearRange([], {}, 2026)).toEqual([2022, 2026]);
  });
  it('signals: confirmed first, arrival last; suggestions only when the record has no date', () => {
    expect(sortSignals(entry().signals).map((s) => s.type)).toEqual(['depart_confirme', 'depart_observe', 'arrivee']);
    expect(suggestedEndDate(entry().signals)).toBe('2021-08');
    expect(suggestedEndDate(entry().signals, '2021')).toBeNull();
    expect(suggestedStartDate(entry().signals)).toBe('2014-09');
    expect(suggestedStartDate(entry().signals, '2014')).toBeNull();
  });
  it('publications of an establishment, most recent first', () => {
    expect(publicationsOf(entry(), 1).map((p) => p.t)).toEqual(['c', 'a']);
    expect(yearOf('2021-08')).toBe(2021);
    expect(yearOf('')).toBeNull();
  });
});
