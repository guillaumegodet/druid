// « My project » assistant of the calls for proposals (druid-internal docs/plan-funding-calls.md, lot 7): a project
// described in any language is compared with the passages of the open calls (bge-m3 vectors, scripts/embed_calls.ts),
// then the language model of the instance presents the calls that fit it from the passages found. Pure part: cutting a
// call into passages, ranking the calls for several queries, reading the queries written by the model, the prompts.

export type PassageSection = 'summary' | 'objectives' | 'scope';

export interface CallText {
  callId: string;
  title: string;
  summary: string;
  objectives: string;
  scope: string;
}

export interface Passage {
  idx: number;
  section: PassageSection;
  text: string;
}

/** Length of a passage: a few paragraphs, short enough for its vector to stay specific. */
export const PASSAGE_CHARS = 1200;

/** Pieces of at most `max` characters: whole paragraphs packed together, a long paragraph cut at its sentences. */
export const chunkText = (text: string, max = PASSAGE_CHARS): string[] => {
  const pieces: string[] = [];
  for (const para of text.split(/\n\s*\n|\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    if (para.length <= max) { pieces.push(para); continue; }
    let rest = para;
    while (rest.length > max) {
      const cut = rest.lastIndexOf('. ', max);
      const at = cut > max / 3 ? cut + 1 : rest.lastIndexOf(' ', max) > 0 ? rest.lastIndexOf(' ', max) : max;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const out: string[] = [];
  for (const p of pieces) {
    if (out.length && out[out.length - 1].length + 1 + p.length <= max) out[out.length - 1] += `\n${p}`;
    else out.push(p);
  }
  return out;
};

/** Passages of a call: its summary (always, the title alone when there is none), then its objectives and its scope. */
export const passagesOf = (call: CallText): Passage[] => {
  const out: Passage[] = [{ idx: 0, section: 'summary', text: call.summary.replace(/\s+/g, ' ').trim() }];
  for (const section of ['objectives', 'scope'] as const) {
    for (const text of chunkText(call[section])) out.push({ idx: out.length, section, text });
  }
  return out;
};

/** Text sent to the embedding service: the title gives each passage its context. */
export const embeddingInput = (title: string, passage: Pick<Passage, 'text'>): string =>
  [title.trim(), passage.text].filter(Boolean).join('\n\n');

export interface SearchablePassage {
  callId: string;
  section: PassageSection;
  text: string;
  /** Unit vector (bge-m3 normalizes them): the cosine similarity is the dot product. */
  vector: ArrayLike<number>;
}

export interface RankedCall {
  callId: string;
  /** Reciprocal-rank fusion over the queries: a call found by several queries, or ranked first, comes first. */
  score: number;
  /** Best similarity of a passage of the call to one of the queries (0-1), to tell a weak match. */
  similarity: number;
  /** Number of queries that ranked the call among their best. */
  queries: number;
  best: { section: PassageSection; text: string };
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
};

/** Constant of the reciprocal-rank fusion (the usual 60 flattens a list this short too much). */
const RRF_K = 10;

/**
 * Calls ranked for several queries: each query ranks the calls by their best passage and keeps its `perQuery` best; the
 * ranks are fused (sum of 1 / (k + rank)), ties broken by the best similarity.
 */
export const rankCalls = (queryVectors: ArrayLike<number>[], passages: SearchablePassage[], options: { perQuery?: number; limit?: number } = {}): RankedCall[] => {
  const perQuery = options.perQuery ?? 20;
  const limit = options.limit ?? 8;
  const ranked = new Map<string, RankedCall>();
  for (const q of queryVectors) {
    const bestOf = new Map<string, { sim: number; passage: SearchablePassage }>();
    for (const p of passages) {
      const sim = dot(q, p.vector);
      const cur = bestOf.get(p.callId);
      if (!cur || sim > cur.sim) bestOf.set(p.callId, { sim, passage: p });
    }
    const top = [...bestOf.entries()].sort((a, b) => b[1].sim - a[1].sim).slice(0, perQuery);
    top.forEach(([callId, { sim, passage }], rank) => {
      const entry = ranked.get(callId) ?? { callId, score: 0, similarity: -1, queries: 0, best: { section: passage.section, text: passage.text } };
      entry.score += 1 / (RRF_K + rank + 1);
      entry.queries += 1;
      if (sim > entry.similarity) { entry.similarity = sim; entry.best = { section: passage.section, text: passage.text }; }
      ranked.set(callId, entry);
    });
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score || b.similarity - a.similarity).slice(0, limit);
};

/** Text of the project the search starts from: the last user turns (a follow-up keeps the context of the project). */
export const projectTextOf = (messages: { role: string; content: string }[], turns = 2, max = 4000): string =>
  messages.filter((m) => m.role === 'user').slice(-turns).map((m) => m.content.trim()).filter(Boolean).join('\n\n').slice(0, max);

// Most calls are written in English (European programmes), the French ones (ANR, regional, added by hand) in French:
// a query matches the calls of its own language best, hence queries in both.
export const QUERY_SYSTEM = 'You help a research office find calls for proposals (European, national, regional, foundations) that fit a '
  + 'research project. From the project described by the user (any language), write 4 search queries in English and 2 in '
  + 'French, of 5 to 15 words each, phrased the way a call text would be: the societal or scientific challenge, the expected '
  + 'outcome, the research content. Cover the distinct aspects of the project rather than repeating one idea. Answer in JSON '
  + 'only: {"queries": ["…", "…"]}.';

/** The queries written by the model, six at most; [] when the answer is not usable (the project text is searched alone). */
export const parseQueries = (content: string): string[] => {
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { queries?: unknown })?.queries;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const q = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (q.length < 3 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    out.push(q);
  }
  return out.slice(0, 6);
};

/** A call found for the project, with what the prompt needs to present it. */
export interface ProjectHit extends RankedCall {
  title: string;
  titleFr: string;
  programme: string;
  funder: string;
  scheme: string;
  summary: string;
  deadlines: string[];
  status: string;
  url: string;
}

const SECTION_LABEL: Record<PassageSection, string> = { summary: 'Summary', objectives: 'Expected outcome / objectives', scope: 'Scope' };

/**
 * Similarity under which a call is only loosely related to the project (bge-m3, passages against short queries):
 * measured on druid-test on 2026-10-17, the calls that fit scored 0.65-0.71, the unrelated ones 0.49-0.60.
 */
export const WEAK_SIMILARITY = 0.6;

/** System prompt of the answer: the rules, then the calls found (the model may only use them). */
export const buildProjectSystemPrompt = (hits: ProjectHit[], today: string, lang: 'fr' | 'en' = 'fr'): string => {
  const language = lang === 'en' ? 'English' : 'French';
  const rules = [
    'You are the « My project » assistant of the research office: you help a researcher find, among the open and forthcoming',
    'calls for proposals followed by the institution, those that fit their project. The calls below were found by a semantic',
    'search on the project; each comes with the passage of its text closest to the project.',
    '',
    'How to answer:',
    `- Write the whole answer in ${language} (labels included), unless the user writes in another language: then use theirs.`,
    '- Answer with the shortlist only: at most five calls taken from the list below, ranked by how much of the project they',
    '  cover (not by their order in the list): a call on the very subject of the project comes before a call that shares only',
    '  its method or its public. Leave out a call only',
    '  when it is clearly unrelated to the project; a call that covers part of it (its field, its method, its application) is',
    '  worth showing, presented as a partial match. A national or regional call is as relevant as a European one.',
    '- For each call, 2 to 4 lines: its title as a Markdown link to its page (when it has one) followed by its identifier; the',
    '  funder and programme; the next deadline; one sentence on why it fits, drawn from its passage. Say what the call is',
    '  about and which part of the project it meets; never attribute to a call a topic its passage and summary do not state.',
    '  When it meets the project only through a general theme (artificial intelligence, young people, the sea…) or is marked',
    '  « weak », say plainly that it is a distant match.',
    '- Never make up a call, a date, an amount or a condition: everything must come from the list. For a question on a call',
    '  (eligibility, budget, conditions) answer from its passage and summary only, and otherwise send the user to its page.',
    '- If nothing in the list is related to the project, say so and suggest describing it differently (objectives, methods,',
    '  application field).',
    '- No introduction and no general advice on funding rules. End with one sentence offering to detail a call.',
    '',
    `Today: ${today}.`,
    '',
    'Calls found:',
  ];
  if (!hits.length) return [...rules, '(none: no open call is close to this project)'].join('\n');
  const blocks = hits.map((h, i) => {
    const next = [...h.deadlines].sort().find((d) => d >= today);
    const lines = [
      `${i + 1}. ${h.title} [${h.callId}]${h.similarity < WEAK_SIMILARITY ? ' (weak)' : ''}`,
      `   Funder / programme: ${[h.funder, h.programme, h.scheme].filter(Boolean).join(' / ')}`,
      `   Status: ${h.status}; next deadline: ${next ?? (h.deadlines.length ? 'none left' : 'not stated')}`,
    ];
    if (h.url) lines.push(`   Page: ${h.url}`);
    if (h.summary && h.best.section !== 'summary') lines.push(`   Summary: ${h.summary.replace(/\s+/g, ' ').slice(0, 600)}`);
    lines.push(`   ${SECTION_LABEL[h.best.section]} (closest passage): ${h.best.text.replace(/\s+/g, ' ')}`);
    return lines.join('\n');
  });
  return [...rules, blocks.join('\n\n')].join('\n');
};
