import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, parseTranslations, translateTexts, translatorFromEnv } from '../euCalls/translate';

describe('parseTranslations', () => {
  it('accepts the object or array shape, with or without a code fence, and refuses a count mismatch', () => {
    expect(parseTranslations('{"traductions": [" A ", "B"]}', 2)).toEqual(['A', 'B']);
    expect(parseTranslations('```json\n["A", "B"]\n```', 2)).toEqual(['A', 'B']);
    expect(parseTranslations('{"traductions": ["A"]}', 2)).toBeNull();
    expect(parseTranslations('{"traductions": ["A", ""]}', 2)).toBeNull();
    expect(parseTranslations('not json', 1)).toBeNull();
  });
});

describe('translatorFromEnv', () => {
  it('needs a key and strips inline comments', () => {
    expect(translatorFromEnv({})).toBeNull();
    expect(translatorFromEnv({ ILAAS_API_KEY: 'k', ILAAS_MODEL: 'm # comment', ILAAS_API_BASE: 'https://x/v1/' }))
      .toEqual({ apiBase: 'https://x/v1', apiKey: 'k', model: 'm' });
  });
});

describe('translateTexts', () => {
  it('translates by batches in order and leaves a failed batch empty', async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init: { body: string }) => {
      const n = (JSON.parse(init.body).messages[1].content.match(/^\d+\. /gm) || []).length;
      calls.push(String(n));
      if (calls.length === 2) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ traductions: Array.from({ length: n }, (_, i) => `fr${i}`) }) } }] }) };
    };
    const texts = Array.from({ length: BATCH_SIZE + 2 }, (_, i) => `en${i}`);
    const out = await translateTexts(texts, { apiBase: 'https://x', apiKey: 'k', model: 'm' }, fetchImpl as never, 1);
    expect(calls).toEqual([String(BATCH_SIZE), '2']);
    expect(out.slice(0, BATCH_SIZE)).toEqual(Array.from({ length: BATCH_SIZE }, (_, i) => `fr${i}`));
    expect(out.slice(BATCH_SIZE)).toEqual(['', '']);
  });
});
