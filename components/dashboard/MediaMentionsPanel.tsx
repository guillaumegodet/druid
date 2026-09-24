import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Megaphone,
  RefreshCw,
  Undo2,
  X,
} from 'lucide-react';
import { mediaTypeLabel } from './mediaTypes';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { fetchJsonWithFallback, STATIC_MENTIONS_URL } from '../../lib/dashboardSource';
import { apiErrorText } from '../../lib/apiErrors';

// Contract of /api/mentions (server.cjs → druid-etl-api → media_watch).
// Phase 1: read only (auto + validated); the validation queue will come in
// phase 2. Person entities are missing as long as named data is off.
interface MentionStructure {
  slug: string;
  acro: string;
  confidence: number;
  via: string;
}
interface Mention {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  media_name: string;
  media_type: string;
  published_at: string;
  collector: string;
  structures: MentionStructure[];
  institution: number;
  intervention_type: string;
  status: string;
  confidence: number;
}
interface CollectorState {
  collector: string;
  last_run: string;
  last_status: string;
  last_count: number;
  consecutive_empty: number;
}
interface MentionsPayload {
  generated_at?: string;
  total: number;
  items: Mention[];
  collectors?: CollectorState[];
  note?: string;
}

const PERIODS = [7, 14, 30, 60, 90, 180];

// Cloudflare instances (Centrale): no media_watch backend — fallback on the static
// export public/dashboard-data/mentions.json, same doctrine as lib/dashboardSource.ts.
// The same build serves both targets: the API wins when it exists.
async function fetchMentions(
  params: URLSearchParams,
): Promise<{ data: MentionsPayload; api: boolean } | null> {
  const res = await fetchJsonWithFallback<MentionsPayload>(
    `/api/mentions?${params.toString()}`,
    [STATIC_MENTIONS_URL],
  );
  if (!res || res.api) return res;
  // Static asset: it embeds the whole published corpus, filters are applied client-side.
  const structure = params.get('structure');
  const days = Number(params.get('days') || 0);
  let items = res.data.items ?? [];
  if (structure) items = items.filter((m) => m.structures.some((s) => s.slug === structure));
  if (days) {
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    items = items.filter((m) => !m.published_at || m.published_at >= since);
  }
  return { data: { ...res.data, items, total: items.length }, api: false };
}

const INTERVENTION_TYPES: [string, MessageDescriptor][] = [
  ['', msg`— type —`],
  ['tribune', msg`Op-ed`],
  ['interview', msg`Interview`],
  ['citation_expert', msg`Expert quote`],
  ['vulgarisation', msg`Popular science`],
  ['mention_travaux', msg`Mention of research`],
  ['apparition', msg`Appearance`],
  ['audition', msg`Hearing`],
  ['autre', msg`Other`],
];

/**
 * Mention validation queue (« À valider » view of the « Médias » tab).
 * Navigation ↑/↓ (or J/K), V = validate, R = reject — decisions go
 * to the database (and are mirrored in the Grist Mentions table) with the
 * validator's Keycloak identity.
 */
const ReviewQueue: React.FC<{ onDecided: () => void; onCountChange?: (n: number) => void }> = ({ onDecided, onCountChange }) => {
  const { t } = useLingui();
  const [items, setItems] = useState<Mention[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [types, setTypes] = useState<Record<string, string>>({});
  const [decided, setDecided] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch('/api/mentions?view=review')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: MentionsPayload) => {
        setItems(d.items ?? []);
        setFocus(0);
      })
      .catch((e: Error) => setError(apiErrorText(e)));
  }, []);
  useEffect(load, [load]);

  // Remaining « à valider » count, derived locally (items - decided, excluding « annuler »): spares
  // the parent from repeating the same fetch just for this number (MediaMentionsPanel had its own
  // request on /api/mentions?view=review at each refreshTick, duplicating this one — review lot
  // 9b) and keeps it up to date instantly, without waiting for a network round trip after each decision.
  useEffect(() => {
    if (!onCountChange) return;
    const remaining = (items ?? []).filter((m) => !decided[m.id] || decided[m.id] === 'en_attente').length;
    onCountChange(remaining);
  }, [items, decided, onCountChange]);

  const decide = useCallback(
    (m: Mention, status: 'validee' | 'rejetee' | 'en_attente') => {
      const previous = decided[m.id]; // to restore the exact state on failure
      setDecided((prev) => ({ ...prev, [m.id]: status }));
      const body: Record<string, string> = { status };
      // Only send the type if it was touched (empty string = « inchangé » on the API side).
      if (types[m.id] !== undefined) body.intervention_type = types[m.id];
      fetch(`/api/mentions/${m.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          if (status === 'en_attente') {
            // Successful « Annuler »: the card becomes actionable again (otherwise it
            // would stay frozen in decided state).
            setDecided((prev) => {
              const next = { ...prev };
              delete next[m.id];
              return next;
            });
          }
          onDecided();
        })
        .catch((e: Error) => {
          // Network failure: back to the state before the click (not necessarily blank). `error` (further
          // down) would replace the whole queue with a full-screen message — unsuited to the failure of ONE
          // decision — hence a one-off alert(), the only way the user knew the card
          // had fallen back to « à décider » rather than validated (review lot 9b).
          setDecided((prev) => {
            const next = { ...prev };
            if (previous === undefined) delete next[m.id];
            else next[m.id] = previous;
            return next;
          });
          window.alert(apiErrorText(e) || t`Error saving the decision.`);
        });
    },
    [types, decided, onDecided],
  );

  // Keyboard shortcuts — inactive when the focus is in an input field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (!items || items.length === 0) return;
      const key = e.key.toLowerCase();
      if (key === 'arrowdown' || key === 'j') {
        e.preventDefault();
        setFocus((f) => Math.min(f + 1, items.length - 1));
      } else if (key === 'arrowup' || key === 'k') {
        e.preventDefault();
        setFocus((f) => Math.max(f - 1, 0));
      } else if (key === 'v' || key === 'r') {
        const m = items[focus];
        if (m && !decided[m.id]) {
          decide(m, key === 'v' ? 'validee' : 'rejetee');
          setFocus((f) => Math.min(f + 1, items.length - 1));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, focus, decided, decide]);

  // The focused card stays visible during keyboard navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${focus}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus]);

  if (error) {
    return (
      <div className="glass-card p-6 flex items-start gap-3 text-sm text-muted dark:text-[#c3beb0]">
        <AlertCircle className="w-5 h-5 shrink-0 text-status-external" />
        <div><Trans>The review queue could not be loaded: {error}</Trans></div>
      </div>
    );
  }
  if (!items) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted dark:text-[#c3beb0] py-8 justify-center">
        <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading the queue…</Trans>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted dark:text-[#c3beb0]">
        <Trans>Nothing to review — the queue is empty. 🎉</Trans>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" ref={listRef}>
      <p className="text-xs text-muted dark:text-[#c3beb0]">
        <Plural value={items.filter((i) => i.status === 'en_attente' && !decided[i.id]).length} one="# pending mention" other="# pending mentions" />
        <Trans>, then the recent “auto” ones (to fix a false positive). Keyboard:</Trans>
        <kbd className="px-1 mx-1 rounded bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15">↑↓</kbd>
        <Trans>navigate,</Trans>
        <kbd className="px-1 mx-1 rounded bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15">V</kbd>
        <Trans>validate,</Trans>
        <kbd className="px-1 mx-1 rounded bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15">R</kbd>
        <Trans>reject.</Trans>
      </p>
      {items.map((m, idx) => {
        const done = decided[m.id];
        return (
          <div
            key={m.id}
            data-idx={idx}
            onClick={() => setFocus(idx)}
            className={`glass-card p-4 flex flex-col gap-2 transition-all ${
              idx === focus ? 'ring-2 ring-pixel-amber/70' : ''
            } ${done ? 'opacity-45' : ''}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={`px-2 py-0.5 rounded-full font-semibold ${
                  m.status === 'en_attente'
                    ? 'bg-pixel-amber/25 text-ink dark:text-[#f5f2ea]'
                    : 'bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-muted dark:text-[#c3beb0]'
                }`}
              >
                {m.status === 'en_attente' ? t`pending` : t`auto`}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 font-semibold text-muted dark:text-[#c3beb0]">
                {mediaTypeLabel(m.media_type)}
              </span>
              {m.structures.map((s) => (
                <span
                  key={s.slug}
                  className="px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 font-semibold text-muted dark:text-[#c3beb0]"
                  title={t`via ${s.via} — confidence ${Math.round(s.confidence * 100)}%`}
                >
                  {s.acro} · {Math.round(s.confidence * 100)} %
                </span>
              ))}
              <span className="ml-auto text-muted dark:text-[#c3beb0] font-medium">
                {m.media_name}
                {m.published_at ? ` · ${m.published_at.slice(0, 10)}` : ''}
              </span>
            </div>
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-ink dark:text-[#f5f2ea] hover:underline inline-flex items-start gap-1.5"
            >
              <span className="min-w-0">{m.title || m.url}</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-50" />
            </a>
            {m.excerpt && m.excerpt !== m.title && (
              <div className="text-xs text-muted dark:text-[#c3beb0] line-clamp-2">{m.excerpt}</div>
            )}
            <div className="flex items-center gap-2">
              {done ? (
                <>
                  <span className="text-xs font-semibold text-muted dark:text-[#c3beb0]">
                    {done === 'validee' ? t`✓ validated` : done === 'rejetee' ? t`✕ rejected` : t`back to pending`}
                  </span>
                  <button
                    onClick={() => decide(m, 'en_attente')}
                    className="inline-flex items-center gap-1 text-xs text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> <Trans>undo</Trans>
                  </button>
                </>
              ) : (
                <>
                  <select
                    className="input-soft py-1 text-xs font-normal cursor-pointer"
                    value={types[m.id] ?? m.intervention_type ?? ''}
                    onChange={(e) => setTypes((p) => ({ ...p, [m.id]: e.target.value }))}
                  >
                    {INTERVENTION_TYPES.map(([v, label]) => (
                      <option key={v} value={v}>{t(label)}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => decide(m, 'validee')}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" /> <Trans>Validate</Trans>
                  </button>
                  <button
                    onClick={() => decide(m, 'rejetee')}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold bg-[rgba(214,69,69,.14)] text-[#b23b3b] dark:text-[#f08c8c] hover:bg-[rgba(214,69,69,.22)] transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> <Trans>Reject</Trans>
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const MediaMentionsPanel: React.FC<{ slug: string }> = ({ slug }) => {
  const { t, i18n } = useLingui();
  const [payload, setPayload] = useState<MentionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [typeFilter, setTypeFilter] = useState('');
  // Source management (RSS feeds…) lives in « Administration > Sources médias »
  // since 2026-09-10 (components/admin/AdminPage.tsx).
  type ViewKey = 'liste' | 'valider';
  const [view, setView] = useState<ViewKey>('liste');
  const [pendingCount, setPendingCount] = useState(0);
  // null = unknown yet; false = static deployment (no validation queue possible).
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  // Current scope (slug|period): distinguishes a real view change
  // (spinner) from a silent reload after validation.
  const scopeRef = useRef('');
  // Incremented after each validation decision: reloads the public
  // list (statuses just changed on the export side).
  const [refreshTick, setRefreshTick] = useState(0);

  const viewTabs = useMemo<[ViewKey, string][]>(() => {
    const tabs: [ViewKey, string][] = [
      ['liste', t`Mentions`],
      ['valider', pendingCount ? t`To review (${pendingCount})` : t`To review`],
    ];
    return tabs;
  }, [pendingCount, t]);

  useEffect(() => {
    // The same fetch already runs in ReviewQueue (onCountChange) when the queue is mounted — no need
    // to repeat it here in that case (review lot 9b); only needed for the tab badge
    // as long as the queue is not displayed.
    if (view === 'valider') return;
    if (apiAvailable === false) return; // static deployment: no validation queue
    let cancelled = false;
    fetch('/api/mentions?view=review')
      .then((r) =>
        r.ok && (r.headers.get('content-type') || '').includes('application/json')
          ? r.json()
          : null,
      )
      .then((d) => {
        if (!cancelled && d) setPendingCount(d.pending ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshTick, view, apiAvailable]);

  useEffect(() => {
    let cancelled = false;
    // Spinner on first load AND on scope change (slug/period);
    // silent reloads (refreshTick, after a decision) must not
    // interrupt the ongoing review.
    const scope = `${slug}|${days}`;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      setLoading(true);
    }
    setError(null);
    // The institution dashboard (univ-nantes) sees everything; a lab only
    // sees the mentions attached to its structure.
    const params = new URLSearchParams({ days: String(days) });
    if (slug !== 'univ-nantes' && slug !== 'ec-nantes') params.set('structure', slug);
    fetchMentions(params)
      .then((res) => {
        if (cancelled) return;
        if (!res) throw new Error('no mentions source available');
        setPayload(res.data);
        setApiAvailable(res.api);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(apiErrorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, days, refreshTick]);

  const items = useMemo(() => {
    let list = payload?.items ?? [];
    if (typeFilter) {
      list = list.filter((m) => mediaTypeLabel(m.media_type) === typeFilter);
    }
    return list;
  }, [payload, typeFilter, i18n.locale]);

  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set((payload?.items ?? []).map((m) => mediaTypeLabel(m.media_type))),
      ).sort((a, b) => a.localeCompare(b, i18n.locale)), // consistent with options.docTypes (NewsTab.tsx) — a raw lexical sort misordered accented labels (review lot 9b)
    [payload, i18n.locale],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-white/80 dark:border-white/15 shadow-soft text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <Trans>Loading the media watch…</Trans>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="glass-card p-6 flex items-start gap-3 text-sm text-muted dark:text-[#c3beb0]">
        <AlertCircle className="w-5 h-5 shrink-0 text-status-external" />
        <div><Trans>The media watch could not be loaded: {error}</Trans></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
            <Megaphone className="w-4 h-4" />
            <Trans>Media presence</Trans>
          </h3>
          <p className="text-xs text-muted dark:text-[#c3beb0]">
            <Trans>Mentions collected automatically (online press, videos, radio, podcasts, outreach) — official open sources.</Trans>
            {payload?.generated_at && <> <Trans>Last collection: {payload.generated_at.slice(0, 16).replace('T', ' ')}.</Trans></>}
          </p>
        </div>
        <div className="flex items-end gap-3">
          {/* Toggle public list / validation queue — hidden on a static deployment
              (no API to write the decisions). */}
          {apiAvailable && (
          <div className="flex items-center gap-1 p-1 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft">
            {viewTabs.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                  view === k
                    ? 'bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14]'
                    : 'text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          )}
          {view === 'liste' && (
            <>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]">
                <Trans>Period</Trans>
                <select
                  className="input-soft py-1.5 text-sm font-normal cursor-pointer"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {PERIODS.map((d) => (
                    <option key={d} value={d}>{t`${d} days`}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]">
                <Trans>Media type</Trans>
                <select
                  className="input-soft py-1.5 text-sm font-normal cursor-pointer"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="">{t`All`}</option>
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      </div>

      {view === 'valider' ? (
        <ReviewQueue onDecided={() => setRefreshTick((t) => t + 1)} onCountChange={setPendingCount} />
      ) : items.length === 0 ? (
        <div className="glass-card p-6 text-sm text-muted dark:text-[#c3beb0]">
          <Trans>No mention over the period. Collection is recent: the volume builds up night after night (and the review queue comes in phase 2).</Trans>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((m) => (
            <a
              key={m.id}
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-card p-4 flex flex-col gap-1.5 hover:shadow-lg transition-shadow group"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-pixel-amber/20 text-ink dark:text-[#f5f2ea] font-semibold">
                  {mediaTypeLabel(m.media_type)}
                </span>
                {m.structures.map((s) => (
                  <span
                    key={s.slug}
                    className="px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 font-semibold text-muted dark:text-[#c3beb0]"
                  >
                    {s.acro}
                  </span>
                ))}
                <span
                  className={`px-2 py-0.5 rounded-full font-semibold ${
                    m.status === 'validee'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-white/70 dark:bg-white/10 text-muted dark:text-[#c3beb0] border border-white/80 dark:border-white/15'
                  }`}
                  title={t`Matching confidence: ${Math.round(m.confidence * 100)}%`}
                >
                  {m.status === 'validee' ? t`validated` : t`auto`}
                </span>
                <span className="ml-auto text-muted dark:text-[#c3beb0] font-medium">
                  {m.media_name}
                  {m.published_at ? ` · ${m.published_at.slice(0, 10)}` : ''}
                </span>
              </div>
              <div className="text-sm font-semibold text-ink dark:text-[#f5f2ea] group-hover:underline flex items-start gap-1.5">
                <span className="min-w-0">{m.title || m.url}</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-50" />
              </div>
              {m.excerpt && m.excerpt !== m.title && (
                <div className="text-xs text-muted dark:text-[#c3beb0] line-clamp-2">
                  {m.excerpt}
                </div>
              )}
            </a>
          ))}
        </div>
      )}

      {/* Collector health: flags broken sources (0 item over
          several runs, or last run in error) — redundant with the per-feed detail
          of « Administration > Sources médias ». */}
      {(() => {
        const broken = (payload?.collectors ?? []).filter(
          (c) => c.last_status === 'erreur' || c.consecutive_empty >= 3,
        );
        if (broken.length === 0) return null;
        return (
          <p
            className="text-[11px] text-muted-lighter dark:text-[#8f897c]"
            title={broken
              .map((c) => `${c.collector} : ${c.last_status}, ${c.consecutive_empty} runs vides`)
              .join(' · ')}
          >
            ⚠ <Plural value={broken.length} one="# collector without recent results" other="# collectors without recent results" /> ({broken.map((c) => c.collector).join(', ')}) — <Trans>see the media_watch operations doc.</Trans>
          </p>
        );
      })()}
    </div>
  );
};
