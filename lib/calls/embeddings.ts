// Client of the embedding service of the instance (OpenAI-compatible /v1/embeddings, bge-m3 on the ILaaS RAG API, the
// one the CRISalid agents use): vectors of the passages of the calls and of the project queries (druid-internal
// docs/plan-funding-calls.md, lot 7). Env: EMBEDDING_API_URL, EMBEDDING_API_KEY, EMBEDDING_API_MODEL.

export interface Embedder {
  model: string;
  /** One vector per text, same order. */
  embed: (texts: string[]) => Promise<number[][]>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const EMBEDDING_BATCH = 32;

/** The embedder of the environment; null when no service is set (the « My project » assistant is then off). */
export const embedderFromEnv = (env: Record<string, string | undefined>, fetchImpl: Fetch = fetch as unknown as Fetch, timeoutMs = 30000): Embedder | null => {
  const clean = (v: string | undefined) => (v ?? '').split('#', 1)[0].trim();
  const base = clean(env.EMBEDDING_API_URL).replace(/\/$/, '');
  const model = clean(env.EMBEDDING_API_MODEL);
  if (!base || !model) return null;
  const apiKey = clean(env.EMBEDDING_API_KEY);
  const url = `${base.replace(/\/v1$/, '')}/v1/embeddings`;
  const request = async (input: string[]): Promise<number[][]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, input }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Embedding service HTTP ${res.status}`);
      const body = await res.json() as { data?: { index: number; embedding: number[] }[] };
      const data = Array.isArray(body.data) ? body.data : [];
      if (data.length !== input.length) throw new Error(`Embedding service returned ${data.length} vectors for ${input.length} texts`);
      return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    model,
    embed: async (texts) => {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBEDDING_BATCH) out.push(...await request(texts.slice(i, i + EMBEDDING_BATCH)));
      return out;
    },
  };
};
