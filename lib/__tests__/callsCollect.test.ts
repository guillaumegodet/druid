import { describe, expect, it } from 'vitest';
import { collectFromPortal, collectedCallOf, contentHashOf, listingChanged, undatedIdentifier, undatedTwins, type CollectedCall, type CollectorStore, type StoredCallSummary } from '../calls/collect';
import type { PortalTopic } from '../calls/portal';
import { PORTAL_PROGRAMMES_BUILT_IN } from '../calls/programmes';

const listing = (objects: Record<string, unknown>[]) => JSON.stringify({ fundingData: { GrantTenderObj: objects } });
const topic = (identifier: string, status = 'Open', deadline = 1795651200000, extra: Record<string, unknown> = {}) => ({
  type: 1, identifier, title: `Title ${identifier}`, callIdentifier: 'CALL', callTitle: 'Call', frameworkProgramme: { abbreviation: 'HORIZON' },
  programmeDivision: [{ abbreviation: 'HORIZON.2' }], status: { abbreviation: status }, deadlineDatesLong: [deadline], plannedOpeningDateLong: 1787616000000,
  keywords: [], topicActions: [{ abbreviation: 'HORIZON-RIA' }], ...extra,
});
async function* chunks(text: string, size = 33) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }

const details = (id: string): PortalTopic => ({
  topicId: id, title: `Official ${id}`, callTitle: 'Call', callIdentifier: 'CALL', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'open',
  objectives: `Outcome of ${id}`, scope: 'Scope', conditions: '', keywords: ['K'], typesOfAction: ['HORIZON-RIA'], budget: { minContribution: 1 },
});

class MemoryStore implements CollectorStore {
  calls = new Map<string, CollectedCall>();
  dates: { callId: string; status: string }[] = [];
  /** Calls a run matched: never deleted. */
  matched = new Set<string>();
  constructor(stored: Omit<StoredCallSummary, 'hasText'>[] = []) {
    for (const s of stored) this.calls.set(s.callId, { ...collectedCallOf({ identifier: s.callId, title: s.title, callIdentifier: '', callTitle: '', framework: 'HORIZON', divisions: [], status: s.status, deadlines: s.deadlines, openingDate: s.openingDate, keywords: [], typesOfAction: [] }, { programmeId: s.programmeId, subset: '', scheme: '' }, null), objectives: 'stored text' });
  }
  async storedCalls(programmeIds: string[]) {
    return [...this.calls.values()].filter((c) => programmeIds.includes(c.programmeId)).map((c) => ({ callId: c.callId, programmeId: c.programmeId, title: c.title, deadlines: c.deadlines, openingDate: c.openingDate, status: c.status, hasText: c.objectives !== '' || c.scope !== '' }));
  }
  async upsertCall(call: CollectedCall) {
    const existed = this.calls.has(call.callId);
    this.calls.set(call.callId, call);
    return existed ? 'updated' as const : 'new' as const;
  }
  async updateCallDates(callId: string, status: CollectedCall['status'], deadlines: string[], openingDate: string | null) {
    this.dates.push({ callId, status });
    const c = this.calls.get(callId);
    if (c) this.calls.set(callId, { ...c, status, deadlines, openingDate });
  }
  async removeCalls(callIds: string[]) {
    const removable = callIds.filter((id) => this.calls.has(id) && !this.matched.has(id));
    for (const id of removable) this.calls.delete(id);
    return removable.length;
  }
}

const programmes = PORTAL_PROGRAMMES_BUILT_IN.filter((p) => ['horizon-europe', 'erc'].includes(p.programmeId));

describe('collectFromPortal', () => {
  it('imports the open topics of the active programmes with their text, skips the others', async () => {
    const store = new MemoryStore();
    const fetched: string[] = [];
    const stats = await collectFromPortal({
      programmes, today: '2026-10-15', store,
      listing: chunks(listing([
        topic('HORIZON-CL4-2026-01-A'), topic('ERC-2027-COG'), topic('HORIZON-CL5-2025-01-OLD', 'Closed', 1700000000000),
        topic('HORIZON-MSCA-2026-PF-01-01'), topic('LIFE-2026-X', 'Open', 1795651200000, { frameworkProgramme: { abbreviation: 'LIFE2027' } }), { type: 2, identifier: 'TENDER' },
      ])),
      fetchDetails: async (id) => { fetched.push(id); return id === 'ERC-2027-COG' ? null : details(id); },
    });
    expect(stats).toMatchObject({ seen: 3, new: 2, updated: 0, unchanged: 0, skippedClosed: 1, detailsFetched: 2, errors: [] });
    expect(fetched.sort()).toEqual(['ERC-2027-COG', 'HORIZON-CL4-2026-01-A']);
    const a = store.calls.get('HORIZON-CL4-2026-01-A')!;
    expect(a).toMatchObject({ programmeId: 'horizon-europe', subset: 'CL4', title: 'Official HORIZON-CL4-2026-01-A', objectives: 'Outcome of HORIZON-CL4-2026-01-A', scope: 'Scope', status: 'open', deadlines: ['2026-11-26'], openingDate: '2026-08-25', lang: 'en' });
    expect(a.taxonomy).toEqual({ call: 'CALL', callTitle: 'Call', typeOfAction: 'HORIZON-RIA', division: 'HORIZON.2', keywords: 'K' });
    expect(a.url).toBe('https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/horizon-cl4-2026-01-a');
    expect(a.contentHash).toBe(contentHashOf('Outcome of HORIZON-CL4-2026-01-A', 'Scope'));
    // No text on the portal: the listing alone is stored.
    expect(store.calls.get('ERC-2027-COG')).toMatchObject({ programmeId: 'erc', subset: 'CoG', scheme: 'ERC-CoG', title: 'Title ERC-2027-COG', objectives: '' });
  });

  it('leaves unchanged topics alone, refreshes changed ones, closes those gone from the listing', async () => {
    const store = new MemoryStore([
      { callId: 'HORIZON-CL4-2026-01-A', programmeId: 'horizon-europe', title: 'Title HORIZON-CL4-2026-01-A', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'open' },
      { callId: 'HORIZON-CL4-2026-01-B', programmeId: 'horizon-europe', title: 'Old title', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'open' },
      { callId: 'HORIZON-CL4-2025-01-GONE', programmeId: 'horizon-europe', title: 'Gone', deadlines: ['2026-01-10'], openingDate: null, status: 'open' },
    ]);
    const fetched: string[] = [];
    const stats = await collectFromPortal({
      programmes, today: '2026-10-15', store,
      listing: chunks(listing([topic('HORIZON-CL4-2026-01-A'), topic('HORIZON-CL4-2026-01-B')])),
      fetchDetails: async (id) => { fetched.push(id); return details(id); },
    });
    expect(fetched).toEqual(['HORIZON-CL4-2026-01-B']);
    expect(stats).toMatchObject({ seen: 2, new: 0, updated: 2, unchanged: 1, detailsFetched: 1 });
    expect(store.dates).toEqual([{ callId: 'HORIZON-CL4-2025-01-GONE', status: 'closed' }]);
  });

  it('respects the details limit: changed topics beyond it get their dates only, new ones wait', async () => {
    const store = new MemoryStore([
      { callId: 'HORIZON-CL4-2026-01-B', programmeId: 'horizon-europe', title: 'Old title', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'open' },
    ]);
    const stats = await collectFromPortal({
      programmes, today: '2026-10-15', store, detailsLimit: 1,
      listing: chunks(listing([topic('HORIZON-CL4-2026-01-A'), topic('HORIZON-CL4-2026-01-B')])),
      fetchDetails: async (id) => details(id),
    });
    expect(stats).toMatchObject({ new: 1, updated: 1, detailsFetched: 1 });
    expect(store.dates).toEqual([{ callId: 'HORIZON-CL4-2026-01-B', status: 'open' }]);
    expect(store.calls.get('HORIZON-CL4-2026-01-B')?.title).toBe('Old title');
  });

  it('reads again a stored call that has no text yet', async () => {
    const store = new MemoryStore([{ callId: 'HORIZON-CL4-2026-01-A', programmeId: 'horizon-europe', title: 'Title HORIZON-CL4-2026-01-A', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'open' }]);
    store.calls.set('HORIZON-CL4-2026-01-A', { ...store.calls.get('HORIZON-CL4-2026-01-A')!, objectives: '', scope: '' });
    const stats = await collectFromPortal({ programmes, today: '2026-10-15', store, listing: chunks(listing([topic('HORIZON-CL4-2026-01-A')])), fetchDetails: async (id) => details(id) });
    expect(stats).toMatchObject({ updated: 1, detailsFetched: 1, unchanged: 0 });
    expect(store.calls.get('HORIZON-CL4-2026-01-A')?.objectives).toBe('Outcome of HORIZON-CL4-2026-01-A');
  });

  it('counts a call with a scope only (ERC, EIC) as having its text', async () => {
    const store = new MemoryStore([{ callId: 'ERC-2027-COG', programmeId: 'erc', title: 'Title ERC-2027-COG', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'open' }]);
    store.calls.set('ERC-2027-COG', { ...store.calls.get('ERC-2027-COG')!, objectives: '', scope: 'Consolidator grants support…' });
    const stats = await collectFromPortal({ programmes, today: '2026-10-15', store, listing: chunks(listing([topic('ERC-2027-COG')])), fetchDetails: async (id) => details(id) });
    expect(stats).toMatchObject({ unchanged: 1, detailsFetched: 0 });
  });

  it('counts an error of a topic without stopping the run', async () => {
    const store = new MemoryStore();
    const stats = await collectFromPortal({
      programmes, today: '2026-10-15', store,
      listing: chunks(listing([topic('HORIZON-CL4-2026-01-A'), topic('HORIZON-CL4-2026-01-B')])),
      fetchDetails: async (id) => { if (id.endsWith('A')) throw new Error('boom'); return details(id); },
    });
    expect(stats.new).toBe(1);
    expect(stats.errors).toEqual(['HORIZON-CL4-2026-01-A: boom']);
  });

  it('leaves out the undated copy of a dated topic and deletes the copy stored by an earlier run', async () => {
    const eic = PORTAL_PROGRAMMES_BUILT_IN.filter((p) => p.programmeId === 'eic');
    const store = new MemoryStore([
      { callId: 'HORIZON-EIC-PATHFINDERCHALLENGES-01-01', programmeId: 'eic', title: 'Title HORIZON-EIC-PATHFINDERCHALLENGES-01-01', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'forthcoming' },
      { callId: 'HORIZON-EIC-PATHFINDERCHALLENGES-01-02', programmeId: 'eic', title: 'Title HORIZON-EIC-PATHFINDERCHALLENGES-01-02', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'forthcoming' },
    ]);
    store.matched.add('HORIZON-EIC-PATHFINDERCHALLENGES-01-02');
    const fetched: string[] = [];
    const stats = await collectFromPortal({
      programmes: eic, today: '2026-10-15', store,
      listing: chunks(listing([
        topic('HORIZON-EIC-PATHFINDERCHALLENGES-01-01', 'Forthcoming'), topic('HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01'),
        topic('HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-02'), topic('HORIZON-EIC-PATHFINDERCHALLENGES-01-02', 'Forthcoming'),
        topic('HORIZON-EIC-PATHFINDERCHALLENGES-01-04', 'Forthcoming'),
      ])),
      fetchDetails: async (id) => { fetched.push(id); return details(id); },
    });
    expect(stats).toMatchObject({ seen: 3, new: 3, skippedTwins: 2, removedTwins: 1, errors: [] });
    expect(fetched.sort()).toEqual(['HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01', 'HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-02', 'HORIZON-EIC-PATHFINDERCHALLENGES-01-04']);
    expect([...store.calls.keys()].sort()).toEqual([
      'HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01', 'HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-02',
      // Matched by a run: kept, and left alone (neither refreshed nor closed).
      'HORIZON-EIC-PATHFINDERCHALLENGES-01-02', 'HORIZON-EIC-PATHFINDERCHALLENGES-01-04',
    ]);
    expect(store.dates).toEqual([]);
    expect(store.calls.get('HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01')).toMatchObject({ subset: 'Pathfinder' });
  });

  it('does nothing without an active programme', async () => {
    const store = new MemoryStore();
    const stats = await collectFromPortal({ programmes: [], today: '2026-10-15', store, listing: chunks(listing([topic('ERC-2027-COG')])), fetchDetails: async () => null });
    expect(stats.seen).toBe(0);
  });
});

describe('undatedTwins', () => {
  it('finds the identifiers that are a dated one without its year', () => {
    expect(undatedIdentifier('HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01')).toBe('HORIZON-EIC-PATHFINDERCHALLENGES-01-01');
    expect(undatedIdentifier('ERC-2027-COG')).toBe('ERC-COG');
    expect(undatedIdentifier('HORIZON-EIC-PATHFINDERCHALLENGES-01-01')).toBe('HORIZON-EIC-PATHFINDERCHALLENGES-01-01');
    expect([...undatedTwins(['HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01', 'HORIZON-EIC-PATHFINDERCHALLENGES-01-01', 'HORIZON-EIC-PATHFINDERCHALLENGES-01-04', 'ERC-2027-COG'])])
      .toEqual(['HORIZON-EIC-PATHFINDERCHALLENGES-01-01']);
  });
});

describe('listingChanged', () => {
  const stored: StoredCallSummary = { callId: 'A', programmeId: 'erc', title: 'T', deadlines: ['2026-11-26'], openingDate: '2026-08-25', status: 'open', hasText: true };
  const t = { identifier: 'A', title: 'T', callIdentifier: '', callTitle: '', framework: 'HORIZON', divisions: [], status: 'open' as const, deadlines: ['2026-11-26'], openingDate: '2026-08-25', keywords: [], typesOfAction: [] };
  it('is false when title, dates and status are the same', () => {
    expect(listingChanged(stored, t)).toBe(false);
    expect(listingChanged(stored, { ...t, status: 'closed' })).toBe(true);
    expect(listingChanged(stored, { ...t, deadlines: ['2026-12-01'] })).toBe(true);
    expect(listingChanged({ ...stored, openingDate: null }, t)).toBe(true);
  });
});
