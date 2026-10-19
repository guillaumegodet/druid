// « My project » assistant of the calls for proposals (druid-internal docs/plan-funding-calls.md, lot 7), server side:
// the language model writes a few search queries from the project, the queries and the project text are embedded, the
// passages of the open calls are ranked (lib/calls/projectSearch.ts) and the system prompt of the answer is built from
// the calls found. The answer itself is streamed by server.cjs (same SSE as the other assistants).
import { createHash } from 'node:crypto';
import type { CallPassageStore } from './passageStore';
import type { Embedder } from './embeddings';
import type { TranslatorSettings } from './translate';
import {
  QUERY_SYSTEM, buildProjectSystemPrompt, embeddingInput, parseQueries, passagesOf, projectTextOf, rankCalls,
  type CallText, type Passage, type ProjectHit, type SearchablePassage,
} from './projectSearch';

/** A passage ready to embed: the text sent to the service and its hash. */
type PassageInput = Passage & { input: string; textHash: string };

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const textHash = (text: string): string => createHash('sha1').update(text).digest('hex');

/**
 * Search queries written by the model from the project, one more attempt after a failure (ILaaS drops a request now
 * and then); [] when both fail (the project text is searched alone).
 */
export async function writeQueries(project: string, llm: TranslatorSettings, fetchImpl: Fetch = fetch as unknown as Fetch, timeoutMs = 30000, attempts = 2): Promise<string[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${llm.apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
        body: JSON.stringify({ model: llm.model, temperature: 0, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: QUERY_SYSTEM }, { role: 'user', content: project }] }),
        signal: controller.signal,
      });
      if (res.ok) {
        const body = await res.json() as { choices?: { message?: { content?: string } }[] };
        const queries = parseQueries(body.choices?.[0]?.message?.content ?? '');
        if (queries.length) return queries;
      }
    } catch {
      // network failure or timeout: next attempt
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

export interface EmbedReport {
  calls: number;
  embedded: number;
  kept: number;
  passages: number;
  dropped: number;
}

/**
 * Embeds the passages of the open calls whose text or model changed since the last run, and drops the passages of the
 * calls no longer open. `limit` caps the number of calls embedded in one run.
 */
export async function embedOpenCalls(store: CallPassageStore, embedder: Embedder, options: { dryRun?: boolean; limit?: number; log?: (line: string) => void } = {}): Promise<EmbedReport> {
  const calls = await store.callsToEmbed();
  const stored = await store.stored();
  const report: EmbedReport = { calls: calls.length, embedded: 0, kept: 0, passages: 0, dropped: 0 };
  const todo: { call: CallText; inputs: PassageInput[] }[] = [];
  for (const call of calls) {
    const inputs = passagesOf(call).map((p) => {
      const input = embeddingInput(call.title, p);
      return { ...p, input, textHash: textHash(input) };
    });
    const before = stored.get(call.callId) ?? [];
    const same = before.length === inputs.length
      && inputs.every((p, i) => before[i].idx === p.idx && before[i].textHash === p.textHash && before[i].model === embedder.model);
    if (same) report.kept += 1;
    else todo.push({ call, inputs });
  }
  for (const { call, inputs } of todo.slice(0, options.limit ?? todo.length)) {
    report.embedded += 1;
    report.passages += inputs.length;
    if (options.dryRun) continue;
    const vectors = await embedder.embed(inputs.map((p) => p.input));
    await store.savePassages(call.callId, inputs.map((p, i) => ({
      idx: p.idx, section: p.section, text: p.text, textHash: p.textHash, model: embedder.model, embedding: vectors[i],
    })));
    options.log?.(`  ${call.callId}: ${inputs.length} passage(s)`);
  }
  if (!options.dryRun) report.dropped = await store.dropExcept(calls.map((c) => c.callId));
  return report;
}

/**
 * Calls handed to the model, which keeps five at most: the relevant ones ranked 5th to 13th on druid-test (2026-10-17)
 * when generic calls (AI, youth…) matched one aspect of the project better.
 */
export const PROJECT_HITS = 12;

export interface ProjectSearchResult {
  /** System prompt of the answer (rules + calls found). */
  system: string;
  hits: ProjectHit[];
  queries: string[];
}

/** The search of the assistant; the passages are kept in memory and reloaded when the table changes. */
export const createProjectChat = (deps: { store: CallPassageStore; embedder: Embedder; llm: TranslatorSettings; fetchImpl?: Fetch; today?: () => string }) => {
  let cache: { version: string; passages: SearchablePassage[] } | null = null;
  const passages = async (): Promise<SearchablePassage[]> => {
    const version = await deps.store.version();
    if (!cache || cache.version !== version) cache = { version, passages: await deps.store.searchable(deps.embedder.model) };
    return cache.passages;
  };
  const search = async (messages: { role: string; content: string }[], lang: 'fr' | 'en' = 'fr'): Promise<ProjectSearchResult> => {
    const project = projectTextOf(messages);
    const queries = await writeQueries(project, deps.llm, deps.fetchImpl);
    const vectors = await deps.embedder.embed([project.slice(0, 2000), ...queries]);
    const ranked = rankCalls(vectors, await passages(), { limit: PROJECT_HITS });
    const info = await deps.store.callsInfo(ranked.map((r) => r.callId));
    const hits = ranked.filter((r) => info.has(r.callId)).map((r) => ({ ...r, ...info.get(r.callId)! }));
    const today = deps.today?.() ?? new Date().toISOString().slice(0, 10);
    return { system: buildProjectSystemPrompt(hits, today, lang), hits, queries };
  };
  return { search, model: deps.llm.model };
};

export type ProjectChat = ReturnType<typeof createProjectChat>;
