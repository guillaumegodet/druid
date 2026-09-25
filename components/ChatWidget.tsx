import React, { useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, MessageCircle, RotateCcw, Send, Sparkles, Square, Wrench, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { hasCapability } from '../lib/auth';

/**
 * « Assistant CRISalid » chat widget — floating button at the bottom right,
 * expandable panel, two modes (tabs) depending on the instance capabilities:
 * - « Données CRISalid » (HAS_PIPELINES_CHAT): the LangGraph agent of the Open WebUI
 *   pipelines, through the streaming relay /api/chat of server.cjs;
 * - « Aide Druid » (HAS_HELP_CHAT): answers from the help centre pages through ILAAS,
 *   /api/help-chat (docs/plan-documentation-utilisateur.md, lot 8).
 * Both stream OpenAI-format SSE. Each mode keeps its own conversation in sessionStorage:
 * kept across navigation and reloads, forgotten when the tab is closed.
 */

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ChatMode = 'data' | 'help';

const STORAGE_KEY = 'druid-chat-messages';
/** The data mode keeps the historical key, so ongoing conversations survive the update. */
const storageKey = (mode: ChatMode) => (mode === 'data' ? STORAGE_KEY : `${STORAGE_KEY}-help`);
const ENDPOINT: Record<ChatMode, string> = { data: '/api/chat', help: '/api/help-chat' };

// Starter questions (sent as-is to the agent, in the UI language).
const SUGGESTIONS = [
  msg`What can you do?`,
  msg`What are the research areas of the LPPL?`,
  msg`Are there collaborations between CRCI2NA and Belgium?`,
  msg`Who works on next-generation batteries?`,
];

// Starter questions of the « Aide Druid » mode.
const HELP_SUGGESTIONS = [
  msg`How do I validate a record?`,
  msg`What does the “Left” status mean?`,
  msg`How do I add an ORCID to a researcher?`,
  msg`What is the difference between the Affiliation and Headcount scopes?`,
];

// ── <details> blocks of the OpenWebUI protocol ──────────────────────────────
// The pipelines agent emits its tool calls (and optional reasoning)
// as HTML blocks `<details type="tool_calls" name="…">…</details>`
// BEFORE the answer text. They are stripped from the displayed text and
// summarized as « outil ✓ » chips; they are also removed from the history
// sent back to the agent (useless and token-expensive).

interface ToolChip {
  name: string;
  done: boolean;
}

const DETAILS_BLOCK_RE = /<details\b[^>]*>[\s\S]*?<\/details>\s*/g;

function parseAssistant(raw: string): { tools: ToolChip[]; text: string } {
  const tools: ToolChip[] = [];
  let text = raw.replace(DETAILS_BLOCK_RE, (block) => {
    const name =
      block.match(/\bname="([^"]+)"/)?.[1] ||
      (/type="reasoning"/.test(block) ? i18n._(msg`reasoning`) : i18n._(msg`tool`));
    tools.push({ name, done: /\bdone="true"/.test(block) });
    return '';
  });
  // Block still open (stream in progress): hidden, pending chip
  const open = text.lastIndexOf('<details');
  if (open !== -1 && !text.includes('</details>', open)) {
    const name = text.slice(open).match(/\bname="([^"]+)"/)?.[1];
    tools.push({ name: name || i18n._(msg`tool`), done: false });
    text = text.slice(0, open);
  }
  return { tools, text: text.trim() };
}

// ── Minimal markdown rendering (bold, italic, code, links, lists, headings) ──
// Deliberately dependency-free: the agent only produces a simple subset
// of markdown. Builds React elements (never innerHTML).

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string): React.ReactNode[] {
  return text.split(INLINE_RE).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="px-1 py-0.5 rounded bg-ink/10 dark:bg-white/10 text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline decoration-accent decoration-2 underline-offset-2 hover:text-accent-strong"
        >
          {link[1]}
        </a>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

const isFence = (l: string) => l.trim().startsWith('```');
const isListItem = (l: string) => /^\s*([-*•]|\d+[.)])\s+/.test(l);
const isHeading = (l: string) => /^#{1,4}\s+/.test(l);

function renderMarkdown(text: string): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isFence(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) code.push(lines[i++]);
      i++; // closing fence (or end of text if the stream is in progress)
      blocks.push(
        <pre key={key++} className="my-1.5 p-2.5 rounded-xl bg-ink/90 text-[#f5f2ea] text-[12px] overflow-x-auto">
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }
    if (isListItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      }
      blocks.push(
        <ul key={key++} className="my-1 pl-4 list-disc space-y-0.5">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>
      );
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      blocks.push(<p key={key++} className="mt-2 mb-1 font-bold">{renderInline(heading[1])}</p>);
      i++;
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isListItem(lines[i]) && !isHeading(lines[i]) && !isFence(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={key++} className="my-1">{renderInline(para.join(' '))}</p>);
  }
  return <>{blocks}</>;
}

// ── Component ────────────────────────────────────────────────────────────────

function loadMessages(mode: ChatMode): ChatMessage[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey(mode)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMessage =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    );
  } catch {
    return [];
  }
}

export const ChatWidget: React.FC = () => {
  const { t, i18n } = useLingui();
  // Modes offered by this instance; no mode at all ⇒ no widget.
  const modes: ChatMode[] = [
    ...(hasCapability('HAS_PIPELINES_CHAT') ? (['data'] as const) : []),
    ...(hasCapability('HAS_HELP_CHAT') ? (['help'] as const) : []),
  ];
  const [mode, setMode] = useState<ChatMode>(modes[0] ?? 'data');
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(modes[0] ?? 'data'));
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Auto-scroll only if the user has not scrolled up the thread
  const stickToBottom = useRef(true);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(mode), JSON.stringify(messages.slice(-40)));
    } catch { /* quota full: the conversation stays in memory */ }
  }, [messages, mode]);

  useEffect(() => {
    if (open && stickToBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const setLastAssistant = (content: string) =>
    setMessages((cur) => cur.map((m, i) => (i === cur.length - 1 ? { ...m, content } : m)));

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || streaming) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    stickToBottom.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = '';
    try {
      const res = await fetch(ENDPOINT[mode], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content: c }) => ({
            role,
            content: role === 'assistant' ? parseAssistant(c).text : c,
          })),
          // The help assistant searches and answers in the interface language.
          ...(mode === 'help' ? { lang: i18n.locale } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const status = res.status;
        const detail =
          status === 401
            ? t`Session expired — reload the page to sign in again.`
            : (await res.json().catch(() => null))?.error || t`Error ${status}`;
        setLastAssistant(`⚠️ ${detail}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const raw of parts) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              setLastAssistant(acc);
            }
          } catch { /* incomplete JSON chunk: ignored */ }
        }
      }
      if (!acc) setLastAssistant(t`(no answer — try again)`);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (!acc) setLastAssistant(t`(answer interrupted)`);
      } else {
        const reason = (err as Error).message;
        setLastAssistant(`⚠️ ${t`Assistant unreachable: ${reason}`}`);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    stop();
    setMessages([]);
    inputRef.current?.focus();
  };

  const switchMode = (next: ChatMode) => {
    if (next === mode) return;
    stop();
    setMode(next);
    setMessages(loadMessages(next));
    stickToBottom.current = true;
    inputRef.current?.focus();
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  if (modes.length === 0) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={t`CRISalid assistant`}
        aria-label={t`Open the CRISalid assistant`}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-accent hover:bg-accent-strong text-ink border border-white/60 shadow-soft-lg flex items-center justify-center transition-transform hover:scale-105"
      >
        <MessageCircle size={24} strokeWidth={2.2} />
      </button>
    );
  }

  const lastIdx = messages.length - 1;

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[380px] max-w-[calc(100vw-2.5rem)] h-[600px] max-h-[calc(100vh-7rem)] flex flex-col rounded-3xl overflow-hidden bg-[#fbf8ef]/95 dark:bg-[#26241e]/95 backdrop-blur-xl border border-white/80 dark:border-white/15 shadow-soft-lg text-ink dark:text-[#f5f2ea]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/10 dark:border-white/10">
        <span className="w-9 h-9 shrink-0 rounded-full bg-accent text-ink flex items-center justify-center">
          {mode === 'help' ? <CircleHelp size={18} /> : <Sparkles size={18} />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight font-disp">
            {mode === 'help' ? <Trans>Druid help assistant</Trans> : <Trans>CRISalid Research Assistant</Trans>}
          </p>
          <p className="text-[11px] text-muted-light dark:text-[#8f897c] truncate">
            {mode === 'help'
              ? <Trans>how to use Druid, answers from the help centre</Trans>
              : <Trans>publications, laboratories, areas of expertise</Trans>}
          </p>
        </div>
        <button
          onClick={reset}
          title={t`New conversation`}
          className="w-8 h-8 rounded-full flex items-center justify-center text-muted dark:text-[#c9c4b6] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors"
        >
          <RotateCcw size={15} />
        </button>
        <button
          onClick={() => setOpen(false)}
          title={t`Minimise`}
          className="w-8 h-8 rounded-full flex items-center justify-center text-muted dark:text-[#c9c4b6] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors"
        >
          <X size={17} />
        </button>
      </div>

      {modes.length > 1 && (
        <div className="flex gap-1 px-3 pt-2" role="tablist">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`flex-1 h-8 rounded-full text-[12px] font-semibold transition-colors ${
                mode === m
                  ? 'bg-ink text-white dark:bg-accent dark:text-ink'
                  : 'bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15'
              }`}
            >
              {m === 'help' ? <Trans>Druid help</Trans> : <Trans>CRISalid data</Trans>}
            </button>
          ))}
        </div>
      )}

      {/* Message thread */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed"
      >
        {messages.length === 0 && (
          <div className="h-full flex flex-col justify-end gap-3">
            <p className="text-muted dark:text-[#b3ad9f]">
              {mode === 'help' ? (
                <Trans>
                  Ask how to do something in Druid: the answer comes from the help centre, with links to the pages used.
                </Trans>
              ) : (
                <Trans>
                  Ask your questions about research at Nantes Université: publications, laboratories, areas of expertise…
                </Trans>
              )}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(mode === 'help' ? HELP_SUGGESTIONS : SUGGESTIONS).map((s) => t(s)).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-semibold bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 hover:bg-white dark:hover:bg-white/15 transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end my-2">
              <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md bg-accent/30 dark:bg-accent/20 whitespace-pre-wrap break-words">
                {m.content}
              </div>
            </div>
          ) : (
            (() => {
              const parsed = parseAssistant(m.content);
              return (
                <div key={i} className="my-2 break-words">
                  {parsed.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {parsed.tools.map((t, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-ink/5 dark:bg-white/10 text-muted dark:text-[#b3ad9f] border border-ink/10 dark:border-white/10"
                        >
                          {t.done ? (
                            <Check size={10} className="text-pixel-teal" />
                          ) : (
                            <Wrench size={10} className="animate-pulse" />
                          )}
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {parsed.text ? (
                    renderMarkdown(parsed.text)
                  ) : streaming && i === lastIdx ? (
                    <span className="inline-flex items-center gap-2 text-muted-light dark:text-[#8f897c]">
                      <span className="w-3.5 h-3.5 border-2 border-ink dark:border-accent border-t-transparent rounded-full animate-spin" />
                      {mode === 'help' ? <Trans>Searching the help centre…</Trans> : <Trans>The assistant is querying the graph…</Trans>}
                    </span>
                  ) : parsed.tools.length === 0 ? null : (
                    <span className="text-muted-light dark:text-[#8f897c]"><Trans>(no text answer)</Trans></span>
                  )}
                </div>
              );
            })()
          )
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="p-3 border-t border-ink/10 dark:border-white/10"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={t`Your question…`}
            className="flex-1 resize-none max-h-28 rounded-xl bg-white dark:bg-white/10 border border-ink/10 dark:border-white/15 px-3 py-2 text-[13px] font-semibold outline-none focus:border-accent-strong placeholder:text-muted-faint"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              title={t`Stop the answer`}
              className="w-10 h-10 shrink-0 rounded-full bg-ink text-white dark:bg-white/15 dark:text-[#f5f2ea] flex items-center justify-center hover:opacity-85 transition-opacity"
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              title={t`Send`}
              className="w-10 h-10 shrink-0 rounded-full bg-accent text-ink flex items-center justify-center hover:bg-accent-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
