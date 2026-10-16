import { describe, expect, it } from 'vitest';
import { PORTAL_PROGRAMMES_BUILT_IN } from '../calls/programmes';
import { TOPICS_FILE_FORMAT, hasMatchingText, subsetsOf, topicsFileName, topicsFileOf, type CallForMatching } from '../calls/trmExport';

const eic = PORTAL_PROGRAMMES_BUILT_IN.find((p) => p.programmeId === 'eic')!;

const call = (over: Partial<CallForMatching>): CallForMatching => ({
  callId: 'HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01',
  subset: 'PATHFINDER',
  title: 'Challenge one',
  objectives: '',
  scope: 'Scope of the challenge.',
  taxonomy: { call: 'HORIZON-EIC-2026-PATHFINDERCHALLENGES-01', callTitle: 'EIC Pathfinder Challenges 2026', typeOfAction: 'HORIZON-EIC', division: 'HORIZON.3.1' },
  openingDate: '2026-05-06',
  deadlines: ['2026-10-28'],
  status: 'open',
  ...over,
});

describe('topicsFileOf', () => {
  it('writes the calls in the topic format of crisalid-agents', () => {
    const file = topicsFileOf(eic, [call({})], { subset: 'PATHFINDER', exportedAt: '2026-10-16T00:00:00Z' });
    expect(file).toMatchObject({ format: TOPICS_FILE_FORMAT, programme: 'eic', programme_label: eic.name, subset: 'PATHFINDER', exported_at: '2026-10-16T00:00:00Z' });
    expect(file.topics).toEqual([{
      topic_id: 'HORIZON-EIC-2026-PATHFINDERCHALLENGES-01-01',
      title: 'Challenge one',
      cluster: 'PATHFINDER',
      call_id: 'HORIZON-EIC-2026-PATHFINDERCHALLENGES-01',
      call_name: 'EIC Pathfinder Challenges 2026',
      destination: 'HORIZON.3.1',
      type_of_action: 'HORIZON-EIC',
      opening_date: '2026-05-06',
      deadlines: ['2026-10-28'],
      expected_outcome: '',
      scope: 'Scope of the challenge.',
    }]);
  });

  it('keeps the subset asked for and leaves out the calls without text', () => {
    const calls = [
      call({ callId: 'B', subset: 'PATHFINDER' }),
      call({ callId: 'A', subset: 'PATHFINDER', objectives: 'Outcome.', scope: '' }),
      call({ callId: 'C', subset: 'PATHFINDER', objectives: ' ', scope: '' }),
      call({ callId: 'D', subset: 'ACCELERATOR' }),
    ];
    expect(topicsFileOf(eic, calls, { subset: 'PATHFINDER' }).topics.map((t) => t.topic_id)).toEqual(['A', 'B']);
    expect(topicsFileOf(eic, calls).topics.map((t) => t.topic_id)).toEqual(['A', 'B', 'D']);
  });

  it('labels the run with the programme when the calls have no subset', () => {
    const file = topicsFileOf(eic, [call({ subset: '', taxonomy: {} })], { subset: '' });
    expect(file.subset).toBe('eic');
    expect(file.topics[0]).toMatchObject({ cluster: 'eic', call_id: null, call_name: null, destination: null, type_of_action: null });
  });
});

describe('helpers', () => {
  it('tells the calls the batch can read', () => {
    expect(hasMatchingText({ objectives: '', scope: 'x' })).toBe(true);
    expect(hasMatchingText({ objectives: '  ', scope: '' })).toBe(false);
  });

  it('lists the subsets of the calls with a text', () => {
    expect(subsetsOf([call({ subset: 'B' }), call({ subset: 'A' }), call({ subset: 'A' }), call({ subset: 'C', scope: '' })])).toEqual(['A', 'B']);
  });

  it('names the files', () => {
    expect(topicsFileName('eic', 'PATHFINDER')).toBe('calls-eic-pathfinder.json');
    expect(topicsFileName('horizon-missions', 'OCEAN/WATER')).toBe('calls-horizon-missions-ocean-water.json');
    expect(topicsFileName('erc', '')).toBe('calls-erc.json');
  });
});
