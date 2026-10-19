import { describe, expect, it } from 'vitest';
import {
  PASSAGE_CHARS, WEAK_SIMILARITY, buildProjectSystemPrompt, chunkText, embeddingInput, parseQueries, passagesOf, projectTextOf, rankCalls,
  type ProjectHit, type SearchablePassage,
} from '../calls/projectSearch';
import { embedderFromEnv } from '../calls/embeddings';
import { embedOpenCalls, textHash, writeQueries } from '../calls/projectChat';
import type { CallPassageStore, StoredPassage } from '../calls/passageStore';

const unit = (...v: number[]) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const passage = (callId: string, vector: number[], section: SearchablePassage['section'] = 'scope', text = `${callId} text`): SearchablePassage =>
  ({ callId, section, text, vector });

describe('chunkText / passagesOf', () => {
  it('packs short paragraphs and cuts a long one at its sentences', () => {
    expect(chunkText('First paragraph.\n\nSecond one.\nThird.')).toEqual(['First paragraph.\nSecond one.\nThird.']);
    const sentence = 'This sentence has exactly fifty characters in it. ';
    const long = sentence.repeat(60).trim();
    const pieces = chunkText(long);
    expect(pieces.every((p) => p.length <= PASSAGE_CHARS)).toBe(true);
    expect(pieces.every((p) => p.endsWith('.'))).toBe(true);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });
  it('keeps the summary first (even empty), then objectives and scope', () => {
    const ps = passagesOf({ callId: 'C1', title: 'T', summary: '', objectives: 'Obj.', scope: 'Scope A.\n\nScope B.' });
    expect(ps.map((p) => [p.idx, p.section])).toEqual([[0, 'summary'], [1, 'objectives'], [2, 'scope']]);
    expect(embeddingInput('Title', ps[0])).toBe('Title');
    expect(embeddingInput('Title', ps[1])).toBe('Title\n\nObj.');
  });
});

describe('rankCalls', () => {
  const passages = [
    passage('A', unit(1, 0, 0), 'summary', 'A summary'), passage('A', unit(0.9, 0.1, 0), 'scope', 'A scope'),
    passage('B', unit(0, 1, 0)), passage('C', unit(0.7, 0.7, 0)), passage('D', unit(0, 0, 1)),
  ];
  it('fuses the ranks of several queries, best passage of each call kept', () => {
    const ranked = rankCalls([unit(1, 0, 0), unit(0.6, 0.8, 0)], passages, { limit: 3 });
    expect(ranked.map((r) => r.callId)).toEqual(['C', 'A', 'B']);
    expect(ranked.find((r) => r.callId === 'A')).toMatchObject({ queries: 2, best: { section: 'summary', text: 'A summary' } });
    expect(ranked[0].similarity).toBeCloseTo(0.99, 2);
  });
  it('keeps only the best calls of each query', () => {
    expect(rankCalls([unit(0, 0, 1)], passages, { perQuery: 1 }).map((r) => r.callId)).toEqual(['D']);
    expect(rankCalls([], passages)).toEqual([]);
  });
});

describe('parseQueries / projectTextOf', () => {
  it('reads the queries, deduplicated and capped at six', () => {
    expect(parseQueries('```json\n{"queries": ["sodium ion batteries", "Sodium ion batteries", "x", "grid storage"]}\n```'))
      .toEqual(['sodium ion batteries', 'grid storage']);
    expect(parseQueries(JSON.stringify(['a b c', 'd e f', 'g h i', 'j k l', 'm n o', 'p q r', 's t u']))).toHaveLength(6);
    expect(parseQueries('not json')).toEqual([]);
  });
  it('takes the last user turns', () => {
    const messages = [{ role: 'user', content: 'P1' }, { role: 'assistant', content: 'A' }, { role: 'user', content: 'P2' }, { role: 'user', content: 'P3' }];
    expect(projectTextOf(messages)).toBe('P2\n\nP3');
  });
});

describe('buildProjectSystemPrompt', () => {
  const hit = (callId: string, similarity: number, deadlines: string[]): ProjectHit => ({
    callId, score: 1, similarity, queries: 1, best: { section: 'scope', text: 'Closest passage.' },
    title: `Title ${callId}`, titleFr: '', programme: 'Cluster 5', funder: 'European Commission', scheme: 'RIA', summary: 'Short summary.',
    deadlines, status: 'open', url: `https://example.org/${callId}`,
  });
  it('lists the calls with their next deadline, page and passage, marking the weak ones', () => {
    const prompt = buildProjectSystemPrompt([hit('C1', 0.7, ['2026-01-10', '2027-02-01']), hit('C2', WEAK_SIMILARITY - 0.1, [])], '2026-10-17');
    expect(prompt).toContain('1. Title C1 [C1]\n');
    expect(prompt).toContain('next deadline: 2027-02-01');
    expect(prompt).toContain('Page: https://example.org/C1');
    expect(prompt).toContain('Scope (closest passage): Closest passage.');
    expect(prompt).toContain('2. Title C2 [C2] (weak)');
    expect(prompt).toContain('next deadline: not stated');
  });
  it('says when nothing was found', () => {
    expect(buildProjectSystemPrompt([], '2026-10-17')).toContain('(none: no open call is close to this project)');
  });
});

describe('embedderFromEnv / writeQueries', () => {
  it('is off without a service, batches the texts and keeps their order', async () => {
    expect(embedderFromEnv({})).toBeNull();
    const calls: { url: string; input: string[]; auth?: string }[] = [];
    const fake = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      const { input } = JSON.parse(init.body) as { input: string[] };
      calls.push({ url, input, auth: init.headers.Authorization });
      // Answered out of order: the client sorts by index.
      return { ok: true, status: 200, json: async () => ({ data: input.map((t, index) => ({ index, embedding: [t.length] })).reverse() }) };
    };
    const embedder = embedderFromEnv({ EMBEDDING_API_URL: 'https://rag.example/', EMBEDDING_API_MODEL: 'bge-m3', EMBEDDING_API_KEY: 'k' }, fake)!;
    const texts = Array.from({ length: 40 }, (_, i) => 'x'.repeat(i + 1));
    const vectors = await embedder.embed(texts);
    expect(vectors.map((v) => v[0])).toEqual(texts.map((t) => t.length));
    expect(calls.map((c) => c.input.length)).toEqual([32, 8]);
    expect(calls[0]).toMatchObject({ url: 'https://rag.example/v1/embeddings', auth: 'Bearer k' });
  });
  it('returns no query when the model fails', async () => {
    const llm = { apiBase: 'https://llm.example/v1', apiKey: 'k', model: 'm' };
    const ok = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"queries": ["grid storage of energy"]}' } }] }) });
    expect(await writeQueries('project', llm, ok)).toEqual(['grid storage of energy']);
    expect(await writeQueries('project', llm, async () => ({ ok: false, status: 503, json: async () => ({}) }))).toEqual([]);
    expect(await writeQueries('project', llm, async () => { throw new Error('down'); })).toEqual([]);
    // A dropped request is tried again.
    let calls = 0;
    const flaky = async () => { calls += 1; if (calls === 1) throw new Error('fetch failed'); return ok(); };
    expect(await writeQueries('project', llm, flaky)).toEqual(['grid storage of energy']);
  });
});

describe('embedOpenCalls', () => {
  const call = (callId: string, scope: string) => ({ callId, title: `T ${callId}`, summary: 'S', objectives: '', scope });
  const fakeStore = (stored: Map<string, { idx: number; textHash: string; model: string }[]>) => {
    const saved = new Map<string, StoredPassage[]>();
    const store = {
      callsToEmbed: async () => [call('KEPT', 'Same text.'), call('CHANGED', 'New text.'), call('NEW', 'Text.')],
      stored: async () => stored,
      savePassages: async (callId: string, passages: StoredPassage[]) => { saved.set(callId, passages); },
      dropExcept: async (ids: string[]) => [...stored.keys()].filter((id) => !ids.includes(id)).length,
    } as unknown as CallPassageStore;
    return { store, saved };
  };
  const hashes = (c: ReturnType<typeof call>) => passagesOf(c).map((p) => ({ idx: p.idx, textHash: textHash(embeddingInput(c.title, p)), model: 'bge-m3' }));
  const embedder = { model: 'bge-m3', embed: async (texts: string[]) => texts.map(() => [0.5, 0.5]) };

  it('embeds the new and changed calls only, and drops the closed ones', async () => {
    const stored = new Map([
      ['KEPT', hashes(call('KEPT', 'Same text.'))],
      ['CHANGED', hashes(call('CHANGED', 'Old text.'))],
      ['CLOSED', hashes(call('CLOSED', 'Gone.'))],
    ]);
    const { store, saved } = fakeStore(stored);
    const report = await embedOpenCalls(store, embedder);
    expect(report).toEqual({ calls: 3, embedded: 2, kept: 1, passages: 4, dropped: 1 });
    expect([...saved.keys()]).toEqual(['CHANGED', 'NEW']);
    expect(saved.get('NEW')![1]).toMatchObject({ idx: 1, section: 'scope', text: 'Text.', model: 'bge-m3', embedding: [0.5, 0.5] });
  });
  it('re-embeds everything when the model changes; writes nothing on a dry run', async () => {
    const stored = new Map([['KEPT', hashes(call('KEPT', 'Same text.')).map((h) => ({ ...h, model: 'other' }))]]);
    const { store, saved } = fakeStore(stored);
    const report = await embedOpenCalls(store, embedder, { dryRun: true });
    expect(report).toMatchObject({ embedded: 3, kept: 0, dropped: 0 });
    expect(saved.size).toBe(0);
  });
});
