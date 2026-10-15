import { describe, expect, it } from 'vitest';
import { fetchPortalTopics, parsePortalTopic } from '../calls/portal';

describe('parsePortalTopic', () => {
  it('reads the title, the call and the deadlines of the portal answer', () => {
    const topic = parsePortalTopic('HORIZON-CL9-2026-01-TEST-01', { TopicDetails: { title: ' Next  generation of renewable energy technologies ', callTitle: 'ENERGY', deadlineDates: ['1774915200000', '1792454400000'] } });
    expect(topic).toMatchObject({ topicId: 'HORIZON-CL9-2026-01-TEST-01', title: 'Next generation of renewable energy technologies', callTitle: 'ENERGY', deadlines: ['2026-03-31', '2026-10-20'], objectives: '', scope: '', budget: {} });
    expect(parsePortalTopic('X', { TopicDetails: {} })).toBeNull();
    expect(parsePortalTopic('X', 'nope')).toBeNull();
  });
});

describe('parsePortalTopic (text and budget)', () => {
  it('splits the description into objectives and scope and reads the budget of the first action', () => {
    const topic = parsePortalTopic('HORIZON-CL9-2026-01-TEST-01', { TopicDetails: {
      title: 'T', callIdentifier: 'HORIZON-CL9-2026-01',
      description: '<p class="topicdescriptionkind">Expected Outcome:</p><p>Better &amp; cheaper cells.</p><ul><li>one</li><li>two</li></ul><p class="topicdescriptionkind">Scope:</p><p>Proposals should&nbsp;address storage.</p>',
      conditions: '<h4>General conditions</h4><p>Annex A</p>',
      actions: [{ status: { abbreviation: 'Forthcoming' }, plannedOpeningDate: '1787616000000', deadlineDates: ['1795651200000'] }],
      topicActions: [{ abbreviation: 'HORIZON-RIA' }], keywords: ['Batteries'],
      budgetOverviewJSONItem: { budgetTopicActionMap: { '1': [{ budgetYearMap: { '2026': '23000000' }, expectedGrants: 2, minContribution: 3000000, maxContribution: 5000000 }] } },
    } });
    expect(topic).toMatchObject({
      callIdentifier: 'HORIZON-CL9-2026-01', status: 'forthcoming', openingDate: '2026-08-25', deadlines: ['2026-11-26'],
      objectives: 'Better & cheaper cells.\n- one\n- two', scope: 'Proposals should address storage.', conditions: 'General conditions\nAnnex A',
      typesOfAction: ['HORIZON-RIA'], keywords: ['Batteries'],
      budget: { minContribution: 3000000, maxContribution: 5000000, expectedGrants: 2, byYear: { '2026': 23000000 } },
    });
  });
});

describe('fetchPortalTopics', () => {
  it('lowercases the id in the URL, skips unknown topics and HTTP errors', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.endsWith('horizon-cl9-2026-01-test-02.json')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ TopicDetails: { title: `Title of ${url.split('/').pop()}`, deadlineDates: [] } }) };
    };
    const out = await fetchPortalTopics(['HORIZON-CL9-2026-01-TEST-01', 'HORIZON-CL9-2026-01-TEST-02', 'HORIZON-CL9-2026-01-TEST-01'], fetchImpl, 2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe('https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/horizon-cl9-2026-01-test-01.json');
    expect([...out.keys()]).toEqual(['HORIZON-CL9-2026-01-TEST-01']);
    expect(out.get('HORIZON-CL9-2026-01-TEST-01')?.title).toBe('Title of horizon-cl9-2026-01-test-01.json');
  });
});
