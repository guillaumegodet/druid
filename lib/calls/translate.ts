// French translation of the English texts of the European calls (topic summaries, match justifications) with the
// language model of the instance (ILaaS, OpenAI-compatible chat completions), a few texts per request, at import time
// (docs/archive/plan-eu-calls.md, recette of 2026-10-14). Pure parsing kept apart for the tests.

export interface TranslatorSettings {
  apiBase: string;
  apiKey: string;
  model: string;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const BATCH_SIZE = 8;

/** Settings from the environment (druid service: ILAAS_*); null when no key is set. */
export const translatorFromEnv = (env: Record<string, string | undefined>): TranslatorSettings | null => {
  const clean = (v: string | undefined, fallback = '') => (v ?? fallback).split('#', 1)[0].trim();
  const apiKey = clean(env.ILAAS_API_KEY);
  if (!apiKey) return null;
  return { apiBase: clean(env.ILAAS_API_BASE, 'https://llm.ilaas.fr/v1').replace(/\/$/, ''), apiKey, model: clean(env.ILAAS_MODEL, 'mistral-small-4-119b') };
};

const SYSTEM = 'Tu traduis en français des textes scientifiques courts (résumés de thématiques de recherche, justifications '
  + "d'adéquation entre un chercheur et un appel à projets). Garde le sens exact, les sigles et les termes techniques usuels ; "
  + 'pas de commentaire. Réponds uniquement en JSON : {"traductions": ["…", "…"]}, une entrée par texte, dans le même ordre.';

/** The model's answer → the translations, in order; null when the answer is not usable (count mismatch, no JSON). */
export const parseTranslations = (content: string, expected: number): string[] | null => {
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { traductions?: unknown })?.traductions;
  if (!Array.isArray(list) || list.length !== expected) return null;
  const out = list.map((v) => String(v ?? '').trim());
  return out.every(Boolean) ? out : null;
};

/** Translates `texts` (same order); an entry stays '' when its batch failed. */
export async function translateTexts(texts: string[], settings: TranslatorSettings, fetchImpl: Fetch = fetch as unknown as Fetch, retries = 3): Promise<string[]> {
  const out = texts.map(() => '');
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const user = chunk.map((t, k) => `${k + 1}. ${t}`).join('\n\n');
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetchImpl(`${settings.apiBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.model, temperature: 0, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { choices?: { message?: { content?: string } }[] };
        const parsed = parseTranslations(body.choices?.[0]?.message?.content ?? '', chunk.length);
        if (!parsed) throw new Error('unusable answer');
        parsed.forEach((fr, k) => { out[i + k] = fr; });
        break;
      } catch {
        if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  return out;
}
