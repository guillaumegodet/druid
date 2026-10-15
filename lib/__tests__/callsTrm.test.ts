import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { directoryUidOf, parseTrmReport } from '../calls/trm';

const sample = () => readFileSync(join(__dirname, 'fixtures/trm-sample.json'), 'utf8');

describe('parseTrmReport', () => {
  it('reads the run, its topics and its matches', () => {
    const run = parseTrmReport(sample());
    expect(run.runId).toBe('20261014T000000-test01');
    expect(run.programmeId).toBe('horizon-europe');
    expect(run.subset).toBe('CL9');
    expect(run.model).toBe('test-model');
    expect(run.topics.map((t) => t.topicId)).toEqual(['HORIZON-CL9-2026-01-TEST-01', 'HORIZON-CL9-2027-02-TEST-02']);
    expect(run.matches).toHaveLength(2);
  });

  it('keeps a topic in error out of the topics and drops its matches', () => {
    const run = parseTrmReport(sample());
    expect(run.failedTopics).toEqual([{ topicId: 'HORIZON-CL9-2026-03-TEST-03', error: 'EmbeddingServiceError: Embedding service timed out' }]);
    expect(run.matches.some((m) => m.topicId === 'HORIZON-CL9-2026-03-TEST-03')).toBe(false);
  });

  it('normalises whitespace, maps the graph uid to the directory uid and tolerates missing values', () => {
    const run = parseTrmReport(sample());
    const [topic, twoStage] = run.topics;
    expect(topic.title).toBe('Producing battery-grade materia ls for electrodes');
    expect(topic.deadlines).toEqual(['2026-09-15']);
    expect(twoStage.deadlines).toEqual(['2027-03-31', '2027-10-07']);
    expect(twoStage.summary).toBe('');
    const [alice, bob] = run.matches;
    expect(alice.uid).toBe('exemple-a');
    expect(alice.personUid).toBe('local-exemple-a');
    expect(alice.publications).toHaveLength(2);
    expect(alice.publications[0]).toMatchObject({ uid: 'doc-1', year: 2022, relevant: true });
    expect(bob.overall).toBe('none');
    expect(bob.units).toEqual([]);
    expect(bob.justification).toBe('');
  });

  it('binds the report to the programme given', () => {
    expect(parseTrmReport(sample(), 'horizon-europe-2028').programmeId).toBe('horizon-europe-2028');
    expect(parseTrmReport(sample()).topics[0].subset).toBe('CL9');
  });

  it('refuses a document that is not a report', () => {
    expect(() => parseTrmReport('{"topics": []}')).toThrow(/run_id and cluster/);
  });

  it('keeps a uid of another scheme as is', () => {
    expect(directoryUidOf('local-dupont-j')).toBe('dupont-j');
    expect(directoryUidOf('orcid-0000-0001-2345-6780')).toBe('orcid-0000-0001-2345-6780');
  });
});
