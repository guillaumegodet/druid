// API keys of the establishment (druid-internal docs/plan-druid-saas.md, lot 6 a-2): what is accepted as an address, a
// model or a key, and how the answers of the services become a test outcome (never echoing the key).
import { describe, expect, it } from 'vitest';
import { checkLlm, checkScopus, llmEnvOf, normalizeKey, normalizeLlmBase, normalizeModel, DEFAULT_LLM_BASE } from '../saas/clientKeys';

const answer = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

describe('client keys — input', () => {
  it('the address of the model: public https only, normalized', () => {
    expect(normalizeLlmBase('')).toBe(DEFAULT_LLM_BASE);
    expect(normalizeLlmBase(' https://api.mistral.ai/v1/ ')).toBe('https://api.mistral.ai/v1');
    expect(normalizeLlmBase('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1');
    for (const bad of ['http://api.mistral.ai/v1', 'https://localhost/v1', 'https://10.0.0.2/v1', 'https://[::1]/v1', 'https://u:p@x.example.org/v1', 'ftp://x', 'nonsense']) {
      expect(() => normalizeLlmBase(bad), bad).toThrow('Invalid address of the language model');
    }
  });
  it('the model and the keys', () => {
    expect(normalizeModel('')).toBe('mistral-small-4-119b');
    expect(normalizeModel('mistralai/Mistral-Small-3.2-24B')).toBe('mistralai/Mistral-Small-3.2-24B');
    expect(() => normalizeModel('a b')).toThrow('Invalid model name');
    expect(normalizeKey('  ')).toBeNull();
    expect(normalizeKey(' sk-abcdef123456 ')).toBe('sk-abcdef123456');
    expect(() => normalizeKey('short')).toThrow('Invalid API key');
    expect(() => normalizeKey('with space inside', 'token')).toThrow('Invalid institution token');
  });
  it('the environment of a handler: the establishment model, defaults ILaaS, nothing without a key', () => {
    expect(llmEnvOf({})).toEqual({});
    expect(llmEnvOf({ ILAAS_API_KEY: 'k' })).toEqual({ ILAAS_API_KEY: 'k', ILAAS_API_BASE: DEFAULT_LLM_BASE, ILAAS_MODEL: 'mistral-small-4-119b' });
    expect(llmEnvOf({ ILAAS_API_KEY: 'k', ILAAS_API_BASE: 'https://x.example.org/v1', ILAAS_MODEL: 'm' }).ILAAS_MODEL).toBe('m');
  });
});

describe('client keys — tests of the services', () => {
  const llm = { apiBase: 'https://llm.example.org/v1', model: 'm', apiKey: 'sk-secret-123456' };
  it('language model: a chat completion is OK; refusals become codes', async () => {
    let seen: any = null;
    const ok = await checkLlm(llm, async (url, init) => { seen = { url, init }; return answer(200, { choices: [{ message: { content: 'OK' } }] })(); });
    expect(ok).toEqual({ ok: true, code: 'ok', detail: null });
    expect(seen.url).toBe('https://llm.example.org/v1/chat/completions');
    expect(seen.init.headers.Authorization).toBe('Bearer sk-secret-123456');
    expect(JSON.parse(seen.init.body).model).toBe('m');
    expect((await checkLlm(llm, answer(401, { error: { message: 'Invalid key sk-secret-123456' } }))).code).toBe('invalid_key');
    expect((await checkLlm(llm, answer(401, { error: { message: 'Invalid key sk-secret-123456' } }))).detail).toBe('Invalid key •••');
    expect((await checkLlm(llm, answer(404, { error: { message: 'The model `m` does not exist' } }))).code).toBe('model_not_found');
    expect((await checkLlm(llm, answer(404, 'Not Found'))).code).toBe('unreachable');
    expect((await checkLlm(llm, answer(429, { error: 'rate' }))).code).toBe('quota');
    expect((await checkLlm(llm, answer(200, '<html>portal</html>'))).code).toBe('http_error');
    expect((await checkLlm(llm, async () => { throw new Error('getaddrinfo ENOTFOUND'); })).code).toBe('unreachable');
  });
  it('Elsevier: unknown key vs key without the entitlement from outside the network', async () => {
    let headers: any = null;
    expect((await checkScopus({ apiKey: 'els-key-123456', instToken: 'tok-123456789' }, async (_u, init) => { headers = init.headers; return answer(200, { 'search-results': {} })(); })).ok).toBe(true);
    expect(headers['X-ELS-Insttoken']).toBe('tok-123456789');
    const unknown = await checkScopus({ apiKey: 'els-key-123456' }, answer(401, { 'service-error': { status: { statusCode: 'AUTHENTICATION_ERROR', statusText: 'Invalid API Key' } } }));
    expect(unknown.code).toBe('invalid_key');
    const outside = await checkScopus({ apiKey: 'els-key-123456' }, answer(401, { 'service-error': { status: { statusCode: 'AUTHORIZATION_ERROR', statusText: 'The requestor is not authorized to access the requested view or fields of the resource' } } }));
    expect(outside.code).toBe('not_entitled');
    expect((await checkScopus({ apiKey: 'els-key-123456' }, answer(429, { error: 'QUOTA_EXCEEDED' }))).code).toBe('quota');
  });
});
